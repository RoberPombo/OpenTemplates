/**
 * Aviso nativo al cruzar los umbrales de presupuesto mensual. El estado de los
 * umbrales es de dominio (`domain/chat/usage`); este hook solo resuelve cuándo
 * avisar (foco, preferencia y una vez por umbral y día) y los efectos.
 */
import { useEffect } from "react";
import type { CompositionRoot } from "../../CompositionRoot";
import { notificationsEnabled } from "../../domain/chat/notifications";
import { budgetAlertMessage, budgetDay, crossedBudgetThresholds } from "../../domain/chat/usage";
import { prefKeys } from "../../domain/repositories/Preferences";

export type BudgetAlertInput = {
  root: CompositionRoot;
  workspaceId: string;
  workspaceName: string;
  cost: number | null;
  budget: number | null;
  timeZone: string | undefined;
};

export function useBudgetAlerts({
  root,
  workspaceId,
  workspaceName,
  cost,
  budget,
  timeZone,
}: BudgetAlertInput) {
  useEffect(() => {
    if (cost === null || budget === null) return;
    const thresholds = crossedBudgetThresholds(cost, budget);
    if (thresholds.length === 0) return;
    if (!notificationsEnabled(root.preferences.get(prefKeys.notifications))) return;
    if (typeof document !== "undefined" && document.hasFocus()) return;
    const day = budgetDay(Date.now(), timeZone);
    const pending = thresholds.filter(
      (threshold) => root.preferences.get(prefKeys.budgetAlert(workspaceId, threshold)) !== day,
    );
    // Si el coste salta varios umbrales a la vez, se avisa solo del mayor y se
    // marcan todos: un único aviso por evaluación y umbral, sin repetir ese día.
    const threshold = pending[pending.length - 1];
    if (threshold === undefined) return;
    for (const reached of pending) {
      root.preferences.set(prefKeys.budgetAlert(workspaceId, reached), day);
    }
    const message = budgetAlertMessage({
      workspaceName,
      threshold,
      cost,
      budget,
    });
    void root.notifications.notify({ ...message, workspaceId });
  }, [budget, cost, root, timeZone, workspaceId, workspaceName]);
}
