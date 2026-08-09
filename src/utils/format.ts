import { i18n } from '../i18n';

export function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function randomHex(len: number): string {
	let s = '';
	for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
	return s;
}

/** 生成卡片 id：YYYY-MM-DD-HHmmss-<3位随机hex>。时间部分用本地墙钟时间。 */
export function generateId(ts: number = Date.now()): string {
	const d = new Date(ts);
	const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
	const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
	return `${date}-${time}-${randomHex(3)}`;
}

/** 本地时区的"日"键：YYYY-MM-DD */
export function toDayKey(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 两个时间戳相差的本地天数（现在 - 过去，正数表示过去的天数） */
export function dayDiff(ts: number, now: number): number {
	const a = new Date(toDayKey(ts) + 'T00:00:00').getTime();
	const b = new Date(toDayKey(now) + 'T00:00:00').getTime();
	return Math.round((b - a) / 86400000);
}

export function formatTimeHM(ts: number): string {
	const d = new Date(ts);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 瓦片内相对时间：今天 14:32 / 昨天 09:00 / 今年 M月D日 / 往年 YYYY年M月D日 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
	const diff = dayDiff(ts, now);
	if (diff === 0) return `${i18n.today} ${formatTimeHM(ts)}`;
	if (diff === 1) return `${i18n.yesterday} ${formatTimeHM(ts)}`;
	const d = new Date(ts);
	if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 时间轴分组头：今天 / 昨天 / 今年 M月D日（周四）/ 往年 YYYY年M月D日 */
export function formatDayHeader(ts: number, now: number = Date.now()): string {
	const diff = dayDiff(ts, now);
	if (diff === 0) return i18n.today;
	if (diff === 1) return i18n.yesterday;
	const d = new Date(ts);
	const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
	const weekday = weekdays[d.getDay()];
	if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
}

/** 文件名安全化：去掉 Windows 非法字符 */
export function sanitizeFileName(title: string): string {
	return title.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

/** 归一化标签：去 #、去空格、合并斜杠、去首尾斜杠 */
export function normalizeTag(tag: unknown): string {
	if (typeof tag !== 'string') return '';
	return tag.trim().replace(/^#/, '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

/** 归一化标签数组（字符串或数组输入均可，去重去空） */
export function normalizeTags(tags: unknown): string[] {
	const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];
	const out: string[] = [];
	for (const t of list) {
		const n = normalizeTag(t);
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}
