/**
 * 白板布局视觉验证：用测试库真实卡片跑「双向 + 深度 3」投放，
 * 把生成的 .canvas JSON 渲染成 SVG 示意图，确认种子居中、左入右出、双链上下。
 */
import esbuild from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const stub = `export class Notice{constructor(){}}
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
	const children = [];
	const chBlock = /^children:\n((?:\s+-\s.*\n?)+)/m.exec(fmText);
	if (chBlock) {
		for (const line of chBlock[1].split('\n')) {
			const m = /^\s+-\s*"?\[\[(.+?)\]\]"?\s*$/.exec(line);
			if (m) children.push(m[1]);
		}
	}
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
	{ folder: 'Cards', ensureFolder: async () => {}, graph, bidirectionalColor: '5' },
);
const data = JSON.parse(createdCanvas.content);

// ---- 渲染 SVG ----
const canvasColor = { '1': '#e05252', '2': '#e0892f', '3': '#d9b42c', '4': '#3fa653', '5': '#3a7fd5', '6': '#8a5cd9' };
const SCALE = 0.62;
const minX = Math.min(...data.nodes.map((n) => n.x));
const minY = Math.min(...data.nodes.map((n) => n.y));
const toX = (x) => Math.round((x - minX) * SCALE) + 30;
const toY = (y) => Math.round((y - minY) * SCALE) + 30;
const W = Math.round((Math.max(...data.nodes.map((n) => n.x + n.width)) - minX) * SCALE) + 60;
const H = Math.round((Math.max(...data.nodes.map((n) => n.y + n.height)) - minY) * SCALE) + 60;

const fileToId = new Map(data.nodes.map((n) => [n.file, n.id]));
const titleOf = (file) => byId.get(file.split('/').pop().replace(/\.md$/, ''))?.title ?? file;

// 节点
const nodeRects = data.nodes
	.map((n) => {
		const color = n.color ? canvasColor[n.color] : '#f0f0f0';
		const isSeed = n.file.includes(seedId);
		const w = Math.round(n.width * SCALE);
		const h = Math.round(n.height * SCALE);
		const x = toX(n.x);
		const y = toY(n.y);
		const title = titleOf(n.file).slice(0, 16);
		return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${color}" fill-opacity="${isSeed ? 0.9 : 0.25}" stroke="${isSeed ? '#111' : color}" stroke-width="${isSeed ? 2 : 1.2}"/>
  <text x="${x + w / 2}" y="${y + h / 2 - 6}" text-anchor="middle" font-family="system-ui" font-size="12" font-weight="${isSeed ? 700 : 500}" fill="${color === '#f0f0f0' ? '#333' : color}">${isSeed ? '★ ' : ''}${title}</text>
  <text x="${x + w / 2}" y="${y + h / 2 + 12}" text-anchor="middle" font-family="system-ui" font-size="10" fill="#999">${n.file.split('/').pop().slice(0, 14)}</text>
</g>`;
	})
	.join('\n');

// 边：用直线近似，双链用虚线标注
const edgeLines = data.edges
	.map((e) => {
		const from = data.nodes.find((n) => n.id === e.fromNode);
		const to = data.nodes.find((n) => n.id === e.toNode);
		if (!from || !to) return '';
		const x1 = toX(from.x + from.width / 2);
		const y1 = toY(from.y + from.height / 2);
		const x2 = toX(to.x + to.width / 2);
		const y2 = toY(to.y + to.height / 2);
		const bi = e.fromEnd === 'arrow' || e.toEnd === 'arrow';
		const c = e.color ? canvasColor[e.color] : '#888';
		return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${bi ? 2.5 : 1.5}" ${bi ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"/>`;
	})
	.join('\n');

const legend = `<g font-family="system-ui" font-size="11" fill="#555">
  <rect x="30" y="30" width="12" height="12" rx="3" fill="#3a7fd5" fill-opacity="0.3" stroke="#3a7fd5"/>
  <text x="48" y="41">出链（它引用的）</text>
  <rect x="160" y="30" width="12" height="12" rx="3" fill="#e05252" fill-opacity="0.3" stroke="#e05252"/>
  <text x="178" y="41">入链（引用它的）</text>
  <rect x="290" y="30" width="12" height="12" rx="3" fill="#8a5cd9" fill-opacity="0.3" stroke="#8a5cd9"/>
  <text x="308" y="41">双链（上下方向）</text>
  <line x1="420" y1="36" x2="460" y2="36" stroke="#3a7fd5" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="466" y="41">双向箭头连线</text>
</g>`;

const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>
${legend}
${edgeLines}
${nodeRects}
</svg>`;

await writeFile('canvas-layout-preview.svg', svg);
console.log(`canvas-layout-preview.svg 已生成（${data.nodes.length} 节点, ${data.edges.length} 边）`);
console.log('via 分布:', JSON.stringify(
	Object.fromEntries(['seed', 'outgoing', 'incoming', 'both'].map((v) => [
		v, graph.nodes.filter((n) => n.via === v).length,
	])),
));
