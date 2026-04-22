/**
 * Centralized mock setup for platform dependencies (jxa, swift, automation).
 *
 * Usage:
 *   import { setupPlatformMocks } from './helpers/mock-runtime.js';
 *   const mocks = setupPlatformMocks();
 *   const { registerSomeTools } = await import('../dist/some-module/tools.js');
 *
 * Must be called BEFORE any dynamic import() of code under test,
 * because jest.unstable_mockModule must run before the module is loaded.
 */
import { jest } from '@jest/globals';

export function setupPlatformMocks() {
  const mockRunJxa = jest.fn();
  const mockRunAppleScript = jest.fn();
  jest.unstable_mockModule('../../dist/shared/jxa.js', () => ({
    runJxa: mockRunJxa,
    runAppleScript: mockRunAppleScript,
    osascriptSemaphore: { acquire: jest.fn().mockResolvedValue(undefined), release: jest.fn() },
  }));

  const mockRunSwift = jest.fn();
  const mockCheckSwiftBridge = jest.fn().mockResolvedValue('Swift bridge not available');
  const mockHasSwiftCommand = jest.fn().mockResolvedValue(false);
  const mockCloseSwiftBridge = jest.fn();
  jest.unstable_mockModule('../../dist/shared/swift.js', () => ({
    runSwift: mockRunSwift,
    checkSwiftBridge: mockCheckSwiftBridge,
    hasSwiftCommand: mockHasSwiftCommand,
    closeSwiftBridge: mockCloseSwiftBridge,
  }));

  const mockRunAutomation = jest.fn();
  jest.unstable_mockModule('../../dist/shared/automation.js', () => ({
    runAutomation: mockRunAutomation,
  }));

  return {
    mockRunJxa,
    mockRunAppleScript,
    mockRunSwift,
    mockCheckSwiftBridge,
    mockHasSwiftCommand,
    mockCloseSwiftBridge,
    mockRunAutomation,
  };
}
