import { ButtonComponent, ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, CardBoxDef, CardColor, FilterState, ViewMode } from '../types';
import { CARD_COLORS, defaultBoxDef, defaultFilterState } from '../types';
import type { CardBoxContext } from '../context';
import { buildCardTile, updateTileSelection } from './CardTile';
import { FilterBar } from './FilterBar';
import { BoxBar } from './BoxBar';
import { IncrementalList } from './IncrementalList';
import { ConfirmModal } from '../modals/ConfirmModal';
import { MergeModal } from '../modals/MergeModal';
import { TagModal } from '../modals/TagModal';
import { TagPickerModal } from '../modals/TagPickerModal';
import { BoxEditModal } from '../modals/BoxEditModal';
import { CardPickerModal } from '../modals/CardPickerModal';
import { newBoxId } from '../boxes';
import { formatDayHeader, toDayKey } from '../utils/format';

export const CARD_BOX_VIEW_TYPE = 'cardbox-main';

type RenderItem =
	| { kind: 'card'; card: Card; depth: number; expanded: boolean; hasVisibleChildren: boolean }
	| { kind: 'day'; day: number; cards: Card[] };

export class CardBoxView extends ItemView {
	static VIEW_TYPE = CARD_BOX_VIEW_TYPE;

	private ctx: CardBoxContext;
	private filter: FilterState;
	private filterBar!: FilterBar;
	private boxBar!: BoxBar;
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

		this.filterBar = new FilterBar(this.filter, this.ctx.settings, this.ctx.index, {
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
						this.filterBar.refreshTags();
						this.scheduleRender();
					})
					.open();
			},
		});
		this.filterBar.build(root);

		const actionRow = root.createDiv({ cls: 'cardbox-actionbar' });
		const newBtn = actionRow.createEl('button', { cls: 'cardbox-action-btn', attr: { 'aria-label': i18n.newCard } });
		setIcon(newBtn, 'plus');
		newBtn.addEventListener('click', () => this.ctx.openCapture());

		const selectBtn = actionRow.createEl('button', {
			cls: 'cardbox-action-btn',
			attr: { 'aria-label': i18n.toggleSelect },
		});
		setIcon(selectBtn, 'check-square');
		selectBtn.addEventListener('click', () => this.toggleSelectionMode());

		this.selectionBarEl = root.createDiv({ cls: 'cardbox-selectionbar' });

		this.placeholderEl = root.createDiv({ cls: 'cardbox-placeholder' });
		this.listEl = root.createDiv({ cls: 'cardbox-list' });
		this.list = new IncrementalList<RenderItem>(this.listEl, (item) => this.renderItem(item));

		this.ctx.index.onChanged(this.indexChangedCb);
		this.filterBar.refreshTags();
		this.scheduleRender();
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
				this.boxBar.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
		}).open();
	}

	private editBox(def: CardBoxDef): void {
		new BoxEditModal(this.app, this.ctx.index, def, {
			onSave: async (saved) => {
				await this.ctx.boxes.upsert(saved);
				this.boxBar.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
			onDelete: async () => {
				await this.ctx.boxes.remove(def.id);
				this.boxBar.refresh();
				this.renderKey = '';
				this.scheduleRender();
			},
		}).open();
	}

	// ---------- 渲染 ----------

	private scheduleRender(): void {
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = window.requestAnimationFrame(() => {
			this.raf = 0;
			this.render();
		});
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

		// 平铺模式用CSS 多列，列宽由设置决定
		this.listEl.toggleClass('is-masonry', mode === 'masonry');
		this.listEl.style.setProperty('--cardbox-col-min', `${this.ctx.settings.masonryMinColumnWidth}px`);

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
		const visit = (card: Card, depth: number) => {
			if (visited.has(card.id)) return;
			visited.add(card.id);
			const children = extIds(card)
				.map((id) => byId.get(id))
				.filter((c): c is Card => !!c);
			const isExpanded = children.length > 0 && expanded.has(card.id);
			result.push({ kind: 'card', card, depth, expanded: isExpanded, hasVisibleChildren: children.length > 0 });
			if (isExpanded) for (const child of children) visit(child, depth + 1);
		};
		for (const card of filtered) {
			const parent = card.parent ? byId.get(card.parent) : undefined;
			const parentExpanded = parent !== undefined && expanded.has(parent.id);
			if (!parent || !parentExpanded) visit(card, 0);
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

		menu.addItem((item) =>
			item
				.setTitle(i18n.sendToCanvas)
				.setIcon('layout-dashboard')
				.onClick(() => void this.ctx.sendToCanvas([card])),
		);

		if (card.children.length > 0) {
			const expanded = this.expandedIds.has(card.id);
			menu.addItem((item) =>
				item
					.setTitle(expanded ? i18n.collapseChildren : i18n.expandChildren)
					.setIcon('chevron-down')
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
		new CardPickerModal(this.app, this.ctx.index, {
			excludeIds: new Set([parent.id, ...parent.children]),
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
