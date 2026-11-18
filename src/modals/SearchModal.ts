import { App, Modal, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { Card } from '../types';
import type { CardIndex } from '../index';
import { displayTitle, searchByCategory, type MatchCategory, type SearchHit } from '../utils/search';
import { formatRelativeTime } from '../utils/format';

const SEARCH_DEBOUNCE_MS = 180;
const CAT_LABEL: Record<MatchCategory, string> = {
	title: i18n.searchCatTitle,
	body: i18n.searchCatBody,
	tag: i18n.searchCatTag,
};
const HIT_LABEL: Record<MatchCategory, string> = {
	title: i18n.hitTitle,
	body: i18n.hitBody,
	tag: i18n.hitTag,
};

export interface SearchCallbacks {
	onOpenCard: (card: Card) => void;
}

/** 独立的全局搜索界面：标题 / 正文 / 标签 三类命中分组展示，卡面风格与瀑布流一致。 */
export class SearchModal extends Modal {
	private searchTimer: number | undefined;
	private focusTimer: number | undefined;
	private resultsEl!: HTMLElement;

	constructor(app: App, private index: CardIndex, private cb: SearchCallbacks) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-search-modal');
		contentEl.createEl('h3', { text: i18n.searchTitle });

		const row = contentEl.createDiv({ cls: 'cardbox-search-input-row' });
		const input = new TextComponent(row);
		input.setPlaceholder(i18n.searchPlaceholder).onChange((v) => this.schedule(v));
		input.inputEl.addClass('cardbox-search-field');
		input.inputEl.setAttribute('type', 'search');

		this.resultsEl = contentEl.createDiv({ cls: 'cardbox-search-results' });
		this.render('');
		this.focusTimer = window.setTimeout(() => input.inputEl.focus(), 60);
	}

	onClose(): void {
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
		if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
		this.searchTimer = undefined;
		this.focusTimer = undefined;
		this.contentEl.empty();
	}

	private schedule(q: string): void {
		if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => {
			this.searchTimer = undefined;
			this.render(q);
		}, SEARCH_DEBOUNCE_MS);
	}

	private render(q: string): void {
		this.resultsEl.empty();
		if (!q.trim()) {
			this.resultsEl.createDiv({ cls: 'cardbox-search-hint', text: i18n.searchHint });
			return;
		}
		const groups = searchByCategory(this.index, q);
		const ids = new Set<string>();
		for (const cat of ['title', 'body', 'tag'] as MatchCategory[]) {
			for (const h of groups[cat]) ids.add(h.card.id);
		}
		const total = ids.size;
		this.resultsEl.createDiv({ cls: 'cardbox-search-count', text: i18n.searchCount(total, q.trim()) });
		if (!total) {
			this.resultsEl.createDiv({ cls: 'cardbox-search-hint', text: i18n.searchNoResults });
			return;
		}
		for (const cat of ['title', 'body', 'tag'] as MatchCategory[]) {
			const hits = groups[cat];
			if (!hits.length) continue;
			const section = this.resultsEl.createDiv({ cls: 'cardbox-search-group' });
			section.createDiv({ cls: 'cardbox-search-group-head', text: `${CAT_LABEL[cat]} · ${hits.length}` });
			const list = section.createDiv({ cls: 'cardbox-search-group-list' });
			for (const hit of hits) this.renderHit(list, hit);
		}
	}

	private renderHit(host: HTMLElement, hit: SearchHit): void {
		const card = hit.card;
		const tile = host.createDiv({ cls: 'cardbox-tile cardbox-search-hit' });
		const main = tile.createDiv({ cls: 'cardbox-tile-main' });
		const body = main.createDiv({ cls: 'cardbox-tile-body' });

		if (card.tags.length) {
			const tags = body.createDiv({ cls: 'cardbox-tile-tags' });
			for (const tag of card.tags.slice(0, 4)) {
				tags.createSpan({ cls: 'cardbox-chip cardbox-chip-sm', text: `#${tag}` });
			}
		}

		const textRow = body.createDiv({ cls: 'cardbox-tile-text' });
		const title = displayTitle(card);
		const timestampTitle = /^\d{4}-\d{2}-\d{2}-\d{6}/.test(title);
		if (!timestampTitle) textRow.createSpan({ cls: 'cardbox-tile-title', text: title });

		if (hit.excerpt) {
			body.createDiv({ cls: 'cardbox-tile-snippet' }).setText(hit.excerpt);
		}

		const meta = body.createDiv({ cls: 'cardbox-tile-meta' });
		for (const cat of hit.categories) {
			meta.createSpan({ cls: 'cardbox-hit-cat', text: HIT_LABEL[cat] });
		}
		meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });

		tile.addEventListener('click', () => {
			this.cb.onOpenCard(card);
			this.close();
		});
	}
}