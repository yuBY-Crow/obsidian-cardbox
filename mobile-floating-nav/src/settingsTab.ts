import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import {
	createDefaultButton,
	NavActionType,
	NavButtonConfig,
	NavSettings,
} from "./settings";
import {
	CommandSuggestModal,
	IconSuggestModal,
	NoteSuggestModal,
} from "./modals";

const ACTION_LABELS: Record<NavActionType, string> = {
	command: "执行命令",
	note: "打开笔记",
	"new-note": "新建笔记",
	"scroll-top": "返回顶部",
	url: "打开链接",
};

const ACTION_OPTIONS: { value: NavActionType; label: string }[] = [
	{ value: "command", label: "执行命令" },
	{ value: "note", label: "打开笔记" },
	{ value: "new-note", label: "新建笔记" },
	{ value: "scroll-top", label: "返回顶部" },
	{ value: "url", label: "打开链接" },
];

export class NavSettingTab extends PluginSettingTab {
	private plugin: Plugin & { settings: NavSettings; saveSettings(): Promise<void> };

	constructor(
		app: App,
		plugin: Plugin & { settings: NavSettings; saveSettings(): Promise<void> }
	) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("悬浮导航").setHeading().setDesc(
			"在屏幕边缘显示可自定义的悬浮按钮栏,按钮数量与功能可自由编辑。"
		);

		// ---- 总开关 ----
		new Setting(containerEl)
			.setName("启用悬浮导航")
			.setDesc("关闭后按钮栏完全隐藏(可通过命令再次打开)")
			.addToggle((t) =>
				t.setValue(s.enabled).onChange(async (v) => {
					s.enabled = v;
					await this.plugin.saveSettings();
				})
			);

		// ---- 显示平台 ----
		new Setting(containerEl)
			.setName("在移动端显示")
			.addToggle((t) =>
				t.setValue(s.showOnMobile).onChange(async (v) => {
					s.showOnMobile = v;
					await this.plugin.saveSettings();
				})
			);
		new Setting(containerEl)
			.setName("在桌面端显示")
			.setDesc("默认关闭:本插件主要为手机端设计")
			.addToggle((t) =>
				t.setValue(s.showOnDesktop).onChange(async (v) => {
					s.showOnDesktop = v;
					await this.plugin.saveSettings();
				})
			);

		// ---- 外观 ----
		new Setting(containerEl).setName("外观").setHeading();

		new Setting(containerEl)
			.setName("悬浮位置")
			.addDropdown((d) =>
				d
					.addOption("left", "左侧")
					.addOption("right", "右侧")
					.setValue(s.position)
					.onChange(async (v: "left" | "right") => {
						s.position = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("按钮大小")
			.setDesc(`${s.buttonSize} px`)
			.addSlider((sl) =>
				sl
					.setLimits(32, 72, 2)
					.setValue(s.buttonSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.buttonSize = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("按钮间距")
			.setDesc(`${s.gap} px`)
			.addSlider((sl) =>
				sl
					.setLimits(2, 24, 1)
					.setValue(s.gap)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.gap = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("背景不透明度")
			.setDesc(`${Math.round(s.opacity * 100)}%`)
			.addSlider((sl) =>
				sl
					.setLimits(5, 100, 5)
					.setValue(Math.round(s.opacity * 100))
					.onChange(async (v) => {
						s.opacity = v / 100;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("距屏幕边缘距离")
			.setDesc(`${s.edgeOffset} px`)
			.addSlider((sl) =>
				sl
					.setLimits(4, 24, 1)
					.setValue(s.edgeOffset)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.edgeOffset = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("显示折叠按钮")
			.setDesc("在按钮栏底部显示收起/展开按钮")
			.addToggle((t) =>
				t.setValue(s.showCollapse).onChange(async (v) => {
					s.showCollapse = v;
					await this.plugin.saveSettings();
				})
			);

		// ---- 按钮管理 ----
		new Setting(containerEl).setName("导航按钮").setHeading().setDesc(
			`当前共 ${s.buttons.length} 个按钮,点击「添加按钮」可自由增加数量,支持上移/下移调整顺序。`
		);

		if (s.buttons.length > 0) {
			s.buttons.forEach((btn, index) => {
				this.renderButtonCard(containerEl, btn, index, s);
			});
		} else {
			containerEl.createDiv({
				cls: "mfn-empty-hint",
				text: "还没有按钮,点击下方「添加按钮」开始。",
			});
		}

		new Setting(containerEl)
			.addDropdown((d) => {
				for (const opt of ACTION_OPTIONS) {
					d.addOption(opt.value, opt.label);
				}
				d.setValue("command");
				d.selectEl.id = "mfn-new-btn-action";
			})
			.addButton((b) =>
				b
					.setButtonText("添加按钮")
					.setCta()
					.onClick(async () => {
						const select = containerEl.querySelector<HTMLSelectElement>(
							"#mfn-new-btn-action"
						);
						const type = (select?.value ?? "command") as NavActionType;
						s.buttons.push(createDefaultButton(type));
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl).setName("更多").setHeading();
		new Setting(containerEl)
			.setName("长按工具栏打开设置")
			.setDesc("移动端长按悬浮栏空白处(桌面端右键)可直接打开本设置页。");
	}

	private renderButtonCard(
		containerEl: HTMLElement,
		btn: NavButtonConfig,
		index: number,
		s: NavSettings
	) {
		const card = containerEl.createDiv({ cls: "mfn-btn-card" });
		const app = this.app;
		const save = async () => {
			await this.plugin.saveSettings();
		};
		const rebuild = async () => {
			await this.plugin.saveSettings();
			this.display();
		};

		// 名称
		new Setting(card).setName("名称").addText((t) => {
			t.setValue(btn.label || "")
				.setPlaceholder("按钮名称")
				.onChange(async (v) => {
					btn.label = v.trim() || btn.icon;
					await save();
				});
		});

		// 图标 + 颜色
		const iconSetting = new Setting(card)
			.setName("图标")
			.setDesc(btn.icon)
			.addButton((b) => {
				b.setButtonText("选择图标").onClick(() => {
					new IconSuggestModal(
						app,
						async (name) => {
							btn.icon = name;
							await rebuild();
						},
						btn.icon
					).open();
				});
			});
		// 当前图标预览
		const preview = iconSetting.controlEl.createSpan({ cls: "mfn-icon-preview" });
		setIcon(preview, btn.icon || "circle-dot");

		new Setting(card).setName("图标颜色").addText((t) => {
			t.setValue(btn.color || "")
				.setPlaceholder("留空跟随主题,如 #e03131")
				.onChange(async (v) => {
					btn.color = v.trim() || undefined;
					await save();
				});
		});

		// 动作类型
		new Setting(card).setName("动作类型").addDropdown((d) => {
			for (const opt of ACTION_OPTIONS) {
				d.addOption(opt.value, opt.label);
			}
			d.setValue(btn.action).onChange(async (v: NavActionType) => {
				btn.action = v;
				await rebuild();
			});
		});

		// 动作参数
		this.renderActionParam(card, btn, save, rebuild);

		// 排序与删除
		const ops = new Setting(card).setName("操作").addExtraButton((b) => {
			b.setIcon("chevron-up")
				.setTooltip("上移")
				.setDisabled(index === 0)
				.onClick(async () => {
					if (index <= 0) return;
					[s.buttons[index - 1], s.buttons[index]] = [
						s.buttons[index],
						s.buttons[index - 1],
					];
					await rebuild();
				});
		});
		ops.addExtraButton((b) => {
			b.setIcon("chevron-down")
				.setTooltip("下移")
				.setDisabled(index >= s.buttons.length - 1)
				.onClick(async () => {
					if (index >= s.buttons.length - 1) return;
					[s.buttons[index + 1], s.buttons[index]] = [
						s.buttons[index],
						s.buttons[index + 1],
					];
					await rebuild();
				});
		});
		ops.addExtraButton((b) => {
			b.setIcon("trash")
				.setTooltip("删除")
				.onClick(async () => {
					s.buttons.splice(index, 1);
					await rebuild();
				});
		});
	}

	private renderActionParam(
		card: HTMLElement,
		btn: NavButtonConfig,
		save: () => Promise<void>,
		rebuild: () => Promise<void>
	) {
		const app = this.app;
		switch (btn.action) {
			case "command": {
				const all: { id: string; name?: string }[] = (
					app as unknown as { commands: { listCommands(): { id: string; name?: string }[] } }
				).commands.listCommands();
				const cmd = all.find((c) => c.id === btn.commandId);
				new Setting(card)
					.setName("执行的命令")
					.setDesc(cmd ? `${cmd.name}` : btn.commandId || "尚未选择命令")
					.addButton((b) =>
						b.setButtonText(cmd ? "更换命令" : "选择命令").onClick(() => {
							new CommandSuggestModal(
								app,
								async (c) => {
									btn.commandId = c.id;
									await rebuild();
								},
								btn.commandId ?? ""
							).open();
						})
					);
				break;
			}
			case "note": {
				new Setting(card)
					.setName("打开的笔记")
					.setDesc(btn.notePath || "尚未选择笔记")
					.addButton((b) =>
						b
							.setButtonText(btn.notePath ? "更换笔记" : "选择笔记")
							.onClick(() => {
								new NoteSuggestModal(
									app,
									async (path) => {
										btn.notePath = path;
										await rebuild();
									},
									btn.notePath ?? ""
								).open();
							})
					);
				break;
			}
			case "url": {
				new Setting(card).setName("链接地址").addText((t) => {
					t.setValue(btn.url || "")
						.setPlaceholder("https://…")
						.onChange(async (v) => {
							btn.url = v.trim();
							await save();
						});
				});
				break;
			}
			default:
				// new-note / scroll-top 无需参数
				break;
		}
	}
}
