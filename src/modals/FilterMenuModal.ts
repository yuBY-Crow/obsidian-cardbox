import { App, Modal, Setting } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxSettings, CardColor, FilterState, SortMode } from '../types';
import { CARD_COLORS } from '../types';
import type { CardIndex } from '../index';
import { debounce } from '../utils/dom';

export interface FilterMenuCallbacks {
	onFilterChange: () => void;
	onAddTag: () => void;
	onSortChange: (sort: SortMode) => void;
}

const TOGGLE_DEFS: { key: keyof FilterState; label: string }[] = [
	{ key: 'hasTag', label: i18n.hasTag },
	{ key: 'noTag', label: i18n.noTag },
	{ key: 'emptyContent', label: i18n.emptyContent },
	{ key: 'hasTaskList', label: i18n.hasTask },
	{ key: 'pinnedOnly', label: i18n.pinnedOnly },
	{ key: 'showArchived', label: i18n.showArchived },
];

const SORT_OPTIONS: [SortMode, string][] = [
	['created-desc', i18n.sortCreatedDesc],
	['created-asc', i18n.sortCreatedAsc],
	['updated-desc', i18n.sortUpdatedDesc],
	['title', i18n.sortTitle],
];

/**
 * 手机端汉堡菜单：筛选面板（搜索 / 标签 / 颜色 / 快速开关 / 排序）。
 * 直接操作视图持有的同一个 FilterState，关闭后由 onFilterChange 触发重渲染。
 */
export class FilterMenuModal extends Modal {
	private sort: SortMode;
	private searchDebounced: (q: string) => void;

	constructor(
		app: App,
		private filter: FilterState,
		settings: CardBoxSettings,
		private index: CardIndex,
		private cb: FilterMenuCallbacks,
	) {
		super(app);
		this.sort = settings.defaultSort;
		this.searchDebounced = debounce((q) => {
			this.filter.query = q;
			this.cb.onFilterChange();
		}, 200);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-filter-modal');
		contentEl.createEl('h3', { text: i18n.mobileFilterTitle });

		// 搜索
		new Setting(contentEl).setName(i18n.searchPlaceholder.replace('…', '')).addText((text) => {
			text.setPlaceholder(i18n.searchPlaceholder)
				.setValue(this.filter.query)
				.onChange((v) => this.searchDebounced(v));
		});

		// 标签 chips
		const tagSetting = new Setting(contentEl).setName(i18n.tagSelected);
		const chipWrap = tagSetting.controlEl.createDiv({ cls: 'cardbox-chips cardbox-chips-wrap' });
		const renderTags = () => {
			chipWrap.empty();
			const top = this.index.allTags().slice(0, 24);
			for (const { tag } of top) {
				const chip = chipWrap.createSpan({ cls: 'cardbox-chip' });
				chip.setText(`#${tag}`);
				chip.toggleClass('is-active', this.filter.selectedTags.has(tag));
				chip.addEventListener('click', () => {
					if (this.filter.selectedTags.has(tag)) this.filter.selectedTags.delete(tag);
					else this.filter.selectedTags.add(tag);
					renderTags();
					this.cb.onFilterChange();
				});
			}
			const add = chipWrap.createSpan({ cls: 'cardbox-chip cardbox-chip-add', text: i18n.moreTags });
			add.addEventListener('click', () => this.cb.onAddTag());
		};
		renderTags();

		// 颜色
		const colorSetting = new Setting(contentEl).setName(i18n.colorLabel);
		const colorRow = colorSetting.controlEl.createDiv({ cls: 'cardbox-color-row cardbox-color-filter' });
		const renderColors = () => {
			colorRow.empty();
			for (const color of CARD_COLORS) {
				const dot = colorRow.createDiv({ cls: `cardbox-color-dot cardbox-color-${color}` });
				dot.setAttribute('aria-label', i18n.colorNames[color] ?? color);
				dot.toggleClass('is-selected', this.filter.selectedColors.has(color as CardColor));
				dot.addEventListener('click', () => {
					const c = color as CardColor;
					if (this.filter.selectedColors.has(c)) this.filter.selectedColors.delete(c);
					else this.filter.selectedColors.add(c);
					renderColors();
					this.cb.onFilterChange();
				});
			}
		};
		renderColors();

		// 快速开关
		for (const def of TOGGLE_DEFS) {
			const setting = new Setting(contentEl).setName(def.label);
			setting.addToggle((tg) =>
				tg.setValue(this.filter[def.key] as boolean).onChange((v) => {
					(this.filter[def.key] as boolean) = v;
					this.cb.onFilterChange();
				}),
			);
		}

		// 排序
		new Setting(contentEl).setName(i18n.mobileSort).addDropdown((dd) => {
			for (const [value, label] of SORT_OPTIONS) dd.addOption(value, label);
			dd.setValue(this.sort).onChange((v) => {
				this.sort = v as SortMode;
				this.cb.onSortChange(this.sort);
			});
		});

		// 重置
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('清除筛选')
				.onClick(() => {
					this.filter.query = '';
					this.filter.selectedTags.clear();
					this.filter.selectedColors.clear();
					for (const def of TOGGLE_DEFS) (this.filter[def.key] as boolean) = false;
					this.cb.onFilterChange();
					this.close();
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
