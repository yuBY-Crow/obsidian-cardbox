import { App, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type { Card, CardColor } from './types';
import { CARD_COLORS } from './types';
import { generateId, normalizeTags } from './utils/format';

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

function deriveId(data: Record<string, unknown> | null, fileName: string): string {
	if (data && typeof data.id === 'string' && data.id.trim()) return data.id.trim();
	return fileName.replace(/\.md$/, '');
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

/**
 * CardService：卡片创建 / 读取 / 变更的唯一入口。
 * 变更一律走 FileManager.processFrontMatter（内部加锁防丢更新），
 * 且同一文件按顺序 await，避免并发竞态。
 */
export class CardService {
	constructor(
		private app: App,
		private getCardsFolder: () => string,
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
		return {
			id: deriveId(data, file.name),
			path: file.path,
			title,
			tags,
			created: numOr(data?.created, file.stat.ctime, Date.now()),
			updated: numOr(data?.updated, file.stat.mtime, Date.now()),
			parent: data && typeof data.parent === 'string' && data.parent.trim() ? data.parent.trim() : undefined,
			children: Array.isArray(data?.children) ? data.children.filter((c): c is string => typeof c === 'string') : [],
			archived: data?.archived === true,
			color: parseColor(data?.color),
			pinned: data?.pinned === true,
			snippet: trimmed.slice(0, SNIPPET_LENGTH),
			searchText: `${title ?? ''} ${tags.join(' ')} ${trimmed}`.slice(0, SEARCH_TEXT_LENGTH).toLowerCase(),
			hasTaskList: /^\s*[-*] \[[ xX]\]/m.test(body),
			mtime: file.stat.mtime,
		};
	}

	/** 新建卡片，返回新文件（空正文返回 null） */
	async createCard(opts: { body: string; tags?: string[]; title?: string; parent?: string }): Promise<TFile | null> {
		const body = opts.body.trim();
		if (!body) return null;
		const now = Date.now();
		const id = generateId(now);
		await this.ensureFolder(this.folder());
		const path = `${this.folder()}/${id}.md`;
		const fm: Record<string, unknown> = { id, created: now, updated: now };
		if (opts.title) fm.title = opts.title;
		if (opts.tags && opts.tags.length) fm.tags = opts.tags;
		if (opts.parent) fm.parent = opts.parent;
		await this.app.vault.create(path, buildCardContent(fm, body));
		return this.getFile(path);
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

	/** 在父卡片frontmatter 中登记子卡片 */
	async addChild(parent: Card, child: Card): Promise<void> {
		const file = this.getFile(parent.path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			const children = Array.isArray(fm.children)
				? (fm.children as Array<unknown>).filter((c): c is string => typeof c === 'string')
				: [];
			if (!children.includes(child.id)) children.push(child.id);
			fm.children = children;
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
			fm.parent = parent.id;
			fm.updated = Date.now();
		});
	}

	/** 解除关联：父移除 children 项，子清空 parent */
	async unlinkChild(parent: Card, child: Card): Promise<void> {
		const parentFile = this.getFile(parent.path);
		if (parentFile) {
			await this.app.fileManager.processFrontMatter(parentFile, (fm) => {
				const children = Array.isArray(fm.children)
					? (fm.children as Array<unknown>).filter((c): c is string => typeof c === 'string')
					: [];
				fm.children = children.filter((id) => id !== child.id);
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
			fm.children = orderedIds;
			fm.updated = Date.now();
		});
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
