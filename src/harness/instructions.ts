/**
 * Map ok's merged `instructions` string onto each harness CLI.
 *
 * Prefer append-style flags so harness defaults (tools, safety) stay intact.
 * fx is the exception: it only exposes `--system`, which replaces the compiled
 * prompt for that invocation.
 */
export function instructionCliArgs(
  harnessId: string,
  instructions: string | undefined
): string[] {
  if (!instructions) return [];

  switch (harnessId) {
    case "claude":
      return ["--append-system-prompt", instructions];
    case "codex":
      return ["-c", codexDeveloperInstructions(instructions)];
    case "fx":
      return ["--system", instructions];
    case "pi":
      return ["--append-system-prompt", instructions];
    default:
      return [];
  }
}

/** Codex `-c` override for developer (system) instructions. */
export function codexDeveloperInstructions(instructions: string): string {
  return `developer_instructions=${JSON.stringify(instructions)}`;
}
