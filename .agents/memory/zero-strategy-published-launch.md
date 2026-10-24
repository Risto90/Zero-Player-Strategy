---
name: Zero Strategy published Expo Go launch
description: Deployment-origin handling and source-map expectations for the static Expo Go build.
---
The public origin and base path for a static Expo Go launch must be resolved at request time, not frozen into the build. Rebase the manifest, launch bundle, and bundle asset locations from the request host. Do not leave source-map URLs pointing at Metro when the static build does not publish maps.

**Why:** Replit's build-time domain can differ from the public deployment host, and a production Metro bundle may still contain a localhost `sourceMappingURL` comment.

**How to apply:** When changing static Expo delivery, verify the served manifest protocol fields, launch bundle, app icon, and every bundle-declared asset under the active origin and configured base path.

Keep the generated `static-build/` directory out of Git, but do not exclude it from `.replitignore`: production creates those files during its build and the running server needs them in the published image.

**Why:** A successful build can generate valid manifests and bundles that are then omitted from the runtime image, causing the public manifest endpoint to return 404.

**How to apply:** When changing static Expo build output, check both the generation logs and whether the output directory survives into the published runtime; retain a regression test for the ignore configuration.
