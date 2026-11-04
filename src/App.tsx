import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { generateSnippet } from "./generator";
import { solutions } from "./solutions";
import { backspace, insert, metrics, newSession } from "./engine";
import { getRuns, loadPreferences, savePreferences, saveRun } from "./storage";
import type { Preferences, Run } from "./storage";
import { matchesLength, scoredLength } from "./types";
import type { Language, Length, Scope, Snippet } from "./types";
import { loadAppearance, saveAppearance, themes } from "./appearance";
import type { Appearance, ThemeName } from "./appearance";
import Icon from "./Icon";
import Dialog from "./Dialog";
import Results from "./Results";
import type { SpeedSample } from "./Results";
import Solve from "./Solve";

type Popup =
  | "commands"
  | "settings"
  | "history"
  | "custom"
  | "source"
  | "review"
  | "about"
  | "themes"
  | null;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const initialPreferences = loadPreferences();
function selectSnippet(
  prefs: Preferences,
  previousId?: string,
): Snippet | null {
  if (prefs.mode === "custom") return null;
  if (prefs.mode === "generated")
    return generateSnippet(prefs.language, prefs.length);
  const pool = solutions.filter(
    (s) =>
      s.language === prefs.language &&
      s.scope === prefs.scope &&
      matchesLength(s.code, prefs.length),
  );
  const alternatives = pool.filter((s) => s.id !== previousId);
  const available = alternatives.length ? alternatives : pool;
  return available.length
    ? available[Math.floor(Math.random() * available.length)]
    : null;
}
const firstSnippet = selectSnippet(initialPreferences);

export default function App() {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [workspace, setWorkspace] = useState<"typing" | "solve">(
    () => window.location.hash === "#solve" ? "solve" : "typing",
  );
  const [solveVisited, setSolveVisited] = useState(
    () => window.location.hash === "#solve",
  );
  const [appearance, setAppearance] = useState(loadAppearance);
  const [snippet, setSnippet] = useState<Snippet | null>(firstSnippet);
  const [session, setSession] = useState(() =>
    newSession(firstSnippet?.code ?? ""),
  );
  const [now, setNow] = useState(performance.now());
  const [focused, setFocused] = useState(false);
  const [popup, setPopup] = useState<Popup>(null);
  const [search, setSearch] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [notice, setNotice] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [customTitle, setCustomTitle] = useState("My code");
  const [customLanguage, setCustomLanguage] = useState<Language>(
    prefs.language,
  );
  const [samples, setSamples] = useState<SpeedSample[]>([]);
  const [caret, setCaret] = useState({ left: 0, top: 0, height: 38 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentRef = useRef<HTMLSpanElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const saved = useRef<object | null>(null);
  const composition = useRef(false);
  const stats = metrics(session, now);
  const active =
    workspace === "typing" &&
    focused &&
    session.startedAt !== null &&
    !session.complete &&
    popup === null;
  const colors = themes[appearance.theme];
  const style = {
    "--bg-color": colors.background,
    "--main-color": colors.main,
    "--caret-color": colors.main,
    "--sub-color": colors.sub,
    "--sub-alt-color": colors.alternate,
    "--text-color": colors.text,
    "--error-color": colors.error,
    "--font-size": `${appearance.fontSize}px`,
  } as CSSProperties;

  function switchWorkspace(next: "typing" | "solve") {
    setWorkspace(next);
    if (next === "solve") setSolveVisited(true);
    setFocused(false);
    setPopup(null);
    setNotice("");
    inputRef.current?.blur();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${next === "solve" ? "#solve" : ""}`,
    );
    if (next === "typing") focusInput();
  }

  function focusInput() {
    requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
  }
  function openPopup(value: Popup) {
    setSearch("");
    setNotice("");
    if (value === "custom") setCustomLanguage(prefs.language);
    setPopup(value);
    inputRef.current?.blur();
  }
  function start(next: Snippet | null, focus = false) {
    setSnippet(next);
    setSession(newSession(next?.code ?? ""));
    setSamples([]);
    setNow(performance.now());
    saved.current = null;
    setNotice("");
    setPopup(null);
    if (inputRef.current) inputRef.current.value = "";
    if (surfaceRef.current) {
      surfaceRef.current.scrollTop = 0;
      surfaceRef.current.scrollLeft = 0;
    }
    if (focus) focusInput();
  }
  function nextSnippet() {
    if (prefs.mode === "custom") openPopup("custom");
    else start(selectSnippet(prefs, snippet?.id), true);
  }
  function updatePreferences(patch: Partial<Preferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const stored = savePreferences(next);
    if (next.mode === "custom") {
      if (snippet?.origin === "custom")
        start({ ...snippet, language: next.language });
      else openPopup("custom");
    } else start(selectSnippet(next, snippet?.id));
    if (!stored)
      setNotice("Preferences could not be saved. Practice still works.");
  }
  function updateAppearance(patch: Partial<Appearance>) {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    if (!saveAppearance(next))
      setNotice("Appearance could not be saved in this browser.");
  }
  function commit(text: string) {
    if (!snippet || !text || session.complete) return;
    setSession((previous) => insert(previous, text, performance.now()));
    setNow(performance.now());
  }
  function onInput(event: FormEvent<HTMLTextAreaElement>) {
    if (composition.current) return;
    const node = event.currentTarget;
    const native = event.nativeEvent as InputEvent;
    if (native.inputType === "deleteContentBackward")
      setSession((previous) => backspace(previous));
    else if (
      [
        "insertFromPaste",
        "insertFromDrop",
        "insertReplacementText",
        "historyUndo",
        "historyRedo",
      ].includes(native.inputType)
    )
      setNotice(
        "Paste is disabled during a test. Use custom to practice your own code.",
      );
    else commit(node.value);
    node.value = "";
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      setSession((previous) => backspace(previous));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        if (snippet) start(snippet, true);
      } else commit("\n");
    }
  }
  function importCode(event: FormEvent) {
    event.preventDefault();
    if (!customCode.trim()) {
      setNotice("Paste a non-empty Python or Java snippet.");
      return;
    }
    if (customCode.length > 30000) {
      setNotice("Choose a snippet under 30,000 characters.");
      return;
    }
    if (customCode.split("\n").some((line) => /^[ \t]*\S.*\t/.test(line))) {
      setNotice(
        "Replace tabs inside lines with spaces before importing. Tab is used for navigation.",
      );
      return;
    }
    const nextPreferences = {
      ...prefs,
      language: customLanguage,
      mode: "custom" as const,
    };
    setPrefs(nextPreferences);
    savePreferences(nextPreferences);
    start(
      {
        id: crypto.randomUUID(),
        title: customTitle.trim() || "My code",
        language: customLanguage,
        scope: "full",
        code: customCode,
        origin: "custom",
        description: "Private custom text. Never uploaded or executed.",
      },
      true,
    );
  }

  useEffect(() => {
    getRuns()
      .then(setRuns)
      .catch(() =>
        setNotice("History is unavailable. You can still practice."),
      );
  }, []);
  useEffect(() => {
    document.documentElement.style.backgroundColor = colors.background;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", colors.background);
  }, [colors.background]);
  useEffect(() => {
    if (session.startedAt === null || session.complete) return;
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [session.startedAt, session.complete]);
  useEffect(() => {
    if (!snippet || session.startedAt === null) return;
    const current = metrics(session, now);
    const sample = {
      seconds: current.elapsed,
      cpm: current.cpm,
      rawCpm:
        current.elapsed > 0 ? (current.attempts * 60) / current.elapsed : 0,
      errors: current.errors,
    };
    setSamples((previous) => {
      const last = previous.at(-1);
      if (
        last &&
        (last.seconds === sample.seconds ||
          (!session.complete &&
            Math.floor(last.seconds) === Math.floor(sample.seconds)))
      )
        return previous;
      return [...previous, sample];
    });
  }, [now, session, snippet]);
  useEffect(() => {
    if (!snippet || !session.complete || saved.current === session) return;
    saved.current = session;
    const current = metrics(session, performance.now());
    const run: Run = {
      id: crypto.randomUUID(),
      title: snippet.title,
      language: snippet.language,
      origin: snippet.origin,
      completedAt: Date.now(),
      cpm: current.cpm,
      accuracy: current.accuracy,
      elapsed: current.elapsed,
      errors: current.errors,
      code: snippet.origin === "custom" ? "" : snippet.code,
    };
    setRuns((previous) => [run, ...previous]);
    saveRun(run).catch(() =>
      setNotice("Test complete, but this result could not be saved locally."),
    );
  }, [session, snippet]);
  useEffect(() => {
    function keydown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "Escape" && !popup) {
        event.preventDefault();
        openPopup("commands");
        return;
      }
      if (workspace !== "typing") return;
      if (
        popup ||
        !snippet ||
        session.complete ||
        document.activeElement === inputRef.current
      )
        return;
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, select, textarea, summary, dialog"))
        return;
      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        focusInput();
        commit(event.key);
      } else if (event.key === "Enter") {
        event.preventDefault();
        focusInput();
        commit("\n");
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  const lines = useMemo(() => {
    const unitAt = new Map(
      session.prepared.offsets.map((offset, index) => [offset, index]),
    );
    let offset = 0;
    return session.prepared.text.split("\n").map((line, lineIndex, all) => {
      const chars = [];
      for (const { segment: char } of graphemes.segment(line)) {
        const index = unitAt.get(offset);
        const typed = index !== undefined && index < session.input.length;
        const wrong =
          typed && session.input[index!] !== session.prepared.units[index!];
        const current =
          index === session.input.length ||
          (session.input.length === session.prepared.units.length &&
            index === session.prepared.finalStart);
        chars.push(
          <span
            key={offset}
            ref={current && !session.complete ? currentRef : undefined}
            className={
              index === undefined
                ? "indent"
                : typed
                  ? wrong
                    ? "incorrect"
                    : "correct"
                  : "untyped"
            }
            data-unit={index}
            title={
              wrong
                ? `Expected ${JSON.stringify(char)}; typed ${JSON.stringify(session.input[index!])}`
                : undefined
            }
          >
            {char === " " && wrong ? "·" : char}
          </span>,
        );
        offset += char.length;
      }
      if (lineIndex < all.length - 1) {
        const index = unitAt.get(offset);
        const wrong =
          index !== undefined &&
          index < session.input.length &&
          session.input[index] !== "\n";
        chars.push(
          <span
            key="newline"
            ref={
              index === session.input.length && !session.complete
                ? currentRef
                : undefined
            }
            data-unit={index}
            className={`newline ${wrong ? "incorrect" : ""}`}
          >
            ↵
          </span>,
        );
        offset++;
      }
      return (
        <div className="code-line" key={lineIndex}>
          {chars.length ? chars : "\u200b"}
        </div>
      );
    });
  }, [session]);

  const positionCaret = useCallback(() => {
    const current = currentRef.current;
    const surface = surfaceRef.current;
    const doc = documentRef.current;
    if (!current || !surface || !doc || session.complete) return;
    const character = current.getBoundingClientRect();
    const documentBounds = doc.getBoundingClientRect();
    const line = current.parentElement!.getBoundingClientRect();
    const codeStyle = getComputedStyle(doc);
    const fontSize = parseFloat(codeStyle.fontSize);
    const lineHeight = parseFloat(codeStyle.lineHeight);
    const height = fontSize * 1.2;
    const left = character.left - documentBounds.left;
    const lineTop = line.top - documentBounds.top;
    const top = lineTop + (lineHeight - height) / 2;
    setCaret((previous) =>
      previous.left === left && previous.top === top && previous.height === height
        ? previous
        : { left, top, height },
    );
    surface.scrollTop = Math.max(0, lineTop - lineHeight);
    if (left < surface.scrollLeft + 20)
      surface.scrollLeft = Math.max(0, left - 30);
    else if (left > surface.scrollLeft + surface.clientWidth - 40)
      surface.scrollLeft = left - surface.clientWidth + 80;
  }, [session.complete]);

  useLayoutEffect(() => {
    positionCaret();
  }, [
    positionCaret,
    session.input.length,
    session.prepared,
    appearance.fontSize,
    popup,
  ]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const doc = documentRef.current;
    if (!surface || !doc) return;
    let disposed = false;
    const position = () => {
      if (!disposed) positionCaret();
    };
    const observer = new ResizeObserver(position);
    observer.observe(surface);
    observer.observe(doc);
    document.fonts.addEventListener("loadingdone", position);
    void document.fonts.ready.then(position);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", position);
    };
  }, [positionCaret, session.prepared, popup]);

  const commands = [
    {
      label: "workspace: typing",
      icon: "keyboard" as const,
      action: () => switchWorkspace("typing"),
    },
    {
      label: "workspace: solving",
      icon: "method" as const,
      action: () => switchWorkspace("solve"),
    },
    ...(workspace === "typing" ? [
    {
      label: "restart test",
      icon: "restart" as const,
      action: () => {
        if (snippet) start(snippet, true);
      },
    },
    { label: "next snippet", icon: "next" as const, action: nextSnippet },
    {
      label: "mode: generated",
      icon: "code" as const,
      action: () => updatePreferences({ mode: "generated" }),
    },
    {
      label: "mode: solutions",
      icon: "method" as const,
      action: () => updatePreferences({ mode: "solution" }),
    },
    {
      label: "mode: custom code",
      icon: "terminal" as const,
      action: () => openPopup("custom"),
    },
    ...(["python", "java"] as Language[]).map((language) => ({
      label: `language: ${language}`,
      icon: "globe" as const,
      action: () => updatePreferences({ language }),
    })),
    ...(["short", "standard", "long", "any"] as Length[]).map((length) => ({
      label: `length: ${length}`,
      icon: "code" as const,
      action: () => updatePreferences({ length }),
    })),
    {
      label: "solutions: single method",
      icon: "method" as const,
      action: () => updatePreferences({ mode: "solution", scope: "method" }),
    },
    {
      label: "solutions: full implementation",
      icon: "method" as const,
      action: () => updatePreferences({ mode: "solution", scope: "full" }),
    },
    ] : []),
    {
      label: "settings",
      icon: "settings" as const,
      action: () => openPopup("settings"),
    },
    {
      label: "change theme",
      icon: "palette" as const,
      action: () => openPopup("themes"),
    },
    {
      label: "local history",
      icon: "history" as const,
      action: () => openPopup("history"),
    },
    {
      label: "snippet source and reference",
      icon: "info" as const,
      action: () => openPopup("source"),
    },
  ].filter(
    (command) =>
      (snippet !== null ||
        (command.label !== "restart test" &&
          command.label !== "snippet source and reference")) &&
      command.label.includes(search.toLowerCase()),
  );
  const popupTitles: Record<Exclude<Popup, null>, string> = {
    commands: "command line",
    settings: "settings",
    history: "history",
    custom: "custom code",
    source: "snippet",
    review: "test review",
    about: "about",
    themes: "theme",
  };
  const awaitingCustom = !snippet && prefs.mode === "custom";
  const blockedEnding =
    !session.complete &&
    session.input.length === session.prepared.units.length &&
    !!snippet;

  return (
    <div
      className={`app ${active ? "focus-mode" : ""}`}
      style={style}
      data-theme={appearance.theme}
      data-workspace={workspace}
    >
      <header className="header content-width">
        <button
          className="logo"
          aria-label="Monkeycode home"
          onClick={() => {
            setPopup(null);
            switchWorkspace("typing");
            if (snippet) start(snippet);
          }}
        >
          <Icon name="keyboard" size={40} />
          <span className="logo-text">
            <span className="logo-tagline">code typing practice</span>monkeycode
          </span>
        </button>
        <nav className="header-nav" aria-label="Main navigation">
          <button
            className={`workspace-button ${workspace === "typing" ? "selected" : ""}`}
            aria-label="Typing test"
            title="Typing test"
            aria-pressed={workspace === "typing"}
            onClick={() => {
              switchWorkspace("typing");
            }}
          >
            <Icon name="keyboard" size={14} />
            type
          </button>
          <button
            className={`workspace-button ${workspace === "solve" ? "selected" : ""}`}
            aria-label="Solve an exercise"
            aria-pressed={workspace === "solve"}
            onClick={() => switchWorkspace("solve")}
          >
            <Icon name="method" size={14} />
            solve
          </button>
          <button
            className="icon-button"
            aria-label="Local history"
            title="Local history"
            onClick={() => openPopup("history")}
          >
            <Icon name="history" />
          </button>
          <button
            className="icon-button"
            aria-label="About Monkeycode"
            title="About"
            onClick={() => openPopup("about")}
          >
            <Icon name="info" />
          </button>
          <button
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => openPopup("settings")}
          >
            <Icon name="settings" />
          </button>
        </nav>
        <button
          className="icon-button command-button"
          aria-label="Open command line"
          title="Command line (Escape)"
          onClick={() => openPopup("commands")}
        >
          <Icon name="terminal" />
        </button>
      </header>
      <main
        className={`main content-width ${session.complete && snippet ? "show-results" : ""}`}
        hidden={workspace !== "typing"}
      >
        {!(session.complete && snippet) && (
          <div className="test-config" aria-label="Test configuration">
            <div className="config-group" aria-label="Language">
              {(["python", "java"] as Language[]).map((language) => (
                <button
                  key={language}
                  aria-pressed={prefs.language === language}
                  className={prefs.language === language ? "selected" : ""}
                  onClick={() => updatePreferences({ language })}
                >
                  {language}
                </button>
              ))}
            </div>
            <span className="config-separator" />
            <div className="config-group modes" aria-label="Mode">
              <button
                className={prefs.mode === "generated" ? "selected" : ""}
                aria-pressed={prefs.mode === "generated"}
                onClick={() => updatePreferences({ mode: "generated" })}
              >
                <Icon name="code" size={12} />
                generated
              </button>
              <button
                className={prefs.mode === "solution" ? "selected" : ""}
                aria-pressed={prefs.mode === "solution"}
                onClick={() => updatePreferences({ mode: "solution" })}
              >
                <Icon name="method" size={12} />
                solutions
              </button>
              <button
                className={prefs.mode === "custom" ? "selected" : ""}
                aria-pressed={prefs.mode === "custom"}
                onClick={() => {
                  setCustomCode(
                    snippet?.origin === "custom" ? snippet.code : customCode,
                  );
                  openPopup("custom");
                }}
              >
                <Icon name="terminal" size={12} />
                custom
              </button>
            </div>
            {prefs.mode !== "custom" && (
              <>
                <span className="config-separator" />
                <div
                  className="config-group lengths"
                  aria-label="Snippet length"
                >
                  {(["short", "standard", "long", "any"] as Length[]).map(
                    (length) => (
                      <button
                        key={length}
                        aria-pressed={prefs.length === length}
                        className={prefs.length === length ? "selected" : ""}
                        onClick={() => updatePreferences({ length })}
                      >
                        {length === "any" ? "all" : length}
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {prefs.mode === "solution" && !(session.complete && snippet) && (
          <div className="scope-config" aria-label="Solution scope">
            {(["method", "full"] as Scope[]).map((scope) => (
              <button
                key={scope}
                className={prefs.scope === scope ? "selected" : ""}
                aria-pressed={prefs.scope === scope}
                onClick={() => updatePreferences({ scope })}
              >
                {scope === "method" ? "single method" : "full implementation"}
              </button>
            ))}
          </div>
        )}
        {snippet && session.complete ? (
          <Results
            snippet={snippet}
            session={session}
            samples={samples}
            onNext={nextSnippet}
            onRepeat={() => start(snippet, true)}
            onReview={() => openPopup("review")}
            onSource={() => openPopup("source")}
          />
        ) : snippet ? (
          <section className="test" aria-label="Code typing test">
            <div className="test-heading">
              <div className="test-label">
                <button
                  onClick={() => openPopup("source")}
                  title={`${snippet.title} · ${scoredLength(snippet.code)} scored characters · source and reference`}
                  aria-label="Snippet source and reference"
                >
                  <Icon name="globe" size={14} />
                  {snippet.language}
                  {prefs.mode === "solution" && (
                    <span className="test-title"> / {snippet.title}</span>
                  )}
                </button>
                {prefs.mode === "custom" && (
                  <button
                    onClick={() => {
                      setCustomCode(snippet.code);
                      openPopup("custom");
                    }}
                    className="edit-custom"
                  >
                    edit
                  </button>
                )}
              </div>
              <div className="live-progress" aria-live="off">
                {session.startedAt !== null && (
                  <>
                    <span>
                      {session.input.length}/{session.prepared.units.length}
                    </span>
                    <span className="live-speed">
                      {Math.round(stats.wpm)} wpm
                    </span>
                  </>
                )}
              </div>
            </div>
            <div
              className={`typing-area ${focused ? "has-focus" : "out-of-focus"}`}
            >
              <div
                ref={surfaceRef}
                className="code-viewport"
                onClick={focusInput}
              >
                <div className="code-document" ref={documentRef}>
                  <div aria-hidden="true">{lines}</div>
                  <span
                    aria-hidden="true"
                    className={`caret ${appearance.smoothCaret ? "smooth-caret" : ""} ${session.startedAt === null ? "idle-caret" : ""}`}
                    style={{
                      left: caret.left,
                      top: caret.top,
                      height: caret.height,
                      visibility: focused ? "visible" : "hidden",
                    }}
                  />
                  <textarea
                    ref={inputRef}
                    className="typing-input"
                    style={{ left: caret.left, top: caret.top }}
                    aria-label="Type the displayed code"
                    aria-describedby="typing-help typing-prompt typing-position"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    data-gramm="false"
                    data-lpignore="true"
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onInput={onInput}
                    onKeyDown={onKey}
                    onCompositionStart={() => {
                      composition.current = true;
                    }}
                    onCompositionEnd={(event) => {
                      composition.current = false;
                      commit(event.currentTarget.value);
                      event.currentTarget.value = "";
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      setNotice(
                        "Paste is disabled during a test. Use custom to practice your own code.",
                      );
                    }}
                    onDrop={(event) => event.preventDefault()}
                  />
                </div>
              </div>
              {!focused && (
                <button className="focus-warning" onClick={focusInput}>
                  <Icon name="terminal" />
                  Click here or press any key to focus
                </button>
              )}
            </div>
            <pre id="typing-prompt" className="sr-only">
              {session.prepared.text}
            </pre>
            <span id="typing-position" className="sr-only">
              {session.input.length} of {session.prepared.units.length}{" "}
              characters entered. {stats.errors} uncorrected errors.
            </span>
            <div className="test-bottom">
              <button
                className="restart-button icon-button"
                aria-label="Restart test"
                title="Restart test"
                onClick={() => start(snippet, true)}
              >
                <Icon name="restart" size={18} />
              </button>
              {blockedEnding && (
                <span className="ending-warning" role="status">
                  correct the final token with backspace to finish
                </span>
              )}
            </div>
          </section>
        ) : (
          <section className="empty-test">
            <p>
              {awaitingCustom
                ? "your code, your practice"
                : "no solutions match these filters"}
            </p>
            <button
              onClick={() =>
                awaitingCustom
                  ? openPopup("custom")
                  : updatePreferences({ length: "any" })
              }
            >
              {awaitingCustom ? "paste custom code" : "choose all lengths"}
            </button>
          </section>
        )}
        {notice && !popup && (
          <div className="toast" role="status">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </main>
      {solveVisited && (
        <main className="main content-width solve-main" hidden={workspace !== "solve"}>
          <Solve active={workspace === "solve"} />
        </main>
      )}
      <footer className="footer content-width">
        <div className="shortcuts" id="typing-help">
          <div>
            <kbd>{workspace === "typing" ? "tab" : "ctrl/cmd"}</kbd>
            <span>+</span>
            <kbd>enter</kbd>
            <span>{workspace === "typing" ? " - restart test" : " - run · add shift to submit"}</span>
          </div>
          <div>
            <kbd>esc</kbd>
            <span> - command line</span>
          </div>
          <span className="code-hint">
            {workspace === "typing"
              ? "auto indentation · type spaces & newlines"
              : "drafts stay in memory · Run/Submit sends code"}
          </span>
        </div>
        <div className="footer-row">
          <div className="footer-links">
            <button onClick={() => openPopup("about")}>
              <Icon name="code" size={12} />
              about
            </button>
            <button onClick={() => openPopup("history")}>
              <Icon name="history" size={12} />
              history
            </button>
            <a
              href="./THIRD_PARTY_NOTICES.txt"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="info" size={12} />
              licenses
            </a>
            <a href="https://monkeytype.com" target="_blank" rel="noreferrer">
              inspired by monkeytype
            </a>
          </div>
          <div className="footer-settings">
            <button
              onClick={() => openPopup("themes")}
              aria-label="Change theme"
            >
              <Icon name="palette" size={12} />
              {appearance.theme}
            </button>
            <span
              className="local-version"
              title={workspace === "typing"
                ? "Typing preferences and results stay in this browser"
                : "Solving sends code to OnlineCompiler; attempt metadata stays in this browser"}
            >
              {workspace === "typing" ? "local · v1.0" : "hosted execution · local history"}
            </span>
          </div>
        </div>
      </footer>
      {popup && (
        <Dialog
          key={popup}
          title={popupTitles[popup]}
          onClose={() => setPopup(null)}
          wide={popup === "history" || popup === "review" || popup === "source"}
        >
          {notice && (
            <p className="popup-notice" role="status">
              {notice}
            </p>
          )}
          {popup === "commands" && (
            <div
              className="command-list"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const buttons = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      ".command-item",
                    ),
                  );
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % buttons.length
                      : index <= 0
                        ? buttons.length - 1
                        : index - 1;
                  buttons[next]?.focus();
                }
                if (
                  event.key === "Enter" &&
                  event.target instanceof HTMLInputElement &&
                  commands[0]
                ) {
                  event.preventDefault();
                  commands[0].action();
                }
              }}
            >
              <label className="command-search">
                <Icon name="search" />
                <input
                  data-autofocus
                  aria-label="Search commands"
                  placeholder="Search..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="command-items">
                {commands.map((command) => (
                  <button
                    className="command-item"
                    key={command.label}
                    onClick={command.action}
                  >
                    <Icon name={command.icon} />
                    {command.label}
                  </button>
                ))}
                {!commands.length && (
                  <p className="no-commands">no matching commands</p>
                )}
              </div>
            </div>
          )}
          {popup === "custom" && (
            <form className="custom-form" onSubmit={importCode}>
              <p>
                Paste code you have permission to use. Nothing is uploaded,
                saved as source, or executed.
              </p>
              <label>
                name
                <input
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  maxLength={100}
                />
              </label>
              <div className="form-language" aria-label="Custom code language">
                {(["python", "java"] as Language[]).map((language) => (
                  <button
                    type="button"
                    key={language}
                    className={customLanguage === language ? "selected" : ""}
                    aria-pressed={customLanguage === language}
                    onClick={() => setCustomLanguage(language)}
                  >
                    {language}
                  </button>
                ))}
              </div>
              <label>
                code
                <textarea
                  data-autofocus
                  className="custom-code"
                  value={customCode}
                  onChange={(event) => setCustomCode(event.target.value)}
                  placeholder="paste your code here"
                  spellCheck={false}
                />
              </label>
              <button className="solid-button" type="submit">
                start test
              </button>
            </form>
          )}
          {popup === "settings" && (
            <div className="settings-list">
              <div className="setting">
                <div>
                  <h3>font size</h3>
                  <p>Size of the typing text.</p>
                </div>
                <div className="setting-options">
                  {([24, 28, 32] as const).map((fontSize) => (
                    <button
                      key={fontSize}
                      className={
                        appearance.fontSize === fontSize ? "selected" : ""
                      }
                      aria-pressed={appearance.fontSize === fontSize}
                      onClick={() => updateAppearance({ fontSize })}
                    >
                      {fontSize / 16}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting">
                <div>
                  <h3>smooth caret</h3>
                  <p>Move the caret smoothly while typing.</p>
                </div>
                <div className="setting-options">
                  {[false, true].map((smoothCaret) => (
                    <button
                      key={String(smoothCaret)}
                      className={
                        appearance.smoothCaret === smoothCaret ? "selected" : ""
                      }
                      aria-pressed={appearance.smoothCaret === smoothCaret}
                      onClick={() => updateAppearance({ smoothCaret })}
                    >
                      {smoothCaret ? "on" : "off"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting">
                <div>
                  <h3>theme</h3>
                  <p>High contrast keeps the layout with brighter text.</p>
                </div>
                <button onClick={() => openPopup("themes")}>
                  {appearance.theme}
                  <Icon name="palette" />
                </button>
              </div>
              <div className="setting-note">
                Indentation is automatic. The final word, string, or punctuation
                token must be correct. Earlier errors can remain. The clock does
                not pause when you leave the test.
              </div>
            </div>
          )}
          {popup === "themes" && (
            <div className="theme-list">
              {(Object.keys(themes) as ThemeName[]).map((theme) => (
                <button
                  className={`theme-option ${appearance.theme === theme ? "selected" : ""}`}
                  key={theme}
                  onClick={() => updateAppearance({ theme })}
                >
                  <span>{theme}</span>
                  <span
                    className="theme-swatch"
                    style={{ background: themes[theme].background }}
                  >
                    <i style={{ background: themes[theme].main }} />
                    <i style={{ background: themes[theme].sub }} />
                    <i style={{ background: themes[theme].text }} />
                  </span>
                  {appearance.theme === theme && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
          {popup === "history" && (
            <div className="history">
              <p>Saved in this browser. No account or uploads.</p>
              {runs.length ? (
                <div className="history-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>test</th>
                        <th>language</th>
                        <th>wpm</th>
                        <th>accuracy</th>
                        <th>date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td>{run.title}</td>
                          <td>{run.language}</td>
                          <td>{Math.round(run.cpm / 5)}</td>
                          <td>{Math.round(run.accuracy)}%</td>
                          <td>
                            {new Date(run.completedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-history">
                  complete a test to start your history
                </p>
              )}
            </div>
          )}
          {popup === "source" && (
            <div className="source-info">
              {snippet ? (
                <>
                  <h3>{snippet.title}</h3>
                  <p>{snippet.description}</p>
                  <p>
                    {snippet.language} · {scoredLength(snippet.code)} scored
                    characters ·{" "}
                    {snippet.scope === "method"
                      ? "single method"
                      : "full implementation"}
                  </p>
                  {snippet.sourceUrl && (
                    <p>
                      <a
                        href={snippet.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        original source
                      </a>{" "}
                      ·{" "}
                      <a
                        href="./THIRD_PARTY_NOTICES.txt"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {snippet.license} license & attribution
                      </a>
                    </p>
                  )}
                  <pre tabIndex={0} aria-label="Code reference">
                    {snippet.code}
                  </pre>
                </>
              ) : (
                <p>Choose a test to view its source.</p>
              )}
            </div>
          )}
          {popup === "review" && (
            <div className="review">
              <p>
                {stats.errors} uncorrected errors. Underlined characters show
                the expected text; hover for your input.
              </p>
              <div className="review-code">{lines}</div>
              <ul className="error-list">
                {session.input.map((unit, index) =>
                  unit !== session.prepared.units[index] ? (
                    <li key={index}>
                      position {index + 1}: expected{" "}
                      <code>
                        {JSON.stringify(session.prepared.units[index])}
                      </code>
                      , typed <code>{JSON.stringify(unit)}</code>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          {popup === "about" && (
            <div className="about">
              <h3>monkeytype, for code.</h3>
              <p>
                Practice transcribing Python and Java. Generated mode uses eight
                local, purpose-driven recipe families. Solutions contains eight
                curated problems in both languages, with single-method and
                full-implementation variants.
              </p>
              <p>
                Choose a language, mode, and length above the test. Press Escape
                for every command. Automatic indentation is free; internal
                spaces and newlines count. Speed uses five-character-equivalent
                WPM, not programming-language words.
              </p>
              <p>
                The final lexical token must match before finishing; earlier
                errors may remain. Correcting mistakes does not erase their
                accuracy penalty. Typing code is never executed, and custom
                typing source is not persisted. Solving is separate: explicit
                Run/Submit actions send your method to OnlineCompiler, which
                retains execution history. Solving drafts and invite tokens
                stay in memory; only attempt metadata is saved locally.
              </p>
              <p>
                Independently implemented from{" "}
                <a
                  href="https://monkeytype.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Monkeytype’s
                </a>{" "}
                public interface. Not affiliated with Monkeytype or LeetCode.
                Source implementations and fonts retain their own licenses.
              </p>
              <p>
                <a
                  href="./THIRD_PARTY_NOTICES.txt"
                  target="_blank"
                  rel="noreferrer"
                >
                  solution attribution & licenses
                </a>
              </p>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
