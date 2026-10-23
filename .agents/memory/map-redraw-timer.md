---
name: Map redraw and turn timer
description: User requirement on how the year timer relates to map drawing on the phone.
---
The year timer must start only after the map has been fully redrawn; only changed tiles are repainted after a turn, and the save waits for drawing too.
**Why:** on the user's phone (Cubot KingKong X Pro, Expo Go) the map didn't finish updating between turns; the user asked to optimize redraw and start the timer only after the full draw.
**How to apply:** any new world mutation must mark its area in the renderer (otherwise incremental redraw misses it); keep `drawing` gating in the timer.
