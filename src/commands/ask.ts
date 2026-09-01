import {
  loadConfig,
  needsOnboarding,
  configModel,
  configReasoning,
  promptFor,
  resolveQuestion,
  type Config,
  type CustomAgent,
} from "../config/index.js";
import {
  createHarness,
  resolveDefinition,
  type Harness,
  type HarnessResponse,
  type RunOptions,
} from "../harness/index.js";
import {
  createSession,
  addTurn,
  saveSession,
  type Session,
} from "../session/index.js";
import { writeMarkdown, Spinner } from "../ui/index.js";
import { runOnboarding } from "./onboard.js";

export interface ResolvedSettings {
  /** Backend harness id. */
  harness: string;
  model?: string;
  reasoning?: string;
  instructions?: string;
  /** User-defined agent in play, if any. */
  customAgent: CustomAgent | null;
}

/** Load config, running first-time setup when defaults are unset. */
export async function ensureConfig(): Promise<Config> {
  let config = loadConfig();
  if (needsOnboarding(config)) {
    config = await runOnboarding(config);
  }
  return config;
}

/**
 * Resolve harness / model / reasoning / instructions for a turn.
 * Priority: custom agent overrides → session overrides → config defaults.
 */
export function getSettings(
  config: Config,
  session: Session | null,
  customAgent: CustomAgent | null = null
): ResolvedSettings {
  // Priority: custom agent harness → resumed session backend → config default.
  const harnessId =
    customAgent?.harness ?? session?.harness ?? config.harness;

  const agentDef = resolveDefinition(harnessId);
  const harness = agentDef.id;

  const saved = session?.settings;
  const model =
    customAgent?.model ?? saved?.model ?? configModel(config, harness);

  let reasoning: string | undefined;
  if (agentDef.reasoning.type === "selectable") {
    reasoning =
      customAgent?.reasoning ??
      saved?.reasoning ??
      configReasoning(config, harness);
  }

  const style = promptFor(config.instructions);
  const persona = customAgent?.instruction;
  const parts = [style, persona].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  const instructions = parts.length > 0 ? parts.join("\n\n") : undefined;

  return {
    harness,
    model,
    reasoning,
    instructions,
    customAgent,
  };
}

/** Parse a raw user line into an optional custom agent + remaining question. */
export function resolveInput(
  raw: string,
  config: Config
): { agent: CustomAgent | null; question: string } {
  return resolveQuestion(raw, config.agents, config.invoke);
}

export async function runOneShot(
  raw: string,
  saved: Session | null
): Promise<void> {
  const config = await ensureConfig();
  const { agent, question } = resolveInput(raw, config);
  const settings = getSettings(config, saved, agent);
  const harness = createHarness(settings.harness);
  const cwd = process.cwd();

  const response = await askWithSpinner(
    harness,
    question,
    saved?.harnessSessionId ?? null,
    settings
  );

  await writeMarkdown(response.answer);
  persistTurn(saved, settings, response, question, cwd);
}

export async function askWithSpinner(
  harness: Harness,
  question: string,
  sessionId: string | null,
  settings: ResolvedSettings
): Promise<HarnessResponse> {
  const runOptions: RunOptions = {
    model: settings.model,
    reasoning: settings.reasoning,
    instructions: settings.instructions,
  };

  const spinner = new Spinner();
  spinner.start();
  try {
    return await harness.ask(question, sessionId, runOptions, () => {});
  } finally {
    spinner.stop();
  }
}

export function persistTurn(
  saved: Session | null,
  settings: ResolvedSettings,
  response: HarnessResponse,
  question: string,
  cwd: string
): Session {
  let session = saved;
  if (!session) {
    session = createSession(settings.harness, response.sessionId, cwd);
  } else {
    session.harness = settings.harness;
    session.harnessSessionId = response.sessionId;
    session.settings = {
      model: settings.model,
      reasoning: settings.reasoning,
    };
  }
  if (settings.customAgent) {
    session.profile = settings.customAgent.name;
  }
  addTurn(session, question, response.answer);
  saveSession(session);
  return session;
}

export type { HarnessResponse };
