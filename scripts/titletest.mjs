// 测试 extractTitle 的各种 markdown 兜底场景
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const r = await build({
	entryPoints: ['src/view/CardTile.ts'],
	bundle: true,
	write: false,
	format: 'iife',
	globalName: 'CardTileMod',
	plugins: [
		{
			name: 'stub',
			setup(b) {
				b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
				b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
					contents: `export const setIcon = (el, name) => {}; export const getIcon = () => null;`,
					loader: 'js',
				}));
			},
		},
	],
});
const tileCode = r.outputFiles[0].text;
const css = await readFile('styles.css', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.setContent(`<!DOCTYPE html><html><body><style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;--interactive-accent:#5b6ee1;--radius-s:4px;
}
body{margin:0;padding:12px;font-family:system-ui,sans-serif;background:#fff}
${css}
</style><div id="host"></div></body></html>`);

const cards = [
	// 1. 有 title → 显示 title
	{ id: 't1', title: '明标题', snippet: '正文内容。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 2. 无 title，正文首行是 markdown 标题
	{ id: 't2', title: undefined, snippet: '# 真正的卡片标题\n这是正文内容。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 3. 无 title，正文首行是引用
	{ id: 't3', title: undefined, snippet: '> 这是引用作为首行\n正文第二段。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 4. 无 title，正文首行是列表
	{ id: 't4', title: undefined, snippet: '- 列表项作为首行\n继续内容。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 5. 无 title，正文首行有 markdown 标记（粗体、链接）
	{ id: 't5', title: undefined, snippet: '**粗体首行**与[链接](url)。\n正文。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 6. 无 title，正文完全为空
	{ id: 't6', title: undefined, snippet: '', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 7. 无 title，正文首行只有 markdown 标记无文字
	{ id: 't7', title: undefined, snippet: '#\n正文。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 8. 有 title 但首行还有正文（平铺模式 rest 应跳过全文）
	{ id: 't8', title: '显式标题', snippet: '首行正文\n第二行。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
	// 9. 纯文本无 markdown 前缀
	{ id: 't9', title: undefined, snippet: '今天是周三。\n继续记。', color: undefined, children: [], bodyLinks: [], archived: false, pinned: false, tags: [], created: Date.now(), updated: Date.now(), searchText: '', hasTaskList: false, mtime: Date.now() },
];

const result = await page.evaluate(async ({ code, cards }) => {
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

	const host = document.getElementById('host');
	const list = document.createElement('div');
	list.className = 'cardbox-list is-masonry';
	list.style.width = '360px';
	host.appendChild(list);
	const group = document.createElement('div');
	group.className = 'cardbox-masonry-group';
	const col = document.createElement('div');
	col.className = 'cardbox-masonry-col';
	group.appendChild(col);
	list.appendChild(group);

	const noop = () => {};
	cards.forEach((c) => {
		const tile = buildCardTile({
			card: c, depth: 0, selected: false, expanded: false, hasVisibleChildren: false,
			childCount: 0, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
		});
		col.appendChild(tile);
	});

	return [...document.querySelectorAll('.cardbox-tile')].map((t) => {
		const title = t.querySelector('.cardbox-tile-title');
		return {
			id: t.getAttribute('data-card-id'),
			titleText: title ? title.textContent : null,
			isEmpty: title ? title.classList.contains('is-empty') : false,
		};
	});
}, { code: tileCode, cards });

const expect = {
	t1: '明标题',
	t2: '真正的卡片标题',
	t3: '这是引用作为首行',
	t4: '列表项作为首行',
	t5: '粗体首行与链接。',
	t6: '空内容',
	t7: '空内容',     // 抽完只剩空，落到兜底
	t8: '显式标题',
	t9: '今天是周三。',
};

let pass = 0, fail = 0;
for (const r of result) {
	const e = expect[r.id];
	const ok = r.titleText === e;
	if (ok) pass++;
	else { fail++; console.log('FAIL:', r.id, '→', JSON.stringify(r.titleText), '期望', JSON.stringify(e)); }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);