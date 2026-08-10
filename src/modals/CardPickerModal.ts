import { App, Modal, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { Card } from '../types';
import type { CardIndex } from '../index';
import { formatRelativeTime } from '../utils/format';

const MAX_RESULTS = 80;

export interface CardPickerOptions {
	/** 不可选的卡片 id（如自身与已关联的扩展卡片） */
	excludeIds?: Set<string>;
	onPick: (card: Card) => void | Promise<void>;
}

/** 从已有卡片中挑选一张（用于「关联已有卡片」为扩展卡片） */
export class CardPickerModal extends Modal {
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
		search.onChange((q) => this.render(listEl, q));
		window.setTimeout(() => search.inputEl.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
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
