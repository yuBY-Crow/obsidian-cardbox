// 真实渲染 CaptureModal（手机视口）
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const mainJs = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const css = await readFile('styles.css', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.setContent(`<!DOCTYPE html><html><body>
<style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;
--text-on-accent:#fff;--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
}
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#eceff3}
${css}
/* 模拟 modal 容器占满屏幕 */
.modal-container { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: flex-end; }
.modal { width: 100%; background: white; border-radius: 16px 16px 0 0; }
</style>
<div class="view-header" style="display:flex;align-items:center;height:40px;padding:0 8px;gap:6px;background:#fff">
  <div class="view-header-title">卡片盒</div>
  <div class="view-header-nav-buttons" style="margin-left:auto;display:flex;gap:4px"></div>
</div>
<div id="host" style="height:calc(100vh - 40px)"></div>
</body></html>`);

await page.evaluate(async ({ mainJs, manifest }) => {
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
	Element.prototype.createPre = function (o) { return this.createEl('pre', o); };
	Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	Element.prototype.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	Element.prototype.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
	Element.prototype.setText = function (t) { this.textContent = t; };
	window.createDiv = (o) => mk('div', o);
	window.createSpan = (o) => mk('span', o);
	window.createEl = mk;

	class TFile { constructor(p) { this.path = p; this.extension = 'md'; this.name = p.split('/').pop(); } }
	const files = new Map();
	files.set('Cards/test.md', new TFile('Cards/test.md'));
	const metaCache = {
		on: (evt, cb) => { if (evt === 'ready') setTimeout(() => cb(), 0); return { ref: 0 }; },
		offref: () => {}, getFileCache: () => ({}),
	};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() {} addCommand() {} addSettingTab() {} registerView() {} async loadData() { return { continuousCaptureDefault: true }; } async saveData() {} },
		ItemView: class { constructor(l) { this.leaf = l; this.contentEl = mk('div'); } addAction(icon, title, cb) { const b = mk('button', { attr: { 'aria-label': title } }); b.addEventListener('click', cb); document.querySelector('.view-header-nav-buttons').appendChild(b); return b; } },
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); this.titleEl = mk('div'); Object.defineProperty(this.titleEl, 'parentElement', { value: mk('div'), writable: true, configurable: true }); /* 模拟 Obsidian 的 modal 容器 */ document.body.appendChild(this.contentEl); this.contentEl.style.cssText = 'position:fixed;inset:0;background:#fff;display:flex;flex-direction:column;z-index:99'; } open() { this.onOpen?.(); } close() { this.onClose?.(); } setTitle() {} },
		PluginSettingTab: class { constructor() {} },
		Events: class { constructor() {} on() { return { ref: 0 }; } offref() {} },
		Setting: class { constructor() {} },
		Notice: class { constructor(msg) {} },
		Menu: class { addItem() { return this; } showAtPosition() {} },
		TFile, TFolder: class {},
		ButtonComponent: class { constructor(h) { this.btn = h.createEl('button'); } setButtonText(t) { this.btn.textContent = t; return this; } setCta() { this.btn.classList.add('mod-cta'); return this; } setTooltip() { return this; } onClick(cb) { this.btn.addEventListener('click', cb); return this; } then(cb) { cb(this); return this; } },
		ToggleComponent: class { constructor() {} setValue() { return this; } setTooltip() { return this; } onChange() { return this; } },
		parseYaml: (s) => { const o = {}; for (const l of s.split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(l); if (m) o[m[1]] = m[2]; } return o; },
		stringifyYaml: (o) => JSON.stringify(o),
		setIcon: (el, name) => { el.setAttribute('data-icon', name); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); el.appendChild(svg); },
		getIcon: () => null,
		debounce: (fn) => fn,
		Platform: { isMobile: true },
		normalizePath: (p) => p,
	};
	const app = {
		vault: {
			on: () => ({ offref: () => {} }),
			getFiles: () => [...files.values()],
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (p) => files.get(p) || null,
			read: async () => '', cachedRead: async () => '',
			create: async (p) => { const f = new TFile(p); files.set(p, f); return f; },
			modify: async () => {}, trash: async () => {}, createFolder: async () => {},
		},
		metadataCache: metaCache,
		fileManager: { processFrontMatter: async (f, cb) => { cb({}); }, renameFile: async () => {} },
		workspace: { onLayoutReady: (cb) => cb(), getActiveFile: () => null, getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }), openLinkText: async () => {}, on: () => ({}), offref: () => {} },
		commands: { executeCommandById: async () => {} },
	};
	const module = { exports: {} };
	const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('(' + n + ')'); };
	new Function('module', 'exports', 'require', mainJs)(module, module.exports, req);
	const PluginClass = module.exports.default ?? module.exports;
	const plugin = new PluginClass(app, manifest);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 500));

	const ctx = plugin.ctx;
	ctx.openCapture();
	await new Promise((r) => setTimeout(r, 200));
}, { mainJs, manifest });

await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-capture-final.png' });

const stats = await page.evaluate(() => {
	const capture = document.querySelector('.cardbox-capture');
	if (!capture) return { error: 'no capture' };
	const r = capture.getBoundingClientRect();
	return {
		w: Math.round(r.width),
		h: Math.round(r.height),
		headerRect: (() => { const h = capture.querySelector('.cardbox-capture-header'); return h ? Math.round(h.getBoundingClientRect().height) : null; })(),
		inputRect: (() => { const i = capture.querySelector('.cardbox-capture-input'); return i ? Math.round(i.getBoundingClientRect().height) : null; })(),
		toolbarRect: (() => { const t = capture.querySelector('.cardbox-capture-toolbar'); return t ? Math.round(t.getBoundingClientRect().height) : null; })(),
		toolRects: [...capture.querySelectorAll('.cardbox-capture-tool')].map((t) => Math.round(t.getBoundingClientRect().width)),
		addRect: (() => { const a = capture.querySelector('.cardbox-capture-add'); return a ? Math.round(a.getBoundingClientRect().width) : null; })(),
	};
});
console.log('CaptureModal 布局:', stats);
await browser.close();