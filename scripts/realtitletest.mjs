// 用测试库真实卡片文件渲染平铺视图，检查 title 显示
// 用法: node scripts/realtitletest.mjs
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from 'esbuild';

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
					contents: `export const setIcon = (el, name) => { const s = document.createElement('span'); s.textContent = '·'; el.appendChild(s); };
export const getIcon = (n) => (n === 'more-vertical' ? {} : null);`,
					loader: 'js',
				}));
			},
		},
	],
});
const tileCode = r.outputFiles[0].text;
const css = await readFile('styles.css', 'utf8');

// 读测试库真实卡片（含 frontmatter 解析）
const files = (await readdir('test-vault/Cards')).filter((f) => f.endsWith('.md')).slice(0, 20);
const cards = [];
for (const f of files) {
	const raw = await readFile(`test-vault/Cards/${f}`, 'utf8');
	const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
	let fm = {};
	if (fmMatch) {
		for (const line of fmMatch[1].split('\n')) {
			const m = line.match(/^(\w+):\s*(.*)$/);
			if (m) fm[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
		}
	}
	const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
	cards.push({
		id: f.replace('.md', ''),
		path: `Cards/${f}`,
		title: fm.title,
		tags: [],
		created: Date.now(),
		updated: Date.now(),
		children: [],
		bodyLinks: [],
		archived: fm.archived === 'true',
		pinned: fm.pinned === 'true',
		color: fm.color,
		snippet: body.trim().slice(0, 200),
		searchText: '',
		hasTaskList: false,
		mtime: Date.now(),
	});
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.setContent(`<!DOCTYPE html><html><body>
<style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;
--text-on-accent:#fff;--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
--font-interface:system-ui,"Microsoft YaHei",sans-serif;
}
body{margin:0;padding:12px;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eceff3}
${css}
</style>
<div id="host"></div>
</body></html>`);

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

	const list = document.createElement('div');
	list.className = 'cardbox-list is-masonry';
	list.style.width = '360px';
	document.getElementById('host').appendChild(list);
	const group = document.createElement('div');
	group.className = 'cardbox-masonry-group';
	const col1 = document.createElement('div');
	col1.className = 'cardbox-masonry-col';
	const col2 = document.createElement('div');
	col2.className = 'cardbox-masonry-col';
	group.append(col1, col2);
	list.appendChild(group);

	const noop = () => {};
	cards.forEach((card, i) => {
		const tile = buildCardTile({
			card, depth: 0, selected: false, expanded: false, hasVisibleChildren: false,
			childCount: 0, rich: true, onClick: noop, onLongPress: noop, onToggleExpand: noop, onKebab: noop,
		});
		(i % 2 ? col2 : col1).appendChild(tile);
	});

	// 统计：有多少卡片的 title 元素是「可见且有内容」的
	return {
		total: cards.length,
		withTitleField: cards.filter((c) => !!c.title).length,
		rendered: [...document.querySelectorAll('.cardbox-tile')].map((t) => {
			const title = t.querySelector('.cardbox-tile-title');
			const cs = title ? getComputedStyle(title) : null;
			const r = title ? title.getBoundingClientRect() : null;
			return {
				id: t.getAttribute('data-card-id'),
				text: title ? title.textContent : null,
				visible: !!(r && r.width > 0 && r.height > 0),
				display: cs ? cs.display : null,
				height: r ? Math.round(r.height) : 0,
			};
		}),
	};
}, { code: tileCode, cards });

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'shot-real-title.png', fullPage: false });
await browser.close();
