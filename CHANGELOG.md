# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Live alerts. With notifications on, Gerfaut keeps one connection open to your backend and tells you when a transaction reaches the mempool, incoming or outgoing, and again when it confirms. An Electrum server pushes the change, so the notification arrives within seconds. An Esplora backend is polled once a minute. It works for as long as Gerfaut is open, minimised and locked included, and the pages update at the same moment.
- Settings › Notifications shows where the watch stands, such as "Connected · Electrum · host" or "Polling every minute · host", and what the open connection tells the server: what a sync already tells it, and also how long Gerfaut stays connected. With the Automatic backend, Gerfaut first tries an Electrum server run by one of the public operators already in the rotation, because Electrum is what pushes changes.
- Premium can watch a wallet that is a single address. The question asked before it leaves the device says "The address" for these wallets.
- A wallet the Premium server refuses to watch says why, in the server's own sentence, under its row in Watched wallets and in Recent alerts. When the server asks to wait, the note says for how long.
- A "Send a test notification" button, because it is the only reliable way to know whether the system shows them.
- A notice in a corner of the window when a newer Gerfaut is out, such as "Gerfaut 0.2.0 is available". Its button opens Settings › About, where the download is, and "Later" closes it. It shows once per version, takes no focus, blocks nothing, and never appears over the lock screen.

### Changed

- Notifications are posted while Gerfaut is locked too. A notification posted then names no wallet and no amount, only that a transaction appeared or confirmed and whether it is outgoing. Unlocked, amounts follow the display unit and stay hidden while balances are masked, as before.
- The "Check while open" rhythm is gone. With notifications on, the watch is live; with them off, Gerfaut syncs when it opens and when you ask.
- A transaction is announced once when it appears and once when it confirms, whether the live watch or a sync you asked for saw it first, and across restarts.
- Gerfaut looks for a newer version on its own, at most once a day and only while it is unlocked. It asks GitHub for the latest release of this repository and sends nothing else. The request takes the route your syncs take. With a clearnet backend GitHub sees your IP address, as it does when you press the button. With an onion backend the request goes through Tor, the button included, and when Tor is not available nothing is sent and Settings › About says so. A switch there turns the automatic check off.
- The download button in Settings › About always opens the releases page of this repository, whatever address the answer carried.
- Premium controls and the Premium settings entry now use the Premium colour, so what belongs to the paid service reads as such at a glance.

### Fixed

- The app says "private key" wherever it used to say "key" alone: on the Backup & sync card, the welcome tour, the empty home page and the Receive page. A backup does hold public keys, inside its descriptors.
- An Electrum server saved under an IPv6 address comes back into the backend form whole, with its port. It used to be cut at the first colon.

## [0.1.0] - 2026-09-12

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
- When no backend confirms a coin a PSBT spends, the preview says so in amber and marks the fee and the input total as what the PSBT claims: check them on a backend you trust, or on the signing device, before you send.
- Mainnet, signet, testnet4 and regtest.

### Talking to the chain

- Public Esplora servers by default, or your own node over Esplora or Electrum.
- An Electrum server with a self-signed certificate is shown to you, fingerprint, subject and expiry, and trusted only once you say so.
- A `.onion` backend goes through Tor. Gerfaut uses the Tor already running on the machine when there is one and starts its own otherwise, so reaching a hidden service needs no second install. The built-in client is arti; the first connection takes up to a minute and a half while it bootstraps.
- Sync when the app opens and on demand. A rescan is a separate, explicit action.
- A system notification when a transaction shows up, off until you turn it on. What the system already showed stays in its notification center after Gerfaut locks, and masking is what keeps amounts out of it.

### Getting told when something moves

- A Premium section in Settings, for the alert service at gerfaut-wallet.com. Enter an account key, and the licence is verified offline from the certificate the vault holds: the app shows whether it is active with no network at all, and never waits on the server to say so.
- Choose which wallets the server watches. Each one is agreed to explicitly, the first scan is shown as pending until the server has done it, and a wallet removed from the app is unregistered from the server, at the next heartbeat if the server is out of reach at the time. Wallets the server still watches for this account but this device no longer holds are listed, so they can be unregistered too.
- The switch that takes a wallet off the server asks first, and so does removing a wallet the server watches: the server deletes the wallet's alert history along with it, and the confirmation says so.
- Four kinds of channel: ntfy, Telegram, e-mail and webhook. An e-mail address receives nothing until its owner types back the six-digit code it was sent. A Telegram row names the chat it is linked to. A channel the server turned off is shown as not delivering, with the reason, and a test is only offered on a channel the server would deliver to.
- The recent alerts, and a banner on the overview when the watch has gone offline.
- Renewing opens the site with the key on the clipboard, never in the address bar.
- Forget the key on this device, or delete the account on the server. The confirmation says everything that goes, the paid time included, and the button that cannot be undone is the red one.
- A call that fails leaves a note under its card in the server's own words, never a toast. When the chain backend goes through Tor, these calls do too, and a Tor that cannot be reached is named as such.

### Keeping it yours

- The wallet list is stored encrypted. Its key lives in the operating system credential store, the Windows Credential Manager, the macOS Keychain or the Secret Service on Linux.
- Lock the app with a PIN or a password. While it is locked the vault answers nothing: every command is refused on the Rust side, and the webview holds no descriptor, no balance and no account key until a secret goes through. Behind the lock the app reads only the theme, whether the welcome tour has been seen, the network and the kind of secret to ask for, so unlocking lands on the same vault it left, on the same network.
- Export every wallet you watch into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on another machine or on the phone. It holds descriptors and addresses, never a private key or seed. The file can be copied and guessed offline, and the app says so where the password is chosen.
- Restoring a backup that carries node settings shows what applying them would put in place: the server every wallet of a network would then talk to, and the certificates it would pin. A backup written by a newer Gerfaut is refused by name, not mistaken for a wrong password.
- Fiat value beside the balance, in the currency you pick, from CoinGecko, Kraken or mempool.space. Amounts in BTC or in sats. No price source is asked anything until fiat value is turned on.
- Light and dark themes.
- A check for a newer version, from a button in Settings › About and on its own at most once a day. A switch turns the automatic check off.

### Verifying a download

Every release carries a `SHA256SUMS` manifest signed with minisign. The key and the two commands are in [README.md](README.md). The workflow that builds a release pins every action and packaging tool by hash and holds no token that could write to the repository.

[Unreleased]: https://github.com/gerfaut-wallet/gerfaut-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gerfaut-wallet/gerfaut-desktop/releases/tag/v0.1.0
