import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../Markdown";

// Tests de caracterización del renderer Markdown tal cual está hoy (fase 0).
// Cubren el comportamiento observable a través del componente público, sin tocar producción.

function renderMd(text: string) {
  return render(<Markdown text={text} />);
}

describe("Markdown — bloques", () => {
  test("párrafo simple", () => {
    renderMd("hola mundo");
    expect(screen.getByText("hola mundo").tagName).toBe("P");
  });

  test("varias líneas del mismo párrafo se unen con <br>", () => {
    const { container } = renderMd("primera\nsegunda");
    const paragraph = container.querySelector("p");
    expect(paragraph?.innerHTML).toBe("primera<br>segunda");
  });

  test("normaliza saltos CRLF", () => {
    const { container } = renderMd("primera\r\nsegunda");
    expect(container.querySelector("p")?.innerHTML).toBe("primera<br>segunda");
  });

  test("encabezados h1-h3 y límite en h4 para niveles 5-6", () => {
    const { container } = renderMd(
      "# Uno\n## Dos\n### Tres\n#### Cuatro\n##### Cinco\n###### Seis",
    );
    expect(container.querySelector("h1")?.textContent).toBe("Uno");
    expect(container.querySelector("h2")?.textContent).toBe("Dos");
    expect(container.querySelector("h3")?.textContent).toBe("Tres");
    expect(container.querySelectorAll("h4")).toHaveLength(3);
    expect(container.querySelector("h5")).toBeNull();
    expect(container.querySelector("h6")).toBeNull();
  });

  test("un encabezado corta el párrafo anterior", () => {
    const { container } = renderMd("texto suelto\n# Título");
    expect(container.querySelector("p")?.textContent).toBe("texto suelto");
    expect(container.querySelector("h1")?.textContent).toBe("Título");
  });

  test("lista desordenada con -, * y +", () => {
    const { container } = renderMd("- a\n* b\n+ c");
    const list = container.querySelector("ul");
    expect(list?.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelector("ol")).toBeNull();
  });

  test("lista ordenada con 1. y 1)", () => {
    const { container } = renderMd("1. a\n2. b");
    expect(container.querySelector("ol")?.querySelectorAll("li")).toHaveLength(2);
    const { container: paren } = renderMd("1) a\n2) b");
    expect(paren.querySelector("ol")?.querySelectorAll("li")).toHaveLength(2);
  });

  test("bloque de código con lenguaje y sin parseo inline", () => {
    const { container } = renderMd("```ts\nconst x = **1**;\n```");
    const pre = container.querySelector("pre");
    expect(pre?.className).toBe("language-ts");
    expect(pre?.querySelector("code")?.textContent).toBe("const x = **1**;");
    expect(container.querySelector("strong")).toBeNull();
  });

  test("fence sin cerrar consume hasta el final", () => {
    const { container } = renderMd("```\nlinea1\nlinea2");
    expect(container.querySelector("code")?.textContent).toBe("linea1\nlinea2");
  });

  test("cita", () => {
    const { container } = renderMd("> citado\n> segunda");
    expect(container.querySelector("blockquote")?.innerHTML).toBe("citado<br>segunda");
  });

  test("regla horizontal con ---, *** y ___", () => {
    for (const rule of ["---", "***", "___"]) {
      const { container } = renderMd(rule);
      expect(container.querySelector("hr")).not.toBeNull();
    }
  });

  test("tabla con cabecera, filas y celdas ausentes", () => {
    const { container } = renderMd("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 |");
    expect(container.querySelector(".md-table")).not.toBeNull();
    const heads = [...container.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(heads).toEqual(["a", "b"]);
    const rows = [...container.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
  });

  test("separador de tabla con alineación", () => {
    const { container } = renderMd("| a |\n| :---: |\n| 1 |");
    expect(container.querySelector("table")).not.toBeNull();
  });

  test("texto vacío no genera bloques", () => {
    const { container } = renderMd("");
    expect(container.querySelector(".md")?.childElementCount).toBe(0);
  });

  test("className adicional se combina con md", () => {
    const { container } = render(<Markdown text="x" className="extra" />);
    expect(container.querySelector(".md.extra")).not.toBeNull();
  });
});

describe("Markdown — inline", () => {
  test("negrita con ** y __, cursiva con *", () => {
    const { container } = renderMd("**bold** y __otro__ y *em*");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelector("em")?.textContent).toBe("em");
  });

  test("código inline", () => {
    const { container } = renderMd("usa `pnpm test` ya");
    expect(container.querySelector("code")?.textContent).toBe("pnpm test");
  });

  test("inline anidado dentro de negrita", () => {
    const { container } = renderMd("**hola `mundo`**");
    expect(container.querySelector("strong code")?.textContent).toBe("mundo");
  });

  test("enlace con target y rel seguros", () => {
    renderMd("[docs](https://example.com)");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  test("elementos inline dentro de items de lista", () => {
    const { container } = renderMd("- **a**\n- `b`");
    expect(container.querySelector("li strong")?.textContent).toBe("a");
    expect(container.querySelector("li code")?.textContent).toBe("b");
  });

  test("un enlace con esquema ejecutable se pinta como texto, no como enlace", () => {
    const { container } = renderMd("[pulsa](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("pulsa").tagName).toBe("SPAN");
  });
  test("documento mixto conserva el orden de bloques", () => {
    const { container } = renderMd("# Título\n\npárrafo\n\n- item\n\n```\ncode\n```");
    const tags = [...(container.querySelector(".md")?.children ?? [])].map((el) => el.tagName);
    expect(tags).toEqual(["H1", "P", "UL", "PRE"]);
  });
});
