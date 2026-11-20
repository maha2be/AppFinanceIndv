/**
 * Design tokens: one source of truth for color, type, space and motion.
 *
 * World: "the ledger" (see DESIGN.md). Warm paper, ink accents, hairline rules,
 * serif numerals. Every screen composes these tokens instead of raw values.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  paper: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  lineStrong: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  onInk: string;
  income: string;
  expense: string;
  investment: string;
  debt: string;
  receivable: string;
  danger: string;
  incomeTint: string;
  expenseTint: string;
  investmentTint: string;
  debtTint: string;
  receivableTint: string;
  dangerTint: string;
  dangerBorder: string;
  inkTint: string;
  scrim: string;
  shadowRaised: string;
  shadowSheet: string;
}

export const LightColors: ThemeColors = {
  // Surfaces
  paper: '#F2F0E9',
  surface: '#FBFAF5',
  surfaceAlt: '#EBE8DE',
  line: '#DAD5C7',
  lineStrong: '#C9C2B0',

  // Ink
  ink: '#171A16',
  inkSoft: '#565A52',
  inkMuted: '#64685E',
  onInk: '#F7F5EE',

  // Money semantics
  income: '#1B6B4C',
  expense: '#A33A2A',
  investment: '#8A6516',
  debt: '#2A5A72',
  receivable: '#6A4A85',
  danger: '#A32B2B',

  // Tints (semantic color at ~10% over paper)
  incomeTint: 'rgba(27, 107, 76, 0.10)',
  expenseTint: 'rgba(163, 58, 42, 0.10)',
  investmentTint: 'rgba(138, 101, 22, 0.10)',
  debtTint: 'rgba(42, 90, 114, 0.10)',
  receivableTint: 'rgba(106, 74, 133, 0.10)',
  dangerTint: 'rgba(163, 43, 43, 0.10)',
  dangerBorder: 'rgba(163, 43, 43, 0.28)',
  inkTint: 'rgba(23, 26, 22, 0.06)',

  // Scrim & shadows
  scrim: 'rgba(23, 26, 22, 0.45)',
  shadowRaised: 'rgba(23, 26, 22, 0.85)',
  shadowSheet: 'rgba(23, 26, 22, 0.9)',
};

export const DarkColors: ThemeColors = {
  // Surfaces: warm charcoal ledger
  paper: '#141613',
  surface: '#1C1F1B',
  surfaceAlt: '#252923',
  line: '#31362E',
  lineStrong: '#454C41',

  // Ink: warm paper ivory (>=4.5:1 on dark surfaces)
  ink: '#F2EFE6',
  inkSoft: '#C4C2B8',
  inkMuted: '#9B9A90',
  onInk: '#171A16',

  // Money semantics (legible on dark paper & surfaceAlt)
  income: '#5BB98C',
  expense: '#E27D6D',
  investment: '#D4A84B',
  debt: '#6CA7C4',
  receivable: '#AE8AC9',
  danger: '#E56E6E',

  // Tints (~16% alpha over dark surfaces)
  incomeTint: 'rgba(91, 185, 140, 0.16)',
  expenseTint: 'rgba(226, 125, 109, 0.16)',
  investmentTint: 'rgba(212, 168, 75, 0.16)',
  debtTint: 'rgba(108, 167, 196, 0.16)',
  receivableTint: 'rgba(174, 138, 201, 0.16)',
  dangerTint: 'rgba(229, 110, 110, 0.16)',
  dangerBorder: 'rgba(229, 110, 110, 0.35)',
  inkTint: 'rgba(242, 239, 230, 0.08)',

  // Scrim & shadows
  scrim: 'rgba(8, 10, 8, 0.72)',
  shadowRaised: 'rgba(0, 0, 0, 0.9)',
  shadowSheet: 'rgba(0, 0, 0, 0.95)',
};

/** Default light palette preserved for compatibility. */
export const Colors = LightColors;

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  gutter: 20,
} as const;

export const Radius = {
  control: 6,
  block: 10,
  sheet: 16,
  pill: 999,
} as const;

export const Fonts = {
  /** Display serif: screen titles and hero amounts. */
  serif: 'InstrumentSerif',
  regular: 'PlexRegular',
  medium: 'PlexMedium',
  semibold: 'PlexSemiBold',
} as const;

/**
 * Type styles. Custom static faces carry their weight in the file, so styles
 * set `fontFamily` and never `fontWeight`.
 */
export function createType(colors: ThemeColors) {
  return {
    hero: {
      fontFamily: Fonts.serif,
      fontSize: 44,
      lineHeight: 48,
      letterSpacing: -0.6,
      color: colors.ink,
    },
    h1: {
      fontFamily: Fonts.serif,
      fontSize: 34,
      lineHeight: 38,
      letterSpacing: -0.4,
      color: colors.ink,
    },
    h2: {
      fontFamily: Fonts.serif,
      fontSize: 26,
      lineHeight: 31,
      letterSpacing: -0.2,
      color: colors.ink,
    },
    h3: {
      fontFamily: Fonts.medium,
      fontSize: 20,
      lineHeight: 26,
      color: colors.ink,
    },
    title: {
      fontFamily: Fonts.semibold,
      fontSize: 17,
      lineHeight: 23,
      color: colors.ink,
    },
    bodyStrong: {
      fontFamily: Fonts.medium,
      fontSize: 15,
      lineHeight: 21,
      color: colors.ink,
    },
    body: {
      fontFamily: Fonts.regular,
      fontSize: 14,
      lineHeight: 21,
      color: colors.ink,
    },
    caption: {
      fontFamily: Fonts.regular,
      fontSize: 12,
      lineHeight: 17,
      color: colors.inkMuted,
    },
    micro: {
      fontFamily: Fonts.medium,
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 0.08,
      color: colors.inkMuted,
    },
    /** Money in lists and tables: fixed-width digits, right aligned. */
    amount: {
      fontFamily: Fonts.semibold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.ink,
    },
    amountLarge: {
      fontFamily: Fonts.semibold,
      fontSize: 17,
      lineHeight: 22,
      color: colors.ink,
    },
  } as const;
}

export const Type = createType(LightColors);

export function createShadow(colors: ThemeColors) {
  return {
    none: {},
    hairline: {
      borderWidth: 1,
      borderColor: colors.line,
    },
    raised: {
      borderWidth: 1,
      borderColor: colors.line,
      shadowColor: colors.shadowRaised,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    sheet: {
      shadowColor: colors.shadowSheet,
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
      elevation: 12,
    },
  } as const;
}

export const Shadow = createShadow(LightColors);

export const Motion = {
  fast: 150,
  base: 220,
  slow: 320,
} as const;

export type ThemeType = ReturnType<typeof createType>;
export type ThemeShadow = ReturnType<typeof createShadow>;

export interface ThemeTokens {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  type: ThemeType;
  shadow: ThemeShadow;
}

const LIGHT_THEME: ThemeTokens = {
  mode: 'light',
  isDark: false,
  colors: LightColors,
  type: Type,
  shadow: Shadow,
};

const DARK_THEME: ThemeTokens = {
  mode: 'dark',
  isDark: true,
  colors: DarkColors,
  type: createType(DarkColors),
  shadow: createShadow(DarkColors),
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function getThemeTokens(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}

let activeTheme: ThemeTokens = LIGHT_THEME;
const listeners = new Set<() => void>();

export function getActiveTheme(): ThemeTokens {
  return activeTheme;
}

export function subscribeActiveTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setActiveTheme(mode: ThemeMode): ThemeTokens {
  const next = getThemeTokens(mode);
  if (next === activeTheme) {
    return activeTheme;
  }
  activeTheme = next;
  listeners.forEach((listener) => listener());
  return activeTheme;
}

export function createThemedStyles<T>(
  factory: (theme: ThemeTokens) => T
): (theme?: ThemeTokens) => T {
  const cache = new WeakMap<object, T>();
  return (theme?: ThemeTokens) => {
    const resolved = theme ?? getActiveTheme();
    if (resolved && typeof resolved === 'object') {
      const cached = cache.get(resolved);
      if (cached) return cached;
      const built = factory(resolved);
      cache.set(resolved, built);
      return built;
    }
    return factory(resolved);
  };
}
