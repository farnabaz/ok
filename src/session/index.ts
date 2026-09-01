import * as fs from "node:fs";
import * as path from "node:path";
import { getStateDir } from "../config/storage.js";
import { OkError } from "../error.js";

const SESSION_VERSION = 1;

export interface SessionSettings {
  model?: string;
  reasoning?: string;
}

export interface Turn {
  user: string;
  assistant: string;
}

export interface Session {
  /** Backend harness id (fx, codex, …). */
  harness: string;
  harnessSessionId: string;
  cwd: string;
  updatedAt: number;
  settings?: SessionSettings;
  /** User-defined agent name, when one was invoked. */
  profile?: string;
  turns: Turn[];
}

export function createSession(
  harness: string,
  harnessSessionId: string,
  cwd: string
): Session {
  return {
    harness,
    harnessSessionId,
    cwd,
    updatedAt: Math.floor(Date.now() / 1000),
    turns: [],
  };
}

export function addTurn(
  session: Session,
  user: string,
  assistant: string
): void {
  session.turns.push({ user, assistant });
  session.updatedAt = Math.floor(Date.now() / 1000);
}

function fileKey(harnessSessionId: string): string {
  return harnessSessionId.replace(/[^a-zA-Z0-9]/g, "");
}

function sessionsDir(): string {
  return path.join(getStateDir(), "sessions");
}

export function saveSession(session: Session): void {
  const dir = sessionsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${fileKey(session.harnessSessionId)}.json`);
  const data = JSON.stringify(sessionToJSON(session), null, 2);
  fs.writeFileSync(dest, data, { mode: 0o600 });
}

export function deleteSession(session: Session): void {
  const dir = sessionsDir();
  const filePath = path.join(
    dir,
    `${fileKey(session.harnessSessionId)}.json`
  );
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw OkError.new(
        `could not delete session '${filePath}': ${err}`,
        "check its permissions and try again"
      );
    }
  }
}

export function latestSession(cwd: string): Session | null {
  const sessions = loadAllSessions();
  const matching = sessions
    .filter((s) => s.cwd === cwd)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return matching[0] ?? null;
}

export function loadAllSessions(): Session[] {
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const sessions: Session[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      sessions.push(sessionFromJSON(json));
    } catch {
      // skip invalid session files
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

function sessionToJSON(session: Session): Record<string, unknown> {
  return {
    version: SESSION_VERSION,
    harness: session.harness,
    harness_session_id: session.harnessSessionId,
    cwd: session.cwd,
    updated_at: session.updatedAt,
    profile: session.profile ?? null,
    settings: session.settings
      ? {
          model: session.settings.model ?? null,
          reasoning: session.settings.reasoning ?? null,
        }
      : null,
    turns: session.turns.map((t) => ({
      user: t.user,
      assistant: t.assistant,
    })),
  };
}

function sessionFromJSON(value: Record<string, unknown>): Session {
  const version = typeof value.version === "number" ? value.version : 1;
  if (version !== SESSION_VERSION) {
    throw new Error(
      `session version ${version} is not supported (expected ${SESSION_VERSION})`
    );
  }

  const harness = value.harness as string;
  const harnessSessionId = value.harness_session_id as string;
  const cwd = value.cwd as string;
  const updatedAt = value.updated_at as number;
  const profile =
    typeof value.profile === "string" && value.profile.length > 0
      ? value.profile
      : undefined;

  const settings =
    value.settings && typeof value.settings === "object"
      ? {
          model:
            (value.settings as Record<string, unknown>).model as
              | string
              | undefined,
          reasoning:
            (value.settings as Record<string, unknown>).reasoning as
              | string
              | undefined,
        }
      : undefined;

  const turns = Array.isArray(value.turns)
    ? (value.turns as Array<Record<string, unknown>>).map((t) => ({
        user: t.user as string,
        assistant: t.assistant as string,
      }))
    : [];

  return {
    harness,
    harnessSessionId,
    cwd,
    updatedAt,
    profile,
    settings,
    turns,
  };
}
