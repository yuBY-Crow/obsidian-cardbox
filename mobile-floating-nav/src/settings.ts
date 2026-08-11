/**
 * 悬浮导航按钮的可用动作类型。
 * - command:    执行任意 Obsidian 命令(需 commandId)
 * - note:       打开指定笔记(需 notePath)
 * - new-note:   在当前默认位置新建一篇笔记
 * - scroll-top: 滚动当前笔记回到顶部
 * - url:        打开外部链接(需 url)
 */
export type NavActionType = "command" | "note" | "new-note" | "scroll-top" | "url";

/** 单个悬浮按钮的配置 */
export interface NavButtonConfig {
	/** 唯一 id,用于渲染与操作定位 */
	id: string;
	/** lucide 图标名,例如 "command"、"file-plus"、"arrow-up" */
	icon: string;
	/** 按钮标题(鼠标悬停提示 / 设置页展示) */
	label: string;
	/** 动作类型 */
	action: NavActionType;
	/** 执行命令时的命令 id,例如 "command-palette:open" */
	commandId?: string;
	/** 打开笔记时的仓库内路径,例如 "Inbox/待办.md" */
	notePath?: string;
	/** 打开外部链接时的 URL */
	url?: string;
	/** 图标颜色(十六进制),留空则跟随主题 */
	color?: string;
}

/** 全局插件设置 */
export interface NavSettings {
	/** 插件总开关 */
	enabled: boolean;
	/** 在移动端显示 */
	showOnMobile: boolean;
	/** 在桌面端显示 */
	showOnDesktop: boolean;
	/** 悬浮栏位置:左 / 右 */
	position: "left" | "right";
	/** 按钮列表(数量可自由增删) */
	buttons: NavButtonConfig[];
	/** 按钮边长(px) */
	buttonSize: number;
	/** 按钮之间的间距(px) */
	gap: number;
	/** 栏背景不透明度 0.05 - 1 */
	opacity: number;
	/** 是否显示折叠按钮 */
	showCollapse: boolean;
	/** 当前是否处于折叠状态 */
	collapsed: boolean;
	/** 距屏幕边缘的间距(px) */
	edgeOffset: number;
}

/** 生成一个新的按钮 id */
export function newButtonId(): string {
	return "btn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** 创建默认按钮配置(带默认参数),用于「添加按钮」 */
export function createDefaultButton(action: NavActionType = "command"): NavButtonConfig {
	const base: NavButtonConfig = {
		id: newButtonId(),
		icon: "circle-dot",
		label: "新按钮",
		action,
	};
	switch (action) {
		case "command":
			base.commandId = "command-palette:open";
			base.label = "命令面板";
			base.icon = "command";
			break;
		case "note":
			base.label = "打开笔记";
			base.icon = "file-text";
			break;
		case "new-note":
			base.label = "新建笔记";
			base.icon = "file-plus";
			break;
		case "scroll-top":
			base.label = "返回顶部";
			base.icon = "arrow-up";
			break;
		case "url":
			base.label = "打开链接";
			base.icon = "external-link";
			base.url = "https://";
			break;
	}
	return base;
}

export const DEFAULT_SETTINGS: NavSettings = {
	enabled: true,
	showOnMobile: true,
	showOnDesktop: false,
	position: "right",
	buttons: [
		{
			id: "btn-cmd",
			icon: "command",
			label: "命令面板",
			action: "command",
			commandId: "command-palette:open",
		},
		{
			id: "btn-switcher",
			icon: "search",
			label: "快速切换",
			action: "command",
			commandId: "switcher:open",
		},
		{
			id: "btn-new",
			icon: "file-plus",
			label: "新建笔记",
			action: "new-note",
		},
		{
			id: "btn-top",
			icon: "arrow-up",
			label: "返回顶部",
			action: "scroll-top",
		},
	],
	buttonSize: 46,
	gap: 10,
	opacity: 0.92,
	showCollapse: true,
	collapsed: false,
	edgeOffset: 10,
};
