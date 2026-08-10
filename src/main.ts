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

	/**
	 * onload 只要抛出异常，Obsidian 就会静默回滚启用开关
	 * （表现为「插件列表里有，但开关点不开」，且 Console 可能没有红字）。
	 * 因此这里整体兜底：真出问题时用 Notice + console 明确告知，而不是静默失败。
	 */
	async onload(): Promise<void> {
		try {
			await this.setup();
		} catch (e) {
			console.error('[CardBox] 插件初始化失败', e);
			new Notice('CardBox 初始化失败，请查看控制台（Ctrl+Shift+I）获取详情', 8000);
		}
	}

	private async setup(): Promise<void> {
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

		// 视图与入口先注册：即使后续任何一步出错，插件本体也已可用
		this.registerView(CARD_BOX_VIEW_TYPE, (leaf) => new CardBoxView(leaf, this.ctx));
		this.registerView(CARD_EXTEND_VIEW_TYPE, (leaf) => new CardExtendView(leaf, this.ctx));

		this.addRibbonIcon('boxes', i18n.openMain, () => void this.openCardBoxView());

		this.registerCaptureCommands();

		this.addSettingTab(
			new CardBoxSettingTab(this.app, this, {
				settings: this.settings,
				saveSettings: () => this.saveSettings(),
				onFolderChanged: () => {
					void this.index.build();
				},
			}),
		);

		// 建文件夹与首次索引都推迟到布局就绪：
		// onload 阶段 vault 可能尚未完全可写，在此写文件会导致插件加载失败。
		// onLayoutReady 在个别版本/环境下不可用，因此做能力探测并回退到直接执行。
		const deferred = () => {
			void this.ensureCardsFolder().catch((e) => console.error('[CardBox] 创建卡片文件夹失败', e));
			if (!this.index.ready) void this.index.build().catch((e) => console.error('[CardBox] 索引构建失败', e));
		};
		const ws = this.app.workspace as unknown as { onLayoutReady?: (cb: () => void) => void };
		if (typeof ws.onLayoutReady === 'function') ws.onLayoutReady(deferred);
		else window.setTimeout(deferred, 0);
	}

	onunload(): void {
		// 卸载期异常会导致 Obsidian 报错且残留监听，这里兜底
		try {
			this.index?.detach();
		} catch (e) {
			console.error('[CardBox] 卸载时清理索引失败', e);
		}
	}

	// ---------- 命令 ----------

	private registerCaptureCommands(): void {
		this.addCommand({ id: 'capture', name: i18n.capture, callback: () => this.openCapture() });
		this.addCommand({
			id: 'open-main',
			name: i18n.openMain,
			callback: () => void this.openCardBoxView(),
		});
		this.addCommand({
			id: 'toggle-select',
			name: i18n.toggleSelect,
			checkCallback: (checking) => {
				const view = this.activeView();
				if (!view) return false;
				if (checking) return true;
				view.toggleSelectionMode();
				return true;
			},
		});
		this.addSelectionCommand('merge', i18n.mergeSelected, (view) => view.mergeSelected());
		this.addSelectionCommand('batch-tag', i18n.batchTag, (view) => view.batchTagSelected());
		this.addSelectionCommand('archive-selected', i18n.archiveSelected, (view) => view.archiveSelected());
		this.addSelectionCommand('delete-selected', i18n.deleteSelected, (view) => view.deleteSelected());
		this.addSelectionCommand('send-canvas', i18n.sendToCanvas, (view) => view.sendSelectedToCanvas());

		// 从当前 Canvas 白板反向合并成文
		this.addCommand({
			id: 'merge-from-canvas',
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
		let loaded: Partial<CardBoxSettings> | null = null;
		try {
			loaded = (await this.loadData()) as Partial<CardBoxSettings> | null;
		} catch (e) {
			// data.json 损坏时不能让插件整体加载失败，退回默认设置
			console.error('[CardBox] 读取设置失败，已使用默认设置', e);
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
		// 兼容旧版本数据：boxes 缺失或类型异常时归位
		if (!Array.isArray(this.settings.boxes)) this.settings.boxes = [];
		this.settings.boxes = this.settings.boxes.filter((b): b is CardBoxDef => !!b && typeof b.id === 'string');
		if (typeof this.settings.activeBoxId !== 'string') this.settings.activeBoxId = '';
		// 旧版默认视图值 'card' 仍有效；非法值回落
		if (!['card', 'masonry', 'timeline'].includes(this.settings.defaultViewMode)) {
			this.settings.defaultViewMode = 'card';
		}
		if (!Number.isFinite(this.settings.masonryMinColumnWidth) || this.settings.masonryMinColumnWidth < 160) {
			this.settings.masonryMinColumnWidth = DEFAULT_SETTINGS.masonryMinColumnWidth;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
