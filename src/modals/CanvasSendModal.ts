import { App, Modal, Setting } from 'obsidian';
import { i18n } from '../i18n';
import type { Card, CardBoxSettings } from '../types';
import type { CardIndex } from '../index';
import { countLinkedCards, type LinkDirection } from '../utils/graph';

export interface CanvasSendOptions {
	depth: number;
	direction: LinkDirection;
	drawEdges: boolean;
	remember: boolean;
}

const MAX_DEPTH = 5;

/**
 * 「投放到白板」选项弹窗。
 *
 * 让用户决定沿引用关系向外扩展几层、看哪个方向，
 * 并实时显示会投放多少张卡片——层级在稠密图上增长很快，
 * 没有这个预估很容易一次投出上百张卡片把白板塞满。
 */
export class CanvasSendModal extends Modal {
	private depth: number;
	private direction: LinkDirection;
	private drawEdges: boolean;
	private remember = true;
	private previewEl!: HTMLDivElement;

	constructor(
		app: App,
		private seeds: Card[],
		private index: CardIndex,
		settings: CardBoxSettings,
		private onSubmit: (opts: CanvasSendOptions) => void,
	) {
		super(app);
		this.depth = settings.canvasLinkDepth;
		this.direction = settings.canvasLinkDirection;
		this.drawEdges = settings.canvasDrawEdges;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-canvas-modal');
		contentEl.createEl('h3', { text: i18n.canvasSendTitle });

		// 引用层级
		new Setting(contentEl)
			.setName(i18n.canvasDepthLabel)
			.setDesc(i18n.canvasDepthDesc)
			.addDropdown((dd) => {
				dd.addOption('0', i18n.canvasDepth0);
				for (let n = 1; n <= MAX_DEPTH; n++) dd.addOption(String(n), i18n.canvasDepthN(n));
				dd.setValue(String(this.depth)).onChange((v) => {
					const n = Number(v);
					this.depth = isFinite(n) ? n : 1;
					this.updatePreview();
				});
			});

		// 引用方向
		new Setting(contentEl)
			.setName(i18n.canvasDirectionLabel)
			.setDesc(i18n.canvasDirectionDesc)
			.addDropdown((dd) => {
				dd.addOption('outgoing', i18n.canvasDirOutgoing);
				dd.addOption('incoming', i18n.canvasDirIncoming);
				dd.addOption('both', i18n.canvasDirBoth);
				dd.setValue(this.direction).onChange((v) => {
					this.direction = v as LinkDirection;
					this.updatePreview();
				});
			});

		// 连线
		new Setting(contentEl)
			.setName(i18n.canvasDrawEdgesLabel)
			.setDesc(i18n.canvasDrawEdgesDesc)
			.addToggle((tg) => tg.setValue(this.drawEdges).onChange((v) => (this.drawEdges = v)));

		// 记住选项
		new Setting(contentEl)
			.setName(i18n.canvasRemember)
			.addToggle((tg) => tg.setValue(this.remember).onChange((v) => (this.remember = v)));

		this.previewEl = contentEl.createDiv({ cls: 'cardbox-canvas-preview' });
		this.updatePreview();

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(i18n.canvasSendButton)
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit({
						depth: this.depth,
						direction: this.direction,
						drawEdges: this.drawEdges,
						remember: this.remember,
					});
				}),
		).addButton((b) => b.setButtonText(i18n.cancel).onClick(() => this.close()));
	}

	/** 实时预估投放数量：直接跑一遍遍历，卡片量级下开销可忽略 */
	private updatePreview(): void {
		const total = countLinkedCards(this.seeds, this.index.graphSource(), this.direction, this.depth);
		this.previewEl.empty();
		this.previewEl.createDiv({ text: i18n.canvasPreview(total) });
		if (total > this.seeds.length) {
			this.previewEl.createDiv({
				cls: 'cardbox-canvas-preview-sub',
				text: i18n.canvasPreviewSeed(this.seeds.length, total),
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
