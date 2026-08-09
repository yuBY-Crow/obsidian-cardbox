/** 卡片（= Vault 中的一张 Markdown 笔记） */
export interface Card {
	/** 唯一 id，等于文件名（去掉 .md），frontmatter id 优先 */
	id: string;
	/** Vault 绝对路径 */
	path: string;
	/** 可选标题；闪念卡片常省略，正文即内容 */
	title?: string;
	/** 标签数组；嵌套标签按原样存一个字符串，如 "读书/笔记" */
	tags: string[];
	/** 创建时间（纪元毫秒） */
	created: number;
	/** 更新时间（纪元毫秒） */
	updated: number;
	/** 父卡片 id（可选） */
	parent?: string;
	/** 子卡片 id 数组 */
	children: string[];
	/** 是否已归档（frontmatter archived: true） */
	archived: boolean;
	/** 正文前 ~200 字（列表显示 + 文本搜索） */
	snippet: string;
	/** 正文是否包含任务列表 */
	hasTaskList: boolean;
	/** 文件系统 mtime（纪元毫秒） */
	mtime: number;
}

export type ViewMode = 'card' | 'timeline';

export type SortMode = 'created-desc' | 'created-asc' | 'updated-desc' | 'title';

export type MergeMode = 'simple' | 'headings';

export interface CardBoxSettings {
	/** 卡片存放文件夹（相对 Vault 根，无首尾斜杠） */
	cardsFolder: string;
	/** 「合并为文章」输出文件夹 */
	mergeOutputFolder: string;
	/** 文件名方案（MVP 仅 datetime） */
	filenameFormat: 'datetime' | 'title';
	/** 新建卡片默认标签 */
	defaultTags: string[];
	/** 卡片盒默认视图 */
	defaultViewMode: ViewMode;
	/** 默认排序 */
	defaultSort: SortMode;
	/** 快速记录默认连续模式 */
	continuousCaptureDefault: boolean;
	/** 卡片盒中是否显示归档卡片 */
	showArchived: boolean;
	/** 归档方式（MVP 仅 frontmatter 标记） */
	archiveMethod: 'flag';
}

export interface FilterState {
	query: string;
	selectedTags: Set<string>;
	hasTag: boolean;
	noTag: boolean;
	emptyContent: boolean;
	hasTaskList: boolean;
	showArchived: boolean;
}

export function defaultFilterState(settings: CardBoxSettings): FilterState {
	return {
		query: '',
		selectedTags: new Set<string>(),
		hasTag: false,
		noTag: false,
		emptyContent: false,
		hasTaskList: false,
		showArchived: settings.showArchived,
	};
}
