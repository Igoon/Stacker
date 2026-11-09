// Tema warna: satu sumber data untuk wallpaper + token CSS aplikasi.
export type ThemeId =
  | "default"
  | "teal"
  | "forest"
  | "ocean"
  | "plum"
  | "sand"
  | "night"
  | "rose";

export interface Theme {
  id: ThemeId;
  label: string;
  wallpaper: string;
  metaColor: string;
  vars: Record<string, string>;
}

export const DEFAULT_THEME: ThemeId = "default";

export const BASE_VARS: Readonly<Record<string, string>> = {
  "--bg": "#111b21",
  "--app-bg": "#0b141a",
  "--surface": "#1f2c33",
  "--surface-2": "#202c33",
  "--surface-3": "#2a3942",
  "--surface-4": "#3b4a54",
  "--border": "#2a3942",
  "--text": "#e9edef",
  "--muted": "#8696a0",
  "--accent": "#00a884",
  "--accent-2": "#53bdeb",
  "--bubble-out": "#005c4b",
  "--bubble-out-text": "#d1f4cc",
  "--on-accent": "#111b21",
  "--danger": "#f15c6d",
  "--danger-text": "#ffd7d7",
  "--danger-bg": "#6e2020",
  "--danger-bg-hover": "#8a2626",
  "--warning": "#ffbc3b",
  "--code-bg": "#16222a",
  "--editor-bg": "#17232a",
  "--chart-1": "#00a884",
  "--chart-2": "#53bdeb",
  "--chart-3": "#f15c6d",
  "--chart-4": "#ffbc3b",
  "--chart-5": "#a78bfa",
  "--chart-6": "#34d399",
  "--chart-7": "#fb923c",
  "--chart-8": "#e879f9",
};

export const THEMES: readonly Theme[] = [
  {
    id: "default",
    label: "Default",
    wallpaper: "none",
    metaColor: "#111b21",
    vars: {},
  },
  {
    id: "teal",
    label: "Teal",
    wallpaper: "linear-gradient(160deg,#0b1a1e,#12403d)",
    metaColor: "#071417",
    vars: {
      "--bg": "#071417",
      "--app-bg": "#0b1a1e",
      "--surface": "#123039",
      "--surface-2": "#163a44",
      "--surface-3": "#1d4853",
      "--surface-4": "#295b67",
      "--border": "#1d4853",
      "--text": "#e8f6f4",
      "--muted": "#93b7b8",
      "--accent": "#2dd4bf",
      "--accent-2": "#67e8f9",
      "--bubble-out": "#0f4f46",
      "--bubble-out-text": "#d1faf5",
      "--on-accent": "#04201d",
      "--code-bg": "#0e2429",
      "--editor-bg": "#113037",
    },
  },
  {
    id: "forest",
    label: "Hutan",
    wallpaper: "linear-gradient(160deg,#0a1a12,#145c3a)",
    metaColor: "#06110b",
    vars: {
      "--bg": "#06110b",
      "--app-bg": "#0a1a12",
      "--surface": "#12281c",
      "--surface-2": "#173324",
      "--surface-3": "#1e4230",
      "--surface-4": "#2a5a40",
      "--border": "#1e4230",
      "--text": "#e6f2ea",
      "--muted": "#9bbfae",
      "--accent": "#34d399",
      "--accent-2": "#7dd3fc",
      "--bubble-out": "#145c3a",
      "--bubble-out-text": "#d1fae5",
      "--on-accent": "#042416",
      "--code-bg": "#0d2015",
      "--editor-bg": "#0f2418",
    },
  },
  {
    id: "ocean",
    label: "Laut",
    wallpaper: "linear-gradient(160deg,#081824,#124a6b)",
    metaColor: "#05101a",
    vars: {
      "--bg": "#05101a",
      "--app-bg": "#081824",
      "--surface": "#0f2536",
      "--surface-2": "#143044",
      "--surface-3": "#1b3b53",
      "--surface-4": "#26506d",
      "--border": "#1b3b53",
      "--text": "#e3f0f8",
      "--muted": "#9ab6c9",
      "--accent": "#38bdf8",
      "--accent-2": "#22d3ee",
      "--bubble-out": "#0e4f73",
      "--bubble-out-text": "#dbeafe",
      "--on-accent": "#041c28",
      "--code-bg": "#0a1e2c",
      "--editor-bg": "#0c2230",
    },
  },
  {
    id: "plum",
    label: "Plum",
    wallpaper: "linear-gradient(160deg,#180d20,#4a1a5c)",
    metaColor: "#110917",
    vars: {
      "--bg": "#110917",
      "--app-bg": "#180d20",
      "--surface": "#261430",
      "--surface-2": "#2e1a3b",
      "--surface-3": "#3a2349",
      "--surface-4": "#4f3162",
      "--border": "#3a2349",
      "--text": "#f3e8ff",
      "--muted": "#c2a9d6",
      "--accent": "#c084fc",
      "--accent-2": "#f0abfc",
      "--bubble-out": "#4a1a5c",
      "--bubble-out-text": "#f3e8ff",
      "--on-accent": "#240a33",
      "--code-bg": "#1a0e24",
      "--editor-bg": "#21122c",
    },
  },
  {
    id: "sand",
    label: "Pasir",
    wallpaper: "linear-gradient(160deg,#1b150f,#5c4326)",
    metaColor: "#15110c",
    vars: {
      "--bg": "#15110c",
      "--app-bg": "#1b150f",
      "--surface": "#2a2117",
      "--surface-2": "#33281c",
      "--surface-3": "#403222",
      "--surface-4": "#574530",
      "--border": "#403222",
      "--text": "#f5ead7",
      "--muted": "#c6b295",
      "--accent": "#f59e0b",
      "--accent-2": "#fbbf24",
      "--bubble-out": "#5c4326",
      "--bubble-out-text": "#f5ead7",
      "--on-accent": "#241505",
      "--code-bg": "#1f1810",
      "--editor-bg": "#241b12",
    },
  },
  {
    id: "night",
    label: "Malam",
    wallpaper: "linear-gradient(160deg,#000000,#1f2c33)",
    metaColor: "#000000",
    vars: {
      "--bg": "#000000",
      "--app-bg": "#050708",
      "--surface": "#10171a",
      "--surface-2": "#161f23",
      "--surface-3": "#1d282d",
      "--surface-4": "#2b393f",
      "--border": "#1d282d",
      "--text": "#e6edf0",
      "--muted": "#9aabb3",
      "--accent": "#22d3ee",
      "--accent-2": "#60a5fa",
      "--bubble-out": "#0f3f4a",
      "--bubble-out-text": "#d7f8ff",
      "--on-accent": "#031c22",
      "--code-bg": "#0a1013",
      "--editor-bg": "#0c1417",
    },
  },
  {
    id: "rose",
    label: "Rose",
    wallpaper: "linear-gradient(160deg,#1c0c15,#6b2440)",
    metaColor: "#160910",
    vars: {
      "--bg": "#160910",
      "--app-bg": "#1c0c15",
      "--surface": "#2a1220",
      "--surface-2": "#34172a",
      "--surface-3": "#422035",
      "--surface-4": "#5c2d49",
      "--border": "#422035",
      "--text": "#ffe4ef",
      "--muted": "#d3a8bd",
      "--accent": "#fb7185",
      "--accent-2": "#f472b6",
      "--bubble-out": "#6b2440",
      "--bubble-out-text": "#ffe4ef",
      "--on-accent": "#2a0710",
      "--code-bg": "#200d16",
      "--editor-bg": "#25101a",
    },
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function themeVars(idOrTheme: Theme | ThemeId): Record<string, string> {
  const theme = typeof idOrTheme === "string" ? themeById(idOrTheme) : idOrTheme;
  return { ...BASE_VARS, ...theme.vars, "--wallpaper": theme.wallpaper };
}
