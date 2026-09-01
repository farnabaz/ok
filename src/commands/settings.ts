import { OkError } from "../error.js";
import { runOnboarding } from "./onboard.js";

export async function runSettings(): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw OkError.new(
      "--settings requires an interactive terminal",
      "rerun 'ok --settings' from a terminal"
    );
  }
  // Re-run onboarding to pick harness + model
  await runOnboarding();
}
