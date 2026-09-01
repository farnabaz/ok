import { OkError } from "../error.js";
import { agentName } from "../harness/index.js";
import {
  latestSession,
  loadAllSessions,
  deleteSession,
  type Session,
} from "../session/index.js";
import { choose, prepareStdin, age, truncate, type SelectItem } from "../ui/index.js";
import { runInteractive } from "./interactive.js";
import { runOneShot } from "./ask.js";

export async function runContinue(words: string[]): Promise<void> {
  const cwd = process.cwd();
  const session = latestSession(cwd);

  if (!session) {
    throw OkError.new(
      "no saved sessions for this folder",
      "start one by running 'ok'"
    );
  }

  if (words.length === 0) {
    await runInteractive(session);
  } else {
    await runOneShot(words.join(" "), session);
  }
}

export async function runSessions(): Promise<void> {
  let sessions = loadAllSessions();

  if (sessions.length === 0) {
    process.stdout.write("No saved sessions.\n");
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    listSessions(sessions);
    return;
  }

  while (sessions.length > 0) {
    const items = sessionItems(sessions);
    const pick = await choose(
      "Sessions",
      "Continue a saved conversation",
      items,
      0,
      {
        actions: {
          d: {
            label: "delete",
            run(index) {
              const removed = sessions[index]!;
              deleteSession(removed);
              sessions.splice(index, 1);
              if (sessions.length === 0) {
                process.stderr.write("\nNo saved sessions.\n");
              }
              return true;
            },
          },
        },
      }
    );

    if (pick === "refresh") continue;
    if (pick === null) return;

    prepareStdin();
    await runInteractive(sessions[pick]!);
    return;
  }
}

function sessionItems(sessions: Session[]): SelectItem[] {
  return sessions.map((s) => {
    const preview =
      s.turns.length > 0
        ? truncate(s.turns[s.turns.length - 1]!.user, 28)
        : "Empty session";
    const turns = `${s.turns.length} turn${s.turns.length === 1 ? "" : "s"}`;
    const profile = s.profile ? `${s.profile} · ` : "";
    return {
      label: preview,
      detail: `${profile}${agentName(s.harness)} · ${age(s.updatedAt)} · ${turns}`,
    };
  });
}

function listSessions(sessions: Session[]): void {
  for (const session of sessions) {
    const line = `${agentName(session.harness).padEnd(6)}  ${String(session.turns.length).padStart(3)} turn${session.turns.length === 1 ? " " : "s"}  ${age(session.updatedAt).padStart(8)}  ${session.cwd}\n`;
    process.stdout.write(line);
  }
}
