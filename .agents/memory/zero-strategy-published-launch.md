---
name: Zero Strategy published Expo Go launch
description: Deployment-origin handling and source-map expectations for the static Expo Go build.
---
The public origin and base path for a static Expo Go launch must be resolved at request time, not frozen into the build. Rebase the manifest, launch bundle, and bundle asset locations from the request host. Do not leave source-map URLs pointing at Metro when the static build does not publish maps.

**Why:** Replit's build-time domain can differ from the public deployment host, and a production Metro bundle may still contain a localhost `sourceMappingURL` comment.

**How to apply:** When changing static Expo delivery, verify the served manifest protocol fields, launch bundle, app icon, and every bundle-declared asset under the active origin and configured base path.
