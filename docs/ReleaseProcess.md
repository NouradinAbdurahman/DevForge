# Release process

## Cutting a release

```bash
./scripts/release.sh patch   # 1.0.0 -> 1.0.1
./scripts/release.sh minor   # 1.0.0 -> 1.1.0
./scripts/release.sh major   # 1.0.0 -> 2.0.0
```

### What it does, in order

1. **Preflight** (aborts the whole release if any of these fail):
   - Working tree must be clean (`git status --porcelain` empty).
   - Warns (with a confirmation prompt to override) if not on `main`.
   - Runs `scripts/validate.sh` - shell syntax, ShellCheck, Brewfile,
     mise.toml, JSON, YAML, Markdown.
   - Runs `bootstrap.sh --dry-run --yes`.
   - If `gh` is installed and authenticated, checks that no GitHub Actions
     run for the current commit has `conclusion == "failure"`.
2. **Version bump** - reads `VERSION`, bumps it per semver rules for
   `patch`/`minor`/`major`.
3. **Changelog draft** - collects `git log <last-tag>..HEAD --no-merges
   --pretty=format:'- %s'`, shows you the draft, and asks for confirmation
   before inserting it into `CHANGELOG.md` (right before the previous
   newest entry).
4. **Commit + tag** - writes the new `VERSION`, commits both files as
   `chore(release): vX.Y.Z`, and creates an annotated tag `vX.Y.Z`.
5. **Push** (on confirmation) - `git push origin <branch>` then
   `git push origin vX.Y.Z`.

### What happens after the tag is pushed

Pushing the `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which:

- Double-checks `VERSION` matches the tag.
- Re-runs `scripts/validate.sh`.
- Extracts the same CHANGELOG section by version heading.
- Generates a fresh health report (`scripts/report.sh`).
- Publishes the GitHub Release with `Brewfile`, `README.md`,
  `CHANGELOG.md`, `VERSION`, and `health-report.txt` attached.

`scripts/release.sh` intentionally does **not** call `gh release create`
itself - that would duplicate the CI workflow's job. If you ever need to
publish a release without CI (e.g. GitHub Actions is down), run the steps
in `release.yml` manually with `gh release create`.

## Manual/alternate path

If you'd rather not use `scripts/release.sh` (e.g. you want to hand-edit
the changelog section more carefully first):

```bash
# 1. Edit VERSION and CHANGELOG.md by hand
git add VERSION CHANGELOG.md
git commit -m "chore(release): v1.0.1"
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

## Versioning

This repo follows [Semantic Versioning](https://semver.org/):

- **patch** - bug fixes, doc corrections, workflow tweaks, no interface changes.
- **minor** - new scripts/templates/workflows, backward compatible.
- **major** - breaking changes to script CLIs, removed functionality, or a
  restructuring of the repo layout.
