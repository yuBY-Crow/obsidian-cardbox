import { App, Menu, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxSettings, FilterState, SortMode, ViewMode } from '../types';
import type { CardIndex } from '../index';
import { FilterMenuModal } from '../modals/FilterMenuModal';

const MODE_CYCLE: ViewMode[] = ['card', 'masonry', 'timeline'];

export interface MobileHeaderCallbacks {
	onModeChange: (mode: ViewMode) => void;
	onFilterChange: () => void;
	onAddTag: () => void;
}

/**
 * 手机端顶部栏：
 * - 汉堡按钮：打开筛选面板（搜索 / 标签 / 颜色 / 快速开关 / 排序）
 * - 视图按钮：点击在 列表→平铺→时间线 间循环；长按弹出三选项菜单
 */
export class MobileHeader {
	private mode: ViewMode;
	private sort: SortMode;
	private modeBtn!: HTMLButtonElement;
	private filterBtn!: HTMLButtonElement;

	constructor(
		private app: App,
		private filter: FilterState,
		private settings: CardBoxSettings,
		private index: CardIndex,
		private cb: MobileHeaderCallbacks,
	) {
		this.mode = settings.defaultViewMode;
		this.sort = settings.defaultSort;
	}

	getMode(): ViewMode {
		return this.mode;
	}

	getSort(): SortMode {
		return this.sort;
	}

	build(container: HTMLElement): HTMLElement {
		const el = container.createDiv({ cls: 'cardbox-mobile-header' });

		// 汉堡：筛选面板
		this.filterBtn = el.createEl('button', {
			cls: 'cardbox-mobile-icon-btn',
			attr: { 'aria-label': i18n.mobileFilterBtn },
		});
		setIcon(this.filterBtn, 'menu');
		this.filterBtn.addEventListener('click', () => {
			new FilterMenuModal(this.app, this.filter, this.settings, this.index, {
				onFilterChange: () => this.cb.onFilterChange(),
				onAddTag: () => this.cb.onAddTag(),
				onSortChange: (sort) => {
					this.sort = sort;
					this.cb.onFilterChange();
				},
			}).open();
		});

		// 视图按钮：点击循环，长按弹菜单
		this.modeBtn = el.createEl('button', {
			cls: 'cardbox-mobile-icon-btn cardbox-mobile-mode-btn',
			attr: { 'aria-label': i18n.mobileCycle },
		});
		this.updateModeIcon();
		this.modeBtn.addEventListener('click', () => {
			const i = MODE_CYCLE.indexOf(this.mode);
			this.setMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length]);
		});

		let pressTimer: number | undefined;
		const clearPress = () => {
			if (pressTimer !== undefined) {
				window.clearTimeout(pressTimer);
				pressTimer = undefined;
			}
		};
		this.modeBtn.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			clearPress();
			pressTimer = window.setTimeout(() => this.showModeMenu(), 500);
		});
		this.modeBtn.addEventListener('pointerup', clearPress);
		this.modeBtn.addEventListener('pointercancel', clearPress);
		this.modeBtn.addEventListener('pointerleave', clearPress);
		this.modeBtn.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			clearPress();
			this.showModeMenu();
		});

		this.updateModeUI();
		return el;
	}

	/** 长按视图按钮：弹出三个展示方式选项 */
	private showModeMenu(): void {
		const menu = new Menu();
		const withTitle = menu as unknown as { setTitle?: (t: string) => void };
		if (typeof withTitle.setTitle === 'function') withTitle.setTitle(i18n.mobileModeTitle);
		for (const mode of MODE_CYCLE) {
			menu.addItem((item) =>
				item
					.setTitle(this.modeName(mode))
					.setChecked(mode === this.mode)
					.onClick(() => this.setMode(mode)),
			);
		}
		const rect = this.modeBtn.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private setMode(mode: ViewMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.updateModeIcon();
		this.updateModeUI();
		this.cb.onModeChange(mode);
	}

	private modeName(mode: ViewMode): string {
		switch (mode) {
			case 'card':
				return i18n.cardMode;
			case 'masonry':
				return i18n.masonryMode;
			case 'timeline':
				return i18n.timelineMode;
		}
	}

	private updateModeIcon(): void {
		this.modeBtn.empty();
		const icon =
			this.mode === 'card' ? 'list' : this.mode === 'masonry' ? 'layout-grid' : 'clock';
		setIcon(this.modeBtn, icon);
		this.modeBtn.createSpan({ text: this.modeName(this.mode) });
	}

	private updateModeUI(): void {
		this.modeBtn.toggleClass('is-active', true);
	}
}
