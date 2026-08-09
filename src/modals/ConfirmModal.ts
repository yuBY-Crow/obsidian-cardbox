import { App, ButtonComponent, Modal } from 'obsidian';
import { i18n } from '../i18n';

export interface ConfirmModalOptions {
	title: string;
	message: string;
	confirmText?: string;
	onConfirm: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
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

		new ButtonComponent(row)
			.setButtonText(this.opts.confirmText ?? i18n.confirm)
			.setWarning()
			.onClick(async () => {
				await this.opts.onConfirm();
				this.close();
			});
	}
}
