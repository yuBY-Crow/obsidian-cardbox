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
