import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TxDiagram, shortenBranchLabel } from "./TxDiagram";
import type { TxBranch } from "./TxDiagram";
import { useUi } from "../state/store";

const TXID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const MINE = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const THEIRS = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

function branch(overrides: Partial<TxBranch> = {}): TxBranch {
  return { role: "external-in", label: TXID + ":0", amount: 100_000, isMine: false, ...overrides };
}

function side(name: "Inputs" | "Outputs") {
  return within(screen.getByRole("list", { name }));
}

function paths(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("svg.absolute > path")];
}

/** jsdom lays nothing out, so the connectors are measured against a
    made-up page: one box per side, the square between them, the fee
    below. The square is the only `div` in the mono face and the fee box
    the only one stacking its lines — nothing else selects them. */
function stubLayout() {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches("section")) return rect(0, 0, 900, 260);
    if (this.matches("li")) {
      return this.closest('ul[aria-label="Inputs"]')
        ? rect(0, 40, 380, 20)
        : rect(520, 40, 380, 20);
    }
    if (this.matches("div.font-data")) return rect(430, 80, 40, 40);
    if (this.matches("div.flex-col")) return rect(410, 160, 80, 30);
    return rect(0, 0, 0, 0);
  });
}

describe("TxDiagram", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useUi.setState({ masked: false });
  });

  it("draws a one-in, one-out transfer: two boxes, two connectors, a fee", () => {
    const { container } = render(
      <TxDiagram
        inputs={[branch({ role: "wallet-in", isMine: true, amount: 60_000 })]}
        outputs={[branch({ role: "received", label: MINE, amount: 59_800, isMine: true })]}
        feeSats={200}
      />,
    );
    expect(side("Inputs").getAllByRole("listitem")).toHaveLength(1);
    expect(side("Outputs").getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("TX")).toBeInTheDocument();
    // One connector per box, plus the one that drops to the fee.
    expect(paths(container)).toHaveLength(3);
  });

  it("draws a plain send: the wallet's coin in, a payment and change out", () => {
    const { container } = render(
      <TxDiagram
        inputs={[branch({ role: "wallet-in", isMine: true, amount: 150_210 })]}
        outputs={[
          branch({ role: "external-out", label: THEIRS, amount: 100_000 }),
          branch({ role: "change", label: MINE, amount: 50_000, isMine: true }),
        ]}
        feeSats={210}
      />,
    );

    // The input is named by its outpoint, index kept: an address does
    // not name one input among several.
    expect(side("Inputs").getByTitle(TXID + ":0")).toHaveTextContent(/^0123456789\.\.\.abcdef:0$/);
    expect(side("Inputs").getByText("0.00150210 BTC")).toBeInTheDocument();
    expect(side("Outputs").getByTitle(THEIRS)).toBeInTheDocument();
    expect(side("Outputs").getByText("0.00050000 BTC")).toBeInTheDocument();

    expect(screen.getByTitle("Spent from this wallet")).toBeInTheDocument();
    expect(screen.getByTitle("Change back to this wallet")).toBeInTheDocument();

    // A box the wallet owns takes the wash the lists below already use.
    expect(side("Inputs").getAllByRole("listitem")[0]).toHaveClass("border-primary/40");
    expect(side("Outputs").getAllByRole("listitem")[0]).toHaveClass("border-border");

    // The fee is a branch of its own, amount only.
    expect(screen.getByText("Fee")).toBeInTheDocument();
    expect(screen.getByText("0.00000210 BTC")).toBeInTheDocument();
    expect(screen.queryByText(/sat\/vB/)).not.toBeInTheDocument();

    expect(paths(container)).toHaveLength(4);
    expect(container.querySelector("svg.absolute")).toHaveAttribute("aria-hidden");
    // A branch touching the wallet inks its connector; the fee never does.
    const ink = paths(container).map((path) => path.getAttribute("class"));
    expect(ink).toContain("stroke-primary/55");
    expect(ink).toContain("stroke-border");
  });

  it("names each box by its role, which only an icon says on screen", () => {
    render(
      <TxDiagram
        inputs={[branch({ role: "wallet-in", isMine: true, amount: 150_210 })]}
        outputs={[branch({ role: "change", label: MINE, amount: 150_000, isMine: true })]}
        feeSats={210}
      />,
    );
    // The icon is decorative and the role sat in a title on a span, so
    // a screen reader was left with an outpoint and a number.
    expect(
      side("Inputs").getByRole("listitem", {
        name: `Spent from this wallet, ${TXID}:0, 0.00150210 BTC`,
      }),
    ).toBeInTheDocument();
    expect(
      side("Outputs").getByRole("listitem", {
        name: `Change back to this wallet, ${MINE}, 0.00150000 BTC`,
      }),
    ).toBeInTheDocument();
  });

  it("draws a receive: an outside coin in, the wallet's output out", () => {
    render(
      <TxDiagram
        inputs={[branch()]}
        outputs={[branch({ role: "received", label: MINE, amount: 99_000, isMine: true })]}
        feeSats={1_000}
      />,
    );
    expect(screen.getByTitle("External input")).toBeInTheDocument();
    expect(screen.getByTitle("Received by this wallet")).toBeInTheDocument();
  });

  it("draws a coinbase: nothing spent, a reward created, no fee branch", () => {
    const { container } = render(
      <TxDiagram
        inputs={[branch({ role: "coinbase", label: "Coinbase", amount: 312_500_000 })]}
        outputs={[branch({ role: "received", label: MINE, amount: 312_500_000, isMine: true })]}
        feeSats={null}
      />,
    );
    expect(screen.getByTitle("Newly minted coins")).toBeInTheDocument();
    expect(side("Inputs").getByText("Coinbase")).toBeInTheDocument();
    // No fee box, and nothing drawn hanging below the square either.
    expect(screen.queryByText("Fee")).not.toBeInTheDocument();
    expect(paths(container)).toHaveLength(2);
  });

  it("draws no fee branch for a fee of zero either", () => {
    const { container } = render(
      <TxDiagram inputs={[branch()]} outputs={[branch({ amount: 100_000 })]} feeSats={0} />,
    );
    expect(screen.queryByText("Fee")).not.toBeInTheDocument();
    expect(paths(container)).toHaveLength(2);
  });

  it("names an OP_RETURN output by its decoded payload", () => {
    render(
      <TxDiagram
        inputs={[branch()]}
        outputs={[
          branch({ role: "external-out", label: THEIRS, amount: 99_000 }),
          branch({ role: "op-return", label: "hello", amount: 0 }),
        ]}
        feeSats={1_000}
      />,
    );
    expect(screen.getByTitle("Data output")).toBeInTheDocument();
    expect(side("Outputs").getByText("hello")).toBeInTheDocument();
    expect(
      side("Outputs").getByRole("listitem", { name: "Data output, hello, 0.00000000 BTC" }),
    ).toBeInTheDocument();
  });

  it("folds each side into one box that names the side it stands for", () => {
    const inputs = Array.from({ length: 12 }, (_, index) =>
      branch({ label: `${TXID}:${index}`, amount: 1_000 }),
    );
    const outputs = Array.from({ length: 15 }, (_, index) =>
      branch({ role: "external-out", label: `${THEIRS}${index}`, amount: 2_000 }),
    );
    render(<TxDiagram inputs={inputs} outputs={outputs} feeSats={1_000} />);

    // Ten boxes a side whatever the transaction: past ten a diagram
    // stops being one, and the complete lists sit right below it.
    expect(side("Inputs").getAllByRole("listitem")).toHaveLength(10);
    expect(side("Outputs").getAllByRole("listitem")).toHaveLength(10);
    // `+3 more` alone, halfway down a column, does not say more of what.
    expect(side("Inputs").getByText("+3 more inputs")).toBeInTheDocument();
    expect(side("Outputs").getByText("+6 more outputs")).toBeInTheDocument();
    // The folded boxes keep their weight: 3 inputs of 1 000 sats, 6
    // outputs of 2 000.
    expect(side("Inputs").getByText("0.00003000 BTC")).toBeInTheDocument();
    expect(side("Outputs").getByText("0.00012000 BTC")).toBeInTheDocument();
  });

  it("adds nothing up when a folded branch is worth nobody knows what", () => {
    const inputs = Array.from({ length: 12 }, (_, index) =>
      branch({ label: `${TXID}:${index}`, amount: index === 11 ? null : 1_000 }),
    );
    render(<TxDiagram inputs={inputs} outputs={[branch({ amount: 10_000 })]} feeSats={null} />);
    expect(
      side("Inputs").getByRole("listitem", { name: "Folded rows, +3 more inputs, n/a" }),
    ).toBeInTheDocument();
  });

  it("leaves and arrives flat, both control points on the midline", () => {
    stubLayout();
    const { container } = render(
      <TxDiagram
        inputs={[branch({ amount: 100_000 })]}
        outputs={[branch({ role: "external-out", label: THEIRS, amount: 99_000 })]}
        feeSats={1_000}
      />,
    );
    const drawn = paths(container);
    // Box centre 50, square centre 100, a span of 380 → 430: both
    // control points land on 405, the middle of the span, so the curve
    // leaves and arrives horizontal and bends once, in the middle.
    expect(drawn[0]).toHaveAttribute("d", "M380.0,50.0 C405.0,50.0 405.0,100.0 430.0,100.0");
    expect(drawn[1]).toHaveAttribute("d", "M470.0,100.0 C495.0,100.0 495.0,50.0 520.0,50.0");
    // The fee drops from the bottom edge of the square to the top edge
    // of its box: the same curve turned a quarter.
    expect(drawn[2]).toHaveAttribute("d", "M450.0,120.0 C450.0,140.0 450.0,140.0 450.0,160.0");
    expect(drawn[0]).toHaveAttribute("stroke-linecap", "round");
  });

  it("carries the amounts in the boxes, never in a dot", () => {
    stubLayout();
    const { container } = render(
      <TxDiagram
        inputs={[branch({ amount: 1_000_000 }), branch({ label: `${TXID}:1`, amount: 1_000 })]}
        outputs={[branch({ role: "external-out", label: THEIRS, amount: 999_000 })]}
        feeSats={1_000}
      />,
    );
    // The dots sized by share are gone: a figure says what a radius
    // could only suggest, and the connectors are the drawing now.
    expect(container.querySelector("circle")).toBeNull();
    expect(side("Inputs").getByText("0.01000000 BTC")).toBeInTheDocument();
    expect(side("Inputs").getByText("0.00001000 BTC")).toBeInTheDocument();
  });

  it("hides every amount behind the mask, labels untouched", () => {
    useUi.setState({ masked: true });
    render(
      <TxDiagram
        inputs={[branch({ amount: 1_000_000 })]}
        outputs={[branch({ role: "external-out", label: THEIRS, amount: 999_000 })]}
        feeSats={1_000}
      />,
    );
    expect(screen.queryByText(/BTC/)).not.toBeInTheDocument();
    // Two branches and the fee, all three covered; the labels stay.
    expect(screen.getAllByText("•••••")).toHaveLength(3);
    expect(side("Outputs").getByTitle(THEIRS)).toBeInTheDocument();
  });

  it("says n/a for an input whose value nobody knows", () => {
    render(
      <TxDiagram
        inputs={[branch({ amount: null })]}
        outputs={[branch({ role: "received", label: MINE, amount: 99_000, isMine: true })]}
        feeSats={null}
      />,
    );
    expect(side("Inputs").getByText("n/a")).toBeInTheDocument();
    expect(
      side("Inputs").getByRole("listitem", { name: `External input, ${TXID}:0, n/a` }),
    ).toBeInTheDocument();
  });
});

describe("shortenBranchLabel", () => {
  it("keeps the index of an outpoint, which is what names it", () => {
    expect(shortenBranchLabel(`${TXID}:12`, 10, 6)).toBe("0123456789...abcdef:12");
  });

  it("truncates anything else in the middle", () => {
    expect(shortenBranchLabel(THEIRS, 10, 6)).toBe("tb1qrp33g0...ccfmv3");
  });

  it("leaves a label short enough to fit alone", () => {
    expect(shortenBranchLabel("Coinbase", 10, 6)).toBe("Coinbase");
  });
});
