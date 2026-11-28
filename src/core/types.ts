/** 支持的文件扩展名（小写，不含点）。 */
export type SupportedExtension = "md" | "markdown" | "txt";

/** 文件树中的一个条目。 */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 块类型，仅用于交互决策，实际渲染交给 markdown-it。 */
export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "code"
  | "table"
  | "quote"
  | "hr"
  | "footnote";

/** 当前打开文档的状态。 */
export interface DocumentState {
  path: string;
  name: string;
  isPlainText: boolean;
  dirty: boolean;
  /** 原文件带 UTF-8 BOM，保存时需要保留。 */
  hadBom: boolean;
  /** 非 UTF-8 文件被强制打开，保存必须走「另存为」，避免破坏原文件。 */
  unsafeEncoding: boolean;
}

/** 待确认弹窗的按钮定义。 */
export interface ModalButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}
