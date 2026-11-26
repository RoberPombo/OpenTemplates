# Estado de seguridad

Revisión aplicada sobre el repo de OpenTemplates. Lo que depende de una persona
(tokens, claves, settings) queda marcado abajo.

## Aplicado

| Medida | Dónde |
| --- | --- |
| `main` solo por PR, sin force-push ni borrado | ruleset `main solo por PR` |
| `develop` como rama por defecto | settings del repo |
| Secret scanning + push protection | settings del repo |
| Dependabot alerts y security updates | settings del repo |
| Dependabot semanal (npm, cargo, actions) con cooldown de 7 días | `.github/dependabot.yml` |
| Dependencias npm exactas | `.npmrc`, `package.json` |
| Lockfile de Rust commiteado (`Cargo.lock`) | `src-tauri/Cargo.lock` |
| CI con `--frozen-lockfile` y `cargo test --locked` | `pr-check.yml` |
| `persist-credentials: false` en todos los checkouts | workflows |
| `permissions:` mínimos por workflow | workflows |
| Acciones de terceros pinneadas por SHA | workflows |
| CodeQL (JS/TS y Rust, `security-extended`) | `codeql.yml` |
| Auditoría semanal npm + cargo | `security-audit.yml` |
| Updater firmado con clave fuera del repo | `tauri.conf.json`, entorno `release` |
| Secretos de firma solo legibles desde tags `v*.*.*` | entorno `release` + `tauri-release.yml` |
| `Cargo.lock` sincronizado en el PR de release | `release-please.yml` |
| PR de sync `main -> develop` abierto con el PAT de release-please | `sync-develop.yml` |
| `GITHUB_TOKEN` sin permiso para crear PRs | settings de Actions |
| Releases en draft, publicadas tras comprobar duplicados | `tauri-release.yml` |
| Política de reporte y rotación de claves | `SECURITY.md` |
| `frame-src` del preview acotado a `http://localhost:* http://127.0.0.1:*` | `src-tauri/tauri.conf.json` |

## CSP del preview

Decisión (#81): el iframe de la vista previa solo puede cargar servidores locales.
`frame-src` queda en `http://localhost:* http://127.0.0.1:*`; el resto de la CSP no
cambia y el iframe conserva `sandbox="allow-scripts allow-same-origin allow-forms
allow-modals allow-downloads"`. El puerto y la ruta siguen siendo libres porque
cada proyecto de desarrollo usa el suyo (Vite por defecto en `localhost:5173`).

Alcance:

- Preview local por `http://localhost:<puerto>` o `http://127.0.0.1:<puerto>`.
- Un preview remoto (`https://…` u otro host) deja de cargar en el iframe. No se
  amplía la CSP por defecto; si el producto lo necesita, se revisa y se añade una
  allowlist explícita de orígenes, no un comodín `http:`/`https:`.

### Verificación manual

La CSP no se puede validar en CI: hace falta abrir la ventana de Tauri.

1. Arrancar un servidor local en `http://localhost:5173` (por ejemplo, el propio
   `pnpm dev` de un proyecto template).
2. Arrancar la app con `pnpm tauri dev` en una sesión gráfica.
3. Abrir el dock de preview, usar `http://localhost:5173` y comprobar que la página
   se pinta dentro del iframe, sin errores de CSP en la consola del webview.
4. Repetir con una URL remota (por ejemplo `https://example.com`) y comprobar que
   el iframe no carga por la CSP. Ese bloqueo es el comportamiento esperado.

## Pendiente o limitado por el plan

- `secret_scanning_non_provider_patterns` y `secret_scanning_validity_checks`
  siguen desactivados: GitHub los marca como funciones de GHAS de pago.
- CodeQL por defecto (default setup) no soporta Rust; se usa workflow avanzado con
  `build-mode: none` para los dos lenguajes.
- La CSP está activa con `connect-src` acotado a los servidores opencode locales y
  al IPC de Tauri, y `frame-src` acotado a localhost. Falta un arranque manual con
  entorno gráfico para confirmar ambas cosas (en esta máquina no se abre la ventana
  ni con la build anterior); los pasos están en «CSP del preview».

## Depende de una persona

- Rotar `RELEASE_PLEASE_TOKEN` cuando caduque y mantener sus permisos en
  `Contents`, `Pull requests` y `Workflows` (escritura).
- Guardar copia de `~/.config/opentemplates/updater.key` y su contraseña (la
  contraseña en el gestor de contraseñas, no junto a la clave): sin ellas no se
  pueden firmar actualizaciones ni reponer los secretos del entorno `release`.
- Revisar los avisos de Dependabot y de CodeQL cuando lleguen.
