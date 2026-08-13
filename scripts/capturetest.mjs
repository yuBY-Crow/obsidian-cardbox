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
		Modal: class {
			constructor(a) {
				this.app = a;
				// 模拟 Obsidian 真实 modal DOM（真机日志确认）：
				// container > modalEl > (modal-header-button 关闭按钮, modal-header 标题栏, modal-content)
				const container = mk('div'); container.className = 'modal-container';
				this.modalEl = mk('div'); this.modalEl.className = 'modal';
				this.modalEl.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-direction:column';
				const closeBtn = mk('div'); closeBtn.className = 'modal-header-button mod-raised clickable-icon';
				this.titleEl = mk('div'); this.titleEl.className = 'modal-header';
				this.contentEl = mk('div'); this.contentEl.className = 'modal-content';
				this.modalEl.appendChild(closeBtn);
				this.modalEl.appendChild(this.titleEl);
				this.modalEl.appendChild(this.contentEl);
				container.appendChild(this.modalEl);
				document.body.appendChild(container);
				this.containerEl = container;
			}
			open() { this.onOpen?.(); }
			close() { this.onClose?.(); }
			setTitle() {}
		},
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
		Component: class { load() {} unload() {} },
		MarkdownRenderer: { render: async () => {} },
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
		hasPreview: !!document.querySelector('.cardbox-capture-preview'),
		modalRect: (() => { const m = document.querySelector('.modal'); if (!m) return null; const r = m.getBoundingClientRect(); return { top: Math.round(r.top) }; })(),
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
			return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopWidth, minHeight: cs.minHeight, borderRadius: cs.borderRadius };
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
		// 关闭按钮必须显示并对齐标题栏：直径 = 标题栏高度，圆心对齐中点
		closeBtnVisible: (() => {
			const btn = document.querySelector('.modal-header-button');
			if (!btn) return 'no-btn';
			return getComputedStyle(btn).display === 'none' ? 'hidden' : 'visible';
		})(),
		closeBtnRect: (() => { const b = document.querySelector('.modal-header-button'); if (!b) return null; const r = b.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })(),
		modalScoped: !!document.querySelector('.modal.cardbox-capture-modal'),
		// 标题贴顶：距 capture 容器顶部的距离
		titleOffsetTop: (() => {
			const cap = document.querySelector('.cardbox-capture');
			const t = document.querySelector('.cardbox-capture-title');
			if (!cap || !t) return null;
			return Math.round(t.getBoundingClientRect().top - cap.getBoundingClientRect().top);
		})(),
		// 首字符对齐圆角切点：标题左内边距 vs modal 圆角半径
		alignment: (() => {
			const modal = document.querySelector('.cardbox-capture-modal');
			const t = document.querySelector('.cardbox-capture-title');
			if (!modal || !t) return null;
			return {
				titlePaddingLeft: getComputedStyle(t).paddingLeft,
				modalRadius: getComputedStyle(modal).borderTopLeftRadius,
			};
		})(),
		// 标题文字垂直居中：上下 padding 相等 + line-height = 高度
		titleCentering: (() => {
			const t = document.querySelector('.cardbox-capture-title');
			if (!t) return null;
			const cs = getComputedStyle(t);
			return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, height: cs.height, lineHeight: cs.lineHeight };
		})(),
		// footer 下沿间距（贴近输入法，5~10px）
		footerPaddingBottom: (() => {
			const f = document.querySelector('.cardbox-capture-footer');
			return f ? getComputedStyle(f).paddingBottom : null;
		})(),
		order: [...document.querySelector('.cardbox-capture')?.children ?? []].map((c) => c.className),
	};
}, { mainJs, manifest });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

// ---- 结构 ----
t('CaptureModal 已打开（有 .cardbox-capture）', result.modalCls === 'yes', result.modalCls);
t('实时预览开启（capturePreview 默认 true）→ 有预览区', result.hasPreview === true, result.hasPreview);
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

// ---- 本轮 5 项改动 ----
t('①关闭按钮已显示（之前错误隐藏，已恢复）', result.closeBtnVisible === 'visible', result.closeBtnVisible);
t('①关闭按钮直径 = 标题栏高度 52px', result.closeBtnRect?.width === 52 && result.closeBtnRect?.height === 52, result.closeBtnRect);
t('①关闭按钮圆心与标题栏中点对齐（关闭按钮 top = 标题 top = modal 顶）', result.closeBtnRect && result.closeBtnRect.top === (result.modalRect?.top ?? -999), { closeBtnTop: result.closeBtnRect?.top, modalTop: result.modalRect?.top });
t('①样式作用域挂在 modalEl 上（能压过主题）', result.modalScoped, result.modalScoped);
t('②标题贴顶（距容器顶 ≤2px）', (result.titleOffsetTop ?? 99) <= 2, result.titleOffsetTop);
t('②标题文字垂直居中（上下 padding 相等）', result.titleCentering?.paddingTop === result.titleCentering?.paddingBottom, result.titleCentering);
t('②标题 line-height = 框高（单行居中）', result.titleCentering?.lineHeight === result.titleCentering?.height, result.titleCentering);
t('②首字符与圆角切点对齐（左内边距 = 圆角半径）', result.alignment?.titlePaddingLeft === result.alignment?.modalRadius, result.alignment);
t('③正文区有基本输入高度（≥200px）', (result.inputStyle?.h ?? 0) >= 200, { input: result.inputStyle?.h });
t('④连续创建无底色（背景透明）', result.modeStyle?.bg === 'rgba(0, 0, 0, 0)' || result.modeStyle?.bg === 'transparent', result.modeStyle);
t('④连续创建底版为圆角（border-radius 999px）', parseFloat(result.modeStyle?.borderRadius ?? '0') >= 100, result.modeStyle);
t('⑤footer 下沿间距 5~10px（贴近输入法）', (() => { const p = parseFloat(result.footerPaddingBottom ?? '99'); return p >= 5 && p <= 10; })(), result.footerPaddingBottom);

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

// ---- 正文区基本高度 ----
t('正文区有基本输入高度（≥200px）', (result.inputStyle?.h ?? 0) >= 200, { input: result.inputStyle?.h });

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