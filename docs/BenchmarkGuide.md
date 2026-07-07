# Benchmark Engine Guide

The DevForgeKit Benchmark Engine measures development environment performance using real developer workloads. It runs 12 benchmark categories across 3 profiles, scores each on a 0-100 scale, and provides rich metadata, trend analysis, self-explaining intelligence, and a full TUI dashboard.

## Quick Start

```bash
# Run a quick benchmark (6 categories, ~10-20s)
devforgekit benchmark

# Run a standard benchmark (11 categories, ~30-60s)
devforgekit benchmark standard

# Run a full benchmark (12 categories, ~2-5min)
devforgekit benchmark full

# View benchmark history
devforgekit benchmark history

# Compare latest two results
devforgekit benchmark compare

# View trend analysis
devforgekit benchmark trend overall

# Self-explaining intelligence report
devforgekit benchmark intelligence
```

## Profiles

| Profile | Duration | Categories |
|---------|----------|------------|
| quick | ~10-20s | cpu, memory, disk, git, node, shell |
| standard | ~30-60s | quick + docker, flutter, python, databases, packageManagers |
| full | ~2-5min | standard + projectGeneration |

## Benchmark Categories

| Category | Key | What It Measures |
|----------|-----|------------------|
| CPU | `cpu` | Compression, decompression, JSON parsing, object creation |
| Memory | `memory` | Allocation, large array handling, garbage collection |
| Disk | `disk` | Sequential read/write, random access, small file creation |
| Git | `git` | init, add, commit, status, branch, diff |
| Node.js | `node` | Startup time, module loading |
| Terminal | `shell` | Shell startup, profile sourcing |
| Docker | `docker` | Daemon responsiveness, image inspection, container start |
| Flutter | `flutter` | Doctor, pub get |
| Python | `python` | Startup, venv creation, pip install |
| Databases | `databases` | PostgreSQL, MySQL, Redis connection and query |
| Package Managers | `packageManagers` | brew, npm, pnpm, bun responsiveness |
| Project Generation | `projectGeneration` | DevForgeKit project scaffolding |

## Scoring

Each measurement is scored against an expected time:
`score = min(100, 100 * expected / actual)`

- A result at the expected time scores 100
- Twice as slow scores 50
- Category score = average of measurement scores
- Overall score = average of category scores

### Grades

| Grade | Score Range |
|-------|-------------|
| A+ | 95-100 |
| A | 90-94 |
| B | 80-89 |
| C | 70-79 |
| D | 60-69 |
| F | 0-59 |

## Rich Metadata (v2.1.7)

Every benchmark result now includes:

- **Environment**: Node.js version, shell type, platform, architecture
- **Category Labels**: Human-readable names for each category
- **Affected Packages**: What tools/workflows each category affects
- **Confidence Data**: Per-category confidence scores (when multi-run data available)
- **Quality Score**: Meta-score for the benchmark run itself

### Benchmark Quality Score

The quality score evaluates the benchmark run itself:

| Component | Weight | Description |
|-----------|--------|-------------|
| Coverage | 30% | Percentage of categories that produced scores |
| Confidence | 25% | Average confidence across categories |
| Stability | 25% | Penalty for skipped categories |
| Repeatability | 20% | Based on confidence (higher = more repeatable) |

## CLI Commands

### `devforgekit benchmark [profile]`

Run a benchmark with the specified profile (defaults to `quick`).

```bash
devforgekit benchmark           # quick profile
devforgekit benchmark standard  # standard profile
devforgekit benchmark full      # full profile
devforgekit benchmark --json    # output as JSON
devforgekit benchmark --no-save # don't save result
```

### `devforgekit benchmark compare [old] [new]`

Compare two benchmark results. If IDs are omitted, compares the latest two.

```bash
devforgekit benchmark compare                    # latest two
devforgekit benchmark compare <old-id> <new-id>  # specific
devforgekit benchmark compare --json             # JSON output
```

The comparison shows:
- Overall score delta
- Per-category: old score, new score, delta, status (improved/regressed/unchanged)
- **Significant changes** (≥10% threshold) marked with `*`
- **Likely cause** for significant regressions (machine change, memory drop, OS update, etc.)
- **Recommendations** for significant regressions
- **Measurement-level deltas** (e.g., "compression: 500ms → 800ms (+60%)")

### `devforgekit benchmark history`

List past benchmark results with filtering, searching, and sorting.

```bash
devforgekit benchmark history
devforgekit benchmark history --filter-profile quick
devforgekit benchmark history --filter-grade A
devforgekit benchmark history --min-score 80
devforgekit benchmark history --search "macbook"
devforgekit benchmark history --sort score
devforgekit benchmark history --limit 5
devforgekit benchmark history --json
```

### `devforgekit benchmark trend [category]`

Show trend analysis for a category (or overall) across benchmark history.

```bash
devforgekit benchmark trend              # overall trend
devforgekit benchmark trend cpu          # CPU category trend
devforgekit benchmark trend -n 20        # last 20 data points
devforgekit benchmark trend --json       # JSON output
```

Output includes:
- Direction: improving, declining, or stable
- Change: first → last score with delta
- Average and volatility
- ASCII sparkline visualization
- Per-run history

### `devforgekit benchmark intelligence [id]`

Self-explaining benchmark report — no AI provider needed.

```bash
devforgekit benchmark intelligence              # latest result
devforgekit benchmark intelligence <id>         # specific result
devforgekit benchmark intelligence --category cpu  # single category
```

For each category, shows:
- **Description**: What the benchmark measures
- **Why it matters**: Impact on development workflows
- **Score**: Current score with grade
- **Confidence**: Variance-based confidence (when available)
- **Expected range**: Normal performance range
- **Measurements**: Individual timing results
- **What affects it**: Factors that influence the score
- **Recommendation**: Actionable advice for low scores

### `devforgekit benchmark report [id]`

Rich benchmark report with previous run comparison.

```bash
devforgekit benchmark report              # latest result
devforgekit benchmark report <id>         # specific result
```

Shows per-category: score, grade, previous comparison (if available), measurement details with expected/normal/slow status, and recommendations.

### `devforgekit benchmark explain [id]`

AI-powered explanation of benchmark results (requires AI provider).

```bash
devforgekit benchmark explain
devforgekit benchmark explain <id>
devforgekit benchmark explain --provider openai --model gpt-4
```

### `devforgekit benchmark export <id>`

Export a benchmark result in various formats.

```bash
devforgekit benchmark export <id> --format json
devforgekit benchmark export <id> --format markdown
devforgekit benchmark export <id> --format html
devforgekit benchmark export <id> --format csv
```

### `devforgekit benchmark delete <id>`

Delete a benchmark result.

## TUI Dashboard

The Benchmark TUI page (press `B` in the dashboard) provides a full visual interface:

### Tabs

| Tab | Key | Description |
|-----|-----|-------------|
| Overview | `1` | Summary cards, quality score, recent runs |
| History | `2` | Browseable list of all benchmark results |
| Categories | `3` | Per-category scores with intelligence detail panel |
| Trends | `4` | ASCII sparklines for each category over time |
| Compare | `5` | Side-by-side comparison of latest two results |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `r` | Run benchmark with current profile |
| `p` | Cycle profile (quick → standard → full) |
| `1`-`5` | Switch tabs |
| `Tab` | Toggle between nav and content focus |

## Result Storage

Benchmark results are stored as JSON files in `~/.devforgekit/benchmarks/`.

Each result contains:
- `benchmarkVersion`: Schema version (currently 2)
- `id`: Unique timestamp-based ID
- `createdAt`: ISO timestamp
- `profile`: quick, standard, or full
- `durationMs`: Total benchmark duration
- `devforgekitVersion`: DevForgeKit version at run time
- `machine`: CPU, RAM, OS, architecture, hostname
- `environment`: Node version, shell type, platform, arch
- `categoryResults`: Raw measurement data per category
- `categoryScores`: 0-100 scores per category
- `categoryLabels`: Human-readable category names
- `affectedPackages`: What each category affects
- `confidence`: Per-category confidence data
- `overallScore` / `overallGrade`: Aggregate score and grade
- `slowest` / `fastest`: Weakest and strongest categories
- `skipped`: Categories that were skipped with reasons
- `compatibilityIssues`: Any detected compatibility problems
- `qualityScore`: Benchmark quality meta-score

## Benchmark Engine Audit

See [BenchmarkEngineAudit.md](BenchmarkEngineAudit.md) for the pre-implementation audit documenting architecture, dead code, duplicate logic, weaknesses, real bugs, and improvements applied during v2.1.7.
