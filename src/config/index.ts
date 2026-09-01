import * as fs from "node:fs";
import { getConfigPath, writePrivate, displayPath } from "./storage.js";
import {
  type InstructionMode,
  instructionsFromJSON,
  instructionsToJSON,
} from "./instructions.js";
import {
  type CustomAgent,
  type InvokeSettings,
  DEFAULT_INVOKE,
  customAgentsFromJSON,
  customAgentsToJSON,
  invokeFromJSON,
  invokeToJSON,
  findCustomAgent,
  resolveQuestion,
  isValidAgentName,
} from "./agents.js";
import { definitions, findDefinition } from "../harness/index.js";

const CONFIG_VERSION = 1;

export type { InstructionMode } from "./instructions.js";
export {
  CONCISE_INSTRUCTIONS,
  promptFor,
  customInstructions,
  instructionsToJSON,
  instructionsFromJSON,
} from "./instructions.js";
export {
  writePrivate,
  getDataDir,
  getStateDir,
  getConfigPath,
  configExists,
  displayPath,
} from "./storage.js";
export type { CustomAgent, InvokeSettings } from "./agents.js";
export {
  DEFAULT_INVOKE,
  isValidAgentName,
  findCustomAgent,
  resolveQuestion,
} from "./agents.js";

/** Per-harness defaults (model / reasoning). */
export interface HarnessSettings {
  model?: string;
  reasoning?: string;
}

export interface Config {
  /** Default backend harness id (fx, codex, claude, …). */
  harness: string;
  instructions: InstructionMode;
  /** Per-harness model/reasoning defaults, keyed by harness id. */
  harnesses: Map<string, HarnessSettings>;
  /** User-defined named agents (ok @weer … / ok weer …). */
  agents: Map<string, CustomAgent>;
  /** How agent names may be invoked from the question. */
  invoke: InvokeSettings;
  /** True when this config was synthesized and has never been saved. */
  isDefault: boolean;
}

function defaultHarnessMap(): Map<string, HarnessSettings> {
  const harnesses = new Map<string, HarnessSettings>();
  for (const def of definitions) {
    harnesses.set(def.id, {
      model: def.defaultModel,
      reasoning: def.defaultReasoning,
    });
  }
  return harnesses;
}

export function defaultConfig(): Config {
  return {
    harness: "fx",
    instructions: { type: "concise" },
    harnesses: defaultHarnessMap(),
    agents: new Map(),
    invoke: { ...DEFAULT_INVOKE },
    isDefault: true,
  };
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const value = JSON.parse(raw);
    return configFromJSON(value);
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `could not parse '${configPath}': ${err.message}\n     fix or remove the file, then try again`
      );
    }
    throw err;
  }
}

/**
 * True when the user has not finished first-run setup:
 * no settings file, or missing a usable default harness / model.
 */
export function needsOnboarding(config: Config): boolean {
  if (config.isDefault) return true;

  if (!config.harness || typeof config.harness !== "string") return true;

  const harness = findDefinition(config.harness);
  if (!harness) return true;

  const stored = config.harnesses.get(config.harness)?.model;
  const model = stored ?? harness.defaultModel;
  if (!model) return true;

  return false;
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const harnessesObj: Record<string, unknown> = {};
  for (const [id, settings] of config.harnesses) {
    harnessesObj[id] = {
      model: settings.model ?? null,
      reasoning: settings.reasoning ?? null,
    };
  }

  const data: Record<string, unknown> = {
    version: CONFIG_VERSION,
    harness: config.harness,
    instructions: instructionsToJSON(config.instructions),
    harnesses: harnessesObj,
    agents: customAgentsToJSON(config.agents),
    invoke: invokeToJSON(config.invoke),
  };

  writePrivate(configPath, JSON.stringify(data, null, 2) + "\n", "ok config");
  config.isDefault = false;
}

export function configModel(
  config: Config,
  harnessId: string
): string | undefined {
  const settings = config.harnesses.get(harnessId);
  if (settings?.model !== undefined) return settings.model;
  const def = findDefinition(harnessId);
  return def?.defaultModel;
}

export function setConfigModel(
  config: Config,
  harnessId: string,
  model: string | undefined
): void {
  const existing = config.harnesses.get(harnessId) ?? {};
  config.harnesses.set(harnessId, { ...existing, model });
}

export function configReasoning(
  config: Config,
  harnessId: string
): string | undefined {
  const settings = config.harnesses.get(harnessId);
  if (settings?.reasoning !== undefined) return settings.reasoning;
  const def = findDefinition(harnessId);
  return def?.defaultReasoning;
}

export function setConfigReasoning(
  config: Config,
  harnessId: string,
  reasoning: string | undefined
): void {
  const existing = config.harnesses.get(harnessId) ?? {};
  config.harnesses.set(harnessId, { ...existing, reasoning });
}

function readHarnessMap(value: Record<string, unknown>): Map<string, HarnessSettings> {
  const harnesses = defaultHarnessMap();

  if (value.harnesses && typeof value.harnesses === "object") {
    for (const [rawId, settingsValue] of Object.entries(
      value.harnesses as Record<string, unknown>
    )) {
      const d = findDefinition(rawId);
      const id = d?.id ?? rawId;
      if (settingsValue && typeof settingsValue === "object") {
        const sv = settingsValue as Record<string, unknown>;
        harnesses.set(id, {
          model: (sv.model as string) ?? undefined,
          reasoning: (sv.reasoning as string) ?? undefined,
        });
      }
    }
  }

  return harnesses;
}

function configFromJSON(value: Record<string, unknown>): Config {
  const version = typeof value.version === "number" ? value.version : 1;
  if (version !== CONFIG_VERSION) {
    throw new Error(
      `config version ${version} is not supported (expected ${CONFIG_VERSION})`
    );
  }

  const rawHarness =
    typeof value.harness === "string" ? value.harness : undefined;
  if (!rawHarness) {
    return defaultConfig();
  }

  const def = findDefinition(rawHarness);
  const harness = def?.id ?? rawHarness;

  return {
    harness,
    instructions: instructionsFromJSON(value.instructions),
    harnesses: readHarnessMap(value),
    agents: customAgentsFromJSON(value.agents),
    invoke: invokeFromJSON(value.invoke),
    isDefault: false,
  };
}

export function configPathDisplay(): string {
  return displayPath(getConfigPath());
}
