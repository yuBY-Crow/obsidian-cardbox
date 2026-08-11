/**
 * 手机端触摸交互测试：
 * - 真实 touchscreen.tap 验证 click 链路（点按钮/点数字触发展开收起）
 * - dispatch PointerEvent 验证长按逻辑：展开区域长按不误触多选、主体长按触发多选
 * 注：手动 dispatch 的 pointerdown/up 不会合成 click，click 链路必须用真实触摸。
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import esbuild from 'esbuild';

const css = await readFile('styles.css', 'utf8');
const stub = `export const getIcon = (name) => (name === "more-vertical" ? {} : null);
export const setIcon = (el, name) => {
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
}
body{margin:0;padding:12px;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eceff3}
body.is-mobile{}
.frame{background:#fff;border:1px solid #dcdcdc;border-radius:10px;padding:8px;margin-bottom:20px}
h3{font-size:13px;font-weight:500;margin:0 0 8px}
${css}
</style>
<div id="host"></div>
</body></html>`);

// 搭建环境 + 暴露状态与长按辅助函数
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

	window.__state = { expanded: false, toggles: 0, longPresses: 0, clicks: 0 };
	const render = () => {
		const host = document.getElementById('host');
		host.empty();
		const f = document.createElement('div');
		f.className = 'frame';
		host.appendChild(f);
		const el = buildCardTile({
			depth: 0,
			selected: false,
			expanded: window.__state.expanded,
			hasVisibleChildren: true,
			childCount: 3,
			onClick: () => window.__state.clicks++,
			onLongPress: () => window.__state.longPresses++,
			onToggleExpand: () => {
				window.__state.toggles++;
				window.__state.expanded = !window.__state.expanded;
				render();
			},
			onKebab: () => {},
			card: {
				id: 'c1', path: 'Cards/c1.md', title: '主卡片标题', tags: [],
				created: Date.now(), updated: Date.now(), children: ['c2'], bodyLinks: [],
				archived: false, pinned: false, color: undefined, snippet: '正文内容',
				searchText: '', hasTaskList: false, mtime: Date.now(),
			},
		});
		f.appendChild(el);
	};
	render();

	// 长按辅助：dispatch pointerdown 到指定选择器 → 等待 duration → pointerup
	window.__longPress = (selector, duration) =>
		new Promise((resolve) => {
			const el = document.querySelector(selector);
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			const init = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 9, clientX: x, clientY: y };
			el.dispatchEvent(new PointerEvent('pointerdown', init));
			setTimeout(() => {
				el.dispatchEvent(new PointerEvent('pointerup', { ...init }));
				resolve();
			}, duration);
		});
}, tileCode);

const st = () => page.evaluate(() => ({ ...window.__state }));
const results = [];
const check = (name, cond, got) => results.push({ name, ok: !!cond, got });

// 1. 真实触摸点击展开数字 → 展开（toggle 1 次）
await page.locator('.cardbox-expand-count').tap();
await page.waitForTimeout(80);
let state = await st();
check('触摸点击展开数字触发 toggle', state.toggles >= 1, state.toggles);

// 2. 长按展开数字区域 650ms → 不误触多选（本轮修复）
await page.evaluate(() => window.__longPress('.cardbox-expand-count', 650));
await page.waitForTimeout(80);
state = await st();
check('长按展开数字区域不误触多选', state.longPresses === 0, state.longPresses);
check('长按数字区域不触发卡片点击', state.clicks === 0, state.clicks);

// 3. 长按卡片主体 650ms → 触发多选（功能保留）
await page.evaluate(() => window.__longPress('.cardbox-tile-body', 650));
await page.waitForTimeout(80);
state = await st();
check('长按卡片主体触发多选', state.longPresses === 1, state.longPresses);

// 4. 真实触摸点击数字 → 再次 toggle（收起）
await page.locator('.cardbox-expand-count').tap();
await page.waitForTimeout(80);
state = await st();
check('触摸点击数字触发第二次 toggle（能收起）', state.toggles >= 2, state.toggles);

// 5. 展开/收起往返：toggle 次数应为偶数（状态可逆）
check('展开收起可往返', state.toggles % 2 === 0, state.toggles);

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
await page.screenshot({ path: 'shot-mobile-touch.png' });
await browser.close();
process.exit(fail || pageErrors.length ? 1 : 0);
