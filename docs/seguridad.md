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
| `preview_probe` solo alcanza loopback; artefactos con tope de 1 MiB | `src-tauri/src/preview.rs`, `src-tauri/src/artifacts.rs` |

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

## Preview: modelo de confianza y SSRF (#83)

El sondeo del preview (`preview_probe`) corre en Rust, fuera del sandbox del
webview, así que es una vía clásica de SSRF. La política se alinea con la CSP de
#81: **el preview es local y el sondeo no puede alcanzar nada que no sea
loopback**.

Qué se valida en `src-tauri/src/preview.rs`:

- Esquema `http://` o `https://`, sin usuario ni contraseña, sin espacios ni
  caracteres de control en host o ruta.
- Host permitido: `localhost` (sin distinguir mayúsculas), cualquier dirección
  de `127.0.0.0/8`, `::1` y su forma IPv4 mapeada en IPv6 (`::ffff:127.0.0.1`).
  Cualquier otro nombre se rechaza **antes de resolver DNS**; las IPs literales
  privadas, link-local, multicast, `0.0.0.0` y `::` se rechazan con un error
  legible que dice qué son.
- Resolución defensiva: tras resolver el nombre, **todas** las direcciones deben
  ser de loopback y se conecta a esas direcciones ya resueltas, sin volver a
  resolver. Un `localhost` manipulado en `/etc/hosts` o un intento de DNS
  rebinding no llega a abrir el socket.
- Redirecciones: **no se siguen**. Si un `3xx` trae un `Location` absoluto o
  protocol-relative (`//host/...`) fuera de loopback, el sondeo falla con
  «El preview redirige a … fuera de loopback»; una ruta relativa se queda en el
  mismo origen ya validado y se devuelve el `3xx` sin seguirlo.
- Límites: timeout de conexión de 2 s, de E/S de 3 s, respuesta máxima de
  128 KiB y título recortado a 120 caracteres.

**Preview remoto:** no está soportado y no se habilita por comodín. Si algún día
el producto lo necesita, hace falta una allowlist explícita de `host:puerto` en
este módulo **y** ampliar `frame-src` en la CSP; ambas cosas se revisan juntas.

Limitaciones asumidas:

- Un webview comprometido todavía puede escanear puertos de loopback y hacer un
  `GET` a servicios locales (Vite, opencode, etc.). El sondeo no reenvía cookies
  ni cuerpo, descarta la respuesta salvo estado, cabeceras de marco y título, y
  acota tiempos y tamaño; el riesgo residual es el propio de un preview local.
- Para `https` solo se comprueba que el puerto acepta conexión: no hay handshake
  TLS ni validación de certificado (`verified: false` en el resultado).
- `open_external` mantiene la validación de URL http(s) pero no exige loopback:
  delega en el navegador del usuario, no hace la petición la app.
- La comprobación es del backend. La CSP sigue siendo la barrera del iframe; una
  URL remota se sondea con error y no se embebe.

Tests de regresión en `preview.rs`: host remoto, IP privada, link-local,
redirección absoluta a otro host, redirección protocol-relative a IP privada,
redirección relativa permitida y sondeo feliz contra un servidor HTTP en
`127.0.0.1`.

## Artefactos de feature

`write_feature_artifact` solo escribe nombres de la allowlist (`BRIEF.md`,
`DECOMPOSITION.md`, `NOTES.md` y prefijos `RECON-`/`PLAN-`/`VERIFY-`), en la
carpeta de la feature y sin `..` ni separadores. Además, el contenido se mide en
bytes UTF-8 **antes** de crear el directorio o escribir: más de 1 MiB devuelve
error y no deja fichero. Los artefactos son notas de coordinación, no adjuntos.

La lectura (`feature_artifacts`) sigue mostrando lo que ya exista en disco,
aunque se haya creado fuera de la app o supere el tope; el límite aplica a las
escrituras que pasan por el comando.

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
