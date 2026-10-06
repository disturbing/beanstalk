import { describe, expect, it } from 'vitest';

import { GatewayError } from '../errors';
import { compileGrep, lineMatches, MAX_TESTED_LINE_CHARS } from './grep-pattern';

const regex = { regex: true } as const;
const literal = { regex: false } as const;

describe('compileGrep', () => {
  it('matches a pattern as a literal by default', () => {
    const matcher = compileGrep('a.b(c)+', literal);
    expect(lineMatches(matcher, 'x a.b(c)+ y')).toBe(true);
    expect(lineMatches(matcher, 'aXb(c)+')).toBe(false);
  });

  it('allows the safe regex subset', () => {
    const matcher = compileGrep(String.raw`toFixed|money\(`, regex);
    expect(lineMatches(matcher, 'money(1)')).toBe(true);
    expect(lineMatches(compileGrep('^(?:ab)?c[a-z]+d{2,3}$', regex), 'cabdd')).toBe(true);
  });

  it.each([
    '(a+)+$',
    '(a*)*b',
    '(a|aa)+$',
    '((a+))+',
    '(a{2,})*',
    String.raw`(a)\1`,
    '(?<=a)b',
    '(?<!a)b',
  ])('rejects the backtracking pattern %s', (pattern) => {
    expect(() => compileGrep(pattern, regex)).toThrow(GatewayError);
  });

  it('does not read a quantifier inside a character class or an escape as a repeat', () => {
    expect(() => compileGrep(String.raw`([+*])+`, regex)).not.toThrow();
    expect(() => compileGrep(String.raw`(\+)+`, regex)).not.toThrow();
  });

  it('rejects an empty, an overlong and an invalid pattern', () => {
    expect(() => compileGrep('', literal)).toThrow(GatewayError);
    expect(() => compileGrep('a'.repeat(201), literal)).toThrow(GatewayError);
    expect(() => compileGrep('[', regex)).toThrow(GatewayError);
  });
});

describe('lineMatches', () => {
  it('ignores what lies beyond the tested length', () => {
    const matcher = compileGrep('needle', literal);
    const line = `${'x'.repeat(MAX_TESTED_LINE_CHARS)}needle`;
    expect(lineMatches(matcher, line)).toBe(false);
  });
});
