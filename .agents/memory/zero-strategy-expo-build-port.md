---
name: Zero Strategy Expo build port
description: Metro port selection for the Zero Strategy static Expo build in Replit.
---
The static Expo build script supports `ZERO_STRATEGY_METRO_PORT`; use a free local port such as 8082 when the default 8081 is occupied.

**Why:** Replit's local preview routing can reserve port 8081, causing the build helper to start Metro on 8082 while its HTTP fetches still target 8081.

**How to apply:** run `ZERO_STRATEGY_METRO_PORT=8082 pnpm --filter @workspace/zero-strategy run build` when the default build times out on a port conflict.
