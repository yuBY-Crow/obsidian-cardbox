import esbuild from 'esbuild';

const r = await esbuild.build({
	entryPoints: ['src/utils/link.ts'],
	bundle: true, write: false, format: 'esm', platform: 'node', external: ['obsidian'],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const { parseLinkTarget, parseLinkList, toLinkList, toWikilink } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (ok) pass++;
	else { fail++; console.log(`FAIL${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const ID = '2026-08-09-123500-cd2';

// 单条解析
eq('标准 wikilink', parseLinkTarget(`[[${ID}]]`), ID);
eq('旧格式纯 id（向后兼容）', parseLinkTarget(ID), ID);
eq('带别名', parseLinkTarget(`[[${ID}|我的卡片]]`), ID);
eq('带锚点', parseLinkTarget(`[[${ID}#某标题]]`), ID);
eq('别名+锚点', parseLinkTarget(`[[${ID}#标题|别名]]`), ID);
eq('带路径', parseLinkTarget(`[[Cards/${ID}]]`), ID);
eq('带多级路径', parseLinkTarget(`[[a/b/Cards/${ID}]]`), ID);
eq('带 .md 扩展名', parseLinkTarget(`[[${ID}.md]]`), ID);
eq('路径+扩展名+别名', parseLinkTarget(`[[Cards/${ID}.md|X]]`), ID);
eq('首尾空格', parseLinkTarget(`  [[ ${ID} ]]  `), ID);
eq('中文 id', parseLinkTarget('[[读书笔记/卢曼卡片法]]'), '卢曼卡片法');

// 非法输入
eq('空字符串', parseLinkTarget(''), '');
eq('null', parseLinkTarget(null), '');
eq('数字', parseLinkTarget(123), '');
eq('undefined', parseLinkTarget(undefined), '');
eq('只有括号', parseLinkTarget('[[]]'), '');
eq('对象', parseLinkTarget({}), '');

// 列表解析
eq('混合格式列表', parseLinkList([`[[${ID}]]`, 'plain-id', `[[Cards/x.md]]`]), [ID, 'plain-id', 'x']);
eq('列表去重', parseLinkList([`[[${ID}]]`, ID, `[[${ID}|别名]]`]), [ID]);
eq('单字符串当列表', parseLinkList(`[[${ID}]]`), [ID]);
eq('非数组非字符串', parseLinkList(null), []);
eq('过滤非法项', parseLinkList([`[[${ID}]]`, '', null, '[[]]']), [ID]);

// 生成
eq('生成 wikilink 列表', toLinkList([ID, 'x']), [`[[${ID}]]`, '[[x]]']);
eq('生成时去重', toLinkList([ID, `[[${ID}]]`]), [`[[${ID}]]`]);
eq('生成时剥离路径', toLinkList([`[[Cards/${ID}.md]]`]), [`[[${ID}]]`]);
eq('toWikilink', toWikilink(ID), `[[${ID}]]`);

// 往返一致性：解析(生成(x)) === x
const ids = [ID, 'abc', '中文卡片'];
eq('往返一致', parseLinkList(toLinkList(ids)), ids);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
