/**
 * 核心逻辑回归检查（Node 22 --experimental-strip-types）。
 * 运行：node --experimental-strip-types scripts/verify-core.mjs
 */
import assert from "node:assert/strict";
import { splitBlocks, serializeBlocks, detectBlockType } from "../src/core/blocks.ts";
import { renderBlock } from "../src/core/renderer.ts";
import { decodeUtf8 } from "../src/core/encoding.ts";

const sample = [
  "# 素笺",
  "",
  "一段带 **粗体**、*斜体*、[链接](https://example.com) 和 `行内代码` 的文字。",
  "",
  "- 普通列表",
  "- [x] 已完成",
  "- [ ] 未完成",
  "",
  "> 引用一行",
  "> 引用第二行",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "脚注测试[^1]。",
  "",
  "[^1]: 脚注内容",
  "",
  "![图片](local.png)",
  "",
].join("\n");

// 1. 分块序列化必须逐字还原，包括空行和结尾换行。
const parsed = splitBlocks(sample);
assert.equal(serializeBlocks(parsed.blocks), sample, "分块后重新序列化应逐字还原原文");
assert.ok(parsed.blocks.length >= 10, "应切出足够多的块");
console.log(`[OK] 分块往返一致：${parsed.blocks.length} 个块，换行 ${JSON.stringify(parsed.newline)}`);

// 2. 各类块的识别。
const types = parsed.blocks.map((block) => block.type);
assert.ok(types.includes("heading"), "应识别标题");
assert.ok(types.includes("list"), "应识别列表");
assert.ok(types.includes("quote"), "应识别引用");
assert.ok(types.includes("code"), "应识别代码块");
assert.ok(types.includes("table"), "应识别表格");
assert.ok(types.includes("hr"), "应识别分割线");
assert.ok(types.includes("footnote"), "应识别脚注定义");
console.log("[OK] 块类型识别：" + types.join(", "));

// 3. 渲染：语法正确、代码高亮生效、图片不生成 img 节点。
const check = (source) => renderBlock(source);
assert.match(check("# 标题"), /<h1>标题<\/h1>/);
assert.match(check("| A | B |\n| --- | --- |\n| 1 | 2 |"), /<table>/);
assert.match(check("```js\nconst a = 1;\n```"), /hljs-keyword/);
assert.match(check("- [x] 完成"), /task-list-item-checkbox/);
assert.match(check("文本[^1]\n\n[^1]: 注释"), /footnote/);
const imageHtml = check("![图](local.png)");
assert.doesNotMatch(imageHtml, /<img/, "图片不应渲染为 img 节点");
assert.match(imageHtml, /!\[图\]\(local\.png\)/, "图片应保留原始语法文本");
console.log("[OK] 渲染：标题/表格/高亮/任务列表/脚注正常，图片不加载");

// 4. 编码：BOM、合法 UTF-8、非 UTF-8 检测。
const withBom = decodeUtf8(
  new Uint8Array([0xef, 0xbb, 0xbf, 0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87])
);
assert.equal(withBom.hadBom, true);
assert.equal(withBom.isUtf8, true);
assert.equal(withBom.text, "中文");
const gbk = decodeUtf8(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]));
assert.equal(gbk.isUtf8, false, "GBK 字节应被判定为非 UTF-8");
console.log("[OK] 编码：BOM 保留、UTF-8 校验、非 UTF-8 提示");

// 5. 空文档与 CRLF 也要能往返。
for (const text of ["", "\n", "a\r\n\r\nb\r\n"]) {
  assert.equal(serializeBlocks(splitBlocks(text).blocks), text, "往返失败：" + JSON.stringify(text));
}
assert.equal(detectBlockType("## 标题"), "heading");
console.log("[OK] 边界：空文档、CRLF 往返正常");

console.log("\n全部核心检查通过。");
