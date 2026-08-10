/**
 * 手机端平铺视图层级验证：
 * 渲染 is-masonry 容器，主卡 depth0 + 扩展卡 depth1 + 孙卡 depth2，
 * 用手机视口 + is-mobile 类检查子卡的缩进与层级竖线是否生效。
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import esbuild from 'esbuild';

const css = await readFile('styles.css', 'utf8');
const stub = `export const setIcon = (el, name) => {
	const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
	svg.setAttribute('data-icon', name);
	svg.setAttribute('viewBox','0 0 24 24');
	svg.style.width='14px'; svg.style.height='14px';
	const p = document.createElementNS('http://www.w3.org/2000/svg','path');
	p.setAttribute('d', name==='chevron-down' ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6');
	p.setAttribute('fill','none'); p.setAttribute('stroke','currentColor'); p.setAttribute('stroke-width','2');
	svg.appendChild(p);
	el.appendChild(svg);
};`;
const built = await esbuild.build({
	entryPoints: ['src/view/CardTile.ts'],
	bundle: true,
	write: false,
	format: 'iife',
	globalName: 'CardTileMod',
	platform: 'browser',
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
const tileCode = built.outputFiles[0].text;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.setContent(`<!DOCTYPE html><html><body>
<style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;
--text-on-accent:#fff;--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
--cardbox-col-min:260px;
}
body{margin:0;padding:12px;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eceff3}
body.is-mobile{}
.frame{background:#fff;border:1px solid #dcdcdc;border-radius:10px;padding:8px}
${css}
</style>
<div id="host"></div>
</body></html>`);

await page.evaluate((code) => {
	// 真实手机端 Obsidian 会给 body 加 is-mobile，测试必须模拟，
	// 否则只有 @media 分支生效、body.is-mobile 下的规则测不到（曾漏测kebab 定位）
	document.body.classList.add('is-mobile');
	const applyOpts = (el, o) => {
		if (!o) return el;
		if (typeof o === 'string') { el.className = o; return el; }
		if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
		if (o.text !== undefined) el.textContent = o.text;
		if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
		return el;
	};
	const mk = (tag, o) => applyOpts(document.createElement(tag), o);
	Element.prototype.createEl = function (tag, o) { const e = mk(tag, o); this.appendChild(e); return e; };
	Element.prototype.createDiv = function (o) { return this.createEl('div', o); };
	Element.prototype.createSpan = function (o) { return this.createEl('span', o); };
	Element.prototype.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	Element.prototype.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	Element.prototype.setText = function (x) { this.textContent = x; };
	Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	window.createDiv = (o) => mk('div', o);
	window.createSpan = (o) => mk('span', o);
	window.createEl = mk;

	const s = document.createElement('script');
	s.textContent = code;
	document.head.appendChild(s);
	const { buildCardTile } = window.CardTileMod;

	const mkCard = (id, title, opts = {}) => ({
		id, path: `Cards/${id}.md`, title, tags: [], created: Date.now(), updated: Date.now(),
		children: opts.children ?? [], bodyLinks: [], archived: false, pinned: false,
		color: opts.color, snippet: opts.snippet ?? '这是正文内容',
		searchText: '', hasTaskList: false, mtime: Date.now(),
	});
	const noop = () => {};

	// 平铺容器：两张顶层主卡 + 主卡A 的扩展树（展开后子卡跨整行）
	const list = document.createElement('div');
	list.className = 'cardbox-list is-masonry';
	document.getElementById('host').appendChild(list);

	const cardA = mkCard('a', '主卡A', { color: 'blue' });
	const cardB = mkCard('b', '主卡B');
	const cardC = mkCard('c', '主卡C', { color: 'green' });
	const ext1 = mkCard('ext1', '扩展卡片一', { children: ['ext2'] });
	const ext2 = mkCard('ext2', '扩展卡片的扩展卡片', {});

	// 用 buildItem 模拟 buildCardItems 的输出顺序（深度优先展平）
	const tileA = buildCardTile({
		card: cardA, depth: 0, selected: false, expanded: true, hasVisibleChildren: true,
		childCount: 1, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileB = buildCardTile({
		card: cardB, depth: 0, selected: false, expanded: false, hasVisibleChildren: false,
		childCount: 0, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileC = buildCardTile({
		card: cardC, depth: 0, selected: false, expanded: false, hasVisibleChildren: false,
		childCount: 0, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileExt1 = buildCardTile({
		card: ext1, depth: 1, selected: false, expanded: true, hasVisibleChildren: true,
		childCount: 1, rich: true, parentTitle: '主卡A', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileExt2 = buildCardTile({
		card: ext2, depth: 2, selected: false, expanded: false, hasVisibleChildren: false,
		childCount: 0, rich: true, parentTitle: '扩展卡片一', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	list.append(tileA, tileB, tileC, tileExt1, tileExt2);
}, tileCode);

// 几何断言（手机视口 390px → 双列平铺；子卡片占整行）
const metrics = await page.evaluate(() => {
	const list = document.querySelector('.cardbox-list.is-masonry');
	const tiles = [...list.querySelectorAll('.cardbox-tile')];
	const rects = tiles.map((t) => {
		const r = t.getBoundingClientRect();
		return {
			depth: t.style.getPropertyValue('--depth'),
			left: r.left,
			top: r.top,
			width: r.width,
			isChild: t.classList.contains('is-child'),
			borderLeft: getComputedStyle(t).borderLeftWidth,
			borderStyle: getComputedStyle(t).borderLeftStyle,
			// maxHeight/overflow 已从 .cardbox-tile 移到 .cardbox-tile-main（避免 grid 行高塌缩）
			mainMaxHeight: (() => { const m = t.querySelector('.cardbox-tile-main'); return m ? getComputedStyle(m).maxHeight : ''; })(),
			mainOverflow: (() => { const m = t.querySelector('.cardbox-tile-main'); return m ? getComputedStyle(m).overflow : ''; })(),
		};
	});
	// 重叠检测：双列平铺下不能有卡片重叠
	// （曾踩坑：max-height+overflow 在 .cardbox-tile 上让 chromium 把 grid 行高算成 ~0）
	const overlapPairs = [];
	for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
		const A = rects[i];
		const B = rects[j];
		if (Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1) > 1 &&
			Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1) > 1) overlapPairs.push([A, B]);
	}
	// 用计算样式判断实际列数（缩进会干扰 left 统计）
	const gridCols = getComputedStyle(list).gridTemplateColumns.split(' ').length;
	// 平铺模式（rich）结构断言：关联行应独立在正文下方，kebab 绝对定位在右上
	const relatedRow = document.querySelector('.cardbox-tile.is-rich .cardbox-tile-related');
	const kebab = document.querySelector('.cardbox-tile.is-rich .cardbox-more-btn');
	const structure = {
		hasRelatedRow: !!relatedRow,
		// 关联行里应包含展开按钮（而非留在卡片最左侧）
		expandInRelated: !!(relatedRow && relatedRow.querySelector('.cardbox-expand-wrap')),
		expandAtTileLeft: !!document.querySelector('.cardbox-tile.is-rich > .cardbox-tile-main > .cardbox-expand-wrap'),
		kebabPosition: kebab ? getComputedStyle(kebab).position : null,
	};

	return { rects, gridCols, listWidth: Math.round(list.getBoundingClientRect().width), overlapPairs: overlapPairs.length, structure };
});

const results = [];
const check = (name, cond, got) => results.push({ name, ok: !!cond, got });
// tileA 是展开的主卡（带子卡），tileB/tileC 是独立的顶层卡
const tileA = metrics.rects[0];
const tileB = metrics.rects[1];
const tileC = metrics.rects[2];
const tileExt1 = metrics.rects[3];
const tileExt2 = metrics.rects[4];

check('手机视口平铺为双列', metrics.gridCols === 2, metrics.gridCols);
// 双列布局：顶层 3 张主卡应排成 2 行 2 列（即至少有一行含 2 张）
const topRow = metrics.rects.slice(0, 3).filter((t) => t.top === tileA.top);
check('顶层主卡至少 2 张排在同一行（双列）', topRow.length >= 2, topRow.map((t) => t.top));
check('顶层主卡按行排列，子卡在主卡下方（不混在顶层行）', (() => {
	const topTop = Math.min(...metrics.rects.slice(0, 3).map((t) => t.top));
	return tileExt1.top > topTop;
})());
check('主卡 A 的子卡（扩展一）占满整行', tileExt1.width > metrics.listWidth * 0.8,
	{ ext1w: Math.round(tileExt1.width), listW: metrics.listWidth });
check('子卡相对主卡缩进', tileExt1.left > tileA.left + 10,
	{ mainLeft: tileA.left, extLeft: tileExt1.left });
check('孙卡相对子卡再缩进', tileExt2.left > tileExt1.left + 10,
	{ ext1: tileExt1.left, ext2: tileExt2.left });
check('子卡有左侧竖线', tileExt1.isChild && tileExt1.borderLeft === '3px' && tileExt1.borderStyle !== 'none', tileExt1);
check('顶层主卡无竖线', !tileA.isChild && !tileB.isChild && !tileC.isChild, { a: tileA.isChild, b: tileB.isChild, c: tileC.isChild });
check('子卡在主卡下方', tileA.top < tileExt1.top && tileExt1.top < tileExt2.top,
	{ main: tileA.top, ext1: tileExt1.top, ext2: tileExt2.top });
check('卡片高度上限在 .cardbox-tile-main', metrics.rects[0].mainMaxHeight === '360px', metrics.rects[0].mainMaxHeight);
check('卡片超出隐藏在 .cardbox-tile-main', metrics.rects[0].mainOverflow === 'hidden', metrics.rects[0].mainOverflow);
check('平铺卡片无重叠（grid 行高未塌缩）', metrics.overlapPairs === 0, metrics.overlapPairs);
// 参考图布局：关联行独立在正文下方（不再挤占左侧），kebab 绝对定位到右上角
check('平铺存在独立关联行', metrics.structure.hasRelatedRow, metrics.structure);
check('展开按钮在关联行内', metrics.structure.expandInRelated, metrics.structure);
check('展开按钮不再占卡片左侧', !metrics.structure.expandAtTileLeft, metrics.structure);
check('kebab 绝对定位（右上角）', metrics.structure.kebabPosition === 'absolute', metrics.structure.kebabPosition);

let pass = 0;
let fail = 0;
for (const item of results) {
	if (item.ok) pass++;
	else {
		fail++;
		console.log('FAIL:', item.name, item.got !== undefined ? `→ ${JSON.stringify(item.got)}` : '');
	}
}
if (pageErrors.length) {
	console.log('\n未捕获异常:');
	for (const e of pageErrors) console.log('  ' + e);
}
console.log(`\n${pass} passed, ${fail} failed`);
await page.screenshot({ path: 'shot-mobile-masonry.png' });
await browser.close();
process.exit(fail || pageErrors.length ? 1 : 0);
