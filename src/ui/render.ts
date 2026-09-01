import { renderAnsi } from "@comark/ansi";
import rangi from "@comark/ansi/plugins/rangi";

export async function renderMarkdownToTerminal(
  markdown: string
): Promise<string> {
  try {
    return await renderAnsi(markdown, {
      colors: true,
      width: process.stdout.columns ?? 80,
      autoClose: true,
      plugins: [rangi()],
    });
  } catch {
    // Fallback: return raw markdown if comark fails
    return markdown;
  }
}

export async function writeMarkdown(
  markdown: string
): Promise<void> {
  const rendered = await renderMarkdownToTerminal(markdown);
  process.stdout.write(rendered);
  if (!rendered.endsWith("\n")) {
    process.stdout.write("\n");
  }
}
