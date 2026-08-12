// 验证 preview.html UI 稿工作台可渲染
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page.goto('file:///E:/AgentTest/OBSidianCardBox/preview.html');
await page.waitForTimeout(300);

const result = await page.evaluate(() => ({
	h2s: [...document.querySelectorAll('h2')].map((h) => h.textContent),
	navLinks: [...document.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') })),
	captureBlocks: document.querySelectorAll('.cardbox-capture').length,
	captureTitle: document.querySelector('.cardbox-capture-title')?.value,
	capturePlaceholder: document.querySelector('.cardbox-capture-input')?.getAttribute('placeholder'),
	captureFooter: !!document.querySelector('.cardbox-capture-footer'),
	captureTitleBg: (() => {
		const el = document.querySelector('.cardbox-capture-title-row');
		return el ? getComputedStyle(el).backgroundColor : null;
	})(),
	captureTitleH: (() => {
		const el = document.querySelector('.cardbox-capture-title-row');
		return el ? Math.round(el.getBoundingClientRect().height) : null;
	})(),
	phoneFrames: document.querySelectorAll('.frame.phone').length,
}));

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'shot-preview-workbench.png', fullPage: true });
await browser.close();
