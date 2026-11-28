/** UTF-8 解码结果。 */
export interface DecodedText {
  text: string;
  hadBom: boolean;
  isUtf8: boolean;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/**
 * 按 UTF-8 解码原始字节。
 * - 有 BOM 时去掉 BOM 并记录，保存时再写回，避免改变原文件格式；
 * - 非法 UTF-8 时用替换字符尽力展示，同时标记 isUtf8=false，调用方必须提示用户。
 */
export function decodeUtf8(bytes: Uint8Array): DecodedText {
  const hadBom =
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2];

  const payload = hadBom ? bytes.subarray(3) : bytes;
  let isUtf8 = true;
  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    isUtf8 = false;
    text = new TextDecoder("utf-8").decode(payload);
  }

  return { text, hadBom, isUtf8 };
}

/** 编码文本为 UTF-8 字节；需要 BOM 时补回。 */
export function encodeUtf8(text: string, hadBom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!hadBom) return body;

  const result = new Uint8Array(body.length + 3);
  result.set(UTF8_BOM, 0);
  result.set(body, 3);
  return result;
}
