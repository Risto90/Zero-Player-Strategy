/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#24332d',
    tint: '#55754f',

    // Core surfaces
    background: '#f4f1e8',
    foreground: '#24332d',

    // Cards / elevated surfaces
    card: '#fbfaf5',
    cardForeground: '#24332d',

    // Primary action color (buttons, links, active states)
    primary: '#55754f',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e8e3d5',
    secondaryForeground: '#344236',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#e9e5da',
    mutedForeground: '#777b70',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#e1e8d8',
    accentForeground: '#344236',

    // Destructive actions (delete, error states)
    destructive: '#b6523b',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#ded9ca',
    input: '#d8d2c3',

    // Atlas and map-specific colors
    ocean: '#c5d4d1',
    cardSelected: '#f6f5eb',
    inkSurface: '#ece7d7',
    ink: '#91683f',
    success: '#65845b',
    countryPalette: [
      '#c56f58', '#62836f', '#7279a2', '#c3974e', '#8d6f91', '#558d91', '#b26f84',
      '#487f9c', '#8a8f52', '#bd6689', '#5775a4', '#ba805f', '#6c9b97', '#8d83af',
      '#997242', '#62765c',
    ],
    // Ice, tundra, swamp, taiga, cold steppe, broadleaf forest, steppe, desert, savanna, rainforest
    biomePalette: ['#e7ebe8', '#b3b6a2', '#6c8c7f', '#5d7a63', '#b0ad8b', '#86a062', '#c4b46f', '#e3cb96', '#c99e57', '#4b7c4d'],
    noFaith: '#c8c3b4',
    culturePalette: ['#a46150', '#4f7e79', '#6e70a0', '#ad803a', '#865d83', '#43818d', '#a75b77', '#667e48'],
    religionPalette: ['#a77c36', '#527b91', '#7770a3', '#728457', '#aa6472', '#6c6b69'],
    unclaimedLand: '#d7cdae',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
