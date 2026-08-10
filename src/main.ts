import { Notice, Plugin, TFile } from 'obsidian';
import { CardBoxSettingTab, DEFAULT_SETTINGS } from './settings';
import type { Card, CardBoxDef, CardBoxSettings } from './types';
import { CardService } from './frontmatter';
import { CardIndex } from './index';
import { CardBoxView, CARD_BOX_VIEW_TYPE } from './view/CardBoxView';
import { CardExtendView, CARD_EXTEND_VIEW_TYPE } from './view/CardExtendView';
import { CaptureModal } from './modals/CaptureModal';
import { MergeModal } from './modals/MergeModal';
import type { CardBoxContext } from './context';
import { readCanvasCardPaths, sendCardsToCanvas } from './utils/canvas';
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
			openExtendView: (rootId) => this.openExtendView(rootId),
			sendToCanvas: (cards) => this.sendToCanvas(cards),
			boxes: {
				list: () => this.settings.boxes,
				get: (id) => this.settings.boxes.find((b) => b.id === id),
				upsert: async (def) => {
					const i = this.settings.boxes.findIndex((b) => b.id === def.id);
					if (i >= 0) this.settings.boxes[i] = def;
					else this.settings.boxes.push(def);
					await this.saveSettings();
					new Notice(i18n.boxSaved(def.name), 1500);
				},
				remove: async (id) => {
					const def = this.settings.boxes.find((b) => b.id === id);
					this.settings.boxes = this.settings.boxes.filter((b) => b.id !== id);
					if (this.settings.activeBoxId === id) this.settings.activeBoxId = '';
					await this.saveSettings();
					if (def) new Notice(i18n.boxDeleted(def.name), 1500);
				},
				activeId: () => this.settings.activeBoxId,
				setActiveId: async (id) => {
					this.settings.activeBoxId = id;
					await this.saveSettings();
				},
			},
		};

		await this.ensureCardsFolder();

		this.registerView(CARD_BOX_VIEW_TYPE, (leaf) => new CardBoxView(leaf, this.ctx));
		this.registerView(CARD_EXTEND_VIEW_TYPE, (leaf) => new CardExtendView(leaf, this.ctx));

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
		this.addSelectionCommand('cardbox:send-canvas', i18n.sendToCanvas, (view) => view.sendSelectedToCanvas());

		// 从当前 Canvas 白板反向合并成文
		this.addCommand({
			id: 'cardbox:merge-from-canvas',
			name: i18n.canvasMergeFromCanvas,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const isCanvas = file?.extension === 'canvas';
				if (!isCanvas) return false;
				if (checking) return true;
				void this.mergeFromCanvas(file as TFile);
				return true;
			},
		});
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

	/** 打开卡片扩展同屏视图（复用已存在的扩展视图，只切换主卡片） */
	async openExtendView(rootId: string): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(CARD_EXTEND_VIEW_TYPE);
		if (leaves.length) {
			const view = leaves[0].view;
			if (view instanceof CardExtendView) view.setRoot(rootId);
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: CARD_EXTEND_VIEW_TYPE, active: true, state: { rootId } });
		this.app.workspace.revealLeaf(leaf);
	}

	async openFile(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}

	openCapture(prefill = '', parent?: Card): void {
		new CaptureModal(this.app, this.ctx, { prefill, parent }).open();
	}

	// ---------- Canvas ----------

	private async sendToCanvas(cards: Card[]): Promise<void> {
		const active = this.app.workspace.getActiveFile();
		const activeCanvas = active?.extension === 'canvas' ? active : undefined;
		const file = await sendCardsToCanvas(this.app, cards, {
			folder: this.settings.canvasOutputFolder,
			activeCanvas,
			ensureFolder: (folder) => this.service.ensureFolder(folder),
		});
		if (file && !activeCanvas) await this.openFile(file);
	}

	private async mergeFromCanvas(file: TFile): Promise<void> {
		const paths = await readCanvasCardPaths(this.app, file);
		const cards: Card[] = [];
		const seen = new Set<string>();
		for (const p of paths) {
			const card = this.index.byPath(p);
			if (card && !seen.has(card.id)) {
				seen.add(card.id);
				cards.push(card);
			}
		}
		if (!cards.length) {
			new Notice(i18n.canvasNoCardNodes);
			return;
		}
		new MergeModal(this.app, this.ctx, cards).open();
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
		const loaded = (await this.loadData()) as Partial<CardBoxSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
		// 兼容旧版本数据：boxes 缺失或类型异常时归位
		if (!Array.isArray(this.settings.boxes)) this.settings.boxes = [];
		this.settings.boxes = this.settings.boxes.filter((b): b is CardBoxDef => !!b && typeof b.id === 'string');
		if (typeof this.settings.activeBoxId !== 'string') this.settings.activeBoxId = '';
		// 旧版默认视图值 'card' 仍有效；非法值回落
		if (!['card', 'masonry', 'timeline'].includes(this.settings.defaultViewMode)) {
			this.settings.defaultViewMode = 'card';
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
