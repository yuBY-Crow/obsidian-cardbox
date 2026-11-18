/**
 * 卡片摘要轻量渲染：不调用 MarkdownRenderer（Chrome 83 上几十张卡会明显卡顿）。
 * 只处理最常见标记：粗体、wikilink、行内代码、#标签，以及行首 markdown 前缀。
 * 全程用 DOM API 构造，不拼 innerHTML，避免注入。
 */
const TOKEN = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|`[^`]+`|#[\w\u4e00-\u9fa5/-]+)/g;

export function renderSnippet(host: HTMLElement, text: string): void {
	for (const rawLine of text.split('\n')) {
		const line = rawLine.replace(/^\s*(?:#{1,6}\s+|>\s|[-*+]\s|\d+\.\s)/, '');
		if (!line.trim()) continue;
		const row = host.createDiv({ cls: 'cardbox-snippet-line' });
		let last = 0;
		let m: RegExpExecArray | null;
		TOKEN.lastIndex = 0;
		while ((m = TOKEN.exec(line)) !== null) {
			if (m.index > last) row.createSpan().setText(line.slice(last, m.index));
			const tok = m[0];
			if (tok.startsWith('**')) row.createSpan({ cls: 'cb-b', text: tok.slice(2, -2) });
			else if (tok.startsWith('[[')) row.createSpan({ cls: 'cb-link', text: tok.slice(2, -2) });
			else if (tok.startsWith('`')) row.createSpan({ cls: 'cb-code', text: tok.slice(1, -1) });
			else row.createSpan({ cls: 'cb-tag', text: tok });
			last = m.index + tok.length;
		}
		if (last < line.length) row.createSpan().setText(line.slice(last));
	}
}