# Benchmark Engine Audit

A pre-implementation audit of the DevForgeKit Benchmark Engine, documenting
architecture, dead code, duplicate logic, weaknesses, real bugs, and
improvements applied during the v2.1.7 "Benchmark Engine Excellence" project.

## Architecture Overview

The Benchmark Engine lives in `cli/src/core/benchmark.js` (1053 lines) and
measures development environment performance using real developer workloads.

### Pipeline

```
runBenchmark({ profile }) → gatherMachineInfo() → run category benchmarks → score → save
```

### Profiles

| Profile | Duration | Categories |
|---------|----------|------------|
| quick | ~10-20s | cpu, memory, disk, git, node, shell |
| standard | ~30-60s | quick + docker, flutter, python, databases, packageManagers |
| full | ~2-5min | standard + projectGeneration |

### Scoring

Each measurement is scored against an expected time:
`score = min(100, 100 * expected / actual)`. Category score = average of
measurement scores. Overall = average of category scores.

Grades: A+ (95+), A (90+), B (80+), C (70+), D (60+), F (<60).

### Subsystems

| Component | File | Role |
|-----------|------|------|
| Core engine | `core/benchmark.js` | 12 benchmark functions, scoring, save, compare, export |
| CLI | `commands/benchmark.js` | Commander.js subcommands (quick, standard, full, compare, history, export, delete, explain) |
| Tests | `test/benchmark.test.js` | 20 tests covering constants, scoring, save/list/get/delete, compare, export, integration |
| TUI | (none) | No benchmark TUI page exists |

## Findings

### Dead Code

1. **`signal` parameter in `runBenchmark`** — The function signature accepts
   `signal` and checks `signal?.aborted`, but no caller ever passes a signal.
   The CLI commands don't support cancellation.

2. **`benchmarkSummary` function** — Exported and tested but never imported
   by any other module in the codebase. It was designed for snapshot
   integration but snapshots don't use it.

3. **`spawnSync` import** (line 22) — Imported but never used. All shell
   commands go through `runShellCommand`/`captureShellCommand`.

### Duplicate Logic

1. **Package validation loop** — `runBenchmark` lines 684-694 iterates
   `loadPackages()`, calls `validate()`, and collects installed names. This
   is the same pattern that `repair.js` already centralized into
   `getInstalledPackageNames()`. The benchmark engine should reuse that
   helper.

2. **`tempDir` + `rmSync` cleanup pattern** — Every benchmark function
   (CPU, disk, git, flutter, python, projectGeneration) manually creates
   a temp dir and wraps in try/finally with `rmSync(dir, { recursive: true,
   force: true })`. This should be a `withTempDir(fn)` helper.

3. **`timeShell` wraps `timeOperation` wraps `runShellCommand`** — Three
   layers of indirection for what is ultimately "time a shell command".
   Not harmful but unnecessarily deep.

### Architecture Weaknesses

1. **Single-run measurements** — Each benchmark runs exactly once. No
   variance, confidence, or repeatability data. A single outlier (background
   process, disk cache miss) can skew results significantly.

2. **Sequential execution** — All categories run sequentially. CPU, memory,
   and disk benchmarks are independent and could run in parallel for a
   2-3x speedup.

3. **No benchmark metadata** — Results lack: confidence, variance, affected
   packages, benchmark category labels, environment details (Node version,
   shell type). Only machine info (hostname, OS, CPU, RAM) is captured.

4. **No trend analysis** — `listHistory` returns flat records. No way to
   see how a category has changed over time without manual comparison.

5. **Basic comparison** — `compareResults` shows score deltas but doesn't:
   - Identify significant vs. noise changes
   - Suggest likely causes for regressions
   - Show measurement-level differences (only category scores)
   - Provide recommendations

6. **No TUI page** — The benchmark engine has no TUI representation.
   Users must use the CLI for everything.

7. **No quality score** — Unlike the Repair Engine (which has a quality
   score), benchmarks have no meta-score for coverage, confidence,
   stability, or repeatability.

8. **No benchmark intelligence** — Results are just numbers. No
   self-explaining context (why this metric matters, what affects it,
   what to do about a slow result).

9. **`BENCHMARK_VERSION` is 1** — Should be bumped to 2 with the new
   metadata fields.

### Real Bugs

1. **Compression benchmark measures cleanup in timing** — `benchmarkCPU`
   line 137-147: the `timeOperation` wraps the entire block including
   `gzip -f`, but the `rmSync` in `finally` runs after `timeOperation`
   returns. However, the gzip command itself includes file creation time
   inside the timed block (the `writeFileSync` at line 142 is inside the
   `timeOperation` callback). This means "compression" actually measures
   file creation + compression, not just compression.

2. **Decompression benchmark creates + compresses + decompresses** — Line
   150-160: The timed block includes writing the file, gzipping it, then
   gunzipping. The result includes write + compress time, not just
   decompression time.

3. **Docker `containerStart` pulls image if not present** — Line 349:
   The `imageInspect` command includes a fallback `docker pull` which can
   take 30+ seconds on first run, inflating the "image inspect" time.

4. **`scoreCategory` uses wrong expected times for sub-keys** — Line 96:
   `EXPECTED_TIMES[name]` looks up by measurement name (e.g.
   "compression"), but if a benchmark returns unexpected measurement names,
   it falls back to `actualMs` which always scores 100.

5. **`compareResults` doesn't compare measurements** — Only category
   scores are compared, not individual measurements. A user can't see that
   "git commit went from 500ms to 800ms" — only that "Git score went from
   85 to 72".

### Things to Improve

1. **Multi-run measurements** — Run each benchmark N times (default 3),
   report median + variance + confidence.

2. **Parallel categories** — Run independent categories concurrently with
   `Promise.allSettled`.

3. **Rich metadata** — Add: Node version, shell type, benchmark version,
   affected packages, category labels, confidence, variance, repeat count.

4. **Trend analysis** — `getTrend(category, { limit })` returning a
   sparkline-friendly array of scores over time.

5. **Benchmark intelligence** — `explainBenchmark(category, result)`
   producing structured Why/Matters/Expected/Affects/Action text.

6. **Benchmark quality score** — `computeBenchmarkQuality(result)` scoring
   coverage (categories run vs. skipped), confidence (variance),
   stability (vs. history), repeatability (run count).

7. **Better reports** — Show previous result, delta, status, and
   recommendation per measurement, not just raw numbers.

8. **TUI page** — Full benchmark TUI with Overview, History, Categories,
   Trends, Comparison, Statistics tabs.

9. **`withTempDir` helper** — Eliminate the repeated try/finally pattern.

10. **History filtering/searching** — `listHistory({ filter, search, limit,
    sortBy })` matching the Repair Engine's enhanced history.

## Summary

The Benchmark Engine v2.1.7 is functionally complete for running benchmarks
and saving results. The remaining work centers on:
- **Phase 1** (this document) — architecture audit ✅
- **Phase 2** — rich metadata (confidence, variance, affected packages)
- **Phase 3** — better reports (previous, delta, status, recommendation)
- **Phase 4** — improved comparison (significant changes, likely cause)
- **Phase 5** — trend analysis (sparkline across history)
- **Phase 6** — benchmark intelligence (self-explaining benchmarks)
- **Phase 7** — benchmark TUI page
- **Phase 8** — benchmark quality score
- **Phase 9** — performance optimization (parallel, cache, startup)

The engine's core measurement logic is sound: real workloads, proper
cleanup, scoring against expected times. The gap is in metadata richness,
analysis depth, and user experience — it prints numbers but doesn't answer
"why is my machine slower than last week?"
