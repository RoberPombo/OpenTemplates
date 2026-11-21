import type { ReactNode } from "react";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; head: string[]; rows: string[][] };

const FENCE = /^\s*```(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;

function isTableSeparator(line: string) {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index];
  if (!line.trim()) return true;
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line)) return true;
  if (BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line)) return true;
  return line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]);
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const lang = fence[1].trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang, code: code.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const pattern = ordered ? ORDERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].replace(pattern, "").trim());
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join("\n") });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !(paragraph.length > 0 && startsBlock(lines, i))
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function withBreaks(text: string, keyPrefix: string): ReactNode[] {
  const pieces = text.split("\n");
  const nodes: ReactNode[] = [];
  pieces.forEach((piece, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br${index}`} />);
    if (piece) nodes.push(piece);
  });
  return nodes;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE.source, "g");
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(...withBreaks(text.slice(last, match.index), `${keyPrefix}-t${index}`));
    }
    const token = match[0];
    const key = `${keyPrefix}-i${index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {renderInline(link[1], key)}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    last = pattern.lastIndex;
    index += 1;
  }

  if (last < text.length) {
    nodes.push(...withBreaks(text.slice(last), `${keyPrefix}-end`));
  }
  return nodes;
}

function renderBlocks(blocks: Block[]) {
  return blocks.map((block, index) => {
    const key = `block-${index}`;
    switch (block.kind) {
      case "heading": {
        const level = Math.min(block.level, 4);
        const content = renderInline(block.text, key);
        if (level === 1) return <h1 key={key}>{content}</h1>;
        if (level === 2) return <h2 key={key}>{content}</h2>;
        if (level === 3) return <h3 key={key}>{content}</h3>;
        return <h4 key={key}>{content}</h4>;
      }
      case "list":
        return block.ordered ? (
          <ol key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ul>
        );
      case "code":
        return (
          <pre key={key} className={block.lang ? `language-${block.lang}` : undefined}>
            <code>{block.code}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
      case "rule":
        return <hr key={key} />;
      case "table":
        return (
          <div className="md-table" key={key}>
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={`${key}-h-${cellIndex}`}>
                      {renderInline(cell, `${key}-h-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r-${rowIndex}`}>
                    {block.head.map((_, cellIndex) => (
                      <td key={`${key}-r-${rowIndex}-${cellIndex}`}>
                        {renderInline(row[cellIndex] ?? "", `${key}-r-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "paragraph":
      default:
        return <p key={key}>{renderInline(block.text, key)}</p>;
    }
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return <div className={className ? `md ${className}` : "md"}>{renderBlocks(blocks)}</div>;
}
