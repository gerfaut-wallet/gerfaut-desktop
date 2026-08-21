# gerfaut-desktop

[Gerfaut](https://github.com/gerfaut-wallet) for Windows, macOS, and Linux, a Bitcoin watch-only wallet.

![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange) ![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue)

> Status: pre-development. The repository only holds conventions and scaffolding for now, no code yet.

Watch your coins without ever exposing them: Gerfaut holds no private keys. It watches descriptors, shows balances and history, and alerts you when something moves.

## Scope

- Desktop app built with Tauri v2, calling [`gerfaut-core`](https://github.com/gerfaut-wallet/gerfaut-core) (Rust) directly
- An interface designed for desktop, not a stretched mobile layout
- Lightweight by construction: the system webview instead of a bundled browser engine

## Watch-only, by design

The app contains no code to generate keys, handle seeds, or sign transactions. There is no "Send" button. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

| Repository | Role |
|---|---|
| [`gerfaut-core`](https://github.com/gerfaut-wallet/gerfaut-core) | Core Rust library |
| [`gerfaut-mobile`](https://github.com/gerfaut-wallet/gerfaut-mobile) | Mobile app (Flutter, Android first) |
| `gerfaut-desktop` | Desktop app, this repository |
| [`gerfaut-web`](https://github.com/gerfaut-wallet/gerfaut-web) | Website, documentation, downloads |

## License

[AGPL-3.0-only](LICENSE). Commercial licensing: info@pandul.fr.

The Gerfaut name and logo are not covered by the code license. See [TRADEMARK.md](TRADEMARK.md).

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).
