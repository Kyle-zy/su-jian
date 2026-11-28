/** 外观偏好：跟随系统 / 亮色 / 暗色。 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "sujian.theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

const VALID: ThemePreference[] = ["system", "light", "dark"];

/** 读取本机保存的外观偏好；无效值回退为跟随系统。 */
export function getPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    return saved && VALID.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** 把偏好解析成实际主题。 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemDark.matches ? "dark" : "light";
  return preference;
}

/** 应用主题到根节点，CSS 变量据此切换。 */
export function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(getPreference());
}

/** 保存偏好并立即生效。 */
export function setPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 本地存储不可用时仍可在本次会话内生效。
  }
  applyTheme();
}

/** 跟随系统时监听系统主题变化；返回取消监听函数。 */
export function watchSystemTheme(onChange?: () => void): () => void {
  const listener = () => {
    if (getPreference() !== "system") return;
    applyTheme();
    onChange?.();
  };
  systemDark.addEventListener("change", listener);
  return () => systemDark.removeEventListener("change", listener);
}
