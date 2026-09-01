#!/usr/bin/env node

import { parse, HELP } from "./cli/index.js";
import { OkError } from "./error.js";
import { VERSION } from "./version.js";
import {
  runOneShot,
  runInteractive,
  runContinue,
  runSessions,
  runAgents,
  runSettings,
} from "./commands/index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let mode: ReturnType<typeof parse>;

  try {
    mode = parse(args);
  } catch (err: unknown) {
    if (err instanceof OkError) {
      err.print();
      process.exit(1);
    }
    throw err;
  }

  try {
    switch (mode.type) {
      case "help":
        process.stdout.write(HELP + "\n");
        break;
      case "version":
        process.stdout.write(VERSION + "\n");
        break;
      case "one_shot":
        await runOneShot(mode.question, null);
        break;
      case "interactive":
        await runInteractive(null);
        break;
      case "continue":
        await runContinue(mode.words);
        break;
      case "sessions":
        await runSessions();
        break;
      case "agents":
        await runAgents(mode.words);
        break;
      case "settings":
        await runSettings();
        break;
    }
  } catch (err: unknown) {
    if (err instanceof OkError) {
      err.print();
      process.exit(1);
    }
    if (err instanceof Error) {
      process.stderr.write(`ok: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  // One-shot / settings paths should not leave stdin held open after menus.
  if (
    mode.type !== "interactive" &&
    mode.type !== "continue" &&
    mode.type !== "sessions" &&
    mode.type !== "agents"
  ) {
    try {
      process.stdin.pause();
    } catch {
      // ignore
    }
  }
}

main();
