import { App, Modal, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { Card } from '../types';
import type { CardIndex } from '../index';
import { formatRelativeTime } from '../utils/format';

const MAX_RESULTS = 80;
/** 输入防抖（ms）：逐键全量重建列表开销大 */
const SEARCH_DEBOUNCE_MS = 200;

export interface CardPickerOptions {
	/** 不可选的卡片 id（如自身与已关联的扩展卡片） */
	excludeIds?: Set<string>;
	onPick: (card: Card) => void | Promise<void>;
}

/** 从已有卡片中挑选一张（用于「关联已有卡片」为扩展卡片） */
export class CardPickerModal extends Modal {
	private searchTimer: number | undefined;
	private focusTimer: number | undefined;

	constructor(
		app: App,
		private index: CardIndex,
		private opts: CardPickerOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(i18n.linkExisting);
		const { contentEl } = this;
		contentEl.empty();

		const search = new TextComponent(contentEl);
		search.setPlaceholder(i18n.searchPlaceholder).inputEl.addClass('cardbox-modal-search');
		const listEl = contentEl.createDiv({ cls: 'cardbox-card-picker' });
		this.render(listEl, '');
		search.onChange((q) => this.scheduleRender(listEl, q));
		this.focusTimer = window.setTimeout(() => search.inputEl.focus(), 0);
	}

	onClose(): void {
		// 关闭后取消待触发的搜索与聚焦定时器，避免回调访问已销毁的弹窗
		if (this.searchTimer !== undefined) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = undefined;
		}
		if (this.focusTimer !== undefined) {
			window.clearTimeout(this.focusTimer);
			this.focusTimer = undefined;
		}
		this.contentEl.empty();
	}

	private scheduleRender(listEl: HTMLElement, query: string): void {
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = undefined;
			this.render(listEl, query);
		}, SEARCH_DEBOUNCE_MS);
	}

	private render(listEl: HTMLElement, query: string): void {
		listEl.empty();
		const q = query.trim().toLowerCase();
		const exclude = this.opts.excludeIds ?? new Set<string>();
		const cards = this.index
			.all()
			.filter((c) => !exclude.has(c.id))
			.filter((c) => !q || c.searchText.includes(q))
			.slice(0, MAX_RESULTS);

		for (const card of cards) {
			const row = listEl.createDiv({ cls: 'cardbox-picker-row' });
			if (card.color) row.addClass(`cardbox-color-${card.color}`, 'has-color');
			const title = card.title || card.snippet.split('\n')[0].trim() || i18n.emptyContent;
			row.createDiv({ cls: 'cardbox-picker-title', text: title });
			const meta = row.createDiv({ cls: 'cardbox-picker-meta' });
			for (const tag of card.tags.slice(0, 3)) {
				meta.createSpan({ cls: 'cardbox-chip cardbox-chip-sm', text: `#${tag}` });
			}
			meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });
			row.addEventListener('click', () => {
				void this.opts.onPick(card);
				this.close();
			});
		}
		if (!cards.length) listEl.createEl('p', { cls: 'cardbox-muted', text: i18n.noMatch });
	}
}
