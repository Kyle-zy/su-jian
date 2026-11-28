import type { BlockType } from "./types";

/**
 * 一个可独立编辑的 Markdown 块。
 * text 是块内源码，gap 是该块结尾到下一块开头之间的原始文本（通常是换行和空行）。
 * 这样序列化时只是 text + gap 的拼接，能保证未被编辑的字符一字不改。
 */
export interface Block {
  id: string;
  text: string;
  gap: string;
  type: BlockType;
}

export interface ParsedDocument {
  blocks: Block[];
  newline: string;
}

interface LineInfo {
  start: number;
  contentEnd: number;
  text: string;
}

const FENCE_RE = /^\s*(```+|~~~+)/;
const HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/;
const HR_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const QUOTE_RE = /^\s*>\s?/;
const FOOTNOTE_RE = /^\s*\[\^[^\]]+\]:\s*/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

let blockSeq = 0;
function nextId(): string {
  blockSeq += 1;
  return `b${blockSeq}`;
}

/** 新建一个块（编辑器拆行时使用）。 */
export function createBlock(text: string, gap: string, type: BlockType): Block {
  return { id: nextId(), text, gap, type };
}

/** 把文本切成行，同时保留每行在原文本中的偏移，便于精确还原 gap。 */
function collectLines(text: string): LineInfo[] {
  const parts = text.split(/(\r\n|\n|\r)/);
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let i = 0; i < parts.length; i += 2) {
    const content = parts[i] ?? "";
    const separator = parts[i + 1] ?? "";
    lines.push({
      start: offset,
      contentEnd: offset + content.length,
      text: content,
    });
    offset += content.length + separator.length;
  }

  return lines;
}

function isTableStart(lines: LineInfo[], index: number): boolean {
  const current = lines[index]?.text ?? "";
  const next = lines[index + 1]?.text ?? "";
  return current.includes("|") && next.includes("-") && TABLE_SEP_RE.test(next);
}

function isBlockStart(line: string): boolean {
  if (line.trim() === "") return true;
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    LIST_RE.test(line) ||
    QUOTE_RE.test(line) ||
    FOOTNOTE_RE.test(line)
  );
}

/** 判断一组行整体是什么块，仅用于 Enter / Backspace 的交互决策。 */
export function detectBlockType(source: string): BlockType {
  const lines = source.split(/\r\n|\n|\r/);
  const first = lines[0] ?? "";

  if (FENCE_RE.test(first)) return "code";
  if (HEADING_RE.test(first)) return "heading";
  if (HR_RE.test(first)) return "hr";
  if (LIST_RE.test(first)) return "list";
  if (QUOTE_RE.test(first)) return "quote";
  if (FOOTNOTE_RE.test(first)) return "footnote";
  if (lines.length >= 2 && TABLE_SEP_RE.test(lines[1])) return "table";
  return "paragraph";
}

/**
 * 把整篇文档切成块。空行不会丢失：它们被计入相邻块的 gap。
 */
export function splitBlocks(text: string): ParsedDocument {
  const lines = collectLines(text);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const groups: Array<[number, number]> = [];

  let i = 0;
  while (i < lines.length) {
    if (lines[i].text.trim() === "") {
      i += 1;
      continue;
    }

    const start = i;
    const line = lines[i].text;
    let end = i;

    if (FENCE_RE.test(line)) {
      const marker = FENCE_RE.exec(line)?.[1] ?? "```";
      const closing = marker[0].repeat(marker.length);
      i += 1;
      while (i < lines.length) {
        const candidate = lines[i].text.trim();
        i += 1;
        if (candidate.startsWith(closing)) break;
      }
      end = i - 1;
    } else if (isTableStart(lines, i)) {
      i += 1;
      while (i < lines.length && lines[i].text.includes("|")) i += 1;
      end = i - 1;
    } else if (FOOTNOTE_RE.test(line)) {
      i += 1;
      while (
        i < lines.length &&
        lines[i].text.trim() !== "" &&
        /^\s/.test(lines[i].text)
      ) {
        i += 1;
      }
      end = i - 1;
    } else if (LIST_RE.test(line)) {
      i += 1;
      while (
        i < lines.length &&
        lines[i].text.trim() !== "" &&
        (LIST_RE.test(lines[i].text) || /^\s{2,}\S/.test(lines[i].text))
      ) {
        i += 1;
      }
      end = i - 1;
    } else if (QUOTE_RE.test(line)) {
      i += 1;
      while (
        i < lines.length &&
        lines[i].text.trim() !== "" &&
        (QUOTE_RE.test(lines[i].text) || !isBlockStart(lines[i].text))
      ) {
        i += 1;
      }
      end = i - 1;
    } else if (HEADING_RE.test(line) || HR_RE.test(line)) {
      end = i;
      i += 1;
    } else {
      i += 1;
      while (
        i < lines.length &&
        lines[i].text.trim() !== "" &&
        !isBlockStart(lines[i].text) &&
        !isTableStart(lines, i)
      ) {
        i += 1;
      }
      end = i - 1;
    }

    groups.push([start, end]);
  }

  // 整篇都是空行时也要保住这些换行，否则保存后会少掉空行。
  if (groups.length === 0) {
    return { blocks: [createBlock("", text, "paragraph")], newline };
  }

  const blocks = groups.map(([start, end], index): Block => {
    const nextStart = index + 1 < groups.length ? groups[index + 1][0] : lines.length;
    const blockText = text.slice(lines[start].start, lines[end].contentEnd);
    const gapEnd = nextStart < lines.length ? lines[nextStart].start : text.length;
    return createBlock(
      blockText,
      text.slice(lines[end].contentEnd, gapEnd),
      detectBlockType(blockText)
    );
  });

  return { blocks, newline };
}

/** 把块重新拼回完整文档源码。 */
export function serializeBlocks(blocks: Block[]): string {
  return blocks.map((block) => block.text + block.gap).join("");
}

/** 从当前光标位置推断光标所在行的信息，供列表回车使用。 */
export function lineAt(text: string, caret: number): {
  start: number;
  end: number;
  content: string;
} {
  const start = Math.max(text.lastIndexOf("\n", caret - 1) + 1, 0);
  const nextBreak = text.indexOf("\n", caret);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end, content: text.slice(start, end) };
}
