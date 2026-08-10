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
export class IncrementalList<T> {
	private sentinel: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private items: T[] = [];
	private rendered = 0;
	private readonly chunk = 50;

	/** 瀑布流列数；0 表示不启用瀑布流 */
	private columnCount = 0;
	private columns: HTMLElement[] = [];
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
	 * 列数变化会触发重排，所以调用方应在列数确实改变时才调用。
	 */
	setColumnCount(n: number): void {
		const next = Math.max(0, Math.floor(n));
		if (next === this.columnCount) return;
		this.columnCount = next;
		// 列数变了必须整体重排，否则新旧列混杂
		if (this.items.length) this.setItems(this.items);
	}

	getColumnCount(): number {
		return this.columnCount;
	}

	setItems(items: T[]): void {
		this.items = items;
		this.rendered = 0;
		this.container.empty();
		this.columns = [];
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
			//瀑布流：逐个追加到当前最短的列。
			// 必须逐个（而非用 fragment 批量）——每次都要读上一张的实际高度，
			// 才能算出真正最短的列。
			for (let i = this.rendered; i < end; i++) {
				const item = this.items[i];
				const el = this.renderItem(item, i);
				if (this.isFullRow(item)) {
					// 整行元素：直接挂容器，并让后续卡片重新开一组列
					this.container.insertBefore(el, this.sentinel);
					el.addClass('cardbox-masonry-full');
					this.groupEl = null;
				} else {
					this.ensureGroup().appendChild(el);
				}
			}
		} else {
			const frag = document.createDocumentFragment();
			for (let i = this.rendered; i < end; i++) {
				frag.appendChild(this.renderItem(this.items[i], i));
			}
			this.container.insertBefore(frag, this.sentinel);
		}

		this.rendered = end;
	}

	/** 取当前列组里最短的列；没有列组则新建一组 */
	private ensureGroup(): HTMLElement {
		if (!this.groupEl) {
			this.groupEl = this.container.createDiv({ cls: 'cardbox-masonry-group' });
			this.container.insertBefore(this.groupEl, this.sentinel);
			this.columns = [];
			for (let i = 0; i < this.columnCount; i++) {
				this.columns.push(this.groupEl.createDiv({ cls: 'cardbox-masonry-col' }));
			}
		}
		return this.shortestColumn();
	}

	/** 找当前内容高度最小的列；等高时取最左，保证阅读顺序自然 */
	private shortestColumn(): HTMLElement {
		let best = this.columns[0];
		let bestH = best.getBoundingClientRect().height;
		for (let i = 1; i < this.columns.length; i++) {
			const h = this.columns[i].getBoundingClientRect().height;
			if (h < bestH) {
				best = this.columns[i];
				bestH = h;
			}
		}
		return best;
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
