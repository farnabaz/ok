export const ISSUE_URL = "https://github.com/farnabaz/ok/issues";

export class OkError extends Error {
  private help: string;

  constructor(message: string, help: string) {
    super(message);
    this.name = "OkError";
    this.help = help;
  }

  static new(message: string, help: string): OkError {
    return new OkError(message, help);
  }

  static usage(message: string): OkError {
    return new OkError(message, "run 'ok --help' for usage");
  }

  static terminal(action: string, error: unknown): OkError {
    return new OkError(
      `${action}: ${error}`,
      "restart ok in an interactive terminal and try again"
    );
  }

  static agent(command: string, message: string): OkError {
    return new OkError(
      message,
      `run '${command}' directly to fix it, then try again`
    );
  }

  static internal(message: string): OkError {
    return new OkError(
      message,
      `try again; if it keeps happening, report it at ${ISSUE_URL}`
    );
  }

  context(ctx: string): this {
    this.message = `${ctx}: ${this.message}`;
    return this;
  }

  detail(d: string): this {
    this.message = `${this.message}: ${d}`;
    return this;
  }

  print(): void {
    process.stderr.write(`ok: ${this.message}\n`);
    process.stderr.write(`    ${this.help}\n`);
  }

  getHelp(): string {
    return this.help;
  }
}

export type Result<T> = T | OkError;
