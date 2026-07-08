/**
 * Factory for valid AirMcpConfig objects used in tests.
 *
 * Shape mirrors src/shared/config.ts AirMcpConfig interface:
 *   profile, toolExposure, progressiveTools, modulePacks,
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
    progressiveTools: new Set([
      'profile_status',
      'list_profiles',
      'list_module_packs',
      'workflow_readiness',
      'discover_tools',
      'run_tool',
    ]),
    modulePacks: new Set(['core', 'communications', 'productivity', 'browser', 'media', 'visual', 'location', 'device', 'intelligence', 'google-workspace', 'spatial']),
    modulePacksConfigured: false,
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
