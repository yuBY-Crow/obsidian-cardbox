export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
	let timer: number | undefined;
	return (...args: A) => {
		if (timer !== undefined) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = undefined;
			fn(...args);
		}, ms);
	};
}

/** 下一帧执行（requestAnimationFrame，不可用时降级 setTimeout） */
export function nextFrame(fn: () => void): void {
	if (typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(() => fn());
	} else {
		window.setTimeout(fn, 16);
	}
}
