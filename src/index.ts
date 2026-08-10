import { App, EventRef, TFile } from 'obsidian';

type EventEmitter = { offref(ref: EventRef): void };
import type { Card, CardBoxDef, FilterState, SortMode } from './types';
import { CardService } from './frontmatter';
import { cardMatchesBox } from './boxes';
import { parseLinkTarget } from './utils/link';
import { defaultOutgoingIds, type GraphSource } from './utils/graph';

const SCAN_CONCURRENCY = 10;
const UPDATE_BUMP_THRESHOLD_MS = 1000; // mtime 比 updated 新超过此值才回写 updated
const UPDATE_BUMP_COOLDOWN_MS = 1500;

/**
 * CardIndex：内存索引，视图的唯一数据源。
 * 初始扫描 + Obsidian 事件增量更新；查询全部走内存数组。
 */
export class CardIndex {
	private cardsById = new Map<string, Card>();
	private pathToId = new Map<string, string>();
	/**旧 id（frontmatter 残留）→ 当前 id，保证历史关联不断链 */
	private aliasToId = new Map<string, string>();
	private tagCounts = new Map<string, number>();
	private sorted: Card[] = [];
	private needsSort = true;
	private listeners = new Set<() => void>();
	private eventRefs: { emitter: EventEmitter; ref: EventRef }[] = [];
	private refreshQueues = new Map<string, Promise<unknown>>();
	private debounceTimers = new Map<string, number>();
	private lastBump = new Map<string, number>();

	isIndexing = false;
	ready = false;

	constructor(
		private app: App,
		private service: CardService,
		private getFolder: () => string,
	) {}

	attach(): void {
		const { metadataCache, vault } = this.app;
		const register = (emitter: EventEmitter, ref: EventRef) => {
			this.eventRefs.push({ emitter, ref });
			return ref;
		};
		// 'ready' 是真实事件但未在类型定义中列出
		register(metadataCache, metadataCache.on('ready' as any, () => void this.build()));
		register(
			metadataCache,
			metadataCache.on('changed', (file) => {
				if (file instanceof TFile && this.service.isCardPath(file.path)) this.scheduleRefresh(file.path, 0);
			}),
		);
		register(
			vault,
			vault.on('create', (file) => {
				if (file instanceof TFile && this.service.isCardPath(file.path)) this.scheduleRefresh(file.path, 0);
			}),
		);
		register(
			vault,
			vault.on('modify', (file) => {
				if (file instanceof TFile && this.service.isCardPath(file.path)) this.scheduleRefresh(file.path, 500);
			}),
		);
		register(
			vault,
			vault.on('delete', (file) => {
				if (this.service.isCardPath(file.path)) this.removeByPath(file.path);
			}),
		);
		register(
			vault,
			vault.on('rename', (file, oldPath) => {
				if (this.service.isCardPath(oldPath)) this.removeByPath(oldPath);
				if (file instanceof TFile && this.service.isCardPath(file.path)) this.scheduleRefresh(file.path, 0);
			}),
		);
	}

	detach(): void {
		for (const { emitter, ref } of this.eventRefs) emitter.offref(ref);
		this.eventRefs = [];
		for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
		this.debounceTimers.clear();
	}

	// ---------- 全量构建 ----------

	async build(): Promise<void> {
		this.isIndexing = true;
		this.notify();
		const files = this.app.vault.getMarkdownFiles().filter((f) => this.service.isCardPath(f.path));
		const results: Card[] = [];
		let i = 0;
		const worker = async () => {
			while (i < files.length) {
				const file = files[i++];
				try {
					results.push(await this.service.readCard(file));
				} catch {
					/* 跳过不可读文件 */
				}
			}
		};
		const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, Math.max(1, files.length)) }, () => worker());
		await Promise.all(workers);

		this.cardsById.clear();
		this.pathToId.clear();
		this.aliasToId.clear();
		this.tagCounts.clear();
		for (const card of results) {
			this.fillBodyLinks(card);
			this.cardsById.set(card.id, card);
			this.pathToId.set(card.path, card.id);
			if (card.legacyId) this.aliasToId.set(card.legacyId, card.id);
			this.addTagCounts(card, +1);
		}
		this.needsSort = true;
		this.isIndexing = false;
		this.ready = true;
		this.notify();
	}

	/**
	 * 从 metadataCache 读取正文中的 [[双链]]，凡指向卡片文件夹内卡片的即记为 bodyLinks。
	 * 这样用户在正文里手写的双链会自动成为扩展卡片，双链与卡片扩展是同一套关系。
	 * 用 metadataCache 而非自己正则解析正文，可正确处理别名、代码块内链接等边界情况。
	 */
	private fillBodyLinks(card: Card): void {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (!(file instanceof TFile)) {
			card.bodyLinks = [];
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		const links = cache?.links ?? [];
		const out: string[] = [];
		for (const l of links) {
			// link 形如 "id"、"Cards/id"、"id|别名"
			const id = parseLinkTarget(l.link);
			if (!id || id === card.id) continue;
			if (out.includes(id)) continue;
			// 只认指向卡片的链接：目标必须能解析到卡片文件夹内的文件
			const target = this.app.metadataCache.getFirstLinkpathDest(id, card.path);
			if (target && this.service.isCardPath(target.path)) out.push(id);
		}
		card.bodyLinks = out;
	}

	// ---------- 增量更新 ----------

	private scheduleRefresh(path: string, delay: number): void {
		if (delay <= 0) {
			this.refresh(path);
			return;
		}
		const existing = this.debounceTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.debounceTimers.delete(path);
			this.refresh(path);
		}, delay);
		this.debounceTimers.set(path, timer);
	}

	private refresh(path: string): void {
		const prev = this.refreshQueues.get(path) ?? Promise.resolve();
		const next = prev
			.catch(() => undefined)
			.then(async () => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return;
				let card: Card;
				try {
					card = await this.service.readCard(file);
				} catch {
					return;
				}
				this.maybeBumpUpdated(card);
				this.fillBodyLinks(card);
				this.upsertCard(card);
			});
		this.refreshQueues.set(path, next);
	}

	/** 正文被外部编辑时，回写 updated（带冷却与阈值，防止与自身写入形成循环） */
	private maybeBumpUpdated(card: Card): void {
		const now = Date.now();
		if (card.mtime - card.updated < UPDATE_BUMP_THRESHOLD_MS) return;
		const last = this.lastBump.get(card.path) ?? 0;
		if (now - last < UPDATE_BUMP_COOLDOWN_MS) return;
		this.lastBump.set(card.path, now);
		this.service.bumpUpdated(card).catch(() => undefined);
	}

	private upsertCard(card: Card): void {
		const old = this.cardsById.get(card.id);
		if (old && old.path !== card.path) this.pathToId.delete(old.path);
		if (old) this.addTagCounts(old, -1);
		// 同一路径的卡片如果 id 变了（例如被重命名），要清掉旧 id 条目，
		// 否则索引里会同时存在改名前后两张「同一张卡」。
		const prevId = this.pathToId.get(card.path);
		if (prevId && prevId !== card.id) {
			const stale = this.cardsById.get(prevId);
			if (stale) {
				this.addTagCounts(stale, -1);
				this.cardsById.delete(prevId);
				if (stale.legacyId) this.aliasToId.delete(stale.legacyId);
			}
		}
		this.cardsById.set(card.id, card);
		this.pathToId.set(card.path, card.id);
		if (card.legacyId) this.aliasToId.set(card.legacyId, card.id);
		this.addTagCounts(card, +1);
		this.needsSort = true;
		this.notify();
	}

	private removeByPath(path: string): void {
		const id = this.pathToId.get(path);
		const card = id ? this.cardsById.get(id) : undefined;
		if (id && card) {
			this.cardsById.delete(id);
			if (card.legacyId) this.aliasToId.delete(card.legacyId);
			this.addTagCounts(card, -1);
		}
		this.pathToId.delete(path);
		this.needsSort = true;
		this.notify();
	}

	private addTagCounts(card: Card, delta: number): void {
		for (const tag of card.tags) {
			const parts = tag.split('/');
			let prefix = '';
			for (const p of parts) {
				prefix = prefix ? `${prefix}/${p}` : p;
				const cur = this.tagCounts.get(prefix) ?? 0;
				const next = cur + delta;
				if (next <= 0) this.tagCounts.delete(prefix);
				else this.tagCounts.set(prefix, next);
			}
		}
	}

	// ---------- 查询 ----------

	all(): Card[] {
		this.ensureSorted();
		return this.sorted;
	}

	getById(id: string): Card | undefined {
		return this.resolve(id);
	}

	byPath(path: string): Card | undefined {
		const id = this.pathToId.get(path);
		return id ? this.cardsById.get(id) : undefined;
	}

	allTags(): { tag: string; count: number }[] {
		const out: { tag: string; count: number }[] = [];
		for (const [tag, count] of this.tagCounts) out.push({ tag, count });
		out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
		return out;
	}

	// ---------- 扩展关系（frontmatter 显式关联 + 正文双链） ----------

	/**
	 * 按 id 解析卡片，带别名兜底。
	 * 所有「关系解析」都必须走这里而不是直接查 cardsById——
	 * 否则老卡片 children 里写的旧 id 会解析不到，历史关联断链。
	 */
	private resolve(id: string): Card | undefined {
		const direct = this.cardsById.get(id);
		if (direct) return direct;
		const aliased = this.aliasToId.get(id);
		return aliased ? this.cardsById.get(aliased) : undefined;
	}

	/** 一张卡片可能被别人用哪些 id 引用（当前文件名 + 残留的旧 id） */
	private idsOf(card: Card): string[] {
		return card.legacyId ? [card.id, card.legacyId] : [card.id];
	}

	/** 判断 other 是否引用了 card（兼容旧 id 写法） */
	private referencesCard(other: Card, card: Card): boolean {
		for (const id of this.idsOf(card)) {
			if (other.children.includes(id) || other.bodyLinks.includes(id)) return true;
		}
		return false;
	}

	/**
	 * 取一张卡片的全部扩展卡片。
	 * 顺序：frontmatter children 在前（可拖拽排序），正文双链按出现顺序追加。
	 * source 标明来源，供视图区分「显式关联」与「正文链接」。
	 */
	extensionsOf(card: Card): { card: Card; source: 'explicit' | 'body' }[] {
		const out: { card: Card; source: 'explicit' | 'body' }[] = [];
		const seen = new Set<string>([card.id]);
		for (const id of card.children) {
			const c = this.resolve(id);
			if (!c || seen.has(c.id)) continue;
			seen.add(c.id);
			out.push({ card: c, source: 'explicit' });
		}
		for (const id of card.bodyLinks) {
			const c = this.resolve(id);
			if (!c || seen.has(c.id)) continue;
			seen.add(c.id);
			out.push({ card: c, source: 'body' });
		}
		return out;
	}

	/** 扩展卡片数量（展开按钮旁的数字 / 列表角标用） */
	extensionCount(card: Card): number {
		return this.extensionsOf(card).length;
	}

	/**
	 * 反向链接：哪些卡片把当前卡片当作扩展卡片，或在正文中引用了它。
	 * 排除已经是它扩展卡片的，避免同一关系在扩展视图里重复出现。
	 */
	backlinksOf(card: Card): Card[] {
		const forward = new Set(this.extensionsOf(card).map((e) => e.card.id));
		const out: Card[] = [];
		for (const other of this.cardsById.values()) {
			if (other.id === card.id || forward.has(other.id)) continue;
			if (this.referencesCard(other, card)) out.push(other);
		}
		out.sort((a, b) => b.created - a.created);
		return out;
	}

	/** 全部引用当前卡片的卡片 id（不做 forward 排除，供图遍历使用） */
	private allIncomingIds(card: Card): string[] {
		const out: string[] = [];
		for (const other of this.cardsById.values()) {
			if (other.id === card.id) continue;
			if (this.referencesCard(other, card)) out.push(other.id);
		}
		return out;
	}

	/**
	 * 供 utils/graph 做引用关系遍历的数据源。
	 * 抽成接口是为了让图算法可脱离 Obsidian 单测。
	 */
	graphSource(): GraphSource {
		return {
			getById: (id) => this.resolve(id),
			// 出链要归一化成「当前 id」，否则旧 id 会让 BFS 在图里重复登记同一张卡
			outgoingIds: (card) => {
				const out: string[] = [];
				for (const raw of defaultOutgoingIds(card)) {
					const c = this.resolve(raw);
					if (c && !out.includes(c.id)) out.push(c.id);
				}
				return out;
			},
			incomingIds: (card) => this.allIncomingIds(card),
		};
	}

	/**
	 * 主查询：卡片盒条件 → 筛选条件 → 关键字 → 排序。
	 * 置顶卡片恒定悬浮在结果最前（Writeathon 的「卡片置顶」语义）。
	 */
	search(query: string, filter: FilterState, sort: SortMode, box?: CardBoxDef): Card[] {
		const qs = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const now = Date.now();
		const result = this.all().filter((card) => {
			if (box && !cardMatchesBox(card, box, now)) return false;
			if (!this.matchesFilter(card, filter)) return false;
			if (qs.length && !qs.every((p) => card.searchText.includes(p))) return false;
			return true;
		});
		const cmp = sortCards(sort);
		// 置顶优先，其余按选定排序
		result.sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return cmp(a, b);
		});
		return result;
	}

	/** 统计某个卡片盒当前抓取到的卡片数（用于盒切换器角标） */
	countBox(box: CardBoxDef, showArchived: boolean): number {
		const now = Date.now();
		let n = 0;
		for (const card of this.all()) {
			if (!showArchived && card.archived) continue;
			if (!cardMatchesBox(card, box, now)) continue;
			n++;
		}
		return n;
	}

	/** 批量操作后手动刷新（事件可能漏掉时兜底） */
	refreshPaths(paths: string[]): void {
		for (const p of paths) this.scheduleRefresh(p, 0);
	}

	// ---------- 内部 ----------

	private ensureSorted(): void {
		if (!this.needsSort) return;
		const arr = Array.from(this.cardsById.values());
		arr.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
		this.sorted = arr;
		this.needsSort = false;
	}

	private matchesFilter(card: Card, f: FilterState): boolean {
		if (f.hasTag && card.tags.length === 0) return false;
		if (f.noTag && card.tags.length > 0) return false;
		if (f.emptyContent && card.snippet.trim() !== '') return false;
		if (f.hasTaskList && !card.hasTaskList) return false;
		if (f.pinnedOnly && !card.pinned) return false;
		if (!f.showArchived && card.archived) return false;
		if (f.selectedColors.size && (card.color === undefined || !f.selectedColors.has(card.color))) return false;
		if (f.selectedTags.size) {
			let ok = false;
			for (const sel of f.selectedTags) {
				if (card.tags.some((t) => t === sel || t.startsWith(sel + '/'))) {
					ok = true;
					break;
				}
			}
			if (!ok) return false;
		}
		return true;
	}

	// ---------- 变更订阅 ----------

	onChanged(cb: () => void): void {
		this.listeners.add(cb);
	}

	offChanged(cb: () => void): void {
		this.listeners.delete(cb);
	}

	private notify(): void {
		for (const cb of this.listeners) cb();
	}
}

function sortCards(sort: SortMode): (a: Card, b: Card) => number {
	const collator = new Intl.Collator('zh');
	switch (sort) {
		case 'created-asc':
			return (a, b) => a.created - b.created || a.id.localeCompare(b.id);
		case 'updated-desc':
			return (a, b) => b.updated - a.updated || b.created - a.created;
		case 'title':
			return (a, b) => collator.compare(a.title ?? a.snippet, b.title ?? b.snippet);
		case 'created-desc':
		default:
			return (a, b) => b.created - a.created || a.id.localeCompare(b.id);
	}
}
