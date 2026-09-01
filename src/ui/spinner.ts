const FRAMES = [
  "⠋",
  "⠙",
  "⠚",
  "⠒",
  "⠂",
  "⠂",
  "⠒",
  "⠲",
  "⠴",
  "⠦",
  "⠖",
  "⠒",
  "⠐",
  "⠐",
  "⠒",
  "⠓",
];

export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  start(): void {
    if (this.active || !process.stderr.isTTY) return;
    this.active = true;
    process.stderr.write("\x1b[?25l"); // hide cursor
    this.timer = setInterval(() => {
      process.stderr.write(`\r\x1b[37m${FRAMES[this.frame]}\x1b[0m `);
      this.frame = (this.frame + 1) % FRAMES.length;
    }, 80);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stderr.write("\r \r\x1b[?25h"); // show cursor
  }
}
