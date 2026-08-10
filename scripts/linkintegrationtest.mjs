// 验证双链整合：frontmatter wikilink +正文 [[双链]] 是否都被识别为扩展卡片，
// 以及反向链接是否正确。用真实 DOM（playwright），因为要走完整渲染路径。
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const code = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('[未捕获异常]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="host"></div></body></html>');

await page.evaluate(() => {
	const applyOpts = (el, o) => {
		if (!o) return el;
		if (typeof o === 'string') { el.className = o; return el; }
		if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
		if (o.text !== undefined) el.textContent = o.text;
		if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
		return el;
	};
	const createEl = (tag, o) => applyOpts(document.createElement(tag), o);
	const P = Element.prototype;
	P.createEl = function (tag, o) { const e = createEl(tag, o); this.appendChild(e); return e; };
	P.createDiv = function (o) { return this.createEl('div', o); };
	P.createSpan = function (o) { return this.createEl('span', o); };
	P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	P.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	P.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	P.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	P.hasClass = function (c) { return this.classList.contains(c); };
	P.setText = function (t) { this.textContent = t; };
	const F = DocumentFragment.prototype;
	F.createEl = P.createEl; F.createDiv = P.createDiv; F.createSpan = P.createSpan;
	window.createEl = createEl;
	window.createDiv = (o) => createEl('div', o);
	window.createSpan = (o) => createEl('span', o);
});

const result = await page.evaluate(async ({ code, manifest }) => {
	const notices = [];
	class Events {
		constructor() { this._h = {}; }
		on(n, cb) { (this._h[n] = this._h[n] || []).push(cb); return { n, cb }; }
		off() {} offref() {}
		trigger(n, ...a) { (this._h[n] || []).forEach((cb) => cb(...a)); }
	}
	class Component { onload() {} onunload() {} registerEvent() {} register() {} addChild(c) { return c; } }
	class Plugin extends Component {
		constructor(app, m) { super(); this.app = app; this.manifest = m; this._cmds = []; this._views = {}; }
		addCommand(c) { this._cmds.push(c); return c; }
		addRibbonIcon() { return document.createElement('div'); }
		addSettingTab(t) { this._tab = t; }
		registerView(t, f) { this._views[t] = f; }
		registerEvent() {}
		async loadData() { return null; }
		async saveData() {}
	}
	class ItemView extends Component {
		constructor() {
			super();
			this.containerEl = document.createElement('div');
			this.contentEl = document.createElement('div');
			this.containerEl.appendChild(this.contentEl);
			document.getElementById('host').appendChild(this.containerEl);
		}
	}
	class Modal { constructor(app) { this.app = app; this.contentEl = document.createElement('div'); } open() { this.onOpen && this.onOpen(); } close() {} setTitle() { return this; } }
	class PluginSettingTab {
		constructor(app, p) {
			if (!p || !p.manifest) throw new Error('需要真实 Plugin');
			this.app = app; this.plugin = p; this.containerEl = document.createElement('div');
		}
	}
	class Setting {
		constructor() { this.controlEl = document.createElement('div'); }
		setName() { return this; } setDesc() { return this; } setHeading() { return this; }
		addText(cb) { cb({ inputEl: document.createElement('input'), setPlaceholder() { return this; }, setValue() { return this; }, getValue: () => '', onChange() { return this; } }); return this; }
		addToggle(cb) { const o = { setValue() { return o; }, onChange() { return o } }; cb(o); return this; }
		addDropdown(cb) { const o = { addOption() { return o; }, setValue() { return o; }, getValue: () => '', onChange() { return o } }; cb(o); return this; }
		addButton(cb) { const o = { setButtonText() { return o; }, setIcon() { return o; }, setCta() { return o; }, onClick() { return o; }, setDisabled() { return o } }; cb(o); return this; }
	}
	class Notice { constructor(m) { notices.push(String(m)); } }
	class Menu {
		constructor() { this.items = []; }
		addItem(cb) { const o = { _t: '', setTitle(t) { o._t = t; return o; }, setIcon() { return o; }, setChecked() { return o; }, onClick(f) { o._c = f; return o; }, setDisabled() { return o } }; cb(o); this.items.push(o); return this; }
		addSeparator() { return this; } showAtPosition() {}
	}
	class TFile {
		constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.\w+$/, ''); this.extension = 'md'; this.stat = { ctime: Date.now(), mtime: Date.now(), size: 1 }; }
	}
	class TFolder { constructor(p) { this.path = p; this.children = []; } }
	class ButtonComponent {
		constructor(el) { this.el = document.createElement('button'); if (el) el.appendChild(this.el); }
		setButtonText() { return this; } setIcon() { return this; } setCta() { return this; } setDisabled() { return this; } onClick() { return this; }
	}
	class TextComponent {
		constructor(el) { this.inputEl = document.createElement('input'); if (el) el.appendChild(this.inputEl); }
		setPlaceholder() { return this; } setValue() { return this; } getValue() { return ''; } onChange() { return this; }
	}
	class DropdownComponent {
		constructor(el) { this.selectEl = document.createElement('select'); if (el) el.appendChild(this.selectEl); }
		addOption() { return this; } setValue() { return this; } getValue() { return ''; } onChange() { return this; }
	}
	function parseYaml(s) {
		const out = {}; let k = null;
		for (const line of String(s).split('\n')) {
			if (!line.trim()) continue;
			const a = /^\s+-\s*(.*)$/.exec(line);
			if (a && k) { (out[k] = out[k] || []).push(a[1].replace(/^["']|["']$/g, '')); continue; }
			const m = /^([\w-]+):\s*(.*)$/.exec(line);
			if (m) {
				k = m[1]; const v = m[2].trim();
				out[k] = v === '' ? [] : v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v.replace(/^["']|["']$/g, '');
			}
		}
		return out;
	}
	function stringifyYaml(o) {
		let s = '';
		for (const [k, v] of Object.entries(o)) {
			if (Array.isArray(v)) s += k + ':\n' + v.map((x) => '  - "' + x + '"').join('\n') + '\n';
			else if (typeof v === 'string') s += k + ': "' + v + '"\n';
			else s += k + ': ' + v + '\n';
		}
		return s;
	}
	const obsidian = {
		Plugin, ItemView, Modal, PluginSettingTab, Setting, Notice, Menu, TFile, TFolder, Component, Events,
		ButtonComponent, TextComponent, DropdownComponent, TextAreaComponent: TextComponent,
		ToggleComponent: class { setValue() { return this; } onChange() { return this; } },
		parseYaml, stringifyYaml, setIcon: () => {}, normalizePath: (p) => p,
		debounce: (f) => f, Platform: { isMobile: false, isDesktop: true }, WorkspaceLeaf: class {},
	};

	// ---- 构造双链场景 ----
	// main: frontmatter children -> [[childA]]（显式）；正文 [[childB]]（正文双链）
	// other: 正文引用 [[main]] → 应出现在 main 的反向链接里
	const files = new Map();
	files.set('Cards/main.md',
		'---\nid: "main"\ncreated: 1000\nupdated: 1000\nchildren:\n  - "[[childA]]"\n---\n\n主卡片正文，引用扩展 [[childB]] 说明。');
	files.set('Cards/childA.md', '---\nid: "childA"\ncreated: 900\nupdated: 900\nparent: "[[main]]"\n---\n\n显式关联的扩展卡片。');
	files.set('Cards/childB.md', '---\nid: "childB"\ncreated: 800\nupdated: 800\n---\n\n通过正文双链关联的卡片。');
	files.set('Cards/other.md', '---\nid: "other"\ncreated: 700\nupdated: 700\n---\n\n这张卡片引用了 [[main]]。');
	// 旧格式：纯 id，验证向后兼容
	files.set('Cards/legacy.md', '---\nid: "legacy"\ncreated: 600\nupdated: 600\nchildren:\n  - "childB"\n---\n\n旧格式纯 id 关联。');

	// 正文链接表（模拟 metadataCache.links）
	const bodyLinks = {
		'Cards/main.md': [{ link: 'childB' }],
		'Cards/other.md': [{ link: 'main' }],
		'Cards/childA.md': [], 'Cards/childB.md': [], 'Cards/legacy.md': [],
	};

	const vault = Object.assign(new Events(), {
		getMarkdownFiles: () => [...files.keys()].map((p) => new TFile(p)),
		getAbstractFileByPath: (p) => (files.has(p) ? new TFile(p) : p === 'Cards' ? new TFolder(p) : null),
		cachedRead: async (f) => files.get(f.path) || '',
		read: async (f) => files.get(f.path) || '',
		create: async (p, c) => { files.set(p, c); return new TFile(p); },
		modify: async (f, c) => { files.set(f.path, c); },
		createFolder: async () => {},
		trash: async (f) => { files.delete(f.path); },
	});
	const metadataCache = Object.assign(new Events(), {
		getFileCache: (f) => ({ links: bodyLinks[f.path] || [] }),
		// 解析 linkpath 到卡片文件
		getFirstLinkpathDest: (id) => (files.has('Cards/' + id + '.md') ? new TFile('Cards/' + id + '.md') : null),
		resolvedLinks: {},
	});
	const workspace = Object.assign(new Events(), {
		getLeavesOfType: () => [], getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
		revealLeaf: () => {}, getActiveFile: () => null, onLayoutReady: (cb) => cb(),
	});
	const app = {
		vault, workspace, metadataCache,
		fileManager: {
			processFrontMatter: async (f, fn) => {
				const raw = files.get(f.path) || '';
				const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
				const fm = m ? parseYaml(m[1]) : {};
				const body = m ? raw.slice(m[0].length) : raw;
				fn(fm);
				files.set(f.path, '---\n' + stringifyYaml(fm) + '---\n\n' + body.replace(/^\n+/, ''));
			},
		},
	};

	const mod = { exports: {} };
	new Function('exports', 'require', 'module', code)(mod.exports, (n) => { if (n === 'obsidian') return obsidian; throw new Error(n); }, mod);
	const PluginClass = mod.exports.default || mod.exports;
	const plugin = new PluginClass(app, manifest);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 300));

	const idx = plugin.index;
	const main = idx.getById('main');
	const legacy = idx.getById('legacy');

	// 打开扩展视图，验证渲染
	const extType = Object.keys(plugin._views).find((t) => t.includes('extend'));
	const view = plugin._views[extType]({});
	view.setRoot('main');
	await view.onOpen();
	await new Promise((r) => setTimeout(r, 400));
	const root = view.contentEl;

	const out = {
		indexCount: idx.all().length,
		// 核心断言
		mainChildren_frontmatter: main ? main.children : null,
		mainBodyLinks: main ? main.bodyLinks : null,
		mainExtensions: main ? idx.extensionsOf(main).map((e) => e.card.id + ':' + e.source) : null,
		mainExtensionCount: main ? idx.extensionCount(main) : null,
		mainBacklinks: main ? idx.backlinksOf(main).map((c) => c.id) : null,
		// 向后兼容：旧格式纯 id
		legacyChildren: legacy ? legacy.children : null,
		legacyExtensions: legacy ? idx.extensionsOf(legacy).map((e) => e.card.id + ':' + e.source) : null,
		// 渲染结果
		renderedPanels: root.querySelectorAll('.cardbox-extend-panel').length,
		sourceBadges: [...root.querySelectorAll('.cardbox-source-badge')].map((b) => b.textContent),
		fromBodyPanels: root.querySelectorAll('.cardbox-extend-panel.is-from-body').length,
		backlinkRows: root.querySelectorAll('.cardbox-backlink-row').length,
		backlinkTitles: [...root.querySelectorAll('.cardbox-backlink-title')].map((t) => t.textContent),
		notices,
	};

	// 验证写入格式：新建关联后 frontmatter 应为 wikilink
	await plugin.service.linkChild(idx.getById('main'), idx.getById('other'));
	out.afterLinkRaw = files.get('Cards/main.md').split('---')[1].trim();

	// 验证 appendBodyLink
	const okAppend = await plugin.service.appendBodyLink(idx.getById('childA'), 'childB');
	out.appendBodyLinkResult = okAppend;
	out.childABodyAfter = files.get('Cards/childA.md').split('---').slice(2).join('---').trim();
	// 重复插入应返回 false
	out.appendBodyLinkAgain = await plugin.service.appendBodyLink(idx.getById('childA'), 'childB');

	return out;
}, { code, manifest });

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'shot-backlink.png' });
await browser.close();
