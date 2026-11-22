# Seguridad

## Cómo reportar

No abras un issue público para una vulnerabilidad. Usa
[Security → Report a vulnerability](https://github.com/RoberPombo/OpenTemplates/security/advisories/new)
(aviso privado de GitHub). Respondo en unos días y, si el fallo afecta a una
versión publicada, se publica un parche con nota en el release.

## Versiones soportadas

Solo la última release publicada (la que sirve `latest.json`) recibe parches. Las
anteriores se actualizan con el updater.

## Secretos y claves

- Nada de secretos en el repositorio. El escaneo de secretos de GitHub está activo
  con push protection.
- Secrets del repo: `RELEASE_PLEASE_TOKEN` (PAT fine-grained con `Contents`,
  `Pull requests` y `Workflows` en escritura), `TAURI_SIGNING_PRIVATE_KEY` y
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- La clave privada del updater vive fuera del repo, en
  `~/.config/opentemplates/` (permisos 600). La pública está en
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- Si se pierde la clave o su contraseña, las apps instaladas no podrán verificar
  actualizaciones. Hay que generar una clave nueva, publicar una build con la nueva
  `pubkey` y avisar de la reinstalación manual.

## Alcance

La app arranca y controla servidores `opencode` locales. Los puertos, contraseñas
de servidor y datos de sesión se generan en local y no salen de la máquina. El
único tráfico externo previsto es la consulta de actualizaciones a
`github.com/RoberPombo/OpenTemplates/releases`.
