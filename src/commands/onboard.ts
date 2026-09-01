import {
  loadConfig,
  saveConfig,
  setConfigModel,
  setConfigReasoning,
  displayPath,
  getConfigPath,
  type Config,
} from "../config/index.js";
import { OkError } from "../error.js";
import {
  agentName,
  createHarness,
  definitions,
  isDefinitionAvailable,
  type Definition,
  type Model,
} from "../harness/index.js";
import { choose, pickIndex, type SelectItem } from "../ui/index.js";

/**
 * First-run flow:
 * 1. Pick an installed harness
 * 2. Pick a model from that harness
 * 3. Persist defaults and return the updated config
 */
export async function runOnboarding(existing?: Config): Promise<Config> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw OkError.new(
      "first-time setup requires an interactive terminal",
      "run 'ok' from a terminal, or create ~/.ok/setting.json manually"
    );
  }

  const config = existing ?? loadConfig();

  process.stderr.write("\x1b[1mWelcome to ok\x1b[0m\n");
  process.stderr.write(
    "Pick a default harness and model. Change later with ok --settings.\n\n"
  );

  const ordered = orderHarnesses(definitions);
  const available = ordered.filter((a) => a.available);
  if (available.length === 0) {
    throw OkError.new(
      "no supported coding agents found on PATH",
      "install fx, Codex, Claude Code, OpenCode, or Pi, then try again"
    );
  }

  const agent = await pickHarness(ordered, config.harness);
  process.stderr.write(`Harness  ${agent.name}\n`);

  process.stderr.write(`Loading models from ${agent.name}…\n`);

  let models: Model[];
  try {
    const harness = createHarness(agent.id);
    models = await harness.models();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw OkError.new(
      `could not list models for ${agent.name}: ${message}`,
      "run the agent directly to fix auth, then try again"
    );
  }

  // Clear the "Loading models…" line
  process.stderr.write("\x1b[1A\x1b[2K");

  if (models.length === 0) {
    throw OkError.new(
      `${agent.name} did not report any models`,
      "authenticate the agent, then try again"
    );
  }

  const model = await pickModel(
    agent,
    models,
    config.harnesses.get(agent.id)?.model
  );

  config.harness = agent.id;
  setConfigModel(config, agent.id, model.id);

  if (
    agent.reasoning.type === "selectable" &&
    model.defaultReasoning &&
    !config.harnesses.get(agent.id)?.reasoning
  ) {
    setConfigReasoning(config, agent.id, model.defaultReasoning);
  }

  saveConfig(config);

  const settingsPath = displayPath(getConfigPath());
  process.stderr.write(`Model    ${model.name}\n`);
  process.stderr.write(
    `\nSaved defaults → ${agentName(agent.id)} / ${model.name}\n`
  );
  process.stderr.write(`  ${settingsPath}\n\n`);

  return config;
}

interface OrderedHarness {
  def: Definition;
  available: boolean;
}

/**
 * Available harnesses first (fx pinned to top when detected),
 * then unavailable ones at the bottom.
 */
function orderHarnesses(all: readonly Definition[]): OrderedHarness[] {
  const available: OrderedHarness[] = [];
  const missing: OrderedHarness[] = [];

  for (const def of all) {
    const entry = { def, available: isDefinitionAvailable(def) };
    if (entry.available) available.push(entry);
    else missing.push(entry);
  }

  // Prefer fx when installed — keep it first among detected agents.
  available.sort((a, b) => {
    if (a.def.id === "fx") return -1;
    if (b.def.id === "fx") return 1;
    return 0;
  });

  return [...available, ...missing];
}

async function pickHarness(
  ordered: OrderedHarness[],
  currentId: string
): Promise<Definition> {
  const items: SelectItem[] = ordered.map(({ def, available }) => {
    if (available) {
      return {
        label: def.name,
        detail: def.description,
        disabled: false,
      };
    }
    return {
      label: def.name,
      detail: "not installed",
      disabled: true,
    };
  });

  // Prefer fx when installed. Only keep currentId if it isn't the blank default.
  let initial = -1;
  const fxIndex = ordered.findIndex(
    (entry) => entry.available && entry.def.id === "fx"
  );
  if (fxIndex >= 0) {
    initial = fxIndex;
  } else if (currentId && currentId !== "opencode") {
    initial = ordered.findIndex(
      (entry) => entry.available && entry.def.id === currentId
    );
  }
  if (initial < 0) {
    initial = ordered.findIndex((entry) => entry.available);
  }
  if (initial < 0) initial = 0;

  const index = pickIndex(
    await choose(
      "Default harness",
      "Installed agents are selectable · missing agents are dimmed",
      items,
      initial
    )
  );

  if (index === null) {
    throw OkError.new("setup cancelled", "rerun ok to finish setup");
  }

  const chosen = ordered[index]!;
  if (!chosen.available) {
    throw OkError.new(
      `${chosen.def.name} is not installed`,
      "install it and run ok again"
    );
  }

  return chosen.def;
}

async function pickModel(
  agent: Definition,
  models: Model[],
  currentId: string | undefined
): Promise<Model> {
  const items = models.map((m) => ({
    label: m.name,
    detail: m.description || m.id,
  }));

  let initial = 0;
  if (currentId) {
    const found = models.findIndex((m) => m.id === currentId);
    if (found >= 0) initial = found;
  } else {
    const def = models.findIndex((m) => m.isDefault);
    if (def >= 0) initial = def;
  }

  const index = pickIndex(
    await choose(
      "Default model",
      `Models from ${agent.name}`,
      items,
      initial
    )
  );

  if (index === null) {
    throw OkError.new("setup cancelled", "rerun ok to finish setup");
  }

  return models[index]!;
}
