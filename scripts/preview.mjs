// 用真实 styles.css + 真实 DOM 结构生成静态预览页，验证平铺 / 扩展视图 / 移动端视觉
// 用法: node scripts/preview.mjs
import { readFile, writeFile } from 'node:fs/promises';

const css = await readFile('styles.css', 'utf8');

const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', null, null, null];
const titles = [
	'卡片盒的本质是「先有标签，后有卡片盒」',
	'今天读到一篇关于知识管理系统的好文章',
	'「真正重要的不是卡片数量，而是卡片之间的连接。」',
	'整理这周的卡片，写周报',
	'Obsidian 自包含插件对移动端最友好',
	'把每个想法都记下来，卡片会自己长成文章',
	'卢曼用这套方法一生出版了 58 本著作',
	'非线性创作：写作成为已有思考的拼接与延伸',
	'闪念笔记需要在 48 小时内加工处理',
	'一张卡片可以同时出现在多个卡片盒里',
	'多标签让知识碎片被反复利用',
	'拖拽调整扩展卡片顺序，一键生成层级文章',
];
const snippets = [
	'传统文件存储用唯一标签决定文档归属；卡片盒则是抓取指定标签或属性的卡片到一个盒子里，卡片被分类的线索不只一个。',
	'核心观点：输入 → 整理 → 输出 的闭环要足够轻，否则收集本身就会变成负担。',
	'知识的价值在连接中产生，孤立的卡片只是信息，连接起来才是洞见。',
	'本周待办清单，完成后归档到月度回顾卡片盒。',
	'不依赖 Dataview，索引与渲染全部走官方 API，手机端也能流畅处理上千张卡片。',
];
const tagSets = [['读书/笔记'], ['写作/卡片', '灵感'], ['工作/会议'], ['思考/哲学'], [], ['工具/obsidian']];
const times = ['今天 14:32', '今天 09:15', '昨天 21:40', '8月8日', '8月5日', '7月28日'];

function tile(i, rich) {
	const color = colors[i % colors.length];
	const pinned = i === 0 || i === 5;
	const title = titles[i % titles.length];
	const snippet = snippets[i % snippets.length];
	const tags = tagSets[i % tagSets.length];
	const childCount = i % 5 === 0 ? (i % 3) + 1 : 0;
	const cls = [
		'cardbox-tile',
		rich ? 'is-rich' : '',
		color ? 'has-color cardbox-color-' + color : '',
		pinned ? 'is-pinned' : '',
	]
		.filter(Boolean)
		.join(' ');
	const bar = color ? '<div class="cardbox-tile-colorbar"></div>' : '';
	const pin = pinned ? '<span class="cardbox-tile-icon is-pin">📌</span>' : '';
	const snip = rich ? '<div class="cardbox-tile-snippet">' + snippet + '</div>' : '';
	const chips = tags.map((t) => '<span class="cardbox-chip cardbox-chip-sm">#' + t + '</span>').join('');
	const badge = childCount ? '<span class="cardbox-child-badge">' + childCount + '</span>' : '';
	return [
		'<div class="' + cls + '">',
		bar,
		'<div class="cardbox-tile-main">',
		'<div class="cardbox-check"></div>',
		'<div class="cardbox-tile-body">',
		'<div class="cardbox-tile-text">',
		'<span class="cardbox-tile-title">' + title + '</span>',
		'<span class="cardbox-tile-icons">' + pin + '</span>',
		'</div>',
		snip,
		'<div class="cardbox-tile-meta">',
		chips,
		'<span class="cardbox-tile-time">' + times[i % times.length] + '</span>',
		badge,
		'</div></div>',
		'<button class="cardbox-more-btn">⋯</button>',
		'</div></div>',
	].join('');
}

function boxtab(name, count, active) {
	return (
		'<div class="cardbox-boxtab' +
		(active ? ' is-active' : '') +
		'"><span class="cardbox-boxtab-name">' +
		name +
		'</span><span class="cardbox-boxtab-count">' +
		count +
		'</span></div>'
	);
}

const boxbar =
	'<div class="cardbox-boxbar"><div class="cardbox-boxbar-scroll">' +
	boxtab('全部卡片', 424, true) +
	boxtab('本周灵感', 37) +
	boxtab('读书笔记', 68) +
	boxtab('红色标记', 15) +
	boxtab('2026年2月', 42) +
	'</div><button class="cardbox-boxbar-add">＋</button></div>';

const colorDots = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']
	.map((c, i) => '<div class="cardbox-color-dot cardbox-color-' + c + (i === 0 ? ' is-selected' : '') + '"></div>')
	.join('');

const filterbar = [
	'<div class="cardbox-filterbar">',
	'<div class="cardbox-mode-toggle">',
	'<button class="cardbox-mode-btn">列表</button>',
	'<button class="cardbox-mode-btn is-active">平铺</button>',
	'<button class="cardbox-mode-btn">时间线</button>',
	'</div>',
	'<div class="cardbox-search-row"><input class="cardbox-search-input" placeholder="搜索卡片…"><button class="cardbox-search-clear">×</button></div>',
	'<div class="cardbox-chips-scroll"><div class="cardbox-chips">',
	'<span class="cardbox-chip is-active">#读书/笔记 68</span>',
	'<span class="cardbox-chip">#写作/卡片 54</span>',
	'<span class="cardbox-chip">#灵感 41</span>',
	'<span class="cardbox-chip">#工作/会议 33</span>',
	'<span class="cardbox-chip cardbox-chip-add">＋标签</span>',
	'</div></div>',
	'<div class="cardbox-color-row cardbox-color-filter">' + colorDots + '</div>',
	'<div class="cardbox-toggles">',
	'<button class="cardbox-pill">有标签</button><button class="cardbox-pill">无标签</button>',
	'<button class="cardbox-pill">空内容</button><button class="cardbox-pill">含任务</button>',
	'<button class="cardbox-pill is-active">仅置顶</button><button class="cardbox-pill">含归档</button>',
	'</div></div>',
].join('');

function panel(opts) {
	const cls = [
		'cardbox-extend-panel',
		opts.root ? 'is-root' : '',
		opts.color ? 'has-color cardbox-color-' + opts.color : '',
	]
		.filter(Boolean)
		.join(' ');
	const meta = (opts.meta ?? []).join('');
	const body = opts.body ? '<div class="cardbox-extend-body">' + opts.body + '</div>' : '';
	return [
		'<div class="' + cls + '">',
		'<div class="cardbox-extend-head' + (opts.root ? '' : ' is-draggable') + '">',
		'<button class="cardbox-extend-toggle">' + (opts.open ? '▾' : '▸') + '</button>',
		'<div class="cardbox-extend-titlewrap">',
		'<div class="cardbox-extend-title">' + opts.title + '</div>',
		'<div class="cardbox-extend-meta">' + meta + '</div>',
		'</div>',
		'<button class="cardbox-more-btn">⋯</button>',
		'</div>',
		body,
		'</div>',
	].join('');
}

const chip = (t) => '<span class="cardbox-chip cardbox-chip-sm">#' + t + '</span>';
const time = (t) => '<span class="cardbox-tile-time">' + t + '</span>';
const badge = (n) => '<span class="cardbox-child-badge">' + n + '</span>';

const extendView = [
	'<div class="cardbox-extend-root" style="height:560px">',
	'<div class="cardbox-extend-bar">',
	'<button class="cardbox-extend-btn">＋ 新建扩展卡片</button>',
	'<button class="cardbox-extend-btn">🔗 关联已有卡片</button>',
	'<button class="cardbox-extend-btn mod-cta">📄 生成文章</button>',
	'<button class="cardbox-extend-btn">▦ 投放到白板</button>',
	'</div>',
	'<div class="cardbox-extend-wrap">',
	'<div class="cardbox-extend-main">',
	'<div class="cardbox-extend-label">主卡片</div>',
	panel({
		root: true,
		open: true,
		color: 'blue',
		title: '卡片写作法：从碎片到文章的完整链路',
		meta: [chip('写作/卡片'), time('今天 10:02'), badge(4)],
		body: '卢曼的卡片写作法核心：灵感是点状发散的，并从积累的碰撞中生长出来。\n\n三步成文：添加卡片 → 拖拽排序 → 生成文章。',
	}),
	'</div>',
	'<div class="cardbox-extend-children">',
	'<div class="cardbox-extend-label">扩展卡片（4）</div>',
	'<div class="cardbox-extend-hint">拖拽卡片标题可调整顺序</div>',
	'<div class="cardbox-extend-list">',
	'<div class="cardbox-extend-branch">',
	panel({
		open: true,
		color: 'red',
		title: '闪念笔记：48 小时内必须加工',
		meta: [chip('灵感'), time('今天 10:05')],
		body: '临时灵感如果不及时加工，就会变成永远不会再看的信息垃圾。',
	}),
	'</div>',
	'<div class="cardbox-extend-branch">',
	panel({ title: '文献笔记：用自己的话提炼核心观点', meta: [time('今天 10:08'), badge(2)] }),
	'<div class="cardbox-extend-sublist"><div class="cardbox-extend-branch">',
	panel({ title: '多层级关联：扩展卡片也能成为主卡', meta: [time('昨天 16:20')] }),
	'</div></div>',
	'</div>',
	'<div class="cardbox-extend-branch">',
	panel({ color: 'green', title: '永久笔记：原子化、可独立存在', meta: [chip('方法论'), time('今天 11:30')] }),
	'</div>',
	'</div></div></div></div>',
].join('');

const phoneExtend = [
	'<div class="cardbox-extend-root" style="height:100%">',
	'<div class="cardbox-extend-bar">',
	'<button class="cardbox-extend-btn">＋ 新建扩展卡片</button>',
	'<button class="cardbox-extend-btn mod-cta">📄 生成文章</button>',
	'</div>',
	'<div class="cardbox-extend-wrap" style="flex-direction:column;overflow-y:auto">',
	'<div class="cardbox-extend-main" style="flex:none">',
	'<div class="cardbox-extend-label">主卡片</div>',
	panel({
		root: true,
		open: true,
		color: 'blue',
		title: '卡片写作法：从碎片到文章',
		meta: [badge(4)],
		body: '灵感是点状发散的，并从积累的碰撞中生长出来。',
	}),
	'</div>',
	'<div class="cardbox-extend-children" style="flex:none">',
	'<div class="cardbox-extend-label">扩展卡片（4）</div>',
	'<div class="cardbox-extend-list">',
	'<div class="cardbox-extend-branch">' + panel({ color: 'red', title: '闪念笔记：48 小时内加工' }) + '</div>',
	'<div class="cardbox-extend-branch">' + panel({ title: '文献笔记：用自己的话提炼' }) + '</div>',
	'</div></div></div></div>',
].join('');

const themeVars = [
	':root{',
	'--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;',
	'--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:#ececec;--background-modifier-active-hover:#e6f0fb;',
	'--text-normal:#222;--text-muted:#6b6b6b;--text-faint:#9a9a9a;--text-on-accent:#fff;',
	'--interactive-accent:#5b6ee1;--radius-s:4px;--radius-m:8px;',
	'--color-red:#e05252;--color-orange:#e0892f;--color-yellow:#d9b42c;--color-green:#3fa653;',
	'--color-blue:#3a7fd5;--color-purple:#8a5cd9;',
	'}',
].join('');

const pageCss = [
	themeVars,
	'body{margin:0;font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#eceff3;color:#222;padding:24px}',
	'h2{font-size:15px;font-weight:500;margin:28px 0 10px}',
	'h2:first-child{margin-top:0}',
	'p.note{font-size:13px;color:#666;margin:0 0 12px;line-height:1.6}',
	'.frame{background:#fff;border:1px solid #dcdcdc;border-radius:10px;overflow:hidden}',
	'.frame.phone{width:390px;height:720px;display:flex;flex-direction:column}',
	'.row{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}',
	css,
].join('\n');

const html = [
	'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
	'<title>CardBox 视觉预览</title><style>' + pageCss + '</style></head><body>',

	'<h2>PC 端 · 瀑布流平铺（所有卡片一屏铺开）</h2>',
	'<p class="note">CSS 多列布局，列宽由设置项「平铺最小列宽」控制；卡片显示更多正文；顶部彩条即「眉头颜色」；置顶卡片带边框高亮与图钉，恒定悬浮在最前。</p>',
	'<div class="frame">',
	boxbar,
	filterbar,
	'<div class="cardbox-list is-masonry" style="--cardbox-col-min:260px;height:620px">',
	Array.from({ length: 14 }, (_, i) => tile(i, true)).join(''),
	'</div></div>',

	'<h2>卡片扩展同屏视图 · 主卡与扩展卡分支展示</h2>',
	'<p class="note">左侧固定主卡片，右侧扩展卡片分支列表；可展开看全文、拖拽排序、解除关联；扩展卡片自身可再带扩展卡片形成多层级；「生成文章」按层级输出带标题的文章。</p>',
	'<div class="frame">' + extendView + '</div>',

	'<h2>手机端 · 单列自适应</h2>',
	'<p class="note">同一套代码，窄屏自动降为单列；扩展视图改为上下堆叠；可点区域放大到 40–44px 触摸友好尺寸。</p>',
	'<div class="row">',
	'<div class="frame phone">',
	boxbar,
	filterbar,
	'<div class="cardbox-list is-masonry" style="--cardbox-col-min:260px;flex:1">',
	Array.from({ length: 8 }, (_, i) => tile(i, true)).join(''),
	'</div></div>',
	'<div class="frame phone">' + phoneExtend + '</div>',
	'</div>',

	'<h2>列表模式（紧凑，适合快速浏览）</h2>',
	'<div class="frame" style="max-width:640px">',
	'<div class="cardbox-list" style="height:340px">',
	Array.from({ length: 7 }, (_, i) => tile(i, false)).join(''),
	'</div></div>',

	'</body></html>',
].join('\n');

await writeFile('preview.html', html);
console.log('preview.html 已生成');
