# Registry Completion - Cross-Platform Research Queue

206 packages still need real Linux (apt/dnf/pacman) and/or Windows (winget/choco/scoop) verification against authoritative sources (Repology, winget-pkgs). Never guess a package identifier - verify or mark explicitly unsupported with a reason.

Note: colima (docker variant) linux support is also still unresolved - excluded here since docker.yaml is variants-based, not a flat package.

## Effort legend

- **low** - a CLI tool installed via brew-formula on macOS; very likely already packaged for apt/dnf/pacman under the same or a close name.
- **medium** - installed via a shell script/installer on macOS (rustup-style); Linux/Windows likely need a different (but well-documented) install method, not necessarily a traditional package manager.
- **high** - a GUI app installed via brew-cask; real uncertainty whether a Linux/Windows build exists at all - may resolve to an explicit unsupported declaration rather than a real install step.

## AI (5 - low=3, medium=2, high=0)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| aider | linux, windows | shell | https://aider.chat |
| continue | linux, windows | shell | https://continue.dev |
| llama-cpp | linux, windows | brew-formula | https://github.com/ggml-org/llama.cpp |
| ollama | linux, windows | brew-formula | https://ollama.com |
| whisper-cpp | linux, windows | brew-formula | https://github.com/ggml-org/whisper.cpp |

## Backend (19 - low=11, medium=6, high=2)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| asdf | windows | brew-formula | https://asdf-vm.com |
| brew | linux, windows | shell | https://brew.sh |
| bun | linux, windows | shell | https://bun.sh |
| cargo | linux, windows | shell | https://doc.rust-lang.org/cargo |
| composer | linux, windows | brew-formula | https://getcomposer.org |
| gem | linux, windows | shell | https://rubygems.org |
| golangci-lint | linux, windows | brew-formula | https://golangci-lint.run |
| gradle | linux, windows | brew-formula | https://gradle.org |
| grpcurl | linux, windows | brew-formula | https://github.com/fullstorydev/grpcurl |
| httpie | linux, windows | brew-formula | https://httpie.io |
| insomnia | linux, windows | brew-cask | https://insomnia.rest |
| maven | linux, windows | brew-formula | https://maven.apache.org |
| miniconda | linux, windows | brew-cask | https://docs.conda.io/projects/miniconda |
| pip | linux, windows | shell | https://pip.pypa.io |
| pipx | linux, windows | brew-formula | https://pipx.pypa.io |
| poetry | linux, windows | brew-formula | https://python-poetry.org |
| sdkman | linux, windows | shell | https://sdkman.io |
| uv | linux, windows | brew-formula | https://docs.astral.sh/uv |
| volta | windows | brew-formula | https://volta.sh |

## Cloud (11 - low=10, medium=0, high=1)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| aws-cli | linux, windows | brew-formula | https://aws.amazon.com/cli |
| azure-cli | linux, windows | brew-formula | https://learn.microsoft.com/cli/azure |
| cloudflare | linux, windows | brew-formula | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks |
| doctl | linux, windows | brew-formula | https://docs.digitalocean.com/reference/doctl |
| firebase | linux, windows | brew-formula | https://firebase.google.com/docs/cli |
| flyio | linux, windows | brew-formula | https://fly.io |
| gcloud | linux, windows | brew-cask | https://cloud.google.com/sdk |
| heroku | linux, windows | brew-formula | https://devcenter.heroku.com/articles/heroku-cli |
| linode-cli | linux, windows | brew-formula | https://www.linode.com/docs/products/tools/cli |
| railway | linux, windows | brew-formula | https://railway.app |
| supabase | linux, windows | brew-formula | https://supabase.com/docs/guides/cli |

## Containers (16 - low=16, medium=0, high=0)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| buildah | linux, windows | brew-formula | https://buildah.io |
| colima | linux, windows | brew-formula | https://github.com/abiosoft/colima |
| dive | linux, windows | brew-formula | https://github.com/wagoodman/dive |
| k9s | linux, windows | brew-formula | https://k9scli.io |
| kind | linux, windows | brew-formula | https://kind.sigs.k8s.io |
| kubectl | linux, windows | brew-formula | https://kubernetes.io/docs/reference/kubectl |
| kubectx | linux, windows | brew-formula | https://github.com/ahmetb/kubectx |
| kubens | linux, windows | brew-formula | https://github.com/ahmetb/kubectx |
| kustomize | linux, windows | brew-formula | https://kustomize.io |
| lazydocker | linux, windows | brew-formula | https://github.com/jesseduffield/lazydocker |
| lima | linux, windows | brew-formula | https://lima-vm.io |
| minikube | linux, windows | brew-formula | https://minikube.sigs.k8s.io |
| nerdctl | linux, windows | brew-formula | https://github.com/containerd/nerdctl |
| podman | linux, windows | brew-formula | https://podman.io |
| skaffold | linux, windows | brew-formula | https://skaffold.dev |
| skopeo | linux, windows | brew-formula | https://github.com/containers/skopeo |

## Databases (16 - low=15, medium=0, high=1)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| arangodb | linux, windows | brew-cask | https://arangodb.com |
| cassandra | linux, windows | brew-formula | https://cassandra.apache.org |
| clickhouse | linux, windows | brew-formula | https://clickhouse.com |
| cockroachdb | linux, windows | brew-formula | https://www.cockroachlabs.com |
| duckdb | linux, windows | brew-formula | https://duckdb.org |
| elasticsearch | linux, windows | brew-formula | https://www.elastic.co/elasticsearch |
| influxdb | linux, windows | brew-formula | https://www.influxdata.com |
| mariadb | linux, windows | brew-formula | https://mariadb.org |
| minio | linux, windows | brew-formula | https://min.io |
| mongodb | windows | brew-formula | https://www.mongodb.com |
| mysql | windows | brew-formula | https://www.mysql.com |
| neo4j | linux, windows | brew-formula | https://neo4j.com |
| postgres | linux, windows | brew-formula | https://www.postgresql.org |
| qdrant | linux, windows | brew-formula | https://qdrant.tech |
| redis | windows | brew-formula | https://redis.io |
| sqlite | windows | brew-formula | https://www.sqlite.org |

## DevOps (22 - low=22, medium=0, high=0)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| act | linux, windows | brew-formula | https://github.com/nektos/act |
| arduino-cli | linux, windows | brew-formula | https://arduino.github.io/arduino-cli |
| bazelisk | linux, windows | brew-formula | https://bazel.build |
| btop | windows | brew-formula | https://github.com/aristocratos/btop |
| buildkite-agent | linux, windows | brew-formula | https://buildkite.com/docs/agent |
| circleci | linux, windows | brew-formula | https://circleci.com/docs/local-cli |
| consul | linux, windows | brew-formula | https://www.consul.io |
| gitlab-runner | linux, windows | brew-formula | https://docs.gitlab.com/runner |
| glances | linux, windows | brew-formula | https://nicolargo.github.io/glances |
| grafana | linux, windows | brew-formula | https://grafana.com |
| just | linux, windows | brew-formula | https://github.com/casey/just |
| meson | linux, windows | brew-formula | https://mesonbuild.com |
| netdata | linux, windows | brew-formula | https://www.netdata.cloud |
| ninja | linux, windows | brew-formula | https://ninja-build.org |
| nomad | linux, windows | brew-formula | https://www.nomadproject.io |
| openocd | linux, windows | brew-formula | https://openocd.org |
| packer | linux, windows | brew-formula | https://www.packer.io |
| platformio | linux, windows | brew-formula | https://platformio.org |
| prometheus | linux, windows | brew-formula | https://prometheus.io |
| pulumi | linux, windows | brew-formula | https://www.pulumi.com |
| terraform | linux, windows | brew-formula | https://www.terraform.io |
| vault | linux, windows | brew-formula | https://www.vaultproject.io |

## Editors (8 - low=2, medium=0, high=6)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| cursor | linux, windows | brew-cask | https://www.cursor.com |
| helix | linux, windows | brew-formula | https://helix-editor.com |
| jetbrains-toolbox | linux, windows | brew-cask | https://www.jetbrains.com/toolbox-app |
| micro | linux, windows | brew-formula | https://micro-editor.github.io |
| sublime-text | linux, windows | brew-cask | https://www.sublimetext.com |
| vscode | linux, windows | brew-cask | https://code.visualstudio.com |
| windsurf | linux, windows | brew-cask | https://windsurf.com |
| zed | linux, windows | brew-cask | https://zed.dev |

## Frontend (25 - low=4, medium=0, high=21)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| arc | linux, windows | brew-cask | https://arc.net |
| blender | linux, windows | brew-cask | https://www.blender.org |
| brave | linux, windows | brew-cask | https://brave.com |
| caddy | linux, windows | brew-formula | https://caddyserver.com |
| cascadia-code | linux, windows | brew-cask | https://github.com/microsoft/cascadia-code |
| certbot | linux, windows | brew-formula | https://certbot.eff.org |
| chrome | linux, windows | brew-cask | https://www.google.com/chrome |
| edge | linux, windows | brew-cask | https://www.microsoft.com/edge |
| figma | linux, windows | brew-cask | https://www.figma.com |
| fira-code | linux, windows | brew-cask | https://github.com/tonsky/FiraCode |
| firefox | linux, windows | brew-cask | https://www.mozilla.org/firefox |
| godot | linux, windows | brew-cask | https://godotengine.org |
| hack | linux, windows | brew-cask | https://sourcefoundry.org/hack |
| hack-nerd-font | linux, windows | brew-cask | https://github.com/ryanoasis/nerd-fonts |
| ibm-plex-mono | linux, windows | brew-cask | https://www.ibm.com/plex |
| jetbrains-mono | linux, windows | brew-cask | https://www.jetbrains.com/lp/mono |
| love | linux, windows | brew-cask | https://love2d.org |
| meslo-lg-nerd-font | linux, windows | brew-cask | https://github.com/ryanoasis/nerd-fonts |
| monaspace | linux, windows | brew-cask | https://monaspace.githubnext.com |
| nginx | windows | brew-formula | https://nginx.org |
| raylib | linux, windows | brew-formula | https://www.raylib.com |
| rive | linux, windows | brew-cask | https://rive.app |
| unity-hub | linux, windows | brew-cask | https://unity.com/unity-hub |
| victor-mono | linux, windows | brew-cask | https://rubjo.github.io/victor-mono |
| zen-browser | linux, windows | brew-cask | https://zen-browser.app |

## Languages (20 - low=16, medium=3, high=1)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| c | linux, windows | shell | https://clang.llvm.org |
| clojure | linux, windows | brew-formula | https://clojure.org |
| cpp | linux, windows | brew-formula | https://gcc.gnu.org |
| csharp | linux, windows | brew-cask | https://dotnet.microsoft.com |
| dart | linux, windows | brew-formula | https://dart.dev |
| elixir | linux, windows | brew-formula | https://elixir-lang.org |
| haskell | linux, windows | brew-formula | https://www.haskell.org |
| java | linux, windows | brew-formula | https://openjdk.org |
| julia | linux, windows | brew-formula | https://julialang.org |
| kotlin | linux, windows | brew-formula | https://kotlinlang.org |
| lua | linux, windows | brew-formula | https://www.lua.org |
| nim | linux, windows | brew-formula | https://nim-lang.org |
| ocaml | linux, windows | brew-formula | https://ocaml.org |
| perl | linux, windows | brew-formula | https://www.perl.org |
| php | linux, windows | brew-formula | https://www.php.net |
| r | linux, windows | brew-formula | https://www.r-project.org |
| rust | linux, windows | shell | https://www.rust-lang.org |
| scala | linux, windows | brew-formula | https://www.scala-lang.org |
| swift | linux, windows | shell | https://www.swift.org |
| zig | linux, windows | brew-formula | https://ziglang.org |

## Mobile (12 - low=9, medium=0, high=3)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| android-studio | linux, windows | brew-cask | https://developer.android.com/studio |
| cocoapods | linux, windows | brew-formula | https://cocoapods.org |
| fastlane | linux, windows | brew-formula | https://fastlane.tools |
| flutter | linux, windows | brew-cask | https://flutter.dev |
| genymotion | linux, windows | brew-cask | https://www.genymotion.com |
| scrcpy | linux, windows | brew-formula | https://github.com/Genymobile/scrcpy |
| swiftformat | linux, windows | brew-formula | https://github.com/nicklockwood/SwiftFormat |
| swiftlint | linux, windows | brew-formula | https://github.com/realm/SwiftLint |
| watchman | linux, windows | brew-formula | https://facebook.github.io/watchman |
| xcbeautify | linux, windows | brew-formula | https://github.com/cpisciotta/xcbeautify |
| xcode | linux, windows | brew-formula | https://developer.apple.com/xcode |
| xcodegen | linux, windows | brew-formula | https://github.com/yonaskolb/XcodeGen |

## Security (17 - low=14, medium=0, high=3)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| age | linux, windows | brew-formula | https://age-encryption.org |
| aircrack-ng | linux, windows | brew-formula | https://www.aircrack-ng.org |
| binwalk | linux, windows | brew-formula | https://github.com/ReFirmLabs/binwalk |
| burp-suite | linux, windows | brew-cask | https://portswigger.net/burp |
| cosign | linux, windows | brew-formula | https://docs.sigstore.dev/cosign/overview |
| ghidra | linux, windows | brew-cask | https://ghidra-sre.org |
| gnupg | linux, windows | brew-formula | https://gnupg.org |
| hydra | linux, windows | brew-formula | https://github.com/vanhauser-thc/thc-hydra |
| john | linux, windows | brew-formula | https://www.openwall.com/john |
| metasploit | linux, windows | brew-formula | https://www.metasploit.com |
| mkcert | linux, windows | brew-formula | https://github.com/FiloSottile/mkcert |
| nikto | linux, windows | brew-formula | https://cirt.net/Nikto2 |
| nmap | windows | brew-formula | https://nmap.org |
| openssl | linux, windows | brew-formula | https://www.openssl.org |
| radare2 | linux, windows | brew-formula | https://www.radare.org |
| sqlmap | linux, windows | brew-formula | https://sqlmap.org |
| wireshark | linux, windows | brew-cask | https://www.wireshark.org |

## Utilities (35 - low=28, medium=0, high=7)

| Package | Missing | macOS method | Upstream |
|---|---|---|---|
| alacritty | linux, windows | brew-cask | https://alacritty.org |
| atuin | linux, windows | brew-formula | https://atuin.sh |
| bind | linux, windows | brew-formula | https://www.isc.org/bind |
| curl | windows | brew-formula | https://curl.se |
| difftastic | linux, windows | brew-formula | https://github.com/Wilfred/difftastic |
| direnv | linux, windows | brew-formula | https://direnv.net |
| entr | linux, windows | brew-formula | https://eradman.com/entrproject |
| exiftool | linux, windows | brew-formula | https://exiftool.org |
| eza | windows | brew-formula | https://eza.rocks |
| git-delta | linux, windows | brew-formula | https://github.com/dandavison/delta |
| glow | linux, windows | brew-formula | https://github.com/charmbracelet/glow |
| gum | linux, windows | brew-formula | https://github.com/charmbracelet/gum |
| hugo | linux, windows | brew-formula | https://gohugo.io |
| hyperfine | linux, windows | brew-formula | https://github.com/sharkdp/hyperfine |
| iperf3 | linux, windows | brew-formula | https://iperf.fr |
| iterm2 | linux, windows | brew-cask | https://iterm2.com |
| k6 | linux, windows | brew-formula | https://k6.io |
| kitty | linux, windows | brew-cask | https://sw.kovidgoyal.net/kitty |
| mtr | linux, windows | brew-formula | https://www.bitwizard.nl/mtr |
| ncdu | linux, windows | brew-formula | https://dev.yorhel.nl/ncdu |
| netcat | linux, windows | brew-formula | http://netcat.sourceforge.net |
| postman | linux, windows | brew-cask | https://www.postman.com |
| procs | linux, windows | brew-formula | https://github.com/dalance/procs |
| sd | linux, windows | brew-formula | https://github.com/chmln/sd |
| sox | linux, windows | brew-formula | https://sourceforge.net/projects/sox |
| speedtest-cli | linux, windows | brew-formula | https://github.com/sivel/speedtest-cli |
| tcpdump | windows | brew-formula | https://www.tcpdump.org |
| tlrc | linux, windows | brew-formula | https://github.com/tldr-pages/tlrc |
| vlc | linux, windows | brew-cask | https://www.videolan.org/vlc |
| warp | linux, windows | brew-cask | https://www.warp.dev |
| watchexec | linux, windows | brew-formula | https://watchexec.github.io/ |
| wezterm | linux, windows | brew-cask | https://wezterm.org |
| wget | windows | brew-formula | https://www.gnu.org/software/wget |
| whois | linux, windows | brew-formula | https://github.com/rfc1036/whois |
| yt-dlp | linux, windows | brew-formula | https://github.com/yt-dlp/yt-dlp |
