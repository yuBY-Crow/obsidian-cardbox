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
	/** 点击盒信息行：切换卡片盒 */
	onPickBox: (anchor: HTMLElement) => void;
}

/** 由 ItemView.addAction 提供：把图标注册到 view header（与标题同一行） */
export type AddActionFn = (icon: string, title: string, cb: (evt: MouseEvent) => void) => HTMLElement;

/**
 * 手机端顶部栏。
 *
 * 两个图标不自建一行，而是通过 ItemView.addAction 注册进 Obsidian 的
 * view header——与「卡片盒」标题同一行，不再额外占用卡片预览的竖向空间。
 * - 汉堡：筛选面板（搜索 / 标签 / 颜色 / 快速开关 / 排序）
 * - 视图：点击在 列表→平铺→时间线 间循环；长按弹出三选项菜单
 *
 * 唯一保留的自建行是极窄的「盒名 · 数量」信息行（可点切换卡片盒）。
 */
export class MobileHeader {
	private mode: ViewMode;
	private sort: SortMode;
	private modeBtn!: HTMLElement;
	private infoEl?: HTMLElement;

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

	/**
	 * @param container 视图内容区，仅用于放极窄的盒信息行
	 * @param addAction ItemView.addAction，把图标放进 view header
	 */
	build(container: HTMLElement, addAction: AddActionFn): HTMLElement {
		// 视图按钮：点击循环，长按弹菜单（放在汉堡左侧，与参考图一致）
		this.modeBtn = addAction('layout-grid', i18n.mobileCycle, () => {
			const i = MODE_CYCLE.indexOf(this.mode);
			this.setMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length]);
		});
		this.modeBtn.addClass('cardbox-mode-action');
		this.updateModeIcon();
		this.bindLongPress(this.modeBtn);

		// 汉堡：筛选面板
		const filterBtn = addAction('menu', i18n.mobileFilterBtn, () => {
			new FilterMenuModal(this.app, this.filter, this.settings, this.index, {
				onFilterChange: () => this.cb.onFilterChange(),
				onAddTag: () => this.cb.onAddTag(),
				onSortChange: (sort) => {
					this.sort = sort;
					this.cb.onFilterChange();
				},
			}).open();
		});
		filterBtn.addClass('cardbox-filter-action');

		// 极窄信息行：盒名 · 卡片数，点击切换卡片盒
		const info = container.createDiv({ cls: 'cardbox-mobile-info' });
		this.infoEl = info.createDiv({ cls: 'cardbox-mobile-boxname' });
		this.infoEl.addEventListener('click', () => this.cb.onPickBox(this.infoEl as HTMLElement));
		return info;
	}

	/** 更新「盒名 · 数量」文案 */
	setInfo(boxName: string, count: number): void {
		if (this.infoEl) this.infoEl.setText(`${boxName} · ${count}`);
	}

	private bindLongPress(btn: HTMLElement): void {
		let pressTimer: number | undefined;
		const clearPress = () => {
			if (pressTimer !== undefined) {
				window.clearTimeout(pressTimer);
				pressTimer = undefined;
			}
		};
		btn.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			clearPress();
			pressTimer = window.setTimeout(() => {
				pressTimer = undefined;
				this.showModeMenu();
			}, 500);
		});
		for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
			btn.addEventListener(ev, clearPress);
		}
		btn.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			clearPress();
			this.showModeMenu();
		});
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

	/** view header里空间有限，只换图标不放文字，靠 tooltip 说明当前模式 */
	private updateModeIcon(): void {
		this.modeBtn.empty();
		const icon = this.mode === 'card' ? 'list' : this.mode === 'masonry' ? 'layout-grid' : 'clock';
		setIcon(this.modeBtn, icon);
		this.modeBtn.setAttribute('aria-label', `${i18n.mobileCycle}（${this.modeName(this.mode)}）`);
	}
}
