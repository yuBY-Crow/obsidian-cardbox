import { App, Notice, TFile } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, CardColor } from '../types';
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

interface CanvasData {
	nodes: CanvasNode[];
	edges: unknown[];
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
			edges: Array.isArray(data.edges) ? data.edges : [],
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
 * 将卡片投放到 Canvas 白板。
 * 已打开某个 .canvas 时追加到该白板，否则新建一个。
 */
export async function sendCardsToCanvas(
	app: App,
	cards: Card[],
	opts: { folder: string; activeCanvas?: TFile; ensureFolder: (folder: string) => Promise<void> },
): Promise<TFile | null> {
	if (!cards.length) {
		new Notice(i18n.canvasNoCards);
		return null;
	}

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
		data.nodes.push(...buildNodes(fresh, nextOrigin(data.nodes)));
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
	const data: CanvasData = { nodes: buildNodes(cards, { x: 0, y: 0 }), edges: [] };
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
