import { describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Markdown } from "../Markdown";

// Tests de caracterización del renderer Markdown.
// Afirman comportamiento observable (roles ARIA, nombre accesible, texto y estructura
// semántica) en vez de marcado exacto, para que sobrevivan a refactors del renderer.
//
// Aserciones de protocolo permitido (no tienen equivalente semántico):
// - `language-*` en <pre>: es el contrato estándar con el resaltador/CSS, no un detalle
//   interno del marcado.
// - clases `md`/`extra` del contenedor: son la API pública de estilo del componente.
// - orden de las etiquetas de bloque: el orden es la salida observable del parser y no
//   se puede consultar por rol sin perder la secuencia entre tipos de bloque.

function renderMd(text: string) {
  return render(<Markdown text={text} />);
}

describe("Markdown — bloques", () => {
  test("párrafo simple", () => {
    renderMd("hola mundo");
    expect(screen.getByText("hola mundo").tagName).toBe("P");
  });

  test("une las líneas de un párrafo con <br> y normaliza CRLF", () => {
    for (const source of ["primera\nsegunda", "primera\r\nsegunda"]) {
      const { container, unmount } = renderMd(source);
      const paragraph = container.querySelector("p");
      expect(paragraph?.textContent).toBe("primerasegunda");
      expect([...(paragraph?.childNodes ?? [])].map((node) => node.nodeName)).toEqual([
        "#text",
        "BR",
        "#text",
      ]);
      unmount();
    }
  });

  test("encabezados h1-h3 y límite en h4 para niveles 5-6", () => {
    renderMd("# Uno\n## Dos\n### Tres\n#### Cuatro\n##### Cinco\n###### Seis");
    expect(screen.getByRole("heading", { level: 1, name: "Uno" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Dos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Tres" })).toBeInTheDocument();
    const level4 = screen
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);
    expect(level4).toEqual(["Cuatro", "Cinco", "Seis"]);
    expect(screen.queryAllByRole("heading", { level: 5 })).toHaveLength(0);
    expect(screen.queryAllByRole("heading", { level: 6 })).toHaveLength(0);
  });

  test("un encabezado corta el párrafo anterior", () => {
    renderMd("texto suelto\n# Título");
    expect(screen.getByText("texto suelto").tagName).toBe("P");
    expect(screen.getByRole("heading", { level: 1, name: "Título" })).toBeInTheDocument();
  });

  test("listas: viñetas -, *, +, numeradas con 1. y 1), y formato inline en items", () => {
    const bullets = renderMd("- a\n* b\n+ c");
    const bulletList = screen.getByRole("list");
    expect(bulletList.tagName).toBe("UL");
    expect(within(bulletList).getAllByRole("listitem")).toHaveLength(3);
    expect(bullets.container.querySelector("ol")).toBeNull();
    bullets.unmount();

    for (const source of ["1. a\n2. b", "1) a\n2) b"]) {
      const { unmount } = renderMd(source);
      const orderedList = screen.getByRole("list");
      expect(orderedList.tagName).toBe("OL");
      expect(within(orderedList).getAllByRole("listitem")).toHaveLength(2);
      unmount();
    }

    renderMd("- **a**\n- `b`");
    expect(screen.getByText("a").tagName).toBe("STRONG");
    expect(screen.getByText("b").tagName).toBe("CODE");
  });

  test("bloque de código con lenguaje y sin parseo inline", () => {
    const { container } = renderMd("```ts\nconst x = **1**;\n```");
    // `language-*` es el protocolo que consume el resaltador; no hay rol/atributo semántico.
    expect(container.querySelector("pre")).toHaveClass("language-ts");
    expect(screen.getByText("const x = **1**;").tagName).toBe("CODE");
    expect(container.querySelector("strong")).toBeNull();
  });

  test("fence sin cerrar consume hasta el final", () => {
    const { container } = renderMd("```\nlinea1\nlinea2");
    expect(container.querySelector("code")?.textContent).toBe("linea1\nlinea2");
  });

  test("cita", () => {
    const { container } = renderMd("> citado\n> segunda");
    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toBe("citadosegunda");
    expect([...(quote?.childNodes ?? [])].map((node) => node.nodeName)).toEqual([
      "#text",
      "BR",
      "#text",
    ]);
  });

  test("regla horizontal con ---, *** y ___", () => {
    for (const rule of ["---", "***", "___"]) {
      const { container, unmount } = renderMd(rule);
      expect(container.querySelectorAll("hr")).toHaveLength(1);
      unmount();
    }
  });

  test("tabla con cabecera, filas, celdas ausentes y separador alineado", () => {
    renderMd("| a | b |\n|:---|---:|\n| 1 | 2 |\n| 3 |");
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["a", "b"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
  });

  test("texto vacío no genera bloques", () => {
    const { container } = renderMd("");
    expect(container.textContent).toBe("");
    expect(
      container.querySelector("p, h1, h2, h3, h4, ul, ol, pre, blockquote, table, hr"),
    ).toBeNull();
  });

  test("className público se suma a la clase base (API de estilo del componente)", () => {
    const { container } = render(<Markdown text="x" className="extra" />);
    expect(container.firstElementChild).toHaveClass("md", "extra");
  });
});

describe("Markdown — inline", () => {
  test("negrita con ** y __, cursiva con *", () => {
    renderMd("**bold** y __otro__ y *em*");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("otro").tagName).toBe("STRONG");
    expect(screen.getByText("em").tagName).toBe("EM");
  });

  test("código inline", () => {
    renderMd("usa `pnpm test` ya");
    expect(screen.getByText("pnpm test").tagName).toBe("CODE");
  });

  test("inline anidado dentro de negrita", () => {
    renderMd("**hola `mundo`**");
    const nested = screen.getByText("mundo");
    expect(nested.tagName).toBe("CODE");
    expect(nested.parentElement?.tagName).toBe("STRONG");
  });

  test("enlace con target y rel seguros", () => {
    renderMd("[docs](https://example.com)");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  test("un enlace con esquema ejecutable se pinta como texto, no como enlace", () => {
    renderMd("[pulsa](javascript:alert(1))");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("pulsa").tagName).toBe("SPAN");
  });

  test("documento mixto conserva el orden de bloques", () => {
    const { container } = renderMd("# Título\n\npárrafo\n\n- item\n\n```\ncode\n```");
    // El orden entre tipos de bloque es salida observable del parser; no hay consulta
    // por rol que preserve la secuencia.
    const blocks = [...(container.firstElementChild?.children ?? [])].map((el) => el.tagName);
    expect(blocks).toEqual(["H1", "P", "UL", "PRE"]);
  });
});
