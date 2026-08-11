import { ButtonComponent, ItemView, Menu, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, CardBoxDef, CardColor, FilterState, SortMode, ViewMode } from '../types';
import { CARD_COLORS, defaultBoxDef, defaultFilterState } from '../types';
import type { CardBoxContext } from '../context';
import { buildCardTile, updateTileSelection } from './CardTile';
import { FilterBar } from './FilterBar';
import { BoxBar } from './BoxBar';
import { MobileHeader } from './MobileHeader';
import { IncrementalList } from './IncrementalList';
import { ConfirmModal } from '../modals/ConfirmModal';
import { MergeModal } from '../modals/MergeModal';
import { TagModal } from '../modals/TagModal';
import { TagPickerModal } from '../modals/TagPickerModal';
import { BoxEditModal } from '../modals/BoxEditModal';
import { CardPickerModal } from '../modals/CardPickerModal';
import { newBoxId } from '../boxes';
import { formatDayHeader, toDayKey } from '../utils/format';
import { log } from '../utils/logger';

export const CARD_BOX_VIEW_TYPE = 'cardbox-main';

type RenderItem =
	| { kind: 'card'; card: Card; depth: number; expanded: boolean; hasVisibleChildren: boolean }
	| { kind: 'day'; day: number; cards: Card[] };

/**
 * 顶部栏统一接口：PC 用 FilterBar，手机用 MobileHeader。
 * 不含 build——两者构建签名不同（手机端还要拿 addAction 往 view header 注册图标），
 * 各自在 onOpen 里单独构建后再赋给这个接口。
 */
interface ViewHeader {
	getMode(): ViewMode;
	getSort(): SortMode;
	refreshTags?(): void;
}

export class CardBoxView extends ItemView {
	static VIEW_TYPE = CARD_BOX_VIEW_TYPE;

	private ctx: CardBoxContext;
	private filter: FilterState;
	private filterBar!: ViewHeader;
	private boxBar!: BoxBar;
	private mobileHeader!: MobileHeader;
	private selectionMode = false;
	private selectedIds = new Set<string>();
	private expandedIds = new Set<string>();
	private renderKey = '';
	private raf = 0;
	private list!: IncrementalList<RenderItem>;
	private listEl!: HTMLElement;
	private placeholderEl!: HTMLElement;
	private selectionBarEl!: HTMLElement;
	private content!: HTMLElement;
	private indexChangedCb = () => {
		this.boxBar?.refresh();
		this.scheduleRender();
	};
	constructor(leaf: WorkspaceLeaf, ctx: CardBoxContext) {
		super(leaf);
		this.ctx = ctx;
		this.filter = defaultFilterState(ctx.settings);
	}

	getViewType(): string {
		return CARD_BOX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return i18n.viewTitle;
	}

	getIcon(): string {
		return 'boxes';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('cardbox-root');
		this.content = root;

		// 手机端：两个图标注册进 view header（与「卡片盒」标题同一行），
		// 内容区只留极窄的「盒名 · 数量」信息行，最大化卡片预览空间。
		if (Platform.isMobile) {
			this.mobileHeader = new MobileHeader(this.app, this.filter, this.ctx.settings, this.ctx.index, {
				onFilterChange: () => {
					this.renderKey = '';
					this.scheduleRender();
				},
				onModeChange: () => {
					this.renderKey = '';
					this.scheduleRender();
				},
				onAddTag: () => {
					new TagPickerModal(this.app, this.ctx.index)
						.setOnPick((tag) => {
							this.filter.selectedTags.add(tag);
							this.scheduleRender();
						})
						.open();
				},
				onPickBox: (anchor) => this.showBoxMenu(anchor),
			});
			this.mobileHeader.build(root, (icon, title, cb) => this.addAction(icon, title, cb));
			this.filterBar = this.mobileHeader;
		} else {
			// 卡片盒切换栏
			this.boxBar = new BoxBar(
				this.ctx.index,
				() => this.ctx.boxes.list(),
				() => this.ctx.boxes.activeId(),
				() => this.filter.showArchived,
				{
					onSelect: (id) => {
						void this.ctx.boxes.setActiveId(id);
						this.boxBar.refresh();
						this.renderKey = '';
						this.scheduleRender();
					},
					onCreate: () => this.createBox(),
					onEdit: (def) => this.editBox(def),
				},
			);
			this.boxBar.build(root);

			const desktopBar = new FilterBar(this.filter, this.ctx.settings, this.ctx.index, {
				onFilterChange: () => {
					this.boxBar.refresh();
					this.scheduleRender();
				},
				onModeChange: () => {
					this.renderKey = '';
					this.scheduleRender();
				},
				onSortChange: () => {
					this.renderKey = '';
					this.scheduleRender();
				},
				onAddTag: () => {
					new TagPickerModal(this.app, this.ctx.index)
						.setOnPick((tag) => {
							this.filter.selectedTags.add(tag);
							this.filterBar.refreshTags?.();
							this.scheduleRender();
						})
						.open();
				},
			});
			desktopBar.build(root);
			this.filterBar = desktopBar;
		}

		// 手机端：新建改为右下角悬浮按钮、多选走view header 图标，
		// 不再占一整行（参考图里新建就是悬浮的）。桌面端保留原操作行。
		if (Platform.isMobile) {
			const fab = root.createEl('button', {
				cls: 'cardbox-fab',
				attr: { 'aria-label': i18n.newCard },
			});
			setIcon(fab, 'plus');
			fab.addEventListener('click', () => this.ctx.openCapture());

			const selectAction = this.addAction('check-square', i18n.toggleSelect, () => this.toggleSelectionMode());
			selectAction.addClass('cardbox-select-action');
		} else {
			const actionRow = root.createDiv({ cls: 'cardbox-actionbar' });
			const newBtn = actionRow.createEl('button', {
				cls: 'cardbox-action-btn',
				attr: { 'aria-label': i18n.newCard },
			});
			setIcon(newBtn, 'plus');
			newBtn.addEventListener('click', () => this.ctx.openCapture());

			const selectBtn = actionRow.createEl('button', {
				cls: 'cardbox-action-btn',
				attr: { 'aria-label': i18n.toggleSelect },
			});
			setIcon(selectBtn, 'check-square');
			selectBtn.addEventListener('click', () => this.toggleSelectionMode());
		}

		this.selectionBarEl = root.createDiv({ cls: 'cardbox-selectionbar' });

		this.placeholderEl = root.createDiv({ cls: 'cardbox-placeholder' });
		this.listEl = root.createDiv({ cls: 'cardbox-list' });
		this.list = new IncrementalList<RenderItem>(
			this.listEl,
			(item) => this.renderItem(item),
			// 瀑布流下必须独占整行的元素：
			// 日期分组是横跨全宽的标题；展开的子卡片要保持「主卡在上、子卡在下」的
			// 层级关系，塞进某一列会看不出父子从属
			(item) => item.kind === 'day' || (item.kind === 'card' && item.depth > 0),
		);

		this.ctx.index.onChanged(this.indexChangedCb);
		this.filterBar.refreshTags?.();
		this.scheduleRender();
	}

	/**
	 * 视图尺寸变化（窗口缩放、侧栏拖宽等）时重算瀑布流列数。
	 * 只有列数真的变了才重排——setColumnCount 内部已做相等判断。
	 */
	onResize(): void {
		if (this.filterBar?.getMode() !== 'masonry') return;
		const next = this.masonryColumns();
		if (next !== this.list.getColumnCount()) {
			this.list.setColumnCount(next);
		}
	}

	onClose(): Promise<void> {
		this.ctx.index.offChanged(this.indexChangedCb);
		this.list?.destroy();
		if (this.raf) window.cancelAnimationFrame(this.raf);
		return Promise.resolve();
	}

	// ---------- 对外操作（供命令调用） ----------

	isSelectionModeAvailable(): boolean {
		return true;
	}

	getSelectedCards(): Card[] {
		const out: Card[] = [];
		for (const id of this.selectedIds) {
			const card = this.ctx.index.getById(id);
			if (card) out.push(card);
		}
		return out;
	}

	toggleSelectionMode(): void {
		this.selectionMode = !this.selectionMode;
		if (!this.selectionMode) this.selectedIds.clear();
		this.updateSelectionUI();
	}

	mergeSelected(): void {
		const cards = this.getSelectedCards();
		if (cards.length) new MergeModal(this.app, this.ctx, cards).open();
	}

	batchTagSelected(): void {
		const cards = this.getSelectedCards();
		if (cards.length) new TagModal(this.app, this.ctx, cards).open();
	}

	archiveSelected(): void {
		this.archiveCards(this.getSelectedCards(), true);
	}

	deleteSelected(): void {
		this.deleteCards(this.getSelectedCards());
	}

	sendSelectedToCanvas(): void {
		const cards = this.getSelectedCards();
		if (cards.length) void this.ctx.sendToCanvas(cards);
	}

	// ---------- 卡片盒管理 ----------

	private activeBox(): CardBoxDef | undefined {
		const id = this.ctx.boxes.activeId();
		return id ? this.ctx.boxes.get(id) : undefined;
	}

	private createBox(): void {
		const def = defaultBoxDef(newBoxId(), '');
		new BoxEditModal(this.app, this.ctx.index, def, {
			onSave: async (saved) => {
				await this.ctx.boxes.upsert(saved);
				await this.ctx.boxes.setActiveId(saved.id);
				// 手机端没有 BoxBar，这里必须可选调用，否则会抛异常
				this.boxBar?.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
		}).open();
	}

	private editBox(def: CardBoxDef): void {
		new BoxEditModal(this.app, this.ctx.index, def, {
			onSave: async (saved) => {
				await this.ctx.boxes.upsert(saved);
				this.boxBar?.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
			onDelete: async () => {
				await this.ctx.boxes.remove(def.id);
				this.boxBar?.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
		}).open();
	}

	/** 手机端：点击「盒名 · 数量」信息行，弹出卡片盒切换菜单 */
	private showBoxMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		const activeId = this.ctx.boxes.activeId();
		menu.addItem((item) =>
			item
				.setTitle(i18n.boxAll)
				.setChecked(!activeId)
				.onClick(() => {
					void this.ctx.boxes.setActiveId('');
					this.renderKey = '';
					this.scheduleRender();
				}),
		);
		const boxes = this.ctx.boxes.list();
		if (boxes.length) menu.addSeparator();
		for (const box of boxes) {
			menu.addItem((item) =>
				item
					.setTitle(box.name || i18n.boxUnnamed)
					.setChecked(box.id === activeId)
					.onClick(() => {
						void this.ctx.boxes.setActiveId(box.id);
						this.renderKey = '';
						this.scheduleRender();
					}),
			);
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(i18n.boxNew).setIcon('plus').onClick(() => this.createBox()));
		const current = this.activeBox();
		if (current) {
			menu.addItem((item) =>
				item.setTitle(i18n.boxEdit).setIcon('pencil').onClick(() => this.editBox(current)),
			);
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	// ---------- 渲染 ----------

	private scheduleRender(): void {
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = window.requestAnimationFrame(() => {
			this.raf = 0;
			this.render();
		});
	}

	/**
	 * 瀑布流列数。
	 * 手机端固定双列（屏幕窄，再多列每张卡就没法读了）；
	 * PC 端按容器实际宽度除以设置的最小列宽，至少 1 列。
	 */
	private masonryColumns(): number {
		if (Platform.isMobile) return 2;
		const width = this.listEl.clientWidth;
		const min = Math.max(160, this.ctx.settings.masonryMinColumnWidth);
		// clientWidth 为 0 说明还没布局完（首次渲染），先给 2 列，
		// 后续 resize 会纠正
		if (!width) return 2;
		return Math.max(1, Math.floor(width / min));
	}

	private render(): void {
		if (this.ctx.index.isIndexing && !this.ctx.index.ready) {
			this.showPlaceholder(i18n.indexing);
			return;
		}
		const mode = this.filterBar.getMode();
		const sort = this.filterBar.getSort();
		const box = this.activeBox();
		const filtered = this.ctx.index.search(this.filter.query, this.filter, sort, box);

		// 手机端信息行：盒名 · 命中数量（必须在下方early return 之前更新，
		// 否则筛选到0 条时数量会停留在上一次的值）
		this.mobileHeader?.setInfo(box ? box.name || i18n.boxUnnamed : i18n.boxAll, filtered.length);

		// 平铺模式走真瀑布流：按容器宽度算列数，交给 IncrementalList 分配到最短列
		this.listEl.toggleClass('is-masonry', mode === 'masonry');
		this.listEl.style.setProperty('--cardbox-col-min', `${this.ctx.settings.masonryMinColumnWidth}px`);
		this.list.setColumnCount(mode === 'masonry' ? this.masonryColumns() : 0);

		if (filtered.length === 0) {
			const hasFilters =
				this.filter.query.trim() !== '' ||
				this.filter.selectedTags.size > 0 ||
				this.filter.selectedColors.size > 0 ||
				this.filter.hasTag ||
				this.filter.noTag ||
				this.filter.emptyContent ||
				this.filter.hasTaskList ||
				this.filter.pinnedOnly ||
				box !== undefined;
			this.showPlaceholder(hasFilters ? i18n.noMatch : i18n.empty);
			return;
		}

		this.placeholderEl.empty();
		this.placeholderEl.addClass('is-hidden');
		this.listEl.removeClass('is-hidden');

		const key =
			mode +
			'|' +
			sort +
			'|' +
			(box?.id ?? '') +
			'|' +
			this.filter.query +
			'|' +
			[...this.filter.selectedTags].sort().join(',') +
			'|' +
			[...this.filter.selectedColors].sort().join(',') +
			'|' +
			[
				this.filter.hasTag,
				this.filter.noTag,
				this.filter.emptyContent,
				this.filter.hasTaskList,
				this.filter.pinnedOnly,
				this.filter.showArchived,
			]
				.map(String)
				.join(',') +
			'|' +
			filtered.map((c) => `${c.id}:${c.color ?? ''}:${c.pinned ? 1 : 0}:${c.updated}`).join(',');
		if (key === this.renderKey) return;
		this.renderKey = key;

		const items = mode === 'timeline' ? this.buildDayItems(filtered) : this.buildCardItems(filtered);
		this.list.setItems(items);
		log.info('render', '渲染完成', { mode, cards: filtered.length, items: items.length, expandedIds: this.expandedIds.size });
		// 标题可见性检查：等布局完成后验证标题元素实际渲染状态
		// （用户反馈「卡片没有显示标题」，需要区分：提取为空 / 渲染不可见 / 正常）
		window.requestAnimationFrame(() => this.checkTileTitles());
	}

	/**
	 * 检查已渲染卡片的标题可见性，写入日志。
	 * 覆盖三种情况：
	 * - empty：标题提取结果为空占位（extractTitle 兜底失败）
	 * - hidden：标题元素存在但渲染不可见（高度 0 / display none）
	 * - ok：正常显示
	 * 前若干张抽样，避免日志刷屏；有异常时升级为 warn。
	 */
	private checkTileTitles(): void {
		try {
			const titles = [...this.listEl.querySelectorAll('.cardbox-tile-title')];
			if (titles.length === 0) return;
			const sample: { id?: string; text?: string; h: number; w: number; display: string; color: string }[] = [];
			let empty = 0;
			let hidden = 0;
			let ok = 0;
			for (const el of titles.slice(0, 12)) {
				const text = el.textContent ?? '';
				const r = el.getBoundingClientRect();
				const cs = getComputedStyle(el);
				const item = {
					id: el.closest('.cardbox-tile')?.getAttribute('data-card-id') ?? undefined,
					text: text.slice(0, 24),
					h: Math.round(r.height),
					w: Math.round(r.width),
					display: cs.display,
					color: cs.color,
				};
				sample.push(item);
				if (text === i18n.emptyContent) empty++;
				else if (r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') hidden++;
				else ok++;
			}
			if (empty > 0 || hidden > 0) {
				log.warn('title', '标题检查：存在异常', { total: titles.length, empty, hidden, ok, sample });
			} else {
				log.info('title', '标题检查：全部正常', { total: titles.length, ok, sample });
			}
		} catch (e) {
			log.error('title', '标题检查失败', e);
		}
	}

	private showPlaceholder(text: string): void {
		this.renderKey = '';
		this.listEl.addClass('is-hidden');
		this.placeholderEl.removeClass('is-hidden');
		this.placeholderEl.setText(text);
	}

	private buildCardItems(filtered: Card[]): RenderItem[] {
		const byId = new Map<string, Card>(filtered.map((c) => [c.id, c]));
		const expanded = this.expandedIds;
		const result: RenderItem[] = [];
		const visited = new Set<string>();
		// 扩展卡片 = frontmatter 显式关联 + 正文双链，与扩展视图口径一致
		const extIds = (card: Card) => this.ctx.index.extensionsOf(card).map((e) => e.card.id);
		let counted = 0;
		const visit = (card: Card, depth: number) => {
			if (visited.has(card.id)) return;
			visited.add(card.id);
			const children = extIds(card)
				.map((id) => byId.get(id))
				.filter((c): c is Card => !!c);
			const isExpanded = children.length > 0 && expanded.has(card.id);
			// 只记录前几张带子卡的，避免日志刷屏
			if (children.length > 0 && counted < 10) {
				counted++;
				log.info('render', '子卡判定', { id: card.id, extCount: children.length, isExpanded, inExpandedIds: expanded.has(card.id) });
			}
			result.push({ kind: 'card', card, depth, expanded: isExpanded, hasVisibleChildren: children.length > 0 });
			if (isExpanded) for (const child of children) visit(child, depth + 1);
		};

		/**
		 * 子卡始终显示，但位置随父卡展开状态变化：
		 * - 父卡未展开（或父卡不可见）：子卡按排序平级显示（depth 0，默认位置）
		 * - 父卡已展开：子卡不在此处平级显示，由父卡的 visit 递归带出
		 *   （depth +1，缩进 + 层级竖线，跟在父卡下方）
		 */
		for (const card of filtered) {
			const parent = card.parent ? byId.get(card.parent) : undefined;
			const parentExpanded = parent !== undefined && expanded.has(parent.id);
			// 父卡已展开 → 子卡由父卡带出，跳过平级渲染
			if (parent && parentExpanded) continue;
			visit(card, 0);
		}
		return result;
	}

	private buildDayItems(filtered: Card[]): RenderItem[] {
		const groups = new Map<number, Card[]>();
		for (const card of filtered) {
			const day = new Date(toDayKey(card.created) + 'T00:00:00').getTime();
			const arr = groups.get(day);
			if (arr) arr.push(card);
			else groups.set(day, [card]);
		}
		const days = Array.from(groups.keys()).sort((a, b) => b - a);
		return days.map((day) => ({ kind: 'day', day, cards: groups.get(day)! }));
	}

	private renderItem(item: RenderItem): HTMLElement {
		if (item.kind === 'card') return this.buildTile(item.card, item.depth, item.expanded, item.hasVisibleChildren);
		const group = createDiv({ cls: 'cardbox-day-group' });
		const header = group.createDiv({ cls: 'cardbox-day-header' });
		header.setText(formatDayHeader(item.day));
		const cards = item.cards.slice().sort((a, b) => b.created - a.created);
		for (const card of cards) group.appendChild(this.buildTile(card, 0, false, false));
		return group;
	}

	private buildTile(card: Card, depth: number, expanded: boolean, hasVisibleChildren: boolean): HTMLElement {
		const parent = card.parent ? this.ctx.index.getById(card.parent) : undefined;
		return buildCardTile({
			card,
			depth,
			// 角标含正文双链，与扩展视图口径一致
			childCount: this.ctx.index.extensionCount(card),
			selected: this.selectedIds.has(card.id),
			expanded,
			hasVisibleChildren,
			rich: this.filterBar.getMode() === 'masonry',
			parentTitle: parent ? parent.title || parent.snippet.split('\n')[0].trim() || parent.id : undefined,
			onClick: (c) => this.onTileClick(c),
			onLongPress: (c) => this.onTileLongPress(c),
			onToggleExpand: (c) => {
				if (this.expandedIds.has(c.id)) this.expandedIds.delete(c.id);
				else this.expandedIds.add(c.id);
				log.info('expand', '切换展开状态', { id: c.id, now: this.expandedIds.has(c.id) });
				this.renderKey = '';
				this.scheduleRender();
			},
			onKebab: (c, anchor) => this.showCardMenu(c, anchor),
		});
	}

	// ---------- 交互 ----------

	private onTileClick(card: Card): void {
		if (this.selectionMode) {
			this.toggleSelect(card);
		} else {
			void this.openCard(card);
		}
	}

	private onTileLongPress(card: Card): void {
		if (!this.selectionMode) {
			this.selectionMode = true;
			this.updateSelectionUI();
		}
		this.toggleSelect(card, true);
	}

	private toggleSelect(card: Card, forceSelect = false): void {
		if (forceSelect) {
			if (this.selectedIds.has(card.id)) return;
			this.selectedIds.add(card.id);
		} else if (this.selectedIds.has(card.id)) {
			this.selectedIds.delete(card.id);
		} else {
			this.selectedIds.add(card.id);
		}
		this.updateTileInDom(card.id);
		this.updateSelectionBar();
	}

	private updateTileInDom(id: string): void {
		const tile = this.listEl.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
		if (tile) updateTileSelection(tile, this.selectedIds.has(id));
	}

	private updateSelectionUI(): void {
		this.content.toggleClass('cardbox-is-selecting', this.selectionMode);
		this.selectionBarEl.toggleClass('is-visible', this.selectionMode);
		this.applySelectionToTiles();
		this.updateSelectionBar();
	}

	private applySelectionToTiles(): void {
		const tiles = this.listEl.querySelectorAll<HTMLElement>('.cardbox-tile');
		tiles.forEach((tile) => {
			const id = tile.getAttribute('data-card-id');
			if (id) updateTileSelection(tile, this.selectedIds.has(id));
		});
	}

	private updateSelectionBar(): void {
		this.selectionBarEl.empty();
		const n = this.selectedIds.size;
		this.selectionBarEl.createSpan({ cls: 'cardbox-selection-count', text: i18n.selectedCount(n) });
		const mkBtn = (label: string, icon: string, disabled: boolean, cb: () => void) => {
			const b = new ButtonComponent(this.selectionBarEl).setButtonText(label).setIcon(icon);
			if (disabled) b.setDisabled(true);
			b.onClick(cb);
		};
		mkBtn(i18n.tagSelected, 'tag', n === 0, () => this.batchTagSelected());
		mkBtn(i18n.mergeSelectedAction, 'file-text', n === 0, () => this.mergeSelected());
		mkBtn(i18n.sendToCanvas, 'layout-dashboard', n === 0, () => this.sendSelectedToCanvas());
		mkBtn(i18n.archiveSelectedAction, 'archive', n === 0, () => this.archiveSelected());
		mkBtn(i18n.deleteSelectedAction, 'trash', n === 0, () => this.deleteSelected());
		const cancel = new ButtonComponent(this.selectionBarEl).setButtonText(i18n.cancelSelect);
		cancel.onClick(() => this.toggleSelectionMode());
	}

	private async openCard(card: Card): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file instanceof TFile) await this.ctx.openFile(file);
	}

	private showCardMenu(card: Card, anchor: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(i18n.edit).setIcon('pencil').onClick(() => void this.openCard(card)));
		menu.addItem((item) =>
			item.setTitle(i18n.addChild).setIcon('file-plus').onClick(() => this.ctx.openCapture('', card)),
		);
		menu.addItem((item) =>
			item
				.setTitle(i18n.linkExisting)
				.setIcon('link')
				.onClick(() => this.linkExistingChild(card)),
		);
		menu.addItem((item) =>
			item
				.setTitle(i18n.openExtendView)
				.setIcon('git-branch')
				.onClick(() => void this.ctx.openExtendView(card.id)),
		);
		menu.addItem((item) => item.setTitle(i18n.tag).setIcon('tag').onClick(() => new TagModal(this.app, this.ctx, [card]).open()));

		// 调色盘：setSubmenu 属未公开 API，旧版Obsidian 上不存在。
		// 支持则用子菜单（紧凑），否则平铺成「眉头颜色：红」等条目，保证任何版本都能用。
		this.addColorMenuItems(menu, card);

		menu.addItem((item) =>
			item
				.setTitle(card.pinned ? i18n.unpin : i18n.pin)
				.setIcon('pin')
				.onClick(() => void this.ctx.service.setPinned([card], !card.pinned)),
		);

		// 展开/收起关联卡片，以及紧随其下的「投放到白板」——
		// 两者都是「关联关系」相关操作，放在同一层级相邻位置。
		// 判定用 extensionCount（含正文双链），与列表展开按钮口径一致。
		const relatedCount = this.ctx.index.extensionCount(card);
		if (relatedCount > 0) {
			const expanded = this.expandedIds.has(card.id);
			menu.addItem((item) =>
				item
					.setTitle(`${expanded ? i18n.collapseChildren : i18n.expandChildren}（${relatedCount}）`)
					.setIcon(expanded ? 'chevron-down' : 'chevron-right')
					.onClick(() => {
						if (expanded) this.expandedIds.delete(card.id);
						else this.expandedIds.add(card.id);
						this.renderKey = '';
						this.scheduleRender();
					}),
			);
		}

		menu.addItem((item) =>
			item
				.setTitle(i18n.sendToCanvas)
				.setIcon('layout-dashboard')
				.onClick(() => void this.ctx.sendToCanvas([card])),
		);

		menu.addItem((item) =>
			item
				.setTitle(i18n.renameByTitle)
				.setIcon('text-cursor-input')
				.onClick(() => void this.ctx.renameByTitle([card])),
		);

		menu.addItem((item) =>
			item
				.setTitle(card.archived ? i18n.unarchive : i18n.archive)
				.setIcon('archive')
				.onClick(() => this.archiveCards([card], !card.archived)),
		);
		menu.addItem((item) => item.setTitle(i18n.delete).setIcon('trash').onClick(() => this.deleteCards([card])));
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	/**
	 * 向菜单添加调色盘。
	 * Menu.addItem 的 item 上setSubmenu 是未公开 API（官方 obsidian.d.ts 无此声明），
	 * 旧版本客户端调用会抛异常导致整个菜单打不开，因此必须做能力探测并提供降级路径。
	 */
	private addColorMenuItems(menu: Menu, card: Card): void {
		const apply = (color: CardColor | null) => void this.ctx.service.setColor([card], color);

		let sub: Menu | undefined;
		menu.addItem((item) => {
			item.setTitle(i18n.colorLabel).setIcon('palette');
			const withSub = item as unknown as { setSubmenu?: () => Menu };
			if (typeof withSub.setSubmenu !== 'function') return;
			try {
				sub = withSub.setSubmenu();
			} catch {
				sub = undefined;
			}
		});

		if (sub) {
			for (const color of CARD_COLORS) {
				sub.addItem((si) =>
					si
						.setTitle(i18n.colorNames[color] ?? color)
						.setChecked(card.color === color)
						.onClick(() => apply(color as CardColor)),
				);
			}
			sub.addSeparator();
			sub.addItem((si) => si.setTitle(i18n.colorClear).onClick(() => apply(null)));
			return;
		}

		// 降级：平铺进主菜单，标题带前缀以便区分
		for (const color of CARD_COLORS) {
			const name = i18n.colorNames[color] ?? color;
			menu.addItem((si) =>
				si
					.setTitle(`${i18n.colorLabel}：${name}`)
					.setChecked(card.color === color)
					.onClick(() => apply(color as CardColor)),
			);
		}
		menu.addItem((si) => si.setTitle(i18n.colorClear).onClick(() => apply(null)));
	}

	private linkExistingChild(parent: Card): void {
		// 已是扩展卡片的（含正文双链）都排除，避免重复关联
		const existing = this.ctx.index.extensionsOf(parent).map((e) => e.card.id);
		new CardPickerModal(this.app, this.ctx.index, {
			excludeIds: new Set([parent.id, ...existing]),
			onPick: async (child) => {
				await this.ctx.service.linkChild(parent, child);
				this.expandedIds.add(parent.id);
				this.renderKey = '';
				this.scheduleRender();
			},
		}).open();
	}

	// ---------- 批量操作 ----------

	private archiveCards(cards: Card[], archived: boolean): void {
		const run = async () => {
			await this.ctx.service.setArchived(cards, archived);
			this.clearSelectionAfterBatch();
		};
		if (archived) {
			new ConfirmModal(this.app, {
				title: i18n.confirmTitle,
				message: i18n.confirmArchiveText(cards.length),
				onConfirm: run,
			}).open();
		} else {
			void run();
		}
	}

	private deleteCards(cards: Card[]): void {
		if (!cards.length) return;
		new ConfirmModal(this.app, {
			title: i18n.confirmTitle,
			message: i18n.confirmDeleteText(cards.length),
			onConfirm: async () => {
				await this.ctx.service.deleteCards(cards);
				this.clearSelectionAfterBatch();
			},
		}).open();
	}

	private clearSelectionAfterBatch(): void {
		this.selectedIds.clear();
		if (this.selectionMode) {
			this.selectionMode = false;
			this.updateSelectionUI();
		}
		// 事件驱动刷新，强制下一次重渲染
		this.renderKey = '';
		this.scheduleRender();
	}
}
