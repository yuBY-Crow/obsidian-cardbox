// 用 playwright 提供的**真实 DOM** 加载 main.js 并渲染视图，统计实际生成的卡片元素。
// 之前的 mock 用假 DOM，无法发现渲染层问题（如 DocumentFragment、insertBefore、CSS）。
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const code = await readFile('main.js', 'utf8');
const css = await readFile('styles.css', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on('console', (m) => {
	if (m.type() === 'error') console.log('[浏览器 console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[浏览器未捕获异常]', e.message));

// 注入 Obsidian 的 DOM 原型扩展（createDiv/empty/addClass 等）
//必须在 setContent 之后用 evaluate 注入：addInitScript 只对新导航生效
const injectDomExtensions = async () => {
	await page.evaluate(() => {
		const applyOpts = (el, o) => {
			if (!o) return el;
			if (typeof o === 'string') { el.className = o; return el; }
			if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
			if (o.text !== undefined) el.textContent = o.text;
			if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
			if (o.type) el.setAttribute('type', o.type);
			if (o.value !== undefined) el.value = o.value;
			if (o.placeholder !== undefined) el.placeholder = o.placeholder;
			if (o.href) el.href = o.href;
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
		P.detach = function () { this.remove(); };
		P.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
		// DocumentFragment 也需要这些方法（IncrementalList 用到）
		const F = DocumentFragment.prototype;
		F.createEl = P.createEl; F.createDiv = P.createDiv; F.createSpan = P.createSpan;
		F.empty = P.empty;
		window.createEl = createEl;
		window.createDiv = (o) => createEl('div', o);
		window.createSpan = (o) => createEl('span', o);
	});
};

await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root{--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;--background-modifier-active-hover:#e6f0fb;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;--text-on-accent:#fff;
--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
--color-red:#e05252;--color-orange:#e0892f;--color-yellow:#d9b42c;--color-green:#3fa653;
--color-blue:#3a7fd5;--color-purple:#8a5cd9;}
html,body{margin:0;height:100%;}
#host{height:900px;display:flex;}
${css}
</style></head><body><div id="host"></div></body></html>`);

await injectDomExtensions();

const result = await page.evaluate(
	async ({ code, manifest }) => {
		const log = [];
		const errors = [];

		// ---- mock obsidian（用真实 DOM）----
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
			constructor(leaf) {
				super();
				this.leaf = leaf;
				this.containerEl = document.createElement('div');
				this.contentEl = document.createElement('div');
				this.containerEl.appendChild(this.contentEl);
				document.getElementById('host').appendChild(this.containerEl);
				this.containerEl.style.flex = '1';
				this.containerEl.style.display = 'flex';
				this.contentEl.style.flex = '1';
			}
		}
		class Modal { constructor(app) { this.app = app; this.contentEl = document.createElement('div'); } open() { this.onOpen && this.onOpen(); } close() {} setTitle() { return this; } }
		class PluginSettingTab {
			constructor(app, p) {
				if (!p || !p.manifest || typeof p.manifest.id !== 'string') throw new Error('PluginSettingTab: 需要真实 Plugin实例');
				this.app = app; this.plugin = p; this.containerEl = document.createElement('div');
			}
		}
		const mk = (o) => o;
		class Setting {
			constructor(el) { this.controlEl = document.createElement('div'); }
			setName() { return this; } setDesc() { return this; } setHeading() { return this; }
			addText(cb) { cb({ inputEl: document.createElement('input'), setPlaceholder() { return this; }, setValue() { return this; }, getValue: () => '', onChange() { return this; } }); return this; }
			addToggle(cb) { const o = { setValue() { return o; }, onChange() { return o } }; cb(o); return this; }
			addDropdown(cb) { const o = { addOption() { return o; }, setValue() { return o; }, getValue: () => '', onChange() { return o } }; cb(o); return this; }
			addButton(cb) { const o = { setButtonText() { return o; }, setIcon() { return o; }, setCta() { return o; }, onClick() { return o; }, setDisabled() { return o } }; cb(o); return this; }
		}
		class Notice { constructor(m) { log.push('Notice: ' + m); } }
		class Menu {
			constructor() { this.items = []; }
			addItem(cb) { const o = { setTitle() { return o; }, setIcon() { return o; }, setChecked() { return o; }, onClick() { return o; }, setDisabled() { return o } }; cb(o); this.items.push(o); return this; }
			addSeparator() { return this; } showAtPosition() {}
		}
		class TFile {
			constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.\w+$/, ''); this.extension = this.name.split('.').pop(); this.stat = { ctime: Date.now(), mtime: Date.now(), size: 1 }; }
		}
		class TFolder { constructor(p) { this.path = p; this.children = []; } }
		class ButtonComponent {
			constructor(el) { this.el = document.createElement('button'); if (el) el.appendChild(this.el); }
			setButtonText(t) { this.el.textContent = t; return this; }
			setIcon() { return this; } setCta() { return this; } setDisabled() { return this; } onClick() { return this; }
		}
		class TextComponent {
			constructor(el) { this.inputEl = document.createElement('input'); if (el) el.appendChild(this.inputEl); }
			setPlaceholder() { return this; } setValue(v) { this.inputEl.value = v; return this; }
			getValue() { return this.inputEl.value; } onChange() { return this; }
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

		// ---- 假 vault：367 张非归档+ 58 张归档，贴近用户实际 ----
		const files = new Map();
		for (let i = 0; i < 425; i++) {
			const archived = i % 7 === 0;
			const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
			let fm = '---\nid: "c' + i + '"\ncreated: ' + (Date.now() - i * 3600000) + '\nupdated: ' + Date.now() + '\n';
			if (archived) fm += 'archived: true\n';
			if (i % 4 === 0) fm += 'color: ' + colors[i % 7] + '\n';
			if (i % 37 === 0) fm += 'pinned: true\n';
			fm += 'tags:\n  - "读书/笔记"\n---\n\n卡片正文 ' + i + '，一些内容用于测试渲染。';
			files.set('Cards/c' + i + '.md', fm);
		}
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
		const workspace = Object.assign(new Events(), {
			getLeavesOfType: () => [],
			getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
			revealLeaf: () => {},
			getActiveFile: () => null,
			onLayoutReady: (cb) => cb(),
		});
		const app = {
			vault, workspace,
			metadataCache: Object.assign(new Events(), { getFileCache: () => ({}), resolvedLinks: {} }),
			fileManager: { processFrontMatter: async () => {} },
		};

		// ---- 加载插件 ----
		const mod = { exports: {} };
		const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('未知模块 ' + n); };
		new Function('exports', 'require', 'module', code)(mod.exports, req, mod);
		const PluginClass = mod.exports.default || mod.exports;
		const plugin = new PluginClass(app, manifest);

		try { await plugin.onload(); } catch (e) { errors.push('onload: ' + e.stack); }
		await new Promise((r) => setTimeout(r, 400));

		// ---- 打开主视图 ----
		const vt = Object.keys(plugin._views)[0];
		let view;
		try {
			view = plugin._views[vt]({});
			await view.onOpen();
		} catch (e) {
			errors.push('onOpen: ' + e.stack);
		}
		await new Promise((r) => setTimeout(r, 600));

		// ---- 统计 ----
		const root = view ? view.contentEl : document.body;
		const listEl = root.querySelector('.cardbox-list');
		const ph = root.querySelector('.cardbox-placeholder');
		const tiles = root.querySelectorAll('.cardbox-tile');
		const boxtabs = root.querySelectorAll('.cardbox-boxtab');
		const chips = root.querySelectorAll('.cardbox-chips .cardbox-chip');

		const lr = listEl ? listEl.getBoundingClientRect() : null;
		const firstTile = tiles[0] ? tiles[0].getBoundingClientRect() : null;

		return {
			indexReady: plugin.index ? plugin.index.ready : null,
			indexCount: plugin.index ? plugin.index.all().length : null,
			boxtabText: [...boxtabs].map((b) => b.textContent).slice(0, 3),
			chipCount: chips.length,
			tileCount: tiles.length,
			listChildCount: listEl ? listEl.children.length : null,
			listClasses: listEl ? listEl.className : null,
			listRect: lr ? { w: Math.round(lr.width), h: Math.round(lr.height) } : null,
			firstTileRect: firstTile ? { w: Math.round(firstTile.width), h: Math.round(firstTile.height) } : null,
			placeholderVisible: ph ? !ph.classList.contains('is-hidden') : null,
			placeholderText: ph ? ph.textContent : null,
			listInnerPreview: listEl ? listEl.innerHTML.slice(0, 200) : null,
			errors, log,
		};
	},
	{ code, manifest },
);

console.log(JSON.stringify(result, null, 2));

// 截图留证：列表模式 + 平铺模式
await page.screenshot({ path: 'shot-render-list.png', clip: { x: 0, y: 0, width: 1280, height: 900 } });
// 切到平铺
await page.evaluate(() => {
	const btns = [...document.querySelectorAll('.cardbox-mode-btn')];
	const masonry = btns.find((b) => b.textContent === '平铺');
	if (masonry) masonry.click();
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'shot-render-masonry.png', clip: { x: 0, y: 0, width: 1280, height: 900 } });
const masonryInfo = await page.evaluate(() => {
	const tiles = [...document.querySelectorAll('.cardbox-tile')];
	const xs = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left)));
	return { tiles: tiles.length, columns: xs.size };
});
console.log('平铺模式:', JSON.stringify(masonryInfo));

await browser.close();
