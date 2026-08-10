/**
 * 真机复现：完整 main.js + 手机视口 + Platform.isMobile=true + body.is-mobile，
 * 渲染平铺视图并检测卡片重叠。domtest 是桌面视口，测不到手机端布局。
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const mainJs = await readFile('main.js', 'utf8');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const styles = await readFile('styles.css', 'utf8');

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
--cardbox-col-min:260px;
}
body{margin:0;padding:0;font-family:system-ui,"Microsoft YaHei",sans-serif}
${styles}
</style>
<div class="view-header" style="display:flex;align-items:center;height:40px;padding:0 8px;gap:6px">
  <div class="view-header-title">卡片盒</div>
  <div class="view-header-nav-buttons" style="margin-left:auto;display:flex;gap:4px"></div>
</div>
<div id="host" style="height:calc(100vh - 40px)"></div>
</body></html>`);

const expMode = Number(process.env.EXP ?? 0);
const result = await page.evaluate(
	async ({ code, manifest, expMode }) => { window.__EXP_MODE__ = expMode;
		document.body.classList.add('is-mobile');
// ===== A/B 对照（组合矩阵） =====
		const exp = window.__EXP_MODE__ || 0;
		const rule = (sel, props) => document.body.appendChild(Object.assign(document.createElement('style'), { textContent: sel + ' { ' + props + ' }' }));
		// 1: 全禁（对照，应正常）
		if (exp === 1) rule('body.is-mobile .cardbox-list.is-masonry .cardbox-tile', 'max-height: none !important; overflow: visible !important');
		// 2: 只禁 max-height
		if (exp === 2) rule('body.is-mobile .cardbox-list.is-masonry .cardbox-tile', 'max-height: none !important');
		// 3: 只禁 overflow
		if (exp === 3) rule('body.is-mobile .cardbox-list.is-masonry .cardbox-tile', 'overflow: visible !important');
		// 4: 禁 flex display
		if (exp === 4) rule('body.is-mobile .cardbox-list.is-masonry .cardbox-tile', 'display: block !important');
		if (exp === 5) rule('body.is-mobile .cardbox-list.is-masonry .cardbox-tile', 'display: block !important; max-height: none !important; overflow: visible !important');
		if (exp === 6) rule('body.is-mobile .cardbox-list.is-masonry', 'grid-template-columns: 1fr !important;');
		if (exp === 7) rule('.cardbox-list', 'display: block !important;');
		if (exp === 8) rule('.cardbox-list.is-masonry .cardbox-tile', 'min-height: 200px !important;');
		if (exp === 9) rule('.cardbox-list.is-masonry', 'align-items: stretch !important;');
const probe = window.__PROBE || (window.__PROBE = {});

		// ---- Obsidian DOM 原型 ----
		const applyOpts = (el, o) => {
			if (!o) return el;
			if (typeof o === 'string') { el.className = o; return el; }
			if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
			if (o.text !== undefined) el.textContent = o.text;
			if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
			if (o.type) el.setAttribute('type', o.type);
			if (o.value !== undefined) el.value = o.value;
			if (o.placeholder !== undefined) el.placeholder = o.placeholder;
			return el;
		};
		const mk = (tag, o) => applyOpts(document.createElement(tag), o);
		const P = Element.prototype;
		P.createEl = function (tag, o) { const e = mk(tag, o); this.appendChild(e); return e; };
		P.createDiv = function (o) { return this.createEl('div', o); };
		P.createSpan = function (o) { return this.createEl('span', o); };
		P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
		P.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
		P.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
		P.toggleClass = function (c, on) { this.classList.toggle(c, on); };
		P.hasClass = function (c) { return this.classList.contains(c); };
		P.setText = function (x) { this.textContent = x; };
		P.detach = function () { this.remove(); };
		P.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
		window.createEl = mk;
		window.createDiv = (o) => mk('div', o);
		window.createSpan = (o) => mk('span', o);
		const F = DocumentFragment.prototype;
		F.createEl = P.createEl; F.createDiv = P.createDiv; F.createSpan = P.createSpan;

		// ---- 假 Vault：425 张卡片 ----
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
		for (let i = 0; i < 425; i++) {
			const title = i % 10 === 0 ? `示例卡片 ${i}` : undefined;
			const fm = ['---', `created: ${Date.now() - i * 3600000}`, `updated: ${Date.now() - i * 360000}`];
			const tags = [];
			if (i % 3 === 0) tags.push('灵感');
			if (i % 5 === 0) tags.push('读书/笔记');
			if (i % 7 === 0) tags.push('工作/会议');
			if (tags.length) fm.push(`tags:\n${tags.map((t) => `  - "${t}"`).join('\n')}`);
			if (title) fm.push(`title: "${title}"`);
			if (i % 11 === 0) fm.push('color: blue');
			if (i % 13 === 0) fm.push('pinned: true');
			fm.push('---');
			const body = `卡片正文 ${i}。`.repeat(20) + '\n\n一些详细内容。';
			files.set(`Cards/card-${i}.md`, new TFile(`Cards/card-${i}.md`, fm.join('\n') + '\n' + body));
		}
		const metaCache = {
			on: () => ({}), offref: () => {},
			getFileCache: () => ({ links: [] }),
			getFirstLinkpathDest: (link) => { for (const f of files.values()) if (f.basename === link) return f; return null; },
			resolvedLinks: {},
		};
		const app = {
			vault: {
				on: () => ({}), offref: () => {},
				getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === 'md'),
				getAbstractFileByPath: (p) => files.get(p) ?? null,
				cachedRead: async (f) => f.content,
				read: async (f) => f.content,
				create: async (p, c) => { const f = new TFile(p, c); files.set(p, f); return f; },
				modify: async (f, c) => { f.content = c; },
				createFolder: async () => {}, trash: async () => {},
				rename: async () => {},
			},
			fileManager: {
				renameFile: async () => {},
				processFrontMatter: async (f, fn) => { const fm = {}; fn(fm); f.content = '---\n' + JSON.stringify(fm) + '\n---\n' + f.content.slice(f.content.indexOf('---', 3) === -1 ? 0 : 200); },
			},
			workspace: {
				on: () => ({}), offref: () => {},
				onLayoutReady: (cb) => cb(),
				getLeavesOfType: () => [],
				getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
				getActiveFile: () => null,
				revealLeaf: () => {},
			},
			metadataCache: metaCache,
			keymap: {}, scope: {},
		};
		const obsidian = {
			Plugin: class { constructor(a, m) { this.app = a; this.manifest = m; this._views = {}; } addRibbonIcon() { return mk('div'); } addCommand() {} addSettingTab() {} registerView(t, f) { this._views[t] = f; } registerEvent() {} register() {} async loadData() { return {}; } async saveData() {} },
			// ItemView 必须提供 addAction：真实 Obsidian 会把图标挂进 view header
			// （与标题同一行）。mock 用独立的 .view-header-nav-buttons 容器模拟，
			// 这样能验证「图标不在 contentEl 内」= 不占用卡片预览空间。
			ItemView: class {
				constructor(l) {
					this.leaf = l;
					this.contentEl = mk('div');
				}
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
			parseYaml: (s) => { const o = {}; for (const l of s.split('\n')) { const m = /^(\w+):\s*(.*)$/.exec(l); if (m) o[m[1]] = m[2].replace(/^"|"$/g, ''); } return o; },
			stringifyYaml: (o) => JSON.stringify(o),
			setIcon: (el) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.style.width = '14px'; svg.style.height = '14px'; el.appendChild(svg); },
			debounce: (fn) => fn,
			Platform: { isMobile: true, isDesktopApp: false },
			normalizePath: (p) => p,
		};

		const module = { exports: {} };
		const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('unknown ' + n); };
		new Function('module', 'exports', 'require', code)(module, module.exports, req);
		const PluginClass = module.exports.default ?? module.exports;
		const plugin = new PluginClass(app, manifest);
		await plugin.onload();
		await new Promise((r) => setTimeout(r, 600));

		// 直接创建主视图（domtest 同款方式）
		const vt = Object.keys(plugin._views)[0];
		let view = null;
		try {
			view = plugin._views[vt]({});
			// 视图 contentEl 挂到文档（否则 querySelector 找不到）
			document.getElementById('host').appendChild(view.contentEl);
			await view.onOpen();
		} catch (e) {
			console.error('onOpen err', e && e.stack || e);
		}
		await new Promise((r) => setTimeout(r, 800));

		// 切到平铺：视图按钮现在注册在 view header 里（.cardbox-mode-action）
		const mobileModeBtn = document.querySelector('.cardbox-mode-action');
		if (mobileModeBtn) {
			// 点击循环 card→masonry
			mobileModeBtn.click();
			await new Promise((r) => setTimeout(r, 300));
		}
		await new Promise((r) => setTimeout(r, 500));

		// 检测重叠
		const tiles = [...document.querySelectorAll('.cardbox-list .cardbox-tile')];
		const rects = tiles.map((t) => { const r = t.getBoundingClientRect(); return { id: t.getAttribute('data-card-id'), x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, w: Math.round(r.width), h: Math.round(r.height) }; });
		const overlaps = [];
		for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
			const A = rects[i], B = rects[j];
			const ox = Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1);
			const oy = Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1);
			if (ox > 1 && oy > 1) overlaps.push({ a: A.id, b: B.id, ox: Math.round(ox), oy: Math.round(oy) });
		}
		// 结构调试：首几张卡片的内部高度（找行高塌缩根源）
		const firstFew = tiles.slice(0, 6).map((t) => {
			const r = t.getBoundingClientRect();
			const main = t.querySelector('.cardbox-tile-main');
			const bodyEl = t.querySelector('.cardbox-tile-body');
			const snip = t.querySelector('.cardbox-tile-snippet');
			return {
				id: t.getAttribute('data-card-id'),
				x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
				mainH: main ? Math.round(main.getBoundingClientRect().height) : -1,
				bodyH: bodyEl ? Math.round(bodyEl.getBoundingClientRect().height) : -1,
				snipH: snip ? Math.round(snip.getBoundingClientRect().height) : -1,
				cls: t.className,
			};
		});
		const sentinelEl = document.querySelector('.cardbox-sentinel');
		const sentinelRect = sentinelEl ? { x: Math.round(sentinelEl.getBoundingClientRect().left), y: Math.round(sentinelEl.getBoundingClientRect().top), w: Math.round(sentinelEl.getBoundingClientRect().width), h: Math.round(sentinelEl.getBoundingClientRect().height) } : null;
		const list = document.querySelector('.cardbox-list');
		const gridCS = list ? getComputedStyle(list) : null;
		const gridInfo = gridCS ? { cols: gridCS.gridTemplateColumns, rows: gridCS.gridTemplateRows, autoRows: gridCS.gridAutoRows, autoFlow: gridCS.gridAutoFlow, align: gridCS.alignContent, height: gridCS.height, display: gridCS.display } : null;
		// 瀑布流列数 = 实际渲染出的列容器个数（不再看 grid-template-columns，
		// 布局已从 grid 改为 flex 列组 + JS 分配）
		const gridCols = document.querySelectorAll('.cardbox-masonry-group:first-of-type .cardbox-masonry-col').length;

		// 瀑布流质量断言：同一列内相邻卡片的竖向间隙应恒定，且不应出现大片空白
		const colGaps = [...document.querySelectorAll('.cardbox-masonry-col')].map((col) => {
			const tiles = [...col.children];
			const gaps = [];
			for (let i = 1; i < tiles.length; i++) {
				const prev = tiles[i - 1].getBoundingClientRect();
				const cur = tiles[i].getBoundingClientRect();
				gaps.push(Math.round(cur.top - prev.bottom));
			}
			return gaps;
		});
		const allGaps = colGaps.flat();
		const gapStats = {
			count: allGaps.length,
			min: allGaps.length ? Math.min(...allGaps) : null,
			max: allGaps.length ? Math.max(...allGaps) : null,
			distinct: [...new Set(allGaps)],
		};

		const isMobileHeader = !!document.querySelector('.cardbox-mobile-header');
		const isBoxBar = !!document.querySelector('.cardbox-boxbar');
		const modeText = mobileModeBtn ? mobileModeBtn.textContent : 'N/A';

		// 关键断言：两个图标应在 view header 里（与标题同行），不在视图内容区内
		const headerActions = [...document.querySelectorAll('.view-header-nav-buttons .view-action')].map(
			(b) => b.getAttribute('aria-label'),
		);
		const actionsInContent = !!view.contentEl.querySelector('.cardbox-mode-action, .cardbox-filter-action');
		const infoEl = document.querySelector('.cardbox-mobile-info');
		const infoHeight = infoEl ? Math.round(infoEl.getBoundingClientRect().height) : -1;
		const infoText = infoEl ? infoEl.textContent : null;
		return {
			indexReady: plugin.index ? plugin.index.ready : null,
			indexCount: plugin.index ? plugin.index.all().length : null,
			tileCount: tiles.length,
			gridCols,
			gapStats,
			headerActions,
			actionsInContent,
			infoHeight,
			infoText,
			firstFew,
			computed0: (() => { const t = document.querySelector(".cardbox-tile"); if (!t) return null; const cs = getComputedStyle(t); return { maxHeight: cs.maxHeight, overflow: cs.overflow, display: cs.display, flexDirection: cs.flexDirection, height: cs.height }; })(),
			sentinelRect,
			gridInfo,
			isMobileHeader,
			isBoxBar,
			modeText,
			overlaps: overlaps.slice(0, 8),
			overlapCount: overlaps.length,
			heights: rects.slice(0, 12).map((r) => r.h),
			listRect: list ? { w: Math.round(list.getBoundingClientRect().width) } : null,
		};
	},
	{ code: mainJs, manifest, expMode },
);

console.log(JSON.stringify(result, null, 2));
if (pageErrors.length) console.log('\npageErrors:', pageErrors);
await page.screenshot({ path: 'shot-mobile-full.png' });
await browser.close();
process.exit(result.overlapCount > 0 || pageErrors.length ? 1 : 0);
