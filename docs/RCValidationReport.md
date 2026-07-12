<!-- markdownlint-disable-file MD012 MD014 -->

# DevForgeKit RC Validation Report

**Version:** 3.0.0
**Commit:** `29e4696cd50be4885a4cdee221389ff949a67139` (main)
**Started:** 2026-07-12T10:46:55Z
**Finished:** 2026-07-12T10:55:57Z

## Final recommendation: FAIL

At least one required check failed - see the ❌ items below. Fix them and re-run `./scripts/rc-validate.sh` before tagging.

## 1. GitHub Release verification

- ⚪ **GitHub Release verification** - skipped (--skip-github-release passed)


## 2. npm verification

- ⚪ **npm verification** - skipped (--skip-npm passed)


## 3. Homebrew verification

- ⚪ **Homebrew verification** - skipped (--skip-homebrew passed)


## 4. Installation verification

- ✅ **bootstrap.sh --dry-run --yes (fresh install path, no side effects)**
  <details><summary>output</summary>

  ```
  === Verification ===
  ℹ Skipping post-install verification in --dry-run mode
  
  === Summary ===
    ✔ Homebrew present
    ⚠ Brewfile is valid (brew bundle check) (exit 1)
    ✔ mise.toml present
    ✔ vscode/settings.json present
    ✔ cursor/settings.json present
    ✔ cli/package.json present
    ✔ Generate system report
  
  6 passed, 1 warnings, 0 failed
  
  =========================================
  ✔ Homebrew
  ✔ Git
  ✔ GitHub CLI
  ✔ SSH
  ✔ Node
  ✔ pnpm
  ✔ Java
  ✔ Python
  ✔ Flutter
  ✔ Android SDK
  ✔ Docker
  ✔ PostgreSQL
  ✔ MySQL
  ✔ Redis
  ✔ Supabase CLI
  ✔ VS Code
  ✔ Cursor
  ✔ DevForgeKit
  =========================================
  
  ██████████████████████░░  92%
  Health Score: 92%
  Machine Ready
  ✔ DevForgeKit installation completed successfully.
  Execution time: 0m 31s

  ```
  </details>

- ✅ **devforgekit env doctor (environment verification)**
  <details><summary>output</summary>

  ```
  {
    "state": {
      "packages": {},
      "files": {},
      "generatedAt": null,
      "version": 2
    },
    "model": {
      "path": [],
      "pathOwners": {},
      "variables": {},
      "shell": [],
      "sourcePackages": [],
      "missingPackages": [],
      "collisions": []
    },
    "results": [
      {
        "status": "FAIL",
        "message": "Generated shell file for zsh does not exist - run 'devforgekit env regenerate'"
      },
      {
        "status": "WARNING",
        "message": "Shell hook is not installed for zsh - run 'devforgekit env regenerate'"
      }
    ],
    "shell": "zsh",
    "score": {
      "pass": 0,
      "warn": 1,
      "fail": 1,
      "total": 2,
      "score": 25,
      "verdict": "Machine Needs Attention"
    },
    "packageHealth": []
  }

  ```
  </details>

- ✅ **devforgekit env regenerate (PATH + environment file generation, scratch $HOME)**
  <details><summary>output</summary>

  ```
  i No packages have registered environment configuration yet - nothing to generate.

  ```
  </details>

- ✅ **devforgekit (global command, non-TTY dashboard fallback)**

- ✅ **devforgekit check (health score)**
  <details><summary>output</summary>

  ```
  ✓ Component check: supabase
  ✓ Component check: swift
  ! Component check: swiftformat
  ! Component check: swiftlint
  ! Component check: tauri-cli
  ✓ Component check: tcpdump
  ✓ Component check: terraform
  ! Component check: tlrc
  ! Component check: tmux
  ✓ Component check: tree
  ! Component check: typedoc
  ! Component check: unity-hub
  ! Component check: uv
  ! Component check: vagrant
  ! Component check: vault
  ✓ Component check: vercel
  ! Component check: victor-mono
  ! Component check: vlc
  ! Component check: volta
  ✓ Component check: vscode
  ! Component check: warp
  ! Component check: watchexec
  ✓ Component check: watchman
  ! Component check: wezterm
  ✓ Component check: wget
  ! Component check: whisper-cpp
  ! Component check: whois
  ! Component check: windsurf
  ! Component check: wireshark
  ! Component check: xcbeautify
  ✓ Component check: xcode
  ! Component check: xcodegen
  ✓ Component check: yarn
  ✓ Component check: yq
  ! Component check: yt-dlp
  ! Component check: zed
  ! Component check: zen-browser
  ! Component check: zig
  ! Component check: zoxide
  i Component health score: 63% - Machine Needs Attention

  ```
  </details>

- ✅ **devforgekit env snapshot** (id: 2026-07-12T10-47-34-826Z)

- ✅ **devforgekit env restore 2026-07-12T10-47-34-826Z**
  <details><summary>output</summary>

  ```
  i Current state saved as safety snapshot 2026-07-12T10-47-34-989Z
  i No packages have registered environment configuration yet - nothing to generate.

  ```
  </details>

- ✅ **devforgekit repair scan (read-only)**
  <details><summary>output</summary>

  ```
      },
      "dependencies": []
    },
    {
      "id": "ssh-no-keys",
      "title": "SSH: no keys found",
      "severity": "INFO",
      "category": "ssh",
      "categoryLabel": "SSH",
      "subsystem": "ssh",
      "confidence": "high",
      "description": "No SSH directory found",
      "impact": "Git over SSH and remote access will not work",
      "fix": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
      "action": {
        "type": "manual",
        "suggestion": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'"
      },
      "risk": "low",
      "riskLabel": "Low",
      "estimatedTime": "2 min",
      "requiresRestart": false,
      "rollbackAvailable": true,
      "supportsDryRun": true,
      "platforms": [
        "macos"
      ],
      "versionIntroduced": "2.1.6",
      "explanation": {
        "problem": "No SSH directory found",
        "impact": "Git over SSH and remote access will not work",
        "fix": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
        "risk": "Low",
        "estimatedTime": "2 min",
        "rollbackAvailable": true,
        "requiresRestart": false
      },
      "dependencies": []
    }
  ]

  ```
  </details>


## 5. Smoke tests

- ✅ **devforgekit (no args)**

- ✅ **devforgekit doctor**
  <details><summary>output</summary>

  ```
        "status": "WARNING",
        "description": "Component check: xcodegen"
      },
      {
        "status": "PASS",
        "description": "Component check: yarn"
      },
      {
        "status": "PASS",
        "description": "Component check: yq"
      },
      {
        "status": "WARNING",
        "description": "Component check: yt-dlp"
      },
      {
        "status": "WARNING",
        "description": "Component check: zed"
      },
      {
        "status": "WARNING",
        "description": "Component check: zen-browser"
      },
      {
        "status": "WARNING",
        "description": "Component check: zig"
      },
      {
        "status": "WARNING",
        "description": "Component check: zoxide"
      }
    ],
    "pass": 72,
    "warn": 189,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **devforgekit check**
  <details><summary>output</summary>

  ```
  ✓ Component check: supabase
  ✓ Component check: swift
  ! Component check: swiftformat
  ! Component check: swiftlint
  ! Component check: tauri-cli
  ✓ Component check: tcpdump
  ✓ Component check: terraform
  ! Component check: tlrc
  ! Component check: tmux
  ✓ Component check: tree
  ! Component check: typedoc
  ! Component check: unity-hub
  ! Component check: uv
  ! Component check: vagrant
  ! Component check: vault
  ✓ Component check: vercel
  ! Component check: victor-mono
  ! Component check: vlc
  ! Component check: volta
  ✓ Component check: vscode
  ! Component check: warp
  ! Component check: watchexec
  ✓ Component check: watchman
  ! Component check: wezterm
  ✓ Component check: wget
  ! Component check: whisper-cpp
  ! Component check: whois
  ! Component check: windsurf
  ! Component check: wireshark
  ! Component check: xcbeautify
  ✓ Component check: xcode
  ! Component check: xcodegen
  ✓ Component check: yarn
  ✓ Component check: yq
  ! Component check: yt-dlp
  ! Component check: zed
  ! Component check: zen-browser
  ! Component check: zig
  ! Component check: zoxide
  i Component health score: 63% - Machine Needs Attention

  ```
  </details>

- ✅ **devforgekit component list**
  <details><summary>output</summary>

  ```
    golangci-lint - A fast Go linters aggregator
    prettier - An opinionated code formatter
    shellcheck - A static analysis tool for shell scripts
  
  Media
    exiftool - Reads, writes, and edits file metadata (EXIF, IPTC, XMP)
    ffmpeg - A complete cross-platform solution to record, convert, and stream audio/video
    imagemagick - A software suite to create, edit, and compose bitmap images
    sox - A cross-platform command-line audio processing tool
    vlc - A free and open-source cross-platform multimedia player
    yt-dlp - A feature-rich command-line audio/video downloader
  
  Design
    figma - A collaborative interface design tool
    rive - A real-time interactive design and animation tool
  
  Android
    genymotion - An Android emulator for app development and testing
    scrcpy - Display and control an Android device from macOS
  
  API Development
    grpcurl - A command-line tool for interacting with gRPC servers
    httpie - A user-friendly command-line HTTP client
    insomnia - A collaborative API client for REST, GraphQL, and gRPC
    openapi-generator-cli - Generates API clients/servers/docs from an OpenAPI spec
  
  Kubernetes
    helm - The package manager for Kubernetes
    k9s - A terminal UI to interact with your Kubernetes clusters
    kubectl - The Kubernetes command-line tool
    kubectx - Fast context switching between Kubernetes clusters
    kubens - Fast namespace switching for Kubernetes (installed alongside kubectx)
    kustomize - Customize raw, template-free Kubernetes YAML manifests
    skaffold - Continuous development for Kubernetes applications
  
  Documentation
    hugo - A fast static site generator
    mkdocs - A fast, simple static site generator for project documentation
    sphinx - A documentation generator, the standard for Python projects
    typedoc - A documentation generator for TypeScript projects

  ```
  </details>

- ✅ **devforgekit env doctor**
  <details><summary>output</summary>

  ```
  {
    "state": {
      "packages": {},
      "files": {},
      "generatedAt": null,
      "version": 2
    },
    "model": {
      "path": [],
      "pathOwners": {},
      "variables": {},
      "shell": [],
      "sourcePackages": [],
      "missingPackages": [],
      "collisions": []
    },
    "results": [
      {
        "status": "FAIL",
        "message": "Generated shell file for zsh does not exist - run 'devforgekit env regenerate'"
      },
      {
        "status": "WARNING",
        "message": "Shell hook is not installed for zsh - run 'devforgekit env regenerate'"
      }
    ],
    "shell": "zsh",
    "score": {
      "pass": 0,
      "warn": 1,
      "fail": 1,
      "total": 2,
      "score": 25,
      "verdict": "Machine Needs Attention"
    },
    "packageHealth": []
  }

  ```
  </details>

- ✅ **devforgekit registry audit**
  <details><summary>output</summary>

  ```
                          COUNT
  ──────────────────────  ─────
  Missing install method  0    
  Missing validate        0    
  Missing uninstall       0    
  Missing upgrade method  0    
  Missing repair method   0    
  Missing version         0    
  Missing binary          0    
  Missing dependencies    0    
  Missing conflicts       0    
  Missing environment     31   
  Unsupported packages    1    
  
  linux gaps (193): act, age, aider, aircrack-ng, alacritty, android-studio, arangodb, arc, arduino-cli, atuin, ... and 183 more
  
  windows gaps (206): act, age, aider, aircrack-ng, alacritty, android-studio, arangodb, arc, arduino-cli, asdf, ... and 196 more
  Registry Audit
  ──────────────────────────────────────────────────────────────────────────────
  █████████████████████░░░  89%
  
  Packages:                261
  Verified (CI):           5 (2%)
  Untested:                256 (98%)
  Deprecated:              0
  Broken Metadata:         1
  ──────────────────────────────────────────────────────────────────────────────
  
  Coverage
                 COVERAGE
  ─────────────  ────────
  Compatibility  75%     
  Documentation  100%    
  Validation     100%    
  Aliases        100%    
  Architecture   100%    
  Recommendations
  ──────────────────────────────────────────────────────────────────────────────
  - Only 5 package(s) are CI-verified - consider adding more to .github/workflows/registry-smoke.yml's live-tested allowlist.
  ──────────────────────────────────────────────────────────────────────────────

  ```
  </details>

- ⚪ **devforgekit new nextjs demo-smoke** - skipped (--skip-scaffold passed)

- ✅ **devforgekit repair scan**
  <details><summary>output</summary>

  ```
    {
      "id": "cache-homebrew-cache",
      "title": "Cache: Homebrew cache oversized",
      "severity": "INFO",
      "category": "cache",
      "categoryLabel": "Cache",
      "subsystem": "filesystem",
      "confidence": "high",
      "description": "Homebrew cache is 5.1 GB (>5 GB threshold)",
      "impact": "Excessive disk usage from cached files",
      "fix": "Clear cache: rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
      "action": {
        "type": "shell",
        "command": "rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
        "filesAffected": [
          "/Users/nouradin/Library/Caches/Homebrew"
        ]
      },
      "risk": "low",
      "riskLabel": "Low",
      "estimatedTime": "1 min",
      "requiresRestart": false,
      "rollbackAvailable": true,
      "supportsDryRun": true,
      "platforms": [
        "macos"
      ],
      "versionIntroduced": "2.1.6",
      "explanation": {
        "problem": "Homebrew cache is 5.1 GB (>5 GB threshold)",
        "impact": "Excessive disk usage from cached files",
        "fix": "Clear cache: rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
        "risk": "Low",
        "estimatedTime": "1 min",
        "rollbackAvailable": true,
        "requiresRestart": false
      },
      "dependencies": []
    }
  ]

  ```
  </details>


## 6. Package integrity

- ❌ **devforgekit doctor --release-check (version consistency, docs, artifacts, registry, git tree, CI status)** (exit 1)
  <details><summary>output</summary>

  ```
  
  === Release readiness check ===
  i ✓ Version consistency: All sources agree on 3.0.0 (VERSION=3.0.0, package.json=3.0.0, cli/package.json=3.0.0, Formula/devforgekit.rb=3.0.0)
  i - Release tag: HEAD is not currently on a tag - not a release commit yet
  i ✓ Required documentation: All present: LICENSE, README.md, CHANGELOG.md, RELEASE.md, SECURITY.md
  i ✓ Distribution artifacts: All present: package.json, Formula/devforgekit.rb, scripts/npm-postinstall.sh, completions/devforgekit.bash, completions/devforgekit.zsh, completions/devforgekit.fish
  i ✓ Registry: lint clean, format clean, quality score 89%, 202 orphan/warning notice(s) (non-blocking)
  i ✓ Outstanding pending-work markers: None found in cli/src
  i ✓ No experimental/debug flags enabled: No internal debug env vars set. Note: the ai command family is intentionally Experimental (see docs/ApiFreeze.md) - not a blocker.
  ✗ ✗ Git working tree: 13 uncommitted change(s): M .github/workflows/release.yml,  M CHANGELOG.md,  M CONTRIBUTING.md, ...
  i ✓ CI status: 9 run(s) checked, none failed
  i Release check: FAIL - resolve the failing check(s) above before releasing.

  ```
  </details>


## 7. Regression suite

- ✅ **scripts/validate.sh (ShellCheck, bash -n, Brewfile, mise.toml, JSON, YAML, Markdown)**
  <details><summary>output</summary>

  ```
    ✔ Markdown non-empty: docs/CompatibilityReport.md
    ✔ Markdown non-empty: docs/CompatibilityRules.md
    ✔ Markdown non-empty: docs/Security.md
    ✔ Markdown non-empty: docs/InstallationAudit.md
    ✔ Markdown non-empty: docs/CommandSafety.md
    ✔ Markdown non-empty: cli/README.md
    ✔ Markdown non-empty: README.md
    ✔ Markdown non-empty: RELEASE.md
    ✔ Markdown non-empty: CONTRIBUTING.md
    ✔ Markdown non-empty: .github/PULL_REQUEST_TEMPLATE.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/feature_request.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/docs_issue.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/bug_report.md
    ✔ Markdown non-empty: registry/research-queue.md
    ✔ Markdown non-empty: templates/terraform/README.md
    ✔ Markdown non-empty: templates/nodejs/README.md
    ✔ Markdown non-empty: templates/docker/README.md
    ✔ Markdown non-empty: templates/react-native/README.md
    ✔ Markdown non-empty: templates/python/README.md
    ✔ Markdown non-empty: templates/express/README.md
    ✔ Markdown non-empty: templates/supabase/README.md
    ✔ Markdown non-empty: templates/flutter/README.md
    ✔ Markdown non-empty: templates/firebase/README.md
    ✔ Markdown non-empty: templates/fastapi/README.md
    ✔ Markdown non-empty: templates/nextjs/README.md
    ✔ Markdown non-empty: templates/nestjs/README.md
    ✔ Markdown non-empty: templates/docker-compose/README.md
    ✔ Markdown non-empty: templates/react/README.md
    ✔ Markdown non-empty: profiles/full/README.md
    ✔ Markdown non-empty: profiles/recommended/README.md
    ✔ Markdown non-empty: profiles/backend/README.md
    ✔ Markdown non-empty: profiles/minimal/README.md
    ✔ Markdown non-empty: profiles/flutter/README.md
    ✔ Markdown non-empty: profiles/custom/README.md
    ✔ Markdown non-empty: CLAUDE.md
    ✔ Markdown non-empty: SECURITY.md
    ✔ Node CLI lint
    ✔ Node CLI tests
  
  764 passed, 1 warnings, 0 failed

  ```
  </details>

- ✅ **npm test --prefix cli (full unit + integration suite)**
  <details><summary>output</summary>

  ```
  ✔ createSnapshot records the document verbatim plus metadata, and listSnapshots sorts newest-first (21.131667ms)
  ✔ listSnapshots returns [] for a workspace with no snapshots yet (1.052292ms)
  ✔ getSnapshotDoc/restoreSnapshot/deleteSnapshot throw a clear error for an unknown id (1.140791ms)
  ✔ restoreSnapshot reverts fields but always keeps the workspace's real name/createdAt (1.710291ms)
  ✔ deleteSnapshot removes exactly that snapshot (5.192166ms)
  ✔ exportSnapshot writes the recorded document to an arbitrary file path (2.613292ms)
  ✔ compareSnapshots/compareWithCurrent report added/removed/changed top-level keys (2.459959ms)
  ✔ PROVIDER_DEFAULT_HOSTS exposes the three well-known providers (1.564959ms)
  ✔ applyWorkspaceSsh writes a Host block per identity, mode 0600, preserving pre-existing config content (3.806834ms)
  ✔ re-applying the same workspace is idempotent (no duplicate Host blocks) (0.717583ms)
  ✔ a workspace with no identities removes its own block instead of leaving a stale one (0.651584ms)
  ✔ two workspaces' SSH blocks coexist independently (1.87275ms)
  ✔ ensureKnownHost recognizes an already-known host without shelling out to ssh-keyscan (no network) (16.690875ms)
  ✔ removeWorkspaceSsh returns false when the workspace never had a block (0.807958ms)
  ✔ createWorkspace persists a workspace.json under ~/.config/devforgekit/workspaces/<name>/ (74.03975ms)
  ✔ createWorkspace rejects a duplicate name and an invalid name (1.199542ms)
  ✔ getWorkspace throws a clear error for an unknown workspace (0.397166ms)
  ✔ saveWorkspace re-validates, persists changes, and stamps a fresh modifiedAt (9.962541ms)
  ✔ saveWorkspace refuses to save a workspace that was never created (3.198209ms)
  ✔ listWorkspaces returns every workspace sorted by name, invalid ones included (9.151417ms)
  ✔ active-workspace pointer: get/set round-trip, and getActiveWorkspace resolves the full document (1.325417ms)
  ✔ setActiveWorkspaceName rejects an unknown workspace and accepts null to clear (1.095334ms)
  ✔ deleteWorkspace refuses to delete the active workspace unless forced (1.286416ms)
  ✔ renameWorkspace moves the directory, updates the document, and follows the active pointer (1.348667ms)
  ✔ cloneWorkspace copies configuration but never secrets or snapshot history (2.772833ms)
  ✔ searchWorkspaces matches name, tag, git email, and cloud reference (invalid workspaces excluded) (2.067666ms)
  ✔ switchToWorkspace applies git identity live, writes the shell-export file, and moves the active pointer (183.322125ms)
  ✔ switching workspaces re-applies git identity to match the newly-active one (336.152ms)
  ✔ switchToWorkspace throws for an unknown workspace without moving the active pointer (98.792667ms)
  ✔ deactivateWorkspace clears the pointer and resets the shell-export file (160.64875ms)
  ✔ rollbackToSnapshot on the active workspace restores the document AND re-applies live state, with an automatic safety snapshot first (439.0625ms)
  ✔ rollbackToSnapshot on an inactive workspace only reverts the stored document, leaving live state untouched (120.336875ms)
  ℹ tests 1300
  ℹ suites 8
  ℹ pass 1300
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 225075.246333

  ```
  </details>


## 8. Release checklist and version consistency

See section 6 (`devforgekit doctor --release-check`) above - it is the single, authoritative source for: version consistency across VERSION/package.json/cli/package.json/Formula, required documentation present, distribution artifacts present, registry audit/lint/format clean, no outstanding pending-work markers, no experimental/debug flags enabled, a clean git working tree, and the current commit's own CI run conclusions.

