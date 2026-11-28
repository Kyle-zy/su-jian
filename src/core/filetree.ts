import { showModal } from "./modal";
import { platform } from "./platform";
import type { DirEntry } from "./types";

const ALLOWED_EXTENSIONS = new Set(["md", "markdown", "txt"]);

function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return directory.endsWith("/") || directory.endsWith("\\")
    ? directory + name
    : directory + separator + name;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function isVisible(entry: DirEntry): boolean {
  if (entry.name.startsWith(".")) return false;
  return entry.isDir || ALLOWED_EXTENSIONS.has(extensionOf(entry.name));
}

/** 左侧文件夹树：只显示 md / markdown / txt，隐藏文件与其它类型一律过滤。 */
export class FileTree {
  private root: string | null = null;
  private currentPath: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onOpenFile: (path: string) => void
  ) {}

  async load(root: string): Promise<void> {
    this.root = root;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.container.replaceChildren();
    if (!this.root) return;

    try {
      const entries = await platform.listDir(this.root);
      for (const node of this.createNodes(entries)) this.container.append(node);
      this.setCurrent(this.currentPath);
    } catch (error) {
      const message = document.createElement("div");
      message.className = "tree-error";
      message.textContent = error instanceof Error ? error.message : String(error);
      this.container.append(message);
    }
  }

  setCurrent(path: string | null): void {
    this.currentPath = path;
    this.container.querySelectorAll(".is-current").forEach((node) => {
      node.classList.remove("is-current");
    });
    if (!path) return;
    const selector = `.tree-item--file[data-path="${CSS.escape(path)}"]`;
    this.container.querySelector(selector)?.classList.add("is-current");
  }

  /** 在指定文件夹内新建子文件夹，创建后展开并刷新该节点。 */
  async createSubfolder(parentPath: string): Promise<void> {
    const parentName = parentPath.split(/[\\/]/).pop() ?? parentPath;
    const result = await showModal({
      title: "新建文件夹",
      message: `将在「${parentName}」中新建子文件夹。`,
      input: { label: "文件夹名称", value: "新建文件夹" },
      buttons: [
        { id: "create", label: "创建", primary: true },
        { id: "cancel", label: "取消" },
      ],
    });
    if (result.buttonId !== "create") return;

    const name = result.value.trim();
    if (!name) return;
    if (name.includes("/") || name.includes("\\")) {
      await showModal({
        title: "名称无效",
        message: "文件夹名称不能包含路径分隔符。",
        buttons: [{ id: "ok", label: "知道了", primary: true }],
      });
      return;
    }

    try {
      await platform.createDir(joinPath(parentPath, name));
    } catch (error) {
      await showModal({
        title: "新建失败",
        message: error instanceof Error ? error.message : String(error),
        buttons: [{ id: "ok", label: "知道了", primary: true }],
      });
      return;
    }

    await this.expandAndRefresh(parentPath);
  }

  /** 展开某个文件夹节点并重新读取它的子项。 */
  private async expandAndRefresh(path: string): Promise<void> {
    const wrapper = Array.from(
      this.container.querySelectorAll<HTMLElement>(".tree-node--folder")
    ).find(
      (node) => node.querySelector<HTMLElement>(".tree-item--folder")?.dataset.path === path
    );
    if (!wrapper) {
      await this.refresh();
      return;
    }

    const arrow = wrapper.querySelector<HTMLElement>(".tree-arrow");
    const children = wrapper.querySelector<HTMLElement>(".tree-children");
    if (arrow) arrow.textContent = "▾";
    wrapper.classList.remove("is-collapsed");
    if (!children) return;

    children.replaceChildren();
    try {
      const entries = await platform.listDir(path);
      for (const node of this.createNodes(entries)) children.append(node);
    } catch (error) {
      const message = document.createElement("div");
      message.className = "tree-error";
      message.textContent = error instanceof Error ? error.message : String(error);
      children.append(message);
    }
  }

  private createNodes(entries: DirEntry[]): HTMLElement[] {
    return entries.filter(isVisible).map((entry) =>
      entry.isDir ? this.createFolderNode(entry) : this.createFileNode(entry)
    );
  }

  private createFolderNode(entry: DirEntry): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node tree-node--folder is-collapsed";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-item tree-item--folder";
    item.dataset.path = entry.path;
    item.title = entry.path;

    const arrow = document.createElement("span");
    arrow.className = "tree-arrow";
    arrow.textContent = "▸";

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    item.append(arrow, name);
    item.addEventListener("click", async () => {
      const collapsed = wrapper.classList.toggle("is-collapsed");
      arrow.textContent = collapsed ? "▸" : "▾";
      if (collapsed || children.childElementCount > 0) return;

      try {
        const subEntries = await platform.listDir(entry.path);
        for (const node of this.createNodes(subEntries)) children.append(node);
      } catch (error) {
        const message = document.createElement("div");
        message.className = "tree-error";
        message.textContent = error instanceof Error ? error.message : String(error);
        children.append(message);
      }
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "tree-add";
    add.textContent = "+";
    add.title = "在此文件夹内新建子文件夹";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.createSubfolder(entry.path);
    });

    const children = document.createElement("div");
    children.className = "tree-children";

    wrapper.append(item, add, children);
    return wrapper;
  }

  private createFileNode(entry: DirEntry): HTMLElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-item tree-item--file";
    item.dataset.path = entry.path;
    item.title = entry.path;

    const dot = document.createElement("span");
    dot.className = "tree-dot";

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    item.append(dot, name);
    item.addEventListener("click", () => this.onOpenFile(entry.path));
    return item;
  }
}
