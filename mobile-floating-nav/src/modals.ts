import {
	App,
	Command,
	FuzzyMatch,
	FuzzySuggestModal,
	Modal,
	SuggestModal,
	TFile,
	setIcon,
} from "obsidian";
import { filterIcons, ICON_LIBRARY, IconEntry, isLikelyIconName } from "./icons";

/**
 * 图标选择弹窗:网格展示内置常用图标,支持按名称/中文标签搜索,
 * 也允许输入任意 lucide 图标名后回车确认。
 */
export class IconSuggestModal extends SuggestModal<IconEntry | string> {
	private items: (IconEntry | string)[];

	constructor(
		app: App,
		private onChoose: (iconName: string) => void,
		private currentIcon: string
	) {
		super(app);
		this.setPlaceholder("搜索图标,或直接输入任意 lucide 图标名后回车…");
		this.items = ICON_LIBRARY;
		this.limit = 20;
		this.inputEl.value = currentIcon || "";
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const v = this.inputEl.value.trim();
				if (v && isLikelyIconName(v)) {
					e.preventDefault();
					e.stopPropagation();
					this.close();
					this.onChoose(v);
				}
			}
		});
	}

	getSuggestions(query: string): (IconEntry | string)[] {
		const q = (query || "").trim().toLowerCase();
		if (!q) return ICON_LIBRARY.slice(0, this.limit);
		const filtered = filterIcons(q, this.limit - 1);
		// 若输入内容本身是一个合法的图标名,追加为候选项
		if (isLikelyIconName(q) && !filtered.some((i) => i.name === q)) {
			return [...filtered, q];
		}
		return filtered;
	}

	renderSuggestion(item: IconEntry | string, el: HTMLElement) {
		const name = typeof item === "string" ? item : item.name;
		const label = typeof item === "string" ? "直接使用该图标名" : item.label;
		const row = el.createDiv({ cls: "mfn-icon-option" });
		const iconBox = row.createDiv({ cls: "mfn-icon-option-icon" });
		setIcon(iconBox, name);
		const text = row.createDiv({ cls: "mfn-icon-option-text" });
		text.createDiv({ cls: "mfn-icon-option-name" }).setText(name);
		text.createDiv({ cls: "mfn-icon-option-label" }).setText(label);
	}

	onChooseSuggestion(item: IconEntry | string, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(typeof item === "string" ? item : item.name);
	}
}

/**
 * 命令选择弹窗:列出插件当前可执行的全部命令。
 */
export class CommandSuggestModal extends SuggestModal<Command> {
	constructor(
		app: App,
		private onChoose: (command: Command) => void,
		private currentId: string
	) {
		super(app);
		this.setPlaceholder("搜索要执行的命令…");
		this.limit = 30;
	}

	getSuggestions(query: string): Command[] {
		const q = (query || "").trim().toLowerCase();
		// app.commands 在运行时始终存在,新版本类型定义中未公开声明
		const all: Command[] = (this.app as unknown as { commands: { listCommands(): Command[] } })
			.commands.listCommands();
		if (!q) return all.slice(0, this.limit);
		return all
			.filter((c) => {
				const name = c.name?.toLowerCase() ?? "";
				const id = c.id.toLowerCase();
				return name.includes(q) || id.includes(q);
			})
			.slice(0, this.limit);
	}

	renderSuggestion(cmd: Command, el: HTMLElement) {
		el.createDiv({ cls: "mfn-suggest-name" }).setText(cmd.name ?? cmd.id);
		el.createDiv({ cls: "mfn-suggest-id" }).setText(cmd.id);
	}

	onChooseSuggestion(cmd: Command, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(cmd);
	}
}

/**
 * 笔记选择弹窗:模糊搜索仓库内的 Markdown 笔记。
 */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private onChoose: (path: string) => void,
		private currentPath: string
	) {
		super(app);
		this.setPlaceholder("搜索要打开的笔记…");
		this.limit = 30;
	}

	getItems(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	renderSuggestion(item: FuzzyMatch<TFile>, el: HTMLElement) {
		const file = item.item;
		el.createDiv({ cls: "mfn-suggest-name" }).setText(file.basename);
		el.createDiv({ cls: "mfn-suggest-id" }).setText(file.path);
	}

	onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(item.path);
	}
}

/** 让用户为按钮输入名称的轻量弹窗 */
export function promptForLabel(app: App, current: string): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new LabelModal(app, current, resolve);
		modal.open();
	});
}

class LabelModal extends Modal {
	private input: HTMLInputElement;

	constructor(
		app: App,
		private current: string,
		private done: (value: string | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mfn-label-modal");
		contentEl.createEl("h3", { text: "按钮名称" });
		this.input = contentEl.createEl("input", { type: "text" });
		this.input.value = this.current || "";
		this.input.placeholder = "例如:返回顶部";
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.confirm();
			}
		});
		const btns = contentEl.createDiv({ cls: "mfn-label-modal-buttons" });
		const ok = btns.createEl("button", { text: "确定", cls: "mod-cta" });
		ok.addEventListener("click", () => this.confirm());
		const cancel = btns.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => this.cancel());
		setTimeout(() => this.input.focus(), 50);
	}

	private confirm() {
		const v = this.input.value.trim();
		this.close();
		this.done(v || null);
	}

	private cancel() {
		this.close();
		this.done(null);
	}

	onClose() {
		this.contentEl.empty();
	}
}
