import { describe, test, expect } from '@jest/globals';
import { checkSwiftBridge } from '../dist/shared/swift.js';

describe('swift bridge', () => {
  test('checkSwiftBridge returns null when binary exists or error when missing', async () => {
    const result = await checkSwiftBridge();
    // null means binary found, string means error
    if (result === null) {
      // Binary was built — no error
      expect(result).toBeNull();
    } else {
      expect(result).toContain('Swift bridge not found');
      expect(result).toContain('swift-build');
    }
  });
});
