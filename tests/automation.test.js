import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock swift module
jest.unstable_mockModule('../dist/shared/swift.js', () => ({
  runSwift: jest.fn(),
  hasSwiftCommand: jest.fn(),
}));

// Mock jxa module
jest.unstable_mockModule('../dist/shared/jxa.js', () => ({
  runJxa: jest.fn(),
}));

const { runSwift, hasSwiftCommand } = await import('../dist/shared/swift.js');
const { runJxa } = await import('../dist/shared/jxa.js');
const { runAutomation } = await import('../dist/shared/automation.js');

describe('runAutomation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses Swift bridge when command is available', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    runSwift.mockResolvedValue({ data: 'from-swift' });

    const result = await runAutomation({
      swift: { command: 'get-clipboard', input: {} },
      jxa: () => 'JSON.stringify({data:"from-jxa"})',
    });

    expect(result).toEqual({ data: 'from-swift' });
    expect(hasSwiftCommand).toHaveBeenCalledWith('get-clipboard');
    expect(runSwift).toHaveBeenCalled();
    expect(runJxa).not.toHaveBeenCalled();
  });

  test('falls back to JXA when Swift command is not available', async () => {
    hasSwiftCommand.mockResolvedValue(false);
    runJxa.mockResolvedValue({ data: 'from-jxa' });

    const result = await runAutomation({
      swift: { command: 'nonexistent', input: {} },
      jxa: () => 'JSON.stringify({data:"from-jxa"})',
    });

    expect(result).toEqual({ data: 'from-jxa' });
    expect(runJxa).toHaveBeenCalled();
    expect(runSwift).not.toHaveBeenCalled();
  });

  test('falls back to JXA when Swift bridge fails', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    runSwift.mockRejectedValue(new Error('Swift bridge crashed'));
    runJxa.mockResolvedValue({ data: 'fallback' });

    const result = await runAutomation({
      swift: { command: 'get-clipboard', input: {} },
      jxa: () => 'JSON.stringify({data:"fallback"})',
    });

    expect(result).toEqual({ data: 'fallback' });
    expect(runSwift).toHaveBeenCalled();
    expect(runJxa).toHaveBeenCalled();
  });

  test('serializes Swift input as JSON', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    runSwift.mockResolvedValue({});

    await runAutomation({
      swift: { command: 'test-cmd', input: { key: 'value' } },
      jxa: () => '',
    });

    expect(runSwift).toHaveBeenCalledWith('test-cmd', '{"key":"value"}');
  });

  test('passes empty JSON when Swift input is undefined', async () => {
    hasSwiftCommand.mockResolvedValue(true);
    runSwift.mockResolvedValue({});

    await runAutomation({
      swift: { command: 'test-cmd' },
      jxa: () => '',
    });

    expect(runSwift).toHaveBeenCalledWith('test-cmd', '{}');
  });
});
