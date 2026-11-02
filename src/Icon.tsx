export type IconName =
  | "keyboard"
  | "code"
  | "restart"
  | "next"
  | "history"
  | "info"
  | "settings"
  | "close"
  | "search"
  | "globe"
  | "palette"
  | "check"
  | "terminal"
  | "method"
  | "github"
  | "chart";
const paths: Record<Exclude<IconName, "keyboard">, string> = {
  code: "m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16",
  restart: "M4 10a8 8 0 1 1 1.5 7M4 4v6h6",
  next: "m9 5 7 7-7 7M4 12h12",
  history: "M4 10a8 8 0 1 1 2 8M4 4v6h6M12 8v5l3 2",
  info: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  settings:
    "m9 3-1 3-3 1-2 4 2 2v3l3 2 3-1 3 1 3-2v-3l2-2-2-4-3-1-1-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  close: "m6 6 12 12M6 18 18 6",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
  palette:
    "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7ZM7 9h.01M11 6h.01M16 7h.01M6 14h.01",
  check: "m5 12 4 4L19 6",
  terminal: "m4 6 6 6-6 6m8 0h8",
  method: "M8 3H5v18h3m8-18h3v18h-3M9 12h6",
  github:
    "M9 19c-4 1-4-2-6-2m12 5v-4a3 3 0 0 0-1-2c4 0 7-2 7-6a5 5 0 0 0-1-3 5 5 0 0 0 0-4s-2 0-4 2a14 14 0 0 0-8 0C6 3 4 3 4 3a5 5 0 0 0 0 4 5 5 0 0 0-1 3c0 4 3 6 7 6a3 3 0 0 0-1 2v4",
  chart: "M4 3v17h17M7 14l4-5 4 3 5-7",
};
export default function Icon({
  name,
  size = 16,
}: {
  name: IconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "keyboard" ? (
        <>
          <rect x="2" y="5" width="20" height="14" rx="3" />
          <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
        </>
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}
