import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, NavSettings } from "./settings";
import { NavToolbar } from "./toolbar";
import { NavSettingTab } from "./settingsTab";

export default class MobileFloatingNavPlugin extends Plugin {
	settings: NavSettings;
	private toolbar: NavToolbar;

	async onload() {
		await this.loadSettings();

		this.toolbar = new NavToolbar(this, () => this.openSettings());
		this.toolbar.mount();
		this.toolbar.updateVisibility();

		this.addSettingTab(new NavSettingTab(this.app, this));

		// 布局变化(打开/关闭面板、切换工作区等)后校正可见性
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.toolbar.updateVisibility();
			})
		);
		// 主题切换时刷新样式
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				this.toolbar.refresh();
			})
		);

		this.addCommand({
			id: "toggle-nav",
			name: "显示/隐藏悬浮导航",
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				new Notice(
					this.settings.enabled ? "悬浮导航已显示" : "悬浮导航已隐藏"
				);
			},
		});

		this.addCommand({
			id: "toggle-collapse",
			name: "收起/展开悬浮导航",
			callback: async () => {
				this.settings.collapsed = !this.settings.collapsed;
				await this.saveSettings();
			},
		});
	}

	onunload() {
		this.toolbar?.unmount();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.toolbar?.refresh();
		this.toolbar?.updateVisibility();
	}

	/** 打开本插件设置页 */
	private openSettings() {
		const setting = (this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		}).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.manifest.id);
	}
}
