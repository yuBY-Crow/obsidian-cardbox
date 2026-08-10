import { setIcon } from 'obsidian';
import type { Card } from '../types';
import { i18n } from '../i18n';
import { formatRelativeTime } from '../utils/format';

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

	// 展开按钮：紧随其后显示关联卡片数量，一眼能看出有多少关联
	if (opts.hasVisibleChildren) {
		const expandWrap = main.createDiv({ cls: 'cardbox-expand-wrap' });
		const expand = expandWrap.createEl('button', {
			cls: 'cardbox-expand-btn',
			attr: { 'aria-label': opts.expanded ? i18n.collapseChildren : i18n.expandChildren },
		});
		setIcon(expand, opts.expanded ? 'chevron-down' : 'chevron-right');
		if (childCount > 0) {
			const cnt = expandWrap.createSpan({ cls: 'cardbox-expand-count', text: String(childCount) });
			cnt.setAttribute('aria-label', i18n.relatedCount(childCount));
		}
		// 数字也可点击展开，扩大触摸目标
		expandWrap.addEventListener('click', (e) => {
			e.stopPropagation();
			opts.onToggleExpand(card);
		});
	}

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
	const line = firstLine(card.snippet);
	const titleEl = textRow.createSpan({ cls: 'cardbox-tile-title' });
	titleEl.setText(card.title ? card.title : line || i18n.emptyContent);
	if (!card.title && !line) titleEl.addClass('is-empty');

	// 平铺模式显示更多正文；列表模式仅在有独立标题时显示摘要
	if (opts.rich) {
		const rest = card.title ? card.snippet.trim() : card.snippet.trim().slice(line.length).trim();
		if (rest) body.createDiv({ cls: 'cardbox-tile-snippet' }).setText(rest);
	} else if (card.title && card.snippet.trim()) {
		body.createSpan({ cls: 'cardbox-tile-snippet' }).setText(card.snippet.trim());
	}

	// 状态图标
	const iconRow = textRow.createSpan({ cls: 'cardbox-tile-icons' });
	if (card.pinned) {
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

	// meta 行：标签 + 时间
	const meta = body.createDiv({ cls: 'cardbox-tile-meta' });
	for (const tag of card.tags.slice(0, 4)) {
		meta.createSpan({ cls: 'cardbox-chip cardbox-chip-sm', text: `#${tag}` });
	}
	meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });

	// 有关联但当前不可展开（例如关联卡片被筛选条件挡住）时，
	// 仍在 meta 行显示数量；可展开时数量已在展开按钮旁，不再重复显示。
	if (childCount > 0 && !opts.hasVisibleChildren) {
		const badge = meta.createSpan({ cls: 'cardbox-child-badge', text: String(childCount) });
		badge.setAttribute('aria-label', i18n.relatedCount(childCount));
	}

	// kebab 菜单按钮
	const more = main.createEl('button', {
		cls: 'cardbox-more-btn',
		attr: { 'aria-label': i18n.more },
	});
	setIcon(more, 'more-horizontal');
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
		// 按钮与「展开按钮区域」都不启动长按：
		// 展开区域包含数字与留白，手机触摸手指稍停就可能超过 500ms 触发长按进入多选，
		// 表现就是「点收起按钮没反应」（其实误触发了多选）。PC 鼠标点击快所以几乎不触发，
		// 这是两端表现差异的根源之一。
		if ((e.target as HTMLElement).closest('button, .cardbox-expand-wrap')) return;
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
