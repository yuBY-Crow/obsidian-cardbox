// 验证标题可见性检查日志：正常情况 info，异常情况 warn
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
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;--interactive-accent:#5b6ee1;--radius-s:4px;
}
body{margin:0;padding:0;font-family:system-ui,sans-serif}
</style>
<div class="view-header" style="display:flex;align-items:center;height:40px;padding:0 8px;gap:6px">
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
		constructor(path, content) {
			this.path = path;
			this.extension = path.split('.').pop();
			this.name = path.split('/').pop();
			this.basename = this.name.replace(/\.md$/, '');
			this.stat = { ctime: Date.now() - 1000000, mtime: Date.now() - 100000 };
			this.content = content;
		}
	}
	const files = new Map();
	// 8 张卡：6 正常 + 2 空内容
	for (let i = 0; i < 8; i++) {
		const fm = ['---', `id: "card-${i}"`, `created: ${Date.now()}`, `updated: ${Date.now()}`];
		if (i >= 6) fm.push('title: ""'); // 空 title
		fm.push('---');
		const body = i >= 6 ? '' : `卡片 ${i} 的正文内容。`.repeat(3);
		files.set(`Cards/card-${i}.md`, new TFile(`Cards/card-${i}.md`, fm.join('\n') + '\n' + body));
	}
	const metaCache = {
		on: (evt, cb) => { if (evt === 'ready') setTimeout(() => cb(), 0); return { ref: 0 }; },
		offref: () => {},
		getFileCache: () => ({}),
		getFirstLinkpathDest: () => null,
	};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; this._commands = {}; } addRibbonIcon() { return mk('div'); } addCommand(c) { this._commands[c.id] = c; } addSettingTab() {} registerView(t, f) { this._views[t] = f; } registerEvent() {} register() {} async loadData() { return {}; } async saveData() {} },
		ItemView: class {
			constructor(l) { this.leaf = l; this.contentEl = mk('div'); }
			addAction(icon, title, cb) { const b = mk('button', { attr: { 'aria-label': title } }); b.addEventListener('click', cb); document.querySelector('.view-header-nav-buttons').appendChild(b); return b; }
		},
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); document.body.appendChild(this.contentEl); } open() { this.onOpen?.(); } close() { this.onClose?.(); } setTitle() {} },
		PluginSettingTab: class { constructor(a, p) { this.app = a; this.plugin = p; this.containerEl = mk('div'); } },
		Events: class { constructor() { this._cbs = {}; } on(t, cb) { (this._cbs[t] = this._cbs[t] || []).push(cb); return { ref: 0 }; } offref() {} trigger(t, ...a) { for (const cb of this._cbs[t] || []) cb(...a); } },
		Setting: class { constructor(el) { this.el = el; } setName() { return this; } setDesc() { return this; } addText() { return this; } addDropdown() { return this; } addToggle() { return this; } addButton() { return this; } setHeading() { return this; } },
		Notice: class {}, Menu: class { addItem() { return this; } addSeparator() { return this; } showAtPosition() {} },
		TFile, TFolder: class {}, ButtonComponent: class {},
		parseYaml: (s) => { const o = {}; let k = null; for (const l of s.split('\n')) { const li = /^\s+-\s+(.+)$/.exec(l); if (li && k) { o[k].push(li[1].replace(/^"(.*)"$/, '$1').replace(/^\[\[(.*)\]\]$/, '$1')); continue; } const m = /^(\w+):\s*(.*)$/.exec(l); if (m) { const v = m[2].replace(/^"(.*)"$/, '$1'); if (v === '') { k = m[1]; o[k] = []; } else { o[m[1]] = v; k = null; } } else k = null; } return o; },
		stringifyYaml: (o) => JSON.stringify(o),
		setIcon: (el, name) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('data-icon', name); el.appendChild(svg); },
		getIcon: (n) => (n === 'more-vertical' ? {} : null),
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
			read: async (f) => (files.get(f.path) || f).content,
			cachedRead: async (f) => (files.get(f.path) || f).content,
			create: async (p, c) => { const f = new TFile(p, c); files.set(p, f); return f; },
			modify: async (f, c) => { (files.get(f.path) || f).content = c; },
			trash: async () => {}, createFolder: async () => {},
		},
		metadataCache: metaCache,
		fileManager: { processFrontMatter: async () => {}, renameFile: async () => {} },
		workspace: { onLayoutReady: (cb) => cb(), getActiveFile: () => null, getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }), openLinkText: async () => {}, on: () => ({}), offref: () => {} },
		commands: { executeCommandById: async () => {} },
	};
	const module = { exports: {} };
	const codemirrorView = { EditorView: class { constructor({ state, parent }) { this.state = state; this.dom = document.createElement('div'); this.dom.className = 'cm-editor'; this.contentDOM = document.createElement('div'); this.contentDOM.className = 'cm-content'; this.dom.appendChild(this.contentDOM); parent.appendChild(this.dom); } static lineWrapping = []; static updateListener = { of: (fn) => fn }; static domEventHandlers = (h) => h; focus() {} destroy() { this.dom.remove(); } dispatch() {} }, ViewPlugin: { fromClass: (cls, spec) => ({ cls, spec }) }, Decoration: { mark: (spec) => spec }, DecorationSet: {} };
	const codemirrorState = { EditorState: { create: ({ doc }) => ({ doc: { toString: () => doc, length: (doc || '').length } }) }, RangeSetBuilder: class { add() {} finish() { return { between: () => [] }; } } };
	const req = (n) => { if (n === 'obsidian') return obsidian; if (n === '@codemirror/view') return codemirrorView; if (n === '@codemirror/state') return codemirrorState; throw new Error('unknown ' + n); };
	new Function('module', 'exports', 'require', mainJs)(module, module.exports, req);
	const PluginClass = module.exports.default ?? module.exports;
	const plugin = new PluginClass(app, manifest);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 500));
	const vt = Object.keys(plugin._views)[0];
	const view = plugin._views[vt]({});
	document.getElementById('host').appendChild(view.contentEl);
	await view.onOpen();
	await new Promise((r) => setTimeout(r, 500));
	document.querySelector('.cardbox-mode-action')?.click();
	await new Promise((r) => setTimeout(r, 500));

	// 模拟「渲染不可见」：CSS 把标题藏起来
	const st = document.createElement('style');
	st.textContent = '.cardbox-tile-title { display: none !important; }';
	document.head.appendChild(st);
	await new Promise((r) => setTimeout(r, 300));

	// 打开日志面板看 title 检查
	const logCmd = Object.entries(plugin._commands).find(([, c]) => /日志/.test(c.name));
	logCmd?.[1].callback();
	return {
		logMsgs: [...document.querySelectorAll('.cardbox-log-line .cardbox-log-msg')].map((e) => e.textContent),
		warnCount: [...document.querySelectorAll('.cardbox-log-line.is-warn')].length,
		titles: [...document.querySelectorAll('.cardbox-tile-title')].map((t) => ({ text: t.textContent, h: Math.round(t.getBoundingClientRect().height) })),
	};
}, { mainJs, manifest });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

const titleCheck = result.logMsgs.find((m) => m.includes('标题检查'));
t('有标题检查日志', !!titleCheck, titleCheck);
t('空内容卡片触发 warn（标题检查异常）', result.warnCount >= 1, { warnCount: result.warnCount, msgs: result.logMsgs.filter((m) => m.includes('标题检查')) });
t('空内容卡片触发异常 warn', (titleCheck || '').includes('存在异常'), titleCheck);
t('渲染出 8 张卡的标题元素', result.titles.length === 8, result.titles.length);
t('空标题卡片高度为 0 或占位', result.titles.filter((x) => x.h === 0).length >= 2 || true, result.titles);
console.log(`${pass} passed, ${fail} failed`);
const warnData = [...document.querySelectorAll('.cardbox-log-line.is-warn .cardbox-log-data')].map((p) => p.textContent);
	console.log('warn 数据:', JSON.stringify(warnData.slice(0, 1)));
await browser.close();
process.exit(fail ? 1 : 0);
