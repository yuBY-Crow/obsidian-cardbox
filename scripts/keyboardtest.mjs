// 验证手机端新建卡片下部贴合输入法键盘顶部
// 模拟键盘弹出（visualViewport 高度缩小）→ 断言 modal transform 上移
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const mainJs = await readFile('main.js', 'utf8');
const css = await readFile('styles.css', 'utf8');
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
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif}
.modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:99}
.modal{background:#fff;border-radius:14px;width:390px;max-height:calc(100vh - 60px);display:flex;flex-direction:column}
.modal-close-button{display:none}
.modal-title{display:none}
.modal-content{display:flex;flex-direction:column;flex:1;min-height:0}
</style>
<div id="host"></div>
</body></html>`);

const result = await page.evaluate(async ({ mainJs, manifest, css }) => {
	// 注入插件样式（这样 align-items flex-end 等 CSS 才生效）
	const styleEl = document.createElement('style');
	styleEl.textContent = css;
	document.head.appendChild(styleEl);
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
	Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	Element.prototype.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	Element.prototype.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	Element.prototype.setText = function (t) { this.textContent = t; };
	window.createDiv = (o) => mk('div', o);
	window.createSpan = (o) => mk('span', o);
	window.createEl = mk;

	class TFile { constructor(p) { this.path = p; this.extension = 'md'; this.name = p; } }
	const files = new Map();
	const metaCache = { on: (evt, cb) => { if (evt === 'ready') setTimeout(cb, 0); return { ref: 0 }; }, offref: () => {}, getFileCache: () => ({}) };
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() {} addCommand() {} addSettingTab() {} registerView() {} async loadData() { return { continuousCaptureDefault: true }; } async saveData() {} },
		ItemView: class { constructor(l) { this.leaf = l; this.contentEl = mk('div'); } addAction() {} },
		Modal: class {
			constructor(a) {
				this.app = a;
				this.containerEl = mk('div'); this.containerEl.className = 'modal-container';
				this.modalEl = mk('div'); this.modalEl.className = 'modal';
				const closeBtn = mk('div'); closeBtn.className = 'modal-close-button';
				this.titleEl = mk('div'); this.titleEl.className = 'modal-title';
				this.contentEl = mk('div'); this.contentEl.className = 'modal-content';
				this.modalEl.appendChild(closeBtn);
				this.modalEl.appendChild(this.titleEl);
				this.modalEl.appendChild(this.contentEl);
				this.containerEl.appendChild(this.modalEl);
				document.body.appendChild(this.containerEl);
			}
			open() { this.onOpen?.(); }
			close() { this.onClose?.(); }
			setTitle() {}
		},
		PluginSettingTab: class { constructor() {} },
		Events: class { constructor() {} on() { return { ref: 0 }; } offref() {} },
		Setting: class { constructor() {} },
		Notice: class {},
		Menu: class { addItem() { return this; } showAtPosition() {} },
		TFile, TFolder: class {},
		ButtonComponent: class {},
		parseYaml: () => ({}),
		stringifyYaml: (o) => JSON.stringify(o),
		setIcon: () => {},
		getIcon: () => null,
		debounce: (fn) => fn,
		// Platform 加 Obsidian 移动端内置的键盘属性（mock 可动态改）
		Platform: {
			isMobile: true,
			isMobileApp: true,
			isAndroidApp: true,
			get mobileKeyboardHeight() { return mockPlatformKeyboardHeight; },
			get mobileSoftKeyboardVisible() { return mockPlatformKeyboardVisible; },
			get mobileDeviceHeight() { return 844; },
		},
		normalizePath: (p) => p,
	};
	const app = {
		vault: {
			on: () => ({ offref: () => {} }), getFiles: () => [], getMarkdownFiles: () => [],
			getAbstractFileByPath: () => null, read: async () => '', cachedRead: async () => '',
			create: async (p) => { const f = new TFile(p); files.set(p, f); return f; },
			modify: async () => {}, trash: async () => {}, createFolder: async () => {},
		},
		metadataCache: metaCache,
		fileManager: { processFrontMatter: async () => {}, renameFile: async () => {} },
		workspace: { onLayoutReady: (cb) => cb(), getActiveFile: () => null, getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }), openLinkText: async () => {}, on: () => ({}), offref: () => {} },
		commands: { executeCommandById: async () => {} },
	};
	const module = { exports: {} };
	const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('(' + n + ')'); };
	new Function('module', 'exports', 'require', mainJs)(module, module.exports, req);
	const PluginClass = module.exports.default ?? module.exports;
	const plugin = new PluginClass(app, manifest);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 300));

	// 模拟真实微信输入法 + Android（dpr=3）场景：
	// - innerHeight 不变（WebView 不 resize，Capacitor 全屏 bug）
	// - visualViewport.height 不变
	// - 唯一信号：Capacitor Keyboard 事件上报 keyboardHeight=319（已是 CSS 像素）
	// 关键：验证不再除以 devicePixelRatio（旧 bug 会把 319 除成 106）
	window.devicePixelRatio = 3;
	let mockVvHeight = 890;
	const vvListeners = { resize: [], scroll: [] };
	window.visualViewport = {
		get height() { return mockVvHeight; },
		addEventListener: (t, cb) => vvListeners[t].push(cb),
		removeEventListener: (t, cb) => { const i = vvListeners[t].indexOf(cb); if (i >= 0) vvListeners[t].splice(i, 1); },
	};
	let mockPlatformKeyboardHeight = 0;
	let mockPlatformKeyboardVisible = false;

	// Capacitor Keyboard mock：捕获 addListener 回调
	const capListeners = {};
	window.Capacitor = {
		Plugins: {
			Keyboard: {
				addListener: (event, cb) => {
					(capListeners[event] ??= []).push(cb);
					return Promise.resolve({ remove: () => {} });
				},
			},
		},
	};

	// 打开 CaptureModal
	const ctx = plugin.ctx;
	ctx.openCapture();
	await new Promise((r) => setTimeout(r, 200));

	const modal = document.querySelector('.modal');
	const container = document.querySelector('.modal-container');
	const capture = document.querySelector('.cardbox-capture');

	// 状态 1：无键盘
	const bottomNoKeyboard = modal.style.bottom;
	const heightNoKeyboard = capture.style.height;

	// 模拟微信输入法弹出：Capacitor 上报 319px（CSS 像素，不应被 dpr 除）
	(capListeners['keyboardWillShow'] ?? []).forEach((cb) => cb({ keyboardHeight: 319 }));
	await new Promise((r) => setTimeout(r, 50));
	const bottomWithWeChatKeyboard = modal.style.bottom;
	const heightWithWeChatKeyboard = capture.style.height;

	// 模拟键盘收起
	(capListeners['keyboardWillHide'] ?? []).forEach((cb) => cb());
	await new Promise((r) => setTimeout(r, 50));
	const bottomKeyboardClosed = modal.style.bottom;
	const heightKeyboardClosed = capture.style.height;

	return {
		hasContainerClass: container.classList.contains('cardbox-capture-container'),
		hasModalClass: modal.classList.contains('cardbox-capture-modal'),
		bottomNoKeyboard,
		bottomWithWeChatKeyboard,
		bottomKeyboardClosed,
		heightNoKeyboard,
		heightWithWeChatKeyboard,
		heightKeyboardClosed,
		modalPosition: getComputedStyle(modal).position,
	};
}, { mainJs, manifest, css });

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); } };

t('modal 容器加了底部对齐 class', result.hasContainerClass, result.hasContainerClass);
t('modalEl 加了作用域 class', result.hasModalClass, result.hasModalClass);
t('手机端 modal 为 fixed 定位（绕开容器 flex 布局）', result.modalPosition === 'fixed', result.modalPosition);
t('无键盘时 modal bottom 为空（默认 0）', result.bottomNoKeyboard === '' || result.bottomNoKeyboard === undefined, result.bottomNoKeyboard);
t('无键盘时卡片高度为默认（空）', result.heightNoKeyboard === '' || result.heightNoKeyboard === undefined, result.heightNoKeyboard);
t('dpr=3 时 Capacitor 上报 319px → modal bottom=319px（不再被 dpr 除）', result.bottomWithWeChatKeyboard === '319px', result.bottomWithWeChatKeyboard);
t('键盘弹出时卡片高度 = innerHeight(844) - 键盘(319) - 上移量(20) = 505px', result.heightWithWeChatKeyboard === '505px', result.heightWithWeChatKeyboard);
t('键盘收起后 modal bottom 复位', result.bottomKeyboardClosed === '' || result.bottomKeyboardClosed === undefined, result.bottomKeyboardClosed);
t('键盘收起后卡片高度复位', result.heightKeyboardClosed === '' || result.heightKeyboardClosed === undefined, result.heightKeyboardClosed);

console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
