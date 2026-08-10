# CardBox 安装指南

插件版本 **0.2.0**｜ 打包文件：`release/cardbox-0.2.0.zip`

---

## 核心概念：插件装在 vault 里，不是装在 Obsidian 里

Obsidian 的插件不是装进程序目录，而是放在**你的笔记库（vault）内部**的隐藏文件夹里：

```
<你的 vault>/
├── Cards/                ← 你的卡片笔记
└── .obsidian/                          ← 隐藏文件夹
    ├── community-plugins.json          ← 记录哪些插件被启用
    └── plugins/
        └── cardbox/
            ├── main.js                ← 必须这三个文件
            ├── manifest.json
            └── styles.css
```

**这就是为什么手机端不用单独安装**：只要手机和电脑同步的是同一个 vault，`.obsidian/plugins/` 也会被一起同步过去，插件自然就有了。

> ⚠️ 最常见的失败原因：解压时多套了一层文件夹。
> 错误：`plugins/cardbox/cardbox/main.js`
> 正确：`plugins/cardbox/main.js`

---

## 第 0 步：先用测试 vault 验收（推荐）

仓库里的 `test-vault/` 已经预置好插件和 424 张测试卡片（含颜色、置顶、扩展关系），**插件也已预先启用**，打开即用：

1. 打开 Obsidian → 左下角或启动界面选择「**打开本地仓库**」
2. 选择文件夹：`E:\AgentTest\OBSidianCardBox\test-vault`
3. 首次打开会弹出安全提示，选择「**信任作者并启用插件**」
4. 点击左侧边栏的**卡片盒图标**（方块堆叠图标），或按 `Ctrl+P` 搜索「打开卡片盒视图」

确认好用之后，再按下面的步骤装进你真实的笔记库。

---

## 电脑端安装（Windows / macOS / Linux）

### 方法 A：解压 zip（最简单）

1. 找到你的 vault 文件夹。忘了在哪就在 Obsidian 里：**设置 → 关于 → 仓库路径**，或右键任意笔记「在系统资源管理器中显示」
2. 进入 vault，找到 `.obsidian` 文件夹
   - Windows：如果看不到，资源管理器 → **查看 → 显示 → 隐藏的项目**
   - macOS：在 Finder 里按 `Cmd + Shift + .`
3. 进入 `.obsidian`，如果没有 `plugins` 文件夹就**新建一个**
4. 把 `cardbox-0.2.0.zip` 解压，得到的 `cardbox` 文件夹整个拖进 `plugins/`
5. 检查路径是否为 `.obsidian/plugins/cardbox/main.js`（**不要多一层**）
6. 回到 Obsidian：**设置 → 第三方插件**
   - 如果「安全模式 / 限制模式」是开启的，先**关闭**它
   - 点击**刷新**按钮（第三方插件列表旁的圆形箭头）
   - 找到「**CardBox 卡片盒**」，打开右侧开关

### 方法 B：命令行（更快）

Windows PowerShell，把`<VAULT>` 换成你的 vault 路径：

```powershell
$vault = "D:\Obsidian\GooseGoosedump"
$dest = "$vault\.obsidian\plugins\cardbox"
New-Item -ItemType Directory -Force -Path $dest
Copy-Item "E:\AgentTest\OBSidianCardBox\main.js","E:\AgentTest\OBSidianCardBox\manifest.json","E:\AgentTest\OBSidianCardBox\styles.css" -Destination $dest -Force
```

macOS / Linux：

```bash
VAULT="$HOME/Notes"
mkdir -p "$VAULT/.obsidian/plugins/cardbox"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/cardbox/"
```

然后在 Obsidian 里刷新并启用。

---

## 手机端安装（Android，手动传文件）

**目标**：把三个文件放进手机 vault 的 `.obsidian/plugins/cardbox/` 里。

用这个包：**`release/cardbox-0.2.0-mobile.zip`**（132 KB）

> 为什么不用另一个 `cardbox-0.2.0.zip`？
> 那个包是 PowerShell 生成的，内部路径用反斜杠（`cardbox\main.js`），
> 部分手机解压工具会解出一个名叫 `cardbox\main.js` 的**单个文件**而不是文件夹，插件直接废掉。
> mobile 版强制用正斜杠且不压缩，兼容性最好。

### 第 1 步：先搞清手机 vault 在哪

在手机 Obsidian 里：**设置（左下齿轮）→ 关于 → 仓库路径**，记下这个路径。

常见位置：
- `/storage/emulated/0/Documents/Obsidian/<库名>`
- `/storage/emulated/0/Obsidian/<库名>`
- `/sdcard/Documents/<库名>`

⚠️ 如果路径里含 `Android/data/md.obsidian/`，说明库建在了应用私有目录，**普通文件管理器进不去**，请直接跳到本节末尾的「私有目录情况」。

### 第 2 步：把 zip 传到手机

任选一种：
- **微信/QQ**：发给「文件传输助手」或自己，手机上点击 → 「用其他应用打开」→ 保存到本地
- **USB 数据线**：手机连电脑，选「传输文件（MTP）」，直接拖进手机存储
- **QQ 浏览器/百度网盘**：上传后手机下载
- **Localsend /隔空投送类工具**：同WiFi 直传，最快

### 第 3 步：解压并放到正确位置

推荐用**MT管理器**、**ES文件浏览器**、**Solid Explorer** 或**小米/华为自带的文件管理**（都支持看隐藏文件夹）：

1. 打开文件管理器，**开启「显示隐藏文件」**
   - MT管理器：菜单 → 显示隐藏文件
   - 小米自带：右上角三点 → 设置 → 显示隐藏文件
   - 没这个开关的话换MT管理器，自带文件管理有时看不到 `.obsidian`
2. 长按zip → **解压到当前目录**，会得到一个 `cardbox` 文件夹
3. 进去确认里面**直接**是 `main.js`、`manifest.json`、`styles.css` 三个文件
   （如果看到的是 `cardbox/cardbox/...`，把里层那个 `cardbox` 拖出来用）
4. 长按 `cardbox` 文件夹 → **剪切**
5. 导航到你的 vault 目录 → 进入 `.obsidian` → 进入 `plugins`
   - **没有 `plugins` 文件夹就新建一个**，名字必须全小写
   - 连`.obsidian` 都看不到？回第1 步确认路径，并确认已开启显示隐藏文件
6. **粘贴**

最终必须是这样：

```
<你的vault>/.obsidian/plugins/cardbox/main.js
<你的vault>/.obsidian/plugins/cardbox/manifest.json
<你的vault>/.obsidian/plugins/cardbox/styles.css
```

### 第 4 步：在 Obsidian 里启用

1. **完全退出 Obsidian 再重开**（从后台任务里划掉，不是只回桌面）
   —— 不重启的话它扫不到新插件
2. 设置 → **第三方插件**
3. 关闭「**限制模式**」（Restricted mode）—— 不关的话所有第三方插件都不加载
4. 「已安装插件」里找到「**CardBox 卡片盒**」，打开开关
5. 弹出信任提示 → 选择信任

### 第 5 步：把入口放到顺手的地方

Obsidian 移动端底部工具栏没有稳定的插件 API，所以入口是 ribbon 图标和命令面板：

- **侧边栏 ribbon 的方块堆叠图标** → 打开卡片盒视图
- **命令面板**搜「快速记录卡片」/「打开卡片盒视图」
- **强烈建议**：设置 → **移动端** → **管理工具栏选项**，把「**快速记录卡片**」加进底部快捷栏。
  这样在手机上记灵感是一次点击的事，这也是这个插件最高频的用法。

### 私有目录情况（路径含Android/data/）

Android 11+ 限制访问 `Android/data/`，普通文件管理器进不去。两个办法：

**办法 A（推荐）：把库迁到公共目录**
手机 Obsidian → 左上角库名 → 「管理仓库」→ 新建一个库，位置选`Documents/Obsidian/`，
然后把原来的笔记拷过去。以后装插件、备份都方便。

**办法 B：用能访问私有目录的工具**
MT管理器、Shizuku 授权后的 Material Files，或用 USB 连电脑（MTP 有时能看到部分私有目录）。

---

## 电脑端与手机端保持同步（可选）

手动传文件的缺点是每次更新插件都要重复一遍。如果嫌烦，后面可以加同步：

| 工具 | 注意事项 |
|---|---|
| **Obsidian Sync** | 官方付费，Sync 设置里勾选「同步插件」即可，最省心 |
| **Syncthing** | 免费好用，确认 `.stignore` 没排除 `.obsidian` |
| **FolderSync** | 过滤规则里不要排除隐藏文件 |
| **坚果云 / OneDrive** | ⚠️ 不推荐：容易产生 `main (1).js` 冲突副本，会搞坏插件 |


---

## 在电脑上模拟手机端测试（不用每次传真机）

开发/测试时反复「打包→传手机→解压→重启」太繁琐。下面两条路：**方案 A 零成本立即用**，**方案 C 最接近真机**。

### 方案 A：桌面 Obsidian 设备模拟（零成本，推荐日常用）

桌面版 Obsidian 是 Electron，自带 Chromium DevTools。**Obsidian 官方文档提供了移动设备模拟 API**，一行命令即可让桌面版进入移动模式：

**步骤：**

1. 用桌面版 Obsidian 打开测试库（`E:\AgentTest\OBSidianCardBox\test-vault`）
2. 按 `Ctrl+Shift+I` 打开开发者工具
3. 切到 **Console** 面板，执行：

```js
this.app.emulateMobile(true)
```

4. 打开卡片盒视图（左侧方块图标），现在就是手机端效果了：
   - 平铺模式自动单列，子卡片带缩进 + 左侧竖线
   - 触摸目标放大到 44px
   - 长按多选、拖拽排序等触摸交互按手机端行为处理
5. 想切回桌面模式执行：`this.app.emulateMobile(false)`；来回切换：`this.app.emulateMobile(!this.app.isMobile)`

**想模拟手机屏幕尺寸（视觉更接近真机）：**

在 DevTools 里再点左上角**手机图标**（Toggle device toolbar，快捷键 `Ctrl+Shift+M`），顶部视口选 `iPhone 12 Pro`（390×844）。两者结合 = 手机宽度 + 移动模式，效果与真机基本一致。

**注意：**

- `emulateMobile` 是官方文档记载但未公开在类型定义里的 API，旧版本 Obsidian 可能没有；当前 1.13.4 可用
- 每次重开 DevTools 后重新执行即可（可保存为 DevTools 代码片段一键调用）
- 这能覆盖**绝大多数**布局与交互问题（平铺层级、收起按钮、触摸目标尺寸）
- 仍测不到的是：Android 文件系统行为、共享目录权限、极老系统 WebView

**进阶：USB 真机调试（官方支持，不用传包也能看真机报错）**

Android 手机开启「开发者选项 → USB 调试」后连上电脑（用 Chrome/Edge 浏览器）：

1. 手机开 USB 调试，USB 连电脑（选「传输文件」模式）
2. 电脑浏览器打开 `chrome://inspect/#devices`
3. 手机 Obsidian 出现后点 **inspect**，直接在电脑上调试真机运行中的 Obsidian

这解决「真机上出问题但看不到报错」的场景，配合方案 A 使用。官方文档：https://docs.obsidian.md/Plugins/Getting+started/Mobile+development

### 方案 C：安卓模拟器装 Obsidian（最接近真机）

你的电脑没有 Android SDK，不用装 Google 官方模拟器那套重装备，用**国内免费模拟器**更轻：

1. 下载安装 **MuMu 模拟器**（网易，https://mumu.163.com ，约 2-3GB）
2. 下载 **Obsidian Android APK**：https://obsidian.md/download → Android → **Download APK**（官网直链，国内可下）
3. 把 APK 拖进 MuMu 窗口即可自动安装
4. 打开 Obsidian，用「打开本地仓库」选一个文件夹作为 vault（MuMu 支持把电脑目录共享给模拟器，在 MuMu 设置里开启共享文件夹后，模拟器内的路径就能直接映射到电脑磁盘——把 `test-vault` 所在目录共享过去，Windows 侧改动实时可见）
5. 插件更新时：把 `main.js / manifest.json / styles.css` 覆盖到共享目录的 `.obsidian/plugins/cardbox/`，在模拟器里重启 Obsidian（或装 Hot Reload 插件自动重载）

**优点：** 真正的 Android 环境，能测到桌面版模拟测不到的（如 Android 文件系统、共享目录权限）；**一次配置，之后更新插件只覆盖三个文件，不用反复传包。**

> 提示：MuMu 的共享文件夹需要先配置（MuMu 设置 → 高级 → 共享文件夹），不同版本入口略有差异。若共享文件夹配置不成功，退路是直接 `adb push` 或把 APK 里的文件通过 MuMu 的文件管理器拖入。

### 已有自动化测试（改代码后快速回归）

仓库里已有两套手机模拟自动化测试，改完代码直接跑，几秒出结果：

```bash
npm run test:touch    # 手机触摸交互：点展开/收起、长按多选是否误触
npm run test:masonry  # 手机平铺层级：单列、缩进、竖线、垂直顺序
```

两个测试都用真实 Chromium 手机视口（390×844 + 触摸），跑完自动输出断言结果并截图。

---

## 验证安装成功

启用后应该能看到：

- 左侧 ribbon 出现**方块堆叠图标**
- 点开后顶部有**卡片盒切换栏**（「全部卡片」+一个 `＋` 按钮）
- 下面是**列表 / 平铺 / 时间线**三个模式按钮
- 有一排**彩色圆点**（颜色筛选）
- 设置里出现「**CardBox 设置**」面板

首次打开会短暂显示「索引中…」，卡片多时（几千张）需要一两秒。

---

## 常见问题

**插件列表里找不到 CardBox**
→ 99% 是路径问题。确认 `main.js` 是否**直接**在 `cardbox/` 文件夹里，而不是又套了一层。然后点插件列表的刷新按钮。

**开关打不开 / 提示插件加载失败**
→ 确认「限制模式（Restricted mode）」已关闭。这是Obsidian 的安全机制，不关掉所有第三方插件都不会加载。

**手机上看不到插件（Android 手动传文件后）**
按顺序排查：
1. 是否**完全退出 Obsidian 再重开**？（从后台任务划掉，只回桌面不算）
2. 文件管理器是否**开启了显示隐藏文件**？看不到 `.obsidian` 就说明没开
3. 路径是否多套了一层？`plugins/cardbox/cardbox/main.js` 是错的
4. `plugins` 文件夹名是否**全小写**？写成 `Plugins` 不认
5. 直接去文件管理器确认 `你的vault/.obsidian/plugins/cardbox/main.js` 这个文件真实存在
6. 库路径是否在 `Android/data/` 私有目录里？那需要换工具或迁库，见上文「私有目录情况」

**解压后得到一个叫 `cardbox\main.js` 的怪文件**
→ 你用的是 `cardbox-0.2.0.zip`（反斜杠路径）。换用 **`cardbox-0.2.0-mobile.zip`**，
或者手动新建 `cardbox` 文件夹，把文件改名成 `main.js` 放进去。

**手机上启用了但界面错乱 / 没有样式**
→ `styles.css` 没传过去或传丢了。三个文件必须齐全。

**卡片盒是空的**
→ 插件默认读取 vault 里的 `Cards/` 文件夹。如果你的卡片放在别处，去「设置 → CardBox 设置 → 卡片存放文件夹」改成你的路径，改完会自动重建索引。

**更新插件到新版本**
→ 覆盖那三个文件，然后重启 Obsidian，或者在第三方插件列表里把开关关掉再打开。
手机端手动传文件时，建议直接覆盖 `cardbox` 文件夹里的三个文件。
开发时推荐装 **Hot Reload** 插件（pjeby/obsidian-hot-reload），配合 `npm run dev` 改代码即时生效。

---

## 数据安全说明

-每张卡片就是一个**普通 Markdown 文件**，插件只是给它们加了 frontmatter 字段（`color`、`pinned`、`children` 等）
- 卸载插件后，所有卡片仍然是可正常阅读的 md 文件，不会丢数据
- 归档用frontmatter 标记，**不移动文件**，不会破坏双向链接
- 删除卡片走Obsidian 回收站，可恢复
- 卡片盒的定义存在插件自己的 `data.json` 里，不会在你的 vault 里制造额外笔记文件
