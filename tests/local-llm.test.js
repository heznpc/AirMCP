import { describe, test, expect } from '@jest/globals';
import { checkOllama, ollamaModels } from '../dist/shared/local-llm.js';

describe('local-llm', () => {
  test('checkOllama returns a boolean', async () => {
    const available = await checkOllama();
    expect(typeof available).toBe('boolean');
  });

  test('ollamaModels returns an array', async () => {
    const models = await ollamaModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test('ollamaModels returns strings when available', async () => {
    const models = await ollamaModels();
    for (const m of models) {
      expect(typeof m).toBe('string');
    }
  });
});
