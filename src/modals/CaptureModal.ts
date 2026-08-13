import { App, Modal, Notice, Platform } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';
import { pad2 } from '../utils/format';
import { log } from '../utils/logger';

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
		// 沉浸式：class 打在 modalEl 上
		this.modalEl?.addClass('cardbox-capture-modal');
		// modal 容器（modalEl 的父级 = .modal-container）也标记，用于底部对齐
		this.modalEl?.parentElement?.addClass('cardbox-capture-container');

		// 用 JS 强制隐藏 Obsidian 默认标题栏（真实 class 是 .modal-header，
		// 真机日志确认 modal 子元素为 [.modal-header-button, .modal-header, .modal-content]），
		// 去掉 content 默认 padding，让自定义标题 input 真正贴卡片顶部
		this.titleEl.style.display = 'none';
		this.titleEl.style.height = '0';
		this.titleEl.style.padding = '0';
		this.titleEl.style.margin = '0';
		const headerEl = this.modalEl?.querySelector('.modal-header') as HTMLElement | null;
		if (headerEl) {
			headerEl.style.display = 'none';
			headerEl.style.height = '0';
		}
		// modal 本身也强制无 padding，确保关闭按钮 top:0 与标题框同高
		if (this.modalEl) this.modalEl.style.padding = '0';

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-capture');
		contentEl.style.padding = '0';

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
	 * 上移手段：给 modal 容器（.modal-container）设 padding-bottom（纯布局
	 * 属性，不碰 transform，避开 Obsidian modal 进入动画的覆盖）。
	 *
	 * 信号源（取最大值）：Capacitor keyboardWillShow 事件 / Platform
	 * .mobileKeyboardHeight / visualViewport 差值。
	 *
	 * 诊断全部走 console.log（[cardbox-kb] 前缀），因为 Notice 在真机上
	 * 可能被 modal 遮挡看不到；日志在函数开头就输出，不依赖 focus 事件。
	 */
	private bindKeyboard(): void {
		const pm = Platform as unknown as {
			isMobileApp?: boolean;
			isAndroidApp?: boolean;
			mobileKeyboardHeight?: number;
			mobileSoftKeyboardVisible?: boolean;
			mobileDeviceHeight?: number;
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

		let keyboard = 0;
		// 键盘弹出时，卡片在「原高度」基础上增高的量（用户要求 40px）
		const HEIGHT_INCREASE = 40;
		const modal = this.modalEl;
		const capture = this.contentEl;
		// 记录无键盘时的卡片原高度（offsetHeight 强制同步布局，值准确）
		let originalH = capture.offsetHeight || 0;

		const apply = () => {
			if (keyboard > 0 && modal) {
				// 下沿：贴键盘上沿（modal fixed 定位，直接设 bottom）
				modal.style.bottom = `${keyboard}px`;
				// 卡片高度 = 原高度 + 40（而非撑满屏幕），正文区 flex:1 自适应
				const cardH = Math.max(120, originalH + HEIGHT_INCREASE);
				capture.style.height = `${cardH}px`;
				capture.style.minHeight = '0';
				modal.style.maxHeight = 'none';
				// 打点：记录设置值与实际布局矩形，便于定位「没生效」的层级
				log.info('kb', '上移+缩放 apply', {
					keyboard,
					cardH,
					bottom: modal.style.bottom,
					height: capture.style.height,
				});
				window.setTimeout(() => {
					const r = capture.getBoundingClientRect();
					log.info('kb', '卡片实际位置', { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), innerH: window.innerHeight });
				}, 80);
			} else {
				if (modal) {
					modal.style.bottom = '';
					modal.style.maxHeight = '';
				}
				capture.style.height = '';
				capture.style.minHeight = '';
			}
		};
		const raise = (h: number) => {
			if (h > keyboard) {
				keyboard = h;
				apply();
			}
		};

		// 信号 1：Capacitor Keyboard 事件
		const handles: Array<{ remove?: () => void }> = [];
		if (kb?.addListener) {
			kb.addListener('keyboardWillShow', (info) => {
				log.info('kb', '键盘弹出', { height: toCssPx(info?.keyboardHeight ?? 0) });
				raise(toCssPx(info?.keyboardHeight ?? 0));
			}).then((h) => { if (h) handles.push(h); }).catch(() => {});
			kb.addListener('keyboardWillHide', () => {
				log.info('kb', '键盘收起');
				keyboard = 0;
				apply();
			}).then((h) => { if (h) handles.push(h); }).catch(() => {});
		}

		// 信号 2 + 3：Platform 内置值 + visualViewport 差值
		const poll = () => {
			if (pm.mobileSoftKeyboardVisible && typeof pm.mobileKeyboardHeight === 'number') {
				raise(pm.mobileKeyboardHeight);
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

		poll();

		this.keyboardCleanup = () => {
			if (this.keyboardPoll) window.clearInterval(this.keyboardPoll);
			this.keyboardPoll = null;
			window.visualViewport?.removeEventListener('resize', poll);
			window.visualViewport?.removeEventListener('scroll', poll);
			window.removeEventListener('resize', poll);
			this.textarea?.removeEventListener('focus', poll);
			handles.forEach((h) => h?.remove?.());
			if (modal) {
				modal.style.bottom = '';
				modal.style.maxHeight = '';
			}
			capture.style.height = '';
			capture.style.minHeight = '';
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

/**
 * Capacitor 的 keyboardHeight 在 Android / iOS 上报的都是 CSS 像素（dp），
 * 直接使用即可，不要再除以 devicePixelRatio。
 * （真机日志验证：innerH=890、dpr=3 时 raw=319，319/890≈36% 正是键盘占比；
 * 若当作物理像素除以 3 得 106px，上移量严重不足，看起来像「没上移」。）
 */
function toCssPx(px: number): number {
	return px;
}