import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

export function createFx(program: string): Harness {
  return {
    async models(): Promise<Model[]> {
      const { code, stdout, stderr } = await capture(program, [
        "models",
        "--json",
      ]);
      if (code !== 0) {
        throw new Error(stderr.trim() || "could not list fx models");
      }

      let ids: string[] = [];
      try {
        const parsed = JSON.parse(stdout) as {
          ids?: string[];
          kind?: string;
        };
        if (Array.isArray(parsed.ids)) {
          ids = parsed.ids;
        }
      } catch {
        // fall back to text lines: " - provider/model"
        ids = stdout
          .split("\n")
          .map((line) => line.replace(/^\s*-\s*/, "").trim())
          .filter((line) => line.includes("/") && !line.startsWith("["));
      }

      // Prefer the user's current fx default first when available.
      let defaultId: string | undefined;
      try {
        const settingsPath = path.join(os.homedir(), ".fx", "settings.json");
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(
            fs.readFileSync(settingsPath, "utf-8")
          ) as { model?: string };
          if (settings.model) defaultId = settings.model;
        }
      } catch {
        // ignore
      }

      const models: Model[] = ids.map((id) => {
        const slash = id.indexOf("/");
        const provider = slash >= 0 ? id.slice(0, slash) : "";
        const name = slash >= 0 ? id.slice(slash + 1) : id;
        return {
          id,
          name,
          description: provider ? `${provider} provider` : "",
          isDefault: defaultId ? id === defaultId : false,
          reasoning: [] as ReasoningLevel[],
        } satisfies Model;
      });

      if (models.length === 0) {
        throw new Error("fx did not report any available models");
      }

      // Surface the default model near the top of the list for onboarding.
      const defaultIndex = models.findIndex((m) => m.isDefault);
      if (defaultIndex > 0) {
        const [def] = models.splice(defaultIndex, 1);
        models.unshift(def!);
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
        "--json",
        ...instructionCliArgs("fx", options.instructions),
      ];
      if (sessionId) {
        args.push("--resume-id", sessionId);
      }
      // Keep ask read-leaning: auto permission review, no yolo.
      args.push("--auto", "--", question);

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (options.model) {
        env.FX_MODEL = options.model;
      }
      // Prefer a tighter permission mode when the install supports it.
      if (!env.FX_PERMISSION_MODE) {
        env.FX_PERMISSION_MODE = "auto";
      }

      const child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      let stdout = "";
      const stderrChunks: Buffer[] = [];

      const exitCode = await runChild(
        child,
        (chunk) => {
          stdout += chunk;
        },
        (chunk) => {
          stderrChunks.push(chunk);
        }
      );

      const stderrStr = Buffer.concat(stderrChunks).toString().trim();

      let payload: {
        output?: string;
        exit_code?: number;
        model?: string;
        session_id?: string;
        error?: string;
      };
      try {
        // stdout may include notices before the JSON object — take the last {...}
        const start = stdout.lastIndexOf("{");
        const end = stdout.lastIndexOf("}");
        if (start < 0 || end < start) {
          throw new Error("no json");
        }
        payload = JSON.parse(stdout.slice(start, end + 1));
      } catch {
        const detail = stderrStr || stdout.trim();
        throw new Error(
          detail
            ? `fx failed: ${detail}`
            : `fx exited with code ${exitCode} without JSON output`
        );
      }

      if (payload.error) {
        throw new Error(`fx error: ${payload.error}`);
      }

      if (
        exitCode !== 0 ||
        (typeof payload.exit_code === "number" && payload.exit_code !== 0)
      ) {
        throw new Error(
          stderrStr ||
            payload.output ||
            `fx exited with code ${payload.exit_code ?? exitCode}`
        );
      }

      const answer = (payload.output ?? "").trimEnd();
      if (!answer) {
        throw new Error("fx completed without returning an answer");
      }

      // Non-streaming JSON reply — emit once so callers still see content.
      onDelta(answer);

      const resultSessionId =
        payload.session_id && payload.session_id.length > 0
          ? payload.session_id
          : (sessionId ?? `fx-${Date.now()}`);

      return { answer, sessionId: resultSessionId };
    },
  };
}

export const fxDefinition: Definition = {
  id: "fx",
  aliases: [],
  name: "fx",
  description: "Vercel Labs fx (fx.sh)",
  reasoning: {
    type: "managed",
    label: "Managed by fx",
    explanation:
      "fx manages reasoning effort through its model and provider settings.",
  },
  programEnv: "OK_FX_BIN",
  create: createFx,
};
