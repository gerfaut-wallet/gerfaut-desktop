# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Dialogs, select lists, switches and choice rows now use Radix primitives. In a select list, typing the first letters of an option jumps to it, and the list opens above its field when there is no room below. While a dialog is open, screen readers no longer reach the rest of the window.
- Help lines that repeated a label or a title are gone from Settings, Receive, Broadcast, Export and Transactions.
- Every page has the same header. The title lines up with the left edge of the cards and sits at the same height from one page to the next.
- The tables of the Receive page show each address in full when the column has room, and cut it in the middle when it does not.
- In Settings, card titles are larger, a row keeps the same height with or without a help line, and help lines wrap at a reading width. The Export page uses the same rows.
- Checkboxes and radio buttons are drawn in the colors of the app, in the light theme and in the dark one. In a high contrast mode, the system draws them.
- The Overview keeps its two columns down to the smallest window. It used to stack its cards in one column under 1024 pixels, with the balance history below the fold.
- In Settings › Wallets, the name of a wallet takes the room the row has. "Move up" and "Move down" no longer hold 88 pixels of it while they are hidden.
- A policy that could not be loaded shows the error with a "Try again" button.
- In "Add a wallet", an input that is refused is marked with an icon, as on the Broadcast page.

### Fixed

- During the first sync of a wallet, the Overview says "Syncing…" and shows a dash in place of the balance and of the counts. It used to show a balance of zero, "Not synced yet.", "Last sync never" and "No transactions yet". The dash also shows beside the title of Transactions and UTXOs, and under the name of the wallet in the sidebar. The two lists say "Syncing…" as well, where they said "No transactions yet" and "No unspent outputs".
- In the dark theme, a radio button that was not selected showed as a dark disc with no ring in Settings › Network, and the "Received" arrow had lost its square background.
- At the smallest window width, the tabs of Settings wrap onto a second line. "Backup & sync" used to be cut at the edge and "About" was out of sight.
- With no wallet, the sidebar no longer marks "Overview" as the current page.
- The "Next" button of the welcome tour stays where it is from one page to the next.
- Closing the QR scanner while the system still asks for camera access no longer leaves the camera on once access is granted.
- A scan that stops on a code with too many parts no longer leaves the aiming frame over a frozen picture.
- On the Broadcast page, when a status check fails after an earlier answer, the card now reads "Could not check" and shows the error, then the last answer with its time. It used to keep the earlier badge, such as "Confirmed", next to the error. A check that fails before any answer now shows "Could not check" too, and the card keeps it while the backend is asked again.
- A transaction sent just before "Start over" or a network change no longer brings its status card back on top of the next transaction. The transaction still goes out and is listed under "Past broadcasts".
- A file opened on the Broadcast page is no longer previewed when the network changes while it is still being read.
- A wallet's pages no longer say "Syncing…" while another wallet syncs. A sync the live watch starts now shows as syncing on its wallet's pages too.
- A wallet whose last sync failed still says so after a restart, instead of showing its last good sync until the next attempt.

## [0.1.0] - 2026-10-21

The first release: Gerfaut for Linux, macOS and Windows, as a public beta.

Gerfaut watches bitcoin wallets it cannot spend from. There is no key generation, no seed handling and no signing anywhere in the code, and no Send button in the interface.

### Added

#### Watching a wallet

- Add a wallet from an output descriptor, an extended public key, a single address, a BSMS record or another wallet's export file. Paste it, open the file, or scan its QR code with the camera, including the animated ones a signing device shows. A long animated code reads as fast at its last frame as at its first.
- Before it stores anything, Gerfaut says what it recognized, with the script type, the first address and the network. When the input leaves the script type or the derivation open, you pick them on the same screen. Anything that holds a private key or a seed phrase is refused.
- Watch several wallets on mainnet, signet, testnet4 or regtest. Rename them, give them an icon, and drag them into the order you want.
- For each wallet: the balance, the transaction history, the detail of each transaction with its inputs and outputs, and the UTXOs in a table of their own.
- The Receive page shows the next unused address. "Next address" skips any address a payment already reached and stops 200 unused addresses ahead, and the gap limit warning counts the unused addresses since the last used one.
- Every wallet gets a Policy page: each spending path, primary paths first, the keys that can take it, and the time left on the paths that wait for a timelock. A path open now shows in green, and one that opens within 30 days in amber. Its Descriptor section shows and copies the whole wallet as one multipath descriptor, with `/<0;1>/*`.
- Export the history of a wallet as CSV, over a date range typed as `YYYY-MM-DD` and read as whole days in UTC.

#### Broadcasting a signed transaction

- Broadcast a transaction someone else signed: paste its hex, open the file a signing device wrote, or scan its QR code. The preview shows what the transaction does before anything goes out, and Gerfaut follows it until it confirms.
- The preview flags what needs checking. A missing signature reads "Not fully signed" and keeps the "Broadcast" button off; so does a transaction the network is sure to refuse, which reads "Will be refused". A coin no backend could confirm is marked in amber, and when its amount is only what the PSBT declares, the fee and the input total read "as the PSBT claims".
- A signature made with SIGHASH_NONE or SIGHASH_SINGLE gets a red warning, repeated in the confirmation dialog: whoever relays such a transaction before it confirms can send some or all of the money elsewhere.
- On a PSBT still missing signatures, the fee rate reads "≈ … once signed", the rate it pays once your signing device has signed it. A transaction already waiting in the mempool reads "Already in the mempool" and can go out again, which does no harm.

#### Talking to the chain

- Public servers by default, with no setup: "Automatic" tries every public Esplora instance in turn, or you pick one public Esplora or Electrum server by name. You can also connect your own node, over Esplora or Electrum.
- An Electrum server with a self-signed certificate shows its fingerprint, subject and expiry date. Gerfaut trusts it only once you accept it, and refuses any other certificate from that server afterwards.
- A `.onion` backend goes through Tor. Gerfaut uses the Tor already running on the computer when there is one, and starts its own built-in client, arti, otherwise. The first connection can take up to a minute and a half while it bootstraps. When a `.onion` server stays silent for 30 seconds, the built-in Tor opens a second route to it alongside the first one, and Gerfaut uses whichever answers.
- Gerfaut syncs when it opens and when you ask, and a rescan is a separate action. A sync downloads only what a wallet lacks, so a payment that Live notices costs a few kilobytes. Gerfaut reads a wallet in full when the vault opens and once a day. Past the last used address, a sync asks the server about as many unused addresses as the gap limit, and no more.
- A "This is my node" switch under the address of your own server, in Settings › Network. Turned on, it lets Live follow up to 20,000 addresses, against 2,000 otherwise. Leave it off for a server you do not run: it would refuse most of them and learn every one.
- With Live on and the Automatic backend, syncs, transaction previews and broadcasts go first to the operator Live talks to, Blockstream on mainnet, so a single operator sees your addresses. When Gerfaut opens, the first sync waits up to 20 seconds for Live to connect.
- A preview or a broadcast moves to another server only when one cannot be reached. When a node refuses a transaction, Gerfaut asks no other and shows the node's own words.
- A server that is down while another one answers goes to the end of the list for 5 minutes, then twice as long each time it fails again, up to an hour. When the server Live talks to sees no new block for 2 hours, Gerfaut compares it with another server of the same operator, and Live moves there if it lags 2 blocks or more.

#### Getting told when something moves

- Live alerts, off until you turn on "New transactions" in Settings › Notifications. Gerfaut then keeps one connection open to your backend and posts a system notification when a transaction reaches the mempool, incoming or outgoing, and again when it confirms.
- An Electrum server pushes changes within seconds, and a mempool instance pushes them for the addresses it agrees to follow. Gerfaut checks any other Esplora server once a minute, a few addresses at a time, and goes through every address in turn.
- Live runs for as long as Gerfaut is open, minimised and locked included, and the pages update at the same moment. A notification uses the same words as on Android: it names the wallet and the amount, and leaves the amount out while amounts are hidden. While Gerfaut is locked, it names no wallet and no amount.
- Each transaction is announced once when it appears and once when it confirms, across restarts, whether Live or a sync saw it first. A fee bump brings no new notification. Past 3 transactions in one wallet at once, one line counts the rest, and notifications stop at 20 a minute.
- On Linux and Windows, when a pending payment confirms or is no longer coming while Gerfaut is still open, the new notification replaces the pending one. On macOS, both stay side by side in the notification center.
- When an incoming payment leaves the mempool and nothing pays you in its place, Gerfaut says so: "A pending payment of 0.00150000 BTC is no longer coming".
- Settings › Notifications shows where Live stands, such as "Connected · Electrum · host" or "Polling every minute · host", and what the open connection tells the server. A "Send a test notification" button checks that the system shows them.
- When Live cannot follow every address, Settings › Notifications says how many addresses of how many wallets wait for the next sync, and how to lift the limit. Each wallet shows "Live", "Partly live" or "At next sync" in Settings › Wallets and on its Overview, and "Always watch live first", under Settings › Wallets › Advanced, picks the wallets Live follows first.
- When a server takes only part of your addresses, Live asks it again for all of them a day later, or an hour later when it took none. On your own node, when the server itself refuses addresses, the note names the server setting that lets it follow more.

#### Keeping it yours

- Export every wallet into a backup sealed with a password of your own, as a file or as an animated QR code. The same backup restores on Android or on another computer. It holds descriptors and addresses, never a private key, and the page where you pick the password warns that a copied file can be guessed offline.
- A backup can also carry your backend choice, accepted certificates and gap limit. Restoring one shows what it will put in place before anything changes, and never replaces a certificate you already accepted. A wallet whose keys belong to another network says which one. A wrong password, a file that is not a Gerfaut backup and a backup written by a newer Gerfaut each get their own sentence, so Gerfaut never blames a password that was right. A wallet Gerfaut cannot watch stays on the restore list, unticked, with the reason, and the confirmation names it once the others are restored.
- Fiat value beside the balance, in the currency you pick, from mempool.space, the default, or CoinGecko. With CoinGecko, "Powered by CoinGecko" shows once on each screen that uses its prices. No price source hears from Gerfaut until you turn "Fiat value" on. A wallet on signet, testnet4 or regtest shows 0 in your currency, since test coins are worth nothing.
- Amounts in BTC or in sats, and a light, dark or system theme.
- A check for a newer version, from a button in Settings › About and on its own at most once a day while Gerfaut is unlocked, the first time a day after Gerfaut first opened. It asks GitHub for the latest release, with no identifier attached, and never announces a pre-release. When a newer one is out, a strip above the page says so, and a switch in Settings › About turns the automatic check off.
- Settings › About marks a 0.x version as a beta and has a "Report a problem" button that opens the issues of this repository. The first page of the welcome tour says that Gerfaut is in public beta.
- Opening Gerfaut while it already runs brings its window to the front. When the vault cannot open at startup, the window says why and offers "Try again", and two copies of Gerfaut never open the same vault.
- The arrow keys move through choice groups, Enter submits the app lock dialogs, and screen readers announce form errors.

### Security

- The wallet list is stored encrypted, under a key that the operating system's credential store keeps: the Secret Service on Linux, the macOS Keychain or the Windows Credential Manager.
- A server cannot make up a confirmation. Gerfaut checks that the transaction is in the block the server names and, on mainnet, that the block carries the work the network asked for. Over Electrum, a confirmation in an older block must also link to the checkpoints built into Gerfaut. When no other server answers in place of one whose proof does not hold, the sync says that a server sent a false proof, whether you started it, it covered every wallet or Live started it. Over Esplora, a confirmation from before March 2014 must also link to the checkpoints, and every block height a server gives must carry the work of its block. A server cannot take a confirmation away either: to replace a block that holds one, it must send the headers of its new chain, each linked to the one before and, on mainnet, carrying the work of its height.
- Lock Gerfaut with a PIN or a password. While it is locked, the vault refuses every command the lock screen does not need, the window holds no descriptor and no balance, and Gerfaut opens no file dialog.
- When one of your backends is a `.onion` address, the price and the update check go through Tor too, and Gerfaut sends neither when Tor is out of reach. The automatic check never starts Tor for itself. It uses the Tor already running on the computer, or the one a sync or Live started, and when there is none, the day does not count and it asks again at the next unlock or within the hour. An Electrum host that hides a port is refused, so an onion name never reaches the system resolver.
- The built-in Tor client is arti 2.7.0, with its security fixes. A relay can no longer fill memory through half-closed streams, and a directory mirror can no longer do it through the consensus it sends, or stall Tor by holding back its answer.
- Copying a descriptor keeps it out of the clipboard managers that honour its flag on Linux and macOS, and out of the clipboard history and the cloud clipboard on Windows. Gerfaut clears it from the clipboard after a minute, unless you copied something else since. When it cannot, the toast says so and asks you to clear the clipboard yourself.
- The window calls only Gerfaut's own commands, never shows a page other than Gerfaut's own, and opens only the addresses Gerfaut links to: the block explorer, the releases page and the issues page.
- Gerfaut refuses, before reading it, a file far too large to be a wallet or a transaction. It also refuses an animated QR code that announces more than 5,000 parts, and a sync that reports a transaction worth more than 21 million bitcoin.
- The Broadcast preview checks each previous transaction it fetches against its txid, adds up amounts with overflow checks, and flags a time lock only when an input's sequence enables it.
- On macOS, a second launch finds the first one through a socket in your own temporary folder, not in the `/tmp` folder that every account on the Mac shares.
- Every release carries a `SHA256SUMS` manifest signed with minisign, and [README.md](README.md) gives the key and the commands to check it. The workflow that builds a release pins every action and packaging tool by hash, and every job runs with a read-only token except the last one, which only drafts the release.
