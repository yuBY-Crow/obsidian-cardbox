import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { CardBoxSettings, SortMode, ViewMode } from './types';
import { i18n } from './i18n';

export const DEFAULT_SETTINGS: CardBoxSettings = {
	cardsFolder: 'Cards',
	mergeOutputFolder: 'Cards',
	canvasOutputFolder: 'Cards',
	filenameFormat: 'title',
	defaultTags: [],
	defaultViewMode: 'card',
	defaultSort: 'created-desc',
	continuousCaptureDefault: true,
	showArchived: false,
	archiveMethod: 'flag',
	boxes: [],
	activeBoxId: '',
	masonryMinColumnWidth: 260,
	canvasLinkDepth: 1,
	canvasLinkDirection: 'both',
	canvasDrawEdges: true,
};

/** main.ts 的 CardBoxPlugin 需实现此接口，避免设置页与主模块循环依赖 */
export interface SettingAccess {
	settings: CardBoxSettings;
	saveSettings(): Promise<void>;
	onFolderChanged(): void;
}

export class CardBoxSettingTab extends PluginSettingTab {
	private tagsEl: HTMLDivElement;
	private access: SettingAccess;

	/**
	 * 必须把**真实的 Plugin 实例**传给 super：
	 * Obsidian 1.13 起PluginSettingTab 会访问 this.plugin 的真实属性
	 * （manifest 等，见 getSettingDefinitions），传伪造对象会在构造期抛异常，
	 * 表现为插件启用失败。access 只用于读写设置，与 plugin 分开传。
	 */
	constructor(app: App, plugin: Plugin, access: SettingAccess) {
		super(app, plugin);
		this.access = access;
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

		new Setting(containerEl)
			.setName(i18n.filenameFormatName)
			.setDesc(i18n.filenameFormatDesc)
			.addDropdown((dd) => {
				dd.addOption('title', i18n.filenameFormatTitle)
					.addOption('datetime', i18n.filenameFormatDatetime)
					.setValue(s.filenameFormat)
					.onChange(async (v) => {
						s.filenameFormat = v as 'datetime' | 'title';
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
			.setName(i18n.canvasDepthName)
			.setDesc(i18n.canvasDepthSettingDesc)
			.addDropdown((dd) => {
				dd.addOption('0', i18n.canvasDepth0);
				for (let n = 1; n <= 5; n++) dd.addOption(String(n), i18n.canvasDepthN(n));
				dd.setValue(String(s.canvasLinkDepth)).onChange(async (v) => {
					const n = Number(v);
					s.canvasLinkDepth = isFinite(n) && n >= 0 ? Math.floor(n) : 1;
					await this.access.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(i18n.canvasDirectionName)
			.setDesc(i18n.canvasDirectionDesc)
			.addDropdown((dd) => {
				dd.addOption('outgoing', i18n.canvasDirOutgoing)
					.addOption('incoming', i18n.canvasDirIncoming)
					.addOption('both', i18n.canvasDirBoth)
					.setValue(s.canvasLinkDirection)
					.onChange(async (v) => {
						s.canvasLinkDirection = v as 'outgoing' | 'incoming' | 'both';
						await this.access.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(i18n.canvasDrawEdgesName)
			.setDesc(i18n.canvasDrawEdgesDesc)
			.addToggle((tg) =>
				tg.setValue(s.canvasDrawEdges).onChange(async (v) => {
					s.canvasDrawEdges = v;
					await this.access.saveSettings();
				}),
			);

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
