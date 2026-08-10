/** 卡片「眉头颜色」。null / undefined 表示未标记*/
export type CardColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export const CARD_COLORS: CardColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

/** 卡片（= Vault 中的一张 Markdown 笔记） */
export interface Card {
	/**
	 * 唯一 id = 文件名（去掉 .md）。
	 * 与 Obsidian [[链接]] 的解析口径一致，因此关联、图谱、重命名跟随都能对上。
	 */
	id: string;
	/**
	 * frontmatter 中残留的旧 id（仅当它与文件名不同时存在）。
	 * 用标题重命名后，老卡片的 children 可能仍写着旧 id，
	 * 索引会把它登记为别名，保证历史关联不断链。
	 */
	legacyId?: string;
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
	/** 显式登记的扩展卡片 id 数组（顺序即展示顺序，可拖拽调整） */
	children: string[];
	/**
	 * 正文中通过 [[双链]] 指向的卡片 id（按出现顺序）。
	 * 由索引层从 metadataCache 填充，与 children 合并后共同构成扩展卡片。
	 */
	bodyLinks: string[];
	/** 是否已归档（frontmatter archived: true） */
	archived: boolean;
	/** 眉头颜色标记 */
	color?: CardColor;
	/** 是否置顶（悬浮于列表顶部） */
	pinned: boolean;
	/** 正文前~200 字（列表显示 + 文本搜索） */
	snippet: string;
	/** 小写化的可搜索全文（标题 + 标签 + 正文，上限 4000 字），供关键字与搜索匹配 */
	searchText: string;
	/** 正文是否包含任务列表 */
	hasTaskList: boolean;
	/** 文件系统 mtime（纪元毫秒） */
	mtime: number;
}

/** 列表 / 瀑布流平铺 / 时间线 */
export type ViewMode = 'card' | 'masonry' | 'timeline';

export type SortMode = 'created-desc' | 'created-asc' | 'updated-desc' | 'title';

export type MergeMode = 'simple' | 'headings';

// ---------- 卡片盒 ----------

/**
 * 卡片盒时间条件：
 * - any：不限
 * - dynamic：动态窗口，最近 N 天（卡片盒内容随时间滚动变化）
 * - static：静态区间，固定起止日期
 */
export type BoxTimeMode = 'any' | 'dynamic' | 'static';

export interface BoxTimeRule {
	mode: BoxTimeMode;
	/** dynamic：最近 N 天 */
	lastDays?: number;
	/** static：起始日期 YYYY-MM-DD（含当天 00:00） */
	from?: string;
	/** static：结束日期 YYYY-MM-DD（含当天 23:59:59） */
	to?: string;
}

/**
 * 卡片盒定义：一组抓取条件，卡片自动落入盒中，无需手动归类。
 * 条件之间是「与」关系，但留空的条件不生效。
 */
export interface CardBoxDef {
	id: string;
	name: string;
	/** 时间条件 */
	time: BoxTimeRule;
	/** 标签条件（命中任一即可，支持嵌套标签前缀匹配） */
	tags: string[];
	/** 关键字条件（匹配标题或正文全文） */
	keywords: string[];
	/** 关键字之间的关系：any = 命中任一，all = 全部命中 */
	keywordMatch: 'any' | 'all';
	/** 颜色条件（命中任一即可） */
	colors: CardColor[];
	/** 是否只看置顶卡片 */
	pinnedOnly: boolean;
}

export function defaultBoxDef(id: string, name: string): CardBoxDef {
	return {
		id,
		name,
		time: { mode: 'any' },
		tags: [],
		keywords: [],
		keywordMatch: 'any',
		colors: [],
		pinnedOnly: false,
	};
}

export interface CardBoxSettings {
	/** 卡片存放文件夹（相对 Vault 根，无首尾斜杠） */
	cardsFolder: string;
	/** 「合并为文章」输出文件夹 */
	mergeOutputFolder: string;
	/** Canvas 文件输出文件夹 */
	canvasOutputFolder: string;
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
	/** 用户定义的卡片盒（持久化在插件 data.json） */
	boxes: CardBoxDef[];
	/** 上次选中的卡片盒 id；空字符串表示「全部卡片」 */
	activeBoxId: string;
	/** 瀑布流最小列宽（px），决定 PC 端平铺列数 */
	masonryMinColumnWidth: number;
	/** 投放到白板时的默认引用层级（0 = 只投当前卡片） */
	canvasLinkDepth: number;
	/** 投放到白板时的默认引用方向 */
	canvasLinkDirection: 'outgoing' | 'incoming' | 'both';
	/** 投放到白板时是否画出引用连线 */
	canvasDrawEdges: boolean;
}

export interface FilterState {
	query: string;
	selectedTags: Set<string>;
	selectedColors: Set<CardColor>;
	hasTag: boolean;
	noTag: boolean;
	emptyContent: boolean;
	hasTaskList: boolean;
	pinnedOnly: boolean;
	showArchived: boolean;
}

export function defaultFilterState(settings: CardBoxSettings): FilterState {
	return {
		query: '',
		selectedTags: new Set<string>(),
		selectedColors: new Set<CardColor>(),
		hasTag: false,
		noTag: false,
		emptyContent: false,
		hasTaskList: false,
		pinnedOnly: false,
		showArchived: settings.showArchived,
	};
}
