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
	onClick: (card: Card) => void;
	onLongPress: (card: Card) => void;
	onToggleExpand: (card: Card) => void;
	onKebab: (card: Card, anchor: HTMLElement) => void;
}

function firstLine(s: string): string {
	const line = s.split('\n')[0].trim();
	return line;
}

/** 构建单张卡片瓦片（列表 / 时间轴共用） */
export function buildCardTile(opts: CardTileOptions): HTMLElement {
	const { card } = opts;
	const el = createDiv({ cls: 'cardbox-tile' });
	el.setAttribute('data-card-id', card.id);
	el.style.setProperty('--depth', String(opts.depth));
	if (card.archived) el.addClass('is-archived');
	if (opts.depth > 0) el.addClass('is-child');
	if (opts.selected) el.addClass('is-selected');

	const main = el.createDiv({ cls: 'cardbox-tile-main' });

	// 子卡片展开按钮
	if (opts.hasVisibleChildren) {
		const expand = main.createEl('button', {
			cls: 'cardbox-expand-btn',
			attr: { 'aria-label': opts.expanded ? i18n.collapseChildren : i18n.expandChildren },
		});
		setIcon(expand, opts.expanded ? 'chevron-down' : 'chevron-right');
		expand.addEventListener('click', (e) => {
			e.stopPropagation();
			opts.onToggleExpand(card);
		});
	}

	// 多选勾选框（默认隐藏，.cardbox-is-selecting 时显示）
	const check = main.createDiv({ cls: 'cardbox-check' });
	if (opts.selected) check.addClass('is-checked');

	// 正文区
	const body = main.createDiv({ cls: 'cardbox-tile-body' });
	const textRow = body.createDiv({ cls: 'cardbox-tile-text' });
	const line = firstLine(card.snippet);
	const titleEl = textRow.createSpan({ cls: 'cardbox-tile-title' });
	titleEl.setText(card.title ? card.title : line || i18n.emptyContent);
	if (!card.title && !line) titleEl.addClass('is-empty');

	if (card.title && card.snippet.trim()) {
		body.createSpan({ cls: 'cardbox-tile-snippet' }).setText(card.snippet.trim());
	}

	// 状态图标
	const iconRow = textRow.createSpan({ cls: 'cardbox-tile-icons' });
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
		if ((e.target as HTMLElement).closest('button')) return;
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
	el.addEventListener('contextmenu', (e) => e.preventDefault());

	return el;
}

export function updateTileSelection(el: HTMLElement, selected: boolean): void {
	el.toggleClass('is-selected', selected);
	const check = el.querySelector('.cardbox-check');
	if (check) check.toggleClass('is-checked', selected);
}
