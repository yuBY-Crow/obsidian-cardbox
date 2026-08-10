import { i18n } from '../i18n';
import type { CardIndex } from '../index';
import type { CardBoxSettings, CardColor, FilterState, SortMode, ViewMode } from '../types';
import { CARD_COLORS } from '../types';
import { debounce } from '../utils/dom';

export interface FilterBarCallbacks {
	onFilterChange: () => void;
	onModeChange: (mode: ViewMode) => void;
	onSortChange: (sort: SortMode) => void;
	onAddTag: () => void;
}

const TOGGLE_DEFS: { key: keyof FilterState; label: string }[] = [
	{ key: 'hasTag', label: i18n.hasTag },
	{ key: 'noTag', label: i18n.noTag },
	{ key: 'emptyContent', label: i18n.emptyContent },
	{ key: 'hasTaskList', label: i18n.hasTask },
	{ key: 'pinnedOnly', label: i18n.pinnedOnly },
	{ key: 'showArchived', label: i18n.showArchived },
];

/** 顶部筛选栏：模式切换 + 搜索 + 标签 chips + 颜色 + 快速开关 + 排序 */
export class FilterBar {
	private filter: FilterState;
	private mode: ViewMode;
	private sort: SortMode;
	private chipsRow!: HTMLElement;
	private colorRow!: HTMLElement;
	private modeBtns = new Map<ViewMode, HTMLButtonElement>();
	private toggleEls = new Map<keyof FilterState, HTMLElement>();
	private searchInput!: HTMLInputElement;
	private searchDebounced: (q: string) => void;

	constructor(
		filter: FilterState,
		private settings: CardBoxSettings,
		private index: CardIndex,
		private cb: FilterBarCallbacks,
	) {
		this.filter = filter;
		this.mode = settings.defaultViewMode;
		this.sort = settings.defaultSort;
		this.searchDebounced = debounce((q) => {
			this.filter.query = q;
			this.cb.onFilterChange();
		}, 200);
	}

	getMode(): ViewMode {
		return this.mode;
	}

	getSort(): SortMode {
		return this.sort;
	}

	build(container: HTMLElement): HTMLElement {
		const el = container.createDiv({ cls: 'cardbox-filterbar' });

		// 模式切换：列表 / 平铺 / 时间线
		const modeRow = el.createDiv({ cls: 'cardbox-mode-toggle' });
		const mkModeBtn = (mode: ViewMode, label: string) => {
			const btn = modeRow.createEl('button', { cls: 'cardbox-mode-btn', text: label });
			btn.addEventListener('click', () => {
				if (this.mode === mode) return;
				this.mode = mode;
				this.updateModeUI();
				this.cb.onModeChange(mode);
			});
			this.modeBtns.set(mode, btn);
		};
		mkModeBtn('card', i18n.cardMode);
		mkModeBtn('masonry', i18n.masonryMode);
		mkModeBtn('timeline', i18n.timelineMode);

		// 搜索
		const searchRow = el.createDiv({ cls: 'cardbox-search-row' });
		this.searchInput = searchRow.createEl('input', {
			cls: 'cardbox-search-input',
			attr: { type: 'search', placeholder: i18n.searchPlaceholder },
		});
		this.searchInput.addEventListener('input', () => this.searchDebounced(this.searchInput.value));
		const clearBtn = searchRow.createEl('button', { cls: 'cardbox-search-clear', attr: { 'aria-label': '×' } });
		clearBtn.setText('×');
		clearBtn.addEventListener('click', () => {
			this.searchInput.value = '';
			this.searchDebounced('');
		});

		// 标签 chips（横滑）
		const scroll = el.createDiv({ cls: 'cardbox-chips-scroll' });
		this.chipsRow = scroll.createDiv({ cls: 'cardbox-chips' });

		// 颜色筛选
		this.colorRow = el.createDiv({ cls: 'cardbox-color-row cardbox-color-filter' });
		this.renderColors();

		// 快速开关
		const toggles = el.createDiv({ cls: 'cardbox-toggles' });
		for (const def of TOGGLE_DEFS) {
			const pill = toggles.createEl('button', { cls: 'cardbox-pill', text: def.label });
			pill.addEventListener('click', () => {
				(this.filter[def.key] as boolean) = !this.filter[def.key];
				this.updateToggleUI();
				this.cb.onFilterChange();
			});
			this.toggleEls.set(def.key, pill);
		}

		// 排序
		const sortRow = el.createDiv({ cls: 'cardbox-sortrow' });
		const select = sortRow.createEl('select', { cls: 'dropdown cardbox-sort-select' });
		const sortOptions: [SortMode, string][] = [
			['created-desc', i18n.sortCreatedDesc],
			['created-asc', i18n.sortCreatedAsc],
			['updated-desc', i18n.sortUpdatedDesc],
			['title', i18n.sortTitle],
		];
		for (const [value, label] of sortOptions) {
			const opt = select.createEl('option', { text: label });
			opt.value = value;
		}
		select.value = this.sort;
		select.addEventListener('change', () => {
			this.sort = select.value as SortMode;
			this.cb.onSortChange(this.sort);
		});

		this.updateModeUI();
		this.updateToggleUI();
		this.refreshTags();
		return el;
	}

	/** 索引变化后刷新标签 chips（保留选中状态，不重建整个筛选栏，避免搜索框失焦） */
	refreshTags(): void {
		if (!this.chipsRow) return;
		this.chipsRow.empty();
		const top = this.index.allTags().slice(0, 24);
		for (const { tag, count } of top) {
			const chip = this.chipsRow.createSpan({ cls: 'cardbox-chip' });
			chip.setText(`#${tag} ${count}`);
			chip.toggleClass('is-active', this.filter.selectedTags.has(tag));
			chip.addEventListener('click', () => {
				if (this.filter.selectedTags.has(tag)) this.filter.selectedTags.delete(tag);
				else this.filter.selectedTags.add(tag);
				this.refreshTags();
				this.cb.onFilterChange();
			});
		}
		const add = this.chipsRow.createSpan({ cls: 'cardbox-chip cardbox-chip-add', text: i18n.moreTags });
		add.addEventListener('click', () => this.cb.onAddTag());
	}

	private renderColors(): void {
		this.colorRow.empty();
		for (const color of CARD_COLORS) {
			const dot = this.colorRow.createDiv({ cls: `cardbox-color-dot cardbox-color-${color}` });
			dot.setAttribute('aria-label', i18n.colorNames[color] ?? color);
			dot.toggleClass('is-selected', this.filter.selectedColors.has(color as CardColor));
			dot.addEventListener('click', () => {
				const c = color as CardColor;
				if (this.filter.selectedColors.has(c)) this.filter.selectedColors.delete(c);
				else this.filter.selectedColors.add(c);
				this.renderColors();
				this.cb.onFilterChange();
			});
		}
	}

	private updateModeUI(): void {
		for (const [mode, btn] of this.modeBtns) btn.toggleClass('is-active', this.mode === mode);
	}

	private updateToggleUI(): void {
		for (const [key, el] of this.toggleEls) el.toggleClass('is-active', this.filter[key] as boolean);
	}
}
