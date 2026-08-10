import { App, Notice, TFile } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';
import { buildCardContent } from '../frontmatter';
import { sanitizeFileName, toDayKey } from '../utils/format';

/** 生成文章时的一个节点：卡片 + 层级（0 = 一级标题） */
export interface ArticleNode {
	card: Card;
	depth: number;
	body: string;
}

/**
 * 按层级生成带标题的文章（卡片扩展 → 文章）。
 * depth 0 → ##，depth 1 → ###，以此类推（# 留给文章标题本身）。
 */
export function buildHierarchicalArticle(title: string, nodes: ArticleNode[]): string {
	const fm: Record<string, unknown> = {
		created: Date.now(),
		source: 'cardbox-extend',
		sourceCards: nodes.map((n) => n.card.id),
	};
	const sections = nodes.map((n) => {
		const level = '#'.repeat(Math.min(6, n.depth + 2));
		const heading = n.card.title || n.body.split('\n')[0].trim().slice(0, 40) || '卡片片段';
		const rest = n.card.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim();
		return rest ? `${level} ${heading}\n\n${rest}` : `${level} ${heading}`;
	});
	return buildCardContent(fm, `# ${title}\n\n${sections.join('\n\n')}`);
}

/** 写入文章文件并打开；返回创建的文件 */
export async function createArticleFile(
	app: App,
	ctx: CardBoxContext,
	title: string,
	content: string,
): Promise<TFile | null> {
	const folder = ctx.settings.mergeOutputFolder.trim().replace(/^\/+|\/+$/g, '');
	const fileName = sanitizeFileName(title) || toDayKey(Date.now());
	await ctx.service.ensureFolder(folder);
	let path = `${folder}/${fileName}.md`;
	// 同名文件已存在时追加时间后缀，避免创建失败
	if (app.vault.getAbstractFileByPath(path)) {
		path = `${folder}/${fileName}-${Date.now()}.md`;
	}
	try {
		const file = await app.vault.create(path, content);
		new Notice(i18n.mergedNotice(title), 2000);
		await ctx.openFile(file);
		return file;
	} catch (err) {
		new Notice(String(err));
		return null;
	}
}
