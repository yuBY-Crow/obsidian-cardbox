import { App, Modal, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import { log, type LogEntry } from '../utils/logger';

/** 展示与复制导出的统一上限，避免两处口径不一致 */
const MAX_LOG_LINES = 400;
/** 轻提示停留时长（ms） */
const TOAST_MS = 1800;

/**
 * 日志面板：真机排障用。
 * 手机端 Obsidian 无法像桌面一样开 DevTools，所有关键路径的日志
 * 都存在内存缓冲里，这里展示并可一键复制发回排查。
 */
export class LogModal extends Modal {
	private filter: 'all' | 'error' | 'warn' | 'info' | 'debug' = 'all';
	private bodyEl!: HTMLElement;
	private toastTimer: number | undefined;
	private toastEl: HTMLElement | undefined;

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(i18n.logTitle);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-log-modal');

		const toolbar = contentEl.createDiv({ cls: 'cardbox-log-toolbar' });

		// 级别过滤
		const sel = toolbar.createEl('select', { cls: 'cardbox-log-filter' });
		for (const lv of ['all', 'error', 'warn', 'info', 'debug'] as const) {
			sel.createEl('option', { text: i18n.logLevel(lv), value: lv });
		}
		sel.addEventListener('change', () => {
			this.filter = sel.value as typeof this.filter;
			this.render();
		});

		const refreshBtn = toolbar.createEl('button', { cls: 'clickable-icon cardbox-log-refresh', attr: { 'aria-label': i18n.logRefresh } });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', () => this.render());

		const copyBtn = toolbar.createEl('button', { cls: 'cardbox-log-copy', text: i18n.logCopy });
		copyBtn.addEventListener('click', () => this.copyAll());

		const clearBtn = toolbar.createEl('button', { cls: 'cardbox-log-clear', text: i18n.logClear });
		clearBtn.addEventListener('click', () => {
			log.clear();
			this.render();
		});

		this.bodyEl = contentEl.createDiv({ cls: 'cardbox-log-body' });
		this.render();
	}

	private render(): void {
		this.bodyEl.empty();
		const entries = log.getAll().filter((e) => {
			if (this.filter === 'all') return true;
			return e.level === this.filter;
		});
		if (entries.length === 0) {
			this.bodyEl.createDiv({ cls: 'cardbox-log-empty', text: i18n.logEmpty });
			return;
		}
		for (const entry of entries.slice(-MAX_LOG_LINES)) {
			this.bodyEl.appendChild(this.renderEntry(entry));
		}
		this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
	}

	private renderEntry(entry: LogEntry): HTMLElement {
		// 用游离节点构建，避免 createDiv 已挂载后再 appendChild 重复搬运
		const line = createDiv({ cls: `cardbox-log-line is-${entry.level}` });
		line.createSpan({ cls: 'cardbox-log-time', text: formatTs(entry.ts) });
		line.createSpan({ cls: 'cardbox-log-tag', text: entry.tag });
		line.createSpan({ cls: 'cardbox-log-msg', text: entry.msg });
		if (entry.data !== undefined) {
			const text = entry.data instanceof Error ? String(entry.data.stack || entry.data) : JSON.stringify(entry.data, null, 2);
			line.createEl('pre', { cls: 'cardbox-log-data', text });
		}
		return line;
	}

	private copyAll(): void {
		// 与 render() 用同一个上限常量，导出口径保持一致
		const entries = log.getAll().slice(-MAX_LOG_LINES);
		const lines = entries.map((e) => {
			const time = new Date(e.ts).toISOString();
			const data = e.data === undefined ? '' : e.data instanceof Error ? ` ${String(e.data.stack || e.data)}` : ` ${JSON.stringify(e.data)}`;
			return `[${time}] [${e.level}] [${e.tag}] ${e.msg}${data}`;
		});
		const text = `Slipbox 日志 ${new Date().toISOString()}\n共 ${entries.length} 条\n\n${lines.join('\n')}`;
		void navigator.clipboard?.writeText(text).catch(() => undefined);
		this.showToast(i18n.logCopied);
	}

	/** 轻提示：定时器句柄由弹窗持有，onClose 统一清除，避免关闭后仍触发 */
	private showToast(msg: string): void {
		this.clearToast();
		const el = document.body.createDiv({ cls: 'cardbox-log-toast', text: msg });
		this.toastEl = el;
		this.toastTimer = window.setTimeout(() => this.clearToast(), TOAST_MS);
	}

	private clearToast(): void {
		if (this.toastTimer !== undefined) {
			window.clearTimeout(this.toastTimer);
			this.toastTimer = undefined;
		}
		this.toastEl?.remove();
		this.toastEl = undefined;
	}

	onClose(): void {
		this.clearToast();
		this.contentEl.empty();
	}
}

function formatTs(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
