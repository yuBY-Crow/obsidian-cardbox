/** 简体中文 UI 文案集中地（日后改英文只需改此文件） */
export const i18n = {
	// 导航 / 命令
	capture: '快速记录卡片',
	openMain: '打开卡片盒视图',
	mergeSelected: '合并所选卡片为文章',
	batchTag: '批量打标签',
	archiveSelected: '归档所选卡片',
	deleteSelected: '删除所选卡片',
	toggleSelect: '切换多选模式',

	// 视图
	viewTitle: '卡片盒',
	indexing: '索引中…',
	empty: '还没有卡片。点击「+」或使用「快速记录卡片」命令开始收集灵感。',
	noMatch: '没有符合条件的卡片',
	cardMode: '卡片',
	timelineMode: '时间线',
	searchPlaceholder: '搜索卡片…',
	hasTag: '有标签',
	noTag: '无标签',
	emptyContent: '空内容',
	hasTask: '含任务',
	showArchived: '含归档',
	moreTags: '＋标签',
	selectedCount: (n: number) => `已选 ${n}`,
	tagSelected: '打标签',
	mergeSelectedAction: '合并为文章',
	archiveSelectedAction: '归档',
	deleteSelectedAction: '删除',
	cancelSelect: '取消选择',
	newCard: '新建卡片',
	more: '更多操作',

	// 卡片操作菜单
	edit: '编辑',
	addChild: '创建子卡片',
	tag: '打标签',
	archive: '归档',
	unarchive: '取消归档',
	delete: '删除',
	expandChildren: '展开子卡片',
	collapseChildren: '收起子卡片',
	childCount: (n: number) => `${n} 张子卡片`,

	// 时间
	today: '今天',
	yesterday: '昨天',
	archivedIndicator: '已归档',
	taskIndicator: '含任务',

	// 快速捕获
	captureTitle: '记录卡片',
	capturePlaceholder: '输入卡片内容…',
	continuousMode: '连续模式',
	save: '保存',
	cancel: '取消',
	emptyCaptureHint: '内容为空，未保存',
	childCapturePlaceholder: '输入子卡片内容…',

	// 合并成文
	mergeTitle: '合并为文章',
	articleTitleLabel: '文章标题',
	articleTitlePlaceholder: '输入文章标题',
	mergeModeLabel: '合并模式',
	mergeModeSimple: '简单拼接',
	mergeModeHeadings: '按标题层级',
	mergeButton: '生成文章',
	mergedNotice: (title: string) => `已生成文章：${title}`,

	// 批量标签
	tagTitle: '打标签',
	tagPlaceholder: '输入标签（支持 父/子 嵌套）',
	existingTags: '已有标签（点击添加）',
	apply: '应用',
	tagApplied: (n: number, tag: string) => `已为 ${n} 张卡片添加标签 #${tag}`,

	// 确认
	confirmTitle: '确认操作',
	confirmDeleteText: (n: number) => `确定删除所选 ${n} 张卡片吗？删除后会进入回收站。`,
	confirmArchiveText: (n: number) => `确定归档所选 ${n} 张卡片吗？`,
	confirm: '确认',

	// 设置
	settingsTitle: 'CardBox 设置',
	cardsFolderName: '卡片存放文件夹',
	cardsFolderDesc: '卡片笔记存放的文件夹（相对 Vault 根，无需首尾斜杠）。改动后自动重建索引。',
	mergeFolderName: '合并输出文件夹',
	mergeFolderDesc: '「合并为文章」生成的新笔记存放位置。',
	defaultTagsName: '新建卡片默认标签',
	viewModeName: '默认视图',
	sortName: '默认排序',
	sortCreatedDesc: '创建时间 ↓',
	sortCreatedAsc: '创建时间 ↑',
	sortUpdatedDesc: '更新时间 ↓',
	sortTitle: '标题',
	continuousName: '连续模式默认开启',
	continuousDesc: '快速记录时保存后保持打开并清空输入框，方便连续录入灵感。',
	showArchivedName: '卡片盒中显示归档卡片',
	showArchivedDesc: '关闭时归档卡片不出现在卡片盒中。',
	archiveMethodName: '归档方式',
	archiveMethodDesc: 'MVP 使用 frontmatter 标记归档：不移动文件、不破坏双向链接，随时可逆。',
	folderPlaceholder: '例如 Cards',
	addTag: '添加标签',
	tagInputPlaceholder: '输入标签后回车',

	// 通知
	noticeFolderCreated: (folder: string) => `卡片文件夹不存在，已创建：${folder}`,
	childCreated: '已创建子卡片',
};
