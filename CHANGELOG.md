# Changelog

## [0.2.1](https://github.com/RoberPombo/OpenTemplates/compare/v0.2.0...v0.2.1) (2026-11-22)


### Bug Fixes

* **ci:** cargo test sin --locked ([34bde53](https://github.com/RoberPombo/OpenTemplates/commit/34bde5368ed72b2bda00b8a4ca2c25b73398e95e))
* **ci:** cargo test sin --locked en PRs de release ([faf84cb](https://github.com/RoberPombo/OpenTemplates/commit/faf84cbbe3a027d1429c9b45e635247eecf75d52))


### Documentation

* **release:** anotar los ajustes de repo que necesita el pipeline ([94ab766](https://github.com/RoberPombo/OpenTemplates/commit/94ab76623eb75704026bd5a3bed3ddc4b071b2fb))
* **security:** CodeQL, SECURITY.md y checklist ([d9eeb46](https://github.com/RoberPombo/OpenTemplates/commit/d9eeb465506637e5738f740f1b4cd3bd9c921371))
* **security:** CSP activa pendiente de validación manual ([8ce88fb](https://github.com/RoberPombo/OpenTemplates/commit/8ce88fb4cda338ff871d3f97c9c2fcb5300a2ac4))
* **security:** política de reporte, CodeQL y checklist de seguridad ([8a35db4](https://github.com/RoberPombo/OpenTemplates/commit/8a35db4903fbae0558e94f31c4ff83dd43b39de3))


### Continuous Integration

* bump pnpm/action-setup from 6.1.0 to 6.1.1 ([0fa8707](https://github.com/RoberPombo/OpenTemplates/commit/0fa8707dee527fe00149395afa482bf655b38565))
* rust-cache 2.9.3 y tauri-action 1.0.0 ([218e509](https://github.com/RoberPombo/OpenTemplates/commit/218e5094b1316b8d8b44365a557f14fa3caccf57))
* **security:** correr cargo audit directo, sin el check-run del action ([e3b79b0](https://github.com/RoberPombo/OpenTemplates/commit/e3b79b001dd0014ef15cf3b578f931c9c7e57f42))
* **security:** lockfiles congelados y auditoría semanal ([cbf1241](https://github.com/RoberPombo/OpenTemplates/commit/cbf1241b38cf1c1b375159fcdda6ff427b457839))
* **security:** lockfiles congelados, credenciales fuera del checkout y auditoría semanal ([33ac819](https://github.com/RoberPombo/OpenTemplates/commit/33ac8191f9d9655fbc79bfa8edeef77ba35db056))
* subir rust-cache a v2.9.3 y tauri-action a v1.0.0 ([fa09328](https://github.com/RoberPombo/OpenTemplates/commit/fa09328caa61e011ffe50b94aef5ba67b041ff8b))


### Chores

* **deps:** bump dirs from 6.0.0 to 7.0.0 in /src-tauri ([be0bace](https://github.com/RoberPombo/OpenTemplates/commit/be0bacedc92e1ab3b7d6cd7b96e2e265de8950d0))
* **deps:** bump dirs from 6.0.0 to 7.0.0 in /src-tauri ([2d7eef0](https://github.com/RoberPombo/OpenTemplates/commit/2d7eef0252605db92bb7c2f8c66144e4e94c5077))
* **deps:** bump json5 from 0.4.1 to 1.3.7 in /src-tauri ([9778eb1](https://github.com/RoberPombo/OpenTemplates/commit/9778eb1635dc51f2a286ef04e61a5f69de983cfc))
* **deps:** bump reqwest from 0.12.28 to 0.13.5 in /src-tauri ([12f0ee0](https://github.com/RoberPombo/OpenTemplates/commit/12f0ee0fdbf3b4438dd73a8920428352592026d8))
* **deps:** bump which from 7.0.3 to 8.0.6 in /src-tauri ([0f4eb74](https://github.com/RoberPombo/OpenTemplates/commit/0f4eb742a152d3c39ff603dbf72e1599dc624a9b))
* **deps:** versiones npm exactas y cargo test en CI ([e8b4c08](https://github.com/RoberPombo/OpenTemplates/commit/e8b4c087cf6fc6d5b7465500d1bac679c4ceb91f))
* **deps:** versiones npm exactas y tests de Rust en CI ([35e3eba](https://github.com/RoberPombo/OpenTemplates/commit/35e3eba702a789b636d5d277cbe43a4311c12be5))
* **release:** quedarse en 0.x hasta que toque la 1.0.0 ([eda108e](https://github.com/RoberPombo/OpenTemplates/commit/eda108e0a8c49d28ac5f5b06ad2072942b46d3cd))
* sync main into develop after release ([cf5fbc2](https://github.com/RoberPombo/OpenTemplates/commit/cf5fbc232bab199b8f4bfdd06a126c2352842c14))

## [0.2.0](https://github.com/RoberPombo/OpenTemplates/compare/v0.1.0...v0.2.0) (2026-11-22)


### Features

* **models:** exponer el catálogo de modelos de opencode ([ab3484f](https://github.com/RoberPombo/OpenTemplates/commit/ab3484ffdd489e860cf967ed1c947977a3b9b1e9))
* **models:** mostrar la ficha del modelo en los selectores ([8a3ba4f](https://github.com/RoberPombo/OpenTemplates/commit/8a3ba4f1d1c0becee452ff11ee639e23e0e95b64))
* **release:** releases firmadas y aviso de actualización ([5b24589](https://github.com/RoberPombo/OpenTemplates/commit/5b24589bcc4ec83203986294139d1ab2e8ed6ae1))
* **templates:** selector buscable de modelos filtrado por suscripción ([b876856](https://github.com/RoberPombo/OpenTemplates/commit/b8768562ebb7e6abdcdc953a70a0331ab9663baa))
* **ui:** select y combobox con búsqueda sobre Base UI ([b8f4a49](https://github.com/RoberPombo/OpenTemplates/commit/b8f4a49be618d1cd4457bb75e9ad20ec8c4d1099))
* **ui:** tarjeta de información de modelo reutilizable ([6767ea0](https://github.com/RoberPombo/OpenTemplates/commit/6767ea0a48feb1d7f86448d6c560c7f73b6bce30))


### Bug Fixes

* **release:** apuntar release-please a main e ignorar CHANGELOG en el formateador ([d865899](https://github.com/RoberPombo/OpenTemplates/commit/d86589946d1dd38b3969506c6c408c209627c542))
* **release:** pasar target-branch main al action de release-please ([b2dd8f6](https://github.com/RoberPombo/OpenTemplates/commit/b2dd8f64d8280c6f3f1674be825babfc69e9c139))
* **release:** release-please contra main y CHANGELOG fuera del formateador ([5c0c4c2](https://github.com/RoberPombo/OpenTemplates/commit/5c0c4c2a46f559a38b2603d954f85ab123317787))


### Code Refactoring

* **chat:** usar los selects de UI y memoizar la selección ([a8d0169](https://github.com/RoberPombo/OpenTemplates/commit/a8d01697d0e2fc2fb8b5bce6494d428813c9fb34))
* **presentation:** mover components, hooks y context a src/presentation ([e6b7a79](https://github.com/RoberPombo/OpenTemplates/commit/e6b7a79471e5abdd3423e3dd611ea339d2c9e176))


### Chores

* **git:** proteger main con un hook pre-push y documentar el flujo ([01a5836](https://github.com/RoberPombo/OpenTemplates/commit/01a5836dd88edcc91c18a1b6590a73ceff80b6a2))
* ignorar la salida de Vitest (.vitest/) ([b0fc81f](https://github.com/RoberPombo/OpenTemplates/commit/b0fc81f7398276c81152e2a910f93e81aa4f78cd))
* integrar el LICENSE del repositorio remoto ([6584ee0](https://github.com/RoberPombo/OpenTemplates/commit/6584ee065a52618e40a7f87f03b3765dd93390dd))
* **rename:** renombrar OpenConf a OpenTemplates ([2526d67](https://github.com/RoberPombo/OpenTemplates/commit/2526d67893205df6411fc0be0402365587702b79))
