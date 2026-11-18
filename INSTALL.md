# 安装 Slipbox（0.6.53）

Slipbox 是一个 Obsidian 插件，插件 id 为 `cardbox-mobile`。本文适用于 **0.6.53**。

## 一句话原理

插件装在**笔记库（vault）内部**，不是装进 Obsidian 程序目录：

```
<vault>/
└── .obsidian/
    └── plugins/
        └── cardbox-mobile/     ← 目录名必须等于 manifest.json 里的 id
            ├── main.js
            ├── manifest.json
            └── styles.css
```

只要手机和电脑同步的是同一个 vault，`.obsidian/plugins/` 会一起同步，手机端无需单独安装。

## 第 1 步：下载三个文件

打开本仓库的 **GitHub Releases**，找到 `0.6.53` 版本，在 Assets 里逐个下载这三个文件：

- `main.js`
- `manifest.json`
- `styles.css`

## 第 2 步：放到正确目录

1. 在 Obsidian 里确认 vault 位置：**设置 → 关于 → 仓库路径**（或右键任意笔记「在系统资源管理器中显示」）
2. 进入 `<vault>/.obsidian/plugins/`；没有 `plugins` 文件夹就新建一个（**名字全小写**）
3. 新建文件夹 **`cardbox-mobile`**，把三个文件**直接**放进去
4. 最终路径必须是：

```
<vault>/.obsidian/plugins/cardbox-mobile/main.js
<vault>/.obsidian/plugins/cardbox-mobile/manifest.json
<vault>/.obsidian/plugins/cardbox-mobile/styles.css
```

> ⚠️ **目录名必须等于 `manifest.json` 的 `id`（`cardbox-mobile`）**，且 `main.js` 必须直接在该目录下，不能再多套一层文件夹。
> 错误示例：`<vault>/.obsidian/plugins/cardbox-mobile/cardbox-mobile/main.js`
> 常见原因：解压时把外层文件夹一起带进来了。

## 第 3 步：在 Obsidian 里启用

1. **设置 → 第三方插件**
2. 关闭「**限制模式 / 安全模式**」（否则所有第三方插件都不加载）
3. 点击列表旁的**刷新**按钮
4. 找到「**Slipbox**」，打开开关；弹出信任提示时选择信任
5. 若刚放完文件看不到插件，**完全退出 Obsidian 再重开**（从后台任务划掉，不只是回桌面）

## 第 4 步：移动端

移动端不需要单独安装插件：

1. 用 Obsidian Sync / iCloud / Syncthing / 手动复制，把**同一个 vault** 同步到手机
2. 确认 `<vault>/.obsidian/plugins/cardbox-mobile/` 也同步到了手机（同步工具的过滤规则不要排除隐藏文件 `.obsidian`）
3. 在手机 Obsidian：**设置 → 第三方插件 → 启用 Slipbox**（同样先关闭限制模式）
4. 入口在侧栏 ribbon 图标与命令面板；建议在「设置 → 移动端 → 管理工具栏选项」把「**快速记录卡片**」加入快捷栏

> Obsidian 移动端底部编辑器工具栏没有稳定的插件 API，因此入口是 ribbon + 命令面板/快捷键。

## 常见问题

**插件列表里找不到 Slipbox**
→ 99% 是路径问题：确认目录名是 `cardbox-mobile`、三个文件**直接**在里面、没有多套一层，然后点刷新按钮；仍不行就完全退出 Obsidian 再重开。

**开关打不开 / 提示插件加载失败**
→ 关闭「限制模式」；确认 `main.js`、`manifest.json`、`styles.css` 三个文件齐全且版本一致。

**之前用的是旧版 `cardbox` 目录，卡片盒配置会不会丢？**
→ 会。旧版插件目录是 `<vault>/.obsidian/plugins/cardbox/`，卡片盒定义存在它自己的 `data.json` 里。新 id 换了目录，Obsidian **不会自动迁移**。升级前请：

1. 备份旧目录 `<vault>/.obsidian/plugins/cardbox/data.json`
2. 装好新版并启用一次（会生成新的 `cardbox-mobile/data.json`）
3. 手动把备份里的卡片盒配置合并过去，或按需重建

卡片笔记本身是普通 Markdown 文件，放在 vault 里（默认 `Cards/`），不受插件目录改名影响，不会丢失。

**手机上启用了但界面错乱 / 没有样式**
→ `styles.css` 没同步过去。三个文件必须齐全，同步工具不要排除隐藏文件。

**更新到新版本**
→ 从新 Release 下载三个文件，覆盖 `cardbox-mobile/` 里的同名文件，重启 Obsidian，或在第三方插件列表把开关关掉再打开。

## 验证安装成功

启用后应该能看到：

- 左侧 ribbon 出现**方块堆叠图标**
- 点开后顶部有**卡片盒切换栏**（「全部卡片」+ 一个 `＋` 按钮）
- 下面是**列表 / 平铺 / 时间线**三个模式按钮
- 有一排**彩色圆点**（颜色筛选）
- 设置里出现 **Slipbox** 设置面板
