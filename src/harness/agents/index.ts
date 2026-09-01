import type { Definition } from "../types.js";
import { fxDefinition } from "./fx.js";
import { codexDefinition } from "./codex.js";
import { claudeDefinition } from "./claude.js";
import { opencodeDefinition } from "./opencode.js";
import { piDefinition } from "./pi.js";

/** Registered harnesses. Add a new agent by exporting a Definition and appending it here. */
export const definitions: Definition[] = [
  fxDefinition,
  codexDefinition,
  claudeDefinition,
  opencodeDefinition,
  piDefinition,
];
