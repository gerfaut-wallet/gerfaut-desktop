# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Premium devices. The account key now connects this computer to the account, and in return the server hands it a token of its own, which the encrypted vault keeps and never shows. Every request after that carries the token, not the key. The first device an account ever has gets full access at once. Any other device waits 10 days, or until a device with full access approves it, and in the meantime it sees nothing and changes nothing. A key entered before this version connects on its own, once.
- A Devices card in Settings › Premium lists every device that entered the key, with its platform, the day it connected, and either full access or the number of days it still has to wait. From there, you approve or refuse a waiting device, or disconnect another one.
- While a device waits for approval, a red banner at the top of the Overview says so, and its Review button opens the Devices card. The banner goes away on its own once nothing waits. When notifications are on, a system notification also announces each new device, once, and names neither the device nor the account while Gerfaut is locked. Gerfaut checks the list when the window opens or comes back to the front, and every 5 minutes while it runs, minimised and locked included.
- A device waiting for approval sees a single card in place of the account: the day it connected, the day it gets full access without approval, and a Check again button. It also checks its own standing every 5 minutes, and opens up as soon as another device approves it.
- Change key replaces the account key. The old key stops working at once, on the website too, and the server disconnects every other device. The new key is shown once, with a Copy button, and the dialog stays open until you tick "I saved my new key".
- A device the server disconnected says so under the Licence card, in the server's own words when it gave some, with a Connect again button. If the key itself was changed on another device, the key field comes back so you can enter the new one, and Forget this key clears the old one if you do not have it.
- After the first connection, a Protect your Premium account card suggests 3 things: connect a second device, turn on the app lock, and save the key in a password manager. Each step ticks itself when Gerfaut can tell it is done, and you can hide the card.
- Before approving, refusing or disconnecting a device, changing the key, deleting the account, taking a wallet off the server, removing a wallet the server watches or removing a channel, Gerfaut asks for the app lock's PIN or password, and checks it the way the lock screen does. It also asks before you forget the key on a device with full access, or add a channel while the app lock is on. Without an app lock, these actions say one is needed and lead to Settings › Security.
- A lost answer from the Gerfaut server costs neither the key nor a device. In practice, when a connection or a key change never gets its answer back, Gerfaut sends the exact same request again, in the background or with the next request. While a key change is unfinished, the Licence card says "The key change did not finish. Try again to complete it." with a Try again button, and does not offer the key for copying. When you forget the key while the server is out of reach, Gerfaut disconnects this device on the server at the next chance.
- Opening Gerfaut while it is already running now brings the open window to the front instead of starting a second copy.
- When the vault cannot be opened at startup, the window now says why and offers a Try again button. Before, the app closed without a word. This covers a vault that another copy of Gerfaut holds, for example a second installation that uses the same data folder: two copies can no longer open the same vault and save over each other's changes.
- The Broadcast preview now warns in red when an input is signed with SIGHASH_NONE or SIGHASH_SINGLE. Such a signature does not fix where all of the money goes, so anyone who relays the transaction before it is mined can send some or all of it somewhere else. The confirmation dialog repeats the warning.

### Changed

- Forget this key now also disconnects this computer from the account on the server. Connecting it again takes a new approval, or 10 days.
- The Licence card offers Copy key until you mark the key as saved. When the clipboard refuses a copy, an amber note under the button says so, never a toast.
- On Windows, when a pending payment confirms or is no longer coming while Gerfaut is open, the new notification now takes the place of the pending one in the notification center, fee bumps included, as it already did on Linux. On macOS, both notifications still stay side by side.
- On the Receive page, Next address now goes through at most 200 unused addresses past the next one, skips any address another app already received a payment on, and stops on the last one with a line that explains why. A descriptor without a wildcard shows its single address, with nothing to skip to. The gap limit warning now counts the unused addresses since the last used one, instead of how many times you pressed Next address.
- When the outputs of a transaction pay more than its inputs bring in, the Broadcast confirmation now says there is no fee instead of calling it unknown.
- Premium requests now go through Tor as soon as the backend of any network is an onion address, and no longer only when the backend of the network on screen is one. The message shown when Tor is out of reach says so, and so does the note about the update check in Settings › About.

### Fixed

- The Overview no longer opens scrolled down after you leave a long Settings page, which could push the red banner about a device waiting for approval out of view. Every page now opens at its top.
- If you type a server address with its port in the host field, Save now tells you to put the port in its own field. Any other address the backend settings refuse is explained under the Save button. Before, Gerfaut could say "Saved. The server did not answer" while nothing had been saved.
- When the Telegram link cannot carry the link code, the channel now shows the /start message to send the bot by hand, with a Copy button. In that case the link only opens the bot.
- Restoring a backup that holds a private key, or a descriptor Gerfaut cannot watch, now says so, and says that nothing was restored.
- When the system's credential store answers that it holds no vault key while a vault is already on disk, Gerfaut no longer stores a new key, which could never open that vault. The startup screen says the key is missing, and Try again reads the store again.

### Security

- Gerfaut now opens only the addresses it links to: the block explorer, its releases page, the Premium page, the Telegram alerts bot and the ntfy topic. Before, the window could ask the system to open any web address.
- When you pick a file to add a wallet or broadcast a transaction, Gerfaut now refuses it before reading it if it is far too large to be one, so the window no longer stalls on it.
- While Gerfaut is locked, it no longer opens a file dialog to save or open a backup.
- A QR code that announces billions of parts no longer closes the app. A sync that reports a transaction worth more than 21 million bitcoin is refused, like a failed server.
- An Electrum address whose host still contains a port is refused, so an onion name can no longer reach the system resolver in the clear.
- The Broadcast preview checks each previous transaction it fetches against its txid, flags a time lock only when an input's sequence enables it, and adds up amounts with overflow checks.
- The Premium client follows no redirect and reads at most 2 MiB of an answer.

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

### Getting told when something moves

- Live alerts, off until you turn them on in Settings › Notifications. Gerfaut then keeps one connection open to your backend and posts a system notification when a transaction reaches the mempool, incoming or outgoing, and again when it confirms. An Electrum server pushes the change, so the notification arrives within seconds. An Esplora backend is checked once a minute, a few addresses at a time, unless it is a mempool instance, which pushes changes for the addresses it agrees to follow.
- The watch runs for as long as Gerfaut is open, minimised and locked included, and the pages update at the same moment. A notification names the wallet and the amount, in the display unit, and leaves the amount out while balances are masked. While Gerfaut is locked, a notification names no wallet and no amount: it only says that a transaction appeared, confirmed or is no longer coming, and whether it is outgoing. What the system already showed stays in its notification center after Gerfaut locks.
- A transaction is announced once when it appears and once when it confirms, whether the live watch or a sync you asked for saw it first, and across restarts. A fee bump on a payment already announced is not announced again. Past three transactions in one wallet at once, the rest are counted in a single line, and transaction notifications stop at 20 a minute, the last one saying more are coming in.
- On Linux, when a pending payment confirms or is no longer coming while Gerfaut is still open, the new notification replaces the pending one, fee bumps included. On Windows and macOS, both stay side by side in the notification center.
- When a pending payment you were told about leaves the mempool and nothing pays you instead, Gerfaut says so: "A pending payment of 0.00150000 BTC is no longer coming". Masked or locked, the amount is left out. This notification is never folded into the count of other transactions.
- Settings › Notifications shows where the watch stands, such as "Connected · Electrum · host" or "Polling every minute · host", and what the open connection tells the server: what a sync already tells it, and also how long Gerfaut stays connected. With the Automatic backend, Gerfaut first tries an Electrum server run by one of the public operators already in the rotation, because Electrum is what pushes changes. A "Send a test notification" button sits below, because it is the only reliable way to know whether the system shows them.
- A Premium section in Settings, for the alert service at gerfaut-wallet.com. Enter an account key, and the licence is verified offline from the certificate the vault holds: the app shows whether it is active with no network at all, and never waits on the server to say so. Premium controls have a colour of their own, so what belongs to the paid service reads as such at a glance.
- Choose which wallets the server watches, a single address included. Each one is agreed to explicitly, and the question lists what leaves the device: the descriptor, or the address, and the name you gave the wallet. The first scan is shown as pending until the server has done it, and a wallet removed from the app is unregistered from the server, at the next heartbeat if the server is out of reach at the time. Wallets the server still watches for this account but this device no longer holds are listed, so they can be unregistered too.
- A wallet the server refuses to watch says why, in the server's own sentence, under its row in Watched wallets and in Recent alerts. When the server asks you to wait, the note says so, with the delay when the server gives one.
- The switch that takes a wallet off the server asks first, and so does removing a wallet the server watches: the server deletes the wallet's alert history along with it, and the confirmation says so.
- Four kinds of channel: ntfy, Telegram, e-mail and webhook. An e-mail address receives nothing until its owner types back the six-digit code it was sent. A Telegram row names the chat it is linked to. A channel the server turned off is shown as not delivering, with the reason, and a test is only offered on a channel the server would deliver to.
- The recent alerts, and a banner on the overview when the watch has gone offline.
- Renewing opens the site with the key on the clipboard, never in the address bar.
- Forget the key on this device, or delete the account on the server. The confirmation says everything that goes, the paid time included, and the button that cannot be undone is the red one.
- A call that fails leaves a note under its card in the server's own words, never a toast. When the chain backend goes through Tor, these calls do too, and a Tor that cannot be reached is named as such.

### Keeping it yours

- The wallet list is stored encrypted. Its key lives in the operating system credential store, the Windows Credential Manager, the macOS Keychain or the Secret Service on Linux.
- Lock the app with a PIN or a password. While it is locked the vault answers nothing but what the lock screen needs: every other command that reaches it is refused on the Rust side, and the webview holds no descriptor, no balance and no account key until a secret goes through. Behind the lock the app reads only the theme, whether the welcome tour has been seen, the network and the kind of secret to ask for, so unlocking lands on the same vault it left, on the same network.
- Export every wallet you watch into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on another machine or on the phone. It holds descriptors and addresses, never a private key or seed. The file can be copied and guessed offline, and the app says so where the password is chosen.
- Restoring a backup that carries node settings shows what applying them would put in place: the server every wallet of a network would then talk to, and the certificates it would pin. A backup written by a newer Gerfaut is refused by name, not mistaken for a wrong password.
- Fiat value beside the balance, in the currency you pick, from CoinGecko, Kraken or mempool.space. Amounts in BTC or in sats. No price source is asked anything until fiat value is turned on.
- Light and dark themes.
- A check for a newer version, from a button in Settings › About and on its own at most once a day while Gerfaut is unlocked. It asks GitHub for the latest release of this repository, with no identifier attached. When one of your backends is an onion address, the request goes through Tor, the button included, and when Tor is not available nothing is sent and Settings › About says so. Otherwise GitHub sees your IP address, as it would for any page you open on it. A switch in Settings › About turns the automatic check off.
- When a newer Gerfaut is out, a strip above the page says so, such as "Gerfaut 0.2.0 is available". Its button opens Settings › About, where the download is, and "Later" closes it for that version. It takes no focus, covers nothing on the page and never appears on the lock screen. The download button always opens the releases page of this repository, whatever address the answer carried.

### Verifying a download

Every release carries a `SHA256SUMS` manifest signed with minisign. The key and the two commands are in [README.md](README.md). The workflow that builds a release pins every action and packaging tool by hash and holds no token that could write to the repository.

[0.1.0]: https://github.com/gerfaut-wallet/gerfaut-desktop/releases/tag/v0.1.0
