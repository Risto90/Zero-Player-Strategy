const files = new Map();

export class File {
  constructor(_directory, name) {
    this.name = name;
  }

  get exists() {
    return files.has(this.name);
  }

  create() {
    files.set(this.name, new Uint8Array());
  }

  async write(bytes) {
    files.set(this.name, Uint8Array.from(bytes));
  }

  async bytes() {
    return Uint8Array.from(files.get(this.name) ?? []);
  }

  move(destination) {
    files.set(destination.name, files.get(this.name));
    files.delete(this.name);
  }

  delete() {
    files.delete(this.name);
  }
}
export const Paths = { document: '/tmp' };
