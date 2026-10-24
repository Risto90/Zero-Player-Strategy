---
name: Notification recipients
description: Rules for routing Zero Strategy interface notices independently of who processes a turn.
---

Every interface notification must carry an explicit recipient, such as the world slot or a country slot. Delivery and visibility depend on the viewer's subscription to that recipient, never on whether a human, AI, or external agent processed the action. Switching a viewer to another country changes only its subscriptions. The chronicle is shared public history and is not filtered by notification recipients.

**Why:** the user explicitly requires this architecture to support future multiplayer, changing the controlled country, and Claude participation without AI-specific notification changes.

**How to apply:** attach recipients where notices originate, route them through a shared recipient-matching helper, and keep chronicle entries and their previews separate from private interface notifications.
