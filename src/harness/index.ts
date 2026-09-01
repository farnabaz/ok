import type { Definition, Harness } from "./types.js";
import { definitions } from "./agents/index.js";
import { executableAvailable } from "./process.js";

export type {
  Definition,
  Harness,
  HarnessResponse,
  Model,
  ReasoningLevel,
  ReasoningControl,
  RunOptions,
} from "./types.js";

export { definitions };

function resolveProgram(def: Definition): string {
  return process.env[def.programEnv] ?? def.id;
}

export function findDefinition(name: string): Definition | undefined {
  return definitions.find(
    (d) => d.id === name || d.aliases.some((a) => a === name)
  );
}

export function resolveDefinition(name: string): Definition {
  const def = findDefinition(name);
  if (!def) {
    const available = definitions.map((d) => d.id).join(", ");
    throw new Error(
      `unknown agent '${name}' (available: ${available})\n     run 'ok --settings' to choose an installed agent`
    );
  }
  return def;
}

export function agentName(agent: string): string {
  const def = findDefinition(agent);
  return def?.name ?? agent;
}

export function isDefinitionAvailable(def: Definition): boolean {
  return executableAvailable(resolveProgram(def));
}

/** Installed harnesses (binary present on PATH or via env override). */
export function detectedDefinitions(): Definition[] {
  return definitions.filter(isDefinitionAvailable);
}

export function createHarness(name: string): Harness {
  const def = resolveDefinition(name);
  const program = resolveProgram(def);
  return def.create(program);
}
