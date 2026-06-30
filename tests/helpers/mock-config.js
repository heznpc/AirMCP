/**
 * Factory for valid AirMcpConfig objects used in tests.
 *
 * Shape mirrors src/shared/config.ts AirMcpConfig interface:
 *   profile, toolExposure, progressiveTools,
 *   includeShared, disabledModules, shareApprovalModules,
 *   allowSendMessages, allowSendMail, allowRunJavascript, hitl
 */
export function createMockConfig(overrides = {}) {
  const {
    disabledModules = [],
    shareApprovalModules = [],
    ...rest
  } = overrides;

  return {
    profile: 'starter',
    toolExposure: 'profile',
    progressiveTools: new Set(['profile_status', 'list_profiles', 'discover_tools', 'run_tool']),
    includeShared: false,
    disabledModules: new Set(disabledModules),
    shareApprovalModules: new Set(shareApprovalModules),
    allowSendMessages: false,
    allowSendMail: false,
    allowRunJavascript: false,
    hitl: {
      level: 'off',
      whitelist: new Set(),
      timeout: 30,
      socketPath: '',
    },
    ...rest,
  };
}
