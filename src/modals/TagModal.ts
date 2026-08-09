import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';
import { normalizeTag } from '../utils/format';

/** 为选中卡片批量追加标签（支持嵌套标签 a/b/c） */
export class TagModal extends Modal {
	constructor(
		app: App,
		private ctx: CardBoxContext,
		private cards: Card[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(i18n.tagTitle);
		const { contentEl } = this;
		contentEl.empty();

		const input = new TextComponent(contentEl);
		input.setPlaceholder(i18n.tagPlaceholder).inputEl.addClass('cardbox-modal-search');
		input.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.apply(input.getValue());
			}
		});

		const existing = contentEl.createEl('p', { cls: 'cardbox-muted', text: i18n.existingTags });
		const chipRow = contentEl.createDiv({ cls: 'cardbox-chips' });
		for (const { tag } of this.ctx.index.allTags()) {
			const chip = chipRow.createSpan({ cls: 'cardbox-chip' });
			chip.setText(`#${tag}`);
			chip.onclick = () => void this.apply(tag);
		}
		if (!chipRow.children.length) existing.detach();

		const actions = contentEl.createDiv({ cls: 'cardbox-modal-actions' });
		new ButtonComponent(actions).setButtonText(i18n.cancel).onClick(() => this.close());
		new ButtonComponent(actions)
			.setButtonText(i18n.apply)
			.setCta()
			.onClick(() => void this.apply(input.getValue()));

		input.inputEl.focus();
	}

	private async apply(raw: string): Promise<void> {
		const tag = normalizeTag(raw);
		if (!tag) {
			new Notice(i18n.emptyCaptureHint, 1500);
			return;
		}
		await this.ctx.service.setTags(this.cards, [tag]);
		this.ctx.index.refreshPaths(this.cards.map((c) => c.path));
		new Notice(i18n.tagApplied(this.cards.length, tag), 2000);
		this.close();
	}
}
