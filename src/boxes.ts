import type { Card, CardBoxDef, CardColor } from './types';
import { generateId } from './utils/format';
import { toDayKey } from './utils/format';

/**
 * 卡片盒抓取引擎。
 *
 * 设计要点（对齐 Writeathon「先有标签，后有卡片盒」的逻辑）：
 * - 卡片盒不持有卡片，只持有「条件」；卡片自动落入满足条件的所有盒子，
 *   因此同一张卡片可以同时出现在多个盒子里。
 * - 各类条件之间是「与」关系，但留空的条件不参与判定。
 * - 标签支持嵌套前缀匹配：条件 `读书` 命中 `读书/笔记`。
 * - 关键字匹配 searchText（标题 + 标签 + 正文），因此行内标签 `#写作心得`
 *   也能被关键字「写作」命中。
 */

/** 生成新卡片盒 id */
export function newBoxId(): string {
	return `box-${generateId()}`;
}

/** 解析 YYYY-MM-DD 为当天 00:00 的本地时间戳；非法返回 undefined */
function parseDayStart(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
	if (!m) return undefined;
	const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
	return isFinite(ts) ? ts : undefined;
}

/** 解析 YYYY-MM-DD 为当天 23:59:59.999 的本地时间戳 */
function parseDayEnd(s: string | undefined): number | undefined {
	const start = parseDayStart(s);
	return start === undefined ? undefined : start + 86400000 - 1;
}

/** 计算卡片盒的时间窗口 [from, to]；边界为 undefined 表示该侧不限 */
export function resolveTimeWindow(
	def: CardBoxDef,
	now: number = Date.now(),
): { from?: number; to?: number } {
	const t = def.time;
	if (t.mode === 'dynamic') {
		const days = Math.max(1, Math.floor(t.lastDays ?? 7));
		// 「最近 N 天」含今天：从 (今天-(N-1)) 的 00:00 开始
		const todayStart = parseDayStart(toDayKey(now)) ?? now;
		return { from: todayStart - (days - 1) * 86400000 };
	}
	if (t.mode === 'static') {
		return { from: parseDayStart(t.from), to: parseDayEnd(t.to) };
	}
	return {};
}

function matchesTags(card: Card, tags: string[]): boolean {
	if (!tags.length) return true;
	return tags.some((sel) => card.tags.some((t) => t === sel || t.startsWith(sel + '/')));
}

function matchesKeywords(card: Card, keywords: string[], mode: 'any' | 'all'): boolean {
	const kws = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
	if (!kws.length) return true;
	return mode === 'all'
		? kws.every((k) => card.searchText.includes(k))
		: kws.some((k) => card.searchText.includes(k));
}

function matchesColors(card: Card, colors: CardColor[]): boolean {
	if (!colors.length) return true;
	return card.color !== undefined && colors.includes(card.color);
}

/** 单张卡片是否落入指定卡片盒 */
export function cardMatchesBox(card: Card, def: CardBoxDef, now: number = Date.now()): boolean {
	if (def.pinnedOnly && !card.pinned) return false;
	const { from, to } = resolveTimeWindow(def, now);
	if (from !== undefined && card.created < from) return false;
	if (to !== undefined && card.created > to) return false;
	if (!matchesTags(card, def.tags)) return false;
	if (!matchesKeywords(card, def.keywords, def.keywordMatch)) return false;
	if (!matchesColors(card, def.colors)) return false;
	return true;
}

/** 抓取落入卡片盒的全部卡片 */
export function collectBoxCards(cards: Card[], def: CardBoxDef, now: number = Date.now()): Card[] {
	return cards.filter((c) => cardMatchesBox(c, def, now));
}

/** 卡片盒条件摘要，用于 UI 提示（无条件时返回「全部卡片」） */
export function describeBox(def: CardBoxDef): string {
	const parts: string[] = [];
	const t = def.time;
	if (t.mode === 'dynamic') parts.push(`最近 ${Math.max(1, Math.floor(t.lastDays ?? 7))} 天`);
	else if (t.mode === 'static') {
		const from = t.from?.trim();
		const to = t.to?.trim();
		if (from && to) parts.push(`${from} ~ ${to}`);
		else if (from) parts.push(`${from} 起`);
		else if (to) parts.push(`截至 ${to}`);
	}
	if (def.tags.length) parts.push(def.tags.map((t2) => `#${t2}`).join(' '));
	if (def.keywords.length) parts.push(`关键字 ${def.keywords.join(def.keywordMatch === 'all' ? ' + ' : ' / ')}`);
	if (def.colors.length) parts.push(`${def.colors.length} 种颜色`);
	if (def.pinnedOnly) parts.push('仅置顶');
	return parts.length ? parts.join('・') : '无条件（全部卡片）';
}
