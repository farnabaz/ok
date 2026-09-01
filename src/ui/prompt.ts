import * as readline from "node:readline";

export interface PromptResult {
  type: "line";
  line: string;
}

export interface PromptEof {
  type: "eof";
}

export type PromptInput = PromptResult | PromptEof;

let rl: readline.Interface | null = null;
const waiters: Array<(input: PromptInput) => void> = [];
const buffer: string[] = [];
let closed = false;

/** Ensure stdin is ready for line editing after raw mode or readline close. */
export function prepareStdin(): void {
  if (!process.stdin.isTTY) return;
  try {
    if (process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  } catch {
    // ignore
  }
}

function getRl(): readline.Interface {
  if (!rl) {
    prepareStdin();
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });

    // Single global line handler — never also attach per-call listeners.
    rl.on("line", (line) => {
      if (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve({ type: "line", line });
      } else {
        buffer.push(line);
      }
    });

    rl.on("close", () => {
      closed = true;
      while (waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve({ type: "eof" });
      }
    });
  }
  return rl;
}

/** Close the shared readline handle so raw-mode menus own stdin exclusively. */
export function suspendReadLine(): void {
  if (!rl) return;
  rl.close();
  rl = null;
  waiters.length = 0;
  buffer.length = 0;
  closed = false;
}

export function readLine(): Promise<PromptInput> {
  getRl();

  if (buffer.length > 0) {
    const line = buffer.shift()!;
    return Promise.resolve({ type: "line", line });
  }

  if (closed) {
    return Promise.resolve({ type: "eof" });
  }

  return new Promise((resolve) => {
    waiters.push(resolve);
    process.stderr.write("> ");
  });
}

export function writeSubmitted(line: string): void {
  const lines = line.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? "> " : "  ";
    process.stderr.write(`\x1b[1m${prefix}${lines[i]}\x1b[0m\n`);
  }
  process.stderr.write("\n");
}

/** One-shot labeled prompt for setup flows. Returns null on EOF. */
export function promptLine(label: string): Promise<string | null> {
  prepareStdin();
  return new Promise((resolve) => {
    const iface = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    let settled = false;

    iface.question(`${label} `, (answer) => {
      if (settled) return;
      settled = true;
      iface.close();
      prepareStdin();
      resolve(answer);
    });

    iface.once("close", () => {
      if (settled) return;
      settled = true;
      prepareStdin();
      resolve(null);
    });
  });
}

/** Read lines until an empty line; ignores leading blanks. Returns null on EOF before content. */
export async function promptParagraph(
  title: string,
  hint: string
): Promise<string | null> {
  process.stderr.write(`\x1b[1m${title}\x1b[0m\n`);
  process.stderr.write(`${hint}\n\n`);

  const lines: string[] = [];
  while (true) {
    const input = await readLine();
    if (input.type === "eof") {
      return lines.length > 0 ? lines.join("\n").trim() : null;
    }
    if (input.line.trim() === "") {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(input.line);
  }

  return lines.join("\n").trim();
}
