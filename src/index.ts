import { App, EventRef, TFile } from 'obsidian';

type EventEmitter = { offref(ref: EventRef): void };
import type { Card, FilterState, SortMode } from './types';
import { CardService } from './frontmatter';

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
		this.tagCounts.clear();
		for (const card of results) {
			this.cardsById.set(card.id, card);
			this.pathToId.set(card.path, card.id);
			this.addTagCounts(card, +1);
		}
		this.needsSort = true;
		this.isIndexing = false;
		this.ready = true;
		this.notify();
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
		this.cardsById.set(card.id, card);
		this.pathToId.set(card.path, card.id);
		this.addTagCounts(card, +1);
		this.needsSort = true;
		this.notify();
	}

	private removeByPath(path: string): void {
		const id = this.pathToId.get(path);
		const card = id ? this.cardsById.get(id) : undefined;
		if (id && card) {
			this.cardsById.delete(id);
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
		return this.cardsById.get(id);
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

	search(query: string, filter: FilterState, sort: SortMode): Card[] {
		const qs = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const result = this.all().filter((card) => {
			if (!this.matchesFilter(card, filter)) return false;
			if (qs.length) {
				const hay = `${card.title ?? ''} ${card.tags.join(' ')} ${card.snippet}`.toLowerCase();
				if (!qs.every((p) => hay.includes(p))) return false;
			}
			return true;
		});
		if (sort !== 'created-desc') result.sort(sortCards(sort));
		return result;
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
		if (!f.showArchived && card.archived) return false;
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
