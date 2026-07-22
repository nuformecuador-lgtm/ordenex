# Review — Feature 107: Plantillas de mensajes

Reviewer read-only (no edita codigo). Rama feature/107-plantillas-mensajes (worktree
ordenex-wt-107), base origin/dev. Fecha 2026-07-22.

## Veredicto: CAMBIOS REQUERIDOS

Un hallazgo bloqueante de trazabilidad (R3 sin test automatizado, existiendo precedente
trivial en el repo). El resto del alcance esta correcto: las 4 decisiones humanas se
respetan; typecheck/lint/tests de la feature en verde. Al cerrar el bloqueante, aprobable.

## Verificacion ejecutable (numeros reales)

- pnpm typecheck (tsc --noEmit): VERDE, 0 errores (tras pnpm db:generate).
- pnpm lint (eslint): 0 errores, 143 warnings, TODOS preexistentes, NINGUNO en archivos de
  plantillas (lint | grep plantilla -> vacio).
- Tests de la feature (tests/unit/plantillas, tests/integration/plantillas,
  tests/components/PlantillasModule.test.tsx, tests/unit/auth/menu-visibility.test.ts):
  8 archivos, 78 tests, 78 passed, 0 fallos.

## Checklist CHECKPOINTS

- [x] requirements.md (31 req EARS), design.md (alternativas D1-D6), tasks.md.
- [~] tasks.md usa encabezados T1..T11 sin marcas [x]; entregables existen y tests pasan (M3).
- [~] Trazabilidad: 30/31 R con test real; R3 sin test automatizado (bloqueante B1).
- [ ] progress/impl_107.md NO existe (CHECKPOINTS Trazabilidad lo exige) (M1).
- [x] typecheck / lint / tests de la feature en verde.
- [x] RLS habilitada en plantilla_mensaje (migration + test estatico R30).
- [x] Migracion reversible: migration.sql UP + down.sql DOWN (test R31).
- [x] Sin secretos hardcodeados; sin console.* nuevos.
- [x] Capas Controller(actions) -> Service -> Repository; interfaces en lib/interfaces/.
- [x] Pagina protegida server-side via resolveActorFromSession() (cookies).
- [x] Modulo cliente recibe datos por props (initialData); mutaciones via Server Actions.
- [x] Sin hardcode de pais/moneda/cuenta.

## Matriz R -> test (reconstruida contra los archivos reales)

- R1 maestro ve subitem Plantillas -> menu-visibility.test.ts "Feature 107 (R1)" -> OK
- R2 no-maestro no ve subitem -> menu-visibility.test.ts "Feature 107 (R2)" -> OK
- R3 pagina deniega server-side a no-maestro -> NINGUN test (solo inspeccion de page.tsx) -> FALTA (bloqueante)
- R4 action sin sesion -> unauthenticated sin tocar DB -> plantillas-actions.test.ts "R4" -> OK
- R5 action rol != maestro -> forbidden -> service.test "R5" + actions.test "R5" -> OK
- R6 listado nombre/estado/cuerpo, orden createdAt desc -> repository + integration; render de columnas sin test dedicado -> OK (parcial)
- R7 paginacion con clamp a MAX -> plantilla-schemas.test.ts "R7" -> OK
- R8 crear valido persiste -> service.test "R8" + integration -> OK
- R9 nombre vacio -> validation_error(nombre) -> schemas "R9" + actions.test -> OK
- R10 nombre duplicado -> conflict(nombre) -> service.test "R10" + integration "R10" -> OK
- R11 cuerpo vacio -> validation_error(cuerpo) -> schemas "R11" -> OK
- R12 nace pending -> service.test "R8/R12" + integration + migration test -> OK
- R13 catalogo abierto data-driven -> utils.test "R13" -> OK
- R14 sintaxis clave con espacios -> utils.test "R14" -> OK
- R15 persiste array variables dedup -> utils.test "R15" + service + integration -> OK
- R16 llave malformada -> validation_error(cuerpo) -> utils.test "R16" + service.test "R16" -> OK
- R17 insertar variable en el cursor -> VariablesInsert.test "R17" -> OK
- R18 preview sustituye por ejemplos/marcador -> utils + service.test "R18" + VariablesInsert "R18" -> OK
- R19 reemplaza todas las ocurrencias, no toca el resto -> utils.test "R18/R19" -> OK
- R20 editar recalcula variables -> service.test "R20" + integration "R20" -> OK
- R21 editar inexistente -> not_found -> service.test "R21" -> OK
- R22 edicion mismas validaciones + unicidad excluye propia -> schemas "R22" + service.test "R22" -> OK
- R23 enum 4 valores exactos -> integration migration "R23" -> OK
- R24 desactivar -> inactivo (unica transicion) -> service.test "R24" + actions.test -> OK
- R25 destino != inactivo -> validation_error -> schemas "R25" + actions.test "R25" -> OK
- R26 cambiar estado inexistente -> not_found -> service.test "R26" -> OK
- R27 eliminar fija deletedAt (soft) -> service.test "R27" + integration + component -> OK
- R28 lecturas excluyen deletedAt -> repository + integration "R28" + component -> OK
- R29 eliminar inexistente/borrada -> not_found -> service.test "R29" + integration -> OK
- R30 RLS habilitada -> integration migration "R30" -> OK
- R31 migracion reversible (down.sql) -> integration migration "R31" -> OK

Cobertura: 30/31 con test real; R3 sin test automatizado.

## Fidelidad al spec y a las 4 decisiones humanas

1. Nace pending: OK. estado @default(pending) en schema; DEFAULT pending en migration; el
   repo no fija estado al crear; verificado por tests.
2. Front solo DESACTIVAR (inactivo), sin ACTIVAR, refused reservado: OK. El schema
   cambiarEstado usa z.literal("inactivo") .strict() y rechaza activo/pending/refused
   (schemas.test + actions.test). Enum con los 4 valores. No hay accion Activar en actions
   ni en la UI (columns solo pinta Desactivar cuando estado != inactivo; el resto son Badge
   de solo lectura).
3. Soft delete con deletedAt y filtro en TODAS las lecturas: OK. El repository define
   VIGENTE = deletedAt:null y lo aplica en list/count/findById/findByNombre/update/
   updateEstado/softDelete. softDelete fija deletedAt = new Date().
4. Catalogo abierto + variables text[] derivadas: OK. PLANTILLA_VARIABLES con key tipo
   string (sin union cerrado); el service DERIVA variables con extraerVariables y las
   persiste; el cliente NO envia variables (.strict()).

Otros: RLS habilitada sin policies (patron api_key); down.sql revierte exacto (DROP TABLE
+ DROP TYPE); autorizacion maestro en el service (ALLOWED_ROLES), toda operacion devuelve
forbidden si no es maestro.

## UI

- Subitem Plantillas solo para maestro: OK (hereda roles maestro del padre).
- Pagina autoriza server-side: OK (rol != maestro -> aviso, no renderiza modulo).
- CRUD completo: crear, editar, ELIMINAR con confirmacion (Modal destructive), DESACTIVAR
  con confirmacion: OK.
- NO existe accion Activar: OK.
- Editor inserta variables en el cursor: OK (insertarPlaceholder, test R17).
- Preview: OK (VariablesInsert -> previewPlantilla, test R18).
- Reutiliza shadcn/ui (Button, Badge, DataTable, Modal, Pagination): OK.

## Hallazgos

### BLOQUEANTE
- B1 R3 sin test automatizado. app/(app)/configuracion/plantillas/page.tsx implementa
  correctamente la denegacion server-side (rol != maestro -> aviso "No tienes permiso", sin
  renderizar el modulo ni pre-cargar datos), pero NINGUN test la ejercita. Existe precedente
  directo y trivial: tests/components/ConfiguracionApiPage.test.tsx prueba esto para la
  feature 82 (mockea resolveActorFromSession, renderiza el Server Component real para varios
  roles y aserta que no aparece el modulo ni se llama a la action de listado). Falta el test
  analogo para plantillas. Para cerrar: anadir tests/components/ConfiguracionPlantillasPage.test.tsx
  cubriendo (a) rol no-maestro y sesion ausente -> no renderiza modulo / no llama
  listarPlantillas, y (b) maestro -> renderiza modulo con initialData.

### menor
- M1 progress/impl_107.md ausente. CHECKPOINTS Trazabilidad exige el mapa R->test en
  progress/impl_<feature>.md. El mapa vive en tasks.md pero falta el artefacto de bitacora.
- M2 Tests de componente prometidos en T10 ausentes. tasks.md T10 declara pruebas de
  componente para R6 (columnas) y R24 (Desactivar). PlantillasModule.test.tsx solo cubre
  eliminar (R27/R28). R6 y R24 SI tienen cobertura por otras vias (repo/integration para R6;
  service+actions para R24); no bloqueante, pero la promesa de la task no se cumplio.
- M3 tasks.md sin marcas [x]. Usa encabezados T1..T11; CHECKPOINTS pide tasks [x].
  Completadas de facto.

### nota
- N1 Orden desc de R6 poco ejercitado: el test de integracion valida el filtro soft-delete
  con 1 item, no un orden estricto con >=2 vigentes. Suficiente, mejorable.
- N2 Unicidad global de nombre (incluye borradas) es intencional y documentada en design D6.

## Cierre
Al anadir el test de autorizacion de la pagina (B1), la feature queda aprobable. M1/M3 son
bookkeeping resolubles por el leader; M2/N1 son mejoras de cobertura no bloqueantes.

---

## Cierre del leader — 2026-07-22

**Bloqueante B1 (R3) RESUELTO.** Se añadió `tests/components/ConfiguracionPlantillasPage.test.tsx`
(calcado de `ConfiguracionApiPage.test.tsx`, feature 82): deniega server-side a rol ≠ maestro y a
sesión ausente, renderiza el módulo solo para maestro. Commit `2e019aa`.

**Trazabilidad final: 31/31 R con test.**

**Verificación final (worktree, estado tras `2e019aa`):**
- `pnpm typecheck`: verde (0 errores).
- `pnpm lint`: verde (0 errores; 143 warnings preexistentes, ninguno de la feature).
- Tests de la feature: 9 archivos, **82 tests, 82 passed**.

**Veredicto del leader: APROBADO.** Listo para PR a `dev` (merge humano).
Menores no bloqueantes diferidos: `impl_107.md` (M1), marcas `[x]` en tasks.md (M3).
