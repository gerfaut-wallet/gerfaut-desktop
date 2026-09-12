# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Sync on demand, or every 5, 15 or 60 minutes while the app is open. A rescan is a separate, explicit action.
- A system notification when a sync finds a transaction, off until you turn it on. Nothing is posted while the app is locked; what the system already showed stays where it is, and masking is what keeps amounts out of it.

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
- Export every wallet you watch into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on another machine or on the phone. It holds descriptors and addresses, never a key. The file can be copied and guessed offline, and the app says so where the password is chosen.
- Restoring a backup that carries node settings shows what applying them would put in place: the server every wallet of a network would then talk to, and the certificates it would pin. A backup written by a newer Gerfaut is refused by name, not mistaken for a wrong password.
- Fiat value beside the balance, in the currency you pick, from CoinGecko, Kraken or mempool.space. Amounts in BTC or in sats. No price source is asked anything until fiat value is turned on.
- Light and dark themes.
- A check for a newer version, when you press the button and never on its own.

### Verifying a download

Every release carries a `SHA256SUMS` manifest signed with minisign. The key and the two commands are in [README.md](README.md). The workflow that builds a release pins every action and packaging tool by hash and holds no token that could write to the repository.

[0.1.0]: https://github.com/gerfaut-wallet/gerfaut-desktop/releases/tag/v0.1.0
