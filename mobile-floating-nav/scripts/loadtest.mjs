// 在模拟 Obsidian 环境中真实加载 main.js 并执行 onload(),验证悬浮导航核心逻辑:
// 渲染、按钮数量、动作执行、折叠/展开、增删按钮、卸载。
// 用法: node scripts/loadtest.mjs
import Module from 'node:module';

// ---------- 最小 DOM polyfill(Obsidian 增强方法) ----------
const domPolyfill = (win) => {
	const P = win.Element.prototype;
	P.createDiv = function (opts = {}) { return this.createEl('div', opts); };
	P.createSpan = function (opts = {}) { return this.createEl('span', opts); };
	P.createEl = function (tag, opts = {}) {
		const el = win.document.createElement(tag);
		if (opts.cls) el.className = opts.cls;
		if (opts.text != null) el.textContent = opts.text;
		if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
		this.appendChild(el);
		return el;
	};
	P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	P.addClass = function (c) { this.classList.add(c); };
	P.removeClass = function (c) { this.classList.remove(c); };
	P.setText = function (t) { this.textContent = t; };
	P.show = function () { this.style.display = ''; };
	P.hide = function () { this.style.display = 'none'; };
	P.scrollTo = function () { this._scrolledToTop = true; };
};

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
domPolyfill(dom.window);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 22 的 globalThis.navigator 为只读,跳过赋值(插件未直接使用 navigator)
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;

// ---------- 执行记录 ----------
const executed = [];
const NOTICES = [];

// ---------- 最小 Obsidian mock ----------
class Plugin {
	constructor(app, manifest) { this.app = app; this.manifest = manifest; }
	addCommand() {} addSettingTab() {} registerEvent() {}
	async loadData() { return this._data ?? null; }
	async saveData(d) { this._data = d; }
}
class Notice { constructor(msg) { NOTICES.push(String(msg)); } setMessage() {} hide() {} }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } display() {} }
class MarkdownView { constructor() { this.editor = { scrollTo: (x, y) => executed.push(`scroll:${x},${y}`) }; } }
class TFile { constructor(p) { this.path = p; this.basename = p.replace(/\.md$/, ''); } }
const setIcon = (el, name) => { el._icon = name; };
const Platform = { isMobile: true, isDesktop: false };

const fakeLeafContainer = dom.window.document.createElement('div');

const app = {
	vault: {
		_created: [],
		async create(p, content) { this._created.push(p); return { path: p }; },
		getAbstractFileByPath(p) { return this._created.includes(p) ? { path: p } : null; },
		getMarkdownFiles() { return [new TFile('Inbox/a.md'), new TFile('b.md')]; },
	},
	fileManager: { getNewFileParent() { return { path: 'Inbox' }; } },
	workspace: {
		_handlers: {},
		on(evt, cb) { (this._handlers[evt] ||= []).push(cb); return {}; },
		getActiveViewOfType(T) { return T === MarkdownView ? new MarkdownView() : null; },
		getMostRecentLeaf() { return { view: { containerEl: fakeLeafContainer } }; },
		getLeaf() { return { openFile: async (f) => executed.push(`openFile:${f.path}`) }; },
	},
	commands: {
		listCommands() {
			return [
				{ id: 'command-palette:open', name: '命令面板' },
				{ id: 'switcher:open', name: '快速切换' },
				{ id: 'daily-notes:open', name: '打开日记' },
			];
		},
		executeCommandById(id) { executed.push(`cmd:${id}`); },
	},
	setting: { open() {}, openTabById() {} },
};

// ---------- 拦截 require('obsidian') ----------
const obsidianMock = {
	Plugin, Notice, MarkdownView, TFile, setIcon, Platform, PluginSettingTab,
	SuggestModal: class { constructor() {} open() {} close() {} setPlaceholder() {} },
	FuzzySuggestModal: class { constructor() {} open() {} close() {} setPlaceholder() {} },
	Modal: class { constructor() { this.contentEl = dom.window.document.createElement('div'); } open() {} close() {} },
	Setting: class {
		constructor() { this.controlEl = dom.window.document.createElement('div'); }
		setName() { return this; } setDesc() { return this; } setHeading() { return this; }
		addText() { return this; } addToggle() { return this; } addDropdown() { return this; }
		addButton() { return this; } addExtraButton() { return this; }
	},
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === 'obsidian') return obsidianMock;
	return origLoad.apply(this, arguments);
};

// ---------- 加载插件 ----------
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mod = require('../main.js');
const MobileFloatingNavPlugin = mod.default ?? mod;
const plugin = new MobileFloatingNavPlugin(app, { id: 'mobile-floating-nav', name: 'test' });
await plugin.onload();

// 模拟点击并等待异步 saveSettings/refresh 完成
const click = async (el) => {
	if (!el) return null;
	el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
	await new Promise((r) => setTimeout(r, 5));
	return true;
};

let pass = 0, fail = 0;
const check = (name, cond) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}`); }
};

console.log('[1] 工具栏挂载与默认按钮');
const toolbar = document.querySelector('.mfn-toolbar');
check('工具栏已挂载到 body', !!toolbar);
check('工具栏位于右侧', toolbar.classList.contains('mfn-right'));
// 默认 4 个按钮 + 1 个折叠按钮
const btns = toolbar.querySelectorAll('.mfn-btn');
check(`默认按钮数 = 5 (4 功能按钮 + 1 折叠)`, btns.length === 5, `实际 ${btns.length}`);
check('第一个按钮图标为 command', btns[0]._icon === 'command');

console.log('[2] 动作执行');
await click(btns[0]);
check('命令面板命令已执行', executed.includes('cmd:command-palette:open'));
await click(btns[1]);
check('快速切换命令已执行', executed.includes('cmd:switcher:open'));
await click(btns[3]); // 返回顶部
check('返回顶部触发滚动', executed.some((e) => e.startsWith('scroll:')));
await click(btns[2]); // 新建笔记
check('新建笔记已创建', app.vault._created.length === 1);
check('新建笔记通知弹出', NOTICES.some((n) => n.includes('已创建')));

console.log('[3] 折叠与展开');
await click(toolbar.querySelector('.mfn-collapse'));
check('折叠后工具栏带 mfn-collapsed', toolbar.classList.contains('mfn-collapsed'));
const collapsedBtns = toolbar.querySelectorAll('.mfn-btn');
check('折叠后仅剩 1 个展开按钮', collapsedBtns.length === 1);
await click(toolbar.querySelector('.mfn-expand'));
check('展开后按钮恢复', toolbar.querySelectorAll('.mfn-btn').length === 5);

console.log('[4] 增删按钮');
plugin.settings.buttons.push({ id: 'x', icon: 'star', label: '星星', action: 'command', commandId: 'daily-notes:open' });
await plugin.saveSettings();
check('添加按钮后数量 = 6', toolbar.querySelectorAll('.mfn-btn').length === 6);
const starBtn = [...toolbar.querySelectorAll('.mfn-btn')].find((b) => b._icon === 'star');
check('新增按钮图标正确', !!starBtn);
await click(starBtn);
check('新增按钮执行日记命令', executed.includes('cmd:daily-notes:open'));
plugin.settings.buttons.pop();
await plugin.saveSettings();
check('删除按钮后数量 = 5', toolbar.querySelectorAll('.mfn-btn').length === 5);

console.log('[5] 平台可见性');
plugin.settings.enabled = false;
await plugin.saveSettings();
check('关闭后工具栏隐藏', toolbar.style.display === 'none');
plugin.settings.enabled = true;
await plugin.saveSettings();
check('重新启用后可见', toolbar.style.display !== 'none');

console.log('[6] 卸载');
plugin.onunload();
check('卸载后工具栏已移除', !document.querySelector('.mfn-toolbar'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
