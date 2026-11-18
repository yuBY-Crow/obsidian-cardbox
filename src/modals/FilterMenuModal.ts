import { App, Modal, TextComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxSettings, CardColor, FilterState, SortMode } from '../types';
import { CARD_COLORS } from '../types';
import type { CardIndex } from '../index';

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

/** 标签模糊搜索最多展示的 chip 数 */
const MAX_TAG_CHIPS = 60;

/**
 * 独立的筛选面板：标签（全库模糊搜索）/ 颜色 / 快捷开关 / 排序 / 重置。
 * 全局搜索已拆到 SearchModal，这里不再有搜索框，也不改 filter.query。
 * 视觉与瀑布流卡片一致（白卡片 + 圆角 + 细边框 + 轻投影）。
 */
export class FilterMenuModal extends Modal {
	private sort: SortMode;
	private tagQuery = '';
	private chipWrap!: HTMLElement;

	constructor(
		app: App,
		private filter: FilterState,
		settings: CardBoxSettings,
		private index: CardIndex,
		private cb: FilterMenuCallbacks,
		currentSort?: SortMode,
	) {
		super(app);
		this.sort = currentSort ?? settings.defaultSort;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-filter-modal');
		contentEl.createEl('h3', { text: i18n.filterTitle });

		// 标签：可在全库标签中模糊搜索
		const tagCard = contentEl.createDiv({ cls: 'cardbox-filter-card' });
		tagCard.createEl('h4', { text: i18n.filterGroupTags });
		const tagSearch = new TextComponent(tagCard);
		tagSearch.setPlaceholder(i18n.tagSearchPlaceholder).onChange((v) => {
			this.tagQuery = v;
			this.renderTags();
		});
		tagSearch.inputEl.addClass('cardbox-tag-search-field');
		this.chipWrap = tagCard.createDiv({ cls: 'cardbox-chips cardbox-chips-wrap' });
		this.renderTags();

		// 颜色
		const colorCard = contentEl.createDiv({ cls: 'cardbox-filter-card' });
		colorCard.createEl('h4', { text: i18n.filterGroupColors });
		const colorRow = colorCard.createDiv({ cls: 'cardbox-color-row cardbox-color-filter' });
		this.renderColors(colorRow);

		// 快捷开关
		const quickCard = contentEl.createDiv({ cls: 'cardbox-filter-card' });
		quickCard.createEl('h4', { text: i18n.filterGroupQuick });
		for (const def of TOGGLE_DEFS) {
			const row = quickCard.createDiv({ cls: 'cardbox-filter-toggle' });
			const label = row.createSpan({ text: def.label });
			const toggle = row.createEl('input', { type: 'checkbox' });
			toggle.checked = this.filter[def.key] as boolean;
			toggle.addEventListener('change', () => {
				(this.filter[def.key] as boolean) = toggle.checked;
				this.cb.onFilterChange();
			});
			label.addEventListener('click', () => {
				toggle.checked = !toggle.checked;
				toggle.dispatchEvent(new Event('change'));
			});
		}

		// 排序
		const sortCard = contentEl.createDiv({ cls: 'cardbox-filter-card' });
		sortCard.createEl('h4', { text: i18n.filterGroupSort });
		const select = sortCard.createEl('select');
		select.addClass('dropdown');
		for (const [value, text] of SORT_OPTIONS) {
			const opt = select.createEl('option', { text, value });
			if (value === this.sort) opt.selected = true;
			select.appendChild(opt);
		}
		select.addEventListener('change', () => {
			this.sort = select.value as SortMode;
			this.cb.onSortChange(this.sort);
		});

		// 重置
		const clear = contentEl.createEl('button', { cls: 'mod-cta', text: i18n.clearFilters });
		clear.addEventListener('click', () => {
			this.filter.selectedTags.clear();
			this.filter.selectedColors.clear();
			for (const def of TOGGLE_DEFS) (this.filter[def.key] as boolean) = false;
			this.cb.onFilterChange();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderTags(): void {
		this.chipWrap.empty();
		const q = this.tagQuery.trim().toLowerCase();
		const all = this.index.allTags().filter(({ tag }) => !q || tag.toLowerCase().includes(q));
		if (!all.length) {
			this.chipWrap.createSpan({ cls: 'cardbox-chip', text: i18n.tagSearchEmpty });
			return;
		}
		for (const { tag } of all.slice(0, MAX_TAG_CHIPS)) {
			const chip = this.chipWrap.createSpan({ cls: 'cardbox-chip' });
			chip.setText(`#${tag}`);
			chip.toggleClass('is-active', this.filter.selectedTags.has(tag));
			chip.addEventListener('click', () => {
				if (this.filter.selectedTags.has(tag)) this.filter.selectedTags.delete(tag);
				else this.filter.selectedTags.add(tag);
				this.renderTags();
				this.cb.onFilterChange();
			});
		}
		const add = this.chipWrap.createSpan({ cls: 'cardbox-chip cardbox-chip-add', text: i18n.moreTags });
		add.addEventListener('click', () => this.cb.onAddTag());
	}

	private renderColors(host: HTMLElement): void {
		host.empty();
		for (const color of CARD_COLORS) {
			const dot = host.createDiv({ cls: `cardbox-color-dot cardbox-color-${color}` });
			dot.setAttribute('aria-label', i18n.colorNames[color] ?? color);
			dot.toggleClass('is-selected', this.filter.selectedColors.has(color as CardColor));
			dot.addEventListener('click', () => {
				const c = color as CardColor;
				if (this.filter.selectedColors.has(c)) this.filter.selectedColors.delete(c);
				else this.filter.selectedColors.add(c);
				this.renderColors(host);
				this.cb.onFilterChange();
			});
		}
	}
}