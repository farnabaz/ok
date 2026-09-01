import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  Definition,
  Harness,
  HarnessResponse,
  Model,
  RunOptions,
} from "../types.js";
import { runChild } from "../process.js";
import { instructionCliArgs } from "../instructions.js";

const FAST_MODELS = ["gpt-5.3-codex-spark", "gpt-5.6-luna"];

export function createCodex(program: string): Harness {
  return {
    async models(): Promise<Model[]> {
      // Prefer live cache written by Codex CLI
      const cachePath = path.join(os.homedir(), ".codex", "models_cache.json");
      let models: Model[] = [];

      if (fs.existsSync(cachePath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
            models?: Array<Record<string, unknown>>;
          };
          models = (raw.models ?? []).map((m) => {
            const id = String(m.slug ?? m.model ?? "");
            const reasoning = (
              (m.supported_reasoning_levels as Array<Record<string, unknown>>) ??
              (m.supportedReasoningEfforts as Array<Record<string, unknown>>) ??
              []
            ).map((level) => ({
              id: String(level.effort ?? level.reasoningEffort ?? ""),
              description: String(level.description ?? ""),
            })).filter((l) => l.id);

            return {
              id,
              name: String(m.display_name ?? m.displayName ?? id),
              description: String(m.description ?? ""),
              isDefault: Boolean(m.is_default ?? m.isDefault),
              reasoning,
              defaultReasoning:
                (m.default_reasoning_level as string | undefined) ??
                (m.defaultReasoningEffort as string | undefined),
            } satisfies Model;
          }).filter((m) => m.id);
        } catch {
          // fall through to defaults
        }
      }

      if (models.length === 0) {
        models = [
          {
            id: "gpt-5.4",
            name: "GPT-5.4",
            description: "Codex default model",
            isDefault: true,
            reasoning: [
              { id: "low", description: "Fast responses with lighter reasoning" },
              { id: "medium", description: "Balances speed and reasoning depth" },
              { id: "high", description: "Greater reasoning depth" },
            ],
            defaultReasoning: "medium",
          },
        ];
      }

      // Synthetic "fast" entry, matching ask's behavior
      if (!models.some((m) => m.id === "fast")) {
        const preferred =
          FAST_MODELS.map((id) => models.find((m) => m.id === id)).find(
            Boolean
          ) ??
          models.find((m) => m.isDefault) ??
          models[0];
        if (preferred) {
          models = [
            {
              id: "fast",
              name: "Fastest available",
              description: `Currently uses ${preferred.name}`,
              isDefault: false,
              reasoning: preferred.reasoning,
              defaultReasoning: preferred.defaultReasoning,
            },
            ...models,
          ];
        }
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
        ...instructionCliArgs("codex", options.instructions),
        "--quiet",
        "ask",
      ];
      if (options.model) {
        args.push("--model", options.model);
      }
      if (options.reasoning) {
        args.push("--reasoning", options.reasoning);
      }
      args.push(question);

      const child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let answer = "";
      let resultSessionId = sessionId ?? `codex-${Date.now()}`;
      const stderrChunks: Buffer[] = [];

      const exitCode = await runChild(
        child,
        (chunk) => {
          answer += chunk;
          onDelta(chunk);
        },
        (chunk) => {
          stderrChunks.push(chunk);
        }
      );

      if (exitCode !== 0) {
        const stderrStr = Buffer.concat(stderrChunks).toString().trim();
        throw new Error(stderrStr || `Codex exited with code ${exitCode}`);
      }

      if (!answer) {
        throw new Error("Codex completed without returning an answer");
      }

      return { answer: answer.trimEnd(), sessionId: resultSessionId };
    },
  };
}

export const codexDefinition: Definition = {
  id: "codex",
  aliases: [],
  name: "Codex",
  description: "OpenAI Codex",
  defaultModel: "fast",
  defaultReasoning: "low",
  reasoning: { type: "selectable" },
  programEnv: "OK_CODEX_BIN",
  create: createCodex,
};
