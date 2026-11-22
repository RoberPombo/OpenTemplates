type ReactCommit = {
  id: string;
  phase: string;
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

type LongTask = {
  startTime: number;
  duration: number;
};

export type PerformanceReport = {
  schemaVersion: 1;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  environment: {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number | null;
  };
  summary: {
    frameCount: number;
    meanFrameMs: number | null;
    p95FrameMs: number | null;
    framesOver16_7ms: number;
    framesOver33_3ms: number;
    longTaskApiSupported: boolean;
    longTaskCount: number;
    longTaskDurationMs: number;
    reactCommitCount: number;
    reactActualDurationMs: number;
  };
  frameIntervalsMs: number[];
  longTasks: LongTask[];
  reactCommits: ReactCommit[];
};

let active = false;
let animationFrame = 0;
let lastFrameTime: number | null = null;
let startedAt = "";
let startedTime = 0;
let frameIntervalsMs: number[] = [];
let longTasks: LongTask[] = [];
let reactCommits: ReactCommit[] = [];
let observer: PerformanceObserver | null = null;
let reactCommitListener: ((event: Event) => void) | null = null;
let longTaskApiSupported = false;

function sampleFrame(time: number) {
  if (!active) return;

  if (document.visibilityState === "visible") {
    if (lastFrameTime !== null) frameIntervalsMs.push(time - lastFrameTime);
    lastFrameTime = time;
  } else {
    lastFrameTime = null;
  }

  animationFrame = requestAnimationFrame(sampleFrame);
}

export function startCapture() {
  if (active) return;

  active = true;
  startedAt = new Date().toISOString();
  startedTime = performance.now();
  lastFrameTime = null;
  frameIntervalsMs = [];
  longTasks = [];
  reactCommits = [];
  reactCommitListener = (event) => {
    reactCommits.push((event as CustomEvent<ReactCommit>).detail);
  };
  document.documentElement.dataset.perfCapture = "on";
  window.addEventListener("opentemplates:perf-react-commit", reactCommitListener);

  longTaskApiSupported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
  if (longTaskApiSupported) {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      observer = null;
      longTaskApiSupported = false;
    }
  }

  animationFrame = requestAnimationFrame(sampleFrame);
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function stopCapture(): PerformanceReport | null {
  if (!active) return null;

  active = false;
  cancelAnimationFrame(animationFrame);
  observer?.disconnect();
  observer = null;
  delete document.documentElement.dataset.perfCapture;
  if (reactCommitListener) {
    window.removeEventListener("opentemplates:perf-react-commit", reactCommitListener);
    reactCommitListener = null;
  }

  const endedTime = performance.now();
  const totalReactDuration = reactCommits.reduce(
    (total, commit) => total + commit.actualDuration,
    0,
  );
  const report: PerformanceReport = {
    schemaVersion: 1,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: endedTime - startedTime,
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
    },
    summary: {
      frameCount: frameIntervalsMs.length,
      meanFrameMs:
        frameIntervalsMs.length > 0
          ? frameIntervalsMs.reduce((total, frame) => total + frame, 0) / frameIntervalsMs.length
          : null,
      p95FrameMs: percentile(frameIntervalsMs, 0.95),
      framesOver16_7ms: frameIntervalsMs.filter((frame) => frame > 16.7).length,
      framesOver33_3ms: frameIntervalsMs.filter((frame) => frame > 33.3).length,
      longTaskApiSupported,
      longTaskCount: longTasks.length,
      longTaskDurationMs: longTasks.reduce((total, task) => total + task.duration, 0),
      reactCommitCount: reactCommits.length,
      reactActualDurationMs: totalReactDuration,
    },
    frameIntervalsMs,
    longTasks,
    reactCommits,
  };

  return report;
}
