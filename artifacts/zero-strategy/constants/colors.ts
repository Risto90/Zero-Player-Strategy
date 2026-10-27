/**
 * "Atlas & Cinnabar": parchment, walnut ink, cinnabar seal.
 * Map colours themselves live in game/config.ts (PALETTE, BIOMES).
 */
const colors = {
  light: {
    text: '#2c1e17',
    tint: '#bf2f1d',
    background: '#efe7d7',
    foreground: '#2c1e17',
    card: '#f6f1e4',
    cardForeground: '#2c1e17',
    primary: '#bf2f1d',
    primaryForeground: '#faf5eb',
    secondary: '#3b2b21',
    secondaryForeground: '#f2ead9',
    muted: '#e2d7c6',
    mutedForeground: '#705f51',
    accent: '#2c5d63',
    accentForeground: '#f6f0e4',
    destructive: '#9e2535',
    destructiveForeground: '#faf5eb',
    border: '#c9b9a6',
    input: '#c0ad97',
    mapBackdrop: '#b9cdd0',
    crownGold: '#b8860b',
    crownSilver: '#8a8f98',
    crownBlack: '#17130f',
  },
  radius: 6,
};

export default colors;

/** Font family names registered in app/_layout.tsx. */
export const fonts = {
  sans: 'IBMPlexSans_400Regular',
  sansMedium: 'IBMPlexSans_500Medium',
  sansSemiBold: 'IBMPlexSans_600SemiBold',
  display: 'PlayfairDisplay_700Bold',
  displayItalic: 'PlayfairDisplay_400Regular_Italic',
  displayRegular: 'PlayfairDisplay_400Regular',
  mono: 'JetBrainsMono_500Medium',
};
