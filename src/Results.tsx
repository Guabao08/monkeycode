import { useId, useMemo } from "react";
import Icon from "./Icon";
import { metrics, type Session } from "./engine";
import type { Snippet } from "./types";

export interface SpeedSample {
  seconds: number;
  cpm: number;
  rawCpm: number;
  errors: number;
}

interface ResultsProps {
  snippet: Snippet;
  session: Session;
  samples: SpeedSample[];
  onNext: () => void;
  onRepeat: () => void;
  onReview: () => void;
  onSource: () => void;
}

const formatSeconds = (seconds: number) =>
  Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);

function SpeedChart({
  samples,
  elapsed,
}: {
  samples: SpeedSample[];
  elapsed: number;
}) {
  const titleId = useId();
  const descriptionId = useId();

  if (samples.length === 0) {
    return (
      <div className="result-chart" role="status">
        <p className="label">No speed samples recorded for this test.</p>
      </div>
    );
  }

  const width = 900;
  const height = 240;
  const left = 44;
  const right = width - 12;
  const top = 16;
  const bottom = height - 38;
  let maxSpeed = 0;
  let maxSeconds = Math.max(elapsed, 1);
  for (const sample of samples) {
    maxSpeed = Math.max(maxSpeed, sample.cpm / 5, sample.rawCpm / 5);
    maxSeconds = Math.max(maxSeconds, sample.seconds);
  }
  const roughStep = Math.max(maxSpeed, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const step =
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) *
    magnitude;
  const ceiling = Math.ceil(Math.max(maxSpeed, 1) / step) * step;
  const x = (seconds: number) => left + (seconds / maxSeconds) * (right - left);
  const y = (wpm: number) => bottom - (wpm / ceiling) * (bottom - top);
  const correctPoints = samples
    .map((sample) => `${x(sample.seconds)},${y(sample.cpm / 5)}`)
    .join(" ");
  const rawPoints = samples
    .map((sample) => `${x(sample.seconds)},${y(sample.rawCpm / 5)}`)
    .join(" ");
  const yTicks = Array.from(
    { length: Math.round(ceiling / step) + 1 },
    (_, index) => index * step,
  );
  const xTicks = Array.from(
    { length: 6 },
    (_, index) => (index * maxSeconds) / 5,
  );

  return (
    <div className="result-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>WPM and raw WPM over time</title>
        <desc id={descriptionId}>
          {samples.length} recorded{" "}
          {samples.length === 1 ? "sample" : "samples"} over{" "}
          {formatSeconds(elapsed)} seconds. The horizontal axis shows elapsed
          seconds; the vertical axis shows words per minute. The solid line is
          correct-character WPM; the dashed line is raw WPM from all character
          attempts. Red crosses mark samples with remaining incorrect
          characters, not new error events. Lines connect recorded samples only.
        </desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="chart-grid"
              x1={left}
              y1={y(tick)}
              x2={right}
              y2={y(tick)}
              stroke="var(--sub-alt-color)"
            />
            <text
              className="chart-axis"
              x={left - 12}
              y={y(tick) + 4}
              textAnchor="end"
              fill="var(--sub-color)"
              fontSize="11"
            >
              {Number(tick.toFixed(2))}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={tick}>
            <line
              className="chart-grid"
              x1={x(tick)}
              y1={top}
              x2={x(tick)}
              y2={bottom}
              stroke="var(--sub-alt-color)"
            />
            <text
              className="chart-axis"
              x={x(tick)}
              y={bottom + 20}
              textAnchor="middle"
              fill="var(--sub-color)"
              fontSize="11"
            >
              {formatSeconds(tick)}
            </text>
          </g>
        ))}
        <text
          className="chart-axis"
          x={left}
          y={height - 2}
          fill="var(--sub-color)"
          fontSize="10"
        >
          wpm / seconds
        </text>
        <g aria-hidden="true">
          <line
            className="chart-correct"
            x1={right - 140}
            y1={height - 6}
            x2={right - 124}
            y2={height - 6}
            stroke="var(--main-color)"
            strokeWidth="2"
          />
          <text
            className="chart-axis"
            x={right - 118}
            y={height - 2}
            fill="var(--sub-color)"
            fontSize="10"
          >
            wpm
          </text>
          <line
            className="chart-raw"
            x1={right - 66}
            y1={height - 6}
            x2={right - 50}
            y2={height - 6}
            stroke="var(--sub-color)"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <text
            className="chart-axis"
            x={right - 44}
            y={height - 2}
            fill="var(--sub-color)"
            fontSize="10"
          >
            raw
          </text>
        </g>
        <polyline
          className="chart-raw"
          points={rawPoints}
          fill="none"
          stroke="var(--sub-color)"
          strokeWidth="2"
          strokeDasharray="4 4"
          strokeLinejoin="round"
        />
        <polyline
          className="chart-correct"
          points={correctPoints}
          fill="none"
          stroke="var(--main-color)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {samples.length === 1 && (
          <g>
            <circle
              className="chart-raw"
              cx={x(samples[0].seconds)}
              cy={y(samples[0].rawCpm / 5)}
              r="3"
              fill="var(--sub-color)"
            />
            <circle
              className="chart-correct"
              cx={x(samples[0].seconds)}
              cy={y(samples[0].cpm / 5)}
              r="3"
              fill="var(--main-color)"
            />
          </g>
        )}
        {samples.map(
          (sample, index) =>
            sample.errors > 0 && (
              <path
                key={index}
                className="chart-error"
                d={`M${x(sample.seconds) - 3} ${y(sample.cpm / 5) - 3}l6 6m0-6-6 6`}
                fill="none"
                stroke="var(--error-color)"
                strokeWidth="1.5"
              >
                <title>
                  {sample.errors} remaining incorrect{" "}
                  {sample.errors === 1 ? "character" : "characters"} at{" "}
                  {formatSeconds(sample.seconds)} seconds
                </title>
              </path>
            ),
        )}
      </svg>
    </div>
  );
}

export default function Results({
  snippet,
  session,
  samples,
  onNext,
  onRepeat,
  onReview,
  onSource,
}: ResultsProps) {
  const stats = useMemo(() => metrics(session, performance.now()), [session]);
  const rawWpm = stats.elapsed > 0 ? (stats.attempts * 12) / stats.elapsed : 0;
  const length = session.prepared.units.length;
  const lengthLabel =
    length <= 350 ? "short" : length <= 900 ? "standard" : "long";
  const mode = snippet.origin === "solution" ? "solutions" : snippet.origin;

  return (
    <section className="results" aria-label="Test results">
      <div className="result-main">
        <div className="result-big-stats">
          <div
            className="result-stat"
            title="Correct characters per minute divided by five"
          >
            <div className="label">wpm</div>
            <div className="value">{Math.round(stats.wpm)}</div>
          </div>
          <div
            className="result-stat"
            title="Correct character attempts divided by all character attempts"
          >
            <div className="label">acc</div>
            <div className="value">{Math.round(stats.accuracy)}%</div>
          </div>
        </div>
        <SpeedChart samples={samples} elapsed={stats.elapsed} />
      </div>
      <div className="result-secondary">
        <div className="result-stat">
          <div className="label">test type</div>
          <div className="value">
            {mode}
            <br />
            {snippet.language}
            <br />
            {lengthLabel} ·{" "}
            {snippet.scope === "method" ? "method" : "full code"}
          </div>
        </div>
        <div
          className="result-stat"
          title="All scored character attempts per minute divided by five, including corrected errors; Backspace and automatic indentation are excluded"
        >
          <div className="label">raw wpm</div>
          <div className="value">{Math.round(rawWpm)}</div>
        </div>
        <div
          className="result-stat"
          title="Correct characters remaining / incorrect characters remaining / total character attempts, including corrected characters. Automatic indentation is excluded."
        >
          <div className="label">characters</div>
          <div
            className="value"
            aria-label={`${stats.correct} correct characters, ${stats.errors} remaining incorrect characters, ${stats.attempts} character attempts`}
          >
            {stats.correct}/{stats.errors}/{stats.attempts}
          </div>
          <div className="label">correct / errors / attempts</div>
        </div>
        <div className="result-stat">
          <div className="label">time</div>
          <div className="value">{stats.elapsed.toFixed(1)}s</div>
        </div>
      </div>
      <div className="result-actions" aria-label="Result actions">
        <button
          type="button"
          className="result-action"
          onClick={onNext}
          aria-label="Next test"
          title="Next test"
        >
          <Icon name="next" size={22} />
        </button>
        <button
          type="button"
          className="result-action"
          onClick={onRepeat}
          aria-label="Repeat test"
          title="Repeat test"
        >
          <Icon name="restart" size={20} />
        </button>
        <button
          type="button"
          className="result-action"
          onClick={onReview}
          aria-label="Review typed code"
          title="Review typed code"
        >
          <Icon name="search" size={20} />
        </button>
        <button
          type="button"
          className="result-action"
          onClick={onSource}
          aria-label="View snippet source"
          title="View snippet source"
        >
          <Icon name="info" size={20} />
        </button>
      </div>
    </section>
  );
}
