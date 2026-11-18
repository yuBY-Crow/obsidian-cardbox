import { App, Modal, Notice, Platform, setIcon } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';
import { pad2 } from '../utils/format';
import { log } from '../utils/logger';
import { createMarkdownEditor, getEditorText, setEditorText } from '../utils/preview';

export interface CaptureOptions {
	/** 子卡片：保存后登记为父卡片 */
	parent?: Card;
	/** 预填内容 */
	prefill?: string;
	/** 仅保存一次（用于创建子卡片） */
	singleShot?: boolean;
}

/**
 * 快速记录（简单扁平设计）
 *
 * 设计原则：无边框、无框感，靠字号与字重区分层级，正文区最大化。
 *
 * 布局（自上而下）：
 * - 标题：无边框大字输入，默认 = 创建时间到秒（YYYY-MM-DD-HHmmss），
 *   可直接改；回车跳到正文
 * - 正文：撑满剩余空间的无边框大输入区（主角）
 * - 底部：连续创建（左，文字按钮）+ 保存（右，主色胶囊）
 *
 * 配色全部走 Obsidian 主题变量，自动适配浅色/深色主题。
 */
export class CaptureModal extends Modal {
	private titleInput: HTMLInputElement;
	private editorView: EditorView | null = null;
	private continuous = true;
	private keyboardCleanup: (() => void) | null = null;
	private keyboardPoll: number | null = null;
	private keyboardFocusHandler: (() => void) | null = null;
	private saving = false;
	private closed = false;
	private layoutTimer: number | null = null;

	constructor(
		app: App,
		private ctx: CardBoxContext,
		private opts: CaptureOptions = {},
	) {
		super(app);
		this.continuous = !opts.parent && !opts.singleShot && ctx.settings.continuousCaptureDefault;
	}

	onOpen(): void {
		// 沉浸式：class 打在 modalEl 上
		this.modalEl?.addClass('cardbox-capture-modal');
		// modal 容器（modalEl 的父级 = .modal-container）也标记，用于底部对齐
		this.modalEl?.parentElement?.addClass('cardbox-capture-container');

		// 用 JS 强制隐藏 Obsidian 默认标题栏（真实 class 是 .modal-header，
		// 真机日志确认 modal 子元素为 [.modal-header-button, .modal-header, .modal-content]），
		// 去掉 content 默认 padding，让自定义标题 input 真正贴卡片顶部
		// 静态样式全部放到 CSS class 里（避免直接写 element.style.xxx）
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-capture');

		// 标题：无边框大字输入，默认 = 创建时间到秒，可直接改
		this.titleInput = contentEl.createEl('input', {
			cls: 'cardbox-capture-title',
			attr: {
				type: 'text',
				value: defaultTitle(new Date()),
				placeholder: i18n.captureTitleLabel,
				maxlength: '80',
				spellcheck: 'false',
				'aria-label': i18n.captureTitleLabel,
			},
		});
		// 点击全选便于覆盖，失焦裁剪空白
		this.titleInput.addEventListener('focus', () => this.titleInput.select());
		this.titleInput.addEventListener('blur', () => {
			this.titleInput.value = this.titleInput.value.trim();
		});
		// 标题按回车跳到正文
		this.titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.editorView?.focus();
			}
		});

		// 正文：CodeMirror 编辑器（capturePreview 开启时实时高亮 #标签/[[引用]] 等）
		const editorHost = contentEl.createDiv({ cls: 'cardbox-capture-input' });
		this.editorView = createMarkdownEditor(editorHost, this.opts.prefill ?? '', {
			onChange: () => {},
			onFocus: () => this.keyboardFocusHandler?.(),
			onSave: () => void this.save(),
			highlight: this.ctx.settings.capturePreview,
		});

		// 写拉松式工具栏：紧贴键盘上沿的一行图标 + 右端薄荷绿「发送」
		// 参考官网 wt-mobile.png：# · 图片 · 铅笔 · 键盘 · 图钉 · 时钟 · 发送
		const toolbar = contentEl.createDiv({ cls: 'cardbox-capture-toolbar' });
		const tool = (icon: string, label: string, fn: () => void): HTMLButtonElement => {
			const b = toolbar.createEl('button', {
				cls: 'cardbox-capture-tool',
				attr: { type: 'button', 'aria-label': label, title: label },
			});
			setIcon(b, icon);
			b.addEventListener('click', (e) => { e.preventDefault(); fn(); });
			return b;
		};
		tool('hash', i18n.addTag, () => this.insertText('#'));
		tool('image', '插入图片', () => this.insertText('![]()'));
		tool('pencil', '继续编辑', () => this.editorView?.focus());
		tool('keyboard', '收起键盘', () => this.editorView?.contentDOM?.blur());
		const pin = tool('pin', i18n.continuousMode, () => {
			this.continuous = !this.continuous;
			pin.toggleClass('is-active', this.continuous);
		});
		pin.toggleClass('is-active', this.continuous);
		tool('clock', '插入时间', () => {
			const d = new Date();
			this.insertText(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
		});
		const send = toolbar.createEl('button', {
			cls: 'cardbox-capture-send cardbox-capture-add',
			attr: { type: 'button', 'aria-label': i18n.save, title: i18n.save },
		});
		setIcon(send, 'send');
		send.addEventListener('click', () => void this.save());

		// 默认聚焦正文（正文是主角）
		this.editorView.focus();

		// 手机端：下部实时贴合输入法键盘顶部
		this.bindKeyboard();
	}

	/**
	 * 手机端让卡片下部贴合输入法键盘顶部。
	 *
	 * 上移手段：modal 手机端 fixed 定位到屏幕底部，键盘弹出时用
	 * modal 的 bottom 取键盘上沿偏移；卡片高度按可视区比例计算
	 * （正文区随之变大，上沿不顶到屏幕顶）。
	 *
	 * 信号源（取最大值）：Capacitor keyboardWillShow/WillHide 事件 /
	 * Platform.mobileKeyboardHeight / visualViewport 差值；编辑器聚焦时
	 * 立即轮询一次。
	 */
	private bindKeyboard(): void {
		const pm = Platform as unknown as {
			mobileKeyboardHeight?: number;
			mobileSoftKeyboardVisible?: boolean;
		};
		const cap = (window as unknown as {
			Capacitor?: { Plugins?: { Keyboard?: {
				addListener?: (event: string, cb: (info?: { keyboardHeight?: number }) => void) => Promise<{ remove?: () => void }>;
			} } };
		}).Capacitor;
		const kb = cap?.Plugins?.Keyboard;

		if (!Platform.isMobile) {
			return;
		}
		const container = this.modalEl?.parentElement;
		if (!container) {
			return;
		}

		const modal = this.modalEl;
		const capture = this.contentEl;
		const vv = window.visualViewport;
		// 各信号源写入的键盘高度；每次 apply 重新测量，避免「只增不减」
		let reported = 0;
		let lastApplied = -1;
		let suppressUntil = 0;

		const reset = (): void => {
			if (modal) {
				for (const p of ['--cb-bottom', '--cb-height', '--cb-max-height']) modal.style.removeProperty(p);
				modal.removeClass('is-keyboard-open');
			}
			capture.style.removeProperty('--cb-capture-height');
			capture.style.removeProperty('--cb-capture-min-height');
		};

		/**
		 * 关键：键盘高度 ≠ 卡片需要上移的距离。
		 * - adjustResize（本机型）：WebView 布局视口已被压到键盘上沿，
		 *   innerHeight == visualViewport.height，卡片应贴 WebView 底部（inset = 0）。
		 * - adjustPan：WebView 不变、键盘盖在下面，inset = innerHeight - vv.height，
		 *   卡片才需要上移这么多。
		 * 之前直接把 Capacitor 报的 keyboardHeight 当 bottom，在 adjustResize 机型上
		 * 等于多抬了一个键盘高度，编辑区就跑到屏幕最顶、离键盘很远。
		 */
		const keyboardState = (): { visible: boolean; inset: number } => {
			if (Date.now() < suppressUntil) return { visible: false, inset: 0 };
			const layoutH = window.innerHeight;
			const visibleBottom = vv ? (vv.offsetTop || 0) + vv.height : layoutH;
			const inset = Math.max(0, Math.round(layoutH - visibleBottom));
			const visible = reported > 0 || pm.mobileSoftKeyboardVisible === true || inset > 40;
			return { visible, inset };
		};

		const apply = (force = false): void => {
			const { visible, inset } = keyboardState();
			const layoutH = window.innerHeight;
			// 关键：key 必须包含 layoutH。adjustResize 机型上 inset 恒为 0，
			// 但键盘弹出动画期间 innerHeight 会从 777 连续缩到 496；
			// 若只用 inset 做 key，第一次（按旧视口算出的高度）会被锁死，
			// 卡片就变成 320px 铺在屏幕上部、离键盘很远。
			const key = visible ? inset * 100000 + layoutH : -1;
			if (!force && key === lastApplied) return;
			lastApplied = key;
			if (visible && modal) {
				// 卡片只占键盘上方一小段：底边贴键盘上沿，文字底对齐让光标
				// 始终紧挨工具栏，上沿留出压暗背景。
				const usable = Math.max(160, layoutH - inset);
				const cardH = Math.round(Math.min(260, Math.max(180, usable * 0.42)));
				modal.setCssProps({
					'--cb-bottom': `${inset}px`,
					'--cb-height': `${cardH}px`,
					'--cb-max-height': 'none',
				});
				modal.addClass('is-keyboard-open');
				capture.setCssProps({
					'--cb-capture-height': '100%',
					'--cb-capture-min-height': '0',
				});
				log.debug('kb', '贴合键盘', { inset, cardH, usable });
			} else {
				reset();
			}
		};
		const sync = (h?: number): void => {
			if (typeof h === 'number') reported = Math.max(0, h);
			apply();
		};

		// 信号 1：Capacitor Keyboard 事件
		const handles: Array<{ remove?: () => void }> = [];
		let listenersClosed = false;
		// addListener 的 Promise 可能晚于 onClose 才兑现：
		// 若已关闭则立即移除后到的句柄，避免全局键盘监听泄漏。
		const track = (p: Promise<{ remove?: () => void }>) => {
			p.then((h) => {
				if (!h) return;
				if (listenersClosed) h.remove?.();
				else handles.push(h);
			}).catch(() => {});
		};
		if (kb?.addListener) {
			track(kb.addListener('keyboardWillShow', (info) => {
				log.debug('kb', '键盘弹出', { height: info?.keyboardHeight ?? 0 });
				sync(info?.keyboardHeight ?? 0);
			}));
			track(kb.addListener('keyboardWillHide', () => {
				log.debug('kb', '键盘收起');
				reported = 0;
				suppressUntil = Date.now() + 1000;
				apply(true);
			}));
		}

		// 信号 2 + 3：Platform 内置值 + visualViewport 差值
		const poll = () => { apply(); };
		this.keyboardPoll = window.setInterval(poll, 200);
		window.visualViewport?.addEventListener('resize', poll);
		window.visualViewport?.addEventListener('scroll', poll);
		window.addEventListener('resize', poll);

		// 信号 4：编辑器聚焦时键盘必然弹出，立即触发一次检查
		this.keyboardFocusHandler = poll;

		poll();

		this.keyboardCleanup = () => {
			listenersClosed = true;
			if (this.keyboardPoll) window.clearInterval(this.keyboardPoll);
			this.keyboardPoll = null;
			window.visualViewport?.removeEventListener('resize', poll);
			window.visualViewport?.removeEventListener('scroll', poll);
			window.removeEventListener('resize', poll);
			this.keyboardFocusHandler = null;
			handles.forEach((h) => h?.remove?.());
			if (this.layoutTimer !== null) window.clearTimeout(this.layoutTimer);
			this.layoutTimer = null;
			reset();
		};
	}

	/** 在光标处插入文本（工具栏快捷输入用） */
	private insertText(text: string): void {
		const view = this.editorView;
		if (!view) return;
		const sel = view.state.selection.main;
		view.dispatch({
			changes: { from: sel.from, to: sel.to, insert: text },
			selection: { anchor: sel.from + text.length },
		});
		view.focus();
	}

	private async save(): Promise<void> {
		if (this.saving || this.closed || !this.editorView) return;
		this.saving = true;
		try {
			const body = getEditorText(this.editorView).trim();
			if (!body) {
				new Notice(i18n.emptyCaptureHint, 1500);
				return;
			}
			const title = this.titleInput.value.trim() || undefined;
			const file = await this.ctx.service.createCard({
				body,
				title,
				tags: this.ctx.settings.defaultTags,
			});
			// await 期间用户可能已关闭弹窗，editorView 已被 destroy 并置 null
			if (this.closed || !this.editorView) return;
			if (!file) return;

			if (this.opts.parent) {
				try {
					const child = await this.ctx.service.readCard(file);
					await this.ctx.service.addChild(this.opts.parent, child);
				} catch {
					/* 子卡片登记失败不阻塞 */
				}
				this.close();
				return;
			}

			if (this.continuous) {
				setEditorText(this.editorView, '');
				// 连续创建：标题重置为新时间，光标回正文
				this.titleInput.value = defaultTitle(new Date());
				this.editorView.focus();
			} else {
				this.close();
			}
		} finally {
			this.saving = false;
		}
	}

	onClose(): void {
		this.closed = true;
		this.keyboardCleanup?.();
		this.keyboardCleanup = null;
		this.keyboardFocusHandler = null;
		this.editorView?.destroy();
		this.editorView = null;
		this.modalEl?.removeClass('cardbox-capture-modal');
		this.modalEl?.parentElement?.removeClass('cardbox-capture-container');
		this.contentEl.empty();
	}
}

/** 默认标题 = 笔记创建时间，精确到秒（YYYY-MM-DD-HHmmss） */
function defaultTitle(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * Capacitor 的 keyboardHeight 在 Android / iOS 上报的都是 CSS 像素（dp），
 * 直接使用即可，不要再除以 devicePixelRatio。
 * （真机日志验证：innerH=890、dpr=3 时 raw=319，319/890≈36% 正是键盘占比；
 * 若当作物理像素除以 3 得 106px，上移量严重不足，看起来像「没上移」。）
 */
