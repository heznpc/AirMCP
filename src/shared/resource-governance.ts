export interface ResourceGovernanceHints {
  readOnlyHint: true;
  destructiveHint: false;
  sensitiveHint: boolean;
  openWorldHint: false;
}

const DEFAULT_RESOURCE_GOVERNANCE: ResourceGovernanceHints = {
  readOnlyHint: true,
  destructiveHint: false,
  sensitiveHint: false,
  openWorldHint: false,
};

// Governance classification is deliberately server-private. MCP resource
// config is returned by resources/list, so placing these hints in `_meta`
// would expose implementation policy to every connected client.
const resourceGovernance = new WeakMap<object, ResourceGovernanceHints>();

/** Clone a resource config and attach its classification out-of-band. */
export function withResourceGovernance<T extends Record<string, unknown>>(
  config: T,
  hints: Partial<ResourceGovernanceHints>,
): T {
  const classified = { ...config };
  resourceGovernance.set(classified, {
    ...DEFAULT_RESOURCE_GOVERNANCE,
    ...hints,
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  return classified;
}

/** Read server-private resource hints. Unclassified resources remain
 * read-only and non-sensitive, but still traverse rate-limit and audit. */
export function getResourceGovernance(config: unknown): ResourceGovernanceHints {
  if (!config || typeof config !== "object" || Array.isArray(config)) return DEFAULT_RESOURCE_GOVERNANCE;
  return resourceGovernance.get(config) ?? DEFAULT_RESOURCE_GOVERNANCE;
}

/** Resource activity uses the existing audit `tool` field under a collision-
 * free namespace, keeping the public audit kind enum backward-compatible. */
export function resourceAuditName(name: string): string {
  return `resource:${name}`;
}

/** Detect SDK ResourceTemplate registrations without depending on a private
 * SDK class identity (which can differ across package boundaries). */
export function isResourceTemplateRegistration(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const template = (value as { uriTemplate?: unknown }).uriTemplate;
    return Boolean(
      template &&
      typeof template === "object" &&
      !Array.isArray(template) &&
      Array.isArray((template as { variableNames?: unknown }).variableNames),
    );
  } catch {
    return false;
  }
}

const MAX_URI_LENGTH = 2_048;
const MAX_VARIABLE_KEYS = 32;
const MAX_VARIABLE_KEY_LENGTH = 100;
const MAX_VARIABLE_VALUE_LENGTH = 500;
const MAX_VARIABLE_ARRAY_LENGTH = 32;
const UNSAFE_VARIABLE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, maxLength);
}

function sanitizeTemplateVariables(value: unknown): Record<string, string | string[]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const sanitized: Record<string, string | string[]> = Object.create(null) as Record<string, string | string[]>;
  let accepted = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (
      accepted >= MAX_VARIABLE_KEYS ||
      key.length === 0 ||
      key.length > MAX_VARIABLE_KEY_LENGTH ||
      UNSAFE_VARIABLE_KEYS.has(key)
    ) {
      continue;
    }
    if (typeof raw === "string") {
      sanitized[key] = raw.slice(0, MAX_VARIABLE_VALUE_LENGTH);
      accepted += 1;
      continue;
    }
    if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
      sanitized[key] = raw.slice(0, MAX_VARIABLE_ARRAY_LENGTH).map((item) => item.slice(0, MAX_VARIABLE_VALUE_LENGTH));
      accepted += 1;
    }
  }
  return accepted > 0 ? sanitized : undefined;
}

/** Only URI/template variables enter governance logs and approval prompts;
 * resource contents and SDK RequestHandlerExtra objects are never copied. */
export function resourceRequestMetadata(args: unknown[], includeTemplateVariables = false): Record<string, unknown> {
  const uriValue = args[0];
  let uri: string | undefined;
  if (typeof uriValue === "string") {
    uri = boundedString(uriValue, MAX_URI_LENGTH);
  } else if (uriValue && typeof uriValue === "object") {
    try {
      uri = boundedString((uriValue as { href?: unknown }).href, MAX_URI_LENGTH);
    } catch {
      uri = undefined;
    }
  }
  const variables = includeTemplateVariables ? sanitizeTemplateVariables(args[1]) : undefined;
  return {
    ...(uri !== undefined ? { uri } : {}),
    ...(variables ? { variables } : {}),
  };
}
