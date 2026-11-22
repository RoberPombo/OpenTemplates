import type { ReactNode } from "react";
import type { ModelDetails } from "../../domain/models/details";

const MODALITY_LABELS: Record<string, string> = {
  text: "Texto",
  image: "Imagen",
  pdf: "PDF",
  audio: "Audio",
  video: "Vídeo",
  file: "Archivo",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  alpha: "Alfa",
  beta: "Beta",
  deprecated: "Obsoleto",
};

function money(value?: number): string | null {
  if (value === undefined) return null;
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function tokens(value?: number): string | null {
  if (value === undefined) return null;
  return new Intl.NumberFormat("es-ES", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  const date = new Date(year, month - 1, day ?? 1);
  return new Intl.DateTimeFormat(
    "es-ES",
    day === null
      ? { month: "short", year: "numeric" }
      : { day: "numeric", month: "short", year: "numeric" },
  ).format(date);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="model-card-row">
      <span>{label}</span>
      <span className="model-card-value">{value}</span>
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  return (
    <span className="model-card-tags">
      {items.map((item) => (
        <span key={item} className="model-card-tag">
          {MODALITY_LABELS[item] ?? item}
        </span>
      ))}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="model-card-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

export function ModelInfoCard({ details }: { details: ModelDetails }) {
  const capabilities = [
    details.tools && "Herramientas",
    details.reasoning && "Razonamiento",
    details.attachment && "Adjuntos",
    details.temperature && "Temperatura",
  ].filter((value): value is string => Boolean(value));

  const costRows = details.cost
    ? [
        { label: "Input", value: money(details.cost.input) ?? "—" },
        { label: "Output", value: money(details.cost.output) ?? "—" },
        { label: "Cache read", value: money(details.cost.cacheRead) ?? "—" },
        { label: "Cache write", value: money(details.cost.cacheWrite) ?? "—" },
      ]
    : [];

  const limitRows = [
    { label: "Contexto", value: tokens(details.limit?.context) },
    { label: "Entrada", value: tokens(details.limit?.input) },
    { label: "Salida", value: tokens(details.limit?.output) },
  ].filter((row): row is { label: string; value: string } => row.value !== null);

  const metadataRows = [
    { label: "Conocimiento", value: formatDate(details.knowledge) },
    { label: "Lanzamiento", value: formatDate(details.releaseDate) },
    {
      label: "Actualizado",
      value:
        details.lastUpdated && details.lastUpdated !== details.releaseDate
          ? formatDate(details.lastUpdated)
          : null,
    },
    { label: "Familia", value: details.family ?? null },
    {
      label: "Peso abierto",
      value: details.openWeights === undefined ? null : details.openWeights ? "Sí" : "No",
    },
  ].filter((row): row is { label: string; value: string } => row.value !== null);

  const status = details.status ? (STATUS_LABELS[details.status] ?? details.status) : null;

  return (
    <div className="model-card">
      <header className="model-card-head">
        <span className="model-card-name">{details.name}</span>
        {status && <span className="model-card-status">{status}</span>}
      </header>
      <span className="model-card-provider">
        {details.providerID} · {details.id}
      </span>
      {details.description && <p className="model-card-description">{details.description}</p>}

      {capabilities.length > 0 && (
        <Section title="Capacidades">
          <div className="model-card-chips">
            {capabilities.map((capability) => (
              <span key={capability} className="model-card-chip">
                {capability}
              </span>
            ))}
          </div>
        </Section>
      )}

      {(details.inputModalities.length > 0 || details.outputModalities.length > 0) && (
        <Section title="Modalidades">
          {details.inputModalities.length > 0 && (
            <div className="model-card-row">
              <span>Entrada</span>
              <TagList items={details.inputModalities} />
            </div>
          )}
          {details.outputModalities.length > 0 && (
            <div className="model-card-row">
              <span>Salida</span>
              <TagList items={details.outputModalities} />
            </div>
          )}
        </Section>
      )}

      {costRows.length > 0 && (
        <Section title="Costo ($/1 M tokens)">
          {costRows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      )}

      {limitRows.length > 0 && (
        <Section title="Límites">
          {limitRows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      )}

      {metadataRows.length > 0 && (
        <Section title="Metadatos">
          {metadataRows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </Section>
      )}
    </div>
  );
}
