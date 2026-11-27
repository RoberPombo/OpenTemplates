/**
 * Flujo git del panel de cambios: estado por fichero con stage, rama/upstream,
 * ahead/behind, guardas de commit y push. Todo es puro: el adaptador recibe la
 * salida cruda de git y aquí se parsea y se decide qué se puede hacer.
 *
 * Reglas duras que también aplica Rust:
 * - nunca se commitea sin cambios preparados ni sin mensaje;
 * - nunca se usa `--no-verify` ni `--force`;
 * - un hook que falla se muestra y detiene el flujo.
 */

/** Estado visible de un fichero, ya resuelto a partir de los códigos XY. */
export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflicted"
  | "untracked"
  | "typechange";

/** Fila del listado de git status, con su lado staged y su lado de trabajo. */
export type GitFileEntry = {
  path: string;
  /** Ruta anterior en renombrados y copias. */
  oldPath: string | null;
  status: GitFileStatus;
  /** Código del índice (X); `null` si no hay cambio preparado. */
  index: string | null;
  /** Código del árbol de trabajo (Y); `null` si no hay cambio pendiente. */
  worktree: string | null;
  /** Hay cambios en el índice que entrarían en el commit. */
  staged: boolean;
  additions: number;
  deletions: number;
  binary: boolean;
};

/** Resumen del repositorio que acompaña al listado. */
export type GitStatus = {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remote: string | null;
  mainBranch: string;
  files: GitFileEntry[];
};

/** Estadísticas de un fichero no rastreado que calcula Rust al leerlo. */
export type GitUntrackedStat = {
  path: string;
  additions: number;
  binary: boolean;
};

/**
 * Salida cruda del comando `git_status`. El parseo vive en el dominio para
 * poder probarlo sin repositorio ni Tauri.
 */
export type GitStatusRaw = {
  branch: string | null;
  upstream: string | null;
  /** Salida de `rev-list --left-right --count HEAD...@{upstream}`. */
  aheadBehind: string | null;
  remote: string | null;
  mainBranch: string;
  /** `git status --porcelain=v1 -z --untracked-files=all`. */
  porcelain: string;
  /** `git diff HEAD --numstat -z`; incluye staged y no staged. */
  numstat: string;
  untrackedStats: GitUntrackedStat[];
};

export type GitLineStat = { additions: number; deletions: number; binary: boolean };

export type GitCommit = { hash: string; subject: string; body: string };

export type GitCommitResult = { oid: string };

/** Resultado de aplicar los cambios de un worktree sobre el workspace. */
export type GitMergeResult = {
  status: "merged" | "empty" | "conflict";
  files: number;
  additions: number;
  deletions: number;
  conflicts: string[];
  message: string | null;
};

export type GitPushResult = { branch: string; remote: string; upstream: string | null };

export type GitPushTarget = {
  branch: string;
  setUpstream: boolean;
  remote: string;
  /** Texto para el botón, con la rama visible. */
  label: string;
};

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function fileStatusOf(index: string, worktree: string): GitFileStatus {
  if (index === "?" && worktree === "?") return "untracked";
  if (CONFLICT_CODES.has(`${index}${worktree}`)) return "conflicted";
  if (index === "R" || worktree === "R") return "renamed";
  if (index === "C" || worktree === "C") return "copied";
  if (index === "A" || worktree === "A") return "added";
  if (index === "D" || worktree === "D") return "deleted";
  if (index === "T" || worktree === "T") return "typechange";
  return "modified";
}

/**
 * Parsea `git status --porcelain=v1 -z --untracked-files=all`.
 * En modo `-z` un renombrado ocupa dos registros: primero la ruta nueva y
 * después la antigua, sin comillas ni escapes.
 */
export function parsePorcelainStatus(raw: string): GitFileEntry[] {
  const tokens = raw.split("\0");
  const files: GitFileEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) continue;

    const indexCode = token[0] ?? " ";
    const worktreeCode = token[1] ?? " ";
    // `!!` son ignorados: no ensucian el flujo de commit.
    if (indexCode === "!" && worktreeCode === "!") continue;

    const path = token.slice(3);
    let oldPath: string | null = null;
    if (indexCode === "R" || indexCode === "C" || worktreeCode === "R" || worktreeCode === "C") {
      const previous = tokens[index + 1];
      if (previous !== undefined) {
        oldPath = previous;
        index += 1;
      }
    }

    const untracked = indexCode === "?" && worktreeCode === "?";
    files.push({
      path,
      oldPath,
      status: fileStatusOf(indexCode, worktreeCode),
      index: untracked || indexCode === " " ? null : indexCode,
      worktree: untracked || worktreeCode === " " ? null : worktreeCode,
      staged: !untracked && indexCode !== " " && indexCode !== "!",
      additions: 0,
      deletions: 0,
      binary: false,
    });
  }

  return files;
}

/**
 * Parsea `git diff --numstat -z`. Un renombrado trae la ruta vacía y después
 * las dos rutas como registros separados; se indexa por la ruta nueva.
 */
export function parseNumstat(raw: string): Map<string, GitLineStat> {
  const stats = new Map<string, GitLineStat>();
  const tokens = raw.split("\0");

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const firstTab = token.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : token.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;

    const additions = token.slice(0, firstTab);
    const deletions = token.slice(firstTab + 1, secondTab);
    let path = token.slice(secondTab + 1);

    if (path === "") {
      // Renombrado/copia: el tercer campo vacío y luego las dos rutas.
      const next = tokens[index + 2];
      if (next === undefined) break;
      path = next;
      index += 2;
    }

    const binary = additions === "-" || deletions === "-";
    stats.set(path, {
      additions: binary ? 0 : Number(additions) || 0,
      deletions: binary ? 0 : Number(deletions) || 0,
      binary,
    });
  }

  return stats;
}

/** `git rev-list --left-right --count HEAD...@{upstream}`: primero ahead. */
export function parseAheadBehind(raw: string | null): { ahead: number; behind: number } {
  if (!raw) return { ahead: 0, behind: 0 };
  const [ahead, behind] = raw.trim().split(/\s+/);
  return {
    ahead: Number.isFinite(Number(ahead)) ? Number(ahead) : 0,
    behind: Number.isFinite(Number(behind)) ? Number(behind) : 0,
  };
}

/** Cruza el estado de git con las estadísticas de líneas. */
export function buildGitStatus(raw: GitStatusRaw): GitStatus {
  const lineStats = parseNumstat(raw.numstat);
  const untracked = new Map(raw.untrackedStats.map((stat) => [stat.path, stat]));
  const files = parsePorcelainStatus(raw.porcelain).map((file) => {
    const lines = lineStats.get(file.path);
    const untrackedStat = untracked.get(file.path);
    if (lines) return { ...file, ...lines };
    if (untrackedStat) {
      return {
        ...file,
        additions: untrackedStat.additions,
        deletions: 0,
        binary: untrackedStat.binary,
      };
    }
    return file;
  });
  const { ahead, behind } = parseAheadBehind(raw.aheadBehind);
  return {
    branch: raw.branch,
    upstream: raw.upstream,
    ahead,
    behind,
    remote: raw.remote,
    mainBranch: raw.mainBranch,
    files,
  };
}

export function gitFileStatusLabel(status: GitFileStatus): string {
  switch (status) {
    case "added":
      return "añadido";
    case "modified":
      return "modificado";
    case "deleted":
      return "borrado";
    case "renamed":
      return "renombrado";
    case "copied":
      return "copiado";
    case "conflicted":
      return "conflicto";
    case "untracked":
      return "sin seguimiento";
    case "typechange":
      return "tipo cambiado";
  }
}

export function gitFileStatusCode(status: GitFileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "conflicted":
      return "U";
    case "untracked":
      return "?";
    case "typechange":
      return "T";
  }
}

/** Cambios que no entrarían en el commit tal como está el índice. */
export function unstagedFiles(status: GitStatus): GitFileEntry[] {
  return status.files.filter((file) => file.status === "untracked" || file.worktree !== null);
}

export function stagedFiles(status: GitStatus): GitFileEntry[] {
  return status.files.filter((file) => file.staged);
}

export function statusTotals(status: GitStatus): {
  files: number;
  staged: number;
  additions: number;
  deletions: number;
} {
  return status.files.reduce(
    (totals, file) => ({
      files: totals.files + 1,
      staged: totals.staged + (file.staged ? 1 : 0),
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { files: 0, staged: 0, additions: 0, deletions: 0 },
  );
}

export type CommitCheck =
  | { ok: true; unstaged: string[] }
  | {
      ok: false;
      error: string;
      /** Hay ficheros sin preparar y el usuario aún no lo ha confirmado. */
      needsConfirmation?: boolean;
      unstaged?: string[];
    };

/**
 * Guarda previa al commit. Confirma si quedan cambios sin preparar para que no
 * se commitee por accidente lo que el usuario no ha revisado.
 */
export function checkCommit(
  status: GitStatus,
  message: string,
  options: { confirmedUnstaged?: boolean } = {},
): CommitCheck {
  if (!message.trim()) {
    return { ok: false, error: "Escribe un mensaje de commit." };
  }
  const staged = stagedFiles(status);
  if (staged.length === 0) {
    return { ok: false, error: "No hay cambios preparados para el commit." };
  }
  const conflicts = status.files.filter((file) => file.status === "conflicted");
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: `Resuelve los conflictos antes de commitear: ${conflicts
        .map((file) => file.path)
        .join(", ")}.`,
    };
  }
  const unstaged = unstagedFiles(status).map((file) => file.path);
  if (unstaged.length > 0 && !options.confirmedUnstaged) {
    return {
      ok: false,
      needsConfirmation: true,
      unstaged,
      error: `Quedan ${unstaged.length} archivo(s) sin preparar que no entrarán en el commit.`,
    };
  }
  return { ok: true, unstaged };
}

/** Destino del push: publica la rama con `-u` solo si aún no tiene upstream. */
export function pushTarget(status: GitStatus): GitPushTarget | { error: string } {
  if (!status.branch) {
    return { error: "La rama está desacoplada; cambia a una rama antes de publicar." };
  }
  const remote = status.upstream?.split("/")[0] || "origin";
  if (status.upstream) {
    return {
      branch: status.branch,
      setUpstream: false,
      remote,
      label: `Push a ${status.upstream}`,
    };
  }
  return {
    branch: status.branch,
    setUpstream: true,
    remote,
    label: `Publicar rama (push -u ${remote}/${status.branch})`,
  };
}

/** Instrucción para `generate.text`; el diff staged se recorta si es enorme. */
export function commitMessagePrompt(diff: string, limit = 12_000): string {
  const visible =
    diff.length > limit ? `${diff.slice(0, limit)}\n\n[diff recortado por tamaño]` : diff;
  return [
    "Genera un mensaje de commit para el diff preparado que viene al final.",
    "Usa conventional commits en español cuando tenga sentido (feat, fix, docs, test, chore…).",
    "Primera línea de 72 caracteres como máximo; añade cuerpo solo si aporta contexto.",
    "Responde únicamente con el mensaje, sin comillas ni bloques de código.",
    "",
    visible,
  ].join("\n");
}
