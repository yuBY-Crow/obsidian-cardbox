/**
 * 卡片引用关系图遍历测试。
 * 覆盖：层级边界、方向、去重、断链、成环、节点上限、同层边补全。
 */
import esbuild from 'esbuild';

const r = await esbuild.build({
	entryPoints: ['src/utils/graph.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node',
	external: ['obsidian'],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const { collectLinkedCards, defaultOutgoingIds, countLinkedCards } = mod;

let pass = 0;
let fail = 0;
const t = (name, cond) => {
	if (cond) pass++;
	else {
		fail++;
		console.log('FAIL:', name);
	}
};

function card(id, children = [], bodyLinks = []) {
	return {
		id,
		path: `Cards/${id}.md`,
		tags: [],
		created: Date.now(),
		updated: Date.now(),
		children,
		bodyLinks,
		archived: false,
		pinned: false,
		snippet: '',
		searchText: '',
		hasTaskList: false,
		mtime: Date.now(),
	};
}

/** 构造一个 source：A→B→C→D 链，另有 X→A（入链），A 还正文引用 E */
function makeSource(cards) {
	const map = new Map(cards.map((c) => [c.id, c]));
	return {
		getById: (id) => map.get(id),
		outgoingIds: (c) => defaultOutgoingIds(c),
		incomingIds: (c) => {
			const out = [];
			for (const other of map.values()) {
				if (other.id === c.id) continue;
				if (other.children.includes(c.id) || other.bodyLinks.includes(c.id)) out.push(other.id);
			}
			return out;
		},
	};
}

const A = card('A', ['B'], ['E']);
const B = card('B', ['C']);
const C = card('C', ['D']);
const D = card('D');
const E = card('E');
const X = card('X', ['A']);
const src = makeSource([A, B, C, D, E, X]);

// ---- 层级边界 ----
{
	const r0 = collectLinkedCards([A], src, 'outgoing', 0);
	t('depth0 只有种子', r0.nodes.length === 1 && r0.nodes[0].card.id === 'A');
	t('depth0 种子 via=seed', r0.nodes[0].via === 'seed' && r0.nodes[0].depth === 0);
	t('depth0 无边', r0.edges.length === 0);
}
{
	const r1 = collectLinkedCards([A], src, 'outgoing', 1);
	const ids = r1.nodes.map((n) => n.card.id).sort();
	t('depth1 出链含 B 与正文 E', JSON.stringify(ids) === JSON.stringify(['A', 'B', 'E']));
	t('depth1 不含 C', !ids.includes('C'));
	const bNode = r1.nodes.find((n) => n.card.id === 'B');
	t('depth1 B 层级为 1', bNode.depth === 1 && bNode.via === 'outgoing');
}
{
	const r2 = collectLinkedCards([A], src, 'outgoing', 2);
	const ids = r2.nodes.map((n) => n.card.id).sort();
	t('depth2 到 C', JSON.stringify(ids) === JSON.stringify(['A', 'B', 'C', 'E']));
	t('depth2 C 层级为 2', r2.nodes.find((n) => n.card.id === 'C').depth === 2);
}
{
	const r9 = collectLinkedCards([A], src, 'outgoing', 9);
	t('层级足够大时收全整条链', r9.nodes.length === 5);
	t('D 层级为 3（最短距离）', r9.nodes.find((n) => n.card.id === 'D').depth === 3);
}

// ---- 方向 ----
{
	const inOnly = collectLinkedCards([A], src, 'incoming', 1);
	const ids = inOnly.nodes.map((n) => n.card.id).sort();
	t('incoming 只取引用者', JSON.stringify(ids) === JSON.stringify(['A', 'X']));
	t('incoming 边方向是 X→A', inOnly.edges.some((e) => e.fromId === 'X' && e.toId === 'A'));
	t('incoming 不含出链 B', !ids.includes('B'));
	t('incoming via标记正确', inOnly.nodes.find((n) => n.card.id === 'X').via === 'incoming');
}
{
	const both = collectLinkedCards([A], src, 'both', 1);
	const ids = both.nodes.map((n) => n.card.id).sort();
	t('both 同时含出链与入链', JSON.stringify(ids) === JSON.stringify(['A', 'B', 'E', 'X']));
}

// ---- 断链：指向不存在的卡片 ----
{
	const broken = card('BR', ['NOPE']);
	const s = makeSource([broken]);
	const r = collectLinkedCards([broken], s, 'outgoing', 3);
	t('断链不产生节点', r.nodes.length === 1);
	t('断链不产生悬空边', r.edges.length === 0);
}

// ---- 成环不死循环 ----
{
	const P = card('P', ['Q']);
	const Q = card('Q', ['P']);
	const s = makeSource([P, Q]);
	const r = collectLinkedCards([P], s, 'both', 10);
	t('成环不死循环且去重', r.nodes.length === 2);
	t('成环双向边都在', r.edges.length === 2);
}

// ---- 自引用 ----
{
	const S = card('S', ['S']);
	const s = makeSource([S]);
	const r = collectLinkedCards([S], s, 'both', 3);
	t('自引用不产生自环边', r.edges.length === 0 && r.nodes.length === 1);
}

// ---- 同层边补全 ----
{
	// A→B, A→C, B→C：B 与 C 同为depth1，B→C 这条边必须补上
	const a = card('a', ['b', 'c']);
	const b = card('b', ['c']);
	const c = card('c');
	const s = makeSource([a, b, c]);
	const r = collectLinkedCards([a], s, 'outgoing', 1);
	t('同层节点间的边被补全', r.edges.some((e) => e.fromId === 'b' && e.toId === 'c'));
	t('同层补全后边数为 3', r.edges.length === 3);
}

// ---- 多种子----
{
	const r = collectLinkedCards([A, X], src, 'outgoing', 1);
	const seeds = r.nodes.filter((n) => n.depth === 0).map((n) => n.card.id).sort();
	t('多种子都是 depth0', JSON.stringify(seeds) === JSON.stringify(['A', 'X']));
	t('多种子去重（A 只出现一次）', r.nodes.filter((n) => n.card.id === 'A').length === 1);
}

// ---- 节点上限 ----
{
	const many = [card('root', Array.from({ length: 50 }, (_, i) => `n${i}`))];
	for (let i = 0; i < 50; i++) many.push(card(`n${i}`));
	const s = makeSource(many);
	const r = collectLinkedCards([many[0]], s, 'outgoing', 3, 10);
	t('节点上限生效', r.nodes.length === 10);
}

// ---- 出链顺序：显式关联在前 ----
{
	const o = card('o', ['x1'], ['x2']);
	const ids = defaultOutgoingIds(o);
	t('出链顺序 children 优先', JSON.stringify(ids) === JSON.stringify(['x1', 'x2']));
	const dup = card('d', ['same'], ['same']);
	t('出链去重', JSON.stringify(defaultOutgoingIds(dup)) === JSON.stringify(['same']));
}

// ---- 计数辅助 ----
t('countLinkedCards 与 nodes 一致', countLinkedCards([A], src, 'outgoing', 2) === 4);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
