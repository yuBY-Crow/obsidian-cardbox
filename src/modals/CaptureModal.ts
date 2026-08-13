import { App, Modal, Notice, Platform } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';
import { pad2 } from '../utils/format';

export interface CaptureOptions {
	/** 子卡片：保存后登记为父卡片 */
	parent?: Card;
	/** 占位提示 */
	placeholder?: string;
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
	private textarea: HTMLTextAreaElement;
	private continuous = true;
	private keyboardCleanup: (() => void) | null = null;
	private keyboardPoll: number | null = null;

	constructor(
		app: App,
		private ctx: CardBoxContext,
		private opts: CaptureOptions = {},
	) {
		super(app);
		this.continuous = !opts.parent && !opts.singleShot && ctx.settings.continuousCaptureDefault;
	}

	onOpen(): void {
		// 沉浸式：class 打在 modalEl 上（关闭按钮 .modal-close-button 是它的直接子元素，
		// 打在 titleEl.parentElement 上层级不对，选择器命不中）
		this.modalEl?.addClass('cardbox-capture-modal');
		// modal 容器（modalEl 的父级 = .modal-container）也标记，用于底部对齐
		this.modalEl?.parentElement?.addClass('cardbox-capture-container');

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
				this.textarea.focus();
			}
		});

		// 正文：撑满剩余空间的大输入区，无边框
		this.textarea = contentEl.createEl('textarea', {
			cls: 'cardbox-capture-input',
			attr: {
				placeholder: this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
				'aria-label': this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
			},
		});
		if (this.opts.prefill) this.textarea.value = this.opts.prefill;

		// 底部：连续创建（左，文字按钮）+ 保存（右，主色胶囊）
		const footer = contentEl.createDiv({ cls: 'cardbox-capture-footer' });

		if (!this.opts.parent && !this.opts.singleShot) {
			const mode = footer.createEl('button', { cls: 'cardbox-capture-mode' });
			mode.createSpan({ cls: 'cardbox-capture-mode-dot' });
			mode.createSpan({ text: i18n.continuousMode });
			mode.addEventListener('click', () => {
				this.continuous = !this.continuous;
				mode.classList.toggle('is-continuous', this.continuous);
			});
			mode.classList.toggle('is-continuous', this.continuous);
		} else {
			footer.createDiv({ cls: 'cardbox-spacer' });
		}

		const addBtn = footer.createEl('button', { cls: 'cardbox-capture-add', attr: { 'aria-label': i18n.save } });
		addBtn.createSpan({ text: i18n.save });
		addBtn.addEventListener('click', () => void this.save());

		// Ctrl/Cmd+Enter 保存
		this.textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.save();
			}
		});

		// 默认聚焦正文（正文是主角）；正文为空时先落在标题上方便改名
		if (this.opts.prefill) {
			this.textarea.focus();
			this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
		} else {
			this.textarea.focus();
		}

		// 手机端：下部实时贴合输入法键盘顶部
		this.bindKeyboard();
	}

	/**
	 * 手机端让卡片下部贴合输入法键盘顶部。
	 *
	 * 关键：Obsidian 移动端 Android 用沉浸式全屏（edge-to-edge），触发
	 * Capacitor 已知 bug —— 全屏模式下键盘无法调整 WebView 大小，所以
	 * `window.innerHeight` / `visualViewport.height` 都不变，算不出键盘高度。
	 * 唯一可靠的信号是 Capacitor Keyboard 事件（keyboardWillShow 的
	 * info.keyboardHeight），社区插件均以此为准。
	 *
	 * 信号优先级：
	 * 1. Capacitor `keyboardWillShow` / `keyboardWillHide` 事件（最权威）
	 * 2. `Platform.mobileKeyboardHeight`（Obsidian 封装，轮询兜底）
	 * 3. `visualViewport` 差值（iOS / 标准 WebView 兜底）
	 *
	 * 不做的：shrink 补偿（上版 bug 来源 —— `mobileDeviceHeight` 缺失时
	 * 回退 `screen.height` 是物理像素，会让 translate 被 clamp 成 0）。
	 * 直接上移完整键盘高度即可。
	 */
	private bindKeyboard(): void {
		if (!Platform.isMobile) return;
		const modal = this.modalEl;
		if (!modal) return;

		let keyboard = 0;
		const apply = () => {
			modal.style.transform = keyboard > 0 ? `translateY(-${keyboard}px)` : '';
			modal.style.transition = 'transform 0.15s ease-out';
		};
		// 取更大值（多信号并存时，宁可多上移一点也不要被键盘遮住）
		const raise = (h: number) => {
			if (h > keyboard) {
				keyboard = h;
				apply();
			}
		};

		// 信号 1：Capacitor Keyboard 事件（最权威、即时）
		const cap = (window as unknown as {
			Capacitor?: { Plugins?: { Keyboard?: {
				addListener?: (event: string, cb: (info?: { keyboardHeight?: number }) => void) => Promise<{ remove?: () => void }>;
			} } };
		}).Capacitor;
		const kb = cap?.Plugins?.Keyboard;
		const handles: Array<{ remove?: () => void }> = [];
		if (kb?.addListener) {
			kb.addListener('keyboardWillShow', (info) => {
				raise(toCssPx(info?.keyboardHeight ?? 0));
			}).then((h) => { if (h) handles.push(h); }).catch(() => {});
			kb.addListener('keyboardWillHide', () => {
				keyboard = 0;
				apply();
			}).then((h) => { if (h) handles.push(h); }).catch(() => {});
		}

		// 信号 2 + 3：轮询兜底（Platform 内置值 + visualViewport）
		const poll = () => {
			const p = Platform as unknown as {
				mobileKeyboardHeight?: number;
				mobileSoftKeyboardVisible?: boolean;
			};
			if (p.mobileSoftKeyboardVisible && typeof p.mobileKeyboardHeight === 'number') {
				raise(p.mobileKeyboardHeight);
			}
			const vv = window.visualViewport;
			if (vv?.height) raise(Math.max(0, window.innerHeight - vv.height));
		};
		this.keyboardPoll = window.setInterval(poll, 200);
		window.visualViewport?.addEventListener('resize', poll);
		window.visualViewport?.addEventListener('scroll', poll);
		window.addEventListener('resize', poll);
		poll();

		this.keyboardCleanup = () => {
			if (this.keyboardPoll) window.clearInterval(this.keyboardPoll);
			this.keyboardPoll = null;
			window.visualViewport?.removeEventListener('resize', poll);
			window.visualViewport?.removeEventListener('scroll', poll);
			window.removeEventListener('resize', poll);
			handles.forEach((h) => h?.remove?.());
			modal.style.transform = '';
		};
	}

	private async save(): Promise<void> {
		const body = this.textarea.value.trim();
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
			this.textarea.value = '';
			// 连续创建：标题重置为新时间，光标回正文
			this.titleInput.value = defaultTitle(new Date());
			this.textarea.focus();
		} else {
			this.close();
		}
	}

	onClose(): void {
		this.keyboardCleanup?.();
		this.keyboardCleanup = null;
		this.modalEl?.removeClass('cardbox-capture-modal');
		this.modalEl?.parentElement?.removeClass('cardbox-capture-container');
		this.contentEl.empty();
	}
}

/** 默认标题 = 笔记创建时间，精确到秒（YYYY-MM-DD-HHmmss） */
function defaultTitle(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** Capacitor 的 keyboardHeight 在 Android 是物理像素，转成 CSS 像素 */
function toCssPx(px: number): number {
	if (px <= 0) return 0;
	if ((Platform as unknown as { isAndroidApp?: boolean }).isAndroidApp) {
		return px / (window.devicePixelRatio || 1);
	}
	return px;
}