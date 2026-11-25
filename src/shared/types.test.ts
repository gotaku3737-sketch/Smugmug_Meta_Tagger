import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  PERSON_PREFIX,
  sanitizeKeywordPrefix,
  formatPersonKeyword,
  parsePersonKeywords,
  mergeKeywords,
  removePersonKeyword,
} from './types';

describe('Keyword Helpers', () => {
  test('sanitizeKeywordPrefix should strip semicolons, trim whitespace, and fall back to PERSON_PREFIX', () => {
    assert.strictEqual(sanitizeKeywordPrefix(), PERSON_PREFIX);
    assert.strictEqual(sanitizeKeywordPrefix('  Family:  '), 'Family:');
    assert.strictEqual(sanitizeKeywordPrefix('Face;Group:'), 'FaceGroup:');
    assert.strictEqual(sanitizeKeywordPrefix('   ;;;  '), PERSON_PREFIX);
  });

  test('formatPersonKeyword should add PERSON_PREFIX to name by default', () => {
    assert.strictEqual(formatPersonKeyword('John Doe'), 'Person:John Doe');
    assert.strictEqual(formatPersonKeyword('Alice'), 'Person:Alice');
  });

  test('formatPersonKeyword should support plain mode and custom prefixes', () => {
    assert.strictEqual(formatPersonKeyword('Jane Smith', { mode: 'plain' }), 'Jane Smith');
    assert.strictEqual(formatPersonKeyword('  Jane Smith  ', { mode: 'plain' }), 'Jane Smith');
    assert.strictEqual(
      formatPersonKeyword('Jane Smith', { mode: 'prefixed', prefix: 'Family:' }),
      'Family:Jane Smith'
    );
  });

  test('parsePersonKeywords should extract names from person tags', () => {
    const input = 'Person:John Doe; Person:Alice; vacation; hawaii';
    const expected = ['John Doe', 'Alice'];
    assert.deepStrictEqual(parsePersonKeywords(input), expected);
  });

  test('parsePersonKeywords should handle empty or null input', () => {
    assert.deepStrictEqual(parsePersonKeywords(''), []);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    assert.deepStrictEqual(parsePersonKeywords(null), []);
  });

  test('parsePersonKeywords should handle whitespace and extra semicolons', () => {
    const input = '  Person:John Doe  ; ; Person:Alice ; ';
    const expected = ['John Doe', 'Alice'];
    assert.deepStrictEqual(parsePersonKeywords(input), expected);
  });

  test('parsePersonKeywords should support custom prefix and plain mode', () => {
    const customInput = 'Family:Jane Smith; Person:Ignored; vacation';
    assert.deepStrictEqual(
      parsePersonKeywords(customInput, { mode: 'prefixed', prefix: 'Family:' }),
      ['Jane Smith']
    );

    const plainInput = 'Jane Smith; vacation; John Doe';
    assert.deepStrictEqual(
      parsePersonKeywords(plainInput, { mode: 'plain' }),
      ['Jane Smith', 'vacation', 'John Doe']
    );
    assert.deepStrictEqual(
      parsePersonKeywords(plainInput, {
        mode: 'plain',
        previousPersonNames: ['jane smith', 'John Doe'],
      }),
      ['Jane Smith', 'John Doe']
    );
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

    test('should support plain mode while preserving non-person keywords and replacing previousPersonNames', () => {
      const existing = 'Old Person; vacation; hawaii; Jane Smith';
      const result = mergeKeywords(existing, ['Jane Smith', 'John Doe'], {
        mode: 'plain',
        previousPersonNames: ['Old Person', 'Jane Smith'],
      });
      assert.strictEqual(result, 'vacation; hawaii; Jane Smith; John Doe');
    });

    test('should avoid duplicate tags when re-uploading in plain mode without previousPersonNames', () => {
      const existing = 'vacation; jane smith; hawaii';
      const result = mergeKeywords(existing, ['Jane Smith', 'John Doe'], {
        mode: 'plain',
      });
      assert.strictEqual(result, 'vacation; hawaii; Jane Smith; John Doe');
    });

    test('should support custom prefix and preserve unrelated keywords', () => {
      const existing = 'Family:Old Name; vacation; hawaii';
      const result = mergeKeywords(existing, ['Jane Smith', 'John Doe'], {
        mode: 'prefixed',
        prefix: 'Family:',
      });
      assert.strictEqual(result, 'vacation; hawaii; Family:Jane Smith; Family:John Doe');
    });

    test('should deduplicate duplicate entries in personNames', () => {
      const result = mergeKeywords('vacation', ['Jane Smith', '  jane smith ', 'John Doe', '']);
      assert.strictEqual(result, 'vacation; Person:Jane Smith; Person:John Doe');
    });
  });

  describe('removePersonKeyword', () => {
    test('should remove only the target prefixed person keyword while preserving others', () => {
      const existing = 'vacation; Person:Jane Smith; Person:John Doe; hawaii';
      const result = removePersonKeyword(existing, 'Jane Smith');
      assert.deepStrictEqual(result, {
        keywords: 'vacation; Person:John Doe; hawaii',
        removed: true,
      });
    });

    test('should support plain mode and custom prefixes without removing non-matching keywords', () => {
      const plainRes = removePersonKeyword('vacation; Jane Smith; John Doe', 'jane smith', { mode: 'plain' });
      assert.deepStrictEqual(plainRes, {
        keywords: 'vacation; John Doe',
        removed: true,
      });

      const customRes = removePersonKeyword('Family:Jane Smith; Person:Jane Smith', 'Jane Smith', {
        mode: 'prefixed',
        prefix: 'Family:',
      });
      assert.deepStrictEqual(customRes, {
        keywords: 'Person:Jane Smith',
        removed: true,
      });

      const missingRes = removePersonKeyword('vacation; Person:John Doe', 'Jane Smith');
      assert.deepStrictEqual(missingRes, {
        keywords: 'vacation; Person:John Doe',
        removed: false,
      });
    });
  });
});
