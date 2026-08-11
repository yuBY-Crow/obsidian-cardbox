// 在模拟 Obsidian 环境中真实加载 main.js 并跑 onload()，捕获启动异常。
// 目的：复现「插件加载失败」，拿到真实堆栈，而不是靠猜。
import { readFile } from 'node:fs/promises';
import Module from 'node:module';
import path from 'node:path';

// ---------- 最小 Obsidian API mock ----------
class Events {
	constructor() { this._h = {}; }
	on(n, cb) { (this._h[n] ||= []).push(cb); return { n, cb }; }
	off(n, cb) {}
	offref(r) {}
	trigger(n, ...a) { (this._h[n] || []).forEach((cb) => cb(...a)); }
}
class Component {
	onload() {} onunload() {}
	registerEvent() {} register() {} addChild(c) { return c; }
}
class Plugin extends Component {
	constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; this._cmds = []; this._views = {}; this._ribbons = []; }
	addCommand(c) { this._cmds.push(c); return c; }
	addRibbonIcon(i, t, cb) { this._ribbons.push({ i, t, cb }); return mockEl(); }
	addSettingTab(t) { this._settingTab = t; }
	registerView(type, factory) { this._views[type] = factory; }
	registerEvent() {}
	async loadData() { return this._data ?? null; }
	async saveData(d) { this._data = d; }
}
class ItemView extends Component {
	constructor(leaf) { super(); this.leaf = leaf; this.contentEl = mockEl(); this.containerEl = mockEl(); }
	getViewType() { return ''; } getDisplayText() { return ''; } getIcon() { return ''; }
}
class Modal {
	constructor(app) { this.app = app; this.contentEl = mockEl(); this.modalEl = mockEl(); this.titleEl = mockEl(); }
	open() { this.onOpen?.(); } close() { this.onClose?.(); }
	setTitle(t) { this._title = t; return this; }
}
class PluginSettingTab {
	constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = mockEl(); }
	display() {}
}
class Setting {
	constructor(el) { this.el = el; this.controlEl = mockEl(); this.nameEl = mockEl(); }
	setName() { return this; } setDesc() { return this; } setHeading() { return this; }
	addText(cb) { cb(mockText()); return this; }
	addToggle(cb) { cb(mockToggle()); return this; }
	addDropdown(cb) { cb(mockDropdown()); return this; }
	addButton(cb) { cb(mockButton()); return this; }
	addExtraButton(cb) { cb(mockButton()); return this; }
}
class Notice { constructor(msg) { NOTICES.push(String(msg)); } setMessage() {} hide() {} }
class Menu {
	constructor() { this.items = []; }
	addItem(cb) { const it = mockMenuItem(); cb(it); this.items.push(it); return this; }
	addSeparator() { return this; }
	showAtPosition() {} showAtMouseEvent() {}
}
class TFile { constructor(p) { this.path = p; this.name = path.basename(p); this.basename = this.name.replace(/\.md$|\.canvas$/, ''); this.extension = this.name.split('.').pop(); this.stat = { ctime: Date.now(), mtime: Date.now(), size: 10 }; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
class ButtonComponent {
	constructor(el) {}
	setButtonText() { return this; } setIcon() { return this; } setCta() { return this; }
	setDisabled() { return this; } onClick() { return this; } setTooltip() { return this; }
}
class TextComponent {
	constructor(el) { this.inputEl = mockEl(); this._v = ''; }
	setPlaceholder() { return this; } setValue(v) { this._v = v; return this; }
	getValue() { return this._v; } onChange() { return this; }
}
class DropdownComponent {
	constructor(el) { this.selectEl = mockEl(); this._v = ''; }
	addOption() { return this; } setValue(v) { this._v = v; return this; }
	getValue() { return this._v; } onChange() { return this; }
}
class TextAreaComponent extends TextComponent {}
class ToggleComponent { constructor() {} setValue() { return this; } onChange() { return this; } }

const NOTICES = [];
function mockText() { const t = new TextComponent(); return t; }
function mockToggle() { return { setValue: () => mockToggle(), onChange: () => mockToggle() }; }
function mockDropdown() { const o = { addOption: () => o, setValue: () => o, getValue: () => '', onChange: () => o }; return o; }
function mockButton() { const o = { setButtonText: () => o, setIcon: () => o, setCta: () => o, setTooltip: () => o, onClick: () => o, setDisabled: () => o }; return o; }
function mockMenuItem() { const o = { setTitle: () => o, setIcon: () => o, setChecked: () => o, onClick: () => o, setDisabled: () => o, setSection: () => o, setSubmenu: () => new Menu() }; return o; }

// 极简 DOM mock，覆盖 Obsidian 的 createDiv/createSpan/createEl 扩展
function mockEl(tag = 'div') {
	const el = {
		tagName: tag.toUpperCase(), children: [], classList: new Set(), style: { setProperty() {}, removeProperty() {} },
		attributes: {}, textContent: '', value: '', type: '', inputEl: null, _listeners: {},
	};
	el.createDiv = (o) => appendChild(el, mockEl('div'), o);
	el.createSpan = (o) => appendChild(el, mockEl('span'), o);
	el.createEl = (t, o) => appendChild(el, mockEl(t), o);
	el.empty = () => { el.children = []; };
	el.addClass = (...c) => c.forEach((x) => el.classList.add(x));
	el.removeClass = (...c) => c.forEach((x) => el.classList.delete(x));
	el.toggleClass = (c, on) => (on ? el.classList.add(c) : el.classList.delete(c));
	el.hasClass = (c) => el.classList.has(c);
	el.setText = (t) => { el.textContent = t; };
	el.setAttribute = (k, v) => { el.attributes[k] = v; };
	el.getAttribute = (k) => el.attributes[k];
	el.addEventListener = (n, cb) => { (el._listeners[n] ||= []).push(cb); };
	el.removeEventListener = () => {};
	el.appendChild = (c) => { el.children.push(c); return c; };
    el.insertBefore = (c) => { el.children.push(c); return c; };
	el.querySelector = () => null;
	el.querySelectorAll = () => { const a = []; a.forEach = Array.prototype.forEach.bind(a); return a; };
	el.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 100, height: 20 });
	el.setPointerCapture = () => {}; el.releasePointerCapture = () => {};
	el.focus = () => {}; el.select = () => {}; el.remove = () => {};
	el.onclick = null;
	return el;
}
function appendChild(parent, child, o) {
	if (o) {
		if (o.cls) String(o.cls).split(/\s+/).forEach((c) => c && child.classList.add(c));
		if (o.text !== undefined) child.textContent = o.text;
		if (o.attr) Object.assign(child.attributes, o.attr);
		if (o.type) child.type = o.type;
	}
	parent.children.push(child);
	return child;
}

globalThis.createDiv = (o) => { const e = mockEl('div'); if (o?.cls) String(o.cls).split(/\s+/).forEach((c) => e.classList.add(c)); if (o?.text) e.textContent = o.text; return e; };
globalThis.createSpan = (o) => globalThis.createDiv(o);
globalThis.createEl = (t, o) => { const e = mockEl(t); if (o?.cls) String(o.cls).split(/\s+/).forEach((c) => e.classList.add(c)); if (o?.text) e.textContent = o.text; return e; };
globalThis.window = {
	setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
	requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: (t) => clearTimeout(t),
	setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
};
globalThis.document = { createElement: (t) => mockEl(t), createDocumentFragment: () => mockEl('fragment'), body: mockEl() };
globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
globalThis.Notice = Notice;

// YAML：用最简实现，够跑通frontmatter 逻辑
function parseYaml(s) {
	const out = {}; let curKey = null;
	for (const raw of String(s).split('\n')) {
		const line = raw.replace(/\r$/, '');
		if (!line.trim()) continue;
		const arr = /^\s+-\s*(.*)$/.exec(line);
		if (arr && curKey) { (out[curKey] ||= []).push(strip(arr[1])); continue; }
		const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (m) {
			curKey = m[1];
			const v = m[2].trim();
			if (v === '') { out[curKey] = []; }
			else if (v === 'true') out[curKey] = true;
			else if (v === 'false') out[curKey] = false;
			else if (/^-?\d+(\.\d+)?$/.test(v)) out[curKey] = Number(v);
			else out[curKey] = strip(v);
		}
	}
	return out;
}
function strip(v) { return String(v).replace(/^["']|["']$/g, ''); }
function stringifyYaml(o) {
	let s = '';
	for (const [k, v] of Object.entries(o)) {
		if (Array.isArray(v)) { s += `${k}:\n` + v.map((x) => `  - "${x}"`).join('\n') + '\n'; }
		else if (typeof v === 'string') s += `${k}: "${v}"\n`;
		else s += `${k}: ${v}\n`;
	}
	return s;
}

const obsidianMock = {
	Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, Menu, TFile, TFolder, Component, Events,
	ButtonComponent, TextComponent, TextAreaComponent, DropdownComponent, ToggleComponent,
	parseYaml, stringifyYaml,
	setIcon: () => {}, getIcon: (n) => (n === "more-vertical" ? {} : null), normalizePath: (p) => p, debounce: (f) => f,
	MarkdownRenderer: { render: async () => {} },
	Platform: { isMobile: false, isDesktop: true },
	WorkspaceLeaf: class {},
	moment: () => ({ format: () => '' }),
};

// ---------- 假App / Vault ----------
const FILES = new Map(); // path -> content
function seed(n = 30) {
	for (let i = 0; i < n; i++) {
		const id = `2026-08-0${(i % 9) + 1}-12000${i % 10}-a${i}`;
		FILES.set(`Cards/${id}.md`, `---\nid: "${id}"\ncreated: ${Date.now() - i * 86400000}\nupdated: ${Date.now()}\ntags:\n  - "读书/笔记"\ncolor: red\npinned: ${i === 0}\n---\n\n卡片正文 ${i}`);
	}
}
seed();

const vaultEvents = new Events();
const app = {
	vault: Object.assign(vaultEvents, {
		getMarkdownFiles: () => [...FILES.keys()].filter((p) => p.endsWith('.md')).map((p) => new TFile(p)),
		getAbstractFileByPath: (p) => (FILES.has(p) ? new TFile(p) : (p === 'Cards' ? new TFolder(p) : null)),
		cachedRead: async (f) => FILES.get(f.path) ?? '',
		read: async (f) => FILES.get(f.path) ?? '',
		create: async (p, c) => { FILES.set(p, c); return new TFile(p); },
		modify: async (f, c) => { FILES.set(f.path, c); },
		createFolder: async () => {},
		trash: async (f) => { FILES.delete(f.path); },
		adapter: { exists: async (p) => FILES.has(p) },
	}),
	metadataCache: Object.assign(new Events(), { getFileCache: () =>({}), resolvedLinks: {} }),
	fileManager: {
		processFrontMatter: async (f, fn) => {
			const raw = FILES.get(f.path) ?? '';
			const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
			const fm = m ? parseYaml(m[1]) : {};
			const body = m ? raw.slice(m[0].length) : raw;
			fn(fm);
			FILES.set(f.path, `---\n${stringifyYaml(fm)}---\n\n${body.replace(/^\n+/, '')}`);
		},
	},
	workspace: Object.assign(new Events(), {
		getLeavesOfType: () => [],
		getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {}, view: null }),
		revealLeaf: () => {},
		getActiveFile: () => null,
		onLayoutReady: (cb) => cb(),
	}),
	keymap: {}, scope: {}, lastEvent: null,
};

// ---------- 加载 main.js（CJS，注入 obsidian mock） ----------
const code = await readFile('main.js', 'utf8');
const mod = { exports: {} };
const req = (name) => {
	if (name === 'obsidian') return obsidianMock;
	return Module.createRequire(import.meta.url)(name);
};
const results = [];
try {
	new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
		mod.exports, req, mod, 'main.js', process.cwd(),
	);
	results.push('✅ main.js 解析并执行成功（无语法/顶层错误）');
} catch (e) {
	console.log('❌ main.js 执行失败（语法或顶层代码错误）:');
	console.log(e.stack);
	process.exit(1);
}

const PluginClass = mod.exports.default ?? mod.exports;
if (typeof PluginClass !== 'function') {
	console.log('❌ main.js 没有导出插件类。导出内容:', Object.keys(mod.exports));
	process.exit(1);
}
results.push('✅ 正确导出插件类: ' + (PluginClass.name || '(anonymous)'));

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const plugin = new PluginClass(app, manifest);

try {
	await plugin.onload();
	results.push('✅ onload() 执行成功');
} catch (e) {
	console.log('❌ onload() 抛出异常 —— 这就是「插件加载失败」的原因:');
	console.log(e.stack);
	process.exit(1);
}

// 触发 metadataCache ready，走一次全量索引
try {
	app.metadataCache.trigger('ready');
	await new Promise((r) => setTimeout(r, 300));
	results.push('✅ metadataCache ready → 全量索引成功');
} catch (e) {
	console.log('❌ 索引阶段异常:'); console.log(e.stack); process.exit(1);
}

// 打开主视图，跑一遍渲染
try {
	const viewType = Object.keys(plugin._views)[0];
	const factory = plugin._views[viewType];
	const view = factory({ view: null });
	await view.onOpen();
	await new Promise((r) => setTimeout(r, 300));
	results.push(`✅ 主视图 ${viewType} onOpen() 渲染成功`);
} catch (e) {
	console.log('❌ 视图渲染异常:'); console.log(e.stack); process.exit(1);
}

// 设置页
try {
	plugin._settingTab?.display();
	results.push('✅ 设置页 display() 成功');
} catch (e) {
	console.log('❌ 设置页异常:'); console.log(e.stack); process.exit(1);
}

try {
	plugin.onunload();
	results.push('✅ onunload() 成功');
} catch (e) {
	console.log('⚠️ onunload 异常:'); console.log(e.stack);
}

console.log(results.join('\n'));
console.log(`\n命令数: ${plugin._cmds.length}｜视图数: ${Object.keys(plugin._views).length}｜ribbon: ${plugin._ribbons.length}`);
if (NOTICES.length) console.log('Notice: ' + NOTICES.join(' / '));
console.log('\n结论：插件在模拟环境中可正常加载，未发现启动期异常。');
