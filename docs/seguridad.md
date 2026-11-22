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
| Dependabot semanal (npm, cargo, actions) con cooldown de 2 días | `.github/dependabot.yml` |
| Dependencias npm exactas | `.npmrc`, `package.json` |
| Lockfile de Rust commiteado (`Cargo.lock`) | `src-tauri/Cargo.lock` |
| CI con `--frozen-lockfile` y `cargo test --locked` | `pr-check.yml` |
| `persist-credentials: false` en todos los checkouts | workflows |
| `permissions:` mínimos por workflow | workflows |
| Acciones de terceros pinneadas por SHA | workflows |
| CodeQL (JS/TS y Rust, `security-extended`) | `codeql.yml` |
| Auditoría semanal npm + cargo | `security-audit.yml` |
| Updater firmado con clave fuera del repo | `tauri.conf.json`, secrets |
| Releases en draft, publicadas tras comprobar duplicados | `tauri-release.yml` |
| Política de reporte y rotación de claves | `SECURITY.md` |

## Pendiente o limitado por el plan

- `secret_scanning_non_provider_patterns` y `secret_scanning_validity_checks`
  siguen desactivados: GitHub los marca como funciones de GHAS de pago.
- CodeQL por defecto (default setup) no soporta Rust; se usa workflow avanzado con
  `build-mode: none` para los dos lenguajes.
- La CSP de la webview sigue en `null` hasta validarla con la app arrancada.

## Depende de una persona

- Rotar `RELEASE_PLEASE_TOKEN` cuando caduque y mantener sus permisos en
  `Contents`, `Pull requests` y `Workflows` (escritura).
- Guardar copia de `~/.config/opentemplates/updater.key` y su contraseña: sin ellas
  no se pueden firmar actualizaciones.
- Revisar los avisos de Dependabot y de CodeQL cuando lleguen.
