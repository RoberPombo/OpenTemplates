import { useState } from "react";
import { startCapture, stopCapture } from "../../perf/capture";

export default function PerformanceCapture() {
  const [active, setActive] = useState(false);

  function toggleCapture() {
    if (!active) {
      startCapture();
      setActive(true);
      return;
    }

    const report = stopCapture();
    setActive(false);
    if (!report) return;

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openconf-performance-${new Date().toISOString().replace(/:/g, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      className="performance-capture"
      onClick={toggleCapture}
      title={
        active
          ? "Detener la medición y descargar el informe"
          : "Iniciar medición de frames y renders de React"
      }
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 10000,
        padding: "8px 12px",
        border: `1px solid ${active ? "var(--danger)" : "var(--line)"}`,
        borderRadius: 8,
        background: "var(--panel-2)",
        color: active ? "var(--danger)" : "var(--text)",
        fontSize: 12,
        boxShadow: "0 4px 16px #0006",
      }}
    >
      {active ? "Detener y exportar" : "Medir rendimiento"}
    </button>
  );
}
