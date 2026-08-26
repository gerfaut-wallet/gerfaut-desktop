import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowSummary } from "./FlowSummary";
import type { TxIo } from "../lib/ipc";

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

describe("FlowSummary", () => {
  it("sums both sides and states the fee between them", () => {
    render(
      <FlowSummary
        inputs={[io({ value_sats: 1500 }), io({ value_sats: 500 })]}
        outputs={[io({ value_sats: 1790 })]}
        feeSats={210}
        feeRate={1.5}
      />,
    );
    expect(screen.getByText("2 inputs")).toBeInTheDocument();
    expect(screen.getByText("1 output")).toBeInTheDocument();
    expect(screen.getByText("0.00002000 BTC")).toBeInTheDocument();
    expect(screen.getByText("0.00001790 BTC")).toBeInTheDocument();
    expect(screen.getByText("fee")).toBeInTheDocument();
    expect(screen.getByText("1.5 sat/vB")).toBeInTheDocument();
  });

  it("labels a coinbase with the pool and the reward it creates", () => {
    render(
      <FlowSummary
        inputs={[io({ address: null, value_sats: null })]}
        outputs={[io({ value_sats: 312_500_000 })]}
        feeSats={null}
        feeRate={null}
        isCoinbase
        coinbasePool="Foundry USA"
      />,
    );
    expect(screen.getByText("Coinbase")).toBeInTheDocument();
    expect(screen.getByText("Newly minted · Foundry USA")).toBeInTheDocument();
    expect(screen.getAllByText("3.12500000 BTC")).toHaveLength(2);
    expect(screen.queryByText("fee")).not.toBeInTheDocument();
  });

  it("says n/a when an input value is unknown", () => {
    render(
      <FlowSummary
        inputs={[io({ value_sats: null })]}
        outputs={[io()]}
        feeSats={null}
        feeRate={null}
      />,
    );
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });
});
