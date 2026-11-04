import { prepare } from "./engine.ts";

export type Language = "python" | "java";
export type Scope = "method" | "full";
export type Length = "short" | "standard" | "long" | "any";
export interface Snippet {
  id: string;
  title: string;
  language: Language;
  scope: Scope;
  code: string;
  origin: "generated" | "solution" | "custom";
  description: string;
  difficulty?: "Easy" | "Medium" | "Hard";
  sourceUrl?: string;
  license?: string;
  seed?: number;
}
export const scoredLength = (code: string) => prepare(code).units.length;
export function matchesLength(code: string, length: Length) {
  const n = scoredLength(code);
  return (
    length === "any" ||
    (length === "short"
      ? n <= 350
      : length === "standard"
        ? n > 350 && n <= 900
        : n > 900)
  );
}
