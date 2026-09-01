import { describe, expect, it } from "vitest";
import type {
  BranchRole,
  BranchState,
  Condition,
  PolicyBranch,
  PolicyKey,
  PolicySnapshot,
  Remaining,
  Timelock,
} from "./ipc";
import {
  branchStatus,
  conditionOutline,
  countdown,
  describePolicy,
  digestText,
  hasTimeBasedLocks,
  orderBranches,
  policyDigest,
  timelockText,
} from "./policy";

const NOW = 1_755_000_000;
const TIP = 200_000;

const KEYS: PolicyKey[] = [
  { id: "k0", label: "Key A", fingerprint: "3442193e", origin_path: null, key_short: "xpubA…aaaa" },
  { id: "k1", label: "Key B", fingerprint: "5c1bd648", origin_path: "m/48'/1'/0'/2'", key_short: "xpubB…bbbb" },
  { id: "k2", label: "Key C", fingerprint: "bd16bee5", origin_path: null, key_short: "xpubC…cccc" },
];

const key = (id: string): Condition => ({ kind: "key", key_id: id });
const older = (blocks: number): Condition => ({ kind: "older", lock: { kind: "blocks", blocks } });
const and = (...items: Condition[]): Condition => ({
  kind: "thresh",
  k: items.length,
  n: items.length,
  items,
});
const thresh = (k: number, ...items: Condition[]): Condition => ({
  kind: "thresh",
  k,
  n: items.length,
  items,
});

function blocksLeft(blocks: number): Remaining {
  return {
    remaining_blocks: blocks,
    remaining_seconds: blocks * 600,
    unlocks_at_unix: NOW + blocks * 600,
  };
}

function relative(blocks: number, state: Timelock["state"], required = true): Timelock {
  return { lock: { kind: "relative", lock: { kind: "blocks", blocks } }, required, state };
}

function branch(
  id: string,
  role: BranchRole,
  label: string,
  condition: Condition,
  state: BranchState,
  timelocks: Timelock[] = [],
): PolicyBranch {
  return {
    id,
    role,
    label,
    summary: label,
    condition,
    timelocks,
    state,
    spendable_now: state.kind === "spendable_now",
  };
}

function snapshot(partial: Partial<PolicySnapshot>): PolicySnapshot {
  return {
    kind: "miniscript",
    script: "witness_script",
    descriptor: "wsh(...)",
    policy: "",
    keys: KEYS,
    branches: [],
    tip_height: TIP,
    computed_at: NOW,
    time_basis: "wall_clock",
    coins: 0,
    has_timelocks: true,
    ...partial,
  };
}

const OPEN: BranchState = { kind: "spendable_now" };

/** `sortedmulti(1, A, B)` as the core hands it over: a multisig split
    into one open branch per key. */
function anyOfTwo(): PolicySnapshot {
  return snapshot({
    kind: "multisig",
    has_timelocks: false,
    keys: KEYS.slice(0, 2),
    branches: [
      branch("b0", "primary", "Primary", key("k0"), OPEN),
      branch("b1", "primary", "Primary B", key("k1"), OPEN),
    ],
  });
}

/** Key A any time, Key B after a year-long wait, three coins counted. */
function liana(state: BranchState): PolicySnapshot {
  return snapshot({
    coins: 3,
    branches: [
      branch("b0", "primary", "Primary", key("k0"), OPEN),
      branch("b1", "recovery", "Recovery", and(key("k1"), older(52_560)), state, [
        relative(52_560, state.kind === "per_coin" ? state : { kind: "no_coins", blocks: 52_560, seconds: null }),
      ]),
    ],
  });
}

describe("describePolicy", () => {
  it("has a sentence for every simple case", () => {
    expect(describePolicy(snapshot({ kind: "address", keys: [] }))).toBe(
      "An address has no policy Gerfaut can read.",
    );
    expect(describePolicy(snapshot({ kind: "single_key" }))).toBe(
      "One key signs. Any coin is spendable now.",
    );
    expect(
      describePolicy(
        snapshot({
          kind: "multisig",
          branches: [branch("b0", "primary", "Primary", thresh(2, key("k0"), key("k1"), key("k2")), OPEN)],
        }),
      ),
    ).toBe("2 of 3 keys sign.");
    expect(
      describePolicy(
        snapshot({
          kind: "multisig",
          branches: [branch("b0", "primary", "Primary", and(key("k0"), key("k1"), key("k2")), OPEN)],
        }),
      ),
    ).toBe("Keys A, B and C sign.");
  });

  it("counts a one of n multisig across the branches the core split it into", () => {
    // `sortedmulti(1, A, B)` is one threshold to the core's kind and two
    // branches to its list, one key each: read together, not as the first.
    expect(describePolicy(anyOfTwo())).toBe("Any of 2 keys signs.");
    expect(digestText(policyDigest(anyOfTwo()))).toBe("1 of 2 keys");
    const locked = snapshot({
      branches: [
        branch(
          "b0",
          "primary",
          "Primary",
          and(thresh(1, key("k0"), key("k1")), older(144)),
          { kind: "no_coins" },
          [relative(144, { kind: "no_coins", blocks: 144, seconds: null })],
        ),
      ],
    });
    expect(describePolicy(locked)).toBe("Any of 2 keys signs once a coin has waited about 1 day.");
  });

  it("reads a recovery path in plain words", () => {
    const state: BranchState = { kind: "per_coin", unlocked: 1, waiting: 0, locked: 2, next: blocksLeft(42_480) };
    expect(describePolicy(liana(state))).toBe(
      "Key A signs. A recovery key can spend once a coin has waited about 1 year.",
    );
  });

  it("names a group of recovery keys by its threshold", () => {
    const wallet = snapshot({
      branches: [
        branch("b0", "primary", "Primary", thresh(2, key("k0"), key("k1"), key("k2")), OPEN),
        branch(
          "b1",
          "emergency",
          "Emergency",
          and(thresh(2, key("k0"), key("k1"), key("k2")), older(4_320)),
          { kind: "no_coins" },
          [relative(4_320, { kind: "no_coins", blocks: 4_320, seconds: null })],
        ),
      ],
    });
    expect(describePolicy(wallet)).toBe(
      "2 of 3 keys sign. Any 2 of 3 emergency keys can spend once a coin has waited about 30 days.",
    );
  });

  it("dates an absolute lock from now, and says when it has passed", () => {
    const height = TIP + 1_432;
    const condition = and(key("k0"), { kind: "after", lock: { kind: "height", height } });
    const ahead = snapshot({
      branches: [
        branch("b0", "primary", "Primary", condition, { kind: "locked", until: blocksLeft(1_432) }, [
          {
            lock: { kind: "absolute", lock: { kind: "height", height } },
            required: true,
            state: { kind: "locked", ...blocksLeft(1_432) },
          },
        ]),
      ],
    });
    expect(describePolicy(ahead)).toBe(
      `Key A signs after block 201${" "}432, about 10 days from now.`,
    );
    const passed = snapshot({
      branches: [
        branch("b0", "primary", "Primary", condition, OPEN, [
          {
            lock: { kind: "absolute", lock: { kind: "height", height } },
            required: true,
            state: { kind: "unlocked" },
          },
        ]),
      ],
    });
    expect(describePolicy(passed)).toBe(
      `Key A signs now that block 201${" "}432 has passed.`,
    );
  });

  it("says a secret is needed without claiming to know it", () => {
    const wallet = snapshot({
      branches: [
        branch("b0", "primary", "Primary", key("k0"), OPEN),
        branch(
          "b1",
          "other",
          "Other",
          and(key("k1"), { kind: "preimage", hash: "sha256" }),
          { kind: "needs_preimage" },
        ),
      ],
    });
    expect(describePolicy(wallet)).toBe(
      "Key A signs. Key B can spend with the secret behind a sha256 hash.",
    );
  });

  it("names a mixed threshold by its members and states a lock once", () => {
    // The optional lock inside the threshold belongs to the subject; a
    // required one outside it is the tail, and it is said only there.
    const mixed = thresh(2, key("k0"), key("k1"), older(100));
    const open = snapshot({
      branches: [
        branch("b0", "primary", "Primary", mixed, OPEN, [
          relative(100, { kind: "no_coins", blocks: 100, seconds: null }, false),
        ]),
      ],
    });
    expect(describePolicy(open)).toBe("Any 2 of Key A, Key B, a wait of 100 blocks can spend.");
    const height = TIP + 1_432;
    const gated = snapshot({
      branches: [
        branch(
          "b0",
          "primary",
          "Primary",
          and(mixed, { kind: "after", lock: { kind: "height", height } }),
          { kind: "locked", until: blocksLeft(1_432) },
          [
            relative(100, { kind: "no_coins", blocks: 100, seconds: null }, false),
            {
              lock: { kind: "absolute", lock: { kind: "height", height } },
              required: true,
              state: { kind: "locked", ...blocksLeft(1_432) },
            },
          ],
        ),
      ],
    });
    expect(describePolicy(gated)).toBe(
      "Any 2 of Key A, Key B, a wait of 100 blocks can spend after block 201 432, about 10 days from now.",
    );
  });

  it("spells out a recovery path no count says right", () => {
    const recovery = (condition: Condition) =>
      snapshot({
        branches: [
          branch("b0", "primary", "Primary", key("k0"), OPEN),
          branch("b1", "recovery", "Recovery", and(condition, older(4_320)), { kind: "no_coins" }, [
            relative(4_320, { kind: "no_coins", blocks: 4_320, seconds: null }),
          ]),
        ],
      });
    expect(describePolicy(recovery(and(key("k0"), thresh(1, key("k1"), key("k2")))))).toBe(
      "Key A signs. Key A and (Key B or Key C) can spend once a coin has waited about 30 days.",
    );
    expect(describePolicy(recovery(thresh(1, key("k1"), key("k2"))))).toBe(
      "Key A signs. Any of 2 recovery keys can spend once a coin has waited about 30 days.",
    );
  });
});

describe("orderBranches", () => {
  it("puts the primary first and the timed paths by lock length", () => {
    const wallet = snapshot({
      branches: [
        branch("b0", "emergency", "Emergency", and(key("k1"), older(52_560)), { kind: "no_coins" }, [
          relative(52_560, { kind: "no_coins", blocks: 52_560, seconds: null }),
        ]),
        branch("b1", "recovery", "Recovery", and(key("k2"), older(4_320)), { kind: "no_coins" }, [
          relative(4_320, { kind: "no_coins", blocks: 4_320, seconds: null }),
        ]),
        branch("b2", "primary", "Primary", key("k0"), OPEN),
      ],
    });
    expect(orderBranches(wallet).map((entry) => entry.label)).toEqual([
      "Primary",
      "Recovery",
      "Emergency",
    ]);
  });
});

describe("conditionOutline", () => {
  it("keeps a flat threshold on one line", () => {
    expect(conditionOutline(thresh(2, key("k0"), key("k1"), key("k2")), KEYS)).toEqual({
      text: "Any 2 of Key A, Key B, Key C",
      items: [],
    });
    expect(conditionOutline(and(key("k1"), older(52_560)), KEYS).text).toMatch(
      /^Key B and a wait of 52.560 blocks$/,
    );
    expect(conditionOutline(thresh(1, key("k0"), key("k1")), KEYS).text).toBe("Key A or Key B");
  });

  it("indents one level and keeps deeper nesting inline", () => {
    const nested = and(thresh(1, key("k0"), key("k1")), older(144), thresh(1, key("k2"), and(key("k0"), key("k1"))));
    expect(conditionOutline(nested, KEYS)).toEqual({
      text: "All of:",
      items: ["Key A or Key B", "A wait of 144 blocks", "Key C or (Key A and Key B)"],
    });
  });
});

describe("timelockText", () => {
  it("states a relative lock in blocks and in time", () => {
    expect(timelockText(relative(52_560, { kind: "no_coins", blocks: 52_560, seconds: null }))).toMatch(
      /^52.560 blocks after the coin arrives ≈ 1 year$/,
    );
    expect(timelockText(relative(144, { kind: "no_coins", blocks: 144, seconds: null }, false))).toBe(
      "144 blocks after the coin arrives ≈ 1 day (optional)",
    );
  });

  it("states an absolute lock with what is left, or that it is behind", () => {
    const height = TIP + 1_432;
    const lock = { kind: "absolute", lock: { kind: "height", height } } as const;
    expect(
      timelockText({ lock, required: true, state: { kind: "locked", ...blocksLeft(1_432) } }),
    ).toMatch(/^Block 201.432 ≈ in 10 days$/);
    expect(timelockText({ lock, required: true, state: { kind: "unlocked" } })).toMatch(
      /^Block 201.432 · reached$/,
    );
  });

  it("knows which locks the clock decides", () => {
    const timed: Timelock = {
      lock: { kind: "relative", lock: { kind: "seconds", seconds: 51_200 } },
      required: true,
      state: { kind: "no_coins", blocks: null, seconds: 51_200 },
    };
    expect(timelockText(timed)).toMatch(/^51.200 seconds after the coin arrives ≈ 14 hours$/);
    expect(hasTimeBasedLocks(liana({ kind: "no_coins" }))).toBe(false);
    expect(
      hasTimeBasedLocks(
        snapshot({ branches: [branch("b0", "primary", "Primary", key("k0"), OPEN, [timed])] }),
      ),
    ).toBe(true);
  });
});

describe("branchStatus", () => {
  it("colours only the thresholds", () => {
    expect(branchStatus(branch("b", "primary", "Primary", key("k0"), OPEN))).toEqual({
      tone: "confirmed",
      glyph: "check",
      text: "Spendable now",
    });
    const soon = branchStatus(
      branch("b", "primary", "Primary", key("k0"), { kind: "locked", until: blocksLeft(1_432) }),
    );
    expect(soon.tone).toBe("pending");
    expect(soon.text).toMatch(/^In 1.432 blocks ≈ 10 days$/);
    const far = branchStatus(
      branch("b", "primary", "Primary", key("k0"), { kind: "locked", until: blocksLeft(52_560) }),
    );
    expect(far.tone).toBe("neutral");
    expect(far.glyph).toBe("clock");
  });

  it("counts coins, the next to open, and the ones still waiting", () => {
    const mixed = branchStatus(
      branch("b", "recovery", "Recovery", key("k1"), {
        kind: "per_coin",
        unlocked: 3,
        waiting: 2,
        locked: 1,
        next: blocksLeft(1_728),
      }),
    );
    expect(mixed.text).toBe("3 of 6 coins unlocked · next in 12 days · 2 waiting for a block");
    expect(mixed.tone).toBe("pending");
    const all = branchStatus(
      branch("b", "recovery", "Recovery", key("k1"), {
        kind: "per_coin",
        unlocked: 2,
        waiting: 0,
        locked: 0,
        next: null,
      }),
    );
    expect(all).toEqual({ tone: "confirmed", glyph: "check", text: "2 of 2 coins unlocked" });
    expect(branchStatus(branch("b", "recovery", "Recovery", key("k1"), { kind: "no_coins" }))).toEqual({
      tone: "neutral",
      glyph: "coins",
      text: "No coins yet",
    });
    expect(
      branchStatus(branch("b", "other", "Other", key("k1"), { kind: "needs_preimage" })).text,
    ).toBe("Needs a secret");
  });
});

describe("countdown", () => {
  it("measures the nearest coin against the longest relative lock", () => {
    const state: BranchState = { kind: "per_coin", unlocked: 1, waiting: 0, locked: 2, next: blocksLeft(42_480) };
    const [, recovery] = orderBranches(liana(state));
    const timer = countdown(recovery);
    expect(timer?.perCoin).toBe(true);
    expect(timer?.progress).toBeCloseTo((52_560 - 42_480) / 52_560, 5);
  });

  it("has no bar for an absolute lock and nothing at all without a wait", () => {
    const locked = countdown(
      branch("b", "primary", "Primary", key("k0"), { kind: "locked", until: blocksLeft(10) }),
    );
    expect(locked).toEqual({ remaining: blocksLeft(10), progress: null, perCoin: false });
    expect(countdown(branch("b", "primary", "Primary", key("k0"), OPEN))).toBeNull();
    expect(countdown(branch("b", "recovery", "Recovery", key("k1"), { kind: "no_coins" }))).toBeNull();
  });
});

describe("policyDigest", () => {
  it("fits the balance row in the grammar of the counts", () => {
    expect(digestText(policyDigest(snapshot({ kind: "single_key" })))).toBe("1 key");
    expect(digestText(policyDigest(snapshot({ kind: "address", keys: [] })))).toBe("1 address");
    expect(
      digestText(
        policyDigest(
          snapshot({
            kind: "multisig",
            branches: [branch("b0", "primary", "Primary", thresh(2, key("k0"), key("k1"), key("k2")), OPEN)],
          }),
        ),
      ),
    ).toBe("2 of 3 keys");
  });

  it("leads with the nearest timed path and where it stands", () => {
    const counting: BranchState = { kind: "per_coin", unlocked: 1, waiting: 0, locked: 2, next: blocksLeft(20_448) };
    expect(digestText(policyDigest(liana(counting)))).toBe("Recovery in 142 days");
    expect(digestText(policyDigest(liana({ kind: "no_coins" })))).toBe("Recovery after 1 year");
    const open: BranchState = { kind: "per_coin", unlocked: 3, waiting: 0, locked: 0, next: null };
    expect(digestText(policyDigest(liana(open)))).toBe("Recovery unlocked");
    const waiting: BranchState = { kind: "per_coin", unlocked: 0, waiting: 1, locked: 0, next: null };
    expect(digestText(policyDigest(liana(waiting)))).toBe("Recovery waiting for a block");
  });

  it("says when the only path itself still waits", () => {
    const height = TIP + 1_432;
    const wallet = snapshot({
      branches: [
        branch(
          "b0",
          "primary",
          "Primary",
          and(key("k0"), { kind: "after", lock: { kind: "height", height } }),
          { kind: "locked", until: blocksLeft(1_432) },
        ),
      ],
    });
    expect(digestText(policyDigest(wallet))).toBe("Spendable in 10 days");
    expect(policyDigest(wallet)).toEqual({ figure: "Spendable", label: "in 10 days" });
  });

  it("leads with the primary path when it is the one that waits", () => {
    // Every path waits: the core makes the nearest one primary. The row
    // says where that one stands, not where the path behind it does.
    const counting = (blocks: number, state: BranchState): PolicyBranch =>
      branch(
        `b${blocks}`,
        blocks === 4_320 ? "primary" : "recovery",
        blocks === 4_320 ? "Primary" : "Recovery",
        and(key(blocks === 4_320 ? "k0" : "k1"), older(blocks)),
        state,
        [relative(blocks, state.kind === "per_coin" ? state : { kind: "no_coins", blocks, seconds: null })],
      );
    const perCoin = snapshot({
      coins: 2,
      branches: [
        counting(52_560, { kind: "per_coin", unlocked: 0, waiting: 0, locked: 2, next: blocksLeft(50_000) }),
        counting(4_320, { kind: "per_coin", unlocked: 1, waiting: 0, locked: 1, next: blocksLeft(1_440) }),
      ],
    });
    expect(digestText(policyDigest(perCoin))).toBe("1 of 2 coins unlocked");
    const empty = snapshot({
      branches: [counting(52_560, { kind: "no_coins" }), counting(4_320, { kind: "no_coins" })],
    });
    expect(digestText(policyDigest(empty))).toBe("Spendable after 30 days");
  });
});
