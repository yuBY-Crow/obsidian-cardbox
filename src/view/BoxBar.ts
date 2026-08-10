import { setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxDef } from '../types';
import type { CardIndex } from '../index';

export interface BoxBarCallbacks {
	/** 切换当前卡片盒；id为空字符串表示「全部卡片」 */
	onSelect: (id: string) => void;
	/** 新建卡片盒 */
	onCreate: () => void;
	/** 编辑指定卡片盒 */
	onEdit: (def: CardBoxDef) => void;
}

/**
 * 卡片盒切换栏：横向可滑动的盒标签（含卡片数角标）+ 新建按钮。
 * 「全部卡片」恒定在最左，长按/点击齿轮进入盒设置。
 */
export class BoxBar {
	private el!: HTMLElement;
	private scrollEl!: HTMLElement;

	constructor(
		private index: CardIndex,
		private getBoxes: () => CardBoxDef[],
		private getActiveId: () => string,
		private getShowArchived: () => boolean,
		private cb: BoxBarCallbacks,
	) {}

	build(container: HTMLElement): HTMLElement {
		this.el = container.createDiv({ cls: 'cardbox-boxbar' });
		this.scrollEl = this.el.createDiv({ cls: 'cardbox-boxbar-scroll' });

		const addBtn = this.el.createEl('button', {
			cls: 'cardbox-boxbar-add',
			attr: { 'aria-label': i18n.boxNew },
		});
		setIcon(addBtn, 'plus');
		addBtn.addEventListener('click', () => this.cb.onCreate());

		this.refresh();
		return this.el;
	}

	/** 重建盒标签（盒定义或索引变化后调用） */
	refresh(): void {
		if (!this.scrollEl) return;
		this.scrollEl.empty();
		const activeId = this.getActiveId();
		const showArchived = this.getShowArchived();

		// 全部卡片
		const allTab = this.scrollEl.createDiv({ cls: 'cardbox-boxtab' });
		allTab.toggleClass('is-active', activeId === '');
		allTab.createSpan({ cls: 'cardbox-boxtab-name', text: i18n.boxAll });
		const allCount = this.index.all().filter((c) => showArchived || !c.archived).length;
		allTab.createSpan({ cls: 'cardbox-boxtab-count', text: String(allCount) });
		allTab.addEventListener('click', () => this.cb.onSelect(''));

		for (const def of this.getBoxes()) {
			const tab = this.scrollEl.createDiv({ cls: 'cardbox-boxtab' });
			const isActive = def.id === activeId;
			tab.toggleClass('is-active', isActive);
			tab.createSpan({ cls: 'cardbox-boxtab-name', text: def.name });
			tab.createSpan({
				cls: 'cardbox-boxtab-count',
				text: String(this.index.countBox(def, showArchived)),
			});
			tab.addEventListener('click', () => {
				// 已选中时再次点击进入编辑，省一个按钮
				if (isActive) this.cb.onEdit(def);
				else this.cb.onSelect(def.id);
			});
			// 长按进入编辑（移动端）
			let timer: number | undefined;
			const clear = () => {
				if (timer !== undefined) {
					window.clearTimeout(timer);
					timer = undefined;
				}
			};
			tab.addEventListener('pointerdown', () => {
				clear();
				timer = window.setTimeout(() => {
					timer = undefined;
					this.cb.onEdit(def);
				}, 500);
			});
			tab.addEventListener('pointerup', clear);
			tab.addEventListener('pointercancel', clear);
			tab.addEventListener('pointerleave', clear);
			tab.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.cb.onEdit(def);
			});
		}
	}
}
