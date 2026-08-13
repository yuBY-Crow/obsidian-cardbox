import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

/**
 * 新建卡片正文编辑器：CodeMirror 6 + 自定义 decorations，
 * 在「编辑区内」实时高亮 Obsidian 语法（所见即所得，非下方单独预览区）。
 *
 * 高亮规则（正则扫描 + mark decoration）：
 * - #标签（#tag、#标签、#标签/子标签，支持中文/字母/数字/连字符/斜杠/下划线）
 * - [[笔记引用]]（wiki 链接，含别名 [[note|别名]]）
 * - 标题（行首 #~######）
 * - 加粗 **text**、行内代码 `code`
 *
 * 依赖 @codemirror/view + @codemirror/state，esbuild 已 external，
 * 运行时由 Obsidian 内部提供（官方插件开发标准做法）。
 */

const CLS = {
	tag: 'cm-cardbox-tag',
	link: 'cm-cardbox-link',
	heading: 'cm-cardbox-heading',
	bold: 'cm-cardbox-bold',
	code: 'cm-cardbox-code',
};

/** 用正则扫描文本，把匹配区间标记为指定 class 的 mark decoration */
function scan(
	builder: RangeSetBuilder<Decoration>,
	text: string,
	re: RegExp,
	cls: string,
	fromOf?: (m: RegExpExecArray) => number,
): void {
	re.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const from = fromOf ? fromOf(m) : m.index;
		const to = m.index + m[0].length;
		if (from < to) builder.add(from, to, Decoration.mark({ class: cls }));
		if (m[0].length === 0) re.lastIndex += 1; // 防空匹配死循环
	}
}

/** 标题：区分 H1~H6，按级别打不同 class，CSS 用 --hN-size 分级放大字号 */
function scanHeadings(builder: RangeSetBuilder<Decoration>, text: string): void {
	const re = /^(#{1,6})[ \t]+[^\n]*/gm;
	re.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const level = m[1].length;
		builder.add(m.index, m.index + m[0].length, Decoration.mark({ class: `${CLS.heading} cm-cardbox-h${level}` }));
		if (m[0].length === 0) re.lastIndex += 1;
	}
}

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const text = view.state.doc.toString();

	// 标题：#~###### 行首（区分级别，分级放大字号）
	scanHeadings(builder, text);
	// 加粗 **text**
	scan(builder, text, /\*\*[^*\n]+\*\*/g, CLS.bold);
	// 行内代码 `code`
	scan(builder, text, /`[^`\n]+`/g, CLS.code);
	// #标签（跳过前缀空白/左括号，只标记 # 起的内容）
	scan(builder, text, /(^|[\s(（])#[^\s#()）]+/g, CLS.tag, (m) => m.index + m[1].length);
	// [[笔记引用]]
	scan(builder, text, /\[\[[^\]\n]+\]\]/g, CLS.link);

	return builder.finish();
}

/** 提供 decorations 的 ViewPlugin：文档或视口变化时重新计算 */
const previewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export interface MarkdownEditorOptions {
	/** 文档内容变化时回调 */
	onChange?: (text: string) => void;
	/** 编辑器聚焦时回调（用于触发键盘贴合检查） */
	onFocus?: () => void;
	/** Ctrl/Cmd+Enter 保存 */
	onSave?: () => void;
	/** 是否启用实时高亮（对应 capturePreview 设置） */
	highlight?: boolean;
}

/** 在 parent 容器内创建一个带实时高亮的 Markdown 编辑器 */
export function createMarkdownEditor(
	parent: HTMLElement,
	initial: string,
	opts: MarkdownEditorOptions = {},
): EditorView {
	const extensions: Extension[] = [
		EditorView.lineWrapping,
		EditorView.updateListener.of((u) => {
			if (u.docChanged) opts.onChange?.(u.state.doc.toString());
		}),
		EditorView.domEventHandlers({
			focus: () => opts.onFocus?.(),
			keydown: (event) => {
				if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					opts.onSave?.();
					return true;
				}
				return false;
			},
		}),
	];
	if (opts.highlight !== false) {
		extensions.push(previewPlugin);
	}
	return new EditorView({
		state: EditorState.create({ doc: initial, extensions }),
		parent,
	});
}

/** 读取编辑器当前文本 */
export function getEditorText(view: EditorView): string {
	return view.state.doc.toString();
}

/** 整体替换编辑器文本（连续模式清空、预填等） */
export function setEditorText(view: EditorView, text: string): void {
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
