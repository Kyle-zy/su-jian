import {
  createBlock,
  detectBlockType,
  lineAt,
  serializeBlocks,
  splitBlocks,
  type Block,
} from "./blocks";
import { renderBlock } from "./renderer";

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

interface BlockView {
  root: HTMLDivElement;
  view: HTMLDivElement;
  input: HTMLTextAreaElement;
}

type PointCaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * Typora 式单页编辑器。
 * 同一个画布里，光标所在块显示 Markdown 源码，其余块显示渲染结果；
 * 不存在分屏，也不存在模式切换。
 */
export class BlockEditor {
  private blocks: Block[] = [];
  private views = new Map<string, BlockView>();
  private activeId: string | null = null;
  private newline = "\n";
  private plainText = false;
  private plainInput: HTMLTextAreaElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: () => void
  ) {}

  /** 载入整篇文档。txt 走单一纯文本输入框，md 走块编辑器。 */
  load(source: string, isPlainText: boolean): void {
    this.container.replaceChildren();
    this.views.clear();
    this.activeId = null;
    this.plainText = isPlainText;
    this.plainInput = null;

    if (isPlainText) {
      const input = document.createElement("textarea");
      input.className = "editor__plaintext";
      input.spellcheck = false;
      input.value = source;
      input.setAttribute("aria-label", "纯文本编辑区");
      input.addEventListener("input", () => this.onChange());
      this.container.append(input);
      this.plainInput = input;
      this.autoSize(input);
      requestAnimationFrame(() => input.focus());
      return;
    }

    const parsed = splitBlocks(source);
    this.newline = parsed.newline;
    this.blocks = parsed.blocks.length
      ? parsed.blocks
      : [createBlock("", "", "paragraph")];

    for (const block of this.blocks) {
      this.container.append(this.createBlockView(block));
    }
  }

  /** 取回完整源码；取之前先把正在编辑的块落回模型。 */
  getSource(): string {
    if (this.plainText) return this.plainInput?.value ?? "";
    if (this.activeId) this.deactivate(this.activeId);
    return serializeBlocks(this.blocks);
  }

  focus(): void {
    if (this.plainInput) {
      this.plainInput.focus();
      return;
    }
    if (this.activeId) {
      this.views.get(this.activeId)?.input.focus();
      return;
    }
    const first = this.blocks[0];
    if (first) this.activate(first.id, 0);
  }

  private find(id: string): Block | undefined {
    return this.blocks.find((block) => block.id === id);
  }

  private indexOf(id: string): number {
    return this.blocks.findIndex((block) => block.id === id);
  }

  private createBlockView(block: Block): HTMLDivElement {
    const root = document.createElement("div");
    root.className = "block";
    root.dataset.id = block.id;
    root.dataset.type = block.type;

    const view = document.createElement("div");
    view.className = "block__view";
    view.innerHTML = renderBlock(block.text);

    const input = document.createElement("textarea");
    input.className = "block__input";
    input.spellcheck = false;
    input.value = block.text;
    input.setAttribute("aria-label", "Markdown 源码编辑");

    // 用 mousedown + preventDefault 切换块，避免 blur 抢先触发导致闪屏。
    view.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const caret = this.caretFromRendered(view, event.clientX, event.clientY, block.text);
      this.activate(block.id, caret);
    });

    input.addEventListener("input", () => {
      const current = this.find(block.id);
      if (!current) return;
      current.text = input.value;
      current.type = detectBlockType(input.value);
      root.dataset.type = current.type;
      this.autoSize(input);
      this.onChange();
    });

    input.addEventListener("keydown", (event) => {
      this.handleKeydown(event, block.id, input);
    });

    input.addEventListener("blur", () => this.deactivate(block.id));

    root.append(view, input);
    this.views.set(block.id, { root, view, input });
    return root;
  }

  /** 把渲染区里的点击位置粗略映射回源码位置，够 v0.1 用。 */
  private caretFromRendered(
    view: HTMLElement,
    x: number,
    y: number,
    source: string
  ): number {
    const doc = document as PointCaretDocument;
    const renderedText = view.textContent ?? "";
    let offset = renderedText.length;

    const range = doc.caretRangeFromPoint?.(x, y);
    if (range && view.contains(range.startContainer)) {
      const prefix = range.cloneRange();
      prefix.selectNodeContents(view);
      prefix.setEnd(range.startContainer, range.startOffset);
      offset = prefix.toString().length;
    } else {
      const position = doc.caretPositionFromPoint?.(x, y);
      if (position && view.contains(position.offsetNode)) {
        const prefix = document.createRange();
        prefix.selectNodeContents(view);
        prefix.setEnd(position.offsetNode, position.offset);
        offset = prefix.toString().length;
      }
    }

    if (offset <= 0) return 0;
    const ratio = offset / Math.max(renderedText.length, 1);
    return Math.min(source.length, Math.round(ratio * source.length));
  }

  private activate(id: string, caret: number): void {
    const target = this.views.get(id);
    if (!target) return;

    if (this.activeId === id) {
      target.input.focus();
      const pos = Math.max(0, Math.min(caret, target.input.value.length));
      target.input.setSelectionRange(pos, pos);
      return;
    }

    if (this.activeId) this.deactivate(this.activeId);
    this.activeId = id;
    target.root.classList.add("is-active");
    this.autoSize(target.input);
    target.input.focus();
    const pos = Math.max(0, Math.min(caret, target.input.value.length));
    target.input.setSelectionRange(pos, pos);
  }

  private deactivate(id: string): void {
    if (this.activeId !== id) return;
    const target = this.views.get(id);
    const block = this.find(id);

    if (target && block) {
      block.text = target.input.value;
      block.type = detectBlockType(block.text);
      target.root.dataset.type = block.type;
      target.view.innerHTML = renderBlock(block.text);
    }
    if (target) target.root.classList.remove("is-active");
    this.activeId = null;
  }

  private insertText(input: HTMLTextAreaElement, text: string): void {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const value = input.value;
    input.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private handleKeydown(
    event: KeyboardEvent,
    id: string,
    input: HTMLTextAreaElement
  ): void {
    const block = this.find(id);
    if (!block) return;

    const caret = input.selectionStart;
    const value = input.value;
    const index = this.indexOf(id);

    // 代码块内部回车保留换行，Esc 退出到渲染态。
    if (event.key === "Enter" && !event.shiftKey && block.type === "code") {
      event.preventDefault();
      this.insertText(input, this.newline);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && block.type === "list") {
      event.preventDefault();
      const line = lineAt(value, caret);
      const match = LIST_RE.exec(line.content);
      if (!match) {
        this.insertText(input, this.newline);
        return;
      }
      // 空列表项：回车取消列表标记。
      if (match[3].trim() === "") {
        input.value = value.slice(0, line.start) + value.slice(line.end);
        const pos = line.start;
        input.setSelectionRange(pos, pos);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      this.insertText(input, `${this.newline}${match[1]}${match[2]} `);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const left = value.slice(0, caret);
      const right = value.slice(caret);
      block.text = left;
      input.value = left;
      this.deactivate(id);

      const newType =
        block.type === "heading" || block.type === "hr" || block.type === "footnote"
          ? "paragraph"
          : block.type;
      const created = createBlock(right, block.gap, newType);
      block.gap = this.newline + this.newline;

      this.blocks.splice(index + 1, 0, created);
      const createdView = this.createBlockView(created);
      this.views.get(id)?.root.after(createdView);
      this.activate(created.id, 0);
      this.onChange();
      return;
    }

    if (
      event.key === "Backspace" &&
      caret === 0 &&
      input.selectionStart === input.selectionEnd &&
      index > 0
    ) {
      event.preventDefault();
      const previous = this.blocks[index - 1];
      const joiner =
        previous.type === "code" || previous.type === "list" ? this.newline : " ";
      const junction = previous.text.length + (block.text ? joiner.length : 0);

      previous.text = block.text
        ? previous.text + joiner + block.text
        : previous.text;
      previous.type = detectBlockType(previous.text);
      this.blocks.splice(index, 1);

      const previousView = this.views.get(previous.id);
      const currentView = this.views.get(id);
      currentView?.root.remove();
      this.views.delete(id);
      this.activeId = null;

      if (previousView) {
        previousView.input.value = previous.text;
        previousView.root.dataset.type = previous.type;
        previousView.view.innerHTML = renderBlock(previous.text);
      }
      this.activate(previous.id, junction);
      this.onChange();
      return;
    }

    if (event.key === "ArrowUp" && caret === 0 && index > 0) {
      event.preventDefault();
      const previous = this.blocks[index - 1];
      this.activate(previous.id, previous.text.length);
      return;
    }

    if (event.key === "ArrowDown" && caret === value.length && index < this.blocks.length - 1) {
      event.preventDefault();
      const next = this.blocks[index + 1];
      this.activate(next.id, 0);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      this.insertText(input, "  ");
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      input.blur();
    }
  }

  private autoSize(input: HTMLTextAreaElement): void {
    input.style.height = "auto";
    input.style.height = `${Math.max(input.scrollHeight, 24)}px`;
  }
}
