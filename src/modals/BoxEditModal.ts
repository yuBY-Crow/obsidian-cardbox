import { App, Modal, Notice, Setting } from 'obsidian';
import { i18n } from '../i18n';
import { CARD_COLORS } from '../types';
import type { BoxTimeMode, CardBoxDef, CardColor } from '../types';
import type { CardIndex } from '../index';
import { TagPickerModal } from './TagPickerModal';

/**
 * 卡片盒编辑弹窗：设定名称与抓取条件。
 * 条件留空即不生效，因此无需强制用户填满所有字段。
 */
export class BoxEditModal extends Modal {
	private draft: CardBoxDef;
	private onSave: (def: CardBoxDef) => void | Promise<void>;
	private onDelete?: () => void | Promise<void>;
	private tagsEl!: HTMLElement;
	private keywordsEl!: HTMLElement;
	private colorsEl!: HTMLElement;
	private timeDetailEl!: HTMLElement;

	constructor(
		app: App,
		private index: CardIndex,
		def: CardBoxDef,
		opts: { onSave: (def: CardBoxDef) => void | Promise<void>; onDelete?: () => void | Promise<void> },
	) {
		super(app);
		// 深拷贝，取消时不污染原对象
		this.draft = {
			...def,
			time: { ...def.time },
			tags: [...def.tags],
			keywords: [...def.keywords],
			colors: [...def.colors],
		};
		this.onSave = opts.onSave;
		this.onDelete = opts.onDelete;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-box-modal');
		contentEl.createEl('h3', { text: i18n.boxEditTitle });

		// 名称
		new Setting(contentEl).setName(i18n.boxNameLabel).addText((t) => {
			t.setPlaceholder(i18n.boxNamePlaceholder)
				.setValue(this.draft.name)
				.onChange((v) => {
					this.draft.name = v;
				});
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					void this.save();
				}
			});
		});

		// 卡片时间
		new Setting(contentEl).setName(i18n.boxTimeLabel).addDropdown((dd) => {
			dd.addOption('any', i18n.boxTimeAny)
				.addOption('dynamic', i18n.boxTimeDynamic)
				.addOption('static', i18n.boxTimeStatic)
				.setValue(this.draft.time.mode)
				.onChange((v) => {
					this.draft.time.mode = v as BoxTimeMode;
					this.renderTimeDetail();
				});
		});
		this.timeDetailEl = contentEl.createDiv({ cls: 'cardbox-box-timedetail' });
		this.renderTimeDetail();

		// 标签
		new Setting(contentEl).setName(i18n.boxTagsLabel).addButton((b) => {
			b.setButtonText(i18n.moreTags).onClick(() => {
				new TagPickerModal(this.app, this.index)
					.setOnPick((tag) => {
						if (!this.draft.tags.includes(tag)) this.draft.tags.push(tag);
						this.renderTags();
					})
					.open();
			});
		});
		this.tagsEl = contentEl.createDiv({ cls: 'cardbox-chip-row' });
		this.renderTags();

		// 关键字
		new Setting(contentEl).setName(i18n.boxKeywordsLabel).addText((t) => {
			t.setPlaceholder(i18n.boxKeywordsPlaceholder);
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				const kw = t.getValue().trim();
				if (!kw) return;
				if (!this.draft.keywords.includes(kw)) this.draft.keywords.push(kw);
				t.setValue('');
				this.renderKeywords();
			});
		});
		this.keywordsEl = contentEl.createDiv({ cls: 'cardbox-chip-row' });
		this.renderKeywords();

		new Setting(contentEl).setName(i18n.boxKeywordMatchLabel).addDropdown((dd) => {
			dd.addOption('any', i18n.boxKeywordAny)
				.addOption('all', i18n.boxKeywordAll)
				.setValue(this.draft.keywordMatch)
				.onChange((v) => {
					this.draft.keywordMatch = v === 'all' ? 'all' : 'any';
				});
		});

		// 色彩卡片
		new Setting(contentEl).setName(i18n.boxColorsLabel);
		this.colorsEl = contentEl.createDiv({ cls: 'cardbox-color-row' });
		this.renderColors();

		// 仅置顶
		new Setting(contentEl).setName(i18n.boxPinnedOnlyLabel).addToggle((t) => {
			t.setValue(this.draft.pinnedOnly).onChange((v) => {
				this.draft.pinnedOnly = v;
			});
		});

		contentEl.createDiv({ cls: 'cardbox-box-hint', text: i18n.boxHintAllEmpty });

		// 底部按钮
		const footer = contentEl.createDiv({ cls: 'cardbox-modal-footer' });
		if (this.onDelete) {
			const del = footer.createEl('button', { cls: 'mod-warning', text: i18n.boxDelete });
			del.addEventListener('click', () => {
				void (async () => {
					await this.onDelete?.();
					this.close();
				})();
			});
		}
		const spacer = footer.createDiv();
		spacer.style.flex = '1';
		const cancel = footer.createEl('button', { text: i18n.cancel });
		cancel.addEventListener('click', () => this.close());
		const save = footer.createEl('button', { cls: 'mod-cta', text: i18n.boxSave });
		save.addEventListener('click', () => void this.save());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		const name = this.draft.name.trim();
		if (!name) {
			new Notice(i18n.boxNameRequired);
			return;
		}
		this.draft.name = name;
		await this.onSave(this.draft);
		this.close();
	}

	private renderTimeDetail(): void {
		this.timeDetailEl.empty();
		const t = this.draft.time;
		if (t.mode === 'dynamic') {
			new Setting(this.timeDetailEl).setName(i18n.boxLastDaysLabel).addText((tx) => {
				tx.inputEl.type = 'number';
				tx.inputEl.min = '1';
				tx.setValue(String(t.lastDays ?? 7)).onChange((v) => {
					const n = Number(v);
					t.lastDays = isFinite(n) && n >= 1 ? Math.floor(n) : 7;
				});
			});
		} else if (t.mode === 'static') {
			new Setting(this.timeDetailEl).setName(i18n.boxFromLabel).addText((tx) => {
				tx.inputEl.type = 'date';
				tx.setValue(t.from ?? '').onChange((v) => {
					t.from = v || undefined;
				});
			});
			new Setting(this.timeDetailEl).setName(i18n.boxToLabel).addText((tx) => {
				tx.inputEl.type = 'date';
				tx.setValue(t.to ?? '').onChange((v) => {
					t.to = v || undefined;
				});
			});
		}
	}

	private renderTags(): void {
		this.tagsEl.empty();
		if (!this.draft.tags.length) {
			this.tagsEl.createSpan({ cls: 'cardbox-box-empty-hint', text: '—' });
			return;
		}
		for (const tag of this.draft.tags) {
			const chip = this.tagsEl.createSpan({ cls: 'cardbox-chip is-active' });
			chip.setText(`#${tag}`);
			const rm = chip.createSpan({ cls: 'cardbox-chip-remove', text: '×' });
			rm.addEventListener('click', () => {
				this.draft.tags = this.draft.tags.filter((t) => t !== tag);
				this.renderTags();
			});
		}
	}

	private renderKeywords(): void {
		this.keywordsEl.empty();
		if (!this.draft.keywords.length) {
			this.keywordsEl.createSpan({ cls: 'cardbox-box-empty-hint', text: '—' });
			return;
		}
		for (const kw of this.draft.keywords) {
			const chip = this.keywordsEl.createSpan({ cls: 'cardbox-chip is-active' });
			chip.setText(kw);
			const rm = chip.createSpan({ cls: 'cardbox-chip-remove', text: '×' });
			rm.addEventListener('click', () => {
				this.draft.keywords = this.draft.keywords.filter((k) => k !== kw);
				this.renderKeywords();
			});
		}
	}

	private renderColors(): void {
		this.colorsEl.empty();
		for (const color of CARD_COLORS) {
			const dot = this.colorsEl.createDiv({ cls: `cardbox-color-dot cardbox-color-${color}` });
			dot.setAttribute('aria-label', i18n.colorNames[color] ?? color);
			dot.toggleClass('is-selected', this.draft.colors.includes(color));
			dot.addEventListener('click', () => {
				const has = this.draft.colors.includes(color);
				this.draft.colors = has
					? this.draft.colors.filter((c) => c !== color)
					: [...this.draft.colors, color as CardColor];
				this.renderColors();
			});
		}
	}
}
