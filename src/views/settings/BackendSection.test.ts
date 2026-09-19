import { describe, expect, it } from "vitest";
import { buildElectrumUrl, parseElectrumUrl } from "./BackendSection";

describe("parseElectrumUrl", () => {
  it("reads an IPv4 address and its port", () => {
    expect(parseElectrumUrl("ssl://192.168.1.20:50002")).toEqual({
      host: "192.168.1.20",
      port: "50002",
      tls: true,
    });
  });

  it("reads a hostname, and tcp as no TLS", () => {
    expect(parseElectrumUrl("tcp://electrum.example.com:50001")).toEqual({
      host: "electrum.example.com",
      port: "50001",
      tls: false,
    });
  });

  it("reads an onion address", () => {
    const onion = "explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion";
    expect(parseElectrumUrl(`tcp://${onion}:50001`)).toEqual({
      host: onion,
      port: "50001",
      tls: false,
    });
  });

  it("reads a bracketed IPv6 address with its port", () => {
    expect(parseElectrumUrl("ssl://[2001:db8::1]:50002")).toEqual({
      host: "2001:db8::1",
      port: "50002",
      tls: true,
    });
  });

  it("reads a bracketed IPv6 address without a port", () => {
    expect(parseElectrumUrl("ssl://[2001:db8::1]")).toEqual({
      host: "2001:db8::1",
      port: "",
      tls: true,
    });
    expect(parseElectrumUrl("tcp://[::1]:")).toEqual({ host: "::1", port: "", tls: false });
  });

  it("takes a bare IPv6 address whole, since no colon in it is a port for sure", () => {
    expect(parseElectrumUrl("ssl://2001:db8::a")).toEqual({
      host: "2001:db8::a",
      port: "",
      tls: true,
    });
  });

  it("reads a name without a port, and an address without a scheme", () => {
    expect(parseElectrumUrl("ssl://electrum.example.com")).toEqual({
      host: "electrum.example.com",
      port: "",
      tls: true,
    });
    expect(parseElectrumUrl("electrum.example.com:50002")).toEqual({
      host: "electrum.example.com",
      port: "50002",
      tls: true,
    });
  });

  it("drops a path, a query and the spaces around", () => {
    expect(parseElectrumUrl("  ssl://[2001:db8::1]:50002/?x=1  ")).toEqual({
      host: "2001:db8::1",
      port: "50002",
      tls: true,
    });
  });

  it("never makes a port out of garbage", () => {
    expect(parseElectrumUrl("")).toEqual({ host: "", port: "", tls: true });
    expect(parseElectrumUrl("ssl://")).toEqual({ host: "", port: "", tls: true });
    expect(parseElectrumUrl("ssl://host:50002:t")).toEqual({
      host: "host:50002:t",
      port: "",
      tls: true,
    });
    expect(parseElectrumUrl("ssl://host:https")).toEqual({ host: "host", port: "", tls: true });
    expect(parseElectrumUrl("ssl://[2001:db8::1")).toEqual({
      host: "[2001:db8::1",
      port: "",
      tls: true,
    });
    expect(parseElectrumUrl("ssl://[2001:db8::1]x:50002")).toEqual({
      host: "[2001:db8::1]x:50002",
      port: "",
      tls: true,
    });
  });
});

describe("buildElectrumUrl", () => {
  it("writes a name and an IPv4 address as they are", () => {
    expect(buildElectrumUrl(" electrum.example.com ", " 50002 ", true)).toBe(
      "ssl://electrum.example.com:50002",
    );
    expect(buildElectrumUrl("192.168.1.20", "50001", false)).toBe("tcp://192.168.1.20:50001");
  });

  it("puts a bare IPv6 address in brackets, and leaves a bracketed one alone", () => {
    expect(buildElectrumUrl("2001:db8::1", "50002", true)).toBe("ssl://[2001:db8::1]:50002");
    expect(buildElectrumUrl("[2001:db8::1]", "50002", true)).toBe("ssl://[2001:db8::1]:50002");
  });

  it("gives back the address a form was seeded from", () => {
    for (const url of [
      "ssl://[2001:db8::1]:50002",
      "tcp://192.168.1.20:50001",
      "ssl://electrum.example.com:50002",
    ]) {
      const { host, port, tls } = parseElectrumUrl(url);
      expect(buildElectrumUrl(host, port, tls)).toBe(url);
    }
  });
});
