import "@testing-library/jest-dom/vitest";

// jsdom no implementa scrollIntoView (lo usa el auto-scroll del chat).
// Solo en entorno DOM: los tests de dominio corren en node puro.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
