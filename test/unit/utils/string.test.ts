import { describe, expect, it } from 'vitest';
import {
  capitalizeFirstLetter,
  removeTrailingPeriod
} from '../../../src/utils/string';

describe('capitalizeFirstLetter', () => {
  it.each([
    ['hello', 'Hello'],
    ['Hello', 'Hello'],
    ['a', 'A'],
    ['', ''],
    ['1 error', '1 error']
  ])('%j -> %j', (input, expected) => {
    expect(capitalizeFirstLetter(input)).toBe(expected);
  });
});

describe('removeTrailingPeriod', () => {
  it.each([
    ['done.', 'done'],
    ['done', 'done'],
    ['done..', 'done.'],
    ['.', ''],
    ['', ''],
    ['a.b', 'a.b']
  ])('%j -> %j', (input, expected) => {
    expect(removeTrailingPeriod(input)).toBe(expected);
  });
});
