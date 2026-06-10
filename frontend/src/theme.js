import { createContext } from 'react';

export const lightColors = {
  primary: "#024ad8",
  primaryBright: "#296ef9",
  primaryDeep: "#0e3191",
  primarySoft: "#c9e0fc",
  onPrimary: "#ffffff",
  ink: "#1a1a1a",
  inkDeep: "#000000",
  inkSoft: "#292929",
  onInk: "#ffffff",
  canvas: "#ffffff",
  paper: "#ffffff",
  cloud: "#f7f7f7",
  fog: "#e8e8e8",
  steel: "#c2c2c2",
  graphite: "#636363",
  charcoal: "#3d3d3d",
  hairline: "#e8e8e8",
  hairlineStrong: "#c2c2c2",
  link: "#024ad8",
  linkPressed: "#0e3191",
  bloomCoral: "#ff5050",
  bloomRose: "#f9d4d2",
  bloomDeep: "#b3262b",
  bloomWine: "#5a1313",
  stormMist: "#8ebdce",
  stormSea: "#7fadbe",
  stormDeep: "#356373",
  error: "#b3262b",
  isDark: false,
};

export const darkColors = {
  primary: "#4a9eff",
  primaryBright: "#6db3ff",
  primaryDeep: "#80baff",
  primarySoft: "#1a3350",
  onPrimary: "#ffffff",
  ink: "#e0e0e0",
  inkDeep: "#ffffff",
  inkSoft: "#b0b0b0",
  onInk: "#1a1a1a",
  canvas: "#0f0f1a",
  paper: "#161625",
  cloud: "#1a1a2e",
  fog: "#232340",
  steel: "#3a3a5a",
  graphite: "#8888aa",
  charcoal: "#b0b0c8",
  hairline: "#2a2a45",
  hairlineStrong: "#3d3d60",
  link: "#4a9eff",
  linkPressed: "#6db3ff",
  bloomCoral: "#ff6b6b",
  bloomRose: "#3d1a1a",
  bloomDeep: "#ff6b6b",
  bloomWine: "#ffaaaa",
  stormMist: "#2a4a55",
  stormSea: "#4a8a9a",
  stormDeep: "#6abaca",
  error: "#ff6b6b",
  isDark: true,
};

const typography = {
  displayXxl: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '72px',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '0px',
  },
  displayXl: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '56px',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '0px',
  },
  displayLg: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '44px',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '0px',
  },
  displayMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '32px',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '0px',
  },
  displaySm: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '24px',
    fontWeight: 500,
    lineHeight: 1.17,
    letterSpacing: '0px',
  },
  displayXs: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '20px',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '0px',
  },
  bodyLg: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '18px',
    fontWeight: 400,
    lineHeight: 1.33,
    letterSpacing: '0px',
  },
  bodyMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '16px',
    fontWeight: 400,
    lineHeight: 1.38,
    letterSpacing: '0px',
  },
  bodyEmphasis: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.38,
    letterSpacing: '0px',
  },
  captionMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: '0px',
  },
  captionSm: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: 1.33,
    letterSpacing: '0px',
  },
  captionBold: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '14px',
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: '0px',
  },
  linkMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.38,
    letterSpacing: '0px',
  },
  buttonMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: '0.7px',
    textTransform: 'uppercase',
  },
  buttonSm: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '12.6px',
    fontWeight: 700,
    lineHeight: 1.0,
    letterSpacing: '0.126px',
  },
  priceMd: {
    fontFamily: '"Forma DJR Micro", Arial, sans-serif',
    fontSize: '24px',
    fontWeight: 500,
    lineHeight: 1.17,
    letterSpacing: '0px',
  },
};

const rounded = {
  none: '0px',
  xs: '2px',
  sm: '3px',
  md: '4px',
  lg: '8px',
  xl: '16px',
  pill: '9999px',
  full: '9999px',
};

const spacing = {
  xxs: '4px',
  xs: '8px',
  sm: '12px',
  md: '16px',
  lg: '20px',
  xl: '24px',
  xxl: '32px',
  section: '80px',
};

function buildElevation(colors) {
  return {
    flat: 'none',
    hairline: `1px solid ${colors.hairline}`,
    softLift: `0 2px 8px ${colors.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(26,26,26,0.08)'}`,
    floatingModal: `0 8px 24px ${colors.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(26,26,26,0.12)'}`,
  };
}

function buildTheme(colors) {
  return {
    colors,
    typography,
    rounded,
    spacing,
    elevation: buildElevation(colors),
  };
}

export const lightTheme = buildTheme(lightColors);
export const darkTheme = buildTheme(darkColors);

export const ThemeContext = createContext(lightTheme);
