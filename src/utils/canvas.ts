import { App, Notice, TFile } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, CardColor } from '../types';
import type { GraphEdge, GraphNode } from './graph';
import { sanitizeFileName, toDayKey } from './format';

/**
 * Obsidian Canvas（.canvas）读写。
 *
 * Canvas 是官方 JSON 格式，用 file 类型节点引用卡片笔记，
 * 因此卡片在白板上是「活的」——编辑卡片，白板同步更新。
 * 这样复用官方白板即可获得拖拽、框选、连线、缩放等全部能力。
 */

const NODE_W = 300;
const NODE_H = 220;
const GAP = 40;
/** 层级之间留更大的纵向间距，让连线看得清 */
const ROW_GAP = 120;
/** 左右分列时，列与列之间的横向间距 */
const COL_STEP = NODE_W + 140;
/** 同列内上下相邻节点的纵向间距 */
const V_STEP = NODE_H + 60;

interface CanvasNode {
	id: string;
	type: 'file' | 'text' | 'link' | 'group';
	x: number;
	y: number;
	width: number;
	height: number;
	file?: string;
	text?: string;
	color?: string;
}

/** Canvas 连线。fromSide/toSide 决定连线从节点哪一侧引出 */
interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: 'top' | 'right' | 'bottom' | 'left';
	fromEnd?: 'none' | 'arrow';
	toNode: string;
	toSide: 'top' | 'right' | 'bottom' | 'left';
	toEnd?: 'none' | 'arrow';
	/** Canvas 预设色号 1-6；双链连线用此标色 */
	color?: string;
}

interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

/** 卡片颜色 → Canvas 预设色号（1红2橙 3黄 4绿 5青 6紫） */
const COLOR_MAP: Record<CardColor, string> = {
	red: '1',
	orange: '2',
	yellow: '3',
	green: '4',
	blue: '5',
	purple: '6',
	gray: '',
};

function randomNodeId(): string {
	let s = '';
	for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
	return s;
}

function parseCanvas(raw: string): CanvasData {
	try {
		const data = JSON.parse(raw) as Partial<CanvasData>;
		return {
			nodes: Array.isArray(data.nodes) ? (data.nodes as CanvasNode[]) : [],
			edges: Array.isArray(data.edges) ? (data.edges as CanvasEdge[]) : [],
		};
	} catch {
		return { nodes: [], edges: [] };
	}
}

/** 在已有节点下方按网格排布新节点，避免与现有内容重叠 */
function nextOrigin(nodes: CanvasNode[]): { x: number; y: number } {
	if (!nodes.length) return { x: 0, y: 0 };
	let maxBottom = -Infinity;
	let minX = Infinity;
	for (const n of nodes) {
		maxBottom = Math.max(maxBottom, (n.y ?? 0) + (n.height ?? 0));
		minX = Math.min(minX, n.x ?? 0);
	}
	if (!isFinite(maxBottom)) return { x: 0, y: 0 };
	return { x: isFinite(minX) ? minX : 0, y: maxBottom + GAP * 2 };
}

function buildNodes(cards: Card[], origin: { x: number; y: number }): CanvasNode[] {
	const columns = Math.max(1, Math.ceil(Math.sqrt(cards.length)));
	return cards.map((card, i) => {
		const col = i % columns;
		const row = Math.floor(i / columns);
		const node: CanvasNode = {
			id: randomNodeId(),
			type: 'file',
			file: card.path,
			x: origin.x + col * (NODE_W + GAP),
			y: origin.y + row * (NODE_H + GAP),
			width: NODE_W,
			height: NODE_H,
		};
		if (card.color) {
			const c = COLOR_MAP[card.color];
			if (c) node.color = c;
		}
		return node;
	});
}

/**
 * 按引用层级分行排布（多种子时的退化布局）：
 * depth 0（种子）在最上一行，depth 1 在下一行，以此类推。
 */
function buildLayeredNodes(
	nodes: GraphNode[],
	origin: { x: number; y: number },
): { canvasNodes: CanvasNode[]; idToNode: Map<string, CanvasNode> } {
	const byDepth = new Map<number, GraphNode[]>();
	for (const n of nodes) {
		const arr = byDepth.get(n.depth) ?? [];
		arr.push(n);
		byDepth.set(n.depth, arr);
	}
	const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
	const widest = Math.max(1, ...depths.map((d) => (byDepth.get(d) as GraphNode[]).length));
	const totalWidth = widest * NODE_W + (widest - 1) * GAP;

	const canvasNodes: CanvasNode[] = [];
	const idToNode = new Map<string, CanvasNode>();

	depths.forEach((depth, rowIndex) => {
		const row = byDepth.get(depth) as GraphNode[];
		const rowWidth = row.length * NODE_W + (row.length - 1) * GAP;
		// 行内居中：与最宽的一行对齐中线
		const startX = origin.x + Math.round((totalWidth - rowWidth) / 2);
		const y = origin.y + rowIndex * (NODE_H + ROW_GAP);
		row.forEach((n, i) => {
			const node = makeFileNode(n.card, startX + i * (NODE_W + GAP), y);
			idToNode.set(n.card.id, node);
			canvasNodes.push(node);
		});
	});

	return { canvasNodes, idToNode };
}

function makeFileNode(card: Card, x: number, y: number): CanvasNode {
	const node: CanvasNode = {
		id: randomNodeId(),
		type: 'file',
		file: card.path,
		x,
		y,
		width: NODE_W,
		height: NODE_H,
	};
	if (card.color) {
		const c = COLOR_MAP[card.color];
		if (c) node.color = c;
	}
	return node;
}

/** 一列节点的起始 y：让整列的垂直中心与给定中线对齐 */
function columnStartY(count: number, centerY: number): number {
	const total = count * NODE_H + (count - 1) * (V_STEP - NODE_H);
	return Math.round(centerY - total / 2);
}

/**
 * 单种子的「种子居中」布局：
 * - 种子在正中一列
 * - 种子引用的卡片（出链）在右侧，层级越深越靠右
 * - 引用种子的卡片（入链）在左侧，层级越深越靠左
 * - 与种子互为引用的双链卡片在种子的上下方向
 * 每列垂直方向都与种子中线对齐，连线走向一目了然。
 */
function buildRadialNodes(
	nodes: GraphNode[],
	origin: { x: number; y: number },
): { canvasNodes: CanvasNode[]; idToNode: Map<string, CanvasNode>; leftCols: number } {
	const seed = nodes.find((n) => n.depth === 0);
	if (!seed) return { canvasNodes: [], idToNode: new Map(), leftCols: 0 };

	const seedCenterY = origin.y + NODE_H / 2;
	const canvasNodes: CanvasNode[] = [];
	const idToNode = new Map<string, CanvasNode>();
	const place = (n: GraphNode, x: number, y: number) => {
		const node = makeFileNode(n.card, x, y);
		idToNode.set(n.card.id, node);
		canvasNodes.push(node);
	};

	// 种子居中
	place(seed, origin.x, origin.y);

	// 出链侧（右）：按层级分列
	const rightByDepth = groupByDepth(nodes.filter((n) => n.depth > 0 && n.via === 'outgoing'));
	for (const [depth, col] of rightByDepth) {
		const x = origin.x + depth * COL_STEP;
		const y0 = columnStartY(col.length, seedCenterY);
		col.forEach((n, i) => place(n, x, y0 + i * V_STEP));
	}

	// 入链侧（左）：按层级分列
	const leftByDepth = groupByDepth(nodes.filter((n) => n.depth > 0 && n.via === 'incoming'));
	for (const [depth, col] of leftByDepth) {
		const x = origin.x - depth * COL_STEP;
		const y0 = columnStartY(col.length, seedCenterY);
		col.forEach((n, i) => place(n, x, y0 + i * V_STEP));
	}

	// 双链卡片：种子上下方向，奇偶交替分到上方与下方
	const both = nodes.filter((n) => n.via === 'both');
	const above = both.filter((_, i) => i % 2 === 0);
	const below = both.filter((_, i) => i % 2 === 1);
	above.forEach((n, i) => place(n, origin.x, origin.y - (above.length - i) * V_STEP));
	below.forEach((n, i) => place(n, origin.x, origin.y + (i + 1) * V_STEP));

	const leftCols = leftByDepth.size ? Math.max(...leftByDepth.keys()) : 0;
	return { canvasNodes, idToNode, leftCols };
}

function groupByDepth(nodes: GraphNode[]): Map<number, GraphNode[]> {
	const m = new Map<number, GraphNode[]>();
	for (const n of nodes) {
		const arr = m.get(n.depth) ?? [];
		arr.push(n);
		m.set(n.depth, arr);
	}
	return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}

/** 根据两节点中心的相对位置决定连线的引出侧，让线走最近的方向 */
function edgeSides(a: CanvasNode, b: CanvasNode): Pick<CanvasEdge, 'fromSide' | 'toSide'> {
	const ax = a.x + a.width / 2;
	const ay = a.y + a.height / 2;
	const bx = b.x + b.width / 2;
	const by = b.y + b.height / 2;
	const dx = bx - ax;
	const dy = by - ay;
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
	}
	return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/**
 * 把卡片间的引用关系转成 Canvas 连线。
 * - 只画两端都在白板上的连线，避免 Canvas 出现指向空节点的坏边
 * - 互为引用的一对卡片合并成一条双向箭头连线并标上双链颜色——
 *   两个方向各画一条会重叠成一团
 * - 引出侧按节点几何相对位置计算，避免连线横穿节点
 */
function buildEdges(edges: GraphEdge[], idToNode: Map<string, CanvasNode>, bidirColor: string): CanvasEdge[] {
	const keyOf = (a: string, b: string) => a + "\u0000" + b;
	// 先找出所有双向引用对（同一对卡片的正反两条引用都在图上）
	const onBoard = new Set<string>();
	for (const e of edges) {
		if (e.fromId !== e.toId && idToNode.has(e.fromId) && idToNode.has(e.toId)) {
			onBoard.add(keyOf(e.fromId, e.toId));
		}
	}
	const bidirectional = new Set<string>();
	for (const key of onBoard) {
		const [a, b] = key.split("\u0000");
		if (onBoard.has(keyOf(b, a))) bidirectional.add(key);
	}

	const out: CanvasEdge[] = [];
	const seen = new Set<string>();
	for (const e of edges) {
		const from = idToNode.get(e.fromId);
		const to = idToNode.get(e.toId);
		if (!from || !to || from === to) continue;

		const fwd = keyOf(e.fromId, e.toId);
		const rev = keyOf(e.toId, e.fromId);
		const isBi = bidirectional.has(fwd);

		// 双向对只画一次，单向边去重
		if (seen.has(fwd) || (isBi && seen.has(rev))) continue;
		seen.add(fwd);

		out.push({
			id: randomNodeId(),
			fromNode: from.id,
			toNode: to.id,
			...edgeSides(from, to),
			toEnd: 'arrow',
			...(isBi ? { fromEnd: 'arrow', color: bidirColor } : {}),
		});
	}
	return out;
}
/**
 * 将卡片投放到 Canvas 白板。
 * 已打开某个 .canvas 时追加到该白板，否则新建一个。
 *
 * 传入 graph 且为单种子时用「种子居中」布局（左入右出、双链上下）；
 * 多种子退化为按层级分行；无 graph 退化为方形网格。
 */
export async function sendCardsToCanvas(
	app: App,
	cards: Card[],
	opts: {
		folder: string;
		activeCanvas?: TFile;
		ensureFolder: (folder: string) => Promise<void>;
		/** 引用关系图；提供时启用关系布局 + 连线 */
		graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
		/** 双链连线的颜色（Canvas 预设色号 1-6），默认蓝 */
		bidirectionalColor?: string;
	},
): Promise<TFile | null> {
	if (!cards.length) {
		new Notice(i18n.canvasNoCards);
		return null;
	}
	const bidirColor = opts.bidirectionalColor || '5';

	/** 生成节点与连线：单种子+graph 走居中布局，多种子走分层，否则走网格 */
	const layout = (
		targets: Card[],
		origin: { x: number; y: number },
	): { nodes: CanvasNode[]; edges: CanvasEdge[]; offsetX: number } => {
		if (opts.graph) {
			const keep = new Set(targets.map((c) => c.path));
			const graphNodes = opts.graph.nodes.filter((n) => keep.has(n.card.path));
			if (graphNodes.length) {
				const seedCount = graphNodes.filter((n) => n.depth === 0).length;
				if (seedCount === 1) {
					const { canvasNodes, idToNode, leftCols } = buildRadialNodes(graphNodes, origin);
					return {
						nodes: canvasNodes,
						edges: buildEdges(opts.graph.edges, idToNode, bidirColor),
						offsetX: leftCols * COL_STEP,
					};
				}
				const { canvasNodes, idToNode } = buildLayeredNodes(graphNodes, origin);
				return { nodes: canvasNodes, edges: buildEdges(opts.graph.edges, idToNode, bidirColor), offsetX: 0 };
			}
		}
		return { nodes: buildNodes(targets, origin), edges: [], offsetX: 0 };
	};

	// 追加到当前打开的白板
	if (opts.activeCanvas) {
		const raw = await app.vault.read(opts.activeCanvas);
		const data = parseCanvas(raw);
		const existing = new Set(data.nodes.filter((n) => n.type === 'file').map((n) => n.file));
		const fresh = cards.filter((c) => !existing.has(c.path));
		if (!fresh.length) {
			new Notice(i18n.canvasCreated(opts.activeCanvas.basename));
			return opts.activeCanvas;
		}
		const base = nextOrigin(data.nodes);
		const built = layout(fresh, base);
		// 居中布局会向左扩展出若干列（相对 base 的最左位置为 -offsetX）。
		// 整体右移，让最左一列落到已有内容右侧并留出间距，避免重叠。
		if (built.offsetX > 0) {
			let maxOldRight = -Infinity;
			for (const n of data.nodes) maxOldRight = Math.max(maxOldRight, (n.x ?? 0) + (n.width ?? 0));
			const minNewX = base.x - built.offsetX;
			const shift = Math.max(0, maxOldRight + GAP - minNewX);
			for (const n of built.nodes) n.x += shift;
		}
		data.nodes.push(...built.nodes);
		data.edges.push(...built.edges);
		await app.vault.modify(opts.activeCanvas, JSON.stringify(data, null, 2));
		new Notice(i18n.canvasCreated(opts.activeCanvas.basename));
		return opts.activeCanvas;
	}

	// 新建白板
	const folder = opts.folder.trim().replace(/^\/+|\/+$/g, '');
	await opts.ensureFolder(folder);
	const base = sanitizeFileName(`白板 ${toDayKey(Date.now())}`);
	let path = folder ? `${folder}/${base}.canvas` : `${base}.canvas`;
	if (app.vault.getAbstractFileByPath(path)) {
		const suffix = Date.now();
		path = folder ? `${folder}/${base}-${suffix}.canvas` : `${base}-${suffix}.canvas`;
	}
	const built = layout(cards, { x: 0, y: 0 });
	const data: CanvasData = { nodes: built.nodes, edges: built.edges };
	try {
		const file = await app.vault.create(path, JSON.stringify(data, null, 2));
		new Notice(i18n.canvasCreated(file.basename));
		return file;
	} catch (err) {
		new Notice(String(err));
		return null;
	}
}

/**
 * 从 .canvas 中读取卡片节点路径。
 * 若白板中存在选中节点无法通过公开 API 获知，因此返回全部卡片节点，
 * 按 y 再按 x 排序，与用户在白板上的视觉顺序一致（从上到下、从左到右）。
 */
export async function readCanvasCardPaths(app: App, file: TFile): Promise<string[]> {
	const raw = await app.vault.read(file);
	const data = parseCanvas(raw);
	return data.nodes
		.filter((n) => n.type === 'file' && typeof n.file === 'string' && n.file.endsWith('.md'))
		.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
		.map((n) => n.file as string);
}
