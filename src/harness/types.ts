export interface HarnessResponse {
  answer: string;
  sessionId: string;
}

export interface RunOptions {
  model?: string;
  reasoning?: string;
  instructions?: string;
}

export interface ReasoningLevel {
  id: string;
  description: string;
}

export interface Model {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  reasoning: ReasoningLevel[];
  defaultReasoning?: string;
}

export interface Harness {
  models(): Promise<Model[]>;

  ask(
    question: string,
    sessionId: string | null,
    options: RunOptions,
    onDelta: (delta: string) => void
  ): Promise<HarnessResponse>;
}

export type ReasoningControl =
  | { type: "selectable" }
  | { type: "managed"; label: string; explanation: string };

export interface Definition {
  id: string;
  aliases: string[];
  name: string;
  description: string;
  defaultModel?: string;
  defaultReasoning?: string;
  reasoning: ReasoningControl;
  programEnv: string;
  create: (program: string) => Harness;
}
