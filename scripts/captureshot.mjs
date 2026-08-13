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
<div style="position:fixed;left:0;right:0;bottom:0;height:340px;background:#d8dbe0;z-index:120;display:flex;align-items:center;justify-content:center;color:#666;font-size:13px">（模拟输入法键盘 340px）</div>
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
		Modal: class {
			constructor(a) {
				this.app = a;
				// 模拟 Obsidian 真实 modal DOM + 真机键盘（底部抬起）
				const container = mk('div');
				container.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;z-index:99';
				this.modalEl = mk('div'); this.modalEl.className = 'modal';
				this.modalEl.style.cssText = 'width:100%;display:flex;flex-direction:column;background:#fff;margin-bottom:340px';
				const closeBtn = mk('div'); closeBtn.className = 'modal-close-button';
				closeBtn.style.cssText = 'position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:#eee';
				this.titleEl = mk('div'); this.titleEl.className = 'modal-title';
				this.contentEl = mk('div'); this.contentEl.className = 'modal-content';
				this.contentEl.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
				this.modalEl.appendChild(closeBtn);
				this.modalEl.appendChild(this.titleEl);
				this.modalEl.appendChild(this.contentEl);
				container.appendChild(this.modalEl);
				document.body.appendChild(container);
				this.containerEl = container;
			}
			open() { this.onOpen?.(); }
			close() { this.onClose?.(); }
			setTitle() {}
		},
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
		titleRect: (() => { const h = capture.querySelector('.cardbox-capture-title'); if (!h) return null; const r = h.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })(),
		closeBtnRect: (() => { const b = document.querySelector('.modal-close-button'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; })(),
		inputRect: (() => { const i = capture.querySelector('.cardbox-capture-input'); return i ? Math.round(i.getBoundingClientRect().height) : null; })(),
		footerRect: (() => { const t = capture.querySelector('.cardbox-capture-footer'); return t ? Math.round(t.getBoundingClientRect().height) : null; })(),
		modeInFooter: (() => { const f = capture.querySelector('.cardbox-capture-footer'); return !!f && !!f.querySelector('.cardbox-capture-mode'); })(),
		// 扁平设计核心：所有元素都不应有边框
		borders: {
			capture: getComputedStyle(capture).borderTopWidth,
			title: getComputedStyle(capture.querySelector('.cardbox-capture-title')).borderTopWidth,
			input: getComputedStyle(capture.querySelector('.cardbox-capture-input')).borderTopWidth,
			footer: getComputedStyle(capture.querySelector('.cardbox-capture-footer')).borderTopWidth,
			mode: getComputedStyle(capture.querySelector('.cardbox-capture-mode')).borderTopWidth,
		},
		fontSizes: {
			title: getComputedStyle(capture.querySelector('.cardbox-capture-title')).fontSize,
			input: getComputedStyle(capture.querySelector('.cardbox-capture-input')).fontSize,
		},
		addRect: (() => { const a = capture.querySelector('.cardbox-capture-add'); return a ? Math.round(a.getBoundingClientRect().width) : null; })(),
		modalRect: (() => { const m = document.querySelector('.modal'); if (!m) return null; const r = m.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })(),
		modalContentPad: (() => { const c = document.querySelector('.modal-content'); return c ? getComputedStyle(c).padding : null; })(),
	};
});
console.log('CaptureModal 布局:', stats);
await browser.close();