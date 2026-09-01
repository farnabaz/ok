import { spawn } from "node:child_process";
import type {
  Definition,
  Harness,
  HarnessResponse,
  Model,
  ReasoningLevel,
  RunOptions,
} from "../types.js";
import { capture, runChild } from "../process.js";
import { instructionCliArgs } from "../instructions.js";

const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export function createPi(program: string): Harness {
  return {
    async models(): Promise<Model[]> {
      const { code, stdout, stderr } = await capture(program, [
        "--list-models",
      ]);
      if (code !== 0) {
        throw new Error(stderr.trim() || "could not list Pi models");
      }

      const lines = stdout.split("\n");
      const models: Model[] = [];
      // Skip header
      for (const line of lines.slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5) continue;
        const [provider, id, context, , thinking] = cols;
        if (!provider || !id) continue;
        const reasoning: ReasoningLevel[] =
          thinking === "yes"
            ? PI_THINKING_LEVELS.map((level) => ({
                id: level,
                description: "",
              }))
            : [];
        models.push({
          id: `${provider}/${id}`,
          name: id,
          description: `${provider} — ${context} context`,
          isDefault: false,
          reasoning,
        });
      }

      if (models.length === 0) {
        throw new Error("Pi did not report any available models");
      }
      return models;
    },

    async ask(
      question: string,
      sessionId: string | null,
      options: RunOptions,
      onDelta: (delta: string) => void
    ): Promise<HarnessResponse> {
      const args = [
        "ask",
        "--format",
        "json",
        ...instructionCliArgs("pi", options.instructions),
      ];
      if (options.model) {
        args.push("--model", options.model);
      }
      args.push(question);

      const child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let answer = "";
      let resultSessionId = sessionId ?? `pi-${Date.now()}`;
      const stderrChunks: Buffer[] = [];

      const exitCode = await runChild(
        child,
        (chunk) => {
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.trim() === "") continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "text" && event.text) {
                answer += event.text;
                onDelta(event.text);
              }
              if (event.session_id) {
                resultSessionId = event.session_id;
              }
            } catch {
              // skip non-JSON
            }
          }
        },
        (chunk) => {
          stderrChunks.push(chunk);
        }
      );

      if (exitCode !== 0) {
        const stderrStr = Buffer.concat(stderrChunks).toString().trim();
        throw new Error(stderrStr || `Pi exited with code ${exitCode}`);
      }

      if (!answer) {
        throw new Error("Pi completed without returning an answer");
      }

      return { answer, sessionId: resultSessionId };
    },
  };
}

export const piDefinition: Definition = {
  id: "pi",
  aliases: [],
  name: "Pi",
  description: "Pi coding agent",
  reasoning: { type: "selectable" },
  programEnv: "OK_PI_BIN",
  create: createPi,
};
