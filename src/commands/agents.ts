import {
  loadConfig,
  saveConfig,
  type CustomAgent,
} from "../config/index.js";
import { OkError } from "../error.js";
import { agentName } from "../harness/index.js";
import {
  choose,
  prepareStdin,
  truncate,
  type SelectItem,
} from "../ui/index.js";
import { createAgentInteractive } from "./agent-create.js";
import { runInteractive } from "./interactive.js";

export async function runAgents(words: string[]): Promise<void> {
  if (words.length === 1 && words[0] === "new") {
    await createAgentInteractive();
    return;
  }
  if (words.length > 0) {
    throw OkError.new(
      "--agents accepts no arguments, or 'new' to create",
      "run 'ok --agents' or 'ok --agents new'"
    );
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    listAgents(loadConfig().agents);
    return;
  }

  let config = loadConfig();

  while (true) {
    const entries = [...config.agents.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );

    if (entries.length === 0) {
      process.stderr.write("No agents yet.\n\n");
      await createAgentInteractive(config);
      config = loadConfig();
      continue;
    }

    const names = entries.map(([name]) => name);
    const items = agentItems(entries);
    const pick = await choose(
      "Agents",
      "Invoke with ok @name or ok name",
      items,
      0,
      {
        actions: {
          n: {
            label: "new",
            async run() {
              prepareStdin();
              await createAgentInteractive(config);
              config = loadConfig();
              return true;
            },
          },
          d: {
            label: "delete",
            run(index) {
              const name = names[index]!;
              config.agents.delete(name);
              saveConfig(config);
              if (config.agents.size === 0) {
                process.stderr.write("\nNo agents left.\n");
              }
              return true;
            },
          },
        },
        selectVerb: "use",
      }
    );

    if (pick === "refresh") continue;
    if (pick === null) return;

    const selected = names[pick]!;
    prepareStdin();
    await runInteractive(null, { agent: selected });
    return;
  }
}

function agentItems(entries: [string, CustomAgent][]): SelectItem[] {
  return entries.map(([name, agent]) => {
    const harness = agent.harness ? agentName(agent.harness) : "default";
    const preview = agent.instruction
      ? truncate(agent.instruction, 28)
      : "No instruction";
    return {
      label: `@${name}`,
      detail: `${preview} · ${harness}`,
    };
  });
}

function listAgents(agents: Map<string, CustomAgent>): void {
  if (agents.size === 0) {
    process.stdout.write("No agents.\n");
    return;
  }
  for (const [name, agent] of [...agents.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const harness = agent.harness ? agentName(agent.harness) : "default";
    const line = `@${name.padEnd(10)}  ${harness.padEnd(8)}  ${truncate(agent.instruction ?? "", 40)}\n`;
    process.stdout.write(line);
  }
}
