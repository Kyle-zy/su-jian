import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openNativeDialog, save as saveNativeDialog } from "@tauri-apps/plugin-dialog";
import type { DirEntry } from "./types";

const FILE_FILTERS = [
  { name: "Markdown / 文本", extensions: ["md", "markdown", "txt"] },
];

/** 平台能力：原生走 Tauri，浏览器里走一个 localStorage mock，便于无 Rust 环境验证。 */
export interface Platform {
  readonly isNative: boolean;
  openFileDialog(): Promise<string | null>;
  openFolderDialog(): Promise<string | null>;
  saveFileDialog(defaultPath?: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  onCloseRequested(handler: () => Promise<boolean>): Promise<void>;
  onFileDrop(handler: (paths: string[]) => void): Promise<void>;
  getStartupFile(): Promise<string | null>;
}

const isNative =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function nativePlatform(): Platform {
  return {
    isNative: true,

    async openFileDialog() {
      const selected = await openNativeDialog({
        title: "打开文件",
        filters: FILE_FILTERS,
        multiple: false,
      });
      return typeof selected === "string" ? selected : null;
    },

    async openFolderDialog() {
      const selected = await openNativeDialog({
        title: "打开文件夹",
        directory: true,
        multiple: false,
      });
      return typeof selected === "string" ? selected : null;
    },

    async saveFileDialog(defaultPath) {
      const selected = await saveNativeDialog({
        title: "另存为",
        filters: FILE_FILTERS,
        defaultPath,
      });
      return typeof selected === "string" ? selected : null;
    },

    async readBytes(path) {
      const bytes = await invoke<number[]>("read_file_bytes", { path });
      return new Uint8Array(bytes);
    },

    async writeText(path, content) {
      await invoke("write_file_text", { path, content });
    },

    async listDir(path) {
      const entries = await invoke<
        Array<{ name: string; path: string; isDir: boolean }>
      >("read_dir_entries", { path });
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        isDir: entry.isDir,
      }));
    },

    async createFile(path) {
      await invoke("create_empty_file", { path });
    },

    async createDir(path) {
      await invoke("create_dir", { path });
    },

    async setTitle(title) {
      await getCurrentWindow().setTitle(title);
    },

    async onCloseRequested(handler) {
      const windowHandle = getCurrentWindow();
      await windowHandle.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await handler()) await windowHandle.destroy();
      });
    },

    async onFileDrop(handler) {
      await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === "drop") handler(event.payload.paths);
      });
    },

    async getStartupFile() {
      try {
        const matches = await getMatches();
        const value = matches.args.file?.value;
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    },
  };
}

const MOCK_STORE_KEY = "sujian.mock.store.v1";

interface MockStore {
  files: Record<string, string>; // path -> base64 字节
  dirs: string[];
}

function loadMockStore(): MockStore {
  try {
    const raw = localStorage.getItem(MOCK_STORE_KEY);
    if (raw) return JSON.parse(raw) as MockStore;
  } catch {
    // 忽略损坏的 mock 数据。
  }
  return { files: {}, dirs: [] };
}

function saveMockStore(store: MockStore): void {
  localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(store));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pickFiles(options: { multiple?: boolean; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.multiple) input.multiple = true;
    if (options.directory) {
      input.webkitdirectory = true;
    } else {
      input.accept = ".md,.markdown,.txt";
    }
    input.style.display = "none";
    document.body.append(input);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    });
    input.click();
  });
}

function relativePath(file: File): string {
  const withPath = file as File & { webkitRelativePath: string };
  return withPath.webkitRelativePath || file.name;
}

function browserPlatform(): Platform {
  let folderRoot: string | null = null;

  const ensureStore = (): MockStore => loadMockStore();

  return {
    isNative: false,

    async openFileDialog() {
      const [file] = await pickFiles({ multiple: false });
      if (!file) return null;
      const path = `browser:///${file.name}`;
      const store = ensureStore();
      store.files[path] = toBase64(new Uint8Array(await file.arrayBuffer()));
      saveMockStore(store);
      return path;
    },

    async openFolderDialog() {
      const files = await pickFiles({ multiple: true, directory: true });
      if (files.length === 0) return null;
      const root = relativePath(files[0]).split("/")[0];
      folderRoot = `browser:///${root}`;
      const store = ensureStore();
      store.dirs = [folderRoot];
      for (const file of files) {
        const relative = relativePath(file);
        const segments = relative.split("/");
        for (let i = 1; i < segments.length; i += 1) {
          const dir = `browser:///${segments.slice(0, i).join("/")}`;
          if (!store.dirs.includes(dir)) store.dirs.push(dir);
        }
        store.files[`browser:///${relative}`] = toBase64(
          new Uint8Array(await file.arrayBuffer())
        );
      }
      saveMockStore(store);
      return folderRoot;
    },

    async saveFileDialog(defaultPath) {
      const name = window.prompt("另存为文件名（.md / .markdown / .txt）", defaultPath ?? "未命名.md");
      if (!name) return null;
      return name.startsWith("browser:///") ? name : `browser:///${name}`;
    },

    async readBytes(path) {
      const store = ensureStore();
      const encoded = store.files[path];
      if (encoded === undefined) throw new Error(`浏览器模拟环境中找不到文件：${path}`);
      return fromBase64(encoded);
    },

    async writeText(path, content) {
      const store = ensureStore();
      store.files[path] = toBase64(new TextEncoder().encode(content));
      saveMockStore(store);
    },

    async listDir(path) {
      const store = ensureStore();
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const children = new Map<string, DirEntry>();

      for (const dir of store.dirs) {
        if (!dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        children.set(rest, {
          name: rest,
          path: dir,
          isDir: true,
        });
      }
      for (const filePath of Object.keys(store.files)) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        children.set(rest, {
          name: rest,
          path: filePath,
          isDir: false,
        });
      }

      return Array.from(children.values()).sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
      );
    },

    async createFile(path) {
      const store = ensureStore();
      if (path in store.files) throw new Error("同名文件已存在");
      store.files[path] = "";
      if (folderRoot) {
        const parent = path.slice(0, path.lastIndexOf("/"));
        if (!store.dirs.includes(parent)) store.dirs.push(parent);
      }
      saveMockStore(store);
    },

    async createDir(path) {
      const store = ensureStore();
      if (store.dirs.includes(path)) throw new Error("同名文件夹已存在");
      store.dirs.push(path);
      saveMockStore(store);
    },

    async setTitle(title) {
      document.title = title;
    },

    async onCloseRequested(handler) {
      window.addEventListener("beforeunload", () => {
        void handler();
      });
    },

    async onFileDrop(handler) {
      document.addEventListener("dragover", (event) => event.preventDefault());
      document.addEventListener("drop", (event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files ?? []).map((file) => file.name);
        if (files.length) handler(files.map((name) => `browser:///${name}`));
      });
    },

    async getStartupFile() {
      return folderRoot;
    },
  };
}

export const platform: Platform = isNative ? nativePlatform() : browserPlatform();
