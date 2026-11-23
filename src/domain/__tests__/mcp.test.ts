// @vitest-environment node
import { describe, expect, test } from "vitest";
import { mcpAction, mcpStateLabel, mcpStateTone, readableMcpError } from "../chat/mcp";

describe("estado de MCP", () => {
  test("etiquetas y tonos se corresponden con el estado real", () => {
    expect(mcpStateLabel("connected")).toBe("conectado");
    expect(mcpStateLabel("failed")).toBe("fallando");
    expect(mcpStateLabel("needs_auth")).toBe("requiere autorización");
    expect(mcpStateLabel("disabled")).toBe("desconectado");
    expect(mcpStateTone("connected")).toBe("ok");
    expect(mcpStateTone("failed")).toBe("bad");
    expect(mcpStateTone("disabled")).toBe("");
  });

  test("un servidor conectado se desconecta; el resto reintenta", () => {
    expect(mcpAction("connected")).toBe("disconnect");
    expect(mcpAction("pending")).toBe("disconnect");
    expect(mcpAction("failed")).toBe("connect");
    expect(mcpAction("needs_auth")).toBe("connect");
    expect(mcpAction("disabled")).toBe("connect");
  });

  test("el error del servidor se muestra en una línea legible", () => {
    expect(readableMcpError(undefined)).toBeNull();
    expect(readableMcpError("   ")).toBeNull();
    expect(
      readableMcpError("\u001b[31mConnection closed:\n  MCP server process exited\u001b[0m"),
    ).toBe("Connection closed: MCP server process exited");
    const long = "x".repeat(400);
    const short = readableMcpError(long, 40);
    expect(short).toHaveLength(40);
    expect(short?.endsWith("…")).toBe(true);
  });
});
