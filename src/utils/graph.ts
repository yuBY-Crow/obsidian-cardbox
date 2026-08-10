/**
 * 卡片引用关系图遍历。
 *
 * 卡片之间的引用有两个方向：
 *   出链（outgoing）：当前卡片引用的卡片 = children（显式关联）+ bodyLinks（正文双链）
 *   入链（incoming）：引用当前卡片的卡片 = 反查其他卡片的 children / bodyLinks
 *
 * 「投放到白板」需要按层级把关联网络一起带上，所以这里做的是 BFS 分层遍历：
 * depth 0 是种子卡片，depth 1 是它的直接关联，以此类推。
 *用 BFS 而非 DFS，是为了让depth 表示「到种子的最短引用距离」——
 * 这才是用户说的「引用层级」的直觉含义（DFS 会给出偏大的层级）。
 */

import type { Card } from '../types';

/** 遍历方向 */
export type LinkDirection = 'outgoing' | 'incoming' | 'both';

/** 图遍历所需的最小查询能力（便于脱离 Obsidian 单测） */
export interface GraphSource {
	getById(id: string): Card | undefined;
	/** 当前卡片引用的卡片（去重，顺序：显式关联在前） */
	outgoingIds(card: Card): string[];
	/** 引用当前卡片的卡片 id */
	incomingIds(card: Card): string[];
}

export interface GraphNode {
	card: Card;
	/** 到种子卡片的最短引用距离；种子为 0 */
	depth: number;
	/** 该卡片是通过哪个方向被纳入的；种子为 'seed' */
	via: 'seed' | 'outgoing' | 'incoming';
}

export interface GraphEdge {
	/** 引用方 */
	fromId: string;
	/** 被引用方 */
	toId: string;
}

export interface GraphResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

/** 默认取出链：children 在前（顺序有意义），正文双链追加，去重 */
export function defaultOutgoingIds(card: Card): string[] {
	const out: string[] = [];
	for (const id of card.children) if (id && !out.includes(id)) out.push(id);
	for (const id of card.bodyLinks) if (id && !out.includes(id)) out.push(id);
	return out;
}

/**
 * 从若干种子卡片出发，按方向与层级收集关联卡片。
 *
 * @param seeds种子卡片（depth 0）
 * @param source    图查询能力
 * @param direction 只看出链 / 只看入链 / 双向
 * @param maxDepth  最大层级；0 表示只要种子本身
 * @param maxNodes  节点上限，防止在稠密图上炸出上千个节点
 */
export function collectLinkedCards(
	seeds: Card[],
	source: GraphSource,
	direction: LinkDirection,
	maxDepth: number,
	maxNodes = 200,
): GraphResult {
	const nodes: GraphNode[] = [];
	const byId = new Map<string, GraphNode>();
	const edgeKeys = new Set<string>();
	const edges: GraphEdge[] = [];

	const addEdge = (fromId: string, toId: string) => {
		if (fromId === toId) return;
		const key = `${fromId}\u0000${toId}`;
		if (edgeKeys.has(key)) return;
		edgeKeys.add(key);
		edges.push({ fromId, toId });
	};

	// 种子入队（去重，保持传入顺序）
	let frontier: Card[] = [];
	for (const seed of seeds) {
		if (byId.has(seed.id)) continue;
		const node: GraphNode = { card: seed, depth: 0, via: 'seed' };
		byId.set(seed.id, node);
		nodes.push(node);
		frontier.push(seed);
	}

	const depthLimit = Math.max(0, Math.floor(maxDepth));
	const wantOut = direction === 'outgoing' || direction === 'both';
	const wantIn = direction === 'incoming' || direction === 'both';

	for (let depth = 1; depth <= depthLimit && frontier.length; depth++) {
		const next: Card[] = [];
		for (const cur of frontier) {
			if (wantOut) {
				for (const id of source.outgoingIds(cur)) {
					const target = source.getById(id);
					// 目标卡片可能不存在（断链）；边也不画，避免 Canvas 出现悬空节点
					if (!target) continue;
					addEdge(cur.id, target.id);
					if (byId.has(target.id)) continue;
					if (nodes.length >= maxNodes) continue;
					const node: GraphNode = { card: target, depth, via: 'outgoing' };
					byId.set(target.id, node);
					nodes.push(node);
					next.push(target);
				}
			}
			if (wantIn) {
				for (const id of source.incomingIds(cur)) {
					const target = source.getById(id);
					if (!target) continue;
					// 入链方向：target 引用了 cur
					addEdge(target.id, cur.id);
					if (byId.has(target.id)) continue;
					if (nodes.length >= maxNodes) continue;
					const node: GraphNode = { card: target, depth, via: 'incoming' };
					byId.set(target.id, node);
					nodes.push(node);
					next.push(target);
				}
			}
		}
		frontier = next;
	}

	// 补全已收集节点之间的边：
	// BFS 只在「扩张那一步」记录了边，同层节点之间的既有引用会漏掉。
	// 白板上需要把这些连线也画出来，关系网才完整。
	for (const node of nodes) {
		for (const id of source.outgoingIds(node.card)) {
			if (byId.has(id)) addEdge(node.card.id, id);
		}
	}

	return { nodes, edges };
}

/** 预估：在给定方向与层级下会投放多少张卡片（供UI 实时提示） */
export function countLinkedCards(
	seeds: Card[],
	source: GraphSource,
	direction: LinkDirection,
	maxDepth: number,
	maxNodes = 200,
): number {
	return collectLinkedCards(seeds, source, direction, maxDepth, maxNodes).nodes.length;
}
