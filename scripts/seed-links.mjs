// 生成一组带真实双链关系的示例卡片，用于验证图谱/反向链接整合效果。
// 用法: node scripts/seed-links.mjs <vault路径> [卡片文件夹]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const vaultDir = path.resolve(process.argv[2] ?? 'test-vault');
const folder = process.argv[3] ?? 'Cards';
const dir = path.join(vaultDir, folder);
await mkdir(dir, { recursive: true });

const now = Date.now();
const day = 86400000;

// 主卡：大纲；扩展卡：各章节。混用frontmatter 关联与正文双链两种方式。
const cards = [
  {
    id: 'demo-luhmann-main',
    title: '卡片笔记写作法：核心框架',
    color: 'blue',
    pinned: true,
    created: now - day,
    children: ['demo-fleeting', 'demo-literature'],   // frontmatter 显式关联
    body: `卢曼的卡片盒笔记法（Zettelkasten）把写作从线性积累变为网络化生长。

三大笔记类型中，永久笔记最关键：[[demo-permanent]]

延伸阅读：[[demo-writing-flow]]`,   // 正文双链 → 自动成为扩展卡片
  },
  {
    id: 'demo-fleeting',
    title: '闪念笔记：48 小时法则',
    color: 'red',
    created: now - day * 2,
    parent: 'demo-luhmann-main',
    body: `临时灵感，需在 48 小时内加工处理，否则会变成永远不再看的信息垃圾。

对应工具：手机端快速记录卡片。`,
  },
  {
    id: 'demo-literature',
    title: '文献笔记：用自己的话提炼',
    color: 'orange',
    created: now - day * 3,
    parent: 'demo-luhmann-main',
    children: ['demo-quote-example'],
    body: `阅读时用自己的话提炼核心观点，标注来源。

不要摘抄原文，转述才能真正理解。`,
  },
  {
    id: 'demo-quote-example',
    title: '书摘示例：知识的连接',
    color: 'yellow',
    created: now - day * 4,
    parent: 'demo-literature',
    body: `「真正重要的不是卡片数量，而是卡片之间的连接。」

这句话解释了为什么单纯收集是无效的。`,
  },
  {
    id: 'demo-permanent',
    title: '永久笔记：原子化、可独立存在',
    color: 'green',
    created: now - day * 5,
    body: `经深度思考后存入卡片盒的原子化知识单元，需清晰完整、可独立存在。

它同时被[[demo-luhmann-main]] 引用，形成双向关系。`,
  },
  {
    id: 'demo-writing-flow',
    title: '非线性写作：从卡片到文章',
    color: 'purple',
    created: now - day * 6,
    body: `自下而上写作：从笔记网络中涌现主题，而非先定题目再填充内容。

参考主卡 [[demo-luhmann-main]] 的整体框架。`,
  },
  {
    id: 'demo-orphan-ref',
    title: '一张只引用主卡的独立卡片',
    created: now - day * 7,
    body: `这张卡片没有被主卡关联，但它在正文里引用了 [[demo-luhmann-main]]。

因此它会出现在主卡的「引用此卡片」反向链接区，可一键提升为扩展卡片。`,
  },
];

for (const c of cards) {
  const fm = ['---', `id: "${c.id}"`, `title: "${c.title}"`, `created: ${c.created}`, `updated: ${c.created}`];
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
  await writeFile(path.join(dir, `${c.id}.md`), fm.join('\n') + '\n' + c.body + '\n');
}

console.log(`已生成 ${cards.length} 张双链示例卡片到 ${dir}`);
console.log('主卡片: demo-luhmann-main（含 2 个显式关联 + 2 个正文双链 + 1 个反向链接）');
