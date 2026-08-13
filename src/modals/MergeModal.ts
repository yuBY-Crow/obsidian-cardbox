import { App, ButtonComponent, DropdownComponent, Modal, Notice, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card, MergeMode } from '../types';
import { buildCardContent } from '../frontmatter';
import { sanitizeFileName, toDayKey } from '../utils/format';

/** 将选中卡片合并生成一篇新文章 */
export class MergeModal extends Modal {
	private mode: MergeMode = 'simple';

	constructor(
		app: App,
		private ctx: CardBoxContext,
		private cards: Card[],
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(i18n.mergeTitle);
		const { contentEl } = this;
		contentEl.empty();

		const titleInput = new TextComponent(contentEl);
		titleInput.setPlaceholder(i18n.articleTitlePlaceholder).setValue(`卡片合集 ${toDayKey(Date.now())}`);
		titleInput.inputEl.addClass('cardbox-modal-search');
		titleInput.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.merge(titleInput.getValue());
			}
		});

		const modeRow = contentEl.createDiv({ cls: 'cardbox-setting-row' });
		modeRow.createSpan({ cls: 'cardbox-muted', text: i18n.mergeModeLabel });
		new DropdownComponent(modeRow)
			.addOption('simple', i18n.mergeModeSimple)
			.addOption('headings', i18n.mergeModeHeadings)
			.setValue(this.mode)
			.onChange((v) => {
				this.mode = v as MergeMode;
			});

		contentEl.createEl('p', { cls: 'cardbox-muted', text: i18n.selectedCount(this.cards.length) });

		const actions = contentEl.createDiv({ cls: 'cardbox-modal-actions' });
		new ButtonComponent(actions).setButtonText(i18n.cancel).onClick(() => this.close());
		new ButtonComponent(actions)
			.setButtonText(i18n.mergeButton)
			.setCta()
			.onClick(() => void this.merge(titleInput.getValue()));
	}

	private async merge(rawTitle: string): Promise<void> {
		const title = rawTitle.trim() || `卡片合集 ${toDayKey(Date.now())}`;
		const bodies = await Promise.all(this.cards.map((c) => this.ctx.service.readBody(c)));
		const content = this.buildArticle(title, bodies);

		const folder = this.ctx.settings.mergeOutputFolder.trim().replace(/^\/+|\/+$/g, '');
		const fileName = sanitizeFileName(title) || toDayKey(Date.now());
		const path = `${folder}/${fileName}.md`;

		try {
			await this.ctx.service.ensureFolder(folder);
			const file = await this.app.vault.create(path, content);
			new Notice(i18n.mergedNotice(title), 2000);
			await this.ctx.openFile(file);
			this.close();
		} catch (err) {
			new Notice(String(err));
		}
	}

	private buildArticle(title: string, bodies: string[]): string {
		const fm: Record<string, unknown> = {
			created: Date.now(),
			source: 'cardbox-merge',
			sourceCards: this.cards.map((c) => c.id),
		};
		let body: string;
		if (this.mode === 'headings') {
			body = this.cards
				.map((card, i) => `## ${i + 1}. ${card.title ?? '卡片片段'}\n\n${bodies[i].trim()}`)
				.join('\n\n');
		} else {
			body = this.cards
				.map((card, i) => `> 📎 来源卡片：[[${card.id}]]\n\n${bodies[i].trim()}`)
				.join('\n\n---\n\n');
		}
		return `${buildCardContent(fm, `# ${title}\n\n${body}`)}`;
	}
}
