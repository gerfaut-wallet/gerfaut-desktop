import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TxDiagram } from "./TxDiagram";
import type { TxBranch } from "./TxDiagram";

const TXID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const MINE = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const THEIRS = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

function branch(overrides: Partial<TxBranch> = {}): TxBranch {
  return { role: "external-in", label: TXID + ":0", amount: 100_000, isMine: false, ...overrides };
}

function side(name: "Inputs" | "Outputs") {
  return within(screen.getByRole("list", { name }));
}

/** jsdom lays nothing out, so the connectors are measured against a
    made-up page: one row per side, the node between them. */
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
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (this.matches("section")) return rect(0, 0, 900, 200);
    if (this.matches('ul[aria-label="Inputs"]')) return rect(0, 40, 380, 20);
    if (this.matches('ul[aria-label="Outputs"]')) return rect(520, 40, 380, 20);
    if (this.matches("li")) return rect(0, 40, 380, 20);
    if (this.matches("div.font-data")) return rect(430, 80, 40, 40);
    return rect(0, 0, 0, 0);
  });
}

describe("TxDiagram", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(screen.getByText("TX")).toBeInTheDocument();

    // The fee is a branch of its own, amount only.
    expect(screen.getByText("Fee")).toBeInTheDocument();
    expect(screen.getByText("0.00000210 BTC")).toBeInTheDocument();
    expect(screen.queryByText(/sat\/vB/)).not.toBeInTheDocument();

    // One connector per row, plus the one that drops to the fee.
    expect(container.querySelectorAll("svg.absolute > path")).toHaveLength(4);
    expect(container.querySelector("svg.absolute")).toHaveAttribute("aria-hidden");
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

  it("draws a transfer to oneself with the wallet on both sides", () => {
    render(
      <TxDiagram
        inputs={[branch({ role: "wallet-in", isMine: true, amount: 60_000 })]}
        outputs={[branch({ role: "change", label: MINE, amount: 59_800, isMine: true })]}
        feeSats={200}
      />,
    );
    expect(screen.getByTitle("Spent from this wallet")).toBeInTheDocument();
    expect(screen.getByTitle("Change back to this wallet")).toBeInTheDocument();
    expect(screen.getByText("Fee")).toBeInTheDocument();
  });

  it("draws a coinbase: nothing spent, a reward created, no fee branch", () => {
    render(
      <TxDiagram
        inputs={[branch({ role: "coinbase", label: "Coinbase", amount: 312_500_000 })]}
        outputs={[branch({ role: "received", label: MINE, amount: 312_500_000, isMine: true })]}
        feeSats={null}
      />,
    );
    expect(screen.getByTitle("Newly minted coins")).toBeInTheDocument();
    expect(side("Inputs").getByText("Coinbase")).toBeInTheDocument();
    expect(screen.queryByText("Fee")).not.toBeInTheDocument();
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
  });

  it("folds a huge side into one row that carries what it stands for", () => {
    const inputs = Array.from({ length: 40 }, (_, index) =>
      branch({ label: `${TXID}:${index}`, amount: 1_000 }),
    );
    render(<TxDiagram inputs={inputs} outputs={[branch({ amount: 39_000 })]} feeSats={1_000} />);

    // Eight rows whatever the transaction: the complete list is below.
    expect(side("Inputs").getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("+33 more")).toBeInTheDocument();
    // The folded rows keep their weight: 33 inputs of 1 000 sats.
    expect(side("Inputs").getByText("0.00033000 BTC")).toBeInTheDocument();
  });

  it("leaves and arrives flat, with the control points the design fixes", () => {
    stubLayout();
    const { container } = render(
      <TxDiagram
        inputs={[branch({ amount: 100_000 })]}
        outputs={[branch({ role: "external-out", label: THEIRS, amount: 100_000 })]}
        feeSats={null}
      />,
    );
    const paths = [...container.querySelectorAll("svg.absolute > path")];
    // Row centre 50, node centre 100, connector 380 → 430 wide 50:
    // control points at 20% and 80%, each sharing the y of its end.
    expect(paths[0]).toHaveAttribute("d", "M380.0,50.0 C390.0,50.0 420.0,100.0 430.0,100.0");
    expect(paths[1]).toHaveAttribute("d", "M470.0,100.0 C480.0,100.0 510.0,50.0 520.0,50.0");
    // The dot sits on the inner edge of its column, sized by its share.
    expect(container.querySelector("svg.absolute > circle")).toHaveAttribute("cx", "380");
  });

  it("says n/a for an input whose value nobody knows", () => {
    const { container } = render(
      <TxDiagram
        inputs={[branch({ amount: null })]}
        outputs={[branch({ role: "received", label: MINE, amount: 99_000, isMine: true })]}
        feeSats={null}
      />,
    );
    expect(side("Inputs").getByText("n/a")).toBeInTheDocument();
    // An amount nobody knows is not a size: that dot is drawn hollow.
    expect(container.querySelector("svg.absolute > circle.fill-none")).toBeInTheDocument();
  });
});
