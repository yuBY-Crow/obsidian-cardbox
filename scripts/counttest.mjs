/**
 * 关联数量渲染验证：确认展开按钮旁真的显示了数量，并截图确认视觉。
 *
 * 这里不走完整插件加载，而是直接渲染 CardTile ——
 * 目的是精确控制 childCount 与 hasVisibleChildren 的组合，
 * 覆盖「可展开时数量在按钮旁」「不可展开时数量回落到 meta 行」两条分支。
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import esbuild from 'esbuild';

const css = await readFile('styles.css', 'utf8');

// 把 CardTile 单独打包，obsidian 依赖用 stub 顶掉
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
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.setContent(`<!DOCTYPE html><html><body>
<style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-hover:#ececec;--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;
--text-on-accent:#fff;--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
--color-red:#e05252;--color-blue:#3a7fd5;--color-green:#3fa653;
}
body{margin:0;padding:20px;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eceff3}
h3{font-size:14px;font-weight:500;margin:0 0 8px}
.frame{background:#fff;border:1px solid #dcdcdc;border-radius:10px;padding:8px;margin-bottom:20px}
${css}
</style>
<div id="host"></div>
</body></html>`);

const result = await page.evaluate(
	({ code }) => {
		const log = [];
		const t = (name, cond, got) => log.push({ name, ok: !!cond, got });

		// DOM 原型扩展
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
		window.createDiv = (o) => mk('div', o);
		window.createSpan = (o) => mk('span', o);
		window.createEl = mk;

		// IIFE 打包产物的 globalName 用 var 声明，
		// new Function 内的 var 不会挂到 window，必须用 script 标签注入。
		const s = document.createElement('script');
		s.textContent = code;
		document.head.appendChild(s);
		const { buildCardTile } = window.CardTileMod;

		const card = (over = {}) => ({
			id: over.id ?? 'c1',
			path: 'Cards/c1.md',
			title: over.title,
			tags: over.tags ?? ['读书/笔记'],
			created: Date.now(),
			updated: Date.now(),
			children: over.children ?? [],
			bodyLinks: over.bodyLinks ?? [],
			archived: false,
			pinned: over.pinned ?? false,
			color: over.color,
			snippet: over.snippet ?? '这是卡片正文的第一行内容',
			searchText: '',
			hasTaskList: false,
			mtime: Date.now(),
		});
		const noop = () => {};
		const render = (opts) =>
			buildCardTile({
				depth: 0,
				selected: false,
				expanded: false,
				hasVisibleChildren: false,
				onClick: noop,
				onLongPress: noop,
				onToggleExpand: noop,
				onKebab: noop,
				...opts,
			});

		const host = document.getElementById('host');
		const section = (title) => {
			const h = document.createElement('h3');
			h.textContent = title;
			host.appendChild(h);
			const f = document.createElement('div');
			f.className = 'frame';
			host.appendChild(f);
			return f;
		};

		// --- 分支 1：可展开 + 有关联数量 ---
		const f1 = section('可展开：数量显示在展开按钮旁');
		const tile1 = render({
			card: card({ title: '卡片笔记写作法：核心框架', color: 'blue', pinned: true }),
			childCount: 4,
			hasVisibleChildren: true,
		});
		f1.appendChild(tile1);
		const wrap1 = tile1.querySelector('.cardbox-expand-wrap');
		const cnt1 = tile1.querySelector('.cardbox-expand-count');
		t('展开按钮包了wrap', !!wrap1);
		t('按钮旁显示数量', cnt1 && cnt1.textContent === '4', cnt1 && cnt1.textContent);
		t('meta 行不再重复显示角标', !tile1.querySelector('.cardbox-child-badge'));
		t('数量有无障碍标签', cnt1 && /4/.test(cnt1.getAttribute('aria-label') ?? ''), cnt1 && cnt1.getAttribute('aria-label'));
		// 位置关系：数量必须在展开按钮右侧、且在标题左侧
		{
			const btn = tile1.querySelector('.cardbox-expand-btn').getBoundingClientRect();
			const num = cnt1.getBoundingClientRect();
			const title = tile1.querySelector('.cardbox-tile-title').getBoundingClientRect();
			t('数量在按钮右侧', num.left >= btn.right - 1, { btnRight: btn.right, numLeft: num.left });
			t('数量在标题左侧', num.right <= title.left + 1, { numRight: num.right, titleLeft: title.left });
			t('数量可见（有尺寸）', num.width > 8 && num.height > 8, num);
		}

		// --- 分支 2：展开态图标切换 ---
		const f2 = section('展开态：图标变为向下箭头');
		const tile2 = render({
			card: card({ title: '已展开的主卡片', color: 'green' }),
			childCount: 12,
			hasVisibleChildren: true,
			expanded: true,
		});
		f2.appendChild(tile2);
		const icon2 = tile2.querySelector('.cardbox-expand-btn svg');
		t('展开态用chevron-down', icon2 && icon2.getAttribute('data-icon') === 'chevron-down', icon2 && icon2.getAttribute('data-icon'));
		t('两位数数量也能显示', tile2.querySelector('.cardbox-expand-count').textContent === '12');

		// --- 分支 3：有关联但不可展开（被筛选挡住）→ 回落 meta 行 ---
		const f3 = section('有关联但不可展开：数量回落到 meta 行');
		const tile3 = render({
			card: card({ title: '关联卡片被筛选条件挡住' }),
			childCount: 3,
			hasVisibleChildren: false,
		});
		f3.appendChild(tile3);
		t('无展开按钮', !tile3.querySelector('.cardbox-expand-btn'));
		t('数量回落到 meta 角标', tile3.querySelector('.cardbox-child-badge')?.textContent === '3',
			tile3.querySelector('.cardbox-child-badge')?.textContent);

		// --- 分支 4：无关联 ---
		const f4 = section('无关联：不显示任何数量');
		const tile4 = render({ card: card({ title: '孤立卡片' }), childCount: 0, hasVisibleChildren: false });
		f4.appendChild(tile4);
		t('无关联不显示 count', !tile4.querySelector('.cardbox-expand-count'));
		t('无关联不显示 badge', !tile4.querySelector('.cardbox-child-badge'));

		// --- 分支 5：可展开但数量为 0（理论边界）---
		const tile5 = render({ card: card({ title: '边界' }), childCount: 0, hasVisibleChildren: true });
		t('可展开但数量 0 时不渲染数字', !tile5.querySelector('.cardbox-expand-count'));

		// --- 分支 6：点击数量也能触发展开 ---
		let toggled = 0;
		const tile6 = render({
			card: card({ title: '点击数字也能展开' }),
			childCount: 2,
			hasVisibleChildren: true,
			onToggleExpand: () => toggled++,
		});
		document.body.appendChild(tile6);
		tile6.querySelector('.cardbox-expand-count').click();
		t('点击数字触发展开回调', toggled === 1, toggled);
		tile6.querySelector('.cardbox-expand-btn').click();
		t('点击按钮也触发（不重复）', toggled === 2, toggled);
		tile6.remove();

		return { log };
	},
	{ code: tileCode },
);

let pass = 0;
let fail = 0;
for (const item of result.log) {
	if (item.ok) pass++;
	else {
		fail++;
		console.log('FAIL:', item.name, item.got !== undefined ? `→ ${JSON.stringify(item.got)}` : '');
	}
}
await page.locator('#host').screenshot({ path: 'shot-related-count.png' });
if (pageErrors.length) {
	console.log('\n未捕获异常:');
	for (const e of pageErrors) console.log('  ' + e);
}
console.log(`\n${pass} passed, ${fail} failed`);
console.log('截图: shot-related-count.png');
await browser.close();
process.exit(fail || pageErrors.length ? 1 : 0);
