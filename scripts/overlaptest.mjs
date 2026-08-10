/**
 * 手机端双列平铺重叠检测：
 * 渲染真实卡片（不同内容长度），检查任意两张卡片是否重叠。
 * 之前 masonrytest 只断言了列数/缩进，没检查重叠——用户真机发现问题。
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
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#fff}
body.is-mobile{}
${css}
</style>
<div id="host"></div>
</body></html>`);

// 模拟 Obsidian 移动端：body 加 is-mobile 类（真机必有）
await page.evaluate(() => document.body.classList.add('is-mobile'));

await page.evaluate((code) => {
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
		id, path: `Cards/${id}.md`, title, tags: opts.tags ?? [], created: Date.now(), updated: Date.now(),
		children: opts.children ?? [], bodyLinks: [], archived: false, pinned: false,
		color: opts.color, snippet: opts.snippet ?? '这是正文内容',
		searchText: '', hasTaskList: false, mtime: Date.now(),
	});
	const noop = () => {};

	const list = document.createElement('div');
	list.className = 'cardbox-list is-masonry';
	list.style.height = 'auto';
	document.getElementById('host').appendChild(list);

	// 10 张不同内容长度的卡片 + 1 棵展开树
	const cards = [];
	const longSnippet = '很长很长'.repeat(60) + ' 的正文内容，用来测试卡片高度自适应与渐隐截断效果。';
	const midSnippet = '中等长度正文。'.repeat(30);
	for (let i = 0; i < 10; i++) {
		const c = mkCard(`c${i}`, `卡片 ${i}`, {
			color: ['red', 'blue', 'green', 'purple'][i % 4],
			snippet: i % 3 === 0 ? longSnippet : i % 3 === 1 ? midSnippet : '短卡片内容。',
		});
		cards.push(c);
		const tile = buildCardTile({
			card: c, depth: 0, selected: false, expanded: false, hasVisibleChildren: false,
			childCount: 0, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
		});
		list.appendChild(tile);
	}
	// 一棵展开树：主卡 + 子卡（跨整行）
	const root = mkCard('root', '主卡片', { children: ['ext1'], color: 'blue' });
	const ext1 = mkCard('ext1', '扩展卡片一', { children: ['ext2'], snippet: longSnippet });
	const ext2 = mkCard('ext2', '扩展卡片的扩展卡片', {});
	const tree = [
		buildCardTile({ card: root, depth: 0, selected: false, expanded: true, hasVisibleChildren: true, childCount: 1, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop }),
		buildCardTile({ card: ext1, depth: 1, selected: false, expanded: true, hasVisibleChildren: true, childCount: 1, rich: true, parentTitle: '主卡片', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop }),
		buildCardTile({ card: ext2, depth: 2, selected: false, expanded: false, hasVisibleChildren: false, childCount: 0, rich: true, parentTitle: '扩展卡片一', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop }),
	];
	for (const t of tree) list.appendChild(t);
}, tileCode);

// 检查重叠
const result = await page.evaluate(() => {
	const tiles = [...document.querySelectorAll('.cardbox-list.is-masonry .cardbox-tile')];
	const rects = tiles.map((t) => {
		const r = t.getBoundingClientRect();
		return {
			id: t.getAttribute('data-card-id'),
			x1: r.left, y1: r.top, x2: r.right, y2: r.bottom,
			w: r.width, h: r.height,
		};
	});
	// 两两检测重叠（允许边界接触 1px）
	const overlaps = [];
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const A = rects[i];
			const B = rects[j];
			const ox = Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1);
			const oy = Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1);
			if (ox > 1 && oy > 1) {
				overlaps.push({ a: A.id, b: B.id, ox: Math.round(ox), oy: Math.round(oy), A: { x1: A.x1, y1: A.y1, x2: A.x2, y2: A.y2 }, B: { x1: B.x1, y1: B.y1, x2: B.x2, y2: B.y2 } });
			}
		}
	}
	const gridCols = getComputedStyle(document.querySelector('.cardbox-list.is-masonry')).gridTemplateColumns.split(' ').length;
	return { total: rects.length, gridCols, overlaps, heights: rects.map((r) => Math.round(r.h)).slice(0, 12) };
});

console.log('总卡片:', result.total, '列数:', result.gridCols);
console.log('高度分布:', result.heights.join(', '));
if (result.overlaps.length) {
	console.log('\n!!! 发现重叠:');
	for (const o of result.overlaps.slice(0, 10)) {
		console.log(`  ${o.a} 与 ${o.b} 重叠 ${o.ox}×${o.oy}px`);
		console.log(`    A(${o.a}): x[${o.A.x1},${o.A.x2}] y[${o.A.y1},${o.A.y2}]`);
		console.log(`    B(${o.b}): x[${o.B.x1},${o.B.x2}] y[${o.B.y1},${o.B.y2}]`);
	}
} else {
	console.log('无重叠 ✓');
}
await page.screenshot({ path: 'shot-mobile-overlap.png' });
if (pageErrors.length) console.log('pageErrors:', pageErrors);
await browser.close();
process.exit(result.overlaps.length || pageErrors.length ? 1 : 0);
