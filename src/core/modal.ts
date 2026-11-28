import type { ModalButton } from "./types";

export interface ModalOptions {
  title: string;
  message: string;
  buttons: ModalButton[];
  input?: { label: string; value: string };
}

export interface ModalResult {
  buttonId: string;
  value: string;
}

/** 应用内弹窗，统一中文文案与三按钮样式。 */
export function showModal(options: ModalOptions): Promise<ModalResult> {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    if (!root) {
      resolve({ buttonId: "cancel", value: "" });
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = document.createElement("h2");
    title.className = "modal__title";
    title.textContent = options.title;

    const message = document.createElement("p");
    message.className = "modal__message";
    message.textContent = options.message;

    dialog.append(title, message);

    let input: HTMLInputElement | null = null;
    if (options.input) {
      const label = document.createElement("label");
      label.className = "modal__label";
      label.textContent = options.input.label;
      input = document.createElement("input");
      input.className = "modal__input";
      input.type = "text";
      input.value = options.input.value;
      label.append(input);
      dialog.append(label);
    }

    const actions = document.createElement("div");
    actions.className = "modal__actions";

    let settled = false;
    const close = (buttonId: string) => {
      if (settled) return;
      settled = true;
      const value = input?.value ?? "";
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      resolve({ buttonId, value });
    };

    for (const button of options.buttons) {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = button.label;
      element.className = "modal__button";
      if (button.primary) element.classList.add("modal__button--primary");
      if (button.danger) element.classList.add("modal__button--danger");
      element.addEventListener("click", () => close(button.id));
      actions.append(element);
    }

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close("cancel");
      }
      if (event.key === "Enter" && input && document.activeElement === input) {
        event.preventDefault();
        const primary = options.buttons.find((button) => button.primary) ?? options.buttons[0];
        close(primary.id);
      }
    };

    dialog.append(actions);
    backdrop.append(dialog);
    document.addEventListener("keydown", onKeydown, true);
    root.append(backdrop);

    if (input) {
      input.focus();
      input.select();
    } else {
      const target =
        actions.querySelector<HTMLButtonElement>(".modal__button--primary") ??
        (actions.firstElementChild as HTMLButtonElement | null);
      target?.focus();
    }
  });
}
