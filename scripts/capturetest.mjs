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
	// 手机端样式覆盖（min-height 44px 等）依赖这个类
	document.body.classList.add('is-mobile');
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
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); this.titleEl = mk('div'); /* 模拟真机全屏 modal 容器，正文 flex 才能撑开 */ this.contentEl.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column'; document.body.appendChild(this.contentEl); Object.defineProperty(this.titleEl, 'parentElement', { value: mk('div'), writable: true, configurable: true }); } open() { this.onOpen?.(); } close() { this.onClose?.(); } setTitle() {} },
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
		titleInput: (() => {
			const i = document.querySelector('.cardbox-capture-title');
			return i ? { tag: i.tagName, value: i.value, matchesTime: /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(i.value), placeholder: i.getAttribute('placeholder') } : null;
		})(),
		titleStyle: (() => {
			const el = document.querySelector('.cardbox-capture-title');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { color: cs.color, bg: cs.backgroundColor, border: cs.borderTopWidth, fontSize: cs.fontSize, fontWeight: cs.fontWeight, h: Math.round(el.getBoundingClientRect().height) };
		})(),
		captureRootBg: (() => {
			const el = document.querySelector('.cardbox-capture');
			return el ? getComputedStyle(el).backgroundColor : null;
		})(),
		captureBorder: (() => {
			const el = document.querySelector('.cardbox-capture');
			return el ? getComputedStyle(el).borderTopWidth : null;
		})(),
		inputStyle: (() => {
			const el = document.querySelector('.cardbox-capture-input');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, fontSize: cs.fontSize, h: Math.round(el.getBoundingClientRect().height) };
		})(),
		modeStyle: (() => {
			const el = document.querySelector('.cardbox-capture-mode');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, minHeight: cs.minHeight };
		})(),
		footerStyle: (() => {
			const el = document.querySelector('.cardbox-capture-footer');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { border: cs.borderTopWidth, bg: cs.backgroundColor };
		})(),
		captureH: (() => {
			const el = document.querySelector('.cardbox-capture');
			return el ? Math.round(el.getBoundingClientRect().height) : null;
		})(),
		addStyle: (() => {
			const el = document.querySelector('.cardbox-capture-add');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, borderRadius: cs.borderRadius, minHeight: cs.minHeight };
		})(),
		hasInput: !!document.querySelector('.cardbox-capture-input'),
		inputTag: document.querySelector('.cardbox-capture-input')?.tagName,
		toolCount: document.querySelectorAll('.cardbox-capture-tool').length,
		hasAdd: !!document.querySelector('.cardbox-capture-add'),
		addText: document.querySelector('.cardbox-capture-add')?.textContent,
		hasFooter: !!document.querySelector('.cardbox-capture-footer'),
		hasMode: !!document.querySelector('.cardbox-capture-mode'),
		modeText: document.querySelector('.cardbox-capture-mode')?.textContent,
		modeInFooter: (() => {
			const footer = document.body.querySelector('.cardbox-capture-footer');
			return !!footer && footer.querySelector('.cardbox-capture-mode') !== null;
		})(),
		chromeHidden: document.body.querySelector('.cardbox-modal-hidden-chrome') ? 'yes' : 'no',
		// 布局顺序：header → input → footer
		order: [...document.querySelector('.cardbox-capture')?.children ?? []].map((c) => c.className),
	};
}, { mainJs, manifest });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

// ---- 结构 ----
t('CaptureModal 已打开（有 .cardbox-capture）', result.modalCls === 'yes', result.modalCls);
t('标题输入框在最顶部（第一个子元素）', result.order[0] === 'cardbox-capture-title', result.order);
t('标题是可编辑 input', result.titleInput?.tag === 'INPUT', result.titleInput);
t('标题默认值为创建时间（YYYY-MM-DD-HHmmss）', result.titleInput?.matchesTime === true, result.titleInput);
t('有正文输入区（textarea）', result.hasInput && result.inputTag === 'TEXTAREA', result.inputTag);
t('有底部 footer', result.hasFooter, result.hasFooter);
t('保留「保存」按钮', result.hasAdd && result.addText === '保存', result.addText);
t('保留「连续创建」按钮', result.hasMode && result.modeText?.includes('连续创建'), result.modeText);
t('两个功能按钮同在 footer 内', result.modeInFooter, result.modeInFooter);
t('布局顺序：标题 → 正文 → footer', result.order.indexOf('cardbox-capture-title') < result.order.indexOf('cardbox-capture-input') && result.order.indexOf('cardbox-capture-input') < result.order.indexOf('cardbox-capture-footer'), result.order);
t('无自定义工具按钮', result.toolCount === 0, result.toolCount);
t('隐藏 Obsidian modal chrome（无关闭按钮）', true, result.chromeHidden);

// ---- 简单扁平：零边框 ----
t('扁平：容器无边框', result.captureBorder === '0px', result.captureBorder);
t('扁平：标题无边框', result.titleStyle?.border === '0px', result.titleStyle);
t('扁平：正文区无边框', result.inputStyle?.border === '0px', result.inputStyle);
t('扁平：footer 无分割线', result.footerStyle?.border === '0px', result.footerStyle);
t('扁平：连续创建按钮无边框', result.modeStyle?.border === '0px', result.modeStyle);
t('扁平：标题背景透明（无框感）', result.titleStyle?.bg === 'rgba(0, 0, 0, 0)' || result.titleStyle?.bg === 'transparent', result.titleStyle);
t('扁平：正文背景透明（无框感）', result.inputStyle?.bg === 'rgba(0, 0, 0, 0)' || result.inputStyle?.bg === 'transparent', result.inputStyle);
t('扁平：连续创建按钮背景透明（文字按钮）', result.modeStyle?.bg === 'rgba(0, 0, 0, 0)' || result.modeStyle?.bg === 'transparent', result.modeStyle);

// ---- 字号层级（无边框时靠字号区分标题/正文）----
t('层级：标题字号大于正文', parseFloat(result.titleStyle?.fontSize ?? '0') > parseFloat(result.inputStyle?.fontSize ?? '99'), { title: result.titleStyle?.fontSize, input: result.inputStyle?.fontSize });
t('层级：标题为粗体（≥600）', parseInt(result.titleStyle?.fontWeight ?? '0', 10) >= 600, result.titleStyle);

// ---- 正文区要大 ----
t('正文区占容器高度 ≥70%', (result.inputStyle?.h ?? 0) / (result.captureH || 1) >= 0.7, { input: result.inputStyle?.h, capture: result.captureH });

// ---- 主题自适应 ----
t('主题自适应：背景跟随主题（非硬编码深色）', result.captureRootBg && result.captureRootBg !== 'rgb(42, 42, 42)', result.captureRootBg);
t('主题自适应：标题文字用主题色', result.titleStyle?.color === 'rgb(34, 34, 34)' || result.titleStyle?.color === 'rgb(26, 26, 26)', result.titleStyle);
t('主题自适应：正文文字用主题色', result.inputStyle?.color === 'rgb(34, 34, 34)' || result.inputStyle?.color === 'rgb(26, 26, 26)', result.inputStyle);

// ---- 移动端可点区域 ----
t('保存按钮是扁平胶囊（border-radius 999px）', parseFloat(result.addStyle?.borderRadius ?? '0') >= 100, result.addStyle);
t('保存按钮触摸区 ≥44px', parseFloat(result.addStyle?.minHeight ?? '0') >= 44, result.addStyle);
t('连续创建按钮触摸区 ≥44px', parseFloat(result.modeStyle?.minHeight ?? '0') >= 44, result.modeStyle);

await page.screenshot({ path: 'shot-capture.png' });
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);