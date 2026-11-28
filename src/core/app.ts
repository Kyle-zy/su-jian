import { BlockEditor } from "./editor";
import { decodeUtf8 } from "./encoding";
import { FileTree } from "./filetree";
import { showModal } from "./modal";
import { platform } from "./platform";
import {
  applyTheme,
  getPreference,
  setPreference,
  watchSystemTheme,
  type ThemePreference,
} from "./theme";
import type { DocumentState } from "./types";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SUPPORTED = new Set(["md", "markdown", "txt"]);

function extensionOf(path: string): string {
  const clean = path.split(/[\\/]/).pop() ?? "";
  const index = clean.lastIndexOf(".");
  return index === -1 ? "" : clean.slice(index + 1).toLowerCase();
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function isSupported(path: string): boolean {
  return SUPPORTED.has(extensionOf(path));
}

function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith("/") || directory.endsWith("\\")
    ? directory + name
    : directory + separator + name;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`页面缺少元素：${id}`);
  return found as T;
}

export class App {
  private readonly editorHost = element<HTMLDivElement>("editor");
  private readonly treeHost = element<HTMLDivElement>("file-tree");
  private readonly docName = element<HTMLSpanElement>("doc-name");
  private readonly dirtyMark = element<HTMLSpanElement>("dirty-mark");
  private readonly statusMessage = element<HTMLSpanElement>("status-message");
  private readonly statusPath = element<HTMLSpanElement>("status-path");
  private readonly folderName = element<HTMLDivElement>("folder-name");

  private readonly editor: BlockEditor;
  private readonly fileTree: FileTree;

  private doc: DocumentState | null = null;
  private folderRoot: string | null = null;

  constructor() {
    this.editor = new BlockEditor(this.editorHost, () => this.markDirty());
    this.fileTree = new FileTree(this.treeHost, (path) => {
      void this.openFile(path);
    });
  }

  async start(): Promise<void> {
    applyTheme();
    watchSystemTheme();
    this.bindButtons();
    this.bindAppearance();
    this.bindShortcuts();

    await platform.onCloseRequested(async () => this.confirmDiscard());
    await platform.onFileDrop((paths) => {
      const file = paths.find(isSupported);
      if (file) void this.openFile(file);
      else void this.showError("拖入的文件不是 .md / .markdown / .txt，已忽略。");
    });

    const startup = await platform.getStartupFile();
    if (startup && isSupported(startup)) await this.openFile(startup);

    this.setStatus(platform.isNative ? "就绪" : "浏览器预览模式（文件保存在本地模拟存储中）");
  }

  private bindButtons(): void {
    element<HTMLButtonElement>("btn-open-file").addEventListener("click", () => {
      void this.openByDialog();
    });
    element<HTMLButtonElement>("btn-open-folder").addEventListener("click", () => {
      void this.openFolder();
    });
    element<HTMLButtonElement>("btn-new-file").addEventListener("click", () => {
      void this.newFile();
    });
    element<HTMLButtonElement>("btn-new-folder").addEventListener("click", () => {
      if (!this.folderRoot) {
        void this.showError("请先打开一个文件夹。");
        return;
      }
      void this.fileTree.createSubfolder(this.folderRoot);
    });
  }

  private bindAppearance(): void {
    const button = element<HTMLButtonElement>("btn-appearance");
    const menu = element<HTMLDivElement>("appearance-menu");
    const options = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("[data-theme-preference]")
    );

    const refresh = () => {
      const current = getPreference();
      for (const option of options) {
        const active = option.dataset.themePreference === current;
        option.classList.toggle("is-active", active);
        option.setAttribute("aria-checked", String(active));
      }
    };

    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) refresh();
    });

    for (const option of options) {
      option.addEventListener("click", () => {
        setPreference(option.dataset.themePreference as ThemePreference);
        refresh();
        close();
      });
    }

    document.addEventListener("click", (event) => {
      if (!menu.hidden && !menu.contains(event.target as Node)) close();
    });

    refresh();
  }

  private bindShortcuts(): void {
    document.addEventListener("keydown", (event) => {
      if (document.querySelector(".modal-backdrop")) return;
      if (!event.ctrlKey && !event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void (event.shiftKey ? this.saveAs() : this.save());
      } else if (key === "o") {
        event.preventDefault();
        void this.openByDialog();
      } else if (key === "n") {
        event.preventDefault();
        void this.newFile();
      } else if (key === "k") {
        event.preventDefault();
        void this.openFolder();
      }
    });
  }

  private setStatus(message: string): void {
    this.statusMessage.textContent = message;
  }

  private async setTitle(): Promise<void> {
    if (this.doc) {
      this.docName.textContent = this.doc.name;
      this.dirtyMark.hidden = !this.doc.dirty;
      this.statusPath.textContent = this.doc.path;
      await platform.setTitle(`${this.doc.dirty ? "● " : ""}${this.doc.name} - 素笺`);
    } else {
      this.docName.textContent = "未打开文档";
      this.dirtyMark.hidden = true;
      this.statusPath.textContent = "";
      await platform.setTitle("素笺");
    }
  }

  private markDirty(): void {
    if (!this.doc || this.doc.dirty) return;
    this.doc.dirty = true;
    void this.setTitle();
  }

  private async showError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.setStatus(`操作失败：${message}`);
    await showModal({
      title: "操作失败",
      message,
      buttons: [{ id: "ok", label: "知道了", primary: true }],
    });
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.doc?.dirty) return true;

    const result = await showModal({
      title: "有未保存的修改",
      message: `「${this.doc.name}」有未保存的修改，要如何处理？`,
      buttons: [
        { id: "save", label: "保存", primary: true },
        { id: "discard", label: "不保存", danger: true },
        { id: "cancel", label: "取消" },
      ],
    });

    if (result.buttonId === "cancel") return false;
    if (result.buttonId === "save") return this.save();
    return true;
  }

  private async openByDialog(): Promise<void> {
    const path = await platform.openFileDialog();
    if (path) await this.openFile(path);
  }

  private async openFolder(): Promise<void> {
    const selected = await platform.openFolderDialog();
    if (!selected) return;

    this.folderRoot = selected;
    this.folderName.textContent = baseName(selected);
    await this.fileTree.load(selected);
    this.setStatus(`已打开文件夹：${baseName(selected)}`);
  }

  private async openFile(path: string): Promise<void> {
    if (!isSupported(path)) {
      await this.showError("素笺只支持 .md / .markdown / .txt 文件。");
      return;
    }
    if (!(await this.confirmDiscard())) return;

    try {
      const bytes = await platform.readBytes(path);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        const result = await showModal({
          title: "文件较大",
          message: "文件超过 5MB，打开后可能出现卡顿。确定继续吗？",
          buttons: [
            { id: "open", label: "仍然打开", primary: true },
            { id: "cancel", label: "取消" },
          ],
        });
        if (result.buttonId !== "open") return;
      }

      const decoded = decodeUtf8(bytes);
      let unsafeEncoding = false;
      if (!decoded.isUtf8) {
        const result = await showModal({
          title: "编码提示",
          message: "这个文件不是 UTF-8 编码。素笺按 UTF-8 读写，直接保存会改变原文件编码。建议另存为 UTF-8 文件。",
          buttons: [
            { id: "open", label: "以 UTF-8 打开（只能另存为）", primary: true },
            { id: "cancel", label: "取消" },
          ],
        });
        if (result.buttonId !== "open") return;
        unsafeEncoding = true;
      }

      this.doc = {
        path,
        name: baseName(path),
        isPlainText: extensionOf(path) === "txt",
        dirty: false,
        hadBom: decoded.hadBom,
        unsafeEncoding,
      };
      this.editor.load(decoded.text, this.doc.isPlainText);
      this.fileTree.setCurrent(path);
      this.setStatus(`已打开 ${this.doc.name}`);
      await this.setTitle();
    } catch (error) {
      await this.showError(error);
    }
  }

  private async save(): Promise<boolean> {
    if (!this.doc) {
      this.setStatus("没有正在编辑的文档");
      return false;
    }
    // 非 UTF-8 原文件不允许覆盖写入，必须另存为。
    if (this.doc.unsafeEncoding) return this.saveAs();

    try {
      const source = this.editor.getSource();
      const content = this.doc.hadBom ? `\uFEFF${source}` : source;
      await platform.writeText(this.doc.path, content);
      this.doc.dirty = false;
      this.setStatus("已保存");
      await this.setTitle();
      return true;
    } catch (error) {
      await this.showError(error);
      return false;
    }
  }

  private async saveAs(): Promise<boolean> {
    if (!this.doc) return false;

    const selected = await platform.saveFileDialog(this.doc.path);
    if (!selected) return false;
    if (!isSupported(selected)) {
      await this.showError("只能保存到 .md / .markdown / .txt 文件。");
      return false;
    }

    try {
      const source = this.editor.getSource();
      const wasPlainText = this.doc.isPlainText;
      await platform.writeText(selected, source);

      this.doc.path = selected;
      this.doc.name = baseName(selected);
      this.doc.isPlainText = extensionOf(selected) === "txt";
      this.doc.hadBom = false;
      this.doc.unsafeEncoding = false;
      this.doc.dirty = false;

      if (this.doc.isPlainText !== wasPlainText) this.editor.load(source, this.doc.isPlainText);
      this.fileTree.setCurrent(selected);
      this.setStatus("已另存为");
      await this.setTitle();
      return true;
    } catch (error) {
      await this.showError(error);
      return false;
    }
  }

  private async newFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;

    if (!this.folderRoot) {
      const selected = await platform.saveFileDialog("未命名.md");
      if (!selected || !isSupported(selected)) return;
      try {
        await platform.createFile(selected);
      } catch (error) {
        await this.showError(error);
        return;
      }
      await this.openFile(selected);
      return;
    }

    const result = await showModal({
      title: "新建文件",
      message: `将在「${baseName(this.folderRoot)}」中新建一个 Markdown 文件。`,
      input: { label: "文件名", value: "未命名.md" },
      buttons: [
        { id: "create", label: "创建", primary: true },
        { id: "cancel", label: "取消" },
      ],
    });
    if (result.buttonId !== "create") return;

    let name = result.value.trim();
    if (!name) return;
    if (name.includes("/") || name.includes("\\")) {
      await this.showError("文件名不能包含路径分隔符。");
      return;
    }
    if (!name.toLowerCase().endsWith(".md")) name += ".md";

    const path = joinPath(this.folderRoot, name);
    try {
      await platform.createFile(path);
    } catch (error) {
      await this.showError(error);
      return;
    }

    await this.fileTree.refresh();
    await this.openFile(path);
  }
}
