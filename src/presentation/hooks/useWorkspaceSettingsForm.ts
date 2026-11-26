/**
 * Estado y acciones del formulario de workspace del diálogo de ajustes.
 *
 * Carga el catálogo de MCPs/skills y el estado de los servidores, mantiene la
 * selección, el modelo y el texto del presupuesto, y orquesta el caso de uso
 * `ApplyWorkspaceSettings`. La navegación, el render de secciones y las
 * preferencias globales (notificaciones) siguen en la vista.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText, toggleMapValue, toggleSetValue } from "../../domain/shared";
import { prefKeys } from "../../domain/repositories/Preferences";
import { parseBudgetUsd } from "../../domain/chat/usage";
import type { ChatGateway } from "../../domain/repositories/ChatGateway";
import type { McpInfo, SkillInfo, SkillRef, Workspace } from "../../types";

export type UseWorkspaceSettingsFormInput = {
  workspace?: Workspace | null;
  client?: ChatGateway | null;
  onWorkspaceUpdated?: (workspace: Workspace, warnings: string[]) => void;
};

export function useWorkspaceSettingsForm({
  workspace,
  client,
  onWorkspaceUpdated,
}: UseWorkspaceSettingsFormInput) {
  const root = useAppContext();
  const [mcps, setMcps] = useState<McpInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [reapplying, setReapplying] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(
    () => new Set(workspace?.mcpNames ?? []),
  );
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(
    () => new Map((workspace?.skills ?? []).map((skill) => [skill.id, skill])),
  );
  const [model, setModel] = useState(workspace?.model ?? "");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [budgetText, setBudgetText] = useState(() =>
    workspace ? (root.preferences.get(prefKeys.budget(workspace.id)) ?? "") : "",
  );
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const workspaceId = workspace?.id ?? null;
  const workspacePath = workspace?.projectPath ?? null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const items = await root.library.mcps();
        if (alive) setMcps(items);
      } catch {
        // El catálogo es opcional: el formulario sigue con el estado del workspace.
      }
      if (!workspacePath) return;
      try {
        const items = await root.library.skills(workspacePath);
        if (alive) setSkills(items);
      } catch {
        // Igual que los MCPs, el catálogo puede no estar disponible todavía.
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, workspacePath]);

  useEffect(() => {
    // El formulario es un borrador con cambios sin aplicar: al cambiar de
    // workspace se reinicia de golpe desde los valores guardados. No se puede
    // derivar en render porque los campos son editables y deben conservar lo
    // escrito hasta que cambie la fuente.
    // oxlint-disable-next-line react/set-state-in-effect -- reinicio del borrador al cambiar de workspace
    setSelectedMcps(new Set(workspace?.mcpNames ?? []));
    setSelectedSkills(new Map((workspace?.skills ?? []).map((skill) => [skill.id, skill])));
    setModel(workspace?.model ?? "");
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reset al cambiar de workspace
    setBudgetText(workspace ? (root.preferences.get(prefKeys.budget(workspace.id)) ?? "") : "");
    setBudgetError(null);
    setError(null);
    setWarnings([]);
    setApplied(false);
    // La dependencia es el id del workspace: el resto de campos se leen en el
    // reinicio y no deben disparar el efecto por identidad de objeto.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset al cambiar de workspace
  }, [root.preferences, workspaceId]);

  const skillList = useMemo(() => {
    const map = new Map<string, SkillInfo>();
    for (const skill of skills) map.set(skill.id, skill);
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [skills]);
  // Sin workspace no hay perfil que mostrar, aunque el catálogo cargado siga
  // en memoria para el siguiente workspace.
  const visibleSkills = workspace ? skillList : [];

  const refreshStatuses = useCallback(async () => {
    if (!client || !workspacePath) return;
    try {
      const result = await client.mcp.list({
        location: { directory: workspacePath },
      });
      const next: Record<string, string> = {};
      for (const item of result.data) next[item.name] = item.state;
      setStatuses(next);
    } catch {
      // El servidor puede estar arrancando; se reintenta al aplicar.
    }
  }, [client, workspacePath]);

  useEffect(() => {
    // Lectura del estado de los MCPs del servidor del workspace. El setState
    // ocurre tras el `await`; el analizador no distingue ese límite.
    // oxlint-disable-next-line react/set-state-in-effect -- carga asíncrona del estado de MCPs
    void refreshStatuses();
  }, [refreshStatuses]);

  function toggleMcp(name: string) {
    setSelectedMcps((prev) => toggleSetValue(prev, name));
    setApplied(false);
  }

  function toggleSkill(skill: SkillInfo) {
    setSelectedSkills((prev) => toggleMapValue(prev, skill.id, { id: skill.id, path: skill.path }));
    setApplied(false);
  }

  function changeModel(value: string) {
    setModel(value);
    setApplied(false);
  }

  function changeBudget(value: string) {
    if (!workspace) return;
    setBudgetText(value);
    const raw = value.trim();
    if (!raw) {
      root.preferences.remove(prefKeys.budget(workspace.id));
      setBudgetError(null);
      return;
    }
    const budget = parseBudgetUsd(raw);
    if (budget === null) {
      setBudgetError("Introduce un importe mayor que 0 o deja el campo vacío.");
      return;
    }
    root.preferences.set(prefKeys.budget(workspace.id), String(budget));
    setBudgetError(null);
  }

  function clearFeedback() {
    setError(null);
    setWarnings([]);
    setApplied(false);
    setBudgetError(null);
  }

  async function apply() {
    if (!workspace) return;
    setApplying(true);
    setError(null);
    setWarnings([]);
    try {
      const { outcome, mcpErrors } = await root
        .provideApplyWorkspaceSettings(client ?? null)
        .execute({
          workspace,
          mcpNames: [...selectedMcps],
          skills: [...selectedSkills.values()],
          model,
          mcps,
        });
      setWarnings(outcome.warnings);
      onWorkspaceUpdated?.(outcome.workspace, outcome.warnings);
      if (mcpErrors.length > 0) setError(mcpErrors[mcpErrors.length - 1]);
      await refreshStatuses();
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setApplying(false);
    }
  }

  async function reapply() {
    if (!workspace) return;
    setReapplying(true);
    setError(null);
    setWarnings([]);
    try {
      const outcome = await root.workspaces.reapplyProfile(workspace.id);
      setSelectedMcps(new Set(outcome.workspace.mcpNames));
      setSelectedSkills(new Map(outcome.workspace.skills.map((skill) => [skill.id, skill])));
      setModel(outcome.workspace.model ?? "");
      setWarnings(outcome.warnings);
      onWorkspaceUpdated?.(outcome.workspace, outcome.warnings);
      setApplied(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReapplying(false);
    }
  }

  return {
    mcps,
    skills: visibleSkills,
    statuses,
    selectedMcps,
    selectedSkills,
    model,
    budgetText,
    budgetError,
    applying,
    reapplying,
    error,
    warnings,
    applied,
    changeModel,
    changeBudget,
    toggleMcp,
    toggleSkill,
    clearFeedback,
    apply,
    reapply,
  };
}
