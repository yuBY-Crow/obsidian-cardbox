import type { TFile } from 'obsidian';
import type { Card, CardBoxDef, CardBoxSettings } from './types';
import type { CardIndex } from './index';
import type { CardService } from './frontmatter';

/** 视图 / 模态框与主模块之间的依赖注入接口（避免循环依赖） */
export interface CardBoxContext {
	settings: CardBoxSettings;
	index: CardIndex;
	service: CardService;
	openFile(file: TFile): Promise<void>;
	openCapture(prefill?: string, parent?: Card): void;
	saveSettings(): Promise<void>;
	/** 打开卡片扩展同屏视图，聚焦到指定主卡片 */
	openExtendView(rootId: string): Promise<void>;
	/**
	 * 将卡片投放为 Obsidian Canvas 白板节点。
	 * 默认弹出选项弹窗让用户选引用层级与方向；
	 * silent 为 true 时按已保存的默认值直接投放（用于命令面板等无交互场景）。
	 */
	sendToCanvas(cards: Card[], silent?: boolean): Promise<void>;
	/**
	 * 用卡片标题（或正文首行）重命名文件。
	 * 走 fileManager.renameFile，所有指向它的 [[链接]] 由 Obsidian 自动更新。
	 */
	renameByTitle(cards: Card[]): Promise<void>;
	/** 卡片盒定义的增删改查（持久化在插件 data.json） */
	boxes: {
		list(): CardBoxDef[];
		get(id: string): CardBoxDef | undefined;
		upsert(def: CardBoxDef): Promise<void>;
		remove(id: string): Promise<void>;
		activeId(): string;
		setActiveId(id: string): Promise<void>;
	};
}
