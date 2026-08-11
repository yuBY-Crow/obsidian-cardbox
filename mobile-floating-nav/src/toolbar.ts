import {
	App,
	MarkdownView,
	Notice,
	Platform,
	TFile,
	setIcon,
} from "obsidian";
import { NavButtonConfig, NavSettings } from "./settings";

/** 工具栏宿主:由主插件实现,避免循环依赖 */
export interface ToolbarHost {
	app: App;
	settings: NavSettings;
	saveSettings(): Promise<void>;
}

/**
 * 悬浮按钮栏:负责渲染 DOM 与执行按钮动作。
 * 通过 CSS 变量控制外观,设置变化时调用 refresh() 重建。
 */
export class NavToolbar {
	private containerEl: HTMLElement;
	private pressTimer: number | null = null;

	constructor(
		private host: ToolbarHost,
		private onSettingsOpen?: () => void
	) {}

	/** 挂载工具栏到 body,并注册设置入口按钮 */
	mount() {
		this.containerEl = document.body.createDiv({ cls: "mfn-toolbar" });
		// 长按工具栏空白区域 → 打开设置(移动端无右键)
		this.containerEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.onSettingsOpen?.();
		});
		this.containerEl.addEventListener("pointerdown", (e) => {
			const t = e.target as HTMLElement;
			if (t.closest(".mfn-btn")) return; // 按钮点击交给按钮处理
			if (t.closest(".mfn-collapse")) return;
			this.pressTimer = window.setTimeout(() => {
				this.onSettingsOpen?.();
			}, 600);
		});
		this.containerEl.addEventListener("pointerup", () => {
			if (this.pressTimer) {
				window.clearTimeout(this.pressTimer);
				this.pressTimer = null;
			}
		});
		this.containerEl.addEventListener("pointerleave", () => {
			if (this.pressTimer) {
				window.clearTimeout(this.pressTimer);
				this.pressTimer = null;
			}
		});
		this.refresh();
	}

	/** 设置发生变化时调用,重新渲染 */
	refresh() {
		if (!this.containerEl || !this.containerEl.isConnected) return;
		const s = this.host.settings;
		this.containerEl.empty();
		this.containerEl.removeAttribute("class");
		this.containerEl.addClass("mfn-toolbar");
		this.containerEl.addClass(s.position === "left" ? "mfn-left" : "mfn-right");
		if (s.collapsed) this.containerEl.addClass("mfn-collapsed");

		this.containerEl.style.setProperty("--mfn-size", s.buttonSize + "px");
		this.containerEl.style.setProperty("--mfn-gap", s.gap + "px");
		this.containerEl.style.setProperty("--mfn-opacity", String(s.opacity));
		this.containerEl.style.setProperty("--mfn-offset", s.edgeOffset + "px");

		if (s.collapsed) {
			// 折叠态:仅保留展开按钮
			const expand = this.containerEl.createEl("button", {
				cls: "mfn-btn mfn-expand",
				attr: { "aria-label": "展开导航" },
			});
			expand.addEventListener("click", (e) => {
				e.stopPropagation();
				s.collapsed = false;
				this.host.saveSettings();
			});
			setIcon(expand, "chevron-up");
			return;
		}

		for (const btn of s.buttons) {
			this.renderButton(btn);
		}

		if (s.showCollapse && s.buttons.length > 0) {
			const collapse = this.containerEl.createEl("button", {
				cls: "mfn-btn mfn-collapse",
				attr: { "aria-label": "收起导航" },
			});
			collapse.addEventListener("click", (e) => {
				e.stopPropagation();
				s.collapsed = true;
				this.host.saveSettings();
			});
			setIcon(collapse, "chevron-down");
		}
	}

	private renderButton(btn: NavButtonConfig) {
		const el = this.containerEl.createEl("button", {
			cls: "mfn-btn",
			attr: { "aria-label": btn.label || btn.icon },
		});
		if (btn.color) {
			el.style.setProperty("--mfn-btn-color", btn.color);
		}
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.runAction(btn);
		});
		setIcon(el, btn.icon || "circle-dot");
	}

	/** 执行按钮动作 */
	async runAction(btn: NavButtonConfig) {
		const app = this.host.app;
		try {
			switch (btn.action) {
				case "command":
					if (!btn.commandId) {
						new Notice("该按钮尚未配置命令,请在设置中配置");
						return;
					}
					// app.commands 在运行时始终存在
					const commands = (
						app as unknown as {
							commands: { listCommands(): { id: string }[]; executeCommandById(id: string): void };
						}
					).commands;
					// 校验命令是否存在
					const exists = commands.listCommands().some((c) => c.id === btn.commandId);
					if (!exists) {
						new Notice(`命令不存在:${btn.commandId}`);
						return;
					}
					commands.executeCommandById(btn.commandId);
					break;

				case "note":
					if (!btn.notePath) {
						new Notice("该按钮尚未选择笔记,请在设置中配置");
						return;
					}
					await this.openNote(btn.notePath);
					break;

				case "new-note":
					await this.createNote();
					break;

				case "scroll-top":
					this.scrollToTop();
					break;

				case "url":
					if (!btn.url) {
						new Notice("该按钮尚未填写链接,请在设置中配置");
						return;
					}
					window.open(btn.url, "_blank");
					break;
			}
		} catch (err) {
			console.error("[Mobile Floating Nav] 动作执行失败:", err);
			new Notice("动作执行失败,请查看控制台日志");
		}
	}

	private async openNote(path: string) {
		const app = this.host.app;
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} else {
			new Notice(`笔记不存在:${path}`);
		}
	}

	private async createNote() {
		const app = this.host.app;
		const folder = app.fileManager.getNewFileParent("");
		let name = `未命名笔记`;
		let path = `${folder.path}/${name}.md`;
		let i = 2;
		while (app.vault.getAbstractFileByPath(path)) {
			path = `${folder.path}/${name} ${i}.md`;
			i++;
		}
		const file = await app.vault.create(path, "");
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file);
		new Notice(`已创建:${file.path}`);
	}

	private scrollToTop() {
		const app = this.host.app;
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			view.editor.scrollTo(0, 0);
			return;
		}
		// 非 Markdown 视图(白板、PDF 等):滚动叶子容器
		const leaf = app.workspace.getMostRecentLeaf();
		if (leaf) {
			const el = leaf.view?.containerEl;
			if (el) el.scrollTo({ top: 0, behavior: "smooth" });
		}
	}

	/** 是否应显示(依据平台设置) */
	shouldShow(): boolean {
		const s = this.host.settings;
		if (!s.enabled) return false;
		if (Platform.isMobile) return s.showOnMobile;
		return s.showOnDesktop;
	}

	/** 根据设置决定显示或隐藏(仍保留 DOM,减少重建) */
	updateVisibility() {
		if (!this.containerEl) return;
		if (this.shouldShow()) {
			this.containerEl.show();
		} else {
			this.containerEl.hide();
		}
	}

	unmount() {
		this.containerEl?.remove();
	}
}
