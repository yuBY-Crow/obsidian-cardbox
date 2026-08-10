/**
 * 标题作文件名相关逻辑测试。
 * 覆盖：非法字符清理、wikilink 语法字符、正文首行回退、Markdown 标记剥离、
 * 长度截断、Windows 尾部限制、空值回落。
 */
import esbuild from 'esbuild';

const stub = `export const i18n = { today:'今天', yesterday:'昨天' };`;
const r = await esbuild.build({
	entryPoints: ['src/utils/format.ts'],
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node',
	plugins: [
		{
			name: 'stub-i18n',
			setup(b) {
				b.onResolve({ filter: /i18n$/ }, () => ({ path: 'i18n', namespace: 'stub' }));
				b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
			},
		},
	],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const { sanitizeFileName, deriveFileBase, generateId } = mod;

let pass = 0;
let fail = 0;
const t = (name, cond, got) => {
	if (cond) pass++;
	else {
		fail++;
		console.log('FAIL:', name, got !== undefined ? `→ got ${JSON.stringify(got)}` : '');
	}
};

// ---- sanitizeFileName：Windows 非法字符 ----
t('去掉斜杠与冒号', sanitizeFileName('读书/笔记:上篇') === '读书笔记上篇', sanitizeFileName('读书/笔记:上篇'));
t('去掉问号星号引号', sanitizeFileName('为什么?*"重要"') === '为什么重要', sanitizeFileName('为什么?*"重要"'));
t('去掉尖括号竖线', sanitizeFileName('a<b>c|d') === 'abcd', sanitizeFileName('a<b>c|d'));
t('去掉反斜杠', sanitizeFileName('path\\to') === 'pathto', sanitizeFileName('path\\to'));

// ---- 关键：wikilink 语法字符必须清理 ----
// 若标题含 # ，文件名出现在 [[...]] 里会被当成指向标题的锚点，链接直接失效
t('去掉井号（否则被当锚点）', sanitizeFileName('话题#标签') === '话题标签', sanitizeFileName('话题#标签'));
t('去掉方括号（否则破坏 wikilink）', sanitizeFileName('[重要]笔记') === '重要笔记', sanitizeFileName('[重要]笔记'));
t('去掉插入符（块引用语法）', sanitizeFileName('块^ref') === '块ref', sanitizeFileName('块^ref'));

// ---- 空白与尾部 ----
t('合并连续空格为单个', sanitizeFileName('多个   空格') === '多个 空格', sanitizeFileName('多个   空格'));
t('去首尾空格', sanitizeFileName('  两边  ') === '两边', sanitizeFileName('  两边  '));
t('Windows 不允许尾部点', sanitizeFileName('结尾有点...') === '结尾有点', sanitizeFileName('结尾有点...'));
t('清理后为空返回空串', sanitizeFileName('///:::') === '', sanitizeFileName('///:::'));
t('纯空白返回空串', sanitizeFileName('   ') === '');

// ---- 长度截断 ----
{
	const long = 'あ'.repeat(200);
	const out = sanitizeFileName(long);
	t('截断到 80 字符', out.length === 80, out.length);
}

// ---- deriveFileBase：标题优先 ----
t('有标题用标题', deriveFileBase('卡片写作法', '正文内容') === '卡片写作法');
t('标题含非法字符仍可用', deriveFileBase('读书/笔记', '正文') === '读书笔记');
t('标题清理后为空则回退正文', deriveFileBase(':::', '正文首行') === '正文首行', deriveFileBase(':::', '正文首行'));

// ---- deriveFileBase：正文首行回退 ----
t('无标题取正文首行', deriveFileBase(undefined, '这是首行\n第二行') === '这是首行');
t('跳过开头空行', deriveFileBase(undefined, '\n\n  真正首行  \n后面') === '真正首行');
t('剥离 Markdown 标题符号', deriveFileBase(undefined, '## 二级标题\n正文') === '二级标题');
t('剥离六级标题', deriveFileBase(undefined, '###### 六级\n') === '六级');
t('剥离无序列表符号', deriveFileBase(undefined, '- 列表项\n') === '列表项');
t('剥离星号列表', deriveFileBase(undefined, '* 星号项') === '星号项');
t('剥离加号列表', deriveFileBase(undefined, '+ 加号项') === '加号项');
t('剥离任务框', deriveFileBase(undefined, '- [ ] 待办事项') === '待办事项', deriveFileBase(undefined, '- [ ] 待办事项'));
t('剥离已完成任务框', deriveFileBase(undefined, '- [x] 已完成') === '已完成', deriveFileBase(undefined, '- [x] 已完成'));
t('剥离引用符号', deriveFileBase(undefined, '> 引用内容') === '引用内容');

// ---- deriveFileBase：全空 ----
t('标题与正文都空返回空串', deriveFileBase(undefined, '') === '');
t('正文只有空白返回空串', deriveFileBase('', '   \n  \n') === '');
t('正文首行清理后为空返回空串', deriveFileBase(undefined, '///:::\n第二行') === '', deriveFileBase(undefined, '///:::\n第二行'));

// ---- generateId 作为回落方案 ----
{
	const id = generateId(new Date(2026, 7, 10, 16, 5, 9).getTime());
	t('回落 id 格式正确', /^2026-08-10-160509-[0-9a-f]{3}$/.test(id), id);
	t('回落 id 本身是合法文件名', sanitizeFileName(id) === id);
}

// ---- 真实标题样例（端到端形态）----
{
	const cases = [
		// 全角冒号是合法文件名字符，只有半角 : 才需要清理
		['卡片笔记写作法：核心框架', '卡片笔记写作法：核心框架'],
		['卡片笔记写作法: 核心框架', '卡片笔记写作法 核心框架'],
		['如何做「知识管理」?', '如何做「知识管理」'],
		['Zettelkasten vs. PARA', 'Zettelkasten vs. PARA'],
		['2026/08/10 复盘', '20260810 复盘'],
	];
	for (const [input, expect] of cases) {
		const got = deriveFileBase(input, '');
		t(`真实标题「${input}」`, got === expect, got);
	}
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
