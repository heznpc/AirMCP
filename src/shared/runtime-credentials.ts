import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

/** App-generated secrets are 32 random bytes encoded as unpadded base64url.
 * Open once without following symlinks, then validate that same descriptor.
 * O_NONBLOCK prevents a substituted FIFO from hanging startup. */
export function readPrivateRuntimeCredential(path: string, uid = process.getuid?.()): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 43 || stat.size > 44) {
      throw new Error("App runtime credential must be a regular 43-byte secret file");
    }
    if (uid === undefined || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) {
      throw new Error("App runtime credential must belong to the current user with permissions 0600");
    }
    const secret = readFileSync(descriptor, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("App runtime credential is malformed");
    return secret;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** File credentials take precedence and fail closed; an invalid file must
 * never silently select another token or downgrade to unauthenticated mode.
 * Legacy environment tokens remain supported for standalone CLI users. */
export function runtimeHttpToken(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIRMCP_APP_RUNTIME_TOKEN_PATH !== undefined) {
    return readPrivateRuntimeCredential(env.AIRMCP_APP_RUNTIME_TOKEN_PATH);
  }
  return env.AIRMCP_HTTP_TOKEN ?? "";
}

export function runtimeOwnerSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AIRMCP_APP_RUNTIME_OWNER_PATH !== undefined) {
    return readPrivateRuntimeCredential(env.AIRMCP_APP_RUNTIME_OWNER_PATH);
  }
  return env.AIRMCP_APP_RUNTIME_OWNER_SECRET;
}
