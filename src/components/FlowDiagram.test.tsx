import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { FlowDiagram } from "./FlowDiagram";
import type { TxIo } from "../lib/ipc";

/** Lane amounts read the fiat query, so the tree needs a client. */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function io(overrides: Partial<TxIo> = {}): TxIo {
  return {
    address: "tb1qexample",
    value_sats: 1000,
    is_mine: false,
    change: false,
    op_return: null,
    ...overrides,
  };
}

describe("FlowDiagram", () => {
  it("aggregates the tail beyond the lane cap", () => {
    render(
      <FlowDiagram
        inputs={Array.from({ length: 10 }, () => io())}
        outputs={[io()]}
        feeSats={null}
        feeRate={null}
      />,
    );
    // Six lanes shown, the remaining four folded into one.
    expect(screen.getByText("+4 more inputs")).toBeInTheDocument();
  });

  it("keeps every lane when the count fits", () => {
    render(
      <FlowDiagram
        inputs={Array.from({ length: 7 }, () => io())}
        outputs={[io()]}
        feeSats={null}
        feeRate={null}
      />,
    );
    expect(screen.queryByText(/more inputs/)).not.toBeInTheDocument();
  });

  it("labels coinbase inputs with the mining pool", () => {
    render(
      <FlowDiagram
        inputs={[io({ address: null, value_sats: null })]}
        outputs={[io({ is_mine: true })]}
        feeSats={null}
        feeRate={null}
        isCoinbase
        coinbasePool="Foundry USA"
      />,
    );
    expect(screen.getByText("Coinbase · Foundry USA")).toBeInTheDocument();
  });

  it("renders an op_return lane with its decoded text", () => {
    render(
      <FlowDiagram
        inputs={[io()]}
        outputs={[io({ value_sats: 0, op_return: { hex: "6869", text: "hi", label: null } })]}
        feeSats={210}
        feeRate={1.5}
      />,
    );
    expect(screen.getByText("OP_RETURN")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
    // The fee pill accompanies the dashed branch.
    expect(screen.getByText("fee")).toBeInTheDocument();
  });
});
