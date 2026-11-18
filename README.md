# Slipbox

> A Writeathon-style slip box plugin for Obsidian.

**Slipbox** is a mobile-first Obsidian plugin inspired by Writeathon. It follows a simple workflow: **capture ideas → organize cards → assemble articles**. Each card is a plain Markdown note, linked with standard Obsidian `[[wikilinks]]`, and displayed in a two-column masonry feed on phones. It only uses official Obsidian APIs and does not require Dataview or any third-party plugin.

## Features

### Capture

- **Quick capture**: a keyboard-hugging editor with an icon toolbar (`#`, image, pencil, keyboard, pin, clock) and a mint send button. Continuous mode keeps the dialog open after saving.
- **Child cards**: create or link extension cards from any card, with arbitrary nesting. Relations are stored as `[[wikilinks]]` so they show up in the graph and backlinks panel, and are kept in sync by `fileManager.renameFile`.

### Card box

- **Two-column masonry feed** on mobile, plus list and timeline views. Cards use a Writeathon-like plain-text layout: mint `#tags`, body text, and a muted timestamp.
- **Global search** (independent from filtering): matches titles, body text, and tags, and groups results by match category.
- **Independent filter panel**: tag chips with fuzzy search over all tags, colors, quick toggles, sorting, and clear.
- **Same-leaf navigation**: opening a card uses the card box leaf, so the Android back key, back gesture, or the bottom bar `<` returns in one step, with scroll position and filters preserved.

### Organize and output

- **Condition-based boxes**: rules on tags, keywords, dates, and more.
- **Canvas placement**: send cards to an Obsidian whiteboard.
- **Merge into article**: combine selected cards into a single note.
- **Diagnostics**: an in-app log panel for troubleshooting on mobile.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yuby-crow/obsidian-cardbox/releases).
2. Put them in `<vault>/.obsidian/plugins/cardbox-mobile/`.
3. Enable **Slipbox** in Obsidian → Settings → Community plugins.

Or build from source:

```bash
npm ci
npm run build
npm test
```

`npm run build` produces `main.js`; `npm test` runs the link, box, canvas, graph, rename, and diagnostic suites.

## Settings

Cards folder, filename format (title or timestamp), default properties, continuous capture, card preview highlighting, default view mode, default sort, masonry column width, timestamp fields, and more. All settings are stored in `data.json` inside the plugin folder.

## Compatibility

- `minAppVersion`: 1.5.0 (verified on Obsidian 1.5.12 / Android WebView Chrome 83).
- Mobile-first, but also works on desktop.

## 中文简介

Slipbox 是受写拉松启发的 Obsidian 卡片盒插件：快速记录灵感、以双链整理卡片、再组合成文章。手机端提供贴键盘的输入体验、双排信息流、独立的全局搜索与筛选面板，以及一次返回卡片盒的导航。详细说明见上方英文文档。

## License

MIT