/** Paso 4 del wizard: resumen de la configuración antes de crear. */
import type { ProfileManifest, Repo, SkillRef, Workspace } from "../../../types";
import { CheckboxRow } from "./chrome";

type Props = {
  name: string;
  loose: boolean;
  loosePath: string;
  repo: Repo | null;
  mode: "principal" | "worktree";
  worktreePath: string;
  defaultPath: string;
  branch: string;
  base: string;
  defaultBranch: string;
  profile: ProfileManifest | null;
  selectedMcps: Set<string>;
  selectedSkills: Map<string, SkillRef>;
  pathConflicts: Workspace[];
  startNow: boolean;
  onToggleStartNow: () => void;
};

export function SummaryStep({
  name,
  loose,
  loosePath,
  repo,
  mode,
  worktreePath,
  defaultPath,
  branch,
  base,
  defaultBranch,
  profile,
  selectedMcps,
  selectedSkills,
  pathConflicts,
  startNow,
  onToggleStartNow,
}: Props) {
  return (
    <section className="wizard-pane">
      <div className="section-head">
        <h3>Resumen</h3>
      </div>
      <dl className="summary">
        <div>
          <dt>Nombre</dt>
          <dd>{name.trim() || "—"}</dd>
        </div>
        <div>
          <dt>Repo</dt>
          <dd>{loose ? "Sin repo (ad-hoc)" : (repo?.name ?? "—")}</dd>
        </div>
        <div>
          <dt>Carpeta</dt>
          <dd>
            {loose
              ? loosePath || "—"
              : mode === "principal"
                ? (repo?.path ?? "—")
                : worktreePath.trim() || defaultPath || "—"}
          </dd>
        </div>
        <div>
          <dt>Modo</dt>
          <dd>{loose ? "ad-hoc" : mode}</dd>
        </div>
        {!loose && mode === "worktree" && (
          <>
            <div>
              <dt>Rama</dt>
              <dd>{branch.trim() || defaultBranch}</dd>
            </div>
            <div>
              <dt>Base</dt>
              <dd>
                {base.trim() ||
                  (repo?.remote ? `origin/${repo.mainBranch}` : repo?.mainBranch || "—")}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Profile</dt>
          <dd>{profile ? `${profile.name} · v${profile.version}` : "Sin perfil"}</dd>
        </div>
        <div>
          <dt>Selección</dt>
          <dd>
            {profile
              ? `${profile.agents.length} agentes · ${profile.skills.length} skills · ${profile.mcps.length} MCPs`
              : `${selectedMcps.size} MCPs · ${selectedSkills.size} skills`}
          </dd>
        </div>
      </dl>

      {pathConflicts.length > 0 && (
        <div className="callout warning">
          La carpeta del checkout principal ya la usa{" "}
          {pathConflicts.map((workspace) => `«${workspace.name}»`).join(", ")}. Puedes continuar,
          pero los dos procesos compartirán ficheros.
        </div>
      )}

      <CheckboxRow
        checked={startNow}
        title="Arrancar el servidor al crear"
        subtitle="Lanza opencode con la config recién materializada."
        onChange={onToggleStartNow}
      />
    </section>
  );
}
