// 生成一组带真实双链关系的示例卡片，用于验证图谱 / 反向链接 / 白板层级投放。
//
// 文件名直接用中文标题，双链写成 [[卡片标题]]——
// 这正是 filenameFormat: 'title' 模式下的真实形态，链接一眼能看懂。
//
// 用法: node scripts/seed-links.mjs <vault路径> [卡片文件夹]
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const vaultDir = path.resolve(process.argv[2] ?? 'test-vault');
const folder = process.argv[3] ?? 'Cards';
const dir = path.join(vaultDir, folder);
await mkdir(dir, { recursive: true });

// 清理上一版用 demo- 前缀 id 命名的示例卡片，避免新旧混杂
try {
	for (const f of await readdir(dir)) {
		if (f.startsWith('demo-') && f.endsWith('.md')) await unlink(path.join(dir, f));
	}
} catch {
	/* 目录不存在时忽略 */
}

const now = Date.now();
const day = 86400000;

/**
 * 关系设计（便于验证白板层级投放）：
 *   核心框架 ─┬→闪念笔记（frontmatter 关联）
 *            ├→ 文献笔记（frontmatter 关联）→ 书摘示例（第2 层）
 *            ├→ 永久笔记（正文双链）
 *            └→ 非线性写作（正文双链）
 *   卡片盒方法论 ──→ 核心框架（反向引用，只在 incoming 方向出现）
 */
const cards = [
	{
		title: '卡片笔记写作法：核心框架',
		color: 'blue',
		pinned: true,
		created: now - day,
		children: ['闪念笔记：48 小时法则', '文献笔记：用自己的话提炼'],
		body: `卢曼的卡片盒笔记法（Zettelkasten）把写作从线性积累变为网络化生长。

三大笔记类型中，永久笔记最关键：[[永久笔记：原子化、可独立存在]]

延伸阅读：[[非线性写作：从卡片到文章]]`,
	},
	{
		title: '闪念笔记：48 小时法则',
		color: 'red',
		created: now - day * 2,
		parent: '卡片笔记写作法：核心框架',
		body: `临时灵感，需在 48 小时内加工处理，否则会变成永远不再看的信息垃圾。

对应工具：手机端快速记录卡片。`,
	},
	{
		title: '文献笔记：用自己的话提炼',
		color: 'orange',
		created: now - day * 3,
		parent: '卡片笔记写作法：核心框架',
		children: ['书摘示例：知识的连接'],
		body: `阅读时用自己的话提炼核心观点，标注来源。

不要摘抄原文，转述才能真正理解。`,
	},
	{
		title: '书摘示例：知识的连接',
		color: 'yellow',
		created: now - day * 4,
		parent: '文献笔记：用自己的话提炼',
		body: `「真正重要的不是卡片数量，而是卡片之间的连接。」

这句话解释了为什么单纯收集是无效的。`,
	},
	{
		title: '永久笔记：原子化、可独立存在',
		color: 'green',
		created: now - day * 5,
		body: `经深度思考后存入卡片盒的原子化知识单元，需清晰完整、可独立存在。

它同时被 [[卡片笔记写作法：核心框架]] 引用，形成双向关系。`,
	},
	{
		title: '非线性写作：从卡片到文章',
		color: 'purple',
		created: now - day * 6,
		body: `自下而上写作：从笔记网络中涌现主题，而非先定题目再填充内容。

参考主卡 [[卡片笔记写作法：核心框架]] 的整体框架。`,
	},
	{
		title: '卡片盒方法论：为什么有效',
		created: now - day * 7,
		body: `这张卡片没有被主卡关联，但它在正文里引用了 [[卡片笔记写作法：核心框架]]。

因此它会出现在主卡的「引用此卡片」反向链接区，可一键提升为扩展卡片；
在白板投放时，选「引用它的」或「双向」方向才会带上它。`,
	},
];

for (const c of cards) {
	// 注意：不写 id 字段——id 由文件名决定，写了反而会产生歧义
	const fm = ['---', `title: "${c.title}"`, `created: ${c.created}`, `updated: ${c.created}`];
	if (c.color) fm.push(`color: ${c.color}`);
	if (c.pinned) fm.push('pinned: true');
	if (c.parent) fm.push(`parent: "[[${c.parent}]]"`);
	if (c.children?.length) {
		fm.push('children:');
		for (const ch of c.children) fm.push(`  - "[[${ch}]]"`);
	}
	fm.push('tags:');
	fm.push('  - "卡片写作"');
	fm.push('---', '');
	await writeFile(path.join(dir, `${c.title}.md`), fm.join('\n') + '\n' + c.body + '\n');
}

console.log(`已生成 ${cards.length} 张双链示例卡片到 ${dir}`);
console.log('主卡片：卡片笔记写作法：核心框架');
console.log('  2 个frontmatter 关联 + 2 个正文双链 + 1 个反向引用');
console.log('  文件名即标题，双链写成 [[卡片标题]]');
