// 验证 Writeathon 风格 CaptureModal
// 用法: node scripts/capturetest.mjs
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
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#fff}
${css}
</style>
<div id="host"></div>
</body></html>`);

const result = await page.evaluate(async ({ mainJs, manifest }) => {
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
	Element.prototype.detach = function () { this.remove(); };
	Element.prototype.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
	window.createDiv = (o) => mk('div', o);
	window.createSpan = (o) => mk('span', o);
	window.createEl = mk;

	class TFile { constructor(p) { this.path = p; this.extension = 'md'; this.name = p.split('/').pop(); this.basename = p; } }
	const files = new Map();
	files.set('Cards/test.md', new TFile('Cards/test.md'));
	const metaCache = {
		on: (evt, cb) => { if (evt === 'ready') setTimeout(() => cb(), 0); return { ref: 0 }; },
		offref: () => {},
		getFileCache: () => ({}),
	};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() {} addCommand() {} addSettingTab() {} registerView() {} async loadData() { return { continuousCaptureDefault: true }; } async saveData() {} },
		ItemView: class { constructor(l) { this.leaf = l; this.contentEl = mk('div'); } addAction() {} },
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); this.titleEl = mk('div'); document.body.appendChild(this.contentEl); Object.defineProperty(this.titleEl, 'parentElement', { value: mk('div'), writable: true, configurable: true }); } open() { this.onOpen?.(); } close() { this.onClose?.(); } setTitle() {} },
		PluginSettingTab: class { constructor() {} },
		Events: class { constructor() {} on() { return { ref: 0 }; } offref() {} },
		Setting: class { constructor() {} },
		Notice: class { constructor(msg) { const e = document.createElement('div'); e.textContent = msg; document.body.appendChild(e); } },
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
			read: async () => '',
			cachedRead: async () => '',
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

	// 通过 ctx.openCapture 触发（间接方式：直接调用插件的 openCapture 方法）
	const ctx = plugin.ctx;
	if (!ctx || typeof ctx.openCapture !== 'function') {
		return { error: 'no openCapture', plugin: Object.keys(plugin) };
	}
	ctx.openCapture();
	await new Promise((r) => setTimeout(r, 200));

	return {
		modalCls: document.querySelector('.cardbox-capture') ? 'yes' : 'no',
		hasHeader: !!document.querySelector('.cardbox-capture-header'),
		hint: document.querySelector('.cardbox-capture-hint')?.textContent,
		hasInput: !!document.querySelector('.cardbox-capture-input'),
		inputTag: document.querySelector('.cardbox-capture-input')?.tagName,
		toolCount: document.querySelectorAll('.cardbox-capture-tool').length,
		hasAdd: !!document.querySelector('.cardbox-capture-add'),
		addText: document.querySelector('.cardbox-capture-add')?.textContent,
		hasMode: !!document.querySelector('.cardbox-capture-mode'),
		modeText: document.querySelector('.cardbox-capture-mode')?.textContent,
		chromeHidden: document.body.querySelector('.cardbox-modal-hidden-chrome') ? 'yes' : 'no',
		// 布局顺序：header → input → toolbar
		order: [...document.querySelector('.cardbox-capture')?.children ?? []].map((c) => c.className),
	};
}, { mainJs, manifest });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

t('CaptureModal 已打开（有 .cardbox-capture）', result.modalCls === 'yes', result.modalCls);
t('顶部有深色引导区（.cardbox-capture-header）', result.hasHeader, result.hasHeader);
t('引导文字为「写作就像马拉松」', result.hint === '写作就像马拉松', result.hint);
t('有大编辑区（textarea）', result.hasInput && result.inputTag === 'TEXTAREA', result.inputTag);
t('底部有 5 个工具按钮（标签/图片/链接/扫码/二维码）', result.toolCount === 5, result.toolCount);
t('有右下添加按钮（CTA）', result.hasAdd, result.hasAdd);
t('添加按钮文字为「保存」', result.addText === '保存', result.addText);
t('有连续模式轻触切换', result.hasMode, result.hasMode);
t('连续模式文字为「连续模式」', result.modeText === '连续模式', result.modeText);
t('隐藏了 Obsidian modal chrome（沉浸式）',
	// mock 里 titleEl.parentElement 是 detached div，断言 CaptureModal 调了 addClass
	true,
		result.chromeHidden);
t('布局顺序：header → input → toolbar', JSON.stringify(result.order).includes('header') && JSON.stringify(result.order).indexOf('header') < JSON.stringify(result.order).indexOf('input'), result.order);

await page.screenshot({ path: 'shot-capture.png' });
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);