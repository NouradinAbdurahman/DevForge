# DevForgeKit Homebrew Formula.
#
# Installs the launcher only - `devforgekit`, its Node CLI (cli/), and
# the bash scripts/registry/templates it dispatches to. It does not run
# `devforgekit install`/bootstrap.sh and does not provision any
# toolchains (Homebrew formulae, mise runtimes, dotfiles, services) -
# that's explicitly the job of `devforgekit install` after this formula
# finishes, matching npm distribution's identical "get the command
# working, provisioning is a separate, explicit step" boundary (see
# package.json/scripts/npm-postinstall.sh).
#
# Update flow for a new release: bump `url`/`sha256` below to the new
# tag (`shasum -a 256` against the GitHub-generated
# archive/refs/tags/vX.Y.Z.tar.gz - never hand-typed), then
# `brew install --build-from-source ./Formula/devforgekit.rb` and run
# the test block locally before opening a homebrew-devforgekit tap PR.
class Devforgekit < Formula
  desc "Local-first development environment and workstation lifecycle manager"
  homepage "https://devforgekit.dev"
  url "https://github.com/NouradinAbdurahman/DevForgeKit/archive/refs/tags/v3.0.1.tar.gz"
  sha256 "08420ee92ab13f6974720e09692ef9c514108c1a043fc8fed48265a3ae60f38b"
  license "MIT"

  # Tracks GitHub releases directly (the same vX.Y.Z tags `url` above
  # points at) - verified live via `brew livecheck` against this exact
  # formula before adding, not guessed: correctly reports the current
  # version as up to date against the real v3.0.0 GitHub release.
  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on "node"

  def install
    # Copy everything the Node CLI (cli/) and the bash scripts it can
    # fall back to actually read at runtime - the same file list
    # package.json's "files" field uses for npm distribution, traced
    # from every repoRoot()-relative path the CLI reads, not guessed.
    # File::FNM_DOTMATCH (not a plain Dir["*"]) deliberately, so
    # dotfiles (.zshrc/.gitconfig/.gitignore_global, needed by
    # restore_zsh/restore_git) are included without a separate,
    # easy-to-forget glob pattern for hidden files.
    libexec.mkpath
    entries = Dir.glob("*", File::FNM_DOTMATCH) - [".", ".."]
    cp_r entries, libexec

    # cli/ is a *nested* npm package (its own package.json, installed
    # into its own node_modules, not the whole repo treated as one
    # global npm-style install), so std_npm_args' default --global/
    # --prefix=libexec/pack-and-install flow doesn't fit - but its
    # security flags (--ignore-scripts, --min-release-age, a pinned npm
    # cache) still apply, layered onto a plain local `npm install`
    # targeting cli/ specifically via prefix: false.
    system "npm", "install", *std_npm_args(prefix: false), "--omit=dev", "--prefix", (libexec/"cli").to_s

    chmod 0755, libexec/"devforgekit"
    chmod 0755, libexec/"bootstrap.sh"

    (bin/"devforgekit").write_env_script libexec/"devforgekit", {}

    # Guarded, not unconditional: completions/ was added after v3.0.0
    # was tagged, so it isn't in that tarball yet - this formula still
    # needs to install correctly against the only real tag that exists
    # right now. Starts installing completions automatically the moment
    # `url`/`sha256` above bump to a tag that includes them, with no
    # further formula change needed.
    if (libexec/"completions/devforgekit.bash").exist?
      bash_completion.install libexec/"completions/devforgekit.bash"
      zsh_completion.install libexec/"completions/devforgekit.zsh" => "_devforgekit"
      fish_completion.install libexec/"completions/devforgekit.fish"
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/devforgekit --version")
    system bin/"devforgekit", "--help"
  end
end
