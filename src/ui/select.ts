import * as readline from "node:readline";
import { OkError } from "../error.js";
import { suspendReadLine } from "./prompt.js";
import { fitWidth } from "./format.js";

export interface SelectItem {
  label: string;
  detail?: string;
  /** When true, the item is shown but cannot be chosen. */
  disabled?: boolean;
}

export interface ChooseAction {
  label: string;
  run: (selectedIndex: number) => boolean | Promise<boolean>;
}

export type ChooseResult = number | null | "refresh";

/** Narrow a menu result to a selected index (ignores refresh). */
export function pickIndex(result: ChooseResult): number | null {
  return typeof result === "number" ? result : null;
}

/**
 * Arrow-key select menu drawn on stderr.
 * Returns the selected index, null if cancelled, or "refresh" when an action
 * changed the list and the caller should rebuild items and reopen the menu.
 */
export async function choose(
  title: string,
  subtitle: string,
  items: SelectItem[],
  initial = 0,
  options?: {
    actions?: Record<string, ChooseAction>;
    /** Footer verb for Enter, e.g. "continue" or "use". */
    selectVerb?: string;
  }
): Promise<ChooseResult> {
  if (items.length === 0) {
    throw OkError.internal("select menu requires at least one item");
  }
  if (!items.some((item) => !item.disabled)) {
    throw OkError.internal("select menu requires at least one enabled item");
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw OkError.new(
      "selection requires an interactive terminal",
      "rerun ok from a terminal"
    );
  }

  let selected = nearestEnabled(items, initial);
  let offset = 0;
  let lastPaintLines = 0;

  // Drop any readline listener left over from text prompts — otherwise
  // printable keys echo through and corrupt the drawn menu.
  suspendReadLine();

  const wasRaw = process.stdin.isRaw === true;
  process.stderr.write("\x1b[?25l");
  if (!wasRaw) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  return new Promise<ChooseResult>((resolve, reject) => {
    let busy = false;
    const capacity = () => {
      const rows = process.stderr.rows ?? 24;
      return Math.max(3, rows - 7);
    };

    const ensureVisible = () => {
      const cap = capacity();
      if (selected < offset) offset = selected;
      else if (selected >= offset + cap) offset = selected - cap + 1;
      offset = Math.max(0, Math.min(offset, Math.max(0, items.length - cap)));
    };

    const repaint = () => {
      if (lastPaintLines > 0) {
        process.stderr.write(`\x1b[${lastPaintLines}A`);
        process.stderr.write("\x1b[J");
      }
      lastPaintLines = draw(
        title,
        subtitle,
        items,
        selected,
        offset,
        capacity(),
        options?.actions,
        options?.selectVerb ?? (options?.actions ? "continue" : "select")
      );
    };

    let pending = "";
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    const clearEscTimer = () => {
      if (escTimer !== null) {
        clearTimeout(escTimer);
        escTimer = null;
      }
    };

    const cleanup = () => {
      clearEscTimer();
      pending = "";
      process.stdin.removeListener("data", onKey);
      if (!wasRaw && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // ignore
        }
      }
      try {
        process.stdin.pause();
      } catch {
        // ignore
      }
      if (lastPaintLines > 0) {
        process.stderr.write(`\x1b[${lastPaintLines}A`);
        process.stderr.write("\x1b[J");
      }
      process.stderr.write("\x1b[?25h");
    };

    const dispatchKey = (key: string) => {
      if (busy) return;

      if (key === "\u0003") {
        cleanup();
        reject(OkError.new("cancelled", "rerun ok to try again"));
        return;
      }

      if (key === "\u001b" || key === "q") {
        cleanup();
        resolve(null);
        return;
      }

      if (key === "\r" || key === "\n") {
        if (items[selected]?.disabled) return;
        cleanup();
        resolve(selected);
        return;
      }

      if (
        key === "\u001b[A" ||
        key === "\u001bOA" ||
        key === "k"
      ) {
        selected = moveSelection(items, selected, -1);
        ensureVisible();
        repaint();
        return;
      }

      if (
        key === "\u001b[B" ||
        key === "\u001bOB" ||
        key === "j"
      ) {
        selected = moveSelection(items, selected, 1);
        ensureVisible();
        repaint();
        return;
      }

      if (key === "\u001b[5~") {
        selected = moveSelection(items, selected, -capacity());
        ensureVisible();
        repaint();
        return;
      }
      if (key === "\u001b[6~") {
        selected = moveSelection(items, selected, capacity());
        ensureVisible();
        repaint();
        return;
      }

      const num = Number(key);
      if (num >= 1 && num <= Math.min(items.length, 9)) {
        const idx = num - 1;
        if (!items[idx]?.disabled) {
          selected = idx;
          ensureVisible();
          repaint();
        }
        return;
      }

      const action = options?.actions?.[key];
      if (action) {
        busy = true;
        void Promise.resolve(action.run(selected))
          .then((refresh) => {
            busy = false;
            if (refresh) {
              cleanup();
              resolve("refresh");
            }
          })
          .catch((err: unknown) => {
            busy = false;
            cleanup();
            reject(err);
          });
      }
    };

    const flushPending = () => {
      clearEscTimer();
      while (pending.length > 0) {
        const sequences = [
          "\u001b[5~",
          "\u001b[6~",
          "\u001b[A",
          "\u001b[B",
          "\u001bOA",
          "\u001bOB",
        ];
        const match = sequences.find((seq) => pending.startsWith(seq));
        if (match) {
          pending = pending.slice(match.length);
          dispatchKey(match);
          continue;
        }

        if (pending.startsWith("\u001b")) {
          if (pending.length === 1) {
            escTimer = setTimeout(() => {
              escTimer = null;
              if (pending === "\u001b") {
                pending = "";
                dispatchKey("\u001b");
              } else {
                flushPending();
              }
            }, 40);
            return;
          }
          // Unknown escape — drop the leader and retry.
          pending = pending.slice(1);
          continue;
        }

        dispatchKey(pending[0]!);
        pending = pending.slice(1);
      }
    };

    const onKey = (buf: Buffer) => {
      pending += buf.toString("utf8");
      flushPending();
    };

    process.stdin.on("data", onKey);
    ensureVisible();
    repaint();
  });
}

function nearestEnabled(items: SelectItem[], initial: number): number {
  const start = Math.max(0, Math.min(initial, items.length - 1));
  for (let offset = 0; offset < items.length; offset++) {
    const idx = (start + offset) % items.length;
    if (!items[idx]?.disabled) return idx;
  }
  return start;
}

function moveSelection(
  items: SelectItem[],
  selected: number,
  delta: number
): number {
  if (delta === 0) return selected;
  const step = delta > 0 ? 1 : -1;
  let remaining = Math.abs(delta);
  let next = selected;
  // Cap iterations so a fully-disabled list cannot spin forever.
  const maxSteps = items.length * Math.max(1, Math.abs(delta));

  for (let steps = 0; steps < maxSteps && remaining > 0; steps++) {
    next = (next + step + items.length) % items.length;
    if (!items[next]?.disabled) {
      remaining -= 1;
    }
  }
  return items[next]?.disabled ? selected : next;
}

function draw(
  title: string,
  subtitle: string,
  items: SelectItem[],
  selected: number,
  offset: number,
  cap: number,
  actions?: Record<string, ChooseAction>,
  selectVerb = "select"
): number {
  let lines = 0;
  const cols = process.stderr.columns ?? 80;

  process.stderr.write(`\x1b[1m${fitWidth(title, cols)}\x1b[0m\n`);
  lines += 1;

  if (subtitle) {
    process.stderr.write(`${fitWidth(subtitle, cols)}\n`);
    lines += 1;
  }

  process.stderr.write("\n");
  lines += 1;

  const end = Math.min(items.length, offset + cap);
  for (let i = offset; i < end; i++) {
    const item = items[i]!;
    const plain =
      item.detail !== undefined && item.detail !== ""
        ? `${item.label}  ${item.detail}`
        : item.label;

    if (item.disabled) {
      const text = fitWidth(plain, Math.max(8, cols - 4));
      process.stderr.write(`\x1b[2m    ${text}\x1b[0m\n`);
    } else if (i === selected) {
      const text = fitWidth(plain, Math.max(8, cols - 6));
      process.stderr.write(`\x1b[7m  › ${text}  \x1b[0m\n`);
    } else {
      const visible = fitWidth(plain, Math.max(8, cols - 4));
      const splitIdx = visible.indexOf("  ");
      if (splitIdx >= 0) {
        process.stderr.write(
          `    ${visible.slice(0, splitIdx)}  \x1b[2m${visible.slice(splitIdx + 2)}\x1b[0m\n`
        );
      } else {
        process.stderr.write(`    ${visible}\n`);
      }
    }
    lines += 1;
  }

  if (items.length > cap) {
    const moreTop = offset > 0;
    const moreBottom = end < items.length;
    let hint = "";
    if (moreTop && moreBottom) hint = "↑ more — ↓ more";
    else if (moreTop) hint = "↑ more";
    else if (moreBottom) hint = "↓ more";
    process.stderr.write(`\n    \x1b[2m${fitWidth(hint, Math.max(8, cols - 4))}\x1b[0m\n`);
    lines += 2;
  } else {
    process.stderr.write("\n");
    lines += 1;
  }

  const actionHint = actions
    ? `  ${Object.entries(actions)
        .map(([key, action]) => `${key} ${action.label}`)
        .join("  ")}`
    : "";
  const footer = fitWidth(
    `↑/↓ move  enter ${selectVerb}${actionHint}  esc cancel`,
    cols
  );
  process.stderr.write(`${footer}\n`);
  lines += 1;

  return lines;
}

/** Numbered fallback when raw mode is unavailable. */
export async function chooseNumbered(
  title: string,
  items: SelectItem[]
): Promise<number | null> {
  if (items.length === 0) {
    throw OkError.internal("select menu requires at least one item");
  }

  const enabled = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.disabled);
  if (enabled.length === 0) {
    throw OkError.internal("select menu requires at least one enabled item");
  }

  process.stderr.write(`${title}\n`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const detail = item.detail ? ` — ${item.detail}` : "";
    if (item.disabled) {
      process.stderr.write(`     ${item.label}${detail}\n`);
    } else {
      const n = enabled.findIndex((e) => e.index === i) + 1;
      process.stderr.write(`  ${n}. ${item.label}${detail}\n`);
    }
  }
  process.stderr.write("\nChoose a number (or press Enter to cancel): ");

  const line = await readPromptLine();
  if (line === null || line.trim() === "") return null;

  const num = parseInt(line.trim(), 10);
  if (isNaN(num) || num < 1 || num > enabled.length) {
    throw OkError.new("invalid selection", "rerun and choose a listed number");
  }
  return enabled[num - 1]!.index;
}

function readPromptLine(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    let settled = false;
    rl.once("line", (line) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(line);
    });
    rl.once("close", () => {
      if (settled) return;
      settled = true;
      resolve(null);
    });
  });
}
