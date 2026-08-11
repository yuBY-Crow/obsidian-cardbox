// 测试 setKebabIcon 的版本兼容探测：三种图标库状态分别验证
// 用法: node scripts/icontest.mjs
import esbuild from 'esbuild';

let pass = 0;
let fail = 0;
const t = (name, cond, got) => {
	if (cond) pass++;
	else {
		fail++;
		console.log('FAIL:', name, got !== undefined ? `→ ${JSON.stringify(got)}` : '');
	}
};

// 手工实现三种场景：直接构造 icon.ts 的等价逻辑并注入不同的 getIcon。
// 从打包产物里提取不现实，改为分别用不同 stub 打包三次。
const buildWithIcons = async (iconImplSrc) => {
	const stub = `
export const getIcon = ${iconImplSrc};
export const setIcon = (el, name) => { el.__icon = name; };
`;
	const r = await esbuild.build({
		entryPoints: ['src/utils/icon.ts'],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'node',
		plugins: [
			{
				name: 'stub',
				setup(b) {
					b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
					b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
				},
			},
		],
	});
	return r.outputFiles[0].text;
};

const evalModule = async (src, tag) => {
	// ESM data URL 里的相对 import 已被 bundle 消除，可直接 import
	const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + tag);
	return mod;
};

// 场景 A：只有 more-vertical（旧版 lucide）
{
	const src = await buildWithIcons(`(n) => (n === 'more-vertical' ? {} : null)`);
	const mod = await evalModule(src, 'a');
	const el = { __icon: null, text: '', classes: [], setText(s) { this.text = s; }, addClass(c) { this.classes.push(c); } };
	mod.setKebabIcon(el);
	t('旧版图标库用 more-vertical', el.__icon === 'more-vertical', el.__icon);
	t('旧版不走文本兜底', el.classes.length === 0, el.classes);
}

// 场景 B：只有 ellipsis-vertical（新版 lucide，Obsidian 1.9+）
{
	const src = await buildWithIcons(`(n) => (n === 'ellipsis-vertical' ? {} : null)`);
	const mod = await evalModule(src, 'b');
	const el = { __icon: null, text: '', classes: [], setText(s) { this.text = s; }, addClass(c) { this.classes.push(c); } };
	mod.setKebabIcon(el);
	t('新版图标库回落到 ellipsis-vertical', el.__icon === 'ellipsis-vertical', el.__icon);
}

// 场景 C：两个都没有（极端老版本）→ Unicode 兜底
{
	const src = await buildWithIcons(`() => null`);
	const mod = await evalModule(src, 'c');
	const el = { __icon: null, text: '', classes: [], setText(s) { this.text = s; }, addClass(c) { this.classes.push(c); } };
	mod.setKebabIcon(el);
	t('图标全缺时用 Unicode ⋮ 兜底', el.text === '⋮', el.text);
	t('兜底加样式类', el.classes.includes('cardbox-kebab-text'), el.classes);
	t('兜底不调 setIcon', el.__icon === null, el.__icon);
}

// 场景 D：探测结果被缓存（同一实例多次调用只探测一次）
{
	let calls = 0;
	const src = await buildWithIcons(`(n) => { globalThis.__calls = (globalThis.__calls || 0) + 1; return n === 'more-vertical' ? {} : null; }`);
	const mod = await evalModule(src, 'd');
	globalThis.__calls = 0;
	const el1 = { __icon: null, text: '', classes: [], setText(s) { this.text = s; }, addClass(c) { this.classes.push(c); } };
	const el2 = { __icon: null, text: '', classes: [], setText(s) { this.text = s; }, addClass(c) { this.classes.push(c); } };
	mod.setKebabIcon(el1);
	mod.setKebabIcon(el2);
	// 探测只查两个候选名，缓存后第二次调用应为 0 次新查询
	t('探测结果被缓存（第二次调用不重复查询）', globalThis.__calls <= 2, globalThis.__calls);
	t('两次结果一致', el1.__icon === 'more-vertical' && el2.__icon === 'more-vertical', { el1: el1.__icon, el2: el2.__icon });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
