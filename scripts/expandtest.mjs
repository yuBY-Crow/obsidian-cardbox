// 完整插件加载 + 手机视口，验证：
// 1. 点击数字 → 展开子卡片出现（且数字变灰）
// 2. 再点数字 → 子卡片消失（数字恢复蓝）
// 3. 卡片标题可见
// 用法: node scripts/expandtest.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const mainJs = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const css = await readFile('styles.css', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.setContent(`<!DOCTYPE html><html><body>
<style>
:root{
--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;
--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;
--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;
--text-on-accent:#fff;--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;
--font-interface:system-ui,"Microsoft YaHei",sans-serif;
}
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif}
${css}
</style>
<div class="view-header" style="display:flex;align-items:center;height:40px;padding:0 8px;gap:6px">
  <div class="view-header-title">卡片盒</div>
  <div class="view-header-nav-buttons" style="margin-left:auto;display:flex;gap:4px"></div>
</div>
<div id="host" style="height:calc(100vh - 40px)"></div>
</body></html>`);

const result = await page.evaluate(async ({ mainJs, manifest, css }) => {
	// ---- Obsidian mock ----
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
	Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
	Element.prototype.setText = function (t) { this.textContent = t; };
	Element.prototype.detach = function () { this.remove(); };
	Element.prototype.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
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
	// 生成 30 张卡，其中 5 张带扩展卡片（frontmatter children）
	for (let i = 0; i < 30; i++) {
		const fm = ['---', `id: "card-${i}"`, `created: ${Date.now() - i * 3600000}`, `updated: ${Date.now() - i * 360000}`];
		if (i % 6 === 0) fm.push(`title: "标题卡片 ${i}"`);
		if (i < 5) {
			// 带 2 张扩展卡片
			fm.push('children:');
			fm.push(`  - "[[card-${i}-c1]]"`);
			fm.push(`  - "[[card-${i}-c2]]"`);
		}
		fm.push('---');
		const body = i < 5
			? `主卡片 ${i} 的正文内容。\n一些详细描述。`
			: `卡片正文 ${i}。`.repeat(10);
		files.set(`Cards/card-${i}.md`, new TFile(`Cards/card-${i}.md`, fm.join('\n') + '\n' + body));
	}
	// 扩展卡片
	for (let i = 0; i < 5; i++) {
		for (const c of ['c1', 'c2']) {
			const fm = ['---', `id: "card-${i}-${c}"`, `parent: "[[card-${i}]]"`, `created: ${Date.now()}`, `updated: ${Date.now()}`, '---'];
			files.set(`Cards/card-${i}-${c}.md`, new TFile(`Cards/card-${i}-${c}.md`, fm.join('\n') + '\n' + `扩展卡片 ${i}-${c} 的内容。`));
		}
	}
	const metaCache = {
		on: (evt, cb) => {
			// 'ready' 立即触发，让索引构建跑起来（真实 Obsidian 在启动后触发）
			if (evt === 'ready') setTimeout(() => cb(), 0);
			return { ref: 0 };
		},
		offref: () => {},
		getFileCache: () => ({}),
		getFirstLinkpathDest: () => null,
	};
	const obsidian = {
		Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() { return mk('div'); } addCommand() {} addSettingTab() {} registerView(t, f) { this._views[t] = f; } registerEvent() {} register() {} async loadData() { return {}; } async saveData() {} },
		ItemView: class {
			constructor(l) { this.leaf = l; this.contentEl = mk('div'); }
			addAction(icon, title, cb) {
				const btn = mk('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title } });
				obsidian.setIcon(btn, icon);
				btn.addEventListener('click', cb);
				document.querySelector('.view-header-nav-buttons').appendChild(btn);
				return btn;
			}
		},
		Modal: class { constructor(a) { this.app = a; this.contentEl = mk('div'); } open() {} close() {} },
		PluginSettingTab: class { constructor(a, p) { this.app = a; this.plugin = p; this.containerEl = mk('div'); } },
		Events: class { constructor() { this._cbs = {}; } on(t, cb) { (this._cbs[t] = this._cbs[t] || []).push(cb); return { ref: 0 }; } offref() {} trigger(t, ...a) { for (const cb of this._cbs[t] || []) cb(...a); } },
		Setting: class {
			constructor(el) { this.el = el; }
			setName() { return this; } setDesc() { return this; }
			addText(cb) { cb({ setPlaceholder: () => ({ setValue: () => ({ onChange: () => {} }) }), setValue: () => ({ onChange: () => {} }), inputEl: mk('input'), getValue: () => '' }); return this; }
			addDropdown(cb) { cb({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
			addToggle(cb) { cb({ setValue: () => ({ onChange: () => {} }) }); return this; }
			addButton(cb) { cb({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; }
			setHeading() { return this; }
		},
		Notice: class {}, Menu: class { addItem() { return this; } addSeparator() { return this; } showAtPosition() {} },
		TFile, TFolder: class {},
		ButtonComponent: class {},
		parseYaml: (s) => {
			const o = {};
			let listKey = null;
			for (const l of s.split('\n')) {
				const li = /^\s+-\s+(.+)$/.exec(l);
				if (li && listKey) {
					o[listKey].push(li[1].replace(/^"(.*)"$/, '$1').replace(/^\[\[(.*)\]\]$/, '$1'));
					continue;
				}
				const m = /^(\w+):\s*(.*)$/.exec(l);
				if (m) {
					const val = m[2].replace(/^"(.*)"$/, '$1');
					if (val === '') { listKey = m[1]; o[listKey] = []; }
					else { o[m[1]] = val; listKey = null; }
				} else {
					listKey = null;
				}
			}
			return o;
		},
		stringifyYaml: (o) => JSON.stringify(o),
		setIcon: (el, name) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('data-icon', name); svg.setAttribute('viewBox', '0 0 24 24'); svg.style.width = '14px'; svg.style.height = '14px'; const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M6 9l6 6 6-6'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); svg.appendChild(p); el.appendChild(svg); },
		getIcon: (n) => (n === 'more-vertical' ? {} : null),
		debounce: (fn) => fn,
		Platform: { isMobile: true, isDesktopApp: false },
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
			trash: async () => {},
			createFolder: async () => {},
		},
		metadataCache: metaCache,
		fileManager: {
			processFrontMatter: async (f, cb) => {
				const file = files.get(f.path) || f;
				const raw = file.content;
				const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
				let fm = {};
				if (m) {
					for (const line of m[1].split('\n')) {
						const mm = line.match(/^(\w+):\s*(.*)$/);
						if (mm) fm[mm[1]] = mm[2].replace(/^"(.*)"$/, '$1');
					}
				}
				const body = m ? raw.slice(m[0].length) : raw;
				cb(fm);
				const fmLines = ['---'];
				for (const [k, v] of Object.entries(fm)) {
					if (typeof v === 'string') fmLines.push(`${k}: "${v}"`);
					else if (Array.isArray(v)) { fmLines.push(`${k}:`); for (const x of v) fmLines.push(`  - "${x}"`); }
					else if (v !== undefined && v !== null) fmLines.push(`${k}: ${v}`);
				}
				fmLines.push('---');
				file.content = fmLines.join('\n') + '\n' + body;
			},
			renameFile: async () => {},
		},
		workspace: {
			onLayoutReady: (cb) => cb(),
			getActiveFile: () => null,
			getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
			openLinkText: async () => {},
			on: () => ({}), offref: () => {},
		},
		commands: { executeCommandById: async () => {} },
	};

	const module = { exports: {} };
	const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('unknown ' + n); };
	new Function('module', 'exports', 'require', mainJs)(module, module.exports, req);
	const PluginClass = module.exports.default ?? module.exports;
	const plugin = new PluginClass(app, manifest);
	// 直接捕获 setup 内部异常（onload 的 try/catch 会吞掉）
	const origSetup = plugin.setup ? plugin.setup.bind(plugin) : null;
	if (origSetup) {
		plugin.setup = async () => {
			try {
				await origSetup();
			} catch (e) {
				window.__setupError = String((e && e.stack) || e);
			}
		};
	}
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 800));

	// 直接创建主视图
	const vt = Object.keys(plugin._views)[0];
	if (window.__setupError) throw new Error('[SETUP FAIL] ' + window.__setupError);
	const view = plugin._views[vt]({});
	document.getElementById('host').appendChild(view.contentEl);
	await view.onOpen();
	await new Promise((r) => setTimeout(r, 800));

	// 切到平铺
	document.querySelector('.cardbox-mode-action')?.click();
	await new Promise((r) => setTimeout(r, 500));

	// 诊断：视图是否渲染、有无数字
	const dbg = {
		tiles: document.querySelectorAll('.cardbox-tile').length,
		counts: document.querySelectorAll('.cardbox-expand-count').length,
		children: document.querySelectorAll('.cardbox-tile.is-child').length,
		ready: plugin.index ? plugin.index.ready : null,
		indexCount: plugin.index ? plugin.index.all().length : null,
		rootCls: view.contentEl.className,
		hostHtml: view.contentEl.innerHTML.slice(0, 200),
	};
	if (dbg.counts === 0) return { dbg, noCounts: true };

	// 统计：带数字的卡片、标题
	const stats = () => ({
		// 列数取第一个列组（子卡片展开会另起列组，数全部会重复）
		gridCols: (document.querySelector('.cardbox-masonry-group')?.querySelectorAll('.cardbox-masonry-col').length) ?? 0,
		tileCount: document.querySelectorAll('.cardbox-tile').length,
		childTileCount: document.querySelectorAll('.cardbox-tile.is-child').length,
		expandCounts: [...document.querySelectorAll('.cardbox-expand-count')].map((e) => ({
			text: e.textContent,
			isExpanded: e.classList.contains('is-expanded'),
			bg: getComputedStyle(e).backgroundColor,
			color: getComputedStyle(e).color,
		})),
		titles: [...document.querySelectorAll('.cardbox-tile-title')].slice(0, 3).map((t) => ({
			text: t.textContent,
			display: getComputedStyle(t).display,
			h: Math.round(t.getBoundingClientRect().height),
		})),
	});

	if (dbg.counts === 0) return { dbg, noCounts: true };
	const before = stats();
	window.__beforeDebug = {
		tiles: document.querySelectorAll('.cardbox-tile').length,
		counts: document.querySelectorAll('.cardbox-expand-count').length,
		ready: plugin.index ? plugin.index.ready : null,
		indexCount: plugin.index ? plugin.index.all().length : null,
		rootCls: view.contentEl.className,
	};

	// 点第一张带数字的卡片 → 展开（用真实触摸 tap，模拟手机）
	const firstCount = document.querySelector('.cardbox-expand-count');
	const firstBgBefore = getComputedStyle(firstCount).backgroundColor;
	// 用 Playwright 真实触摸：dispatch touch 事件序列
	firstCount.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 }));
	firstCount.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 }));
	firstCount.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	await new Promise((r) => setTimeout(r, 400));
	const expanded = stats();
	// 点击后整列表重渲染，旧元素已 detached——重新查当前展开态数字的样式
	const firstBgExpanded = getComputedStyle(document.querySelector('.cardbox-expand-count')).backgroundColor;

	// 再点 → 收起（同样真实触摸序列）
	const c2 = document.querySelector('.cardbox-expand-count');
	c2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 2 }));
	c2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 2 }));
	c2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	await new Promise((r) => setTimeout(r, 400));
	const collapsed = stats();
	// 收起后数字恢复主题色
	const firstBgCollapsed = getComputedStyle(document.querySelector('.cardbox-expand-count')).backgroundColor;

	return { before, expanded, collapsed, firstBgBefore, firstBgExpanded, firstBgCollapsed, setupError: window.__setupError, debug: window.__beforeDebug };
}, { mainJs, manifest, css });

// 断言
let pass = 0, fail = 0;
const t = (name, cond, got) => {
	if (cond) pass++;
	else { fail++; console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : ''); }
};

// noCounts 分支：数字没渲染出来，打印诊断
if (result.noCounts) {
	console.log('【数字未渲染】诊断:', JSON.stringify(result.dbg, null, 2));
	t('卡片渲染出来了', result.dbg.tiles > 0, result.dbg.tiles);
	t('索引就绪且有数据', result.dbg.ready === true && result.dbg.indexCount > 0, result.dbg.indexCount);
	await browser.close();
	process.exit(fail ? 1 : 0);
}

t('平铺双列', result.expanded.gridCols === 2, result.expanded.gridCols);
t('展开前有 5 个数字', result.before.expandCounts.length === 5, result.before.expandCounts.length);
t('展开前无子卡片', result.before.childTileCount === 0, result.before.childTileCount);
t('点击数字后子卡片出现', result.expanded.childTileCount > result.before.childTileCount, { before: result.before.childTileCount, after: result.expanded.childTileCount });
t('再点数字后子卡片消失', result.collapsed.childTileCount < result.expanded.childTileCount, { exp: result.expanded.childTileCount, coll: result.collapsed.childTileCount });
t('展开态数字变灰', result.firstBgExpanded !== result.firstBgBefore, { before: result.firstBgBefore, after: result.firstBgExpanded });
t('收起后数字恢复主题色', result.firstBgCollapsed === result.firstBgBefore, { before: result.firstBgBefore, after: result.firstBgCollapsed });
t('默认数字是主题色（非灰）', result.before.expandCounts[0].bg === 'rgb(91, 110, 225)', result.before.expandCounts[0].bg);
t('标题可见且有内容', result.expanded.titles.length >= 2 && result.expanded.titles.every((x) => x.h > 0 && x.text), result.expanded.titles);
t('无未捕获异常', (result.pageErrors || []).length === 0, result.pageErrors);

console.log('--- 颜色变化 ---');
console.log('默认:', result.firstBgBefore, '→ 展开:', result.firstBgExpanded);
console.log('--- 标题样本 ---');
console.log(JSON.stringify(result.expanded.titles, null, 2));
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
