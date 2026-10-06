# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The first release: Gerfaut for Windows, macOS and Linux.

Gerfaut watches Bitcoin wallets it cannot spend from. There is no key generation, no seed handling and no signing anywhere in the code, and no Send button in the interface.

### Added

- Add a wallet from an output descriptor, an extended public key or a single address. Paste it, scan a QR code with the camera, including the animated ones a signing device shows, or open a file.
- Gerfaut says what it recognized, which script type and which derivation it will use, and waits for you to confirm before it stores anything. Anything that carries private material is refused outright.
- Watch several wallets at once. Rename them, give them an icon, reorder the list.
- Balance, transaction history, transaction detail with its inputs and outputs, unspent outputs in a table of their own, and the next receive addresses.
- A wallet whose descriptor holds a Miniscript policy gets a page for it: every spending path, who can take it, and the countdown left on the ones that wait for a timelock.
- Export the history of a wallet as CSV.
- Broadcast a transaction someone else signed. Paste its hex, open the file a signing device wrote, or scan its QR code. Gerfaut shows what the transaction does before it sends anything. When a signature is still missing, the preview says "Not fully signed" and the Broadcast button stays off.
- When no backend confirms a coin a PSBT spends, the preview says so in amber and marks the fee and the input total as what the PSBT claims: check them on a backend you trust, or on the signing device, before you send.
- Mainnet, signet, testnet4 and regtest.
- Public Esplora servers by default, or your own node over Esplora or Electrum.
- An Electrum server with a self-signed certificate is shown to you, fingerprint, subject and expiry, and trusted only once you say so.
- A `.onion` backend goes through Tor. Gerfaut uses the Tor already running on the machine when there is one and starts its own otherwise, so reaching a hidden service needs no second install. The built-in client is arti; the first connection takes up to a minute and a half while it bootstraps.
- Sync when the app opens and on demand. A rescan is a separate, explicit action.
- Live alerts, off until you turn them on in Settings › Notifications. Gerfaut then keeps one connection open to your backend and posts a system notification when a transaction reaches the mempool, incoming or outgoing, and again when it confirms. An Electrum server pushes the change, so the notification arrives within seconds. An Esplora backend is checked once a minute, a few addresses at a time, unless it is a mempool instance, which pushes changes for the addresses it agrees to follow.
- The watch runs for as long as Gerfaut is open, minimised and locked included, and the pages update at the same moment. A notification names the wallet and the amount, in the display unit, and leaves the amount out while balances are masked. While Gerfaut is locked, a notification names no wallet and no amount: it only says that a transaction appeared, confirmed or is no longer coming, and whether it is outgoing. What the system already showed stays in its notification center after Gerfaut locks.
- A transaction is announced once when it appears and once when it confirms, whether the live watch or a sync you asked for saw it first, and across restarts. A fee bump on a payment already announced is not announced again. Past three transactions in one wallet at once, the rest are counted in a single line, and transaction notifications stop at 20 a minute, the last one saying more are coming in.
- On Linux and Windows, when a pending payment confirms or is no longer coming while Gerfaut is still open, the new notification replaces the pending one, fee bumps included. On macOS, both stay side by side in the notification center.
- When a pending payment you were told about leaves the mempool and nothing pays you instead, Gerfaut says so: "A pending payment of 0.00150000 BTC is no longer coming". Masked or locked, the amount is left out. This notification is never folded into the count of other transactions.
- Settings › Notifications shows where the watch stands, such as "Connected · Electrum · host" or "Polling every minute · host", and what the open connection tells the server: what a sync already tells it, and also how long Gerfaut stays connected. With the Automatic backend, Gerfaut first tries an Electrum server run by one of the public operators already in the rotation, because Electrum is what pushes changes. A "Send a test notification" button sits below, because it is the only reliable way to know whether the system shows them.
- The wallet list is stored encrypted. Its key lives in the operating system credential store, the Windows Credential Manager, the macOS Keychain or the Secret Service on Linux.
- Lock the app with a PIN or a password. While it is locked the vault answers nothing but what the lock screen needs: every other command that reaches it is refused on the Rust side, and the webview holds no descriptor and no balance until a secret goes through. Behind the lock the app reads only the theme, whether the welcome tour has been seen, the network and the kind of secret to ask for, so unlocking lands on the same vault it left, on the same network.
- Export every wallet you watch into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on another machine or on the phone. It holds descriptors and addresses, never a private key or seed. The file can be copied and guessed offline, and the app says so where the password is chosen.
- Restoring a backup that carries node settings shows what applying them would put in place: the server every wallet of a network would then talk to, and the certificates it would pin. A backup written by a newer Gerfaut is refused by name, not mistaken for a wrong password.
- Fiat value beside the balance, in the currency you pick, from CoinGecko, Kraken or mempool.space. Amounts in BTC or in sats. No price source is asked anything until fiat value is turned on.
- Light and dark themes.
- A check for a newer version, from a button in Settings › About and on its own at most once a day while Gerfaut is unlocked. It asks GitHub for the latest release of this repository, with no identifier attached. When one of your backends is an onion address, the request goes through Tor, the button included, and when Tor is not available nothing is sent and Settings › About says so. Otherwise GitHub sees your IP address, as it would for any page you open on it. A switch in Settings › About turns the automatic check off.
- When a newer Gerfaut is out, a strip above the page says so, such as "Gerfaut 0.2.0 is available". Its button opens Settings › About, where the download is, and "Later" closes it for that version. It takes no focus, covers nothing on the page and never appears on the lock screen. The download button always opens the releases page of this repository, whatever address the answer carried.
- Settings › About marks a 0.x version as a beta and has a "Report a problem" button that opens the issues of this repository. The first page of the welcome tour says that Gerfaut is in public beta.
- Opening Gerfaut while it is already running now brings the open window to the front instead of starting a second copy.
- When the vault cannot be opened at startup, the window now says why and offers a Try again button. Before, the app closed without a word. This covers a vault that another copy of Gerfaut holds, for example a second installation that uses the same data folder: two copies can no longer open the same vault and save over each other's changes.
- The Broadcast preview now warns in red when an input is signed with SIGHASH_NONE or SIGHASH_SINGLE. Such a signature does not fix where all of the money goes, so anyone who relays the transaction before it is mined can send some or all of it somewhere else. The confirmation dialog repeats the warning.
- A "This is my node" switch under the address of your own Electrum or Esplora server, in Settings › Network. When it is on, Live follows up to 20 000 addresses instead of 2 000. Leave it off for a server you do not run: it would refuse most of them, and learn every one. Saving the server address again keeps the switch as it was.
- When Live cannot follow every address, Settings › Notifications says how many addresses of how many wallets wait for the next sync, and how to lift the limit. Each wallet then shows "Live", "Partly live" or "At next sync" in Settings › Wallets and on its Overview. On your own node, if the server itself refuses addresses, the note names the server setting that lets it follow more.
- Settings › Wallets › Advanced › "Always watch live first" picks the wallets Live follows before the others when it cannot follow every address.
- When a screen fails to render, the window says so and offers Reload, instead of going blank.
- The first screen of an empty vault and the first page of the welcome tour show the full Gerfaut logo, the falcon over its name.
- Every release carries a `SHA256SUMS` manifest signed with minisign. The key and the two commands are in [README.md](README.md). The workflow that builds a release pins every action and packaging tool by hash. Every job runs with a read-only token, except the last one, which only drafts the release from the files the others built.

### Changed

- Syncs use far less data. Gerfaut now downloads only what a wallet does not have yet, and a payment that Live notices costs a few kilobytes instead of the wallet's whole history. A wallet is still read in full when the vault opens and once a day.
- On the Receive page, Next address now goes through at most 200 unused addresses past the next one, skips any address another app already received a payment on, and stops on the last one with a line that explains why. A descriptor without a wildcard shows its single address, with nothing to skip to. The gap limit warning now counts the unused addresses since the last used one, instead of how many times you pressed Next address.
- When the outputs of a transaction pay more than its inputs bring in, the Broadcast confirmation now says there is no fee instead of calling it unknown.
- Export: you now type the date range as YYYY-MM-DD, and Gerfaut reads it as whole days in UTC, the days of the file's date_utc column, as the page now says. When it cannot read a day, it says so under the fields and exports nothing. The subtitle now adds that everything stays on this machine.
- In every choice group (unit, price source, theme, Tor, export direction), the chosen option is now filled in the accent colour.
- The hints under New transactions, Check for updates automatically and Currency are shorter.
- Fiat values now group their thousands with a space, like amounts in BTC and sats: €74 074.07 instead of €74,074.07.
- With fiat value on, a wallet on signet, testnet4 or regtest now shows 0 in your currency, such as €0.00. Before, its coins were valued at the price of real bitcoin, but test coins are worth nothing.
- When every wallet is on the network shown, the backup export says "All wallets (N)" instead of offering a choice of one.
- In Add a wallet, an input that fits a single network, such as a mainnet address, names that network instead of offering a choice of one.
- On the Policy page, a coin that cannot be counted down before the first sync says "next known after the first sync" instead of "next in an unknown time".

### Fixed

- The Overview no longer opens scrolled down after you leave a long Settings page. Every page now opens at its top.
- If you type a server address with its port in the host field, Save now tells you to put the port in its own field. Any other address the backend settings refuse is explained under the Save button. Before, Gerfaut could say "Saved. The server did not answer" while nothing had been saved.
- Restoring a backup that holds a private key, or a descriptor Gerfaut cannot watch, now says so, and says that nothing was restored.
- If the system's key store says it has no vault key while a vault is already on disk, Gerfaut no longer creates a new key that could never open it. The startup screen says the key is missing, and Try again asks the store again.
- Restoring a backup whose wallets are all on another network left them out of sight until a restart, and the restored settings did not show either. The workspace now moves to the wallets' network, and everything shows at once.
- With "Hide amounts" on, unlocking could show the balances for an instant.
- When the price source stops answering, amounts now show without their fiat value and the Bitcoin price card says the source did not answer, as Settings already did. Before, both kept the last price they had, however old.
- When the vault refused to save the network, a trusted certificate, the gap limit, a wallet's name or icon, or transaction notifications, on a full disk or while an antivirus held the file, the setting looked saved anyway. It now goes back to what the vault holds, with the reason under it. If this happens when you turn on transaction notifications, the switch stays off.
- A link that nothing on the computer can open now says so and shows the address to copy.
- A wallet page that could not be loaded now says why, with a Try again button. A list of UTXOs that failed to load no longer reads as an empty one.
- In Add a wallet, Back keeps what you pasted. A wallet added on another network closes the dialog even when switching to that network fails, and the confirmation names the network.
- The System theme now follows the system when it switches between light and dark.
- Scanning a long animated QR code no longer makes the window stutter.
- The network badge in the sidebar was hard to read. It now uses the colours of the dark sidebar.
- In Settings › Wallets, wallet names could shrink to nothing in a narrow window. A row now puts its actions under the name when both do not fit.
- The UTXO and transaction lists no longer stretch to the bottom of the window when they are short.
- Placeholders in text fields were lighter than any other text. They now have the same contrast as secondary text.
- The arrow keys now move through choice groups, Enter submits the app lock dialogs, and form errors are announced to screen readers.
- Settings › Network no longer says that Electrum servers cannot watch a single address.
- Policy › Descriptor showed and copied only the receive branch of a wallet, so a descriptor copied from there would watch the wallet without its change. It now shows the whole wallet as one multipath descriptor, with /<0;1>/*.
- In Add a wallet, the script type hints now give the address prefixes of the wallet's network, such as tb1q on signet and testnet4, instead of the mainnet ones.
- In Add a wallet, a Taproot address no longer leaves a single character on a line of its own.
- On the Broadcast page, the input and output lists now use the same icons as the diagram above them: an output to someone else points away, and change points back.
- The Tor mode you pick now shows as selected at once, instead of about a second later. Turning on New transactions shows "Connecting…" while the live watch starts, instead of "Off".
- With New transactions on and no wallet on the selected network, Settings › Notifications now says "Off until you add a wallet." instead of "Off".
- When the server itself refuses addresses, Settings › Notifications now says so, instead of blaming the live watch's own limits.
- When a server takes only a certain number of your addresses, Live now asks it again for all of them a day later, or an hour later when it took none. Before, it waited until you changed the server settings or restarted Gerfaut, so a server that took no address could leave Live off for days. Two refusals still hold until you change the server settings or restart Gerfaut: a single address the server turns down, such as one with a history too long for it, and a cut from an ElectrumX server when Live uses too much of its resources. After such a cut, Live asks for fewer addresses, since asking for all of them would only get it cut off again.
- In Add a wallet, the first address now belongs to the network you pick, and changes when you pick another one. A key added on regtest shows its bcrt1 address, not the tb1 address of signet.
- In Add a wallet, a QR code that gives no receive or change path now says that Gerfaut assumes the usual 0/* and 1/*, and asks you to compare the first address with your signer.
- The certificate list and the dialog that forgets a certificate now say that syncs with that server fail until you press Save backend again and accept it. They used to say that Gerfaut would ask again at the next connection, which it does not. When the server does not answer at Save backend, the note now says the same of a server that signs its own certificate.
- On an Esplora backend, Live now checks every address in turn. It used to start over at the top of the list each time it reconnected, every half hour, so it never reached the addresses further down, and a payment to one of them waited for the next sync.

### Security

- Gerfaut now opens only the addresses it links to: the block explorer and its releases page. Before, the window could ask the system to open any web address.
- When you pick a file to add a wallet or broadcast a transaction, Gerfaut now refuses it before reading it if it is far too large to be one, so the window no longer stalls on it.
- While Gerfaut is locked, it no longer opens a file dialog to save or open a backup.
- A QR code that announces billions of parts no longer closes the app. A sync that reports a transaction worth more than 21 million bitcoin is refused, like a failed server.
- An Electrum address whose host still contains a port is refused, so an onion name can no longer reach the system resolver in the clear.
- The Broadcast preview checks each previous transaction it fetches against its txid, flags a time lock only when an input's sequence enables it, and adds up amounts with overflow checks.
- Copying a descriptor now keeps it out of the clipboard history and the cloud clipboard on Windows, and out of clipboard managers that honour the same flag on macOS and Linux. Gerfaut also clears it from the clipboard after a minute, unless you have copied something else since. The confirmation says "for 1 minute".
- The window can no longer call Tauri's window, webview, menu, tray and path commands, or emit events. It listens to the events Gerfaut sends, opens its short list of addresses, and calls Gerfaut's own commands.
- On macOS, a second launch now finds the first one through a socket in your own temporary folder, instead of the /tmp folder that every account on the Mac shares.
- With fiat value on and an onion backend on any network, the price now goes through Tor too, and is not asked at all while Tor is out of reach. Before, the price source saw this computer's IP address every minute, at the same times as the Tor circuits. The Tor card in Settings › Network now says so, and when Tor is out of reach the price lines say "Tor is not available, so no price was asked."
