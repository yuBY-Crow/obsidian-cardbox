// 标题视觉对比截图：用真实测试库卡片数据，看当前标题视觉是否够"标题感"
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
	// 用真实测试库数据模式：标题 fallback 为正文首行（长正文）
	const samples = [
		{ title: null, body: '卡片笔记写作法：核心框架\n卢曼的卡片盒笔记法（Zettelkasten）把写作从线性积累变为网络化生长。\n三大笔记类型中，永久笔记最关键：\n[[永久笔记：原子化、可独立存在]] 延伸阅读：[[非线性写作：从卡片到文章]]' },
		{ title: null, body: '测试笔记连接链接，内容不知道适合尝试一下为什么会这样呀\n这是第二段内容。' },
		{ title: null, body: '测试机比长度\n#测试' },
	];
	for (let i = 0; i < samples.length; i++) {
		const fm = ['---', `id: "card-${i}"`, `created: ${Date.now() - i * 3600000}`, `updated: ${Date.now()}`];
		if (i < 2) fm.push('color: blue');
		fm.push('---');
		files.set(`Cards/card-${i}.md`, new TFile(`Cards/card-${i}.md`, fm.join('\n') + '\n' + samples[i].body));
	}
	const metaCache = {
		on: (evt, cb) => { if (evt === 'ready') setTimeout(() => cb(), 0); return { ref: 0 }; },
		offref: () => {},
		getFileCache: () => ({}),
		getFirstLinkpathDest: () => null,
	};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() { return mk('div'); } addCommand() {} addSettingTab() {} registerView(t, f) { this._views[t] = f; } registerEvent() {} register() {} async loadData() { return {}; } async saveData() {} },
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
	const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('unknown ' + n); };
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
}, { mainJs, manifest });

await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-title-before.png' });
console.log('已截：当前标题视觉');
console.log('标题统计:', await page.evaluate(() => {
	const titles = [...document.querySelectorAll('.cardbox-tile-title')];
	return titles.map((t) => {
		const cs = getComputedStyle(t);
		return { text: t.textContent?.slice(0, 20), fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, lineHeight: cs.lineHeight };
	});
}));
await browser.close();