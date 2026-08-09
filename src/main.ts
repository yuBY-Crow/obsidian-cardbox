import { Notice, Plugin, TFile } from 'obsidian';
import { CardBoxSettingTab, DEFAULT_SETTINGS } from './settings';
import type { Card, CardBoxSettings } from './types';
import { CardService } from './frontmatter';
import { CardIndex } from './index';
import { CardBoxView, CARD_BOX_VIEW_TYPE } from './view/CardBoxView';
import { CaptureModal } from './modals/CaptureModal';
import type { CardBoxContext } from './context';
import { i18n } from './i18n';

export default class CardBoxPlugin extends Plugin {
	settings: CardBoxSettings = DEFAULT_SETTINGS;
	service!: CardService;
	index!: CardIndex;
	private ctx!: CardBoxContext;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.service = new CardService(this.app, () => this.settings.cardsFolder);
		this.index = new CardIndex(this.app, this.service, () => this.settings.cardsFolder);
		this.index.attach();

		this.ctx = {
			settings: this.settings,
			index: this.index,
			service: this.service,
			openFile: (file) => this.openFile(file),
			openCapture: (prefill, parent) => this.openCapture(prefill, parent),
			saveSettings: () => this.saveSettings(),
		};

		await this.ensureCardsFolder();

		this.registerView(CARD_BOX_VIEW_TYPE, (leaf) => new CardBoxView(leaf, this.ctx));

		this.addRibbonIcon('boxes', i18n.openMain, () => void this.openCardBoxView());

		this.registerCaptureCommands();

		this.addSettingTab(
			new CardBoxSettingTab(this.app, {
				settings: this.settings,
				saveSettings: () => this.saveSettings(),
				onFolderChanged: () => {
					void this.index.build();
				},
			}),
		);

		// 初始索引（metadataCache 'ready' 事件也会触发一次重建）
		if (!this.index.ready) void this.index.build();
	}

	onunload(): void {
		this.index.detach();
	}

	// ---------- 命令 ----------

	private registerCaptureCommands(): void {
		this.addCommand({ id: 'cardbox:capture', name: i18n.capture, callback: () => this.openCapture() });
		this.addCommand({
			id: 'cardbox:open-main',
			name: i18n.openMain,
			callback: () => void this.openCardBoxView(),
		});
		this.addCommand({
			id: 'cardbox:toggle-select',
			name: i18n.toggleSelect,
			checkCallback: (checking) => {
				const view = this.activeView();
				if (!view) return false;
				if (checking) return true;
				view.toggleSelectionMode();
				return true;
			},
		});
		this.addSelectionCommand('cardbox:merge', i18n.mergeSelected, (view) => view.mergeSelected());
		this.addSelectionCommand('cardbox:batch-tag', i18n.batchTag, (view) => view.batchTagSelected());
		this.addSelectionCommand('cardbox:archive-selected', i18n.archiveSelected, (view) => view.archiveSelected());
		this.addSelectionCommand('cardbox:delete-selected', i18n.deleteSelected, (view) => view.deleteSelected());
	}

	private addSelectionCommand(id: string, name: string, run: (view: CardBoxView) => void): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.activeView();
				if (!view) return false;
				if (view.getSelectedCards().length === 0) return false;
				if (checking) return true;
				run(view);
				return true;
			},
		});
	}

	private activeView(): CardBoxView | null {
		const leaves = this.app.workspace.getLeavesOfType(CARD_BOX_VIEW_TYPE);
		if (!leaves.length) return null;
		const view = leaves[0].view;
		return view instanceof CardBoxView ? view : null;
	}

	// ---------- 打开动作 ----------

	async openCardBoxView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(CARD_BOX_VIEW_TYPE);
		if (leaves.length) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: CARD_BOX_VIEW_TYPE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	async openFile(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}

	openCapture(prefill = '', parent?: Card): void {
		new CaptureModal(this.app, this.ctx, { prefill, parent }).open();
	}

	private async ensureCardsFolder(): Promise<void> {
		const folder = this.settings.cardsFolder.trim().replace(/^\/+|\/+$/g, '');
		if (!folder) return;
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			try {
				await this.app.vault.createFolder(folder);
				new Notice(i18n.noticeFolderCreated(folder));
			} catch {
				/* 文件夹可能已存在 */
			}
		}
	}

	// ---------- 设置 ----------

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
