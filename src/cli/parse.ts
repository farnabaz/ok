import { OkError } from "../error.js";

export const HELP = `One command. Any agent.

Usage:
  ok [QUESTION...]
  ok @agent [QUESTION...]
  ok agent [QUESTION...]
  ok -c [QUESTION...]
  ok --sessions
  ok --agents [new]
  ok --settings

With no question, ok starts an interactive session.

Named agents (defined under "agents" in settings):
  ok @weer fix the tests     invoke agent "weer"
  ok weer fix the tests      same, when bare invoke is enabled

Options:
  -c, --continue      Continue the latest session here
  -s, --sessions      Choose a saved session to continue
      --agents        List agents — enter to use, n new, d delete
      --agents new    Create a named agent interactively
      --settings      Configure defaults and instructions
  -h, --help          Print help
  -V, --version       Print version`;

export type Mode =
  | { type: "interactive" }
  | { type: "one_shot"; question: string }
  | { type: "continue"; words: string[] }
  | { type: "sessions" }
  | { type: "agents"; words: string[] }
  | { type: "settings" }
  | { type: "help" }
  | { type: "version" };

export function parse(args: string[]): Mode {
  const words: string[] = [];
  let options = true;
  let resume = false;
  let sessions = false;
  let agents = false;
  let settings = false;

  for (const arg of args) {
    if (options) {
      switch (arg) {
        case "--":
          options = false;
          continue;
        case "-h":
        case "--help":
          return { type: "help" };
        case "-V":
        case "--version":
          return { type: "version" };
        case "-c":
        case "--continue":
          if (resume) throw OkError.usage("use '--continue' only once");
          resume = true;
          continue;
        case "-s":
        case "--sessions":
          sessions = true;
          continue;
        case "--agents":
          if (agents) throw OkError.usage("use '--agents' only once");
          agents = true;
          continue;
        case "--settings":
          settings = true;
          continue;
        case "--agent-create":
          throw OkError.new(
            "--agent-create was removed",
            "use 'ok --agents new' instead"
          );
        case "--upgrade":
          throw OkError.new(
            "--upgrade was removed",
            "update ok with your package manager"
          );
        default:
          if (arg.startsWith("-")) {
            throw OkError.usage(`unknown option '${arg}'`);
          }
      }
    }
    words.push(arg);
  }

  if (sessions && resume) {
    throw OkError.usage("--sessions cannot be combined with --continue");
  }
  if (agents && resume) {
    throw OkError.usage("--agents cannot be combined with --continue");
  }
  if (sessions && agents) {
    throw OkError.usage("--sessions cannot be combined with --agents");
  }
  if (sessions && words.length > 0) {
    throw OkError.new(
      "--sessions does not accept a question",
      "run 'ok --sessions' by itself"
    );
  }
  if (agents && words.length > 0 && !(words.length === 1 && words[0] === "new")) {
    throw OkError.new(
      "--agents accepts no arguments, or 'new' to create",
      "run 'ok --agents' or 'ok --agents new'"
    );
  }
  if (settings && (sessions || agents || resume || words.length > 0)) {
    throw OkError.new(
      "--settings cannot be combined with other arguments",
      "run 'ok --settings' by itself"
    );
  }

  if (settings) return { type: "settings" };
  if (agents) return { type: "agents", words };
  if (sessions) return { type: "sessions" };
  if (resume) return { type: "continue", words };
  if (words.length === 0) return { type: "interactive" };
  return { type: "one_shot", question: words.join(" ") };
}
