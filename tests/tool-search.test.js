import { describe, test, expect } from '@jest/globals';
import { isToolSearchIndexed, semanticToolSearch } from '../dist/shared/tool-search.js';

describe('tool-search', () => {
  test('isToolSearchIndexed returns false before indexing', () => {
    expect(isToolSearchIndexed()).toBe(false);
  });

  test('semanticToolSearch returns empty array when not indexed', async () => {
    const results = await semanticToolSearch('calendar events');
    expect(results).toEqual([]);
  });
});
