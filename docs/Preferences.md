# macOS preferences backup

```bash
./scripts/preferences.sh backup    # live settings -> preferences/*.plist
./scripts/preferences.sh restore   # preferences/*.plist -> live settings
./scripts/preferences.sh status    # compare live settings against backups
```

## What's covered, and why there are only 8 files for 15 named categories

macOS stores UI preferences in `defaults` "domains", and several of the
categories users think of as distinct actually share one domain. This
script backs up by domain, not by UI category:

| Backup file | `defaults` domain | Covers |
| --- | --- | --- |
| `global.plist` | `NSGlobalDomain` | Keyboard, Mouse, Appearance/Dark Mode |
| `dock.plist` | `com.apple.dock` | Dock, Mission Control, Hot Corners, Stage Manager |
| `finder.plist` | `com.apple.finder` | Finder, Desktop |
| `screenshots.plist` | `com.apple.screencapture` | Screenshot location/format |
| `terminal.plist` | `com.apple.Terminal` | Terminal profiles/settings |
| `controlcenter.plist` | `com.apple.controlcenter` | Menu Bar, Control Center |
| `trackpad.plist` | `com.apple.AppleMultitouchTrackpad` | Trackpad (optional - best effort) |
| `safari.plist` | `com.apple.Safari` | Safari preferences (optional - best effort) |

`trackpad.plist` and `safari.plist` are marked optional
(`preference_domain_pairs()` in `scripts/common.sh`): on machines without
that hardware, or without Full Disk Access for Safari's sandboxed domain,
these produce a WARNING rather than aborting the run.

## How backup/restore work

- **backup**: `defaults export <domain>` to a temp file, then copied into
  `preferences/<file>.plist` via the same idempotent `fs_safe_copy` used
  everywhere else in this repo (skips if identical; backs up the previous
  version as `<file>.plist.backup-<timestamp>` if it differs). If a backup
  already exists and differs from the live settings, you're asked to
  confirm before overwriting - `defaults export` never fails on its own,
  so this confirmation is the actual safety net here.
- **restore**: `defaults import <domain> <file>` for each domain, then
  `killall Dock Finder SystemUIServer cfprefsd` to make most changes take
  effect immediately. A few settings (Appearance, Stage Manager) only
  fully apply after logging out or restarting.
- **status**: re-exports each live domain to a temp file and `cmp`s it
  against the stored backup, reporting PASS (in sync) or WARNING (drifted,
  or no backup yet).

## Where backups are stored

`preferences/*.plist` at the repo root. These are **gitignored by
default** (`.gitignore`'s `preferences/*.plist` line) since preference
plists can reveal machine-identifying details you may not want in a public
repo. Remove that line if you want to version them.
