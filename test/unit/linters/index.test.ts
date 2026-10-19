import { describe, expect, it } from 'vitest';
import linters from '../../../src/linters';

describe('linters registry', () => {
  it('runs linters/type checkers before formatters', () => {
    expect(Object.keys(linters)).toEqual([
      'clippy',
      'eslint',
      'mypy',
      'oxlint',
      'svelte',
      'tsc',
      'ty',
      'basedpyright',
      'autopep8',
      'ruff',
      'black',
      'oxfmt',
      'prettier',
      'rustfmt'
    ]);
  });

  it.each(Object.entries(linters))(
    '%s implements the Linter interface',
    (_, linter) => {
      expect(linter.linterName).toEqual(expect.any(String));
      expect(linter.linterName.length).toBeGreaterThan(0);
      expect(linter.verifySetup).toBeTypeOf('function');
      expect(linter.lint).toBeTypeOf('function');
      expect(linter.parseOutput).toBeTypeOf('function');
    }
  );
});
