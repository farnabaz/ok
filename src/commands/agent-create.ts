import {
  loadConfig,
  saveConfig,
  configModel,
  displayPath,
  getConfigPath,
  isValidAgentName,
  type Config,
  type CustomAgent,
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
import { choose, promptLine, promptParagraph, pickIndex, type SelectItem } from "../ui/index.js";

export async function createAgentInteractive(existing?: Config): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw OkError.new(
      "agent creation requires an interactive terminal",
      "run 'ok --agents new' from a terminal"
    );
  }

  const config = existing ?? loadConfig();

  process.stderr.write("\x1b[1mCreate agent\x1b[0m\n");
  process.stderr.write(
    "Define a named persona you can invoke with ok @name or ok name.\n\n"
  );

  const name = await promptName(config);
  const instruction = await promptInstruction();
  const harness = await promptHarness(config);
  const model = await promptModel(config, harness);
  const reasoning = await promptReasoning(config, harness);

  const agent: CustomAgent = { name, instruction };
  if (harness) agent.harness = harness;
  if (model) agent.model = model;
  if (reasoning) agent.reasoning = reasoning;

  config.agents.set(name, agent);
  saveConfig(config);

  const settingsPath = displayPath(getConfigPath());
  process.stderr.write(`\nSaved agent \x1b[1m${name}\x1b[0m\n`);
  process.stderr.write(`  ${settingsPath}\n`);
  process.stderr.write(`\nTry: ok @${name} your question\n\n`);
}

async function promptName(config: Config): Promise<string> {
  while (true) {
    const raw = await promptLine("Name (lowercase a-z):");
    if (raw === null) {
      throw OkError.new("agent creation cancelled", "rerun 'ok --agents new'");
    }

    const name = raw.trim().toLowerCase();
    if (!name) {
      process.stderr.write("    name is required\n\n");
      continue;
    }
    if (!isValidAgentName(name)) {
      process.stderr.write(
        "    use lowercase letters only (a-z), no spaces or numbers\n\n"
      );
      continue;
    }
    if (config.agents.has(name)) {
      process.stderr.write(
        `    agent '${name}' already exists — pick another name\n\n`
      );
      continue;
    }

    process.stderr.write("\n");
    return name;
  }
}

async function promptInstruction(): Promise<string> {
  while (true) {
    const instruction = await promptParagraph(
      "Instruction",
      "Persona / system prompt — finish with an empty line"
    );
    if (instruction === null) {
      throw OkError.new("agent creation cancelled", "rerun 'ok --agents new'");
    }
    if (instruction) {
      process.stderr.write("\n");
      return instruction;
    }
    process.stderr.write("    instruction is required\n\n");
  }
}

async function promptHarness(config: Config): Promise<string | undefined> {
  const defaultLabel = agentName(config.harness);
  const ordered = orderHarnesses(definitions);
  const items: SelectItem[] = [
    {
      label: "Use config default",
      detail: defaultLabel,
    },
    ...ordered.map(({ def, available }) =>
      available
        ? { label: def.name, detail: def.description, disabled: false }
        : { label: def.name, detail: "not installed", disabled: true }
    ),
  ];

  const index = pickIndex(
    await choose(
      "Harness",
      "Optional — esc keeps the config default",
      items,
      0
    )
  );

  process.stderr.write("\n");
  if (index === null || index === 0) return undefined;
  const chosen = ordered[index - 1]!;
  if (!chosen.available) {
    throw OkError.new(
      `${chosen.def.name} is not installed`,
      "install it or pick another harness"
    );
  }
  return chosen.def.id;
}

async function promptModel(
  config: Config,
  harnessOverride: string | undefined
): Promise<string | undefined> {
  const harnessId = harnessOverride ?? config.harness;
  const def = definitions.find((d) => d.id === harnessId);
  if (!def) return undefined;

  const defaultModelId = configModel(config, harnessId) ?? def.defaultModel;
  const defaultDetail = defaultModelId ?? "harness default";

  let models: Model[] = [];
  if (isDefinitionAvailable(def)) {
    try {
      process.stderr.write(`Loading models from ${def.name}…\n`);
      models = await createHarness(harnessId).models();
      process.stderr.write("\x1b[1A\x1b[2K");
    } catch {
      process.stderr.write("\x1b[1A\x1b[2K");
    }
  }

  const items: SelectItem[] = [
    { label: "Use harness default", detail: String(defaultDetail) },
    ...models.map((m) => ({
      label: m.name,
      detail: m.description || m.id,
    })),
  ];

  const index = pickIndex(
    await choose(
      "Model",
      "Optional — esc keeps the harness default",
      items,
      0
    )
  );

  process.stderr.write("\n");
  if (index === null || index === 0) return undefined;
  return models[index - 1]?.id;
}

async function promptReasoning(
  config: Config,
  harnessOverride: string | undefined
): Promise<string | undefined> {
  const harnessId = harnessOverride ?? config.harness;
  const def = definitions.find((d) => d.id === harnessId);
  if (!def || def.reasoning.type !== "selectable") return undefined;

  let models: Model[] = [];
  if (isDefinitionAvailable(def)) {
    try {
      models = await createHarness(harnessId).models();
    } catch {
      return undefined;
    }
  }

  const levels = new Map<string, string>();
  for (const model of models) {
    for (const level of model.reasoning) {
      levels.set(level.id, level.description);
    }
  }
  if (levels.size === 0) return undefined;

  const defaultReasoning = config.harnesses.get(harnessId)?.reasoning;
  const items: SelectItem[] = [
    {
      label: "Use harness default",
      detail: defaultReasoning ?? "no override",
    },
    ...[...levels.entries()].map(([id, description]) => ({
      label: id,
      detail: description,
    })),
  ];

  const index = pickIndex(
    await choose(
      "Reasoning",
      "Optional — esc keeps the harness default",
      items,
      0
    )
  );

  process.stderr.write("\n");
  if (index === null || index === 0) return undefined;
  return [...levels.keys()][index - 1];
}

interface OrderedHarness {
  def: Definition;
  available: boolean;
}

function orderHarnesses(all: readonly Definition[]): OrderedHarness[] {
  const available: OrderedHarness[] = [];
  const missing: OrderedHarness[] = [];

  for (const def of all) {
    const entry = { def, available: isDefinitionAvailable(def) };
    if (entry.available) available.push(entry);
    else missing.push(entry);
  }

  available.sort((a, b) => {
    if (a.def.id === "fx") return -1;
    if (b.def.id === "fx") return 1;
    return 0;
  });

  return [...available, ...missing];
}
