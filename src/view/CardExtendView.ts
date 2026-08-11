import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { Card } from '../types';
import type { CardBoxContext } from '../context';
import { CardPickerModal } from '../modals/CardPickerModal';
import { buildHierarchicalArticle, createArticleFile, type ArticleNode } from '../utils/article';
import { formatRelativeTime } from '../utils/format';

export const CARD_EXTEND_VIEW_TYPE = 'cardbox-extend';

interface ExtendState {
	rootId: string;
}

/**
 * 卡片扩展同屏视图。
 *
 * 布局：左侧固定主卡片，右侧扩展卡片纵向分支列表（移动端上下堆叠）。
 * 能力：展开看全文、点击编辑、拖拽排序、解除关联、按层级生成文章。
 * 扩展卡片自身也可以有扩展卡片，形成多层级关联。
 */
export class CardExtendView extends ItemView {
	static VIEW_TYPE = CARD_EXTEND_VIEW_TYPE;

	private ctx: CardBoxContext;
	private rootId = '';
	private expandedIds = new Set<string>();
	/** 已折叠的分区（'extensions' | 'backlinks'），重渲染后保持 */
	private collapsedSections = new Set<string>();
	private raf = 0;
	private bodyCache = new Map<string, string>();
	private indexChangedCb = () => this.scheduleRender();

	constructor(leaf: WorkspaceLeaf, ctx: CardBoxContext) {
		super(leaf);
		this.ctx = ctx;
	}

	getViewType(): string {
		return CARD_EXTEND_VIEW_TYPE;
	}

	getDisplayText(): string {
		const root = this.root();
		const name = root ? root.title || root.snippet.split('\n')[0].trim() : '';
		return name ? `${i18n.extendViewTitle}：${name}` : i18n.extendViewTitle;
	}

	getIcon(): string {
		return 'git-branch';
	}

	getState(): Record<string, unknown> {
		return { rootId: this.rootId };
	}

	async setState(state: unknown): Promise<void> {
		const s = state as Partial<ExtendState> | undefined;
		if (s && typeof s.rootId === 'string') this.rootId = s.rootId;
		this.scheduleRender();
	}

	setRoot(rootId: string): void {
		this.rootId = rootId;
		this.expandedIds.clear();
		this.bodyCache.clear();
		this.scheduleRender();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('cardbox-extend-root');
		this.ctx.index.onChanged(this.indexChangedCb);
		this.scheduleRender();
	}

	onClose(): Promise<void> {
		this.ctx.index.offChanged(this.indexChangedCb);
		if (this.raf) window.cancelAnimationFrame(this.raf);
		return Promise.resolve();
	}

	private root(): Card | undefined {
		return this.rootId ? this.ctx.index.getById(this.rootId) : undefined;
	}

	private scheduleRender(): void {
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = window.requestAnimationFrame(() => {
			this.raf = 0;
			this.render();
		});
	}

	// ---------- 渲染 ----------

	private render(): void {
		const el = this.contentEl;
		el.empty();

		const root = this.root();
		if (!root) {
			el.createDiv({ cls: 'cardbox-placeholder', text: i18n.extendNoParent });
			return;
		}

		// 顶部工具栏
		const bar = el.createDiv({ cls: 'cardbox-extend-bar' });
		const mkBtn = (label: string, icon: string, cb: () => void, cta = false) => {
			const b = bar.createEl('button', { cls: `cardbox-extend-btn${cta ? ' mod-cta' : ''}` });
			setIcon(b.createSpan({ cls: 'cardbox-extend-btn-icon' }), icon);
			b.createSpan({ text: label });
			b.addEventListener('click', cb);
			return b;
		};
		mkBtn(i18n.extendAddChild, 'file-plus', () => this.ctx.openCapture('', root));
		mkBtn(i18n.extendLink, 'link', () => this.linkExisting(root));
		mkBtn(i18n.extendGenerate, 'file-text', () => void this.generateArticle(root), true);
		mkBtn(i18n.sendToCanvas, 'layout-dashboard', () => void this.ctx.sendToCanvas(this.collectCards(root)));

		const wrap = el.createDiv({ cls: 'cardbox-extend-wrap' });

		// 主卡片
		const mainCol = wrap.createDiv({ cls: 'cardbox-extend-main' });
		mainCol.createDiv({ cls: 'cardbox-extend-label', text: i18n.extendMainCard });
		mainCol.appendChild(this.buildPanel(root, true));

		// 扩展卡片列
		const childCol = wrap.createDiv({ cls: 'cardbox-extend-children' });
		const exts = this.ctx.index.extensionsOf(root);

		// 扩展卡片分区（可整体收起）
		const extOpen = !this.collapsedSections.has('extensions');
		this.buildSectionHeader(childCol, 'extensions', i18n.extendChildren, exts.length, extOpen);
		if (extOpen) {
			if (!exts.length) {
				childCol.createDiv({ cls: 'cardbox-placeholder', text: i18n.extendEmpty });
			} else {
				childCol.createDiv({ cls: 'cardbox-extend-hint', text: i18n.extendDragHint });
				const listEl = childCol.createDiv({ cls: 'cardbox-extend-list' });
				for (const ext of exts) {
					listEl.appendChild(this.buildBranch(root, ext.card, 0, ext.source));
				}
				this.enableDragSort(listEl, root);
			}
		}

		// 反向链接区：哪些卡片引用了当前主卡（可整体收起）
		const backlinks = this.ctx.index.backlinksOf(root);
		const blSection = childCol.createDiv({ cls: 'cardbox-extend-backlinks' });
		const blOpen = !this.collapsedSections.has('backlinks');
		this.buildSectionHeader(blSection, 'backlinks', i18n.extendBacklinks, backlinks.length, blOpen);
		if (blOpen) {
			if (!backlinks.length) {
				blSection.createDiv({ cls: 'cardbox-extend-hint', text: i18n.extendBacklinkEmpty });
			} else {
				for (const bl of backlinks) {
					blSection.appendChild(this.buildBacklinkRow(root, bl));
				}
			}
		}
	}

	/**
	 * 可折叠的分区标题。整行可点击，避免只有小三角能点。
	 * 折叠状态存在 collapsedSections 里，重渲染后保持。
	 */
	private buildSectionHeader(
		parent: HTMLElement,
		key: string,
		label: string,
		count: number,
		open: boolean,
	): HTMLElement {
		const header = parent.createDiv({ cls: 'cardbox-extend-label cardbox-section-header' });
		const caret = header.createSpan({ cls: 'cardbox-section-caret' });
		setIcon(caret, open ? 'chevron-down' : 'chevron-right');
		header.createSpan({ text: label });
		header.createSpan({ cls: 'cardbox-section-count', text: String(count) });
		header.setAttribute('aria-label', open ? i18n.extendCollapseSection : i18n.extendExpandSection);
		header.addEventListener('click', () => {
			if (this.collapsedSections.has(key)) this.collapsedSections.delete(key);
			else this.collapsedSections.add(key);
			this.scheduleRender();
		});
		return header;
	}

	/** 反向链接行：点击打开，可一键设为当前主卡的扩展卡片 */
	private buildBacklinkRow(root: Card, card: Card): HTMLElement {
		const row = createDiv({ cls: 'cardbox-backlink-row' });
		if (card.color) row.addClass('has-color', `cardbox-color-${card.color}`);
		const title = card.title || card.snippet.split('\n')[0].trim() || i18n.emptyContent;
		row.createDiv({ cls: 'cardbox-backlink-title', text: title });
		const meta = row.createDiv({ cls: 'cardbox-backlink-meta' });
		meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });
		const promote = row.createEl('button', { cls: 'cardbox-backlink-btn', text: i18n.extendLinkAsChild });
		promote.addEventListener('click', (e) => {
			e.stopPropagation();
			void (async () => {
				await this.ctx.service.linkChild(root, card);
				new Notice(i18n.extendPromoted, 1500);
				this.scheduleRender();
			})();
		});
		row.addEventListener('click', () => void this.openCard(card));
		return row;
	}

	private childrenOf(card: Card): Card[] {
		return this.ctx.index.extensionsOf(card).map((e) => e.card);
	}

	/** 递归构建分支（扩展卡片也可以有自己的扩展卡片） */
	private buildBranch(parent: Card, card: Card, depth: number, source: 'explicit' | 'body' = 'explicit'): HTMLElement {
		const branch = createDiv({ cls: 'cardbox-extend-branch' });
		branch.setAttribute('data-card-id', card.id);
		branch.style.setProperty('--depth', String(depth));
		branch.appendChild(this.buildPanel(card, false, parent, source));

		const subs = this.ctx.index.extensionsOf(card);
		if (subs.length && this.expandedIds.has(card.id)) {
			const subList = branch.createDiv({ cls: 'cardbox-extend-sublist' });
			for (const sub of subs) subList.appendChild(this.buildBranch(card, sub.card, depth + 1, sub.source));
			this.enableDragSort(subList, card);
		}
		return branch;
	}

	/** 单张卡片面板：标题行（可拖拽） + 可展开全文 */
	private buildPanel(
		card: Card,
		isRoot: boolean,
		parent?: Card,
		source: 'explicit' | 'body' = 'explicit',
	): HTMLElement {
		const panel = createDiv({ cls: 'cardbox-extend-panel' });
		if (isRoot) panel.addClass('is-root');
		if (card.color) panel.addClass('has-color', `cardbox-color-${card.color}`);
		if (!isRoot && source === 'body') panel.addClass('is-from-body');
		panel.setAttribute('data-card-id', card.id);

		const head = panel.createDiv({ cls: 'cardbox-extend-head' });
		// 正文双链来源的顺序由正文决定，不能拖拽排序
		if (!isRoot && source === 'explicit') head.addClass('is-draggable');

		const subCount = this.ctx.index.extensionCount(card);

		// 展开/收起：紧邻显示关联卡片数量
		const toggleWrap = head.createDiv({ cls: 'cardbox-expand-wrap' });
		const toggle = toggleWrap.createEl('button', {
			cls: 'cardbox-extend-toggle',
			attr: { 'aria-label': i18n.extendToggleFull },
		});
		const isOpen = this.expandedIds.has(card.id);
		setIcon(toggle, isOpen ? 'chevron-down' : 'chevron-right');
		if (subCount > 0) {
			const cnt = toggleWrap.createSpan({ cls: 'cardbox-expand-count', text: String(subCount) });
			cnt.setAttribute('aria-label', i18n.relatedCount(subCount));
		}
		toggleWrap.addEventListener('click', (e) => {
			e.stopPropagation();
			if (isOpen) this.expandedIds.delete(card.id);
			else this.expandedIds.add(card.id);
			this.scheduleRender();
		});

		const titleWrap = head.createDiv({ cls: 'cardbox-extend-titlewrap' });
		const title = card.title || card.snippet.split('\n')[0].trim() || i18n.emptyContent;
		titleWrap.createDiv({ cls: 'cardbox-extend-title', text: title });
		const meta = titleWrap.createDiv({ cls: 'cardbox-extend-meta' });
		for (const tag of card.tags.slice(0, 3)) {
			meta.createSpan({ cls: 'cardbox-chip cardbox-chip-sm', text: `#${tag}` });
		}
		meta.createSpan({ cls: 'cardbox-tile-time', text: formatRelativeTime(card.created) });
		// 关联数量已在展开按钮旁显示，此处不重复
		// 来源标识：区分显式关联与正文双链
		if (!isRoot) {
			meta.createSpan({
				cls: `cardbox-source-badge is-${source}`,
				text: source === 'body' ? i18n.extendSourceBody : i18n.extendSourceExplicit,
			});
		}

		// kebab（与卡片列表一致，统一竖三点）
		const more = head.createEl('button', { cls: 'cardbox-more-btn', attr: { 'aria-label': i18n.more } });
		setIcon(more, 'more-vertical');
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showPanelMenu(card, more, parent, source);
		});

		// 展开区：全文（点击进入编辑）
		if (isOpen) {
			const bodyEl = panel.createDiv({ cls: 'cardbox-extend-body' });
			bodyEl.setText(this.bodyCache.get(card.id) ?? '…');
			if (!this.bodyCache.has(card.id)) {
				void this.ctx.service.readBody(card).then((body) => {
					this.bodyCache.set(card.id, body.trim());
					bodyEl.setText(body.trim());
				});
			}
			bodyEl.addEventListener('click', () => void this.openCard(card));
		}

		return panel;
	}

	private showPanelMenu(
		card: Card,
		anchor: HTMLElement,
		parent?: Card,
		source: 'explicit' | 'body' = 'explicit',
	): void {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(i18n.edit).setIcon('pencil').onClick(() => void this.openCard(card)));
		menu.addItem((i) =>
			i.setTitle(i18n.extendAddChild).setIcon('file-plus').onClick(() => this.ctx.openCapture('', card)),
		);
		menu.addItem((i) => i.setTitle(i18n.extendLink).setIcon('link').onClick(() => this.linkExisting(card)));

		if (parent) {
			if (source === 'body') {
				// 正文双链无法从 frontmatter 解除，只能提示或「固定」为显式关联
				menu.addItem((i) =>
					i
						.setTitle(i18n.extendPromoteBody)
						.setIcon('pin')
						.onClick(() => {
							void (async () => {
								await this.ctx.service.linkChild(parent, card);
								new Notice(i18n.extendPromoted, 1500);
								this.scheduleRender();
							})();
						}),
				);
				menu.addItem((i) => i.setTitle(i18n.extendUnlinkBodyHint).setIcon('info').setDisabled(true));
			} else {
				menu.addItem((i) =>
					i
						.setTitle(i18n.extendUnlink)
						.setIcon('unlink')
						.onClick(() => {
							void (async () => {
								await this.ctx.service.unlinkChild(parent, card);
								new Notice(i18n.extendUnlinked, 1500);
								this.scheduleRender();
							})();
						}),
				);
				// 把关联同时写进正文，便于在阅读视图直接点击跳转
				menu.addItem((i) =>
					i
						.setTitle(i18n.extendInsertLink)
						.setIcon('square-pen')
						.onClick(() => {
							void (async () => {
								const ok = await this.ctx.service.appendBodyLink(parent, card.id);
								if (ok) new Notice(i18n.extendLinkInserted, 1500);
								this.bodyCache.delete(parent.id);
								this.scheduleRender();
							})();
						}),
				);
			}
		}

		menu.addItem((i) =>
			i
				.setTitle(i18n.openExtendView)
				.setIcon('git-branch')
				.onClick(() => this.setRoot(card.id)),
		);

		// 展开/收起关联卡片，紧随其下是「投放到白板」——同层级相邻，便于连续操作
		const relatedCount = this.ctx.index.extensionCount(card);
		if (relatedCount > 0) {
			const isOpen = this.expandedIds.has(card.id);
			menu.addItem((i) =>
				i
					.setTitle(`${isOpen ? i18n.collapseChildren : i18n.expandChildren}（${relatedCount}）`)
					.setIcon(isOpen ? 'chevron-down' : 'chevron-right')
					.onClick(() => {
						if (isOpen) this.expandedIds.delete(card.id);
						else this.expandedIds.add(card.id);
						this.scheduleRender();
					}),
			);
		}

		menu.addItem((i) =>
			i
				.setTitle(i18n.sendToCanvas)
				.setIcon('layout-dashboard')
				.onClick(() => void this.ctx.sendToCanvas([card])),
		);

		menu.addItem((i) =>
			i
				.setTitle(i18n.renameByTitle)
				.setIcon('text-cursor-input')
				.onClick(() => void this.ctx.renameByTitle([card])),
		);

		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private async openCard(card: Card): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(card.path);
		if (file instanceof TFile) await this.ctx.openFile(file);
	}

	private linkExisting(parent: Card): void {
		const existing = this.ctx.index.extensionsOf(parent).map((e) => e.card.id);
		new CardPickerModal(this.app, this.ctx.index, {
			excludeIds: new Set([parent.id, ...existing]),
			onPick: async (child) => {
				await this.ctx.service.linkChild(parent, child);
				this.scheduleRender();
			},
		}).open();
	}

	// ---------- 拖拽排序 ----------

	/**
	 * 指针拖拽排序：拖动标题行时，按指针位置与各兄弟节点中线比较，
	 * 实时插入占位，松手后把新顺序写回父卡片 frontmatter。
	 * 用Pointer Events 以同时支持鼠标与触屏。
	 */
	private enableDragSort(listEl: HTMLElement, parent: Card): void {
		const items = Array.from(listEl.children) as HTMLElement[];
		for (const item of items) {
			const handle = item.querySelector<HTMLElement>('.cardbox-extend-head.is-draggable');
			if (!handle) continue;

			let dragging = false;
			let startY = 0;
			let pointerId = -1;

			const onMove = (e: PointerEvent) => {
				if (!dragging) {
					if (Math.abs(e.clientY - startY) < 8) return;
					dragging = true;
					item.addClass('is-dragging');
					listEl.addClass('is-sorting');
				}
				e.preventDefault();
				const siblings = (Array.from(listEl.children) as HTMLElement[]).filter((c) => c !== item);
				let placed = false;
				for (const sib of siblings) {
					const rect = sib.getBoundingClientRect();
					if (e.clientY < rect.top + rect.height / 2) {
						listEl.insertBefore(item, sib);
						placed = true;
						break;
					}
				}
				if (!placed) listEl.appendChild(item);
			};

			const onUp = () => {
				handle.releasePointerCapture?.(pointerId);
				handle.removeEventListener('pointermove', onMove);
				handle.removeEventListener('pointerup', onUp);
				handle.removeEventListener('pointercancel', onUp);
				if (!dragging) return;
				dragging = false;
				item.removeClass('is-dragging');
				listEl.removeClass('is-sorting');
				const domOrder = (Array.from(listEl.children) as HTMLElement[])
					.map((c) => c.getAttribute('data-card-id'))
					.filter((id): id is string => !!id);
				// 只把「显式关联」的 id 写回 children：
				// 正文双链的顺序由正文决定，写进 children 会把它变成显式关联。
				const explicit = new Set(parent.children);
				const order = domOrder.filter((id) => explicit.has(id));
				void (async () => {
					await this.ctx.service.reorderChildren(parent, order);
					new Notice(i18n.extendReordered, 1200);
				})();
			};

			handle.addEventListener('pointerdown', (e) => {
				if ((e.target as HTMLElement).closest('button')) return;
				if (e.pointerType === 'mouse' && e.button !== 0) return;
				pointerId = e.pointerId;
				startY = e.clientY;
				handle.setPointerCapture?.(pointerId);
				handle.addEventListener('pointermove', onMove);
				handle.addEventListener('pointerup', onUp);
				handle.addEventListener('pointercancel', onUp);
			});
		}
	}

	// ---------- 生成文章 ----------

	/** 深度优先收集主卡片及其所有层级的扩展卡片 */
	private collectCards(root: Card): Card[] {
		const out: Card[] = [];
		const seen = new Set<string>();
		const walk = (card: Card) => {
			if (seen.has(card.id)) return;
			seen.add(card.id);
			out.push(card);
			for (const child of this.childrenOf(card)) walk(child);
		};
		walk(root);
		return out;
	}

	private async generateArticle(root: Card): Promise<void> {
		const nodes: ArticleNode[] = [];
		const seen = new Set<string>();
		const walk = async (card: Card, depth: number) => {
			if (seen.has(card.id)) return;
			seen.add(card.id);
			const body = await this.ctx.service.readBody(card);
			nodes.push({ card, depth, body });
			for (const child of this.childrenOf(card)) await walk(child, depth + 1);
		};
		await walk(root, 0);

		const title = root.title || root.snippet.split('\n')[0].trim().slice(0, 40) || i18n.extendViewTitle;
		// 主卡片作为文章标题，其余按层级生成标题
		const content = buildHierarchicalArticle(title, nodes.slice(1));
		await createArticleFile(this.app, this.ctx, title, content);
	}
}
