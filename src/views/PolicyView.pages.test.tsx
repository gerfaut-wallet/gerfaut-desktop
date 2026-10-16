import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PolicySnapshot } from "../lib/ipc";
import { policyDigest } from "../lib/policy";
import { ABSOLUTE, MULTISIG, RECOVERY_PATHS, RELATIVE, RELATIVE_OPEN } from "../test/corePolicies";
import { PolicyView } from "./PolicyView";

afterEach(() => clearMocks());

/** Where the page reads one line: a heading, a paragraph, a list item. */
const LINES = new Set(["H1", "H2", "P", "LI", "SUMMARY"]);

/** The text of an element, its pieces joined by a space. */
function words(element: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = node.textContent?.trim();
    if (piece) parts.push(piece);
  }
  return parts.join(" ");
}

/** The Policy page of a wallet as it reads, top to bottom, with the
    balance row's digest first: every line of text, a pill with its
    tone and glyph, a bar with how far it has come. The clock time of a
    countdown follows the machine's time zone; only its shape is kept. */
async function readPage(snapshot: PolicySnapshot): Promise<string[]> {
  mockIPC((command) => {
    if (command === "wallet_policy") return snapshot;
    throw new Error(`${command} is not part of this page`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(
    <QueryClientProvider client={client}>
      <PolicyView walletId="w1" />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Keys" });
  const { figure, label } = policyDigest(snapshot);
  const lines = [`Overview: ${figure} ${label}`];
  const walk = (element: Element) => {
    const tone = element.getAttribute("data-tone");
    if (tone !== null) {
      const glyph = element.querySelector("[data-glyph]")?.getAttribute("data-glyph");
      lines.push(`[${tone} ${glyph}] ${words(element)}`);
      return;
    }
    if (element.getAttribute("role") === "progressbar") {
      lines.push(`[bar ${element.getAttribute("aria-valuenow")}%]`);
      return;
    }
    if (LINES.has(element.tagName)) {
      lines.push(words(element).replace(/^≈ \w{3} \d{2}, \d{4}, \d{2}:\d{2}$/, "≈ [date and time]"));
      return;
    }
    for (const child of element.children) walk(child);
  };
  walk(container);
  unmount();
  client.clear();
  return lines;
}

/** Four wallets the core read, the page they make. The same lines
    whatever the core's version or the app's: a change here is a change
    the person sees. */
describe("the Policy page of a wallet the core read", () => {
  it("reads several recovery paths", async () => {
    expect(await readPage(RECOVERY_PATHS)).toEqual([
      "Overview: Recovery in 2 days",
      "Policy",
      "Keys A and B sign. Both recovery keys can spend once a coin has waited about 30 days. An emergency key can spend once a coin has waited about 183 days. Key C signs once a coin has waited about 1 year.",
      "Primary",
      "[confirmed check] Spendable now",
      "Key A and Key B",
      "Key A a1b2c3d4",
      "Key B e5f60718",
      "Recovery",
      "[pending clock] 1 of 3 coins unlocked · next in 2 days · 1 waiting for a block",
      "Key C, Key D and a wait of 4\u00a0320 blocks",
      "Key C 19283746",
      "Key D 0f1e2d3c",
      "4\u00a0320 blocks after the coin arrives ≈ 30 days",
      "Next coin 319 blocks ≈ 2 days",
      "≈ [date and time]",
      "[bar 93%]",
      "Emergency",
      "[neutral clock] 1 of 3 coins unlocked · next in 155 days · 1 waiting for a block",
      "Key D and a wait of 26\u00a0280 blocks",
      "Key D 0f1e2d3c",
      "26\u00a0280 blocks after the coin arrives ≈ 183 days",
      "Next coin 22\u00a0279 blocks ≈ 155 days",
      "≈ [date and time]",
      "[bar 15%]",
      "Recovery 3",
      "[neutral clock] 1 of 3 coins unlocked · next in 337 days · 1 waiting for a block",
      "Key C and a wait of 52\u00a0560 blocks",
      "Key C 19283746",
      "52\u00a0560 blocks after the coin arrives ≈ 1 year",
      "Next coin 48\u00a0559 blocks ≈ 337 days",
      "≈ [date and time]",
      "[bar 8%]",
      "Keys",
      "Key A a1b2c3d4 xpubKeyA…AAAAAA",
      "Key B e5f60718 xpubKeyB…BBBBBB",
      "Key C 19283746 xpubKeyC…CCCCCC",
      "Key D 0f1e2d3c xpubKeyD…DDDDDD",
      "Descriptor",
      "wsh(or_d(multi(2,xpubKeyA/0/*,xpubKeyB/0/*),or_i(and_v(v:pkh(xpubKeyC/0/*),older(52560)),or_i(and_v(v:pkh(xpubKeyD/0/*),older(26280)),and_v(v:multi(2,xpubKeyC/1/*,xpubKeyD/1/*),older(4320))))))",
      "Normalized policy",
      "or(and(pk(Key A),pk(Key B)),and(pk(Key C),older(52560)),and(pk(Key D),older(26280)),and(pk(Key C),pk(Key D),older(4320)))",
    ]);
  });

  it("reads a relative lock while a coin waits", async () => {
    expect(await readPage(RELATIVE)).toEqual([
      "Overview: Recovery in 296 days",
      "Policy",
      "Key A signs. A recovery key can spend once a coin has waited about 1 year.",
      "Primary",
      "[confirmed check] Spendable now",
      "Key A",
      "Key A a1b2c3d4",
      "Recovery",
      "[neutral clock] 1 of 2 coins unlocked · next in 296 days",
      "Key B and a wait of 52\u00a0560 blocks",
      "Key B e5f60718",
      "52\u00a0560 blocks after the coin arrives ≈ 1 year",
      "Next coin 42\u00a0559 blocks ≈ 296 days",
      "≈ [date and time]",
      "[bar 19%]",
      "Keys",
      "Key A a1b2c3d4 xpubKeyA…AAAAAA",
      "Key B e5f60718 xpubKeyB…BBBBBB",
      "Descriptor",
      "wsh(or_d(pk(xpubKeyA/0/*),and_v(v:pkh(xpubKeyB/0/*),older(52560))))",
      "Normalized policy",
      "or(pk(Key A),and(pk(Key B),older(52560)))",
    ]);
  });

  it("reads a relative lock once every coin is past it", async () => {
    expect(await readPage(RELATIVE_OPEN)).toEqual([
      "Overview: Recovery unlocked",
      "Policy",
      "Key A signs. A recovery key can spend once a coin has waited about 1 year.",
      "Primary",
      "[confirmed check] Spendable now",
      "Key A",
      "Key A a1b2c3d4",
      "Recovery",
      "[confirmed check] 2 of 2 coins unlocked",
      "Key B and a wait of 52\u00a0560 blocks",
      "Key B e5f60718",
      "52\u00a0560 blocks after the coin arrives ≈ 1 year",
      "Keys",
      "Key A a1b2c3d4 xpubKeyA…AAAAAA",
      "Key B e5f60718 xpubKeyB…BBBBBB",
      "Descriptor",
      "wsh(or_d(pk(xpubKeyA/0/*),and_v(v:pkh(xpubKeyB/0/*),older(52560))))",
      "Normalized policy",
      "or(pk(Key A),and(pk(Key B),older(52560)))",
    ]);
  });

  it("reads absolute locks, a height and a date", async () => {
    expect(await readPage(ABSOLUTE)).toEqual([
      "Overview: Recovery in 10 days",
      "Policy",
      "Key A signs. A recovery key can spend after block 801\u00a0432, about 10 days from now. An emergency key can spend after Mar 17, 2030, about 4 years 9 months from now.",
      "Primary",
      "[confirmed check] Spendable now",
      "Key A",
      "Key A a1b2c3d4",
      "Recovery",
      "[pending clock] In 1\u00a0432 blocks ≈ 10 days",
      "Key C and block 801\u00a0432 or later",
      "Key C 19283746",
      "Block 801\u00a0432 ≈ in 10 days",
      "≈ [date and time]",
      "Emergency",
      "[neutral clock] In 4 years 9 months",
      "Key B and Mar 17, 2030 or later",
      "Key B e5f60718",
      "After Mar 17, 2030 ≈ in 4 years 9 months",
      "≈ [date and time]",
      "Time locks compare against this device's clock; the chain can lag by up to two hours.",
      "Keys",
      "Key A a1b2c3d4 xpubKeyA…AAAAAA",
      "Key B e5f60718 xpubKeyB…BBBBBB",
      "Key C 19283746 xpubKeyC…CCCCCC",
      "Descriptor",
      "wsh(or_d(pk(xpubKeyA/0/*),or_i(and_v(v:pkh(xpubKeyB/0/*),after(1899979200)),and_v(v:pkh(xpubKeyC/0/*),after(801432)))))",
      "Normalized policy",
      "or(pk(Key A),and(pk(Key B),after(1899979200)),and(pk(Key C),after(801432)))",
    ]);
  });

  it("reads a multisig", async () => {
    expect(await readPage(MULTISIG)).toEqual([
      "Overview: 2 of 3 keys",
      "Policy",
      "2 of 3 keys sign.",
      "Primary",
      "[confirmed check] Spendable now",
      "Any 2 of Key A, Key B, Key C",
      "Key A a1b2c3d4",
      "Key B e5f60718",
      "Key C 19283746",
      "Keys",
      "Key A a1b2c3d4 xpubKeyA…AAAAAA",
      "Key B e5f60718 xpubKeyB…BBBBBB",
      "Key C 19283746 xpubKeyC…CCCCCC",
      "Descriptor",
      "wsh(sortedmulti(2,xpubKeyA/0/*,xpubKeyB/0/*,xpubKeyC/0/*))",
      "Normalized policy",
      "thresh(2,pk(Key A),pk(Key B),pk(Key C))",
    ]);
  });
});
