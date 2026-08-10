/**
 * 端到端验证：标题作文件名 + 重命名后关联不断链。
 *
 * 用真实浏览器 DOM 加载打包后的 main.js，注入模拟 Obsidian 环境，
 * 重点验证三件事：
 *   1. 新建卡片用标题作文件名（不再写 frontmatter id）
 *   2. renameByTitle 走 fileManager.renameFile（而非 vault.rename）
 *   3. 索引以文件名为 id，并对老卡片的 frontmatter id 做别名兜底
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const mainJs = await readFile('main.js', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.setContent('<!DOCTYPE html><html><body><div id="host"></div></body></html>');

const result = await page.evaluate(async (code) => {
	const log = [];
	const t = (name, cond, got) => log.push({ name, ok: !!cond, got });

	// ---- Obsidian DOM 原型扩展 ----
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
	const createEl2 = (tag, o) => applyOpts(document.createElement(tag), o);
	Element.prototype.createEl = function (tag, o) { const e = createEl2(tag, o); this.appendChild(e); return e; };
	Element.prototype.createDiv = function (o) { return this.createEl('div', o); };
	Element.prototype.createSpan = function (o) { return this.createEl('span', o); };
	Element.prototype.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	Element.prototype.addClass = function (...c) { this.classList.add(...c.filter(Boolean)); };
	Element.prototype.removeClass = function (...c) { this.classList.remove(...c.filter(Boolean)); };
	Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
	Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
	Element.prototype.setText = function (x) { this.textContent = x; };
	Element.prototype.detach = function () { this.remove(); };
	window.createEl = createEl2;
	window.createDiv = (o) => createEl2('div', o);
	window.createSpan = (o) => createEl2('span', o);

	// ---- 模拟 Vault ----
	class TFile {
		constructor(path, content) {
			this.path = path;
			this.extension = path.split('.').pop();
			const name = path.split('/').pop();
			this.name = name;
			this.basename = name.replace(/\.md$/, '');
			this.stat = { ctime: 1000, mtime: 1000 };
			this.content = content;
			this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
		}
	}

	const files = new Map();
	const addFile = (path, content) => { const f = new TFile(path, content); files.set(path, f); return f; };

	// 旧格式卡片：frontmatter id 与文件名不一致（模拟历史数据）
	addFile('Cards/2026-08-09-120000-ab1.md',
		'---\nid: "legacy-old-id"\ntitle: "历史卡片"\ncreated: 1000\nupdated: 1000\n---\n\n历史正文\n');
	// 主卡：children 里写的是历史卡片的旧 id
	addFile('Cards/主卡片.md',
		'---\ntitle: "主卡片"\ncreated: 2000\nupdated: 2000\nchildren:\n  - "[[legacy-old-id]]"\n---\n\n主卡正文\n');
	// 待重命名卡片：文件名是时间戳，标题是可读中文
	addFile('Cards/2026-08-10-160000-c3d.md',
		'---\ntitle: "卡片写作法：核心框架"\ncreated: 3000\nupdated: 3000\n---\n\n正文内容\n');

	const renameCalls = [];
	const vaultRenameCalls = [];

	const metaCache = {
		on: () => ({}),
		offref: () => {},
		getFileCache: () => ({ links: [] }),
		getFirstLinkpathDest: (link) => {
			for (const f of files.values()) if (f.basename === link) return f;
			return null;
		},
		resolvedLinks: {},
	};

	const app = {
		vault: {
			on: () => ({}),
			offref: () => {},
			getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === 'md'),
			getAbstractFileByPath: (p) => files.get(p) ?? null,
			cachedRead: async (f) => f.content,
			read: async (f) => f.content,
			create: async (p, c) => addFile(p, c),
			modify: async (f, c) => { f.content = c; },
			createFolder: async () => {},
			trash: async () => {},
			rename: async (f, p) => { vaultRenameCalls.push([f.path, p]); },
		},
		fileManager: {
			// 关键：真实Obsidian 只有这个API 会自动更新全库[[链接]]
			renameFile: async (f, target) => {
				renameCalls.push([f.path, target]);
				files.delete(f.path);
				const nf = addFile(target, f.content);
				// 模拟 Obsidian 改写引用：把旧 basename 的链接改成新 basename
				for (const other of files.values()) {
					if (other === nf) continue;
					other.content = other.content.split(`[[${f.basename}]]`).join(`[[${nf.basename}]]`);
				}
			},
			processFrontMatter: async (f, fn) => {
				const m = /^---\n([\s\S]*?)\n---\n?/.exec(f.content);
				const fm = {};
				if (m) {
					for (const line of m[1].split('\n')) {
						const kv = /^(\w+):\s*(.*)$/.exec(line);
						if (kv) fm[kv[1]] = kv[2].replace(/^"|"$/g, '');
					}
				}
				fn(fm);
				const body = m ? f.content.slice(m[0].length) : f.content;
				const yaml = Object.entries(fm)
					.map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - "${x}"`).join('\n')}` : `${k}: ${v}`))
					.join('\n');
				f.content = `---\n${yaml}\n---\n${body}`;
			},
		},
		workspace: {
			on: () => ({}),
			offref: () => {},
			onLayoutReady: (cb) => cb(),
			getLeavesOfType: () => [],
			getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
			getActiveFile: () => null,
			revealLeaf: () => {},
			getActiveViewOfType: () => null,
		},
		metadataCache: metaCache,
		keymap: {},
		scope: {},
	};

	// ---- 伪造 obsidian 模块 ----
	const notices = [];
	const obsidian = {
		Plugin: class {
			constructor(a, m) { this.app = a; this.manifest = m; }
			addRibbonIcon() { return document.createElement('div'); }
			addCommand() {}
			addSettingTab() {}
			registerView() {}
			registerEvent() {}
			register() {}
			async loadData() { return null; }
			async saveData() {}
		},
		ItemView: class { constructor(l) { this.leaf = l; this.contentEl = document.createElement('div'); } },
		Modal: class { constructor(a) { this.app = a; this.contentEl = document.createElement('div'); } open() {} close() {} },
		PluginSettingTab: class {
			constructor(a, p) {
				if (!p || !p.manifest || typeof p.manifest.id !== 'string') throw new Error('需要真实 Plugin 实例');
				this.app = a; this.plugin = p; this.containerEl = document.createElement('div');
			}
		},
		Setting: class {
			constructor(el) { this.el = el; }
			setName() { return this; } setDesc() { return this; }
			addText(cb) { cb({ setPlaceholder: () =>({ setValue: () => ({ onChange: () => {} }) }), setValue: () => ({ onChange: () => {} }), inputEl: document.createElement('input'), getValue: () => '' }); return this; }
			addDropdown(cb) { cb({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
			addToggle(cb) { cb({ setValue: () => ({ onChange: () => {} }) }); return this; }
			addButton(cb) { cb({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; }, setDisabled() { return this; } }); return this; }
			setHeading() { return this; }
		},
		Notice: class { constructor(m) { notices.push(String(m)); } },
		Menu: class { addItem() { return this; } addSeparator() { return this; } showAtPosition() {} },
		TFile,
		TFolder: class {},
		ButtonComponent: class { constructor() {} setButtonText() { return this; } onClick() { return this; } setDisabled() { return this; } setCta() { return this; } },
		parseYaml: (s) => {
			const out = {};
			let curKey = null;
			for (const line of s.split('\n')) {
				const item = /^\s+-\s*(.*)$/.exec(line);
				if (item && curKey) {
					out[curKey] = out[curKey] || [];
					out[curKey].push(item[1].replace(/^"|"$/g, ''));
					continue;
				}
				const kv = /^(\w+):\s*(.*)$/.exec(line);
				if (kv) {
					curKey = kv[1];
					const v = kv[2].trim();
					if (v === '') out[kv[1]] = [];
					else out[kv[1]] = /^\d+$/.test(v) ? Number(v) : v.replace(/^"|"$/g, '');
				}
			}
			return out;
		},
		stringifyYaml: (o) =>
			Object.entries(o)
				.map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - "${x}"`).join('\n')}` : `${k}: ${JSON.stringify(v)}`))
				.join('\n') + '\n',
		setIcon: () => {},
		debounce: (fn) => fn,
		Platform: { isMobile: false },
		normalizePath: (p) => p,
		MarkdownRenderer: { render: async () => {} },
	};

	// ---- 加载插件 ----
	const module = { exports: {} };
	const req = (n) => { if (n === 'obsidian') return obsidian; throw new Error('unknown module ' + n); };
	new Function('module', 'exports', 'require', code)(module, module.exports, req);
	const PluginClass = module.exports.default?? module.exports;

	const plugin = new PluginClass(app, { id: 'cardbox', name: 'CardBox', version: '0.4.0' });
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 80));

	t('插件加载无异常', true);
	t('索引已就绪', plugin.index.ready);

	// ---- 1. 索引以文件名为 id ----
	const legacy = plugin.index.byPath('Cards/2026-08-09-120000-ab1.md');
	t('id 取文件名而非 frontmatter id', legacy && legacy.id === '2026-08-09-120000-ab1', legacy && legacy.id);
	t('旧 frontmatter id 记为 legacyId', legacy && legacy.legacyId === 'legacy-old-id', legacy && legacy.legacyId);

	// ---- 2. 别名兜底：主卡的 children 写的是旧 id，仍能查到 ----
	const byLegacy = plugin.index.getById('legacy-old-id');
	t('用旧 id 仍能查到卡片（别名兜底）', byLegacy && byLegacy.path === 'Cards/2026-08-09-120000-ab1.md');
	const mainCard = plugin.index.byPath('Cards/主卡片.md');
	const exts = plugin.index.extensionsOf(mainCard);
	t('历史关联未断链', exts.length === 1 && exts[0].card.id === '2026-08-09-120000-ab1', exts.map((e) => e.card.id));

	// ---- 3. 新建卡片用标题作文件名 ----
	const created = await plugin.service.createCard({ body: '新卡片正文', title: '我的新卡片' });
	t('新建卡片文件名 = 标题', created && created.path === 'Cards/我的新卡片.md', created && created.path);
	t('新建卡片不写 frontmatter id', created && !/^id:/m.test(created.content), created && created.content.slice(0, 90));

	// 无标题时取正文首行
	const created2 = await plugin.service.createCard({ body: '## 从正文首行来的标题\n更多内容' });
	t('无标题取正文首行作文件名', created2 && created2.path === 'Cards/从正文首行来的标题.md', created2 && created2.path);

	// 标题含非法字符
	const created3 = await plugin.service.createCard({ body: '正文', title: '读书/笔记:上篇' });
	t('非法字符已清理', created3 && created3.path === 'Cards/读书笔记上篇.md', created3 && created3.path);

	// 同名冲突加后缀
	const created4 = await plugin.service.createCard({ body: '另一张', title: '我的新卡片' });
	t('同名冲突追加 -2', created4 && created4.path === 'Cards/我的新卡片-2.md', created4 && created4.path);

	// ---- 4. renameByTitle 走 fileManager.renameFile ----
	await plugin.index.build();
	const toRename = plugin.index.byPath('Cards/2026-08-10-160000-c3d.md');
	t('待重命名卡片存在', !!toRename);
	const res = await plugin.service.renameByTitle(toRename);
	t('重命名成功', res.ok, res);
	t('新文件名来自标题（全角冒号保留）', res.to === '卡片写作法：核心框架', res.to);
	t('调用了 fileManager.renameFile', renameCalls.length === 1, renameCalls);
	t('未调用 vault.rename（会断链）', vaultRenameCalls.length === 0, vaultRenameCalls);
	t('目标路径正确', renameCalls[0] && renameCalls[0][1] === 'Cards/卡片写作法：核心框架.md', renameCalls[0]);

	// 已是标题时不重复重命名
	await plugin.index.build();
	const already = plugin.index.byPath('Cards/卡片写作法：核心框架.md');
	const res2 = await plugin.service.renameByTitle(already);
	t('已是标题则跳过', !res2.ok && res2.reason === 'same', res2);

	// 无标题无正文
	const emptyFile = addFile('Cards/空卡片.md', '---\ncreated: 5000\nupdated: 5000\n---\n\n\n');
	await plugin.index.build();
	const emptyCard = plugin.index.byPath('Cards/空卡片.md');
	const res3 = await plugin.service.renameByTitle(emptyCard);
	t('无标题无正文时拒绝重命名', !res3.ok && res3.reason === 'empty', res3);

	// ---- 5. 重命名后链接跟随（由 Obsidian 负责，这里验证模拟链路）----
	{
		const target = addFile('Cards/被引用卡.md', '---\ntitle: "改名后的标题"\ncreated: 6000\nupdated: 6000\n---\n\n内容\n');
		addFile('Cards/引用方.md', '---\ncreated: 7000\nupdated: 7000\nchildren:\n  - "[[被引用卡]]"\n---\n\n见 [[被引用卡]]\n');
		await plugin.index.build();
		const tc = plugin.index.byPath('Cards/被引用卡.md');
		await plugin.service.renameByTitle(tc);
		const referrer = files.get('Cards/引用方.md');
		t('重命名后引用方链接已更新', referrer.content.includes('[[改名后的标题]]'), referrer.content);
		t('旧链接已不存在', !referrer.content.includes('[[被引用卡]]'));
		await plugin.index.build();
		const ref = plugin.index.byPath('Cards/引用方.md');
		const refExts = plugin.index.extensionsOf(ref);
		t('重命名后关联仍然有效', refExts.length === 1 && refExts[0].card.id === '改名后的标题', refExts.map((e) => e.card.id));
	}

	// ---- 6. 图遍历数据源可用 ----
	{
		const gs = plugin.index.graphSource();
		t('graphSource 提供三个方法',
			typeof gs.getById === 'function' && typeof gs.outgoingIds === 'function' && typeof gs.incomingIds === 'function');
		const mc = plugin.index.byPath('Cards/主卡片.md');
		t('outgoingIds 返回关联 id', gs.outgoingIds(mc).length === 1, gs.outgoingIds(mc));
		const child = plugin.index.byPath('Cards/2026-08-09-120000-ab1.md');
		t('incomingIds 能反查引用者', gs.incomingIds(child).includes('主卡片'), gs.incomingIds(child));
	}

	// ---- 7. extensionCount 供展开按钮显示 ----
	{
		const mc = plugin.index.byPath('Cards/主卡片.md');
		t('extensionCount 返回关联数量', plugin.index.extensionCount(mc) === 1, plugin.index.extensionCount(mc));
	}

	return { log, notices, renameCalls, vaultRenameCalls };
}, mainJs);

let pass = 0;
let fail = 0;
for (const item of result.log) {
	if (item.ok) pass++;
	else {
		fail++;
		console.log('FAIL:', item.name, item.got !== undefined ? `→ ${JSON.stringify(item.got)}` : '');
	}
}
if (pageErrors.length) {
	console.log('\n未捕获异常:');
	for (const e of pageErrors) console.log('  ' + e);
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || pageErrors.length ? 1 : 0);
