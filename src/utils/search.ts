import type { Card } from '../types';
import type { CardIndex } from '../index';

/** 命中类别：标题 / 正文 / 标签 */
export type MatchCategory = 'title' | 'body' | 'tag';

export interface SearchHit {
	card: Card;
	/** 该卡片命中的所有类别 */
	categories: MatchCategory[];
	excerpt?: string;
}


/** 与 CardTile 的标题回退一致，但不依赖 DOM */
export function displayTitle(card: Card): string {
	if (card.title?.trim()) return card.title.trim();
	for (const line of card.snippet.split('\n')) {
		const l = line.trim();
		if (l) return l;
	}
	return '';
}

function excerptAround(text: string, q: string): string {
	const i = text.toLowerCase().indexOf(q);
	if (i < 0) return text.slice(0, 80).replace(/\n/g, ' ');
	const start = Math.max(0, i - 20);
	const end = Math.min(text.length, i + q.length + 40);
	return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '…' : '');
}

/**
 * 全局搜索：自动匹配「标题 / 正文 / 标签」三类内容，并按类别分组返回。
 * 一张卡可能命中多类，按 title > body > tag 归入优先级最高的组，
 * categories 仍保留全部命中类别供卡片上标注。
 */
export function searchByCategory(index: CardIndex, query: string): Record<MatchCategory, SearchHit[]> {
	const q = query.trim().toLowerCase();
	const out: Record<MatchCategory, SearchHit[]> = { title: [], body: [], tag: [] };
	if (!q) return out;
	for (const card of index.all()) {
		const cats: MatchCategory[] = [];
		if (displayTitle(card).toLowerCase().includes(q)) cats.push('title');
		if (card.snippet.toLowerCase().includes(q)) cats.push('body');
		if (card.tags.some((t) => t.toLowerCase().includes(q))) cats.push('tag');
		if (!cats.length) continue;
		const hit: SearchHit = { card, categories: cats, excerpt: excerptAround(card.snippet, q) };
		// 命中几个类别就分别进入几个组，界面才能按「标题 / 正文 / 标签」分组展示
		for (const cat of cats) out[cat].push(hit);
	}
	return out;
}