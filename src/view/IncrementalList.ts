/**
 * 增量渲染列表：先渲染首屏，滚动到底部哨兵时用 DocumentFragment 分批追加。
 * 比完整虚拟滚动简单，且移动端几千张卡不卡顿。
 */
export class IncrementalList<T> {
	private sentinel: HTMLElement;
	private observer: IntersectionObserver | null = null;
	private items: T[] = [];
	private rendered = 0;
	private readonly chunk = 50;

	constructor(
		private container: HTMLElement,
		private renderItem: (item: T, index: number) => HTMLElement,
	) {
		this.sentinel = container.createDiv({ cls: 'cardbox-sentinel' });
		if (typeof IntersectionObserver !== 'undefined') {
			this.observer = new IntersectionObserver((entries) => {
				if (entries.some((e) => e.isIntersecting)) this.appendNext();
			});
			this.observer.observe(this.sentinel);
		}
	}

	setItems(items: T[]): void {
		this.items = items;
		this.rendered = 0;
		this.container.empty();
		this.container.appendChild(this.sentinel);
		if (this.observer) {
			this.observer.disconnect();
			this.observer.observe(this.sentinel);
		}
		this.appendNext();
	}

	appendNext(): void {
		if (this.rendered >= this.items.length) return;
		const frag = document.createDocumentFragment();
		const end = Math.min(this.rendered + this.chunk, this.items.length);
		for (let i = this.rendered; i < end; i++) {
			frag.appendChild(this.renderItem(this.items[i], i));
		}
		this.rendered = end;
		this.container.insertBefore(frag, this.sentinel);
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
