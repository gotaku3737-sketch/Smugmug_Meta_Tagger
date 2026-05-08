import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatPersonKeyword, parsePersonKeywords, mergeKeywords } from './types.ts';

describe('Keyword Helpers', () => {
  test('formatPersonKeyword should add PERSON_PREFIX to name', () => {
    assert.strictEqual(formatPersonKeyword('John Doe'), 'Person:John Doe');
    assert.strictEqual(formatPersonKeyword('Alice'), 'Person:Alice');
  });

  test('parsePersonKeywords should extract names from person tags', () => {
    const input = 'Person:John Doe; Person:Alice; vacation; hawaii';
    const expected = ['John Doe', 'Alice'];
    assert.deepStrictEqual(parsePersonKeywords(input), expected);
  });

  test('parsePersonKeywords should handle empty or null input', () => {
    assert.deepStrictEqual(parsePersonKeywords(''), []);
    // @ts-ignore
    assert.deepStrictEqual(parsePersonKeywords(null), []);
  });

  test('parsePersonKeywords should handle whitespace and extra semicolons', () => {
    const input = '  Person:John Doe  ; ; Person:Alice ; ';
    const expected = ['John Doe', 'Alice'];
    assert.deepStrictEqual(parsePersonKeywords(input), expected);
  });

  describe('mergeKeywords', () => {
    test('should add new person tags to existing keywords', () => {
      const existing = 'vacation; hawaii';
      const names = ['John Doe', 'Alice'];
      const result = mergeKeywords(existing, names);
      assert.strictEqual(result, 'vacation; hawaii; Person:John Doe; Person:Alice');
    });

    test('should replace existing person tags', () => {
      const existing = 'Person:Old Friend; vacation; Person:Removed';
      const names = ['New Friend'];
      const result = mergeKeywords(existing, names);
      assert.strictEqual(result, 'vacation; Person:New Friend');
    });

    test('should handle empty existing keywords', () => {
      const existing = '';
      const names = ['John Doe'];
      const result = mergeKeywords(existing, names);
      assert.strictEqual(result, 'Person:John Doe');
    });

    test('should handle empty names list', () => {
      const existing = 'vacation; Person:Someone';
      const names: string[] = [];
      const result = mergeKeywords(existing, names);
      assert.strictEqual(result, 'vacation');
    });
  });
});
