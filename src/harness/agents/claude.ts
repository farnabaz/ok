import { spawn } from "node:child_process";
import type {
  Definition,
  Harness,
  HarnessResponse,
  Model,
  RunOptions,
} from "../types.js";
import { runChild } from "../process.js";
import { instructionCliArgs } from "../instructions.js";

export function createClaude(program: string): Harness {
  return {
    async models(): Promise<Model[]> {
      // Claude Code doesn't expose a stable model list CLI; use well-known aliases.
      return [
        {
          id: "sonnet",
          name: "Sonnet",
          description: "Claude Code's latest Sonnet model",
          isDefault: true,
          reasoning: [],
        },
        {
          id: "opus",
          name: "Opus",
          description: "Claude Code's latest Opus model",
          isDefault: false,
          reasoning: [],
        },
        {
          id: "haiku",
          name: "Haiku",
          description: "Claude Code's latest Haiku model",
          isDefault: false,
          reasoning: [],
        },
      ];
    },

    async ask(
      question: string,
      sessionId: string | null,
      options: RunOptions,
      onDelta: (delta: string) => void
    ): Promise<HarnessResponse> {
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--model",
        options.model ?? "sonnet",
        ...instructionCliArgs("claude", options.instructions),
      ];
      args.push(question);

      const child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let answer = "";
      let resultSessionId = sessionId ?? `claude-${Date.now()}`;
      const stderrChunks: Buffer[] = [];

      const exitCode = await runChild(
        child,
        (chunk) => {
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.trim() === "") continue;
            try {
              const event = JSON.parse(line);
              if (
                event.type === "content_block_delta" &&
                event.delta?.text
              ) {
                answer += event.delta.text;
                onDelta(event.delta.text);
              }
              if (event.type === "message_start" && event.message?.id) {
                resultSessionId = event.message.id;
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
        throw new Error(
          stderrStr || `Claude Code exited with code ${exitCode}`
        );
      }

      if (!answer) {
        throw new Error(
          "Claude Code completed without returning an answer"
        );
      }

      return { answer, sessionId: resultSessionId };
    },
  };
}

export const claudeDefinition: Definition = {
  id: "claude",
  aliases: ["claude-code"],
  name: "Claude Code",
  description: "Anthropic Claude Code",
  reasoning: {
    type: "managed",
    label: "Managed by Claude",
    explanation:
      "Claude Code manages reasoning automatically for its selected model.",
  },
  programEnv: "OK_CLAUDE_BIN",
  create: createClaude,
};
