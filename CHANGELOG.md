# Changelog

## [0.2.2](https://github.com/RoberPombo/OpenTemplates/compare/v0.2.1...v0.2.2) (2026-11-24)


### Features

* **carreras:** multi-run con comparación y elección de ganadora ([#10](https://github.com/RoberPombo/OpenTemplates/issues/10)) ([#40](https://github.com/RoberPombo/OpenTemplates/issues/40)) ([eae8fa5](https://github.com/RoberPombo/OpenTemplates/commit/eae8fa587e61599a81d7dd7d791db055fda45a39))
* **chat:** comandos y skills en el composer ([#34](https://github.com/RoberPombo/OpenTemplates/issues/34)) ([9ef7f32](https://github.com/RoberPombo/OpenTemplates/commit/9ef7f32000b0890de298bd636de2ccb1bb545133))
* **chat:** dock de permisos y preguntas del agente ([#28](https://github.com/RoberPombo/OpenTemplates/issues/28)) ([771a2f1](https://github.com/RoberPombo/OpenTemplates/commit/771a2f1f4cdce8b018556b9147439f658145ed5e))
* **chat:** historial de sesiones por workspace ([#27](https://github.com/RoberPombo/OpenTemplates/issues/27)) ([b102579](https://github.com/RoberPombo/OpenTemplates/commit/b1025791837ea02c450560783e4f7e1aa5e7cf1b))
* **chat:** objetivos de sesión con criterio de fin ([#39](https://github.com/RoberPombo/OpenTemplates/issues/39)) ([af7684f](https://github.com/RoberPombo/OpenTemplates/commit/af7684fd80428b491532dd33769584a3ba2581fb))
* **git:** commit asistido y pull request con gh ([#12](https://github.com/RoberPombo/OpenTemplates/issues/12)) ([#42](https://github.com/RoberPombo/OpenTemplates/issues/42)) ([f089dcc](https://github.com/RoberPombo/OpenTemplates/commit/f089dcc6e2922f9e7ff0d99219f08624fca44db6))
* **notificaciones:** avisos nativos de turno y peticiones pendientes ([#35](https://github.com/RoberPombo/OpenTemplates/issues/35)) ([5b36f54](https://github.com/RoberPombo/OpenTemplates/commit/5b36f540481f16738977e7c1c19650c514740008))
* **panel:** diff y árbol de ficheros del workspace ([#33](https://github.com/RoberPombo/OpenTemplates/issues/33)) ([0e0d5dd](https://github.com/RoberPombo/OpenTemplates/commit/0e0d5ddf322a10c85e1937355a79c646b5c7e9f5))
* **preview:** vista previa de la app en marcha con sondeo y envío al agente ([#13](https://github.com/RoberPombo/OpenTemplates/issues/13)) ([#43](https://github.com/RoberPombo/OpenTemplates/issues/43)) ([2d70b92](https://github.com/RoberPombo/OpenTemplates/commit/2d70b929aafd6b79edeb180958458c298ef6cb9c))
* **sesiones:** exportar, importar y duplicar sesiones ([#8](https://github.com/RoberPombo/OpenTemplates/issues/8)) ([#37](https://github.com/RoberPombo/OpenTemplates/issues/37)) ([81f0480](https://github.com/RoberPombo/OpenTemplates/commit/81f0480d8b38a3e8d40b62992077c224560db23c))
* **ui:** paleta de comandos, atajos y temas ([#41](https://github.com/RoberPombo/OpenTemplates/issues/41)) ([d053dd7](https://github.com/RoberPombo/OpenTemplates/commit/d053dd77ef86d60280ee32ad84ab62070169e984))
* **uso:** consumo acumulado y presupuesto por workspace ([#36](https://github.com/RoberPombo/OpenTemplates/issues/36)) ([5d3da20](https://github.com/RoberPombo/OpenTemplates/commit/5d3da205d4755debc1d1470952354c47f66cbaa0))
* **workspace:** terminal por PTY y MCP en caliente ([#9](https://github.com/RoberPombo/OpenTemplates/issues/9), [#15](https://github.com/RoberPombo/OpenTemplates/issues/15)) ([#38](https://github.com/RoberPombo/OpenTemplates/issues/38)) ([8ad5946](https://github.com/RoberPombo/OpenTemplates/commit/8ad59468ea65ce0f2819732c90f304bea719489d))


### Documentation

* document the release environment and the sync PAT ([#52](https://github.com/RoberPombo/OpenTemplates/issues/52)) ([0f139ab](https://github.com/RoberPombo/OpenTemplates/commit/0f139abc1526f8870e87bccace6c27b918100dab))
* estado del plan de paridad para retomarlo ([#44](https://github.com/RoberPombo/OpenTemplates/issues/44)) ([ebb4111](https://github.com/RoberPombo/OpenTemplates/commit/ebb41112607e7cd84623eb1afe55306f19acb6b5))
* **release:** política 0.x hasta decidir la 1.0.0 ([ac4c53d](https://github.com/RoberPombo/OpenTemplates/commit/ac4c53d65350e7d916a36729290dbc8167968d16))


### Build System

* añadir script build:local para compilar sin firmar ([#26](https://github.com/RoberPombo/OpenTemplates/issues/26)) ([de5c0d5](https://github.com/RoberPombo/OpenTemplates/commit/de5c0d58046fadad373132eaf48f815efedbc40b))


### Continuous Integration

* actualizar github/codeql-action a v4.39.4 y agrupar sus updates ([#45](https://github.com/RoberPombo/OpenTemplates/issues/45)) ([5ed887c](https://github.com/RoberPombo/OpenTemplates/commit/5ed887c5dd6236e6612570f62ba05539a8e10856))
* bump pnpm/action-setup from 6.1.0 to 6.1.1 ([#30](https://github.com/RoberPombo/OpenTemplates/issues/30)) ([1878e2e](https://github.com/RoberPombo/OpenTemplates/commit/1878e2edf222f3e158c05bfdfe0e740db9ffe93e))
* drop the useless fork guard from PR checks ([#48](https://github.com/RoberPombo/OpenTemplates/issues/48)) ([f8166ef](https://github.com/RoberPombo/OpenTemplates/commit/f8166ef5b8b70d1ad63c578907a8b3986225ef6f))
* keep Cargo.lock in sync with release versions ([#50](https://github.com/RoberPombo/OpenTemplates/issues/50)) ([382dc3a](https://github.com/RoberPombo/OpenTemplates/commit/382dc3aa589a9e5fcb1c24abfb2c314caee06671))
* keep the release Cargo.lock in sync from release-please ([#55](https://github.com/RoberPombo/OpenTemplates/issues/55)) ([fca8af4](https://github.com/RoberPombo/OpenTemplates/commit/fca8af483632f574ea658757988a36eac6d28edb))
* open the sync PR with the release PAT ([#49](https://github.com/RoberPombo/OpenTemplates/issues/49)) ([100ec7a](https://github.com/RoberPombo/OpenTemplates/commit/100ec7a9cdb328e312482fb1a0117b46442559e2))
* raise dependabot cooldown to 7 days ([#47](https://github.com/RoberPombo/OpenTemplates/issues/47)) ([aaf0276](https://github.com/RoberPombo/OpenTemplates/commit/aaf02763f6062a68a22457d86bd8e585311893c4))
* read the signing secrets from the release environment ([#51](https://github.com/RoberPombo/OpenTemplates/issues/51)) ([a76d0ee](https://github.com/RoberPombo/OpenTemplates/commit/a76d0ee395618ce0806943db700e3146d40d82b6))
* send the Cargo.lock update as a request body ([#57](https://github.com/RoberPombo/OpenTemplates/issues/57)) ([9fdbfd4](https://github.com/RoberPombo/OpenTemplates/commit/9fdbfd4fd46ab8be926dbd19f88104fced48facd))


### Chores

* **deps:** bump json5 from 1.3.7 to 1.3.8 in /src-tauri ([#46](https://github.com/RoberPombo/OpenTemplates/issues/46)) ([08f2c2d](https://github.com/RoberPombo/OpenTemplates/commit/08f2c2dfe439c6b6479e908cd1de0069d2dd1b96))
* **deps:** bump walkdir from 2.5.0 to 2.5.1 in /src-tauri ([#31](https://github.com/RoberPombo/OpenTemplates/issues/31)) ([a168fbb](https://github.com/RoberPombo/OpenTemplates/commit/a168fbb395667ae83f6291b435be54ee5b815c3c))
* **deps:** sincronizar la versión del crate en Cargo.lock ([2e46cc2](https://github.com/RoberPombo/OpenTemplates/commit/2e46cc28415b740df176acb4ff051c3e68a3d7a9))
* promote develop to main ([ef69ba5](https://github.com/RoberPombo/OpenTemplates/commit/ef69ba51bccf60088ed7e8c3b0eba1907f0525c9))
* promote develop to main ([8e10f62](https://github.com/RoberPombo/OpenTemplates/commit/8e10f62ae0d4aa6875a61861daa459020eb267a9))
* promote develop to main ([20adb67](https://github.com/RoberPombo/OpenTemplates/commit/20adb67f05ced4f1daf41f24dcc55483b0f1df03))
* sync main into develop after release ([60047d4](https://github.com/RoberPombo/OpenTemplates/commit/60047d4440ffcd40bde1ac09f1c843e199784e98))

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
