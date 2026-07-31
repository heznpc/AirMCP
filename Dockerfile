# Registry-introspection image. NOT a supported way to run AirMCP.
#
# WHY THIS EXISTS
# Glama builds every listed MCP server from a Dockerfile — the maintainer's if
# one is checked in, otherwise one its AI infers from the project structure. When
# that build fails the listing stays up but distribution is withheld: the server
# stops appearing in search results, category listings, and recommendations until
# a reproducible build succeeds. AirMCP's inferred build cannot succeed, because
# `package.json` declares `"os": ["darwin"]` and npm refuses to install the
# package on Linux (EBADPLATFORM). This file makes the build reproducible so the
# listing is indexable and its tool schemas can be scored.
#
# WHAT IT DOES NOT DO
# It does not make AirMCP work on Linux. Every Apple-app tool goes through JXA /
# osascript / the Swift bridges, which exist only on macOS. Inside this container
# the server boots, reports its identity, and answers tools/list, prompts/list,
# and resources/list — enough for protocol introspection and nothing more. Any
# tool CALL will fail. To actually use AirMCP, install it on macOS:
#
#     npx airmcp@latest
#
FROM node:22-alpine

WORKDIR /app

# Manifests first so dependency layers cache independently of source churn.
COPY package.json package-lock.json ./

# --force downgrades the darwin-only EBADPLATFORM check to a warning; the six
# runtime dependencies (@modelcontextprotocol/sdk, @modelcontextprotocol/ext-apps,
# express, jose, yaml, zod) are all pure JavaScript, so nothing here needs a
# native macOS toolchain.
# --ignore-scripts skips the `prepare` hook, which runs husky — a git hook
# installer that has no repository to attach to in this image.
RUN npm ci --force --ignore-scripts

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

# Drop dev dependencies now that dist/ is built.
RUN npm prune --omit=dev --force

# Expose the full catalogue rather than the cold-boot front door, so the schemas
# an indexer captures match the documented surface instead of the starter subset.
ENV AIRMCP_PROFILE=full
# stdio only: no port is bound, and no HTTP transport is enabled by default.
ENTRYPOINT ["node", "dist/index.js"]
