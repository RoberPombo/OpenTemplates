# Releases y actualizaciones automáticas

El pipeline replica el de Economía Casera: `release-please` versiona, `tauri-action`
compila y publica, y la app consulta el updater al arrancar.

## Flujo

1. El trabajo entra en `develop` por PR desde una rama de feature.
2. `release-please` (push a `main`) mantiene abierto un PR de release que sube la
   versión en `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
   y `.release-please-manifest.json`, y escribe `CHANGELOG.md`. Un paso posterior
   de `release-please.yml` sincroniza `src-tauri/Cargo.lock` en la misma PR: el
   updater TOML de release-please no puede filtrar entradas de un array, y sin
   ese paso `cargo test --locked` falla en el PR de release.
3. Al mergear ese PR en `main`, `release-please` crea el tag `vX.Y.Z` y un draft
   de release.
4. El tag dispara `.github/workflows/tauri-release.yml`: compila Linux (deb),
   Windows (NSIS) y macOS arm64 (dmg + app), firma los artefactos con la clave del
   updater, sube los binarios y `latest.json`, y publica el draft.
5. `sync-develop.yml` abre un PR `main -> develop` para devolver los cambios de
   versión al desarrollo (merge normal, nunca squash).
6. La app instalada consulta al arrancar
   `https://github.com/RoberPombo/OpenTemplates/releases/latest/download/latest.json`
   y muestra el diálogo de actualización si la versión publicada es mayor.

Versiones: `feat` sube versión, `fix`/`perf`/`refactor` también (con
`bump-patch-for-minor-pre-major` un `feat` en 0.x sube patch), y un `BREAKING
CHANGE` sube minor en vez de saltar a 1.0.0 (`bump-minor-pre-major`). Los commits
deben seguir Conventional Commits para que el CHANGELOG y el salto salgan bien.

**La 1.0.0 no es automática**: mientras falten piezas por pulir nos quedamos en
0.x. Para publicarla habrá que quitarlo a mano en `.release-please-config.json` y
en `.release-please-manifest.json`.

## Ajustes del repositorio que el pipeline necesita

- Rama por defecto: `develop` (las releases se abren contra `main`, por eso el
  workflow pasa `target-branch: main` al action).
- Ruleset de `main`: PR obligatorio, sin force-push y sin borrado.
- Settings → Actions → General: *Workflow permissions* en **Read repository
  contents**, y **Allow GitHub Actions to create and approve pull requests**
  desmarcado. Por eso `sync-develop.yml` abre su PR con `RELEASE_PLEASE_TOKEN`:
  con ese ajuste apagado, `GITHUB_TOKEN` no puede crear PRs.
- Entorno `release` con *deployment branch policy* de tipo tag `v*.*.*` y **sin
  required reviewers** (los reviewers bloquearían cada tag y `Release Binaries`
  no arrancaría). El job `build-and-attach` declara `environment: release`; ningún
  otro workflow lo declara.

## Secretos del repositorio

| Secreto | Nivel | Para qué |
| --- | --- | --- |
| `RELEASE_PLEASE_TOKEN` | repositorio | PAT con `contents: write` y `pull-requests: write`. Necesario porque los tags creados con `GITHUB_TOKEN` no disparan otros workflows; también abre el PR de sync. |
| `TAURI_SIGNING_PRIVATE_KEY` | entorno `release` | Clave privada minisign que firma los artefactos del updater. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | entorno `release` | Contraseña de esa clave. |

No debe quedar ninguna copia de los secretos de firma a nivel de repositorio: si
existen, bórralas en cuanto el release funcione con el entorno.

La clave vive fuera del repo, en `~/.config/opentemplates/updater.key` (y su
contraseña en `updater.key.password`, ambos con permisos 600). La pública está en
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). **Si se pierde la clave o
la contraseña, ninguna app instalada podrá aceptar actualizaciones** hasta
publicar una build con una clave nueva, y habrá que reinstalar a mano.

## Probar una release

```bash
# 1. provoca un cambio con tipo release en develop y mergea a main
git switch -c chore/prueba-release develop
git commit --allow-empty -m "fix: probar el pipeline de release"
# PR a develop, merge; PR de develop a main, merge
# 2. release-please abrirá "chore(main): release 0.1.1"; mergealo
# 3. sigue el run de "Release Binaries" hasta que publique el draft
```

La release debe quedar publicada (no draft) para que `releases/latest/download`
sirva `latest.json`. Los assets de un repo privado exigirían autenticación: el
updater solo funciona con el repositorio público o con un endpoint propio.

## Actualizaciones en local

`pnpm tauri build` sin `TAURI_SIGNING_PRIVATE_KEY` no genera `.sig`; para probar
el updater en local hay que exportar la clave y su contraseña antes de compilar.
