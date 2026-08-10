/**
 * 白板层级投放端到端验证：用测试库真实卡片跑一遍不同层级 / 方向的投放，
 * 打印每种组合会带上哪些卡片，并检查生成的 .canvas JSON 结构。
 */
import esbuild from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const stub = `export class Notice{constructor(m){globalThis.__notices=(globalThis.__notices||[]);globalThis.__notices.push(String(m));}}
export class TFile{}
export const App={};`;

async function bundle(entry) {
	const r = await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'node',
		plugins: [
			{
				name: 'stub',
				setup(b) {
					b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
					b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
				},
			},
		],
	});
	return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}

const graphMod = await bundle('src/utils/graph.ts');
const canvasMod = await bundle('src/utils/canvas.ts');
const { collectLinkedCards, defaultOutgoingIds } = graphMod;
const { sendCardsToCanvas } = canvasMod;

//---- 从测试库读取示例卡片（只取带「卡片写作」标签的那批）----
const dir = 'test-vault/Cards';
const cards = [];
for (const f of await readdir(dir)) {
	if (!f.endsWith('.md')) continue;
	const raw = await readFile(path.join(dir, f), 'utf8');
	if (!raw.includes('卡片写作')) continue;
	const id = f.replace(/\.md$/, '');
	const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
	const fmText = fmMatch ? fmMatch[1] : '';
	const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

	const titleM = /^title:\s*"(.*)"$/m.exec(fmText);
	const colorM = /^color:\s*(\w+)$/m.exec(fmText);
	// children 是YAML 列表
	const children = [];
	const chBlock = /^children:\n((?:\s+-\s.*\n?)+)/m.exec(fmText);
	if (chBlock) {
		for (const line of chBlock[1].split('\n')) {
			const m = /^\s+-\s*"?\[\[(.+?)\]\]"?\s*$/.exec(line);
			if (m) children.push(m[1]);
		}
	}
	// 正文双链
	const bodyLinks = [];
	for (const m of body.matchAll(/\[\[(.+?)\]\]/g)) {
		const target = m[1].split('|')[0].split('#')[0].trim();
		if (target && !bodyLinks.includes(target)) bodyLinks.push(target);
	}
	cards.push({
		id,
		path: `${dir}/${f}`,
		title: titleM ? titleM[1] : undefined,
		tags: ['卡片写作'],
		created: Date.now(),
		updated: Date.now(),
		children,
		bodyLinks,
		archived: false,
		pinned: /^pinned:\s*true$/m.test(fmText),
		color: colorM ? colorM[1] : undefined,
		snippet: body.trim().slice(0, 200),
		searchText: '',
		hasTaskList: false,
		mtime: Date.now(),
	});
}

const byId = new Map(cards.map((c) => [c.id, c]));
const source = {
	getById: (id) => byId.get(id),
	outgoingIds: (c) => defaultOutgoingIds(c).filter((id) => byId.has(id)),
	incomingIds: (c) => {
		const out = [];
		for (const o of byId.values()) {
			if (o.id === c.id) continue;
			if (o.children.includes(c.id) || o.bodyLinks.includes(c.id)) out.push(o.id);
		}
		return out;
	},
};

const seedId = '卡片笔记写作法：核心框架';
const seed = byId.get(seedId);

let pass = 0;
let fail = 0;
const t = (name, cond, got) => {
	if (cond) pass++;
	else {
		fail++;
		console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got, null, 1)}` : '');
	}
};

console.log(`读到 ${cards.length} 张示例卡片，种子：${seedId}\n`);
t('示例卡片齐全（7 张）', cards.length === 7, cards.length);
t('种子卡片存在', !!seed);
// 显式关联数量不硬编码：测试库里可能被手动操作（如「设为扩展卡片」）改动
t('种子有显式关联', seed.children.length >= 2, seed.children);
t('种子有正文双链', seed.bodyLinks.length >= 2, seed.bodyLinks);

// ---- 各层级 / 方向组合 ----
const combos = [
	['outgoing', 0],
	['outgoing', 1],
	['outgoing', 2],
	['incoming', 1],
	['both', 1],
	['both', 3],
];
const counts = {};
for (const [dir2, depth] of combos) {
	const r = collectLinkedCards([seed], source, dir2, depth);
	counts[`${dir2}-${depth}`] = r.nodes.length;
	const byDepth = {};
	for (const n of r.nodes) (byDepth[n.depth] = byDepth[n.depth] || []).push(n.card.title ?? n.card.id);
	console.log(`${dir2} 深度${depth} → ${r.nodes.length} 张卡片, ${r.edges.length} 条连线`);
	for (const d of Object.keys(byDepth).sort()) console.log(`   L${d}: ${byDepth[d].join(' / ')}`);
	console.log('');
}

// 数量断言基于「动态」语义而非硬编码：
// 主卡的出链 = children + bodyLinks（测试库里可能被手动改过，比如提升了新的扩展卡片）
t('深度 0 只有种子', counts['outgoing-0'] === 1, counts['outgoing-0']);
t('出链深度 1 = 种子 + 全部直接关联', counts['outgoing-1'] === 1 + seed.children.length + seed.bodyLinks.length,
	counts['outgoing-1']);
t('层级越深数量单调不减', counts['outgoing-1'] <= counts['outgoing-2']);
t('出链深度 2 ≥ 出链深度 1', counts['outgoing-2'] >= counts['outgoing-1'], counts['outgoing-2']);
t('入链深度 1 至少带上反向引用者', counts['incoming-1'] >= 2, counts['incoming-1']);
t('双向深度 1 同时含两侧', counts['both-1'] >= counts['outgoing-1'] && counts['both-1'] >= counts['incoming-1'],
	counts['both-1']);
t('双向深度 3 覆盖全部 7 张', counts['both-3'] === 7, counts['both-3']);

// ---- 生成真实 .canvas 并校验 ----
const graph = collectLinkedCards([seed], source, 'both', 3);
let createdCanvas = null;
const app = {
	vault: {
		getAbstractFileByPath: () => null,
		create: async (p, c) => {
			createdCanvas = { path: p, content: c };
			return { path: p, basename: '白板', extension: 'canvas' };
		},
		read: async () => createdCanvas.content,
		modify: async (f, c) => {
			createdCanvas.content = c;
		},
	},
};
await sendCardsToCanvas(
	app,
	graph.nodes.map((n) => n.card),
	{ folder: 'Cards', ensureFolder: async () => {}, graph },
);
const data = JSON.parse(createdCanvas.content);

t('canvas 含 7 个节点', data.nodes.length === 7, data.nodes.length);
t('全部为 file 类型节点', data.nodes.every((n) => n.type === 'file'));
t('节点指向真实卡片文件', data.nodes.every((n) => n.file.startsWith('test-vault/Cards/') && n.file.endsWith('.md')));
t('生成了连线', data.edges.length > 0, data.edges.length);
const nodeIds = new Set(data.nodes.map((n) => n.id));
t('连线两端都是真实节点', data.edges.every((e) => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode)));
t('置顶蓝色卡片映射为色号 5', data.nodes.some((n) => n.color === '5'));

// 居中布局：种子在正中列（x=0），出链在右、入链在左
const seedNode = data.nodes.find((n) => n.file.includes(seedId));
const seedCx = seedNode.x + seedNode.width / 2;
const byCardId = new Map(graph.nodes.map((n) => [n.card.id, n]));
const cxOf = (node) => node.x + node.width / 2;
t('种子在正中（x=0）', seedNode.x === 0, seedNode.x);
let rightOk = true;
let leftOk = true;
let bothOk = true;
for (const n of data.nodes) {
	const meta = byCardId.get(n.file.split('/').pop().replace(/\.md$/, ''));
	if (!meta) continue;
	if (meta.via === 'outgoing' && cxOf(n) <= seedCx) rightOk = false;
	if (meta.via === 'incoming' && cxOf(n) >= seedCx) leftOk = false;
	if (meta.via === 'both') {
		// 双链卡片与种子同列、且在上下方向
		if (Math.abs(cxOf(n) - seedCx) > 1) bothOk = false;
	}
}
t('出链卡片都在种子右侧', rightOk);
t('入链卡片都在种子左侧', leftOk);
t('双链卡片与种子同列', bothOk);

// 双链边：双向箭头 + 颜色
const biEdges = data.edges.filter((e) => e.fromEnd === 'arrow' && e.toEnd === 'arrow');
t('存在双链双向箭头连线', biEdges.length >= 1, biEdges.length);
t('双链连线带颜色', biEdges.every((e) => /^[1-6]$/.test(String(e.color))), biEdges.map((e) => e.color));

// 不重叠
let overlap = false;
for (let i = 0; i < data.nodes.length; i++) {
	for (let j = i + 1; j < data.nodes.length; j++) {
		const A = data.nodes[i];
		const B = data.nodes[j];
		if (A.x < B.x + B.width && B.x < A.x + A.width && A.y < B.y + B.height && B.y < A.y + A.height) overlap = true;
	}
}
t('节点互不重叠', !overlap);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
