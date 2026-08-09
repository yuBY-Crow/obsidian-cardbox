import { ButtonComponent, ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, FilterState, ViewMode } from '../types';
import { defaultFilterState } from '../types';
import type { CardBoxContext } from '../context';
import { buildCardTile, updateTileSelection } from './CardTile';
import { FilterBar } from './FilterBar';
import { IncrementalList } from './IncrementalList';
import { ConfirmModal } from '../modals/ConfirmModal';
import { MergeModal } from '../modals/MergeModal';
import { TagModal } from '../modals/TagModal';
import { TagPickerModal } from '../modals/TagPickerModal';
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
	private indexChangedCb = () => this.scheduleRender();

	constructor(
		leaf: WorkspaceLeaf,
		ctx: CardBoxContext,
	) {
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

		this.filterBar = new FilterBar(
			this.filter,
			this.ctx.settings,
			this.ctx.index,
			{
				onFilterChange: () => this.scheduleRender(),
				onModeChange: () => this.scheduleRender(),
				onSortChange: () => this.scheduleRender(),
				onAddTag: () => {
					new TagPickerModal(this.app, this.ctx.index)
						.setOnPick((tag) => {
							this.filter.selectedTags.add(tag);
							this.filterBar.refreshTags();
							this.scheduleRender();
						})
						.open();
				},
			},
		);
		this.filterBar.build(root);

		const actionRow = root.createDiv({ cls: 'cardbox-actionbar' });
		const newBtn = actionRow.createEl('button', { cls: 'cardbox-action-btn', attr: { 'aria-label': i18n.newCard } });
		setIcon(newBtn, 'plus');
		newBtn.addEventListener('click', () => this.ctx.openCapture());

		const selectBtn = actionRow.createEl('button', { cls: 'cardbox-action-btn', attr: { 'aria-label': i18n.toggleSelect } });
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
		const filtered = this.ctx.index.search(this.filter.query, this.filter, sort);

		if (filtered.length === 0) {
			const hasFilters =
				this.filter.query.trim() !== '' ||
				this.filter.selectedTags.size > 0 ||
				this.filter.hasTag ||
				this.filter.noTag ||
				this.filter.emptyContent ||
				this.filter.hasTaskList;
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
			this.filter.query +
			'|' +
			[...this.filter.selectedTags].sort().join(',') +
			'|' +
			[this.filter.hasTag, this.filter.noTag, this.filter.emptyContent, this.filter.hasTaskList, this.filter.showArchived]
				.map(String)
				.join(',') +
			'|' +
			filtered.map((c) => c.id).join(',');
		if (key === this.renderKey) return;
		this.renderKey = key;

		const items = mode === 'card' ? this.buildCardItems(filtered) : this.buildDayItems(filtered);
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
		const visit = (card: Card, depth: number) => {
			if (visited.has(card.id)) return;
			visited.add(card.id);
			const children = card.children.map((id) => byId.get(id)).filter((c): c is Card => !!c);
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
		return buildCardTile({
			card,
			depth,
			selected: this.selectedIds.has(card.id),
			expanded,
			hasVisibleChildren,
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
			item.setTitle(i18n.tag).setIcon('tag').onClick(() => new TagModal(this.app, this.ctx, [card]).open()),
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
		menu.addItem((item) =>
			item.setTitle(i18n.delete).setIcon('trash').onClick(() => this.deleteCards([card])),
		);
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
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
