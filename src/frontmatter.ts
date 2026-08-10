import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type { Card, CardColor } from './types';
import { CARD_COLORS } from './types';
import { generateId, deriveFileBase, normalizeTags } from './utils/format';
import { parseLinkList, parseLinkTarget, toLinkList, toWikilink } from './utils/link';

const SNIPPET_LENGTH = 200;
const SEARCH_TEXT_LENGTH = 4000;

/** 拆分 frontmatter 与正文；无 frontmatter 时 data 为 null */
export function splitFrontmatter(content: string): { data: Record<string, unknown> | null; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (m) {
		try {
			const parsed = parseYaml(m[1]);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return { data: parsed as Record<string, unknown>, body: content.slice(m[0].length) };
			}
		} catch {
			/* frontmatter 损坏时按无 frontmatter 处理 */
		}
	}
	return { data: null, body: content };
}

/** 拼接 frontmatter 与正文（stringifyYaml 保证转义与 Obsidian 解析器一致） */
export function buildCardContent(fm: Record<string, unknown>, body: string): string {
	return `---\n${stringifyYaml(fm)}---\n\n${body}`;
}

/**
 * 推导卡片 id。
 *
 * **文件名优先**，而不是 frontmatter 的 id 字段。原因：
 * Obsidian 的 [[链接]] 解析的是文件名，图谱/反向链接/重命名跟随全部围绕文件名工作。
 * 如果 id 用frontmatter 而文件名是标题，两者不一致时
 * children:["[[标题]]"] 就无法在索引里查到对应卡片（索引按 id 建表）。
 *
 * 只有在文件名与 frontmatter id 都存在且不一致时，仍以文件名为准——
 * 这样用标题重命名后，插件的关联能立刻跟上 Obsidian 改写的链接。
 */
function deriveId(_data: Record<string, unknown> | null, fileName: string): string {
	return fileName.replace(/\.md$/i, '');
}

function numOr(v: unknown, fallback: number, now: number): number {
	if (typeof v === 'number' && isFinite(v)) return v;
	if (typeof v === 'string' && v.trim()) {
		const parsed = Date.parse(v);
		if (!isNaN(parsed)) return parsed;
		const num = Number(v);
		if (isFinite(num)) return num;
	}
	return isFinite(fallback) ? fallback : now;
}

function parseColor(v: unknown): CardColor | undefined {
	if (typeof v !== 'string') return undefined;
	const c = v.trim().toLowerCase();
	return (CARD_COLORS as string[]).includes(c) ? (c as CardColor) : undefined;
}

/** 转义正则元字符（卡片 id 含连字符，用于安全构造检测用正则） */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * CardService：卡片创建 / 读取 / 变更的唯一入口。
 * 变更一律走 FileManager.processFrontMatter（内部加锁防丢更新），
 * 且同一文件按顺序 await，避免并发竞态。
 */
export class CardService {
	constructor(
		private app: App,
		private getCardsFolder: () => string,
		/** 文件名方案；默认 title（标题作文件名，双链可读） */
		private getFilenameFormat: () => 'datetime' | 'title' = () => 'title',
	) {}

	private folder(): string {
		return this.getCardsFolder().trim().replace(/^\/+|\/+$/g, '');
	}

	isCardPath(path: string): boolean {
		const f = this.folder();
		return f.length > 0 && path.startsWith(f + '/') && path.endsWith('.md');
	}

	/** 确保文件夹存在（不存在则创建） */
	async ensureFolder(folder: string): Promise<void> {
		const clean = folder.trim().replace(/^\/+|\/+$/g, '');
		if (!clean) return;
		if (!this.app.vault.getAbstractFileByPath(clean)) {
			try {
				await this.app.vault.createFolder(clean);
			} catch {
				/* 并发下可能已创建 */
			}
		}
	}

	private getFile(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	/** 读取单张卡片（cachedRead 走插件读缓存，热路径安全） */
	async readCard(file: TFile): Promise<Card> {
		const content = await this.app.vault.cachedRead(file);
		const { data, body } = splitFrontmatter(content);
		return this.buildCard(file, data, body);
	}

	private buildCard(file: TFile, data: Record<string, unknown> | null, body: string): Card {
		const trimmed = body.trim();
		const title = data && typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
		const tags = normalizeTags(data?.tags);
		const id = deriveId(data, file.name);
		// frontmatter 里的旧 id：文件名改成标题后，老卡片的 children 可能仍写着旧 id，
		// 索引会把它登记为别名，保证历史关联不断。
		const fmId = data && typeof data.id === 'string' && data.id.trim() ? data.id.trim() : undefined;
		return {
			id,
			legacyId: fmId && fmId !== id ? fmId : undefined,
			path: file.path,
			title,
			tags,
			created: numOr(data?.created, file.stat.ctime, Date.now()),
			updated: numOr(data?.updated, file.stat.mtime, Date.now()),
			parent: parseLinkTarget(data?.parent) || undefined,
			children: parseLinkList(data?.children),
			bodyLinks: [],
			archived: data?.archived === true,
			color: parseColor(data?.color),
			pinned: data?.pinned === true,
			snippet: trimmed.slice(0, SNIPPET_LENGTH),
			searchText: `${title ?? ''} ${tags.join(' ')} ${trimmed}`.slice(0, SEARCH_TEXT_LENGTH).toLowerCase(),
			hasTaskList: /^\s*[-*] \[[ xX]\]/m.test(body),
			mtime: file.stat.mtime,
		};
	}

	/**
	 * 生成一个在目标文件夹内不冲突的文件路径。
	 * 同名时追加 -2、-3…（而不是时间戳），保持文件名可读。
	 */
	private uniquePath(folder: string, base: string): string {
		const dir = folder ? `${folder}/` : '';
		let candidate = `${dir}${base}.md`;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${dir}${base}-${n}.md`;
			n++;
			if (n > 999) {
				candidate = `${dir}${base}-${Date.now()}.md`;
				break;
			}
		}
		return candidate;
	}

	/**
	 * 新建卡片，返回新文件（空正文返回 null）。
	 *
	 *文件名方案：
	 * - title（默认）：用标题或正文首行作文件名，双链写成 [[卡片标题]]，易读易记；
	 *   标题为空或全是非法字符时回落到时间戳。
	 * - datetime：始终用 YYYY-MM-DD-HHmmss-xxx，绝不重名。
	 *
	 * 注意：id 由文件名决定，因此**不再写 frontmatter id**——
	 * 写了反而会在用标题重命名后产生「文件名与 id 不一致」的歧义。
	 */
	async createCard(opts: { body: string; tags?: string[]; title?: string; parent?: string }): Promise<TFile | null> {
		const body = opts.body.trim();
		if (!body) return null;
		const now = Date.now();
		await this.ensureFolder(this.folder());

		let path: string;
		if (this.getFilenameFormat() === 'title') {
			const base = deriveFileBase(opts.title, body) || generateId(now);
			path = this.uniquePath(this.folder(), base);
		} else {
			path = this.uniquePath(this.folder(), generateId(now));
		}

		const fm: Record<string, unknown> = { created: now, updated: now };
		if (opts.title) fm.title = opts.title;
		if (opts.tags && opts.tags.length) fm.tags = opts.tags;
		if (opts.parent) fm.parent = toWikilink(opts.parent);
		await this.app.vault.create(path, buildCardContent(fm, body));
		return this.getFile(path);
	}

	/**
	 * 用标题（或正文首行）重命名卡片文件。
	 *
	 * **必须走 fileManager.renameFile 而非 vault.rename**：
	 * 只有前者会让 Obsidian 自动更新所有指向该文件的 [[链接]]
	 *（含 frontmatter children、正文双链、其他笔记里的引用）。
	 * 用 vault.rename 会造成全库断链且不可恢复。
	 *
	 * @returns 结果状态，供调用方给出准确提示
	 */
	async renameByTitle(card: Card): Promise<{ ok: boolean; from: string; to?: string; reason?: string }> {
		const file = this.getFile(card.path);
		if (!file) return { ok: false, from: card.id, reason: 'notfound' };

		const body = await this.readBody(card);
		const base = deriveFileBase(card.title, body);
		if (!base) return { ok: false, from: card.id, reason: 'empty' };
		if (base === file.basename) return { ok: false, from: card.id, reason: 'same' };

		const folder = file.parent?.path && file.parent.path !== '/' ? file.parent.path : '';
		const target = this.uniquePath(folder, base);
		try {
			await this.app.fileManager.renameFile(file, target);
		} catch (err) {
			return { ok: false, from: card.id, reason: String(err) };
		}
		return { ok: true, from: card.id, to: target.replace(/^.*\//, '').replace(/\.md$/i, '') };
	}

	/** 批量追加标签（顺序 await） */
	async setTags(cards: Card[], tagsToAdd: string[]): Promise<void> {
		const clean = [...new Set(normalizeTags(tagsToAdd))];
		if (!clean.length) return;
		for (const card of cards) {
			const file = this.getFile(card.path);
			if (!file) continue;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm.tags = [...new Set([...normalizeTags(fm.tags), ...clean])];
				fm.updated = Date.now();
			});
		}
	}

	/** 批量归档 / 取消归档 */
	async setArchived(cards: Card[], archived: boolean): Promise<void> {
		for (const card of cards) {
			const file = this.getFile(card.path);
			if (!file) continue;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm.archived = archived;
				fm.updated = Date.now();
			});
		}
	}

	/** 批量删除（进 Obsidian 回收站） */
	async deleteCards(cards: Card[]): Promise<void> {
		for (const card of cards) {
			const file = this.getFile(card.path);
			if (file) await this.app.vault.trash(file, false);
		}
	}

	/** 批量设置眉头颜色；color 传 null 表示清除标记 */
	async setColor(cards: Card[], color: CardColor | null): Promise<void> {
		for (const card of cards) {
			const file = this.getFile(card.path);
			if (!file) continue;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				if (color === null) delete fm.color;
				else fm.color = color;
				fm.updated = Date.now();
			});
		}
	}

	/** 批量置顶 / 取消置顶 */
	async setPinned(cards: Card[], pinned: boolean): Promise<void> {
		for (const card of cards) {
			const file = this.getFile(card.path);
			if (!file) continue;
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				if (pinned) fm.pinned = true;
				else delete fm.pinned;
				fm.updated = Date.now();
			});
		}
	}

	/**
	 * 在父卡片 frontmatter 中登记扩展卡片。
	 * 写入 [[id]] 格式，使 Obsidian 图谱 / 反向链接 / 重命名跟随都能识别。
	 */
	async addChild(parent: Card, child: Card): Promise<void> {
		const file = this.getFile(parent.path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			const ids = parseLinkList(fm.children);
			if (!ids.includes(child.id)) ids.push(child.id);
			fm.children = toLinkList(ids);
			fm.updated = Date.now();
		});
	}

	/**
	 * 关联一张已存在的卡片为扩展卡片：
	 * 双向写入（父登记 children，子登记 parent），保证列表与扩展视图一致。
	 */
	async linkChild(parent: Card, child: Card): Promise<void> {
		if (parent.id === child.id) return;
		await this.addChild(parent, child);
		const childFile = this.getFile(child.path);
		if (!childFile) return;
		await this.app.fileManager.processFrontMatter(childFile, (fm) => {
			fm.parent = toWikilink(parent.id);
			fm.updated = Date.now();
		});
	}

	/** 解除关联：父移除 children 项，子清空 parent */
	async unlinkChild(parent: Card, child: Card): Promise<void> {
		const parentFile = this.getFile(parent.path);
		if (parentFile) {
			await this.app.fileManager.processFrontMatter(parentFile, (fm) => {
				const ids = parseLinkList(fm.children).filter((id) => id !== child.id);
				if (ids.length) fm.children = toLinkList(ids);
				else delete fm.children;
				fm.updated = Date.now();
			});
		}
		const childFile = this.getFile(child.path);
		if (childFile) {
			await this.app.fileManager.processFrontMatter(childFile, (fm) => {
				delete fm.parent;
				fm.updated = Date.now();
			});
		}
	}

	/** 覆写父卡片的 children 顺序（扩展视图拖拽排序用） */
	async reorderChildren(parent: Card, orderedIds: string[]): Promise<void> {
		const file = this.getFile(parent.path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.children = toLinkList(orderedIds);
			fm.updated = Date.now();
		});
	}

	/**
	 * 在卡片正文末尾追加一条[[双链]]。
	 * 用于「在正文插入双链」：让关联同时体现在正文里，
	 * 在阅读/预览视图中可直接点击跳转。已存在同名链接则不重复插入。
	 */
	async appendBodyLink(card: Card, targetId: string): Promise<boolean> {
		const file = this.getFile(card.path);
		if (!file) return false;
		const content = await this.app.vault.read(file);
		const { data, body } = splitFrontmatter(content);
		const link = toWikilink(targetId);
		// 已有相同链接（含别名/路径写法）则跳过
		const existing = new RegExp(`\\[\\[[^\\]]*${escapeRegExp(targetId)}[^\\]]*\\]\\]`);
		if (existing.test(body)) return false;
		const trimmed = body.replace(/\s+$/, '');
		const nextBody = trimmed ? `${trimmed}\n\n${link}\n` : `${link}\n`;
		const nextContent = data ? buildCardContent({ ...data, updated: Date.now() }, nextBody) : nextBody;
		await this.app.vault.modify(file, nextContent);
		return true;
	}

	/** 读取卡片完整正文（合并成文用；索引里的 Card 只有 snippet） */
	async readBody(card: Card): Promise<string> {
		const file = this.getFile(card.path);
		if (!file) return '';
		const content = await this.app.vault.cachedRead(file);
		const { body } = splitFrontmatter(content);
		return body;
	}

	/** 将卡片 updated 刷新为当前时间（由索引在检测到正文变更时调用） */
	async bumpUpdated(card: Card): Promise<void> {
		const file = this.getFile(card.path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.updated = Date.now();
		});
	}
}
