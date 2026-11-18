import { App, ButtonComponent, Modal, Notice, TextComponent } from 'obsidian';
import { i18n } from '../i18n';

/** 常用色板；也支持任意 #RRGGBB / #RGB */
const PRESETS = [
	'#e05252', '#e0892f', '#d9b42c', '#3fa653', '#3a7fd5', '#8a5cd9',
	'#8d8d8d', '#5fae9c', '#a1d4ca', '#2d2d2d', '#f5f5f5', '#ff7a9c',
];
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 自定义眉头颜色调色板：原生取色器 + hex 输入 + 常用色块 + 预览 */
export class ColorPickerModal extends Modal {
	private value: string;

	constructor(app: App, current: string | undefined, private onPick: (hex: string) => void) {
		super(app);
		this.value = current ?? '#5fae9c';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cardbox-colorpicker');
		contentEl.createEl('h3', { text: i18n.colorCustomTitle });

		const native = contentEl.createEl('input', {
			cls: 'cardbox-colorpicker-native',
			attr: { type: 'color', value: this.value, 'aria-label': i18n.colorCustomTitle },
		});

		const row = contentEl.createDiv({ cls: 'cardbox-colorpicker-row' });
		const hexInput = new TextComponent(row).setPlaceholder(i18n.colorHexPlaceholder).setValue(this.value);
		hexInput.inputEl.addClass('cardbox-colorpicker-hex');
		const preview = row.createDiv({ cls: 'cardbox-colorpicker-preview' });
		const sync = (v: string): void => {
			this.value = v;
			if (HEX_RE.test(v)) native.value = v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
			preview.setCssProps({ '--cb-preview': HEX_RE.test(v) ? v : 'transparent' });
		};
		native.addEventListener('input', () => { sync(native.value); hexInput.setValue(native.value); });
		hexInput.onChange((v) => sync(v.trim()));
		sync(this.value);

		contentEl.createDiv({ cls: 'cardbox-colorpicker-label', text: i18n.colorPresets });
		const grid = contentEl.createDiv({ cls: 'cardbox-colorpicker-grid' });
		for (const p of PRESETS) {
			const sw = grid.createDiv({ cls: 'cardbox-colorpicker-swatch' });
			sw.setCssProps({ '--cb-swatch': p });
			sw.setAttribute('aria-label', p);
			sw.addEventListener('click', () => { sync(p); hexInput.setValue(p); });
		}

		const actions = contentEl.createDiv({ cls: 'cardbox-modal-actions' });
		new ButtonComponent(actions).setButtonText(i18n.colorCancel).onClick(() => this.close());
		new ButtonComponent(actions).setButtonText(i18n.colorApply).setCta().onClick(() => {
			const v = hexInput.getValue().trim();
			if (!HEX_RE.test(v)) {
				new Notice(i18n.colorInvalid);
				return;
			}
			this.onPick(v);
			this.close();
		});
	}
}