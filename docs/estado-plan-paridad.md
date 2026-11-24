# Estado del plan de paridad con OpenChamber / OpenCode Desktop

Instantánea para retomar el trabajo sin releer las sesiones. Actualizado: 2026-11-24,
sobre `develop` en `2d70b92`.

El análisis de origen está en `docs/analisis-openchamber-opencode-desktop.md` y el
detalle de cada entrega, en `docs/handoff.md` (secciones «Estado tras #N»).

## Qué se ha entregado

13 de las 15 features de la fase 1 y 2, todas mergeadas en `develop`:

| PR | Feature | Punto clave de la implementación |
|---|---|---|
| #27 | Historial de sesiones | `session.list` por `directory`; panel con búsqueda, renombrar y borrar |
| #28 | Permisos y preguntas | `permission.list/reply` + `session.form.*` en un dock sobre el composer |
| #33 | Diff y ficheros | `session.diff` + `vcs.*` + `file.*`; pestañas en el Inspector |
| #34 | Comandos y skills | `command.list` + `session.command`; menú `/` en el composer |
| #35 | Notificaciones | `tauri-plugin-notification`; solo sin foco y con throttle |
| #36 | Uso por workspace | `session.stats`; rangos, desglose por modelo y presupuesto |
| #37 | Export/import/fork | `session.export/import/fork`; comandos Tauri para leer/escribir JSON |
| #38 | Terminal y MCP | PTY por WebSocket con ticket + xterm; `mcp.connect/disconnect` |
| #39 | Objetivos de sesión | `generate.decisions` (continue/done/blocked) con guardas duras |
| #40 | Multi-run | N sesiones en worktrees distintos del mismo servidor; elegir ganadora |
| #41 | Paleta, atajos y temas | Catálogo declarativo de acciones + tokens de tema claro/oscuro |
| #42 | Git y PR | Stage selectivo, commit, push y tarjeta de PR con `gh` |
| #43 | Preview | Dock inferior con URL/puerto, dispositivos y envío al agente |

Decisiones que conviene no reabrir sin motivo:

- La evaluación de objetivos usa `generate.decisions`, no heurísticas de texto.
- Multi-run usa un solo proceso de workspace con sesiones en directorios distintos,
  no N procesos.
- El preview no inspecciona el DOM: el selector de elemento necesita proxy propio o
  multiwebview con Wayland (`docs/preview-viabilidad.md`).
- Los permisos se responden en el dock; no se relajan en el template.

## Qué queda

Dentro del producto actual, por orden de valor:

1. **Fusionar la ganadora de una carrera** (M). `Race.merge` está reservado en el
   dominio; hoy se elige ganadora y se descartan las perdedoras sin integrar la rama.
2. **Issues de GitHub con `gh`** (M). `ISSUE.md` ya se materializa si llega un
   `IssueRef`; falta el selector de issues en el wizard.
3. **Selector de elemento en preview** (L). Requiere proxy propio o multiwebview con
   soporte Wayland; incluye screenshot y consola.
4. **Archivar sesiones** (S). El listado ya excluye archivadas; falta el gesto.
5. **Reparar workspaces `missing`** (S). Recrear el worktree desde el estado guardado.
6. **Overrides de modelo/agente por workspace** (S). Hoy se editan en el template.
7. **Editor de atajos** (S). El dominio resuelve conflictos; falta persistir
   combinaciones por usuario.
8. **Pill de todos** (S). El SDK lo tiene detrás del flag experimental `todo`:
   decidir si se activa por workspace antes de construir la UI.

Fuera de alcance a propósito: tareas programadas (#16), acceso remoto y móvil, voz,
walkthrough del diff y marketplace de templates.

## Lo que no está verificado a mano

- Crear la PR desde la tarjeta de #42 contra GitHub real (los comandos y checks se
  validaron con mocks; la PR de esa entrega se abrió con `gh` desde la terminal).
- Recorrer el preview de #43 en un workspace con datos reales (solo se comprobó que
  el iframe pinta con la CSP nueva).
- La app completa en Wayland con terminal y preview abiertos a la vez.

## Cómo retomar

```bash
git checkout develop && git pull
pnpm install
pnpm check          # typecheck + lint + format + tests
cd src-tauri && cargo test
```

Para una feature nueva: rama desde `develop`, commits en español con prefijo
convencional, `pnpm check` en verde, PR a `develop` y actualizar `docs/handoff.md`.
Verificar los endpoints nuevos contra un `opencode serve` real con env limpio
(`env -i PATH=... HOME=/tmp/x XDG_CONFIG_HOME=/tmp/x/xdg OPENCODE_DB=/tmp/x/db
OPENCODE_SERVER_PASSWORD=test opencode serve --port 462X --hostname 127.0.0.1`,
auth Basic `opencode:test`); el shell hereda variables de OpenChamber que rompen la
autenticación.
