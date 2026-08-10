import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { CardBoxSettings, SortMode, ViewMode } from './types';
import { i18n } from './i18n';

export const DEFAULT_SETTINGS: CardBoxSettings = {
	cardsFolder: 'Cards',
	mergeOutputFolder: 'Cards',
	canvasOutputFolder: 'Cards',
	filenameFormat: 'datetime',
	defaultTags: [],
	defaultViewMode: 'card',
	defaultSort: 'created-desc',
	continuousCaptureDefault: true,
	showArchived: false,
	archiveMethod: 'flag',
	boxes: [],
	activeBoxId: '',
	masonryMinColumnWidth: 260,
};

/** main.ts 的 CardBoxPlugin 需实现此接口，避免设置页与主模块循环依赖 */
export interface SettingAccess {
	settings: CardBoxSettings;
	saveSettings(): Promise<void>;
	onFolderChanged(): void;
}

export class CardBoxSettingTab extends PluginSettingTab {
	private tagsEl: HTMLDivElement;

	constructor(app: App, private access: SettingAccess) {
		super(app, access as unknown as Plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: i18n.settingsTitle });
		const s = this.access.settings;

		new Setting(containerEl)
			.setName(i18n.cardsFolderName)
			.setDesc(i18n.cardsFolderDesc)
			.addText((text) => {
				text.setPlaceholder(i18n.folderPlaceholder).setValue(s.cardsFolder).onChange(async (value) => {
					s.cardsFolder = value.trim().replace(/^\/+|\/+$/g, '');
					await this.access.saveSettings();
					this.access.onFolderChanged();
				});
			});

		new Setting(containerEl)
			.setName(i18n.mergeFolderName)
			.setDesc(i18n.mergeFolderDesc)
			.addText((text) => {
				text.setPlaceholder(i18n.folderPlaceholder).setValue(s.mergeOutputFolder).onChange(async (value) => {
					s.mergeOutputFolder = value.trim().replace(/^\/+|\/+$/g, '');
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(i18n.canvasFolderName)
			.setDesc(i18n.canvasFolderDesc)
			.addText((text) => {
				text.setPlaceholder(i18n.folderPlaceholder).setValue(s.canvasOutputFolder).onChange(async (value) => {
					s.canvasOutputFolder = value.trim().replace(/^\/+|\/+$/g, '');
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18n.defaultTagsName).addText((text) => {
			text.setPlaceholder(i18n.tagInputPlaceholder);
			text.inputEl.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				const tag = text.getValue().trim().replace(/^#/, '');
				if (!tag) return;
				s.defaultTags = [...new Set([...s.defaultTags, tag])];
				text.setValue('');
				this.renderTags();
				void this.access.saveSettings();
			});
		});
		this.tagsEl = containerEl.createDiv({ cls: 'cardbox-setting-tags' });
		this.renderTags();

		new Setting(containerEl)
			.setName(i18n.viewModeName)
			.addDropdown((dd) => {
				dd.addOption('card', i18n.cardMode)
					.addOption('masonry', i18n.masonryMode)
					.addOption('timeline', i18n.timelineMode)
					.setValue(s.defaultViewMode)
					.onChange(async (v) => {
						s.defaultViewMode = v as ViewMode;
						await this.access.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(i18n.masonryWidthName)
			.setDesc(i18n.masonryWidthDesc)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '160';
				text.setValue(String(s.masonryMinColumnWidth)).onChange(async (v) => {
					const n = Number(v);
					s.masonryMinColumnWidth = isFinite(n) && n >= 160 ? Math.floor(n) : 260;
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(i18n.sortName)
			.addDropdown((dd) => {
				dd.addOption('created-desc', i18n.sortCreatedDesc)
					.addOption('created-asc', i18n.sortCreatedAsc)
					.addOption('updated-desc', i18n.sortUpdatedDesc)
					.addOption('title', i18n.sortTitle)
					.setValue(s.defaultSort)
					.onChange(async (v) => {
						s.defaultSort = v as SortMode;
						await this.access.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(i18n.continuousName)
			.setDesc(i18n.continuousDesc)
			.addToggle((t) => {
				t.setValue(s.continuousCaptureDefault).onChange(async (v) => {
					s.continuousCaptureDefault = v;
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(i18n.showArchivedName)
			.setDesc(i18n.showArchivedDesc)
			.addToggle((t) => {
				t.setValue(s.showArchived).onChange(async (v) => {
					s.showArchived = v;
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl).setName(i18n.archiveMethodName).setDesc(i18n.archiveMethodDesc);
	}

	private renderTags(): void {
		this.tagsEl.empty();
		for (const tag of this.access.settings.defaultTags) {
			const chip = this.tagsEl.createSpan({ cls: 'cardbox-chip' });
			chip.setText(`#${tag}`);
			const remove = chip.createSpan({ cls: 'cardbox-chip-remove', text: '×' });
			remove.onclick = async () => {
				this.access.settings.defaultTags = this.access.settings.defaultTags.filter((t) => t !== tag);
				this.renderTags();
				await this.access.saveSettings();
			};
		}
	}
}
