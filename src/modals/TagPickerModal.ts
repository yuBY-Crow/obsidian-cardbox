import { App, Modal, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { CardIndex } from '../index';

/** 从已有标签中挑选一个（供筛选栏「＋标签」与批量打标签复用） */
export class TagPickerModal extends Modal {
	private onPick: (tag: string) => void;

	constructor(
		app: App,
		private index: CardIndex,
	) {
		super(app);
	}

	setOnPick(cb: (tag: string) => void): this {
		this.onPick = cb;
		return this;
	}

	onOpen(): void {
		this.setTitle(i18n.batchTag);
		const { contentEl } = this;
		contentEl.empty();

		const search = new TextComponent(contentEl);
		search.setPlaceholder(i18n.searchPlaceholder).inputEl.addClass('cardbox-modal-search');
		const listEl = contentEl.createDiv({ cls: 'cardbox-tag-picker' });
		this.render(listEl, '');

		search.onChange((q) => this.render(listEl, q));
	}

	private render(listEl: HTMLElement, query: string): void {
		listEl.empty();
		const q = query.trim().toLowerCase();
		const tags = this.index
			.allTags()
			.filter((t) => !q || t.tag.toLowerCase().includes(q))
			.sort((a, b) => b.count - a.count);

		for (const { tag, count } of tags) {
			const row = listEl.createDiv({ cls: 'cardbox-tag-row' });
			const label = row.createSpan({ cls: 'cardbox-chip' });
			label.setText(`#${tag}`);
			row.createSpan({ cls: 'cardbox-tag-count', text: String(count) });
			row.onclick = () => {
				this.onPick?.(tag);
				this.close();
			};
		}
		if (!tags.length) listEl.createEl('p', { cls: 'cardbox-muted', text: i18n.noMatch });
	}
}
