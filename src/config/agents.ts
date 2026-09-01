import { OkError } from "../error.js";

/** Lowercase a-z only — used as the invoke token. */
export const AGENT_NAME_RE = /^[a-z]+$/;

export interface CustomAgent {
  /** Invoke name (lowercase letters only). */
  name: string;
  /** Persona / system prompt for this agent. */
  instruction?: string;
  /** Backend harness id (fx, codex, claude, …). Falls back to config default. */
  harness?: string;
  /** Model override for this agent. */
  model?: string;
  /** Reasoning level override (when the harness supports it). */
  reasoning?: string;
}

export interface InvokeSettings {
  /** Allow `ok weer …` without @ when the first word matches an agent. */
  bare: boolean;
  /** Allow `ok @weer …`. */
  at: boolean;
}

export const DEFAULT_INVOKE: InvokeSettings = {
  bare: true,
  at: true,
};

export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_RE.test(name);
}

export function parseCustomAgent(
  name: string,
  value: unknown
): CustomAgent | null {
  if (!isValidAgentName(name)) return null;
  if (value === null || value === undefined) {
    return { name };
  }
  if (typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const agent: CustomAgent = { name };

  if (typeof obj.instruction === "string" && obj.instruction.trim()) {
    agent.instruction = obj.instruction.trim();
  }
  if (typeof obj.harness === "string" && obj.harness.trim()) {
    agent.harness = obj.harness.trim();
  }
  if (typeof obj.model === "string" && obj.model.trim()) {
    agent.model = obj.model.trim();
  }
  if (typeof obj.reasoning === "string" && obj.reasoning.trim()) {
    agent.reasoning = obj.reasoning.trim();
  }

  return agent;
}

export function customAgentsFromJSON(
  value: unknown
): Map<string, CustomAgent> {
  const map = new Map<string, CustomAgent>();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }
  for (const [rawName, raw] of Object.entries(
    value as Record<string, unknown>
  )) {
    const name = rawName.trim().toLowerCase();
    const agent = parseCustomAgent(name, raw);
    if (agent) map.set(agent.name, agent);
  }
  return map;
}

export function customAgentsToJSON(
  agents: Map<string, CustomAgent>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, agent] of agents) {
    const entry: Record<string, unknown> = {};
    if (agent.instruction) entry.instruction = agent.instruction;
    if (agent.harness) entry.harness = agent.harness;
    if (agent.model) entry.model = agent.model;
    if (agent.reasoning) entry.reasoning = agent.reasoning;
    out[name] = entry;
  }
  return out;
}

export function invokeFromJSON(value: unknown): InvokeSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_INVOKE };
  }
  const obj = value as Record<string, unknown>;
  return {
    bare: typeof obj.bare === "boolean" ? obj.bare : DEFAULT_INVOKE.bare,
    at: typeof obj.at === "boolean" ? obj.at : DEFAULT_INVOKE.at,
  };
}

export function invokeToJSON(invoke: InvokeSettings): Record<string, boolean> {
  return { bare: invoke.bare, at: invoke.at };
}

export function findCustomAgent(
  agents: Map<string, CustomAgent>,
  name: string
): CustomAgent | undefined {
  return agents.get(name.toLowerCase());
}

/**
 * Pull a leading agent mention off a question.
 *
 * - `ok @weer do this` → agent weer (when invoke.at)
 * - `ok weer do this`  → agent weer (when invoke.bare and weer exists)
 * - unknown bare name  → default (full text stays the question)
 * - unknown @name      → error
 */
export function resolveQuestion(
  raw: string,
  agents: Map<string, CustomAgent>,
  invoke: InvokeSettings
): { agent: CustomAgent | null; question: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { agent: null, question: "" };
  }

  // @name …
  if (trimmed.startsWith("@")) {
    const match = trimmed.match(/^@([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
    if (!match) {
      return { agent: null, question: trimmed };
    }
    const name = match[1]!.toLowerCase();
    const rest = (match[2] ?? "").trim();

    if (!invoke.at) {
      return { agent: null, question: trimmed };
    }
    if (!isValidAgentName(name)) {
      throw OkError.new(
        `invalid agent name '@${match[1]}'`,
        "agent names use lowercase letters only (a-z)"
      );
    }
    const agent = agents.get(name);
    if (!agent) {
      throw OkError.new(
        `unknown agent '@${name}'`,
        "add it under \"agents\" in your settings file"
      );
    }
    if (!rest) {
      throw OkError.new(
        `agent '@${name}' needs a question`,
        `try: ok @${name} your question`
      );
    }
    return { agent, question: rest };
  }

  // bare name …
  if (invoke.bare) {
    const match = trimmed.match(/^([a-z]+)(?:\s+([\s\S]*))?$/);
    if (match) {
      const name = match[1]!;
      const rest = (match[2] ?? "").trim();
      const agent = agents.get(name);
      if (agent) {
        if (!rest) {
          throw OkError.new(
            `agent '${name}' needs a question`,
            `try: ok ${name} your question  or  ok @${name} your question`
          );
        }
        return { agent, question: rest };
      }
    }
  }

  return { agent: null, question: trimmed };
}
