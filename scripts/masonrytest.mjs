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

	// 平铺容器：主卡(展开) + 扩展卡 + 孙卡，模拟 buildCardItems 的输出顺序
	const list = document.createElement('div');
	list.className = 'cardbox-list is-masonry';
	document.getElementById('host').appendChild(list);

	const root = mkCard('root', '主卡片', { children: ['ext1'], color: 'blue' });
	const ext1 = mkCard('ext1', '扩展卡片一', { children: ['ext2'] });
	const ext2 = mkCard('ext2', '扩展卡片的扩展卡片', {});

	const tileRoot = buildCardTile({
		card: root, depth: 0, selected: false, expanded: true, hasVisibleChildren: true,
		childCount: 1, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileExt1 = buildCardTile({
		card: ext1, depth: 1, selected: false, expanded: true, hasVisibleChildren: true,
		childCount: 1, rich: true, parentTitle: '主卡片', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	const tileExt2 = buildCardTile({
		card: ext2, depth: 2, selected: false, expanded: false, hasVisibleChildren: false,
		childCount: 0, rich: true, parentTitle: '扩展卡片一', onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
	});
	list.append(tileRoot, tileExt1, tileExt2);
}, tileCode);

// 几何断言（手机视口 390px → 单列）
const metrics = await page.evaluate(() => {
	const list = document.querySelector('.cardbox-list.is-masonry');
	const tiles = [...list.querySelectorAll('.cardbox-tile')];
	const rects = tiles.map((t) => {
		const r = t.getBoundingClientRect();
		return {
			depth: t.style.getPropertyValue('--depth'),
			left: r.left,
			top: r.top,
			isChild: t.classList.contains('is-child'),
			borderLeft: getComputedStyle(t).borderLeftWidth,
			borderStyle: getComputedStyle(t).borderLeftStyle,
		};
	});
	// 用计算样式判断实际列数（缩进会干扰 left 统计）
	const gridCols = getComputedStyle(list).gridTemplateColumns.split(' ').length;
	return { rects, gridCols, listWidth: Math.round(list.getBoundingClientRect().width) };
});

const results = [];
const check = (name, cond, got) => results.push({ name, ok: !!cond, got });
const [root, ext1, ext2] = metrics.rects;

check('手机视口平铺为单列', metrics.gridCols === 1, metrics.gridCols);
check('主卡片 depth=0', root.depth === '0', root.depth);
check('扩展卡片 depth=1', ext1.depth === '1', ext1.depth);
check('孙卡片 depth=2', ext2.depth === '2', ext2.depth);
check('扩展卡片相对主卡缩进', ext1.left > root.left + 10, { root: root.left, ext1: ext1.left });
check('孙卡片相对扩展卡片再缩进', ext2.left > ext1.left + 10, { ext1: ext1.left, ext2: ext2.left });
check('扩展卡片有左侧竖线', ext1.isChild && ext1.borderLeft === '3px' && ext1.borderStyle !== 'none', ext1);
check('主卡片无竖线', !root.isChild, root.isChild);
check('层级顺序自上而下', root.top < ext1.top && ext1.top < ext2.top, { root: root.top, ext1: ext1.top, ext2: ext2.top });

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
