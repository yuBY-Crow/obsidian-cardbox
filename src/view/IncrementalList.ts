/**
 * 增量渲染列表：先渲染首屏，滚动到底部哨兵时用 DocumentFragment 分批追加。
 * 比完整虚拟滚动简单，且移动端几千张卡不卡顿。
 *
 * 支持两种排布：
 * - 普通（默认）：所有元素直接顺序追加到容器
 * - 瀑布流：容器内先建 N 个列容器，每个元素追加到「当前最短的列」，
 *   这样矮卡片下方不会留大片空白、同列上下间距恒定。
 *   （grid 做不到：行高由该行最高卡片决定；CSS columns 也不行：
 *   在固定高度的滚动容器里会横向分页。）
 */
/** 单张卡片的估算高度，仅用于一个 chunk 内的分配决策，误差在批量测量时校正 */
const ESTIMATED_ITEM_HEIGHT = 160;

export class IncrementalList<T> {
	private sentinel: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private items: T[] = [];
	private rendered = 0;
	private readonly chunk = 50;

	/** 瀑布流列数；0 表示不启用瀑布流 */
	private columnCount = 0;
	private columns: HTMLElement[] = [];
	/** 各列估算高度；chunk 批量追加后统一测量一次校正，避免逐卡 reflow */
	private columnHeights: number[] = [];
	/** 当前瀑布流下正在使用的「整行组」，整行元素之后的卡片要放进新的一组列 */
	private groupEl: HTMLElement | null = null;

	constructor(
		private container: HTMLElement,
		private renderItem: (item: T, index: number) => HTMLElement,
		/**
		 * 判断某个元素是否必须独占整行（如时间轴日期分组、展开的子卡片）。
		 * 瀑布流按列堆叠，跨列元素无法用 CSS 实现，只能由这里显式区分：
		 * 整行元素直接挂到容器，其后的卡片重新开一组列容器。
		 */
		private isFullRow: (item: T) => boolean = () => false,
	) {
		this.sentinel = container.createDiv({ cls: 'cardbox-sentinel' });
		if (typeof IntersectionObserver !== 'undefined') {
			this.observer = new IntersectionObserver((entries) => {
				if (entries.some((e) => e.isIntersecting)) this.appendNext();
			});
			this.observer.observe(this.sentinel);
		}
	}

	/**
	 * 设置瀑布流列数。传 0 关闭瀑布流（回到普通顺序追加）。
	 * 只更新列数、不重建：由调用方随后统一调用 setItems 完成重排，
	 * 避免 setColumnCount + setItems 各重建一次。
	 */
	setColumnCount(n: number): void {
		this.columnCount = Math.max(0, Math.floor(n));
	}

	getColumnCount(): number {
		return this.columnCount;
	}

	/** 渲染到指定下标（返回卡片盒时把锚点卡片之前的项补齐，才能滚到位） */
	renderUntil(index: number): void {
		while (this.rendered <= index && this.rendered < this.items.length) this.appendNext();
	}

	setItems(items: T[]): void {
		this.items = items;
		this.rendered = 0;
		this.container.empty();
		this.columns = [];
		this.columnHeights = [];
		this.groupEl = null;
		this.container.appendChild(this.sentinel);
		if (this.observer) {
			this.observer.disconnect();
			this.observer.observe(this.sentinel);
		}
		this.appendNext();
	}

	appendNext(): void {
		if (this.rendered >= this.items.length) return;
		const end = Math.min(this.rendered + this.chunk, this.items.length);

		if (this.columnCount > 1) {
			// 瀑布流：一个 chunk 内按「当前最短列 + 估算增量」把卡片分配到各列的 fragment，
			// 批量追加后统一测量一次各列真实高度；不再逐卡读 getBoundingClientRect 触发强制同步布局。
			// 续接上一 chunk 的列组时也要先备好各列 fragment。
			let frags: DocumentFragment[] = this.groupEl
				? this.columns.map(() => new DocumentFragment())
				: [];
			for (let i = this.rendered; i < end; i++) {
				const item = this.items[i];
				const el = this.renderItem(item, i);
				if (this.isFullRow(item)) {
					this.landFragments(frags);
					frags = [];
					// 整行元素：直接挂容器，并让后续卡片重新开一组列
					this.container.insertBefore(el, this.sentinel);
					el.addClass('cardbox-masonry-full');
					this.groupEl = null;
					this.columns = [];
					this.columnHeights = [];
				} else {
					if (!this.groupEl) {
						this.ensureGroup();
						frags = this.columns.map(() => new DocumentFragment());
					}
					const idx = this.shortestColumnIndex();
					frags[idx].appendChild(el);
					this.columnHeights[idx] += ESTIMATED_ITEM_HEIGHT;
				}
			}
			this.landFragments(frags);
		} else {
			const frag = new DocumentFragment();
			for (let i = this.rendered; i < end; i++) {
				frag.appendChild(this.renderItem(this.items[i], i));
			}
			this.container.insertBefore(frag, this.sentinel);
		}

		this.rendered = end;
	}

	/**
	 * 把一个 chunk 里攒下的各列 fragment 批量落地，并统一测量一次各列真实高度。
	 * 先全部写入、再全部读取：整个过程只触发一次同步布局。
	 */
	private landFragments(frags: DocumentFragment[]): void {
		if (!frags.length) return;
		for (let c = 0; c < this.columns.length; c++) {
			this.columns[c].appendChild(frags[c]);
		}
		for (let c = 0; c < this.columns.length; c++) {
			this.columnHeights[c] = this.columns[c].getBoundingClientRect().height;
		}
	}

	/** 取当前列组（没有则新建一组），列高从 0 起算 */
	private ensureGroup(): void {
		if (this.groupEl) return;
		this.groupEl = this.container.createDiv({ cls: 'cardbox-masonry-group' });
		this.container.insertBefore(this.groupEl, this.sentinel);
		this.columns = [];
		this.columnHeights = [];
		for (let i = 0; i < this.columnCount; i++) {
			this.columns.push(this.groupEl.createDiv({ cls: 'cardbox-masonry-col' }));
			this.columnHeights.push(0);
		}
	}

	/** 找当前估算高度最小的列；等高时取最左，保证阅读顺序自然 */
	private shortestColumnIndex(): number {
		let best = 0;
		let bestH = this.columnHeights[0];
		for (let i = 1; i < this.columnHeights.length; i++) {
			if (this.columnHeights[i] < bestH) {
				best = i;
				bestH = this.columnHeights[i];
			}
		}
		return best;
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
