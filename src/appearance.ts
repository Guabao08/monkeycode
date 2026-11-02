export const themes = {
  "serika dark": {
    background: "#323437",
    main: "#e2b714",
    sub: "#646669",
    alternate: "#2c2e31",
    text: "#d1d0c5",
    error: "#ca4754",
  },
  serika: {
    background: "#e1e1e3",
    main: "#e2b714",
    sub: "#aaaeb3",
    alternate: "#d1d3d8",
    text: "#323437",
    error: "#ca4754",
  },
  "high contrast": {
    background: "#181818",
    main: "#ffda45",
    sub: "#a4a4a4",
    alternate: "#242424",
    text: "#f5f5f5",
    error: "#ff8a94",
  },
} as const;
export type ThemeName = keyof typeof themes;
export interface Appearance {
  theme: ThemeName;
  fontSize: 24 | 28 | 32;
  smoothCaret: boolean;
}
export function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(
      localStorage.getItem("monkeycode.appearance.v1") || "{}",
    );
    return {
      theme: Object.hasOwn(themes, saved.theme) ? saved.theme : "serika dark",
      fontSize: [24, 28, 32].includes(saved.fontSize) ? saved.fontSize : 32,
      smoothCaret: saved.smoothCaret !== false,
    };
  } catch {
    return { theme: "serika dark", fontSize: 32, smoothCaret: true };
  }
}
export function saveAppearance(value: Appearance) {
  try {
    localStorage.setItem("monkeycode.appearance.v1", JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
