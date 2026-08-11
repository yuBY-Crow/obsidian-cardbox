// 生成插件安装 zip(store 不压缩,兼容 Android/iOS 解压工具)。
// 用法: node scripts/zip.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import path from 'node:path';

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const ID = JSON.parse(await readFile('manifest.json', 'utf8')).id;
const VERSION = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const PREFIX = `${ID}/`;
const OUT = `release/${ID}-${VERSION}.zip`;

function dosDateTime(d = new Date()) {
	const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
	const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
	return { time, date };
}

const { time, date } = dosDateTime();
const locals = [];
const centrals = [];
let offset = 0;

for (const name of FILES) {
	const data = await readFile(name);
	const entryName = Buffer.from(PREFIX + name, 'utf8');
	const crc = crc32(data);

	const local = Buffer.alloc(30 + entryName.length);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(0x0800, 6);
	local.writeUInt16LE(0, 8);
	local.writeUInt16LE(time, 10);
	local.writeUInt16LE(date, 12);
	local.writeUInt32LE(crc, 14);
	local.writeUInt32LE(data.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(entryName.length, 26);
	local.writeUInt16LE(0, 28);
	entryName.copy(local, 30);
	locals.push(local, data);

	const central = Buffer.alloc(46 + entryName.length);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(0x0800, 8);
	central.writeUInt16LE(0, 10);
	central.writeUInt16LE(time, 12);
	central.writeUInt16LE(date, 14);
	central.writeUInt32LE(crc, 16);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(entryName.length, 28);
	central.writeUInt16LE(0, 30);
	central.writeUInt16LE(0, 32);
	central.writeUInt16LE(0, 34);
	central.writeUInt16LE(0, 36);
	central.writeUInt32LE(0, 38);
	central.writeUInt32LE(offset, 42);
	entryName.copy(central, 46);
	centrals.push(central);

	offset += local.length + data.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(FILES.length, 8);
end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.concat([...locals, centralBuf, end]));
console.log(`已生成 ${OUT}`);
