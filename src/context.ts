import type { TFile } from 'obsidian';
import type { Card, CardBoxSettings } from './types';
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
}
