import { App, Modal, Notice } from 'obsidian';
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
 * 沉浸式快速捕获（Writeathon 风格）
 *
 * 布局：
 * - 顶部深色块：可编辑的「卡片标题」输入框（默认 = 笔记创建时间，精确到秒
 *   YYYY-MM-DD-HHmmss，与文件名方案一致，可随意修改）
 * - 中部大编辑区（textarea 自适应高度）
 * - 底部：仅「保存」CTA（Obsidian 默认编辑工具栏在完整编辑器中可用，
 *   快速记录保持轻量，不加自定义工具按钮）
 */
export class CaptureModal extends Modal {
	private titleInput: HTMLInputElement;
	private textarea: HTMLTextAreaElement;
	private continuous = true;
	private autosize = () => this.autoSize();

	constructor(
		app: App,
		private ctx: CardBoxContext,
		private opts: CaptureOptions = {},
	) {
		super(app);
		this.continuous = !opts.parent && !opts.singleShot && ctx.settings.continuousCaptureDefault;
	}

	onOpen(): void {
		// 隐藏 Obsidian 默认 modal 标题栏（沉浸式全屏），也没有取消/关闭按钮
		this.titleEl.parentElement?.addClass('cardbox-modal-hidden-chrome');
		if (this.modalEl) this.modalEl.addClass('cardbox-modal-no-close');

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-capture');

		// 顶部：卡片标题（默认 = 创建时间到秒，可编辑）——独立一行，卡片最顶部
		const titleRow = contentEl.createDiv({ cls: 'cardbox-capture-title-row' });
		this.titleInput = titleRow.createEl('input', {
			cls: 'cardbox-capture-title',
			attr: {
				type: 'text',
				value: defaultTitle(new Date()),
				maxlength: '80',
				spellcheck: 'false',
				'aria-label': i18n.captureTitleLabel,
			},
		});
		// 点击全选便于覆盖，输入失焦后自动裁剪空白
		this.titleInput.addEventListener('focus', () => this.titleInput.select());
		this.titleInput.addEventListener('blur', () => {
			this.titleInput.value = this.titleInput.value.trim();
		});

		// 正文编辑区：与标题栏之间无边框，自身也无边框
		this.textarea = contentEl.createEl('textarea', {
			cls: 'cardbox-capture-input',
			attr: {
				rows: '3',
				placeholder: this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
				'aria-label': this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
			},
		});
		if (this.opts.prefill) this.textarea.value = this.opts.prefill;
		this.textarea.addEventListener('input', this.autosize);
		requestAnimationFrame(this.autosize);

		// 底部一行：连续模式（左）+ 保存按钮（右），按钮整体上移一个自身高度
		const footer = contentEl.createDiv({ cls: 'cardbox-capture-footer' });

		if (!this.opts.parent && !this.opts.singleShot) {
			const mode = footer.createEl('button', { cls: 'cardbox-capture-mode' });
			mode.createSpan({ cls: 'cardbox-capture-mode-dot' });
			mode.createSpan({ text: this.continuous ? i18n.continuousMode : i18n.singleMode });
			mode.addEventListener('click', () => {
				this.continuous = !this.continuous;
				mode.classList.toggle('is-continuous', this.continuous);
				mode.querySelector('span:last-child')!.textContent = this.continuous ? i18n.continuousMode : i18n.singleMode;
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

		// 默认聚焦正文，若正文为空但标题有值时聚焦标题
		if (this.textarea.value.trim()) {
			this.textarea.focus();
			this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
		} else {
			this.titleInput.focus();
			this.titleInput.select();
		}
	}

	private autoSize(): void {
		const el = this.textarea;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
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
			// 连续模式：标题重置为新时间
			this.titleInput.value = defaultTitle(new Date());
			this.textarea.focus();
			this.autosize();
		} else {
			this.close();
		}
	}

	onClose(): void {
		this.titleEl.parentElement?.removeClass('cardbox-modal-hidden-chrome');
		if (this.modalEl) this.modalEl.removeClass('cardbox-modal-no-close');
		this.contentEl.empty();
	}
}

/** 默认标题 = 笔记创建时间，精确到秒（YYYY-MM-DD-HHmmss） */
function defaultTitle(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}