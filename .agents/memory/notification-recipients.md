---
name: Notification recipients
description: Rules for routing Zero Strategy interface notices independently of who processes a turn.
---

Every interface notification must carry an explicit recipient, such as the world slot or a country slot. Delivery and visibility depend on the viewer's subscription to that recipient, never on whether a human, AI, or external agent processed the action. Switching a viewer to another country changes only its subscriptions. The chronicle is shared public history and is not filtered by notification recipients.

**Why:** the user explicitly requires this architecture to support future multiplayer, changing the controlled country, and Claude participation without AI-specific notification changes.

**How to apply:** attach recipients where notices originate, route them through a shared recipient-matching helper, and keep chronicle entries and their previews separate from private interface notifications.

## Browser campaign runtime

The seeded 100-year browser campaign advances real game turns, so model and city work—not notification matching—can dominate its runtime. Build the browser fixture separately and run the campaign outside short foreground command limits.

**Why:** full-campaign attempts can time out before reaching the notification assertions, and rebuilding on every retry discards elapsed simulation progress.

**How to apply:** keep the browser campaign as an opt-in regression check, build once, then run the browser process with a long timeout or in the background.

## Browser fixture determinism

Pass the seeded PRNG as the Playwright init script itself; returning a callback from the init script does not install it. Attach early DOM observers to `document`, not `document.documentElement`, and give test toasts enough time to be observed.

**Why:** Playwright runs init scripts before page code, when `document.documentElement` may not exist; an ineffective seed makes repeated worlds differ, and a missing observer produces false UI-delivery timeouts.

**How to apply:** keep the seeded campaign and toast observer in the browser fixture, and verify the repeated run before launching the full 100-year check.
