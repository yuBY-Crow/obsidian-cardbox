/**
 * Wikilink 解析与生成。
 *
 *卡片关联以Obsidian 标准双链格式存放在 frontmatter：
 *   children:
 *     - "[[2026-08-09-123500-cd2]]"
 *这样 Obsidian 的图谱、反向链接、重命名跟随都能直接识别，
 * 而不是插件私有的纯 id 字符串（对原生功能不可见）。
 *
 * 读取时同时兼容旧的纯 id 写法，因此已有卡片无需迁移。
 */

/** 把 id 包装成 wikilink */
export function toWikilink(id: string): string {
	return `[[${id}]]`;
}

/**
 * 从一个 frontmatter 条目中解析出目标 id。
 * 支持：
 *   [[id]]            标准
 *   [[id|别名]]        带显示别名
 *   [[id#标题]]        指向标题
 *   [[folder/id]]     带路径（取最后一段）
 *   [[id.md]]         带扩展名
 *   id                旧格式（纯 id），向后兼容
 * 解析失败返回空字符串。
 */
export function parseLinkTarget(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	let s = raw.trim();
	if (!s) return '';

	// 剥掉 wikilink 包裹
	const m = /^\[\[([\s\S]*?)\]\]$/.exec(s);
	if (m) s = m[1].trim();

	// 去掉别名与锚点
	const pipe = s.indexOf('|');
	if (pipe >= 0) s = s.slice(0, pipe).trim();
	const hash = s.indexOf('#');
	if (hash >= 0) s = s.slice(0, hash).trim();

	// 去掉路径前缀与.md 扩展名
	const slash = s.lastIndexOf('/');
	if (slash >= 0) s = s.slice(slash + 1);
	s = s.replace(/\.md$/i, '').trim();

	return s;
}

/** 批量解析 frontmatter 中的关联数组（字符串或数组均可） */
export function parseLinkList(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
	const out: string[] = [];
	for (const item of list) {
		const id = parseLinkTarget(item);
		if (id && !out.includes(id)) out.push(id);
	}
	return out;
}

/** 生成 frontmatter 用的关联数组（统一写成 wikilink） */
export function toLinkList(ids: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		const clean = parseLinkTarget(id);
		if (clean && !seen.has(clean)) {
			seen.add(clean);
			out.push(toWikilink(clean));
		}
	}
	return out;
}
