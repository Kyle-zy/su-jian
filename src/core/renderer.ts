import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js/lib/core";

// 只注册常用语言，避免把整个 highlight.js 打进包里。
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c: cpp,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  js: javascript,
  json,
  kotlin,
  markdown,
  python,
  ruby,
  rust,
  sql,
  ts: typescript,
  typescript,
  xml,
  html: xml,
  yaml,
};

for (const [name, definition] of Object.entries(languages)) {
  hljs.registerLanguage(name, definition);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code: string, lang: string): string {
    const language = lang.toLowerCase();
    if (hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(code, { language }).value;
        return `<pre class="hljs"><code>${highlighted}</code></pre>`;
      } catch {
        // 高亮失败时退回纯文本转义。
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
  },
});

// 两个 @types 包对 markdown-it 的声明路径不同，这里做一次类型桥接。
md.use(footnote as never);
md.use(taskLists, { enabled: true, label: true });

/**
 * 图片本期不支持：保留原始 markdown 语法作为纯文本展示，不创建 img 节点，
 * 因此不会加载任何图片资源。
 */
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const alt = token.content ?? "";
  const src = token.attrGet("src") ?? "";
  const title = token.attrGet("title");
  const raw = `![${alt}](${src}${title ? ` "${title}"` : ""})`;
  return `<span class="md-image-raw">${escapeHtml(raw)}</span>`;
};

/** 渲染单个块。markdown-it 会包一层 <p>，样式里会清掉多余外边距。 */
export function renderBlock(source: string): string {
  return md.render(source);
}
