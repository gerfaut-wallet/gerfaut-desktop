# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-04

First public release. Windows, macOS and Linux.

Gerfaut watches Bitcoin wallets it cannot spend from. There is no key generation, no seed handling and no signing anywhere in the code, and no Send button in the interface.

### Watching a wallet

- Add a wallet from an output descriptor, an extended public key or a single address. Paste it, scan a QR code with the camera, including the animated ones a signing device shows, or open a file.
- Gerfaut says what it recognized, which script type and which derivation it will use, and waits for you to confirm before it stores anything. Anything that carries private material is refused outright.
- Watch several wallets at once. Rename them, give them an icon, reorder the list.
- Balance, transaction history, transaction detail with its inputs and outputs, unspent outputs in a table of their own, and the next receive addresses.
- A wallet whose descriptor holds a Miniscript policy gets a page for it: every spending path, who can take it, and the countdown left on the ones that wait for a timelock.
- Export the history of a wallet as CSV.
- Broadcast a transaction someone else signed. Paste its hex, open the file a signing device wrote, or scan its QR code. Gerfaut shows what the transaction does before it sends anything.
- Mainnet, signet, testnet4 and regtest.

### Talking to the chain

- Public Esplora servers by default, or your own node over Esplora or Electrum.
- An Electrum server with a self-signed certificate is shown to you, fingerprint, subject and expiry, and trusted only once you say so.
- A `.onion` backend goes through Tor. Gerfaut uses the Tor already running on the machine when there is one and starts its own otherwise, so reaching a hidden service needs no second install. The built-in client is arti; the first connection takes up to a minute and a half while it bootstraps.
- Sync on demand, or every 5, 15 or 60 minutes while the app is open. A rescan is a separate, explicit action.
- A system notification when a sync finds a transaction, off until you turn it on.

### Keeping it yours

- The wallet list is stored encrypted. Its key lives in the operating system credential store, the Windows Credential Manager, the macOS Keychain or the Secret Service on Linux.
- Lock the app with a PIN or a password.
- Export every wallet you watch into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on another machine or on the phone. It holds descriptors and addresses, never a key.
- Fiat value beside the balance, in the currency you pick, from CoinGecko, Kraken or mempool.space. Amounts in BTC or in sats.
- Light and dark themes.
- A check for a newer version, when you press the button and never on its own.

### Verifying a download

Every release carries a `SHA256SUMS` manifest signed with minisign. The key and the two commands are in [README.md](README.md).

[Unreleased]: https://github.com/gerfaut-wallet/gerfaut-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gerfaut-wallet/gerfaut-desktop/releases/tag/v0.1.0
