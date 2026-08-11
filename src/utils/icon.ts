import { getIcon, setIcon } from 'obsidian';

/**
 * 竖三点（kebab）图标，带版本兼容探测。
 *
 * 背景：手机端真机上 `more-vertical` 渲染成了一个点——setIcon 在图标名
 * 不存在时不报错，只会挂一个空 SVG，视觉上就是一个点。
 * lucide 在不同 Obsidian 版本里对这个图标的命名不同：
 * - 旧版叫 more-vertical
 * - 新版（lucide 0.469+，Obsidian 1.9+）叫 ellipsis-vertical
 * 用 getIcon 探测哪个存在；都不存在时用 Unicode「⋮」兜底——
 * 纯文本字符，任何版本都能显示。
 */
let resolvedKebab: string | null | undefined;

export function setKebabIcon(el: HTMLElement): void {
	if (resolvedKebab === undefined) {
		if (getIcon('more-vertical')) resolvedKebab = 'more-vertical';
		else if (getIcon('ellipsis-vertical')) resolvedKebab = 'ellipsis-vertical';
		else resolvedKebab = null;
	}
	if (resolvedKebab) setIcon(el, resolvedKebab);
	else {
		el.setText('⋮');
		el.addClass('cardbox-kebab-text');
	}
}
