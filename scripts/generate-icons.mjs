/**
 * 生成素笺的占位图标（纯 Node 实现，不引入额外依赖）。
 * 图案：暖白信笺 + 左侧竖线 + 三条书写线 + 一角朱印。
 * 运行：node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

const PALETTE = {
  paper: [245, 241, 232, 255],
  edge: [62, 92, 80, 255],
  line: [140, 154, 145, 255],
  seal: [180, 75, 60, 255],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  const edgeWidth = Math.max(2, Math.round(size * 0.07));
  const lineStart = Math.round(size * 0.24);
  const lineEnd = Math.round(size * 0.78);
  const lineThickness = Math.max(1, Math.round(size * 0.035));
  const lineYs = [0.32, 0.5, 0.68].map((ratio) => Math.round(size * ratio));
  const sealStart = Math.round(size * 0.68);
  const sealSize = Math.max(2, Math.round(size * 0.16));

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0; // 无滤镜
    for (let x = 0; x < size; x += 1) {
      let color = PALETTE.paper;
      if (x < edgeWidth) color = PALETTE.edge;
      const onLine = lineYs.some((ly) => y >= ly && y < ly + lineThickness);
      if (onLine && x >= lineStart && x < lineEnd) color = PALETTE.line;
      if (x >= sealStart && x < sealStart + sealSize && y >= sealStart && y < sealStart + sealSize) {
        color = PALETTE.seal;
      }
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

function makeIcns(png128) {
  const type = Buffer.from("ic07", "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(8 + png128.length, 0);
  const body = Buffer.concat([type, length, png128]);
  const total = Buffer.alloc(4);
  total.writeUInt32BE(8 + body.length, 0);
  return Buffer.concat([Buffer.from("icns", "ascii"), total, body]);
}

mkdirSync(OUT_DIR, { recursive: true });
const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);
writeFileSync(join(OUT_DIR, "32x32.png"), png32);
writeFileSync(join(OUT_DIR, "128x128.png"), png128);
writeFileSync(join(OUT_DIR, "128x128@2x.png"), png256);
writeFileSync(join(OUT_DIR, "icon.ico"), makeIco(png32, 32));
writeFileSync(join(OUT_DIR, "icon.icns"), makeIcns(png128));
console.log("图标已生成：" + OUT_DIR);
