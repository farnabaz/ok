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

function buildOpenCodeConfig(
  existing: string | undefined,
  instructions: string | undefined
): string {
  let config: Record<string, unknown> = {};
  if (existing) {
    try {
      config = JSON.parse(existing);
    } catch {
      // ignore invalid existing config
    }
  }

  const agent: Record<string, unknown> = {
    description: "Read-only questions through ask",
    mode: "primary",
    permission: {
      "*": "deny",
      read: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
      },
      glob: "allow",
      grep: "allow",
      list: "allow",
      webfetch: "allow",
      websearch: "allow",
      lsp: "allow",
    },
  };
  if (instructions) {
    agent.prompt = instructions;
  }

  const agents = (config.agent ?? {}) as Record<string, unknown>;
  agents["ask-read-only"] = agent;
  config.agent = agents;
  config.share = "disabled";

  return JSON.stringify(config);
}

export function createOpenCode(program: string): Harness {
  return {
    async models(): Promise<Model[]> {
      const { code, stdout, stderr } = await capture(program, [
        "--pure",
        "models",
      ]);
      if (code !== 0) {
        throw new Error(
          stderr.trim() || "could not list OpenCode models"
        );
      }
      const models = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((id) => {
          const slash = id.indexOf("/");
          const provider = slash >= 0 ? id.slice(0, slash) : "";
          const name = slash >= 0 ? id.slice(slash + 1) : id;
          return {
            id,
            name,
            description: provider ? `${provider} provider` : "",
            isDefault: false,
            reasoning: [] as ReasoningLevel[],
          } satisfies Model;
        });
      if (models.length === 0) {
        throw new Error("OpenCode did not report any available models");
      }
      return models;
    },

    async ask(
      question: string,
      sessionId: string | null,
      options: RunOptions,
      onDelta: (delta: string) => void
    ): Promise<HarnessResponse> {
      const agentId = "ask-read-only";

      const existingConfig = process.env.OPENCODE_CONFIG_CONTENT;
      const config = buildOpenCodeConfig(
        existingConfig,
        options.instructions
      );

      const args = [
        "--pure",
        "run",
        "--agent",
        agentId,
        "--format",
        "json",
      ];
      if (sessionId) {
        args.push("--session", sessionId);
      }
      if (options.model) {
        args.push("--model", options.model);
      }
      args.push(question);

      const child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: config,
          OPENCODE_AUTO_SHARE: "false",
        },
      });

      let answer = "";
      let resultSessionId = sessionId ?? "";
      let reportedError: string | null = null;
      const stderrChunks: Buffer[] = [];

      const exitCode = await runChild(
        child,
        (chunk) => {
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.trim() === "") continue;
            try {
              const event = JSON.parse(line);
              if (!resultSessionId && event.sessionID) {
                resultSessionId = event.sessionID;
              }
              if (event.type === "text" && event.part?.text) {
                answer += event.part.text;
                onDelta(event.part.text);
              }
              if (event.type === "error") {
                reportedError =
                  event.error?.data?.message ??
                  event.error?.message ??
                  event.error?.name ??
                  "unknown error";
              }
            } catch {
              // skip non-JSON lines
            }
          }
        },
        (chunk) => {
          stderrChunks.push(chunk);
        }
      );

      const stderrStr = Buffer.concat(stderrChunks).toString().trim();

      if (exitCode !== 0 && !reportedError) {
        if (stderrStr) {
          throw new Error(`OpenCode failed: ${stderrStr}`);
        }
        throw new Error(`OpenCode exited with code ${exitCode}`);
      }

      if (reportedError) {
        throw new Error(`OpenCode reported an error: ${reportedError}`);
      }

      if (!answer) {
        throw new Error("OpenCode completed without returning an answer");
      }

      if (!resultSessionId) {
        throw new Error(
          "OpenCode completed without returning a session ID"
        );
      }

      return { answer, sessionId: resultSessionId };
    },
  };
}

export const opencodeDefinition: Definition = {
  id: "opencode",
  aliases: ["open-code"],
  name: "OpenCode",
  description: "OpenCode coding agent",
  reasoning: {
    type: "managed",
    label: "Managed by OpenCode",
    explanation:
      "OpenCode manages reasoning through model-specific variants.",
  },
  programEnv: "OK_OPENCODE_BIN",
  create: createOpenCode,
};
