export const CONCISE_INSTRUCTIONS =
  "Be friendly, direct, conversational, and concise. Lead with the answer and stop once it is clear. " +
  "Use recent context to interpret typos and corrections. " +
  "Skip canned reactions, restatements, repeated conclusions, and unsolicited offers to continue. " +
  "Treat brief acknowledgments as closure. Keep simple definitions and follow-ups to one short paragraph unless asked for more. " +
  "Do not use em dashes or emoji. Plain ASCII emoticons such as :) are fine.";

export type InstructionMode =
  | { type: "concise" }
  | { type: "agent_default" }
  | { type: "custom"; value: string };

export function promptFor(mode: InstructionMode): string | undefined {
  switch (mode.type) {
    case "concise":
      return CONCISE_INSTRUCTIONS;
    case "agent_default":
      return undefined;
    case "custom":
      return mode.value;
  }
}

export function customInstructions(mode: InstructionMode): string | undefined {
  return mode.type === "custom" ? mode.value : undefined;
}

export function instructionsToJSON(mode: InstructionMode): unknown {
  switch (mode.type) {
    case "concise":
      return "concise";
    case "agent_default":
      return "agent_default";
    case "custom":
      return { custom: mode.value };
  }
}

export function instructionsFromJSON(value: unknown): InstructionMode {
  if (value === null || value === undefined) {
    return { type: "concise" };
  }
  if (value === "concise") return { type: "concise" };
  if (value === "agent_default") return { type: "agent_default" };
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("custom" in obj && typeof obj.custom === "string") {
      return { type: "custom", value: obj.custom };
    }
  }
  return { type: "concise" };
}
