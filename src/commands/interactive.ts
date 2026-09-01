import { agentName, createHarness, type Harness } from "../harness/index.js";
import {
  type Session,
} from "../session/index.js";
import {
  readLine,
  writeSubmitted,
  writeMarkdown,
} from "../ui/index.js";
import {
  ensureConfig,
  getSettings,
  resolveInput,
  askWithSpinner,
  persistTurn,
  type ResolvedSettings,
} from "./ask.js";

export async function runInteractive(
  saved: Session | null,
  options?: { agent?: string }
): Promise<void> {
  const config = await ensureConfig();
  const cwd = process.cwd();
  const isTerminal = process.stdin.isTTY && process.stderr.isTTY;

  let session = saved;
  if (session && isTerminal) {
    await showHistory(session);
  }

  const pinnedAgent = options?.agent ?? session?.profile ?? null;
  const pinnedCustom = pinnedAgent
    ? config.agents.get(pinnedAgent) ?? null
    : null;

  if (isTerminal && pinnedCustom) {
    process.stderr.write(
      `\x1b[2musing agent ${pinnedCustom.name}\x1b[0m\n\n`
    );
  }

  // Active backend + custom agent for this conversation.
  // Switching agent/harness mid-session starts a fresh harness thread.
  let currentSettings: ResolvedSettings = getSettings(
    config,
    session,
    pinnedCustom
  );
  let harness: Harness = createHarness(currentSettings.harness);
  let currentSessionId = session?.harnessSessionId ?? null;
  let activeCustom = pinnedCustom;

  while (true) {
    const input = await readLine();

    if (input.type === "eof") break;

    const line = input.line.trim();
    if (!line) continue;

    if (line.startsWith("/")) {
      const parts = line.split(/\s+/);
      const command = parts[0];
      if (command === "/settings") {
        process.stderr.write(
          "ok: run 'ok --settings' to change defaults\n\n"
        );
        continue;
      }
      process.stderr.write(
        `ok: unknown command '${command}'\n     try 'ok --help'\n\n`
      );
      continue;
    }

    let agent;
    let question: string;
    try {
      ({ agent, question } = resolveInput(line, config));
    } catch (err: unknown) {
      if (isTerminal && err instanceof Error) {
        process.stderr.write(`ok: ${err.message}\n\n`);
        continue;
      }
      throw err;
    }

    const nextCustom = agent ?? activeCustom;
    const nextSettings = getSettings(config, session, nextCustom);
    if (agent) activeCustom = agent;

    // New harness backend or a different named agent → fresh harness session.
    const switched =
      nextSettings.harness !== currentSettings.harness ||
      nextSettings.customAgent?.name !== currentSettings.customAgent?.name;

    if (switched) {
      harness = createHarness(nextSettings.harness);
      currentSessionId = null;
      session = null;
      currentSettings = nextSettings;
      if (isTerminal && nextSettings.customAgent) {
        process.stderr.write(
          `\x1b[2musing agent ${nextSettings.customAgent.name}\x1b[0m\n`
        );
      }
    } else {
      currentSettings = nextSettings;
    }

    try {
      const response = await askWithSpinner(
        harness,
        question,
        currentSessionId,
        currentSettings
      );

      await writeMarkdown(response.answer);
      if (isTerminal) {
        process.stderr.write("\n");
      }

      session = persistTurn(session, currentSettings, response, question, cwd);
      currentSessionId = response.sessionId;
    } catch (err: unknown) {
      if (isTerminal && err instanceof Error) {
        process.stderr.write(`ok: ${err.message}\n\n`);
        continue;
      }
      throw err;
    }
  }
}

async function showHistory(session: Session): Promise<void> {
  const label = session.profile
    ? `${session.profile} · ${agentName(session.harness)}`
    : agentName(session.harness);
  process.stderr.write(
    `Continuing ${label} — ${session.turns.length} turn${session.turns.length === 1 ? "" : "s"}\n\n`
  );

  for (const turn of session.turns) {
    writeSubmitted(turn.user);
    try {
      await writeMarkdown(turn.assistant);
    } catch {
      process.stdout.write(turn.assistant + "\n");
    }
    process.stderr.write("\n");
  }
}
