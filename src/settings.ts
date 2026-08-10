import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { CardBoxSettings, SortMode, ViewMode } from './types';
import { PROPERTY_PRESETS } from './types';
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
	canvasBidirectionalColor: '5',
	defaultProperties: {},
	writeTimestampFields: false,
};

/** main.ts 的 CardBoxPlugin 需实现此接口，避免设置页与主模块循环依赖 */
export interface SettingAccess {
	settings: CardBoxSettings;
	saveSettings(): Promise<void>;
	onFolderChanged(): void;
}

export class CardBoxSettingTab extends PluginSettingTab {
	private tagsEl: HTMLDivElement;
	private propsEl!: HTMLDivElement;
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

		// ---------- 新建卡片属性预设 ----------
		new Setting(containerEl)
			.setName(i18n.defaultPropertiesName)
			.setDesc(i18n.defaultPropertiesDesc)
			.addButton((btn) =>
				btn.setButtonText(i18n.addPropertyPreset).onClick(() => {
					const keys = Object.keys(s.defaultProperties);
					const unused = PROPERTY_PRESETS.filter((p) => !keys.includes(p.key));
					if (!unused.length) {
						// 全用过了就再加一个自由输入项
						s.defaultProperties[`prop_${Date.now()}`] = '';
						void this.access.saveSettings();
						this.renderProperties();
						return;
					}
					// 简化：逐个把未使用的预设项加入
					for (const p of unused.slice(0, 1)) s.defaultProperties[p.key] = p.value;
					void this.access.saveSettings();
					this.renderProperties();
				}),
			);
		this.propsEl = containerEl.createDiv({ cls: 'cardbox-props-list' });
		this.renderProperties();

		new Setting(containerEl)
			.setName(i18n.writeTimestampsName)
			.setDesc(i18n.writeTimestampsDesc)
			.addToggle((tg) =>
				tg.setValue(s.writeTimestampFields).onChange(async (v) => {
					s.writeTimestampFields = v;
					await this.access.saveSettings();
				}),
			);

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
			.setName(i18n.canvasBidirectionalName)
			.setDesc(i18n.canvasBidirectionalDesc)
			.addDropdown((dd) => {
				const colors: [string, string][] = [
					['1', i18n.canvasColorRed],
					['2', i18n.canvasColorOrange],
					['3', i18n.canvasColorYellow],
					['4', i18n.canvasColorGreen],
					['5', i18n.canvasColorBlue],
					['6', i18n.canvasColorPurple],
				];
				for (const [value, label] of colors) dd.addOption(value, label);
				dd.setValue(s.canvasBidirectionalColor).onChange(async (v) => {
					s.canvasBidirectionalColor = v;
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

	/** 渲染新建卡片属性预设列表（每行 key + value + 删除） */
	private renderProperties(): void {
		const s = this.access.settings;
		this.propsEl.empty();
		for (const [key, value] of Object.entries(s.defaultProperties)) {
			const row = this.propsEl.createDiv({ cls: 'cardbox-prop-row' });
			const keyInput = row.createEl('input', {
				cls: 'cardbox-prop-key',
				attr: { placeholder: i18n.propertyKeyPlaceholder, value: key },
			});
			const valueInput = row.createEl('input', {
				cls: 'cardbox-prop-value',
				attr: { placeholder: i18n.propertyValuePlaceholder, value },
			});
			keyInput.addEventListener('change', async () => {
				const newKey = keyInput.value.trim();
				if (!newKey || newKey === key) {
					keyInput.value = key;
					return;
				}
				delete s.defaultProperties[key];
				s.defaultProperties[newKey] = valueInput.value;
				await this.access.saveSettings();
				this.renderProperties();
			});
			valueInput.addEventListener('change', async () => {
				s.defaultProperties[key] = valueInput.value;
				await this.access.saveSettings();
			});
			const remove = row.createEl('button', { cls: 'cardbox-prop-remove', text: '×' });
			remove.addEventListener('click', async () => {
				delete s.defaultProperties[key];
				await this.access.saveSettings();
				this.renderProperties();
			});
		}
	}
}
