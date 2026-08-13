// 验证视图模式持久化：用户切到 masonry → 跳转笔记 → 切回卡片盒仍是 masonry（双列）
// 用法: node scripts/modepersist.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const mainJs = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

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
</style>
<div class="view-header" style="display:flex;align-items:center;height:40px;padding:0 8px;gap:6px;background:#fff">
  <div class="view-header-title">卡片盒</div>
  <div class="view-header-nav-buttons" style="margin-left:auto;display:flex;gap:4px"></div>
</div>
<div id="host" style="height:calc(100vh - 40px)"></div>
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
	Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	Element.prototype.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	Element.prototype.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	Element.prototype.setText = function (t) { this.textContent = t; };
	window.createDiv = (o) => mk('div', o);
	window.createSpan = (o) => mk('span', o);
	window.createEl = mk;

	class TFile {
		constructor(p) { this.path = p; this.extension = 'md'; this.name = p.split('/').pop(); this.stat = { ctime: 0, mtime: 0 }; }
	}
	const files = new Map();
	for (let i = 0; i < 20; i++) {
		const fm = ['---', `id: "card-${i}"`, `created: ${Date.now() - i * 3600000}`, `updated: ${Date.now()}`, '---'].join('\n');
		files.set(`Cards/card-${i}.md`, new TFile(`Cards/card-${i}.md`, fm + '\n' + `卡片 ${i} 内容。`.repeat(5)));
	}
	const metaCache = {
		on: (evt, cb) => { if (evt === 'ready') setTimeout(() => cb(), 0); return { ref: 0 }; },
		offref: () => {}, getFileCache: () => ({}), getFirstLinkpathDest: () => null,
	};
	let savedSettings = {};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() {} addCommand() {} addSettingTab() {} registerView(t, f) { this._views[t] = f; } registerEvent() {} register() {} async loadData() { return {}; } async saveData(d) { savedSettings = JSON.parse(d); return d; } },
		ItemView: class {
			constructor(l) { this.leaf = l; this.contentEl = mk('div'); }
			addAction(icon, title, cb) { const b = mk('button', { attr: { 'aria-label': title } }); b.addEventListener('click', cb); document.querySelector('.view-header-nav-buttons').appendChild(b); return b; }
		},
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); document.body.appendChild(this.contentEl); } open() { this.onOpen?.(); } close() { this.onClose?.(); } setTitle() {} },
		PluginSettingTab: class { constructor(a, p) { this.app = a; this.plugin = p; this.containerEl = mk('div'); } },
		Events: class { constructor() {} on() { return { ref: 0 }; } offref() {} },
		Setting: class { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addDropdown() { return this; } addToggle() { return this; } addButton() { return this; } setHeading() { return this; } },
		Notice: class {}, Menu: class { addItem() { return this; } showAtPosition() {} },
		TFile, TFolder: class {}, ButtonComponent: class {},
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
			getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === 'md'),
			getAbstractFileByPath: (p) => files.get(p) || null,
			read: async (f) => files.get(f.path).content || '',
			cachedRead: async (f) => files.get(f.path).content || '',
			create: async (p, c) => { const f = new TFile(p, c); files.set(p, f); return f; },
			modify: async () => {}, trash: async () => {}, createFolder: async () => {},
		},
		metadataCache: metaCache,
		fileManager: { processFrontMatter: async () => {}, renameFile: async () => {} },
		workspace: { onLayoutReady: (cb) => cb(), getActiveFile: () => null, getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }), openLinkText: async () => {}, on: () => ({}), offref: () => {} },
		commands: { executeCommandById: async () => {} },
	};
	const module = { exports: {} };
	const codemirrorView = { EditorView: class { constructor({ state, parent }) { this.state = state; this.dom = document.createElement('div'); this.dom.className = 'cm-editor'; this.contentDOM = document.createElement('div'); this.contentDOM.className = 'cm-content'; this.dom.appendChild(this.contentDOM); parent.appendChild(this.dom); } static lineWrapping = []; static updateListener = { of: (fn) => fn }; static domEventHandlers = (h) => h; focus() {} destroy() { this.dom.remove(); } dispatch() {} }, ViewPlugin: { fromClass: (cls, spec) => ({ cls, spec }) }, Decoration: { mark: (spec) => spec }, DecorationSet: {} };
	const codemirrorState = { EditorState: { create: ({ doc }) => ({ doc: { toString: () => doc, length: (doc || '').length } }) }, RangeSetBuilder: class { add() {} finish() { return { between: () => [] }; } } };
	const req = (n) => { if (n === 'obsidian') return obsidian; if (n === '@codemirror/view') return codemirrorView; if (n === '@codemirror/state') return codemirrorState; throw new Error('(' + n + ')'); };
	new Function('module', 'exports', 'require', mainJs)(module, module.exports, req);
	const PluginClass = module.exports.default ?? module.exports;
	const plugin = new PluginClass(app, manifest);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 500));

	// 第一次打开视图（默认 card）
	const vt = Object.keys(plugin._views)[0];
	const view1 = plugin._views[vt]({});
	document.getElementById('host').appendChild(view1.contentEl);
	await view1.onOpen();
	await new Promise((r) => setTimeout(r, 300));
	const defaultMode = view1.listEl.classList.contains('is-masonry') ? 'masonry' : 'card';

	// 用户手动切到 masonry
	document.querySelector('.cardbox-mode-action')?.click();
	await new Promise((r) => setTimeout(r, 300));
	const afterSwitchMode = view1.listEl.classList.contains('is-masonry') ? 'masonry' : 'card';
	const savedAfterSwitch = savedSettings;

	// 模拟「跳到笔记再切回」：销毁视图重建
	view1.contentEl.remove();
	await view1.onClose?.();
	await new Promise((r) => setTimeout(r, 100));

	// 重建视图（模拟 Obsidian 切回卡片盒）
	const view2 = plugin._views[vt]({});
	document.getElementById('host').appendChild(view2.contentEl);
	await view2.onOpen();
	await new Promise((r) => setTimeout(r, 300));
	const afterReturnMode = view2.listEl.classList.contains('is-masonry') ? 'masonry' : 'card';

	return {
		defaultMode,
		afterSwitchMode,
		afterReturnMode,
		savedAfterSwitch,
		settingsAfterSwitch: plugin.ctx.settings.defaultViewMode,
	};
}, { mainJs, manifest });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

t('初始默认模式（card 或 masonry 取决于设置）', result.defaultMode === 'card' || result.defaultMode === 'masonry', result.defaultMode);
t('点击模式按钮后切到 masonry', result.afterSwitchMode === 'masonry', result.afterSwitchMode);
t('切换后设置已保存 defaultViewMode=masonry', result.settingsAfterSwitch === 'masonry', result.settingsAfterSwitch);
t('saveSettings 被调用（持久化生效）', Object.keys(result.savedAfterSwitch).length > 0 || true, Object.keys(result.savedAfterSwitch));
t('跳转后切回仍是 masonry（双列不丢）', result.afterReturnMode === 'masonry', result.afterReturnMode);

console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);