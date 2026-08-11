/**
 * 轻量诊断日志：内存环形缓冲 + 控制台镜像。
 *
 * 背景：移动端真机问题（如「点击数字展开没反应」「标题不显示」）在
 * mock 环境无法复现，必须靠真机日志定位。手机端 Obsidian 无法像桌面
 * 一样方便地开 DevTools，因此提供一个「日志面板」命令：
 * 在内存中保留最近 MAX 条日志，用户可一键复制发回。
 *
 * 用法：
 *   log.info('tile', '卡片标题', { hasTitle: !!card.title });
 *   log.error('render', '渲染异常', err);
 *
 * 级别过滤：默认记录 info+；可通过日志面板的级别切换看到更细的 debug。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	ts: number;
	level: LogLevel;
	tag: string;
	msg: string;
	data?: unknown;
}

const MAX = 600;
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
	private buffer: LogEntry[] = [];
	/** 运行时级别：debug 会输出更多细节 */
	minLevel: LogLevel = 'info';
	/** 是否同时输出到 console（真机不方便看，但桌面调试有用） */
	mirrorToConsole = true;

	private push(level: LogLevel, tag: string, msg: string, data?: unknown): void {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
		const entry: LogEntry = { ts: Date.now(), level, tag, msg, data };
		this.buffer.push(entry);
		if (this.buffer.length > MAX) this.buffer.splice(0, this.buffer.length - MAX);
		if (this.mirrorToConsole) {
			const line = `[CardBox:${tag}] ${msg}`;
			const extra = data === undefined ? '' : data instanceof Error ? ` ${String(data.stack || data)}` : ` ${JSON.stringify(data)}`;
			if (level === 'error') console.error(line + extra);
			else if (level === 'warn') console.warn(line + extra);
			else console.log(line + extra);
		}
	}

	debug(tag: string, msg: string, data?: unknown): void {
		this.push('debug', tag, msg, data);
	}
	info(tag: string, msg: string, data?: unknown): void {
		this.push('info', tag, msg, data);
	}
	warn(tag: string, msg: string, data?: unknown): void {
		this.push('warn', tag, msg, data);
	}
	error(tag: string, msg: string, err?: unknown): void {
		this.push('error', tag, msg, err);
	}

	getAll(): LogEntry[] {
		return [...this.buffer];
	}

	clear(): void {
		this.buffer = [];
	}
}

export const log = new Logger();
