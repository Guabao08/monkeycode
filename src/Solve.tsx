import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Language } from "./types";
import { firstAtLeast } from "./learning/first-at-least";
import { createJob, ExecutionApiError, getJob, loadExercise } from "./learning/client";
import { completeAttempt, loadProgress, progressStorageIssue, recordExposure, saveProgress, type PendingAttempt, type SolveProgress } from "./learning/progress";
import type { ExecutionResult, JobView, Submission } from "./learning/execution";
import type { Activity, AttemptConditions } from "./learning/types";
import "./solve.css";

const starters: Record<Language, string> = {
  python: `${firstAtLeast.implementations.python.signature}\n    pass\n`,
  java: `${firstAtLeast.implementations.java.signature} {\n    // Replace this placeholder with your implementation.\n    return -1;\n}\n`,
};

type Snapshot = {
  action: Submission["action"];
  conditions: AttemptConditions;
  code: string | null;
};
type ShownResult = { job: JobView; snapshot: Snapshot };
const languageName = (language: Language) => language === "python" ? "Python" : "Java";
const outcomeName = (status: ExecutionResult["status"], action: Submission["action"]) => ({
  passed: action === "run" ? "Examples passed" : "Functional checks passed",
  "wrong-answer": action === "run" ? "Example mismatch" : "Functional check mismatch",
  "compile-error": "Compile error",
  "runtime-error": "Runtime error",
  "resource-limit": "Resource limit",
  "service-error": "Execution service unavailable",
})[status];
const readable = (value: unknown) => JSON.stringify(value) ?? "undefined";
const safeError = (error: unknown) => error instanceof ExecutionApiError
  ? error.message
  : "The execution service could not be reached. Check your connection and try again.";

export default function Solve({ active }: { active: boolean }) {
  const [initial] = useState(() => {
    const loaded = loadProgress();
    return {
      ...recordExposure(loaded, firstAtLeast.id, firstAtLeast.version),
      storageIssue: progressStorageIssue(),
    };
  });
  const [progress, setProgress] = useState(initial.progress);
  const [previouslySeen, setPreviouslySeen] = useState(initial.previouslySeen);
  const progressRef = useRef(progress);
  const [storageFailed, setStorageFailed] = useState(initial.storageIssue !== null);
  const [exercise, setExercise] = useState(firstAtLeast);
  const [language, setLanguage] = useState<Language>("python");
  const [drafts, setDrafts] = useState(starters);
  const [activity, setActivity] = useState<Activity>("practice");
  const [invite, setInvite] = useState("");
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [executionNotice, setExecutionNotice] = useState("");
  const [posting, setPosting] = useState(false);
  const [uncertainPost, setUncertainPost] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [jobUnavailable, setJobUnavailable] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobView["status"]>("queued");
  const [result, setResult] = useState<ShownResult | null>(null);
  const activeSnapshot = useRef<Snapshot | null>(initial.progress.pending ? {
    action: initial.progress.pending.action,
    conditions: initial.progress.pending.conditions,
    code: null,
  } : null);
  const postingRef = useRef(false);
  const mounted = useRef(false);
  const connectionRequest = useRef<AbortController | null>(null);
  const executionRequest = useRef<AbortController | null>(null);
  const connectionGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      connectionGeneration.current += 1;
      connectionRequest.current?.abort();
      executionRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!active) setPreviouslySeen(true);
  }, [active]);

  useEffect(() => {
    if (!saveProgress(progress)) setStorageFailed(true);
  }, [progress]);

  const changeProgress = useCallback((next: SolveProgress) => {
    progressRef.current = next;
    setProgress(next);
  }, []);

  const finishJob = useCallback((job: JobView, pending: PendingAttempt, snapshot: Snapshot) => {
    setJobStatus(job.status);
    if (job.status !== "completed" || !job.result) return;
    changeProgress(completeAttempt(progressRef.current, {
      id: job.id,
      completedAt: Date.now(),
      action: pending.action,
      status: job.result.status,
      conditions: pending.conditions,
    }));
    setResult({ job, snapshot });
    setExecutionNotice("");
    setPollStopped(false);
  }, [changeProgress]);

  useEffect(() => {
    const pending = progress.pending;
    const token = verifiedToken;
    if (!pending || !token || pollStopped || liveJobId === pending.id) return;
    const controller = new AbortController();
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const job = await getJob(token, pending.id, controller.signal);
        if (stopped) return;
        setJobUnavailable(false);
        const snapshot = activeSnapshot.current ?? {
          action: pending.action, conditions: pending.conditions, code: null,
        };
        finishJob(job, pending, snapshot);
        if (job.status !== "completed") timer = window.setTimeout(() => { void poll(); }, 1200);
      } catch (error) {
        if (stopped) return;
        setPollStopped(true);
        setJobUnavailable(error instanceof ExecutionApiError && error.status === 404);
        setExecutionNotice(`${safeError(error)} The job may still be running. Reconnect with the same invite if needed, then check this job again; do not submit another job.`);
        if (error instanceof ExecutionApiError && (error.status === 401 || error.status === 403)) {
          setVerifiedToken(null);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [progress.pending, verifiedToken, pollVersion, pollStopped, liveJobId, finishJob]);

  function invalidateConnection(clearInvite = false) {
    connectionGeneration.current += 1;
    connectionRequest.current?.abort();
    executionRequest.current?.abort();
    executionRequest.current = null;
    setLiveJobId(null);
    setConnecting(false);
    setVerifiedToken(null);
    setConnectionNotice("");
    if (clearInvite) setInvite("");
  }

  async function connect() {
    if (connecting || !invite.trim()) return;
    const token = invite.trim();
    const generation = ++connectionGeneration.current;
    const controller = new AbortController();
    connectionRequest.current?.abort();
    connectionRequest.current = controller;
    setConnecting(true);
    setConnectionNotice("");
    try {
      const publicExercise = await loadExercise(token, controller.signal);
      if (!mounted.current || generation !== connectionGeneration.current) return;
      setExercise(publicExercise);
      setVerifiedToken(token);
      setConnectionNotice("Invite verified. Ready to execute.");
    } catch (error) {
      if (!mounted.current || generation !== connectionGeneration.current) return;
      setVerifiedToken(null);
      setConnectionNotice(safeError(error));
    } finally {
      if (mounted.current && generation === connectionGeneration.current) setConnecting(false);
    }
  }

  async function execute(action: Submission["action"]) {
    if (!verifiedToken || postingRef.current || progressRef.current.pending || uncertainPost) return;
    const code = drafts[language];
    if (!code.trim()) {
      setExecutionNotice("Write an implementation before running or submitting.");
      return;
    }
    if (code.includes("\0")) {
      setExecutionNotice("Remove the NUL character from your code before sending it.");
      return;
    }
    if (new TextEncoder().encode(code).byteLength > 32 * 1024) {
      setExecutionNotice("Code must be at most 32 KiB in UTF-8. Shorten it before sending.");
      return;
    }
    postingRef.current = true;
    setPosting(true);
    setResult(null);
    setExecutionNotice("");
    setPollStopped(false);
    const snapshot: Snapshot = {
      action,
      code,
      conditions: {
        exerciseId: exercise.id,
        exerciseVersion: exercise.version,
        language,
        activity,
        previouslySeen,
        assistance: [],
      },
    };
    activeSnapshot.current = snapshot;
    setPreviouslySeen(true);
    const controller = new AbortController();
    executionRequest.current = controller;
    try {
      const { job, completion } = await createJob(verifiedToken, {
        exerciseId: "first-at-least", exerciseVersion: 1, language, action, code,
      }, controller.signal);
      if (!mounted.current) return;
      const pending: PendingAttempt = {
        id: job.id, createdAt: job.createdAt, action, conditions: snapshot.conditions,
      };
      setLiveJobId(job.id);
      changeProgress({ ...progressRef.current, pending });
      finishJob(job, pending, snapshot);
      void completion.then(completed => {
        if (!mounted.current || executionRequest.current !== controller || controller.signal.aborted) return;
        finishJob(completed, pending, snapshot);
      }).catch(error => {
        if (!mounted.current || executionRequest.current !== controller || controller.signal.aborted) return;
        setExecutionNotice(`${safeError(error)} Recovering the saved job by ID.`);
      }).finally(() => {
        if (executionRequest.current !== controller) return;
        executionRequest.current = null;
        if (mounted.current) setLiveJobId(current => current === job.id ? null : current);
      });
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ExecutionApiError && error.jobId) {
        changeProgress({
          ...progressRef.current,
          pending: { id: error.jobId, createdAt: new Date().toISOString(), action, conditions: snapshot.conditions },
        });
        setPollStopped(true);
        setExecutionNotice("The service returned a job ID but its response could not be read. The job may be running. Check this job again; do not send a new request.");
      } else if (error instanceof ExecutionApiError && error.uncertain) {
        setUncertainPost(true);
        setExecutionNotice("The request may have reached the execution service, but no job ID was received. It may still execute and consume budget. Do not blindly resubmit. There is no job ID available to check; no retry has been sent.");
      } else {
        setExecutionNotice(safeError(error));
      }
      if (error instanceof ExecutionApiError && [401, 403, 429, 503].includes(error.status ?? 0)) {
        setVerifiedToken(null);
        setConnectionNotice("Execution is unavailable. Resolve the issue above, then connect again. This is not a failed solution.");
      }
    } finally {
      postingRef.current = false;
      if (mounted.current) setPosting(false);
    }
  }

  function editorKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      void execute(event.shiftKey ? "submit" : "run");
    }
  }

  const pending = progress.pending;
  const shownSnapshot = result?.snapshot ?? (posting || pending || uncertainPost ? activeSnapshot.current : null);
  const draftChanged = shownSnapshot !== null && shownSnapshot.code !== null
    && (shownSnapshot.conditions.language !== language || shownSnapshot.code !== drafts[language]);
  const executionDisabled = !verifiedToken || posting || !!pending || uncertainPost;
  const feedback = result?.job.result?.feedback;
  const executionResult = result?.job.result;

  return (
    <section className="solve" aria-label="Solving workspace">
      <div className="solve-workspace">
        <section className="solve-prompt" aria-labelledby="solve-title">
          <h1 id="solve-title">{exercise.title}</h1>
          <p className="solve-statement">{exercise.statement}</p>
          <h2>Examples</h2>
          <div className="solve-table-scroll solve-examples">
            <table>
              <caption className="solve-visually-hidden">Public example inputs and expected outputs</caption>
              <thead><tr><th>Values</th><th>Target</th><th>Returns</th></tr></thead>
              <tbody>{exercise.examples.map((example, index) => (
                <tr key={index}>
                  <td><details className="solve-example-detail"><summary><code>{readable(example.input.values)}</code></summary><p>{example.explanation}</p></details></td>
                  <td><code>{example.input.target}</code></td>
                  <td><code>{example.expected}</code></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <details className="solve-disclosure solve-constraints">
            <summary>Constraints &amp; complexity</summary>
            <ul>{exercise.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul>
            <p>Target: {exercise.requirements.time} time, {exercise.requirements.auxiliarySpace} extra space.</p>
            <p className="solve-fine">Functional checks do not verify time or space complexity.</p>
          </details>
        </section>

        <section className="solve-editor-section" aria-label="Implementation editor">
          <div className="solve-editor-toolbar">
            <span className="solve-editor-caption">Implementation</span>
            <div className="solve-languages" role="group" aria-label="Implementation language">
              {(["python", "java"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{languageName(value)}</button>
              ))}
            </div>
          </div>
          <label className="solve-visually-hidden" htmlFor="solve-code">Your {languageName(language)} implementation</label>
          <textarea
            id="solve-code"
            className="solve-code"
            value={drafts[language]}
            onChange={(event) => setDrafts((previous) => ({ ...previous, [language]: event.target.value }))}
            onKeyDown={editorKey}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            wrap="off"
            aria-describedby="solve-method-help solve-key-help"
          />
          <div className="solve-editor-meta">
            <details className="solve-disclosure">
              <summary>Editor help</summary>
              <p id="solve-method-help">{exercise.implementations[language].instructions}</p>
              <p id="solve-key-help">Tab moves to the next control. Ctrl/Cmd+Enter runs examples; add Shift to submit. Use spaces for indentation.</p>
            </details>
            <details className="solve-disclosure solve-context-details">
              <summary>Practice options</summary>
              <div className="solve-context">
                <label htmlFor="solve-activity">Activity</label>
                <select id="solve-activity" value={activity} onChange={(event) => setActivity(event.target.value as Activity)}>
                  <option value="practice">Practice</option>
                  <option value="independent-check">Independent check</option>
                </select>
              </div>
              <p>{initial.storageIssue ? "Prior exposure could not be read reliably. Do not treat this as an unseen check." : previouslySeen ? "Prior practice or a visit to this exercise is recorded: this is not an unseen check." : "No prior visit is recorded in this browser; that does not establish an unseen check."} History cannot certify independence. Only in-app help is recorded; external help is not tracked.</p>
              <p>Run checks public examples; Submit adds private checks. Requests are never automatically retried.</p>
            </details>
          </div>

          <details className="solve-disclosure solve-access">
            <summary>{verifiedToken ? "Execution connected" : "Connect an invite to run code"}</summary>
            <form className="solve-connect" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
              <label htmlFor="solve-invite">Execution invite</label>
            <div className="solve-connect-controls">
              <input id="solve-invite" type="password" value={invite} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Enter your invite" onChange={(event) => { invalidateConnection(); setInvite(event.target.value); }} />
              {verifiedToken ? <button type="button" onClick={() => invalidateConnection(true)}>Disconnect</button> : <button type="submit" disabled={connecting || !invite.trim()}>{connecting ? "Connecting…" : "Connect"}</button>}
            </div>
            </form>
          </details>
          <p className="solve-connection-status" role="status">{connecting ? "Checking invite…" : connectionNotice || (verifiedToken ? "Connected · invite kept only in memory." : "")}</p>
          <div className="solve-execution-controls">
            <button className="solve-run" type="button" disabled={executionDisabled} onClick={() => { void execute("run"); }}>Run examples <span>1 reserved unit</span></button>
            <button className="solve-submit" type="button" disabled={executionDisabled} onClick={() => { void execute("submit"); }}>Submit <span>9 reserved units</span></button>
          </div>
          <p className="solve-privacy">Run/Submit uploads code to OnlineCompiler, which retains execution history. Reservations are nonrefundable; never include secrets.</p>

          {(posting || pending) && <div className="solve-job" role="status">
            <p>{posting ? "Sending one request…" : `${jobStatus === "running" ? "Running" : "Queued or awaiting a status check"} · ${languageName(pending!.conditions.language)} · ${pending!.action === "run" ? "public examples" : "private checks"}`}</p>
            {pending && <>
              <p className="solve-fine">Job <code>{pending.id}</code>. Disconnecting does not cancel it. After reload, reconnect with the same invite to check this job; it will not be resubmitted.</p>
              {(!verifiedToken || pollStopped) && <button type="button" disabled={!verifiedToken} onClick={() => { setExecutionNotice(""); setPollStopped(false); setPollVersion((value) => value + 1); }}>Check job again</button>}
              {pollStopped && jobUnavailable && <button type="button" className="solve-risk" onClick={() => {
                changeProgress({ ...progressRef.current, pending: null });
                activeSnapshot.current = null;
                setPollStopped(false);
                setJobUnavailable(false);
                setExecutionNotice("Stopped tracking the unavailable job. This does not cancel remote execution; use the original invite to retrieve it if it still exists. No new request was sent.");
              }}>Forget unavailable job (does not cancel)</button>}
            </>}
          </div>}
          {executionNotice && <p className="solve-notice" role="alert">{executionNotice}</p>}
          {uncertainPost && <button type="button" className="solve-risk" onClick={() => { setUncertainPost(false); setExecutionNotice("You acknowledged that a new request may duplicate the previous job and consume more budget. No request has been sent automatically."); }}>Allow a new request despite duplicate-job risk</button>}
          {shownSnapshot && <p className="solve-fine">{languageName(shownSnapshot.conditions.language)} · {shownSnapshot.action === "run" ? "Run" : "Submit"} · {shownSnapshot.conditions.activity} · {shownSnapshot.conditions.previouslySeen ? "prior visit recorded" : "no prior visit recorded"} · {shownSnapshot.conditions.assistance.length ? `in-app help: ${shownSnapshot.conditions.assistance.join(", ")}` : "no in-app help recorded"}.{draftChanged ? " The current draft differs from the code sent; results belong to the submitted snapshot, not these edits." : shownSnapshot.code === null ? " Resumed job: submitted source was not stored locally, so it cannot be compared with this draft." : ""}</p>}

          {executionResult && result && <section className="solve-result" aria-labelledby="solve-result-title" aria-live="polite">
            <h2 id="solve-result-title">{outcomeName(executionResult.status, result.snapshot.action)}</h2>
            {executionResult.status === "passed" && <p>{result.snapshot.action === "run" ? "Public examples passed. Private checks have not been evaluated by this Run." : "Functional checks passed. Time and space complexity are not verified."}</p>}
            {feedback && "cases" in feedback && <div className="solve-table-scroll"><table>
              <caption>Public example results</caption>
              <thead><tr><th>Example</th><th>Outcome</th><th>Actual</th><th>Expected</th></tr></thead>
              <tbody>{feedback.cases.map((item) => <tr key={item.index}><td>{item.index + 1}</td><td>{item.passed ? "Passed" : "Mismatch"}</td><td><code>{readable(item.actual)}</code></td><td><code>{readable(item.expected)}</code></td></tr>)}</tbody>
            </table></div>}
            {result.snapshot.action === "submit" && feedback && "failureCategories" in feedback && feedback.failureCategories.length > 0 && <><p>Private failure categories (inputs and case IDs are hidden):</p><ul>{feedback.failureCategories.map((category) => <li key={category}>{category}</li>)}</ul></>}
            {executionResult.status === "runtime-error" && result.snapshot.conditions.language === "java" && executionResult.message && <p className="solve-fine">Java source-launcher compilation failures can be reported as runtime errors. Read the diagnostic below.</p>}
            {executionResult.message && <pre className="solve-diagnostic" aria-label="Execution diagnostic">{executionResult.message}</pre>}
          </section>}
        </section>
      </div>

      {storageFailed && <p className="solve-notice" role="status">Browser storage could not be read or saved reliably. Practice can continue, but attempts and pending-job recovery may not survive reload. Missing records cannot establish that an exercise is unseen.</p>}
      <details className="solve-history">
        <summary>Local attempts <span>{progress.attempts.length} recorded</span></summary>
        <p className="solve-fine">Up to 100 source-free attempts in this browser. Drafts, invites, notes and diagnostics are not saved. Clearing browser storage removes this record; refreshing clears your draft and invite.</p>
        {progress.attempts.length === 0 ? <p className="solve-history-empty">No completed attempts recorded here yet.</p> : <div className="solve-table-scroll"><table>
          <caption className="solve-visually-hidden">Recorded execution attempts and context</caption>
          <thead><tr><th>Action / language</th><th>Outcome</th><th>Completed</th><th>Recorded context</th></tr></thead>
          <tbody>{progress.attempts.map((attempt) => <tr key={attempt.id}>
            <td>{attempt.action === "run" ? "Run" : "Submit"} / {languageName(attempt.conditions.language)}</td>
            <td>{outcomeName(attempt.status, attempt.action)}</td>
            <td><time dateTime={new Date(attempt.completedAt).toISOString()}>{new Date(attempt.completedAt).toLocaleString()}</time></td>
            <td>{attempt.conditions.activity}; {attempt.conditions.previouslySeen ? "prior visit recorded" : "no prior visit recorded"}; {attempt.conditions.assistance.length ? `in-app help: ${attempt.conditions.assistance.join(", ")}` : "no in-app help recorded"}</td>
          </tr>)}</tbody>
        </table></div>}
      </details>
    </section>
  );
}
