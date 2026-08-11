import { setIcon } from 'obsidian';
import type { Card } from '../types';
import { i18n } from '../i18n';
import { formatRelativeTime } from '../utils/format';
import { setKebabIcon } from '../utils/icon';

const HOLD_MS = 500;

export interface CardTileOptions {
	card: Card;
	depth: number;
	selected: boolean;
	expanded: boolean;
	hasVisibleChildren: boolean;
	/** 平铺模式下显示更多正文 */
	rich?: boolean;
	/** 扩展卡片数量（用于左下角红点角标） */
	childCount?: number;
	/** 主卡片标题（扩展卡片显示指向主卡的箭头） */
	parentTitle?: string;
	onClick: (card: Card) => void;
	onLongPress: (card: Card) => void;
	onToggleExpand: (card: Card) => void;
	onKebab: (card: Card, anchor: HTMLElement) => void;
}

function firstLine(s: string): string {
	return s.split('\n')[0].trim();
}

/**
 * 从 markdown 文本提取纯文本作为卡片标题。
 *
 * 用户手机实机上「卡片没有显示标题」的根因：测试库与真实 vault 的差异——
 * 大多数卡片没有 frontmatter title 字段，fallback 到正文首行。
 * 但 markdown 笔记的正文首行经常是 `# 标题` 或 `> 引用`，前缀符号被
 * 用户当成「没有显示标题」的一部分。
 * 抽取时去掉常见 markdown 前缀，保留纯文本。
 */
function extractTitle(card: { title?: string; snippet: string }): string {
	if (card.title && card.title.trim()) return card.title.trim();
	const raw = firstLine(card.snippet);
	if (!raw) return i18n.emptyContent;
	// 顺序很重要：先剥成对行内 markdown，再处理首部块级前缀。
	// 不能先贪吃首部 `*`，否则会把成对 `**粗体**` 的第一个 `**` 吃掉，
	// 留下孤立的 `**`（这种孤立字符无法用 `\*\*(.+?)\*\*` 匹配）。
	let s = raw;
	s = s.replace(/\*\*(.+?)\*\*/g, '$1');
	s = s.replace(/\*(.+?)\*/g, '$1');
	s = s.replace(/`([^`]+)`/g, '$1');
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
	// 首部块级 markdown：# 标题、> 引用、- 列表、1. 有序列表；`(?=\s|$)` 让孤立
	// 的 `#`（如「#\n正文」的错位）也能识别为块级符号
	s = s.replace(/^\s*(?:#{1,6}(?=\s|$)|>\s|[-*+]\s|\d+\.\s)/, '');
	const cleaned = s.trim();
	// 剥光后无任何文字字符（仅有标点）→ 视作空标题
	if (!cleaned || !/\S/.test(cleaned)) return i18n.emptyContent;
	return cleaned;
}

/** 构建单张卡片瓦片（列表 / 平铺 / 时间轴共用） */
export function buildCardTile(opts: CardTileOptions): HTMLElement {
	const { card } = opts;
	const el = createDiv({ cls: 'cardbox-tile' });
	el.setAttribute('data-card-id', card.id);
	el.style.setProperty('--depth', String(opts.depth));
	if (card.archived) el.addClass('is-archived');
	if (opts.depth > 0) el.addClass('is-child');
	if (opts.selected) el.addClass('is-selected');
	if (opts.rich) el.addClass('is-rich');
	if (card.pinned) el.addClass('is-pinned');
	// 注意：addClass 底层是 classList.add，不接受含空格的字符串，多个类名必须分开传参
	if (card.color) el.addClass('has-color', `cardbox-color-${card.color}`);

	// 眉头颜色条
	if (card.color) el.createDiv({ cls: 'cardbox-tile-colorbar' });

	const main = el.createDiv({ cls: 'cardbox-tile-main' });

	// 关联卡片数量（含正文双链引用）
	const childCount = opts.childCount ?? card.children.length;

	/**
	 * 展开数字（无 chevron 按钮）。
	 * 数字本身就是交互入口：点击展开（数字变主题色），再点收起（恢复默认色）。
	 * 列表模式放卡片最左侧，平铺模式放 meta 行与时间同行。
	 */
	const buildExpandCount = (host: HTMLElement): HTMLElement | null => {
		if (!opts.hasVisibleChildren || childCount <= 0) return null;
		const cnt = host.createSpan({ cls: 'cardbox-expand-count', text: String(childCount) });
		cnt.setAttribute('aria-label', i18n.relatedCount(childCount));
		if (opts.expanded) cnt.addClass('is-expanded');
		cnt.addEventListener('click', (e) => {
			e.stopPropagation();
			opts.onToggleExpand(card);
		});
		return cnt;
	};

	if (!opts.rich) buildExpandCount(main);

	// 多选勾选框（默认隐藏，.cardbox-is-selecting 时显示）
	const check = main.createDiv({ cls: 'cardbox-check' });
	if (opts.selected) check.addClass('is-checked');

	// 正文区
	const body = main.createDiv({ cls: 'cardbox-tile-body' });

	// 扩展卡片：标题下方显示指向主卡的箭头
	if (opts.parentTitle) {
		body.createDiv({ cls: 'cardbox-tile-parent', text: i18n.extendParentArrow(opts.parentTitle) });
	}

	const textRow = body.createDiv({ cls: 'cardbox-tile-text' });
	const titleEl = textRow.createSpan({ cls: 'cardbox-tile-title' });
	titleEl.setText(extractTitle(card));
	if (titleEl.textContent === i18n.emptyContent) titleEl.addClass('is-empty');

	// 平铺模式显示更多正文；列表模式仅在有独立标题时显示摘要
	if (opts.rich) {
		// 有 frontmatter title → snippet 全文作正文
		// 无 frontmatter title → 跳过首行（首行已作为标题）
		const rest = card.title ? card.snippet.trim() : card.snippet.trim().slice(firstLine(card.snippet).length).trim();
		if (rest) body.createDiv({ cls: 'cardbox-tile-snippet' }).setText(rest);
	} else if (card.title && card.snippet.trim()) {
		body.createSpan({ cls: 'cardbox-tile-snippet' }).setText(card.snippet.trim());
	}

	// 状态图标
	const iconRow = textRow.createSpan({ cls: 'cardbox-tile-icons' });
	// 平铺模式不显示图钉：卡片本身已有置顶高亮边框，图标只会挤占窄卡片的标题宽度
	if (card.pinned && !opts.rich) {
		const ic = iconRow.createSpan({ cls: 'cardbox-tile-icon is-pin' });
		setIcon(ic, 'pin');
		ic.setAttribute('aria-label', i18n.pin);
	}
	if (card.hasTaskList) {
		const ic = iconRow.createSpan({ cls: 'cardbox-tile-icon' });
		setIcon(ic, 'list-checks');
		ic.setAttribute('aria-label', i18n.taskIndicator);
	}
	if (card.archived) {
		const ic = iconRow.createSpan({ cls: 'cardbox-tile-icon' });
		setIcon(ic, 'archive');
		ic.setAttribute('aria-label', i18n.archivedIndicator);
	}

	// 平铺模式：展开数字放 meta 行与时间同行（不再单独占一行）
	// meta 行：标签 + 展开数字 + 时间
	const meta = body.createDiv({ cls: 'cardbox-tile-meta' });
	for (const tag of card.tags.slice(0, 4)) {
		meta.createSpan({ cls: 'cardbox-chip cardbox-chip-sm', text: `#${tag}` });
	}
	if (opts.rich) buildExpandCount(meta);
	meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });

	// 有关联但当前不可展开（例如关联卡片被筛选条件挡住）时，
	// 仍在 meta 行显示数量；可展开时数量已在展开按钮旁，不再重复显示。
	if (childCount > 0 && !opts.hasVisibleChildren) {
		const badge = meta.createSpan({ cls: 'cardbox-child-badge', text: String(childCount) });
		badge.setAttribute('aria-label', i18n.relatedCount(childCount));
	}

	// kebab 菜单按钮：统一竖三点，用探测版（图标名在各版本里不同，缺失会渲染成空点）
	const more = main.createEl('button', {
		cls: 'cardbox-more-btn',
		attr: { 'aria-label': i18n.more },
	});
	setKebabIcon(more);
	more.addEventListener('click', (e) => {
		e.stopPropagation();
		opts.onKebab(card, more);
	});

	// 点击：主区域
	main.addEventListener('click', (e) => {
		e.stopPropagation();
		if ((e.target as HTMLElement).closest('button')) return;
		opts.onClick(card);
	});

	// 长按：进入多选
	let pressed = false;
	let pressTimer: number | undefined;
	let startX = 0;
	let startY = 0;
	const clearPress = () => {
		pressed = false;
		if (pressTimer !== undefined) {
			window.clearTimeout(pressTimer);
			pressTimer = undefined;
		}
	};
	el.addEventListener('pointerdown', (e) => {
		// 按钮与「展开数字」都不启动长按：
		// 手机触摸手指稍停就可能超过 500ms 触发长按进入多选，
		// 表现就是「点数字没反应」（其实误触发了多选）。
		if ((e.target as HTMLElement).closest('button, .cardbox-expand-count')) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pressed = true;
		startX = e.clientX;
		startY = e.clientY;
		pressTimer = window.setTimeout(() => {
			pressTimer = undefined;
			if (pressed) {
				pressed = false;
				opts.onLongPress(card);
			}
		}, HOLD_MS);
	});
	el.addEventListener('pointermove', (e) => {
		if (!pressed) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (dx * dx + dy * dy > 100) clearPress();
	});
	el.addEventListener('pointerup', clearPress);
	el.addEventListener('pointercancel', clearPress);
	el.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		opts.onKebab(card, more);
	});

	return el;
}

export function updateTileSelection(el: HTMLElement, selected: boolean): void {
	el.toggleClass('is-selected', selected);
	const check = el.querySelector('.cardbox-check');
	if (check) check.toggleClass('is-checked', selected);
}
