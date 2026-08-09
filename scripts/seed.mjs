// 生成测试卡片：验证大数据量下的索引与渲染性能
// 用法: node scripts/seed.mjs <vault路径> [数量] [卡片文件夹]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const vaultDir = path.resolve(process.argv[2] ?? 'test-vault');
const count = parseInt(process.argv[3] ?? '1000', 10);
const folder = process.argv[4] ?? 'Cards';

const topics = ['灵感', '待办', '读书笔记', '金句', '方法论', '项目想法', '生活碎片'];
const nestedTags = ['', '读书/笔记', '工作/会议', '写作/卡片', '工具/obsidian', '思考/哲学', '生活/旅行'];
const bodies = [
	'今天读到一篇好文章，关于如何建立知识管理系统。\n\n核心观点：输入 → 整理 → 输出 的闭环要足够轻。',
	'- [ ] 整理这周的卡片\n- [x] 写周报',
	'「卡片盒写作法」的本质是把写作拆解成可复用的小块。',
	'下次见到产品经理，要确认需求优先级。',
	'Obsidian 的自包含插件对移动端最友好：不依赖 Dataview，索引和渲染都走官方 API。',
	'把每个想法都记下来，卡片会自己长成文章。',
	'『真正重要的不是卡片数量，而是卡片之间的连接。』',
];

function pad2(n) {
	return String(n).padStart(2, '0');
}
function dayKey(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function timeKey(ts) {
	const d = new Date(ts);
	return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

await mkdir(path.join(vaultDir, folder), { recursive: true });

const now = Date.now();
let total = 0;
for (let i = 0; i < count; i++) {
	// 时间向后偏移 0~90 天，保证时间轴有分组
	const created = now - Math.floor(Math.random() * 90 * 86400000);
	const updated = created + Math.floor(Math.random() * 3 * 86400000);
	const id = `${dayKey(created)}-${timeKey(created)}-${Math.random().toString(16).slice(2, 5)}`;
	const topic = topics[i % topics.length];
	const tag = nestedTags[i % nestedTags.length];
	const body = bodies[i % bodies.length];

	const fm = {
		id,
		created,
		updated,
	};
	if (tag) fm.tags = [tag];
	if (i % 10 === 0) fm.title = `${topic}卡片示例 ${i + 1}`;
	if (i % 7 === 0) fm.archived = true;
	if (i % 5 === 0) {
		fm.tags = [...(fm.tags ?? []), 'no-child'];
	}

	// 少量子卡片关系（每 50 张里，第 1 张是父卡，2~4 张是其子卡）
	if (i % 50 === 0 && i + 3 < count) {
		const childIds = [];
		for (let j = 1; j <= 3; j++) {
			const cCreated = created + j * 60000;
			const cId = `${dayKey(cCreated)}-${timeKey(cCreated)}-${Math.random().toString(16).slice(2, 5)}`;
			childIds.push(cId);
			await writeCard(cId, cCreated, cCreated, { parent: id, title: `子卡片 ${j}` }, `子卡片内容 ${j}：${body}`);
		}
		fm.children = childIds;
	}

	await writeCard(id, created, updated, fm, body);
	total++;
}

async function writeCard(id, created, updated, fm, body) {
	const yaml =
		'---\n' +
		Object.entries(fm)
			.map(([k, v]) => {
				if (Array.isArray(v)) return `${k}:\n${v.map((x) => `  - "${x}"`).join('\n')}`;
				if (typeof v === 'object') return '';
				return `${k}: ${typeof v === 'string' ? `"${v}"` : v}`;
			})
			.filter(Boolean)
			.join('\n') +
		'\n---\n\n';
	await writeFile(path.join(vaultDir, folder, `${id}.md`), yaml + body);
}

console.log(`已生成 ${total} 张测试卡片到 ${path.join(vaultDir, folder)}`);
