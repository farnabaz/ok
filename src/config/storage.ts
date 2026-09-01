import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export function writePrivate(
  filePath: string,
  data: Buffer | string,
  _subject: string
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms that ignore mode
  }

  const filename = path.basename(filePath);
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tempPath = path.join(dir, `.${filename}.${nonce}.tmp`);

  try {
    fs.writeFileSync(tempPath, data, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/** App data directory (~/.ok). Delete this to reset ok. */
export function getDataDir(): string {
  if (process.env.OK_DATA && process.env.OK_DATA.length > 0) {
    return process.env.OK_DATA;
  }
  return path.join(os.homedir(), ".ok");
}

export function getStateDir(): string {
  return getDataDir();
}

/**
 * Settings file path. Defaults to ~/.ok/setting.json.
 * Override with OK_CONFIG for a custom file path.
 */
export function getConfigPath(): string {
  if (process.env.OK_CONFIG && process.env.OK_CONFIG.length > 0) {
    return process.env.OK_CONFIG;
  }
  return path.join(getDataDir(), "setting.json");
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/** Display a path with $HOME collapsed to ~. */
export function displayPath(p: string): string {
  const home = process.env.HOME ?? os.homedir();
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}
