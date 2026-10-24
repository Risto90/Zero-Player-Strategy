---
name: Chronicle importance
description: User-defined rules for highlighting events in the game history.
---

The user's exact list is:

> Важные события для страны: создание, разделение, поглощение другой страны или другой страной, переход в кочевую или оседлую форму.
>
> Важные события для города: создание, расширение, увядание, падение.
>
> Важные события для персонажа: рождение, роман, брак, смерть, занятие должности, освобождение должности, рождение ребёнка, смерть ребёнка.
>
> Важные события для религии/культуры: создание, раскол.
>
> Только эти события являются важными, а не каддый чих, котрый тебе таким показался. Именно они, только они и все они обязательно должны получать метку важных и только в той лнтописи, для которой они важные.
>
> Исправляй и не пытайся сокращать или пересказывать своими словами мои инструкции - ты уже допересказывался до потери данных.

Importance belongs to typed object references, not the whole entry. Routine country/nomad expansion, colonization, capital moves, reforms, and friendship are not important. Never infer importance from legacy prose or a legacy boolean marker.

City chronicle references must use stable identities instead of the compacting display index. Removing a city must not move its history or its importance to the next city.

**Why:** The user explicitly requires exactly the listed events and only in the relevant object's chronicle. City array indices compact on deletion, so they cannot safely identify archived city events.

**How to apply:** Preserve this event list verbatim. Tag only the relevant typed references; do not infer old tags from text or booleans. Keep city archive identities stable across deletion and save/load.
