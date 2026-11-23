// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  filterSessions,
  eventTouchesSessionList,
  sortSessionsByRecent,
  toSessionSummaries,
  UNTITLED_SESSION,
  type RawSessionSummary,
  type SessionSummary,
} from "../chat/sessions";
import { formatRelativeTime } from "../shared";

function raw(overrides: Partial<RawSessionSummary> = {}): RawSessionSummary {
  return { id: "s1", ...overrides };
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    title: "Sesión",
    created: 1,
    updated: 1,
    cost: 0,
    tokens: { input: 0, output: 0 },
    ...overrides,
  };
}

describe("toSessionSummaries", () => {
  test("resuelve título, fechas, coste y tokens", () => {
    const [session] = toSessionSummaries([
      raw({
        title: "  Arreglar login  ",
        cost: 0.42,
        tokens: { input: 10, output: 20 },
        time: { created: 100, updated: 200 },
      }),
    ]);
    expect(session).toEqual({
      id: "s1",
      title: "Arreglar login",
      created: 100,
      updated: 200,
      cost: 0.42,
      tokens: { input: 10, output: 20 },
    });
  });

  test("rellena huecos sin romper la fila", () => {
    const [session] = toSessionSummaries([raw({ title: "   " })]);
    expect(session).toEqual({
      id: "s1",
      title: UNTITLED_SESSION,
      created: 0,
      updated: 0,
      cost: 0,
      tokens: { input: 0, output: 0 },
    });
  });

  test("usa created como updated si el servidor no manda updated", () => {
    const [session] = toSessionSummaries([raw({ time: { created: 50 } })]);
    expect(session.updated).toBe(50);
  });
});

describe("sortSessionsByRecent y filterSessions", () => {
  const sessions = [
    summary({ id: "a", title: "Refactor de login", updated: 10 }),
    summary({ id: "b", title: "Migración de tests", updated: 30 }),
    summary({ id: "c", title: "Sin fecha", updated: 0 }),
  ];

  test("ordena por actividad reciente sin mutar la entrada", () => {
    const sorted = sortSessionsByRecent(sessions);
    expect(sorted.map((session) => session.id)).toEqual(["b", "a", "c"]);
    expect(sessions.map((session) => session.id)).toEqual(["a", "b", "c"]);
  });

  test("filtra por título sin distinguir mayúsculas y tolera espacios", () => {
    expect(filterSessions(sessions, "  LOGIN ").map((session) => session.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "").map((session) => session.id)).toEqual(["a", "b", "c"]);
    expect(filterSessions(sessions, "nada")).toEqual([]);
  });
});

describe("eventTouchesSessionList", () => {
  test("reconoce altas, bajas, renombrados y fin de turno", () => {
    expect(eventTouchesSessionList({ type: "session.created" })).toBe(true);
    expect(eventTouchesSessionList({ type: "session.deleted" })).toBe(true);
    expect(eventTouchesSessionList({ type: "session.renamed" })).toBe(true);
    expect(eventTouchesSessionList({ type: "session.idle" })).toBe(true);
    expect(eventTouchesSessionList({ type: "session.text.delta" })).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  test("resume minutos, horas y días", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("ahora");
    expect(formatRelativeTime(now - 5 * minute, now)).toBe("hace 5 min");
    expect(formatRelativeTime(now - 3 * hour, now)).toBe("hace 3 h");
    expect(formatRelativeTime(now - 2 * day, now)).toBe("hace 2 d");
  });

  test("a partir de 30 días usa fecha corta", () => {
    expect(formatRelativeTime(now - 40 * day, now)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  test("vacío si la marca no es válida", () => {
    expect(formatRelativeTime(0, now)).toBe("");
    expect(formatRelativeTime(Number.NaN, now)).toBe("");
  });
});
