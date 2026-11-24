import { describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilesPanel } from "../FilesPanel";
import type { ChatServer } from "../../../domain/repositories/ChatGateway";
import { makeFakeClient, makeWorkspace } from "../../../tests/fakes";

const textContent = {
  kind: "text" as const,
  text: "hola desde README\n",
  bytes: 19,
  truncated: false,
};

function setup(overrides: Partial<Parameters<typeof makeFakeClient>[0]> = {}) {
  const { client } = makeFakeClient({
    fileEntries: {
      "": [
        { path: "README.md", type: "file" },
        { path: "src/", type: "directory" },
      ],
      "src/": [
        { path: "src/a.ts", type: "file" },
        { path: "src/z.ts", type: "file" },
      ],
    },
    fileContents: {
      "README.md": textContent,
      "src/a.ts": {
        kind: "text",
        text: "export const a = 1;\n",
        bytes: 19,
        truncated: false,
      },
      "bin.dat": { kind: "binary", text: "", bytes: 4, truncated: false },
    },
    ...overrides,
  });
  render(<FilesPanel client={client as unknown as ChatServer} workspace={makeWorkspace()} />);
  return { client };
}

describe("FilesPanel", () => {
  test("lista el árbol y abre un fichero con file.read", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    expect(await screen.findByRole("button", { name: "Abrir README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expandir src" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abrir README.md" }));
    await waitFor(() =>
      expect(client.file.read).toHaveBeenCalledWith(expect.objectContaining({ path: "README.md" })),
    );
    expect(await screen.findByText("hola desde README")).toBeInTheDocument();
    expect(screen.getByText(/texto · 19 B/)).toBeInTheDocument();
  });

  test("expande una carpeta con carga perezosa y ordena sus hijos", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await screen.findByRole("button", { name: "Expandir src" });
    await user.click(screen.getByRole("button", { name: "Expandir src" }));
    await waitFor(() =>
      expect(client.file.list).toHaveBeenCalledWith(expect.objectContaining({ path: "src/" })),
    );
    expect(await screen.findByRole("button", { name: "Abrir a.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir z.ts" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Contraer src" }));
    expect(screen.queryByRole("button", { name: "Abrir a.ts" })).not.toBeInTheDocument();
  });

  test("abre ficheros de una carpeta expandida", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Expandir src" }));
    await user.click(await screen.findByRole("button", { name: "Abrir a.ts" }));
    expect(await screen.findByText("export const a = 1;")).toBeInTheDocument();
  });

  test("marca binarios, cortes por tamaño y errores", async () => {
    const user = userEvent.setup();
    const { client } = setup({
      fileEntries: {
        "": [
          { path: "bin.dat", type: "file" },
          { path: "grande.txt", type: "file" },
        ],
      },
      fileContents: {
        "bin.dat": { kind: "binary", text: "", bytes: 4, truncated: false },
        "grande.txt": {
          kind: "text",
          text: "recortado",
          bytes: 300_000,
          truncated: true,
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Abrir bin.dat" }));
    expect(await screen.findByText(/Archivo binario/)).toBeInTheDocument();
    expect(client.file.read).toHaveBeenCalledWith(expect.objectContaining({ path: "bin.dat" }));

    await user.click(screen.getByRole("button", { name: "Abrir grande.txt" }));
    expect(await screen.findByText(/Vista parcial/)).toBeInTheDocument();
    expect(screen.getByText("recortado")).toBeInTheDocument();
  });

  test("muestra el error al no poder leer el árbol", async () => {
    const { client } = makeFakeClient();
    client.file.list.mockRejectedValueOnce(new Error("carpeta no accesible"));
    render(<FilesPanel client={client as unknown as ChatServer} workspace={makeWorkspace()} />);
    expect(await screen.findByText(/carpeta no accesible/)).toBeInTheDocument();
  });
});
