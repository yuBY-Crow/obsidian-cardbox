import { App, ButtonComponent, Modal } from 'obsidian';
import { i18n } from '../i18n';

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText?: string;
	onConfirm: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
	/** 防止双击/连点把破坏性操作执行两遍 */
	private submitting = false;

	constructor(
		app: App,
		private opts: ConfirmModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.opts.title);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-confirm');
		contentEl.createEl('p', { text: this.opts.message });
		const row = contentEl.createDiv({ cls: 'cardbox-modal-actions' });

		new ButtonComponent(row).setButtonText(i18n.cancel).onClick(() => this.close());

		const confirmBtn = new ButtonComponent(row).setButtonText(this.opts.confirmText ?? i18n.confirm);
		confirmBtn.buttonEl.addClass('cardbox-btn-destructive');
		confirmBtn.onClick(async () => {
			if (this.submitting) return;
			this.submitting = true;
			confirmBtn.setDisabled(true);
			try {
				await this.opts.onConfirm();
				this.close();
			} finally {
				this.submitting = false;
				confirmBtn.setDisabled(false);
			}
		});
	}
}
