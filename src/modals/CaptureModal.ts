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
	 * 关键：Obsidian 移动端 Android 沉浸式全屏（edge-to-edge）触发 Capacitor
	 * bug —— 键盘不改变 WebView 尺寸，`innerHeight`/`visualViewport` 都不变。
	 *
	 * 上移手段：给 modal **容器**（.modal-container）设 padding-bottom，
	 * 而不是给 modalEl 设 transform —— 因为 Obsidian 移动端 modal 有进入
	 * 动画（文档注明 "On phones, the modal will animate on screen"），
	 * transform 会被动画覆盖/冲突；padding-bottom 是纯布局属性，绝对生效。
	 *
	 * 信号源（取最大值）：
	 * 1. Capacitor keyboardWillShow/keyboardWillHide 事件（最权威）
	 * 2. Platform.mobileKeyboardHeight（Obsidian 封装）
	 * 3. visualViewport 差值（iOS 兜底）
	 * 4. textarea focus（键盘必然由它唤出，触发一次即时检查）
	 */
	private bindKeyboard(): void {
		if (!Platform.isMobile) return;
		const container = this.modalEl?.parentElement;
		if (!container) return;

		let keyboard = 0;
		const apply = () => {
			container.style.paddingBottom = keyboard > 0 ? `${keyboard}px` : '';
		};
		const raise = (h: number) => {
			if (h > keyboard) {
				keyboard = h;
				apply();
			}
		};

		// 信号 1：Capacitor Keyboard 事件
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

		// 信号 2 + 3：Platform 内置值 + visualViewport 差值
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

		// 信号 4：textarea 聚焦时键盘必然弹出，立即触发一次检查
		this.textarea?.addEventListener('focus', poll);

		// 诊断：首次聚焦后延迟检查，若键盘没被检测到则提示信号源状态，
		// 便于在真机上定位「到底哪一层失效」
		let diagnosed = false;
		this.textarea?.addEventListener('focus', () => {
			if (diagnosed) return;
			diagnosed = true;
			window.setTimeout(() => {
				const p = Platform as unknown as {
					mobileKeyboardHeight?: number;
					mobileSoftKeyboardVisible?: boolean;
				};
				const hasCap = !!(window as unknown as {
					Capacitor?: { Plugins?: { Keyboard?: unknown } };
				}).Capacitor?.Plugins?.Keyboard;
				const vv = window.visualViewport;
				new Notice(
					`键盘诊断 cap=${hasCap} pkH=${p.mobileKeyboardHeight ?? '∅'} vis=${p.mobileSoftKeyboardVisible ?? '∅'} vv=${vv ? Math.round(vv.height ?? 0) : '∅'} inner=${window.innerHeight} kb=${keyboard}`,
					8000,
				);
			}, 1500);
		});

		poll();

		this.keyboardCleanup = () => {
			if (this.keyboardPoll) window.clearInterval(this.keyboardPoll);
			this.keyboardPoll = null;
			window.visualViewport?.removeEventListener('resize', poll);
			window.visualViewport?.removeEventListener('scroll', poll);
			window.removeEventListener('resize', poll);
			this.textarea?.removeEventListener('focus', poll);
			handles.forEach((h) => h?.remove?.());
			container.style.paddingBottom = '';
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