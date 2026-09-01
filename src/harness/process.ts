import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

export function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function executableAvailable(program: string): boolean {
  if (program.includes(path.sep)) {
    return isExecutable(program);
  }
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  return pathDirs.some((dir) => isExecutable(path.join(dir, program)));
}

/** Collect stdout + stderr concurrently, then wait for exit. */
export async function runChild(
  child: ReturnType<typeof spawn>,
  onStdout: (chunk: string) => void,
  onStderr: (chunk: Buffer) => void
): Promise<number> {
  const stdoutPromise = new Promise<void>((resolve) => {
    child.stdout!.on("data", (chunk: Buffer) => onStdout(chunk.toString()));
    child.stdout!.on("end", () => resolve());
    child.stdout!.on("error", () => resolve());
  });

  const stderrPromise = new Promise<void>((resolve) => {
    child.stderr!.on("data", (chunk: Buffer) => onStderr(chunk));
    child.stderr!.on("end", () => resolve());
    child.stderr!.on("error", () => resolve());
  });

  const exitPromise = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  const [, , exitCode] = await Promise.all([
    stdoutPromise,
    stderrPromise,
    exitPromise,
  ]);
  return exitCode;
}

export async function capture(
  program: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    return {
      code: 0,
      stdout,
      stderr,
    };
  } catch (err: unknown) {
    const e = err as {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const toStr = (v: string | Buffer | undefined, fallback = "") => {
      if (v === undefined) return fallback;
      return typeof v === "string" ? v : v.toString();
    };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: toStr(e.stdout),
      stderr: toStr(e.stderr, e.message ?? ""),
    };
  }
}
