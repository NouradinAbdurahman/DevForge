# Platform Certification Dockerfiles

Reusable Docker fixtures for the Platform Stabilization Program (see
`docs/PlatformStabilizationProgram.md`). Each Dockerfile reproduces a
real fresh-install experience for one distro: no Homebrew, Node.js
installed the way a real first-time user on that distro would install
it, a non-root `testuser` with passwordless `sudo` (matching a real
desktop/WSL2 user), and both `bash` and `zsh` available for shell
detection testing.

These intentionally do **not** bake in the `devforgekit` package itself
- mount the packed tarball and/or a read-only copy of the repo source at
run time, so every certification run tests the current code, not a
snapshot frozen at image-build time.

## Usage

```bash
# From the repo root: build the real tarball from current source
npm pack

# Build the image (repeat -f/-t for each distro)
docker build -f docker/platform-certification/Dockerfile.ubuntu -t dfk-cert-ubuntu:22.04 .

# Run it, mounting the tarball and repo source read-only
docker run -d --name dfk-ubuntu-cert \
  -v "$PWD/devforgekit-*.tgz:/tmp/devforgekit.tgz:ro" \
  -v "$PWD:/repo-src:ro" \
  dfk-cert-ubuntu:22.04

# Exercise it
docker exec dfk-ubuntu-cert bash -c '
  export DEVFORGEKIT_NO_TUI=1
  sudo npm install -g /tmp/devforgekit.tgz
  devforgekit doctor
'

docker rm -f dfk-ubuntu-cert
```

## Images

| File | Distro | Node install method | Package manager (for `LinuxPlatform` detection) |
|---|---|---|---|
| `Dockerfile.ubuntu` | Ubuntu 22.04 | NodeSource `setup_20.x` | `apt` |
| `Dockerfile.debian` | Debian 12 (bookworm) | NodeSource `setup_20.x` | `apt` |
| `Dockerfile.fedora` | Fedora 40 | NodeSource `setup_20.x` (rpm) | `dnf` |
| `Dockerfile.arch` | Arch Linux (rolling) | distro repo (`pacman`) | `pacman` |

`npm install -g npm@11` is pinned explicitly in the apt-based images to
match the `allow-scripts` gate behavior documented in
`docs/NpmGlobalInstallRootCause.md` - older npm shipped by some distros'
own Node packages predates that gate and would silently hide the
scenario these images exist to test.
