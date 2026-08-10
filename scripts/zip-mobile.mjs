// 生成手机端友好的 zip：强制正斜杠分隔符（PowerShell Compress-Archive 会写反斜杠，
// 部分 Android/iOS 解压工具会解成名为 "cardbox\main.js" 的单个文件而非文件夹）。
// 无第三方依赖，手写 store（不压缩）zip，兼容性最好。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import path from 'node:path';

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const PREFIX = 'cardbox/';
// 版本号从 manifest 读取，避免升版本后忘记改这里
const VERSION = JSON.parse(await readFile('manifest.json', 'utf8')).version;
const OUT = `release/cardbox-${VERSION}-mobile.zip`;

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
	local.writeUInt32LE(0x04034b50, 0); // local file header
	local.writeUInt16LE(20, 4); // version needed
	local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
	local.writeUInt16LE(0, 8); // method 0 = store
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
	central.writeUInt32LE(0x02014b50, 0); // central directory header
	central.writeUInt16LE(20, 4); // version made by
	central.writeUInt16LE(20, 6); // version needed
	central.writeUInt16LE(0x0800, 8); // UTF-8
	central.writeUInt16LE(0, 10); // store
	central.writeUInt16LE(time, 12);
	central.writeUInt16LE(date, 14);
	central.writeUInt32LE(crc, 16);
	central.writeUInt32LE(data.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(entryName.length, 28);
	central.writeUInt16LE(0, 30); // extra len
	central.writeUInt16LE(0, 32); // comment len
	central.writeUInt16LE(0, 34); // disk number
	central.writeUInt16LE(0, 36); // internal attrs
	central.writeUInt32LE(0, 38); // external attrs
	central.writeUInt32LE(offset, 42); // relative offset of local header
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
