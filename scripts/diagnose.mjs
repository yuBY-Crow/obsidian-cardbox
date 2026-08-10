// 严格模拟 Obsidian 真实加载插件的方式，并主动制造各种边界条件，
// 找出「列表里有但开关点不开」的原因。
// Obsidian 实际做法（简化）：读 manifest → eval main.js → new Plugin() → await onload()
// 只要 onload() reject，Obsidian 就会捕获异常并把开关回滚。
import { readFile } from 'node:fs/promises';
import Module from 'node:module';

const code = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

// ---- 记录所有被访问的 API，找出缺失/异常 ----
const accessed = new Set();
const missing = [];

function strictProxy(target, name) {
	return new Proxy(target, {
		get(t, p) {
			const key = `${name}.${String(p)}`;
			accessed.add(key);
			if (!(p in t) && typeof p === 'string' && !p.startsWith('_') && p !== 'then') {
				missing.push(key);
				return undefined;
			}
			return t[p];
		},
	});
}

class Events {
	constructor() { this._h = {}; }
	on(n, cb) { (this._h[n] ||= []).push(cb); return { n, cb }; }
	off() {} offref() {}
	trigger(n, ...a) { (this._h[n] || []).forEach((cb) => cb(...a)); }
}
class Component { onload() {} onunload() {} registerEvent() {} register() {} addChild(c) { return c; } }
class Plugin extends Component {
	constructor(app, m) { super(); this.app = app; this.manifest = m; this._cmds = []; this._views = {}; }
	addCommand(c) {
		if (!c || typeof c.id !== 'string' || !c.id) throw new Error('addCommand:非法 id ' + JSON.stringify(c?.id));
		if (this._cmds.some((x) => x.id === c.id)) throw new Error('addCommand: 重复 id ' + c.id);
		this._cmds.push(c); return c;
	}
	addRibbonIcon() { return mockEl(); }
	addSettingTab(t) { this._tab = t; }
	registerView(type, f) {
		if (this._views[type]) throw new Error('registerView: 重复 view type ' + type);
		this._views[type] = f;
	}
	registerEvent() {}
	async loadData() { return this._data ?? null; }
	async saveData(d) { this._data = d; }
}
class ItemView extends Component {
	constructor(leaf) { super(); this.leaf = leaf; this.contentEl = mockEl(); this.containerEl = mockEl(); }
}
class Modal { constructor(app) { this.app = app; this.contentEl = mockEl(); } open() { this.onOpen?.(); } close() {} setTitle() { return this; } }
class PluginSettingTab {
	constructor(app, p) {
		// 严格模拟 Obsidian 1.13+：构造时会访问 plugin 的真实属性
		if (!app) throw new Error('PluginSettingTab: app 缺失');
		if (!p || typeof p !== 'object') throw new Error('PluginSettingTab: plugin 缺失');
		if (!p.manifest || typeof p.manifest.id !== 'string') {
			throw new Error('PluginSettingTab: 传入的不是真实 Plugin 实例（缺少 manifest.id）');
		}
		if (typeof p.addCommand !== 'function') {
			throw new Error('PluginSettingTab: 传入的不是真实 Plugin 实例（缺少 addCommand）');
		}
		this.app = app; this.plugin = p; this.containerEl = mockEl();
	}
}
class Setting {
	constructor() { this.controlEl = mockEl(); }
	setName() { return this; } setDesc() { return this; } setHeading() { return this; }
	addText(cb) { cb(mkText()); return this; } addToggle(cb) { cb(mkToggle()); return this; }
	addDropdown(cb) { cb(mkDrop()); return this; } addButton(cb) { cb(mkBtn()); return this; }
}
class Notice { constructor(m) { NOTICES.push(String(m)); } }
class Menu {
	constructor() { this.items = []; }
	addItem(cb) { const it = mkMenuItem(); cb(it); this.items.push(it); return this; }
	addSeparator() { return this; } showAtPosition() {}
}
class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.\w+$/, ''); this.extension = this.name.split('.').pop(); this.stat = { ctime: Date.now(), mtime: Date.now(), size: 1 }; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
class ButtonComponent { constructor() {} setButtonText() { return this; } setIcon() { return this; } setCta() { return this; } setDisabled() { return this; } onClick() { return this; } }
class TextComponent { constructor() { this.inputEl = mockEl(); this._v = ''; } setPlaceholder() { return this; } setValue(v) { this._v = v; return this; } getValue() { return this._v; } onChange() { return this; } }
class DropdownComponent { constructor() { this.selectEl = mockEl(); } addOption() { return this; } setValue() { return this; } getValue() { return ''; } onChange() { return this; } }

const NOTICES = [];
const mkText = () => new TextComponent();
const mkToggle = () => { const o = { setValue: () => o, onChange: () => o }; return o; };
const mkDrop = () => { const o = { addOption: () => o, setValue: () => o, getValue: () => '', onChange: () => o }; return o; };
const mkBtn = () => { const o = { setButtonText: () => o, setIcon: () => o, setCta: () => o, onClick: () => o, setDisabled: () => o, setTooltip: () => o }; return o; };
const mkMenuItem = () => {
	const o = { setTitle: () => o, setIcon: () => o, setChecked: () => o, onClick: () => o, setDisabled: () => o, setSection: () => o };
	// 故意不提供 setSubmenu，模拟旧版 Obsidian
	return o;
};

function mockEl(tag = 'div') {
	const el = { tagName: tag.toUpperCase(), children: [], classList: new Set(), style: { setProperty() {}, removeProperty() {} }, attributes: {}, textContent: '', value: '', _l: {} };
	el.createDiv = (o) => add(el, mockEl('div'), o);
	el.createSpan = (o) => add(el, mockEl('span'), o);
	el.createEl = (t, o) => add(el, mockEl(t), o);
	el.empty = () => { el.children = []; };
	el.addClass = (...c) => c.forEach((x) => el.classList.add(x));
	el.removeClass = (...c) => c.forEach((x) => el.classList.delete(x));
	el.toggleClass = (c, on) => (on ? el.classList.add(c) : el.classList.delete(c));
	el.hasClass = (c) => el.classList.has(c);
	el.setText = (t) => { el.textContent = t; };
	el.setAttribute = (k, v) => { el.attributes[k] = v; };
	el.getAttribute = (k) => el.attributes[k];
	el.addEventListener = (n, cb) => { (el._l[n] ||= []).push(cb); };
	el.removeEventListener = () => {};
	el.appendChild = (c) => { el.children.push(c); return c; };
	el.insertBefore = (c) => { el.children.push(c); return c; };
	el.querySelector = () => null;
	el.querySelectorAll = () => [];
	el.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 100, height: 20 });
	el.setPointerCapture = () => {}; el.releasePointerCapture = () => {};
	el.focus = () => {}; el.remove = () => {}; el.onclick = null;
	return el;
}
function add(p, c, o) {
	if (o) {
		if (o.cls) String(o.cls).split(/\s+/).forEach((x) => x && c.classList.add(x));
		if (o.text !== undefined) c.textContent = o.text;
		if (o.attr) Object.assign(c.attributes, o.attr);
		if (o.type) c.type = o.type;
	}
	p.children.push(c); return c;
}

globalThis.createDiv = (o) => { const e = mockEl(); if (o?.cls) String(o.cls).split(/\s+/).forEach((c) => e.classList.add(c)); if (o?.text) e.textContent = o.text; return e; };
globalThis.createSpan = globalThis.createDiv;
globalThis.createEl = (t, o) => { const e = mockEl(t); if (o?.cls) String(o.cls).split(/\s+/).forEach((c) => e.classList.add(c)); if (o?.text) e.textContent = o.text; return e; };
globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout, setInterval, clearInterval };
globalThis.document = { createElement: mockEl, createDocumentFragment: () => mockEl(), body: mockEl() };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

function parseYaml(s) {
	const out = {}; let k = null;
	for (const line of String(s).split('\n')) {
		if (!line.trim()) continue;
		const a = /^\s+-\s*(.*)$/.exec(line);
		if (a && k) { (out[k] ||= []).push(a[1].replace(/^["']|["']$/g, '')); continue; }
		const m = /^([\w-]+):\s*(.*)$/.exec(line);
		if (m) { k = m[1]; const v = m[2].trim();
			out[k] = v === '' ? [] : v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v.replace(/^["']|["']$/g, ''); }
	}
	return out;
}
function stringifyYaml(o) {
	let s = '';
	for (const [k, v] of Object.entries(o)) {
		if (Array.isArray(v)) s += `${k}:\n` + v.map((x) => `  - "${x}"`).join('\n') + '\n';
		else if (typeof v === 'string') s += `${k}: "${v}"\n`;
		else s += `${k}: ${v}\n`;
	}
	return s;
}

const obsidian = {
	Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, Menu, TFile, TFolder, Component, Events,
	ButtonComponent, TextComponent, DropdownComponent, TextAreaComponent: TextComponent,
	ToggleComponent: class { setValue() { return this; } onChange() { return this; } },
	parseYaml, stringifyYaml, setIcon: () => {}, normalizePath: (p) => p, debounce: (f) => f,
	Platform: { isMobile: false, isDesktop: true }, WorkspaceLeaf: class {},
};

// ---------- 场景化测试 ----------
const scenarios = [
	{
		name: 'A. 正常空库（Cards 文件夹不存在）',
		build: () => mkApp({ files: new Map(), folderExists: false }),
	},
	{
		name: 'B. 有 424 张卡片',
		build: () => { const f = new Map(); for (let i = 0; i < 424; i++) f.set(`Cards/c${i}.md`, `---\nid: "c${i}"\ncreated: ${Date.now()}\n---\n正文${i}`); return mkApp({ files: f, folderExists: true }); },
	},
	{
		name: 'C. createFolder 抛异常（文件夹已存在/无权限）',
		build: () => mkApp({ files: new Map(), folderExists: false, createFolderThrows: true }),
	},
	{
		name: 'D. loadData 返回损坏数据',
		build: () => mkApp({ files: new Map(), folderExists: true }), data: { boxes: 'not-an-array', defaultViewMode: 'weird', masonryMinColumnWidth: 'abc' },
	},
	{
		name: 'E. loadData 直接抛异常（data.json 损坏）',
		build: () => mkApp({ files: new Map(), folderExists: true }), dataThrows: true,
	},
	{
		name: 'F. onLayoutReady 不存在（旧版 API）',
		build: () => mkApp({ files: new Map(), folderExists: true, noLayoutReady: true }),
	},
	{
		name: 'G. 卡片 frontmatter 损坏',
		build: () => { const f = new Map(); f.set('Cards/bad.md', '---\n这不是合法YAML: [[[\n---\n正文'); f.set('Cards/ok.md', '---\nid: "ok"\n---\nok'); return mkApp({ files: f, folderExists: true }); },
	},
];

function mkApp(opt) {
	const files = opt.files;
	const vault = Object.assign(new Events(), {
		getMarkdownFiles: () => [...files.keys()].filter((p) => p.endsWith('.md')).map((p) => new TFile(p)),
		getAbstractFileByPath: (p) => (files.has(p) ? new TFile(p) : (p === 'Cards' && opt.folderExists ? new TFolder(p) : null)),
		cachedRead: async (f) => files.get(f.path) ?? '',
		read: async (f) => files.get(f.path) ?? '',
		create: async (p, c) => { files.set(p, c); return new TFile(p); },
		modify: async (f, c) => { files.set(f.path, c); },
		createFolder: async () => { if (opt.createFolderThrows) throw new Error('Folder already exists.'); },
		trash: async (f) => { files.delete(f.path); },
		adapter: { exists: async (p) => files.has(p) },
	});
	const workspace = Object.assign(new Events(), {
		getLeavesOfType: () => [],
		getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
		revealLeaf: () => {}, getActiveFile: () => null,
	});
	if (!opt.noLayoutReady) workspace.onLayoutReady = (cb) => cb();
	return {
		vault, workspace,
		metadataCache: Object.assign(new Events(), { getFileCache: () => ({}), resolvedLinks: {} }),
		fileManager: {
			processFrontMatter: async (f, fn) => {
				const raw = files.get(f.path) ?? '';
				const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
				const fm = m ? parseYaml(m[1]) : {};
				const body = m ? raw.slice(m[0].length) : raw;
				fn(fm);
				files.set(f.path, `---\n${stringifyYaml(fm)}---\n\n${body}`);
			},
		},
	};
}

// 加载模块
const mod = { exports: {} };
const req = (n) => (n === 'obsidian' ? obsidian : Module.createRequire(import.meta.url)(n));
new Function('exports', 'require', 'module', '__filename', '__dirname', code)(mod.exports, req, mod, 'main.js', process.cwd());
const PluginClass = mod.exports.default ?? mod.exports;

let anyFail = false;
for (const sc of scenarios) {
	const app = sc.build();
	const p = new PluginClass(app, manifest);
	if (sc.data) p._data = sc.data;
	if (sc.dataThrows) p.loadData = async () => { throw new Error('Unexpected token in JSON'); };
	let status = '✅';
	let detail = '';
	try {
		await p.onload();
		// 触发索引
		app.metadataCache.trigger('ready');
		await new Promise((r) => setTimeout(r, 120));
		// 打开视图
		const vt = Object.keys(p._views)[0];
		if (vt) { const v = p._views[vt]({}); await v.onOpen(); await new Promise((r) => setTimeout(r, 120)); }
		p._tab?.display?.();
		p.onunload();
	} catch (e) {
		status = '❌ onload/运行抛异常 → Obsidian 会回滚开关';
		detail = '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ');
		anyFail = true;
	}
	console.log(`${status} ${sc.name}${detail}`);
}

console.log('\n命令 id 列表:');
const p2 = new PluginClass(mkApp({ files: new Map(), folderExists: true }), manifest);
await p2.onload();
p2._cmds.forEach((c) => console.log('' + c.id + '  →  ' + c.name));
p2.onunload();

if (missing.length) console.log('\n访问了不存在的 API:', [...new Set(missing)].join(', '));
console.log(anyFail ? '\n⚠️ 存在会导致「开关点不开」的场景' : '\n所有场景均未抛异常');
