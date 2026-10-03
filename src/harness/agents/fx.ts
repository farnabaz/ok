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

/** JSON payload from `fx ask --json` (fx ≥0.0.7 includes `final_output`). */
interface FxAskPayload {
  output?: string;
  final_output?: string;
  exit_code?: number;
  model?: string;
  session_id?: string;
  error?: string;
  resolved_provider?: string | null;
}

interface FxSettings {
  provider?: string;
  model?: string;
  codex_model?: string;
  grok_model?: string;
  models?: Record<string, string | undefined>;
}

/** Resolve the user's current fx default model from status or settings. */
async function resolveDefaultModelId(
  program: string
): Promise<string | undefined> {
  const { code, stdout } = await capture(program, ["status", "--json"]);
  if (code === 0) {
    try {
      const status = JSON.parse(stdout) as { model?: string };
      if (typeof status.model === "string" && status.model.length > 0) {
        return status.model;
      }
    } catch {
      // fall through to settings.json
    }
  }

  try {
    const settingsPath = path.join(os.homedir(), ".fx", "settings.json");
    if (!fs.existsSync(settingsPath)) return undefined;
    const settings = JSON.parse(
      fs.readFileSync(settingsPath, "utf-8")
    ) as FxSettings;
    const provider = settings.provider ?? "gateway";
    const fromMap = settings.models?.[provider];
    if (typeof fromMap === "string" && fromMap.length > 0) return fromMap;
    // Legacy single-key fields still accepted by fx.
    if (settings.model) return settings.model;
    if (provider === "codex" && settings.codex_model) return settings.codex_model;
    if (provider === "grok" && settings.grok_model) return settings.grok_model;
  } catch {
    // ignore
  }

  return undefined;
}

/** Extract the JSON object fx writes to stdout (may be preceded by notices). */
function parseFxAskJson(stdout: string): FxAskPayload {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("no json");

  try {
    return JSON.parse(trimmed) as FxAskPayload;
  } catch {
    // Prefer the last complete {...} block when notices precede JSON.
    const start = trimmed.lastIndexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("no json");
    return JSON.parse(trimmed.slice(start, end + 1)) as FxAskPayload;
  }
}

/** Prefer completed final response; fall back to accumulated assistant Markdown. */
function answerFromPayload(payload: FxAskPayload): string {
  const finalOutput = (payload.final_output ?? "").trimEnd();
  if (finalOutput) return finalOutput;
  return (payload.output ?? "").trimEnd();
}

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

      const defaultId = await resolveDefaultModelId(program);

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
      // fx 0.0.11+ documents ask flags after `ask`: --model, --effort, --resume.
      // Gateway traffic uses the coding-agent catalog/credits routes and the
      // v4 language-model chat endpoint; CLI surface is unchanged aside from
      // preferring these flags and reading `final_output` from --json.
      const args = [
        "ask",
        "--json",
        ...instructionCliArgs("fx", options.instructions),
      ];
      if (options.model) {
        args.push("--model", options.model);
      }
      if (options.reasoning) {
        args.push("--effort", options.reasoning);
      }
      if (sessionId) {
        args.push("--resume", sessionId);
      }
      // Keep ask read-leaning: auto permission review, no full-access/yolo.
      args.push("--auto", "--", question);

      const env: NodeJS.ProcessEnv = { ...process.env };
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

      let payload: FxAskPayload;
      try {
        payload = parseFxAskJson(stdout);
      } catch {
        const detail = stderrStr || stdout.trim();
        throw new Error(
          detail
            ? `fx failed: ${detail}`
            : `fx exited with code ${exitCode} without JSON output`
        );
      }

      if (payload.error) {
        // Surface stderr auth/credits guidance from the coding-agent gateway.
        const detail = stderrStr
          ? `${payload.error}: ${stderrStr}`
          : payload.error;
        throw new Error(`fx error: ${detail}`);
      }

      if (
        exitCode !== 0 ||
        (typeof payload.exit_code === "number" && payload.exit_code !== 0)
      ) {
        throw new Error(
          stderrStr ||
            payload.output ||
            payload.final_output ||
            `fx exited with code ${payload.exit_code ?? exitCode}`
        );
      }

      const answer = answerFromPayload(payload);
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
