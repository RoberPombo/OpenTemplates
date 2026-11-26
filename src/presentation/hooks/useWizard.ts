/**
 * Estado y acciones del wizard de creación de workspaces.
 *
 * Las reglas puras (slug, rama/ruta por defecto, conflictos y validación por
 * paso) siguen viviendo en `domain/workspace/wizard`; este hook solo mantiene
 * el formulario, orquesta los puertos y expone los derivados a la vista.
 */
import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { errorText, toggleMapValue, toggleSetValue } from "../../domain/shared";
import {
  canContinue as canContinueStep,
  defaultBranch as branchDefault,
  defaultWorktreePath,
  pathConflicts as findPathConflicts,
  principalConflicts as findPrincipalConflicts,
  quickProfileId,
  slugify,
  workspaceNameError,
} from "../../domain/workspace/wizard";
import type {
  CreateWorkspaceInput,
  Library,
  ProfileManifest,
  Repo,
  SkillRef,
  Workspace,
} from "../../types";

export type UseWizardInput = {
  repos: Repo[];
  profiles: ProfileManifest[];
  workspaces: Workspace[];
  worktreesRoot: string;
  onRepoAdded: (repo: Repo) => void;
  onProfileSaved: (profile: ProfileManifest) => void;
  onCreated: (workspace: Workspace, warnings: string[], startNow: boolean) => void;
};

export function useWizard({
  repos,
  profiles,
  workspaces,
  worktreesRoot,
  onRepoAdded,
  onProfileSaved,
  onCreated,
}: UseWizardInput) {
  const root = useAppContext();
  const [step, setStep] = useState(0);
  const [loose, setLoose] = useState(repos.length === 0);
  const [repoId, setRepoId] = useState<string | null>(repos[0]?.id ?? null);
  const [loosePath, setLoosePath] = useState("");
  const [profileId, setProfileId] = useState<string | null>(profiles[0]?.id ?? null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"principal" | "worktree">("worktree");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [fetchRemote, setFetchRemote] = useState(false);
  const [useExisting, setUseExisting] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set());
  const [selectedSkills, setSelectedSkills] = useState<Map<string, SkillRef>>(new Map());
  const [startNow, setStartNow] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickDescription, setQuickDescription] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repo = repos.find((item) => item.id === repoId) ?? null;
  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const slug = slugify(name);
  const defaultBranch = branchDefault(slug);
  const defaultPath = repo ? defaultWorktreePath(worktreesRoot, repo.name, slug) : "";

  const principalConflicts = repo ? findPrincipalConflicts(workspaces, repo.id) : [];
  const pathConflicts = repo ? findPathConflicts(workspaces, repo.path) : [];

  function selectRepo(id: string) {
    setRepoId(id);
    setLoose(false);
    setError(null);
  }

  function selectLoose() {
    setLoose(true);
    setError(null);
  }

  async function pickRepo() {
    try {
      const picked = await root.folderPicker.pickDirectory("Elegir repositorio git");
      if (!picked) return;
      const added = await root.repos.add(picked);
      onRepoAdded(added);
      selectRepo(added.id);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function pickLooseFolder() {
    const picked = await root.folderPicker.pickDirectory("Elegir carpeta del proyecto");
    if (picked) {
      setLoose(true);
      setLoosePath(picked);
      setError(null);
    }
  }

  async function createQuickProfile() {
    const result = quickProfileId(
      quickName,
      profiles.map((item) => item.id),
    );
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const id = result.id;
    setSavingProfile(true);
    setError(null);
    try {
      const now = Date.now();
      const saved = await root.profiles.save({
        id,
        name: quickName.trim(),
        description: quickDescription.trim(),
        version: 1,
        agents: [],
        skills: [...selectedSkills.keys()],
        mcps: [...selectedMcps],
        commands: [],
        plugins: [],
        models: [],
        model: null,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      });
      onProfileSaved(saved);
      setProfileId(saved.id);
      setQuickOpen(false);
      setQuickName("");
      setQuickDescription("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingProfile(false);
    }
  }

  function toggleMcp(mcpName: string) {
    setSelectedMcps((prev) => toggleSetValue(prev, mcpName));
  }

  function toggleSkill(skill: Library["skills"][number]) {
    setSelectedSkills((prev) => toggleMapValue(prev, skill.id, { id: skill.id, path: skill.path }));
  }

  function toggleFetchRemote() {
    setFetchRemote((value) => !value);
  }

  function toggleUseExisting() {
    setUseExisting((value) => !value);
  }

  function toggleStartNow() {
    setStartNow((value) => !value);
  }

  function toggleQuickOpen() {
    setQuickOpen((value) => !value);
  }

  function goToStep(index: number) {
    if (index >= step) return;
    setStep(index);
    setError(null);
  }

  function next() {
    setStep((value) => value + 1);
  }

  function back() {
    setStep((value) => value - 1);
    setError(null);
  }

  function canContinue() {
    return canContinueStep(step, { loose, loosePath, repoId, name, mode, useExisting, branch });
  }

  async function create() {
    const nameError = workspaceNameError(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    const isWorktree = !loose && mode === "worktree";
    const input: CreateWorkspaceInput = {
      name: name.trim(),
      repoId: loose ? null : repoId,
      projectPath: loose ? loosePath : null,
      // El perfil también aplica a carpetas sueltas: define agentes, skills y MCPs.
      profileId,
      mode: loose ? "adhoc" : mode,
      branch: isWorktree ? branch.trim() || null : null,
      base: isWorktree ? base.trim() || null : null,
      worktreePath: isWorktree ? worktreePath.trim() || null : null,
      useExistingBranch: useExisting,
      fetch: fetchRemote,
      mcpNames: profileId ? [] : [...selectedMcps],
      skills: profileId ? [] : [...selectedSkills.values()],
      model: null,
    };
    setSubmitting(true);
    setError(null);
    try {
      const outcome = await root.provideCreateWorkspace().execute(input);
      onCreated(outcome.workspace, outcome.warnings, startNow);
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return {
    step,
    loose,
    repoId,
    loosePath,
    profileId,
    name,
    mode,
    branch,
    base,
    worktreePath,
    fetchRemote,
    useExisting,
    selectedMcps,
    selectedSkills,
    startNow,
    quickOpen,
    quickName,
    quickDescription,
    savingProfile,
    submitting,
    error,
    repo,
    profile,
    slug,
    quickSlug: slugify(quickName),
    defaultBranch,
    defaultPath,
    principalConflicts,
    pathConflicts,
    selectRepo,
    selectLoose,
    setLoosePath,
    setProfileId,
    setName,
    setMode,
    setBranch,
    setBase,
    setWorktreePath,
    toggleFetchRemote,
    toggleUseExisting,
    toggleStartNow,
    toggleQuickOpen,
    setQuickName,
    setQuickDescription,
    toggleMcp,
    toggleSkill,
    pickRepo,
    pickLooseFolder,
    createQuickProfile,
    goToStep,
    next,
    back,
    canContinue,
    create,
  };
}
