<!-- markdownlint-disable-file MD012 MD014 -->

# DevForgeKit RC Validation Report

**Version:** 3.0.1-rc1
**Commit:** `686199306f6b158ce1afe145fe082c07b05f0d1c` (main)
**Started:** 2026-07-12T19:12:28Z
**Finished:** 2026-07-12T19:25:49Z

## Final recommendation: FAIL

At least one required check failed - see the ❌ items below. Fix them and re-run `./scripts/rc-validate.sh` before tagging.

## 1. GitHub Release verification

- ✅ **GitHub Release v3.0.1-rc1 exists**
  <details><summary>output</summary>

  ```
  {"assets":[{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480167","contentType":"application/octet-stream","createdAt":"2026-07-12T15:03:35Z","digest":"sha256:a9273fa371515697b5923636fc9299325392b39ada9f0e8ebf4d2cdc8c19b7f4","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4n","label":"","name":"Brewfile","size":5891,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/Brewfile"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480165","contentType":"application/octet-stream","createdAt":"2026-07-12T15:03:35Z","digest":"sha256:49d57b9cb93ee57877eb1a7371f73606a052f67602f9fbe6864384ff27fe6c14","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4l","label":"","name":"CHANGELOG.md","size":82123,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/CHANGELOG.md"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480171","contentType":"text/plain; charset=utf-8","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:fb264e0fd1a36a83e9c23d03a263b7f8df0b0960f994ca1926386eef8d3c32be","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4r","label":"","name":"health-report.txt","size":1582,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/health-report.txt"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480172","contentType":"application/octet-stream","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:1ecc76d2f727fb4c6a3da3c45a5715fa625decfef02f13011c307a50036023a3","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4s","label":"","name":"README.md","size":21820,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/README.md"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480173","contentType":"application/json","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:3471001632045741cba07b927b724fd89dd2ed935eb659d6d89a9605423e8813","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4t","label":"","name":"sbom-cyclonedx.json","size":150548,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/sbom-cyclonedx.json"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480177","contentType":"application/json","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:38262f0d122474936485a66574760ddeb06de294d58459424a0b3efd2d4fb97d","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4x","label":"","name":"sbom-spdx.json","size":150232,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/sbom-spdx.json"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480178","contentType":"text/plain; charset=utf-8","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:eb252b9429f83ec11fbaf89ad6e3a9d62ef7de4213a62aab37748dfa274f81e5","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4y","label":"","name":"SHA256SUMS.txt","size":555,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/SHA256SUMS.txt"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/474480179","contentType":"application/octet-stream","createdAt":"2026-07-12T15:03:36Z","digest":"sha256:ff3cac01ee70bb43fca1755ff8433e8856f2f2b625c2eded9a171e708bf09157","downloadCount":1,"id":"RA_kwDOTNA9s84cR_4z","label":"","name":"VERSION","size":10,"state":"uploaded","updatedAt":"2026-07-12T15:03:36Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/untagged-a803720c497fee4d3f99/VERSION"}],"publishedAt":null,"tagName":"v3.0.1-rc1"}

  ```
  </details>

- ✅ **Download a real release asset (VERSION) and verify its checksum**
  <details><summary>output</summary>

  ```
  ff3cac01ee70bb43fca1755ff8433e8856f2f2b625c2eded9a171e708bf09157  release-VERSION

  ```
  </details>

DevForgeKit ships as a git-clone/npm/Homebrew tool, not a standalone compiled binary attached to the GitHub Release - the 'run the executable / --version / --help / doctor' checks the checklist calls for are covered against the npm install (section 2) and the Homebrew install (section 3) below, which are the actual executable distribution channels.


## 2. npm verification

- ✅ **npm pack --dry-run**
  <details><summary>output</summary>

  ```
  npm notice 427B templates/react-native/App.js
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.1-rc1
  npm notice filename: devforgekit-3.0.1-rc1.tgz
  npm notice package size: 1.1 MB
  npm notice unpacked size: 4.2 MB
  npm notice shasum: 090767a025d4cdb0e24cfe5e092c08b1fde06669
  npm notice integrity: sha512-1J/gcsAD0Ug+b[...]UnMy3laWrWpsA==
  npm notice total files: 1019
  npm notice
  devforgekit-3.0.1-rc1.tgz

  ```
  </details>

- ✅ **npm publish --dry-run**
  <details><summary>output</summary>

  ```
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.1-rc1
  npm notice filename: devforgekit-3.0.1-rc1.tgz
  npm notice package size: 1.1 MB
  npm notice unpacked size: 4.2 MB
  npm notice shasum: 090767a025d4cdb0e24cfe5e092c08b1fde06669
  npm notice integrity: sha512-1J/gcsAD0Ug+b[...]UnMy3laWrWpsA==
  npm notice total files: 1019
  npm notice
  npm notice Publishing to https://registry.npmjs.org/ with tag next and public access (dry-run)
  + devforgekit@3.0.1-rc1

  ```
  </details>

- ✅ **npm pack (real tarball)**
  <details><summary>output</summary>

  ```
  npm notice 427B templates/react-native/App.js
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.1-rc1
  npm notice filename: devforgekit-3.0.1-rc1.tgz
  npm notice package size: 1.1 MB
  npm notice unpacked size: 4.2 MB
  npm notice shasum: 090767a025d4cdb0e24cfe5e092c08b1fde06669
  npm notice integrity: sha512-1J/gcsAD0Ug+b[...]UnMy3laWrWpsA==
  npm notice total files: 1019
  npm notice
  devforgekit-3.0.1-rc1.tgz

  ```
  </details>

- ✅ **npm install -g (scratch prefix, never the real global npm)**
  <details><summary>output</summary>

  ```
  
  added 1 package in 1s
  npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
  npm warn allow-scripts   devforgekit@3.0.1-rc1 (postinstall: scripts/npm-postinstall.sh)
  npm warn allow-scripts
  npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
  Reshimming mise lts...

  ```
  </details>

- ✅ **devforgekit --version (npm install)**
  <details><summary>output</summary>

  ```
  Setting up the DevForgeKit CLI (first run only)...

  ```
  </details>

- ✅ **devforgekit --help (npm install)**
  <details><summary>output</summary>

  ```
    $ devforgekit compatibility export ./compatibility-report.md
    $ devforgekit ai providers
    $ devforgekit ai doctor
    $ devforgekit ai chat
    $ devforgekit ai generate "A REST API with JWT using FastAPI and PostgreSQL"
    $ devforgekit theme list
    $ devforgekit theme use nord
    $ devforgekit theme preview dracula
    $ devforgekit theme export -o my-theme.yaml
    $ devforgekit self-update
    $ devforgekit snapshot create
    $ devforgekit snapshot restore machine.dfk
    $ devforgekit snapshot list
    $ devforgekit snapshot inspect machine.dfk
    $ devforgekit snapshot verify machine.dfk
    $ devforgekit snapshot diff old.dfk new.dfk
    $ devforgekit benchmark quick
    $ devforgekit benchmark full
    $ devforgekit benchmark history
    $ devforgekit benchmark compare
    $ devforgekit repair scan
    $ devforgekit repair run
    $ devforgekit repair history
    $ devforgekit package analyze
    $ devforgekit package info flutter
    $ devforgekit package tree flutter
    $ devforgekit package orphan
    $ devforgekit package duplicates
    $ devforgekit graph open
    $ devforgekit graph impact flutter
    $ devforgekit graph path node docker
    $ devforgekit graph stats
    $ devforgekit env doctor
    $ devforgekit env list
    $ devforgekit env regenerate
    $ devforgekit env graph java
    $ devforgekit env diff
    $ devforgekit env watch
    $ devforgekit explain flutter
  

  ```
  </details>

- ✅ **devforgekit doctor (npm install)**
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
    "pass": 68,
    "warn": 193,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **devforgekit check (npm install)**
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

- ✅ **devforgekit component list (npm install)**
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

- ✅ **devforgekit new nextjs demo-npm (npm install)**
  <details><summary>output</summary>

  ```
  Recommended with Next.js
  ──────────────────────────────────────────────────────────────────────────────
  PACKAGE   DESCRIPTION                                            
  ────────  ───────────────────────────────────────────────────────
  vercel    The Vercel deployment platform's command-line interface
  eslint    A pluggable linter for JavaScript and TypeScript       
  prettier  An opinionated code formatter                          
  ──────────────────────────────────────────────────────────────────────────────
  i Generating Next.js project 'demo-npm' in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/npm-project/...
  → Scaffolding Next.js project with the official CLI...
  Creating a new Next.js app in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/npm-project/demo-npm.
  
  Using npm.
  
  Initializing project with template: app-tw 
  
  Initialized a git repository.
  
  Success! Created demo-npm at /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/npm-project/demo-npm
  
  Project Created
  ──────────────────────────────────────────────────────────────────────────────
  Location:      /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/npm-project/demo-npm
  Stack:         Next.js
  License:       MIT
  Git:           initialized
  CI workflow:   ✓ yes
  Docker:        ✓ yes
  README:        ✓ yes
  ──────────────────────────────────────────────────────────────────────────────
  
  Next commands
    → cd demo-npm
    → npm install
    → cp .env.example .env.local
    → npm run dev

  ```
  </details>

- ✅ **npm uninstall -g devforgekit (scratch prefix)**
  <details><summary>output</summary>

  ```
  
  removed 1 package in 246ms

  ```
  </details>


## 3. Homebrew verification

- ✅ **brew style Formula/devforgekit.rb**
  <details><summary>output</summary>

  ```
  
  1 file inspected, no offenses detected

  ```
  </details>

- ✅ **brew audit --formula local/devforgekit-rc-validate/devforgekit**
- ⚠️ **brew install --build-from-source** - the Formula built and installed into the Cellar correctly; only the final "brew link" step was skipped, because this development machine already has a real, non-Homebrew devforgekit on PATH (from dogfooding this checkout directly). Verified separately by the homebrew-formula.yml CI workflow on a clean runner with no pre-existing install.

- ❌ **devforgekit --version (Homebrew install)** (exit 1)
- ✅ **devforgekit doctor (Homebrew install)**
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

- ⚠️ **brew upgrade devforgekit (expected no-op at the same version)** (exit 1)
  <details><summary>output</summary>

  ```
  Error: Formulae found in multiple taps:
         * local/devforgekit-rc-validate/devforgekit
         * nouradinabdurahman/devforgekit/devforgekit
  
  Please use the fully-qualified name (e.g. local/devforgekit-rc-validate/devforgekit) to refer to a specific formula.

  ```
  </details>

- ✅ **devforgekit doctor after brew upgrade (Homebrew install)**
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

- ✅ **brew uninstall devforgekit**
  <details><summary>output</summary>

  ```
  Uninstalling /opt/homebrew/Cellar/devforgekit/3.0.0... (6,510 files, 20.7MB)

  ```
  </details>


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
  Execution time: 0m 39s

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

- ✅ **devforgekit env snapshot** (id: 2026-07-12T19-14-44-231Z)

- ✅ **devforgekit env restore 2026-07-12T19-14-44-231Z**
  <details><summary>output</summary>

  ```
  i Current state saved as safety snapshot 2026-07-12T19-14-44-403Z
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

- ✅ **devforgekit new nextjs demo-smoke**
  <details><summary>output</summary>

  ```
  Recommended with Next.js
  ──────────────────────────────────────────────────────────────────────────────
  PACKAGE   DESCRIPTION                                            
  ────────  ───────────────────────────────────────────────────────
  vercel    The Vercel deployment platform's command-line interface
  eslint    A pluggable linter for JavaScript and TypeScript       
  prettier  An opinionated code formatter                          
  ──────────────────────────────────────────────────────────────────────────────
  i Generating Next.js project 'demo-smoke' in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/smoke-project/...
  → Scaffolding Next.js project with the official CLI...
  Creating a new Next.js app in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/smoke-project/demo-smoke.
  
  Using npm.
  
  Initializing project with template: app-tw 
  
  Initialized a git repository.
  
  Success! Created demo-smoke at /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/smoke-project/demo-smoke
  
  Project Created
  ──────────────────────────────────────────────────────────────────────────────
  Location:      /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.E1QBDY/smoke-project/demo-smoke
  Stack:         Next.js
  License:       MIT
  Git:           initialized
  CI workflow:   ✓ yes
  Docker:        ✓ yes
  README:        ✓ yes
  ──────────────────────────────────────────────────────────────────────────────
  
  Next commands
    → cd demo-smoke
    → npm install
    → cp .env.example .env.local
    → npm run dev

  ```
  </details>

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
      "description": "Homebrew cache is 5.2 GB (>5 GB threshold)",
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
        "problem": "Homebrew cache is 5.2 GB (>5 GB threshold)",
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
  i ✓ Version consistency: All sources agree on 3.0.1-rc1 (VERSION=3.0.1-rc1, package.json=3.0.1-rc1, cli/package.json=3.0.1-rc1, Formula/devforgekit.rb=3.0.0) (Formula/devforgekit.rb intentionally excluded during a pre-release cycle)
  i - Release tag: HEAD is not currently on a tag - not a release commit yet
  i ✓ Required documentation: All present: LICENSE, README.md, CHANGELOG.md, RELEASE.md, SECURITY.md
  i ✓ Distribution artifacts: All present: package.json, Formula/devforgekit.rb, scripts/npm-postinstall.sh, completions/devforgekit.bash, completions/devforgekit.zsh, completions/devforgekit.fish
  i ✓ Registry: lint clean, format clean, quality score 89%, 202 orphan/warning notice(s) (non-blocking)
  i ✓ Outstanding pending-work markers: None found in cli/src
  i ✓ No experimental/debug flags enabled: No internal debug env vars set. Note: the ai command family is intentionally Experimental (see docs/ApiFreeze.md) - not a blocker.
  ✗ ✗ Git working tree: 6 uncommitted change(s): M .github/workflows/homebrew-formula.yml,  M CONTRIBUTING.md,  M RELEASE.md, ...
  i ✓ CI status: 5 run(s) checked, none failed
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
  
  767 passed, 1 warnings, 0 failed

  ```
  </details>

- ✅ **npm test --prefix cli (full unit + integration suite)**
  <details><summary>output</summary>

  ```
  ✔ createSnapshot records the document verbatim plus metadata, and listSnapshots sorts newest-first (10.771ms)
  ✔ listSnapshots returns [] for a workspace with no snapshots yet (1.053666ms)
  ✔ getSnapshotDoc/restoreSnapshot/deleteSnapshot throw a clear error for an unknown id (3.064375ms)
  ✔ restoreSnapshot reverts fields but always keeps the workspace's real name/createdAt (8.054834ms)
  ✔ deleteSnapshot removes exactly that snapshot (2.364375ms)
  ✔ exportSnapshot writes the recorded document to an arbitrary file path (1.882416ms)
  ✔ compareSnapshots/compareWithCurrent report added/removed/changed top-level keys (2.670708ms)
  ✔ PROVIDER_DEFAULT_HOSTS exposes the three well-known providers (1.344375ms)
  ✔ applyWorkspaceSsh writes a Host block per identity, mode 0600, preserving pre-existing config content (2.628291ms)
  ✔ re-applying the same workspace is idempotent (no duplicate Host blocks) (1.736666ms)
  ✔ a workspace with no identities removes its own block instead of leaving a stale one (1.566416ms)
  ✔ two workspaces' SSH blocks coexist independently (2.407209ms)
  ✔ ensureKnownHost recognizes an already-known host without shelling out to ssh-keyscan (no network) (18.889916ms)
  ✔ removeWorkspaceSsh returns false when the workspace never had a block (0.677625ms)
  ✔ createWorkspace persists a workspace.json under ~/.config/devforgekit/workspaces/<name>/ (4.174583ms)
  ✔ createWorkspace rejects a duplicate name and an invalid name (1.0335ms)
  ✔ getWorkspace throws a clear error for an unknown workspace (0.295334ms)
  ✔ saveWorkspace re-validates, persists changes, and stamps a fresh modifiedAt (6.579208ms)
  ✔ saveWorkspace refuses to save a workspace that was never created (0.988959ms)
  ✔ listWorkspaces returns every workspace sorted by name, invalid ones included (7.399208ms)
  ✔ active-workspace pointer: get/set round-trip, and getActiveWorkspace resolves the full document (1.172916ms)
  ✔ setActiveWorkspaceName rejects an unknown workspace and accepts null to clear (0.862292ms)
  ✔ deleteWorkspace refuses to delete the active workspace unless forced (1.139042ms)
  ✔ renameWorkspace moves the directory, updates the document, and follows the active pointer (1.312875ms)
  ✔ cloneWorkspace copies configuration but never secrets or snapshot history (2.712208ms)
  ✔ searchWorkspaces matches name, tag, git email, and cloud reference (invalid workspaces excluded) (1.717833ms)
  ✔ switchToWorkspace applies git identity live, writes the shell-export file, and moves the active pointer (117.687792ms)
  ✔ switching workspaces re-applies git identity to match the newly-active one (235.914083ms)
  ✔ switchToWorkspace throws for an unknown workspace without moving the active pointer (70.792792ms)
  ✔ deactivateWorkspace clears the pointer and resets the shell-export file (65.248916ms)
  ✔ rollbackToSnapshot on the active workspace restores the document AND re-applies live state, with an automatic safety snapshot first (253.291792ms)
  ✔ rollbackToSnapshot on an inactive workspace only reverts the stored document, leaving live state untouched (56.319042ms)
  ℹ tests 1350
  ℹ suites 8
  ℹ pass 1350
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 236919.402792

  ```
  </details>


## 8. Release checklist and version consistency

See section 6 (`devforgekit doctor --release-check`) above - it is the single, authoritative source for: version consistency across VERSION/package.json/cli/package.json/Formula, required documentation present, distribution artifacts present, registry audit/lint/format clean, no outstanding pending-work markers, no experimental/debug flags enabled, a clean git working tree, and the current commit's own CI run conclusions.

