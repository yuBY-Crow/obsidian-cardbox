import { App, ButtonComponent, Modal, Notice, ToggleComponent } from 'obsidian';
import { i18n } from '../i18n';
import type { CardBoxContext } from '../context';
import type { Card } from '../types';

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

/** 弹幕式快速捕获：保存后可选保持打开并清空，连续录入 */
export class CaptureModal extends Modal {
	private textarea: HTMLTextAreaElement;
	private continuous = true;

	constructor(
		app: App,
		private ctx: CardBoxContext,
		private opts: CaptureOptions = {},
	) {
		super(app);
		this.continuous = ctx.settings.continuousCaptureDefault;
	}

	onOpen(): void {
		this.setTitle(this.opts.parent ? i18n.addChild : i18n.captureTitle);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-capture');

		this.textarea = contentEl.createEl('textarea', {
			cls: 'cardbox-capture-input',
			attr: {
				rows: '6',
				placeholder: this.opts.placeholder ?? i18n.capturePlaceholder,
				'aria-label': this.opts.parent ? i18n.childCapturePlaceholder : i18n.capturePlaceholder,
			},
		});
		if (this.opts.prefill) this.textarea.value = this.opts.prefill;
		this.textarea.focus();

		const footer = contentEl.createDiv({ cls: 'cardbox-modal-footer' });

		if (this.opts.parent || this.opts.singleShot) {
			this.continuous = false;
		} else {
			new ToggleComponent(footer)
				.setValue(this.continuous)
				.setTooltip(i18n.continuousMode)
				.onChange((v) => {
					this.continuous = v;
				});
			footer.createSpan({ cls: 'cardbox-muted', text: i18n.continuousMode });
		}

		footer.createDiv({ cls: 'cardbox-spacer' });

		new ButtonComponent(footer).setButtonText(i18n.cancel).onClick(() => this.close());

		const saveBtn = new ButtonComponent(footer).setButtonText(i18n.save).setCta();
		saveBtn.onClick(() => void this.save());

		this.textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.save();
			}
		});
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
		} else {
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
