import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getFileMode } from '../../../src/utils/file';

const dir = fs.mkdtempSync(path.join(tmpdir(), 'lint-file-test-'));
const plain = path.join(dir, 'plain.txt');
const exe = path.join(dir, 'exe.sh');
const sub = path.join(dir, 'sub');
const link = path.join(dir, 'link');
fs.writeFileSync(plain, 'x');
fs.writeFileSync(exe, '#!/bin/sh\n');
fs.chmodSync(plain, 0o644);
fs.chmodSync(exe, 0o755);
fs.mkdirSync(sub);
fs.symlinkSync(plain, link);

afterAll(() => fs.rmSync(dir, { force: true, recursive: true }));

describe('getFileMode', () => {
  it('detects a plain file', () => {
    expect(getFileMode(plain, false)).toBe('100644');
  });

  it('detects an executable file', () => {
    expect(getFileMode(exe, true)).toBe('100755');
  });

  it('detects a directory', () => {
    expect(getFileMode(sub, true)).toBe('040000');
  });

  it('detects a symlink with lstat', () => {
    expect(getFileMode(link, true)).toBe('120000');
  });

  it('follows a symlink with stat', () => {
    expect(getFileMode(link, false)).toBe('100644');
  });

  it('throws for a missing file', () => {
    expect(() => getFileMode(path.join(dir, 'missing'), true)).toThrow();
  });

  it('throws for any other file type', () => {
    vi.spyOn(fs, 'lstatSync').mockReturnValue({
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false
    } as fs.Stats);
    expect(() => getFileMode('/dev/fifo', true)).toThrow(
      'Unknown file mode for /dev/fifo'
    );
  });
});
