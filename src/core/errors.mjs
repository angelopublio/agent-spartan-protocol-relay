// A Stop ends the run with a message for the human. `ok` marks a normal end, such as a
// completed task, which exits 0; every other Stop exits 2 and leaves the panes open.
export class Stop extends Error {
  constructor(message, { ok = false } = {}) {
    super(message);
    this.ok = ok;
  }
}

export function log(line) {
  process.stdout.write(`${new Date().toTimeString().slice(0, 8)} ${line}\n`);
}
