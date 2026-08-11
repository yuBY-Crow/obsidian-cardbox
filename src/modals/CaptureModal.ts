import { App, Modal, Notice, setIcon } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';

export interface CaptureOptions {
	/** 子卡片：保存后登记为父卡片 */
	parent?: Card;
	/** 占位提示（Writeathon 风格：顶部淡色引导句） */
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
 * - 顶部深色块作为"启动引导区"，显示占位文本（Writeathon 式：「写作就像马拉松」）
 * - 中部大编辑区（光标自动聚焦，textarea 自适应高度）
 * - 底部工具栏：标签 / 图片 / 链接 / 扫码 / 二维码 / 添加（最右 CTA）
 * - 手机端键盘弹出时，底部工具栏会自动贴住键盘顶部（环境变量 `--safe-area-inset-bottom`）
 * - 连续模式开关藏在右上角轻触区域（默认开启）
 */
export class CaptureModal extends Modal {
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
		// 隐藏 Obsidian 默认 modal 标题栏（沉浸式全屏）
		this.titleEl.parentElement?.addClass('cardbox-modal-hidden-chrome');

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-capture');

		// 顶部深色引导区
		const header = contentEl.createDiv({ cls: 'cardbox-capture-header' });
		header.createDiv({ cls: 'cardbox-capture-hint', text: this.opts.parent ? i18n.addChildHint : i18n.captureSlogan });

		// 编辑区
		this.textarea = contentEl.createEl('textarea', {
			cls: 'cardbox-capture-input',
			attr: {
				rows: '3',
				placeholder: this.opts.placeholder ?? '',
				'aria-label': this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
			},
		});
		if (this.opts.prefill) this.textarea.value = this.opts.prefill;
		this.textarea.addEventListener('input', this.autosize);
		// 自动高度
		requestAnimationFrame(this.autosize);

		// 底部工具栏
		const toolbar = contentEl.createDiv({ cls: 'cardbox-capture-toolbar' });
		const tools = toolbar.createDiv({ cls: 'cardbox-capture-tools' });
		// 工具按钮（占位：标签/图片/链接/扫码/二维码）—— 实际功能后续可接
		this.makeTool(tools, 'hash', i18n.toolTag, () => this.insertAtCursor('\n# '));
		this.makeTool(tools, 'image', i18n.toolImage, () => new Notice(i18n.toolImageHint));
		this.makeTool(tools, 'link', i18n.toolLink, () => this.insertAtCursor('[[', ']]'));
		this.makeTool(tools, 'scan', i18n.toolScan, () => new Notice(i18n.toolScanHint));
		this.makeTool(tools, 'qr-code', i18n.toolQr, () => new Notice(i18n.toolQrHint));

		// 添加按钮（最右 CTA）
		const addBtn = toolbar.createEl('button', { cls: 'cardbox-capture-add', attr: { 'aria-label': i18n.save } });
		addBtn.createSpan({ text: i18n.save });
		addBtn.addEventListener('click', () => void this.save());

		// 连续模式轻触切换（点击顶部右侧极小区域：tap-to-toggle，参考 Writeathon 体验）
		if (!this.opts.parent && !this.opts.singleShot) {
			const mode = header.createDiv({ cls: 'cardbox-capture-mode' });
			mode.createSpan({ cls: 'cardbox-capture-mode-dot' });
			mode.createSpan({ text: this.continuous ? i18n.continuousMode : i18n.singleMode });
			mode.addEventListener('click', () => {
				this.continuous = !this.continuous;
				mode.classList.toggle('is-continuous', this.continuous);
				mode.querySelector('span:last-child')!.textContent = this.continuous ? i18n.continuousMode : i18n.singleMode;
			});
			mode.classList.toggle('is-continuous', this.continuous);
		}

		this.textarea.focus();
		this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);

		this.textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.save();
			}
		});
	}

	private makeTool(host: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const btn = host.createEl('button', { cls: 'cardbox-capture-tool', attr: { 'aria-label': label } });
		setIcon(btn, icon);
		btn.addEventListener('click', onClick);
	}

	private insertAtCursor(left: string, right = ''): void {
		const el = this.textarea;
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? el.value.length;
		const before = el.value.slice(0, start);
		const sel = el.value.slice(start, end);
		const after = el.value.slice(end);
		el.value = before + left + sel + right + after;
		const cursor = start + left.length + sel.length + right.length;
		el.setSelectionRange(cursor, cursor);
		el.focus();
		this.autosize();
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
		const file = await this.ctx.service.createCard({
			body,
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
			this.textarea.focus();
			this.autosize();
		} else {
			this.close();
		}
	}

	onClose(): void {
		this.titleEl.parentElement?.removeClass('cardbox-modal-hidden-chrome');
		this.contentEl.empty();
	}
}