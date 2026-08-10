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
	toNode: string;
	toSide: 'top' | 'right' | 'bottom' | 'left';
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
 * 按引用层级分行排布：depth 0（种子）在最上一行，depth 1 在下一行，以此类推。
 * 每一行内水平居中对齐，这样白板打开时就是一张自上而下的关系树，
 * 比方形网格更能体现「引用层级」。
 */
function buildLayeredNodes(
	nodes: GraphNode[],
	origin: { x: number; y: number },
): { canvasNodes: CanvasNode[]; idToNodeId: Map<string, string> } {
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
	const idToNodeId = new Map<string, string>();

	depths.forEach((depth, rowIndex) => {
		const row = byDepth.get(depth) as GraphNode[];
		const rowWidth = row.length * NODE_W + (row.length - 1) * GAP;
		// 行内居中：与最宽的一行对齐中线
		const startX = origin.x + Math.round((totalWidth - rowWidth) / 2);
		const y = origin.y + rowIndex * (NODE_H +ROW_GAP);
		row.forEach((n, i) => {
			const nodeId = randomNodeId();
			idToNodeId.set(n.card.id, nodeId);
			const node: CanvasNode = {
				id: nodeId,
				type: 'file',
				file: n.card.path,
				x: startX + i * (NODE_W + GAP),
				y,
				width: NODE_W,
				height: NODE_H,
			};
			if (n.card.color) {
				const c = COLOR_MAP[n.card.color];
				if (c) node.color = c;
			}
			canvasNodes.push(node);
		});
	});

	return { canvasNodes, idToNodeId };
}

/** 把卡片间的引用关系转成 Canvas 连线（引用方底部 → 被引用方顶部） */
function buildEdges(edges: GraphEdge[], idToNodeId: Map<string, string>): CanvasEdge[] {
	const out: CanvasEdge[] = [];
	const seen = new Set<string>();
	for (const e of edges) {
		const from = idToNodeId.get(e.fromId);
		const to = idToNodeId.get(e.toId);
		// 只画两端都在白板上的连线，避免 Canvas 出现指向空节点的坏边
		if (!from || !to || from === to) continue;
		const key = `${from}\u0000${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: randomNodeId(), fromNode: from, fromSide: 'bottom', toNode: to, toSide: 'top' });
	}
	return out;
}

/**
 * 将卡片投放到 Canvas 白板。
 * 已打开某个 .canvas 时追加到该白板，否则新建一个。
 *
 *传入 graph 时按引用层级分行排布并画出关系连线；
 * 否则退化为方形网格（无关联信息的纯卡片列表）。
 */
export async function sendCardsToCanvas(
	app: App,
	cards: Card[],
	opts: {
		folder: string;
		activeCanvas?: TFile;
		ensureFolder: (folder: string) => Promise<void>;
		/** 引用关系图；提供时启用分层排布 + 连线 */
		graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
	},
): Promise<TFile | null> {
	if (!cards.length) {
		new Notice(i18n.canvasNoCards);
		return null;
	}

	/** 生成节点与连线：有 graph 走分层，否则走网格 */
	const layout = (
		targets: Card[],
		origin: { x: number; y: number },
	): { nodes: CanvasNode[]; edges: CanvasEdge[] } => {
		if (opts.graph) {
			const keep = new Set(targets.map((c) => c.path));
			const graphNodes = opts.graph.nodes.filter((n) => keep.has(n.card.path));
			if (graphNodes.length) {
				const { canvasNodes, idToNodeId } = buildLayeredNodes(graphNodes, origin);
				return { nodes: canvasNodes, edges: buildEdges(opts.graph.edges, idToNodeId) };
			}
		}
		return { nodes: buildNodes(targets, origin), edges: [] };
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
		const built = layout(fresh, nextOrigin(data.nodes));
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
