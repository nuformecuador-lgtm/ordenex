# Review — Feature 73 · Causa tipificada de la devolución

> Reviewer independiente. Worktree `ordenex-f73`, rama `feature/73-causa-devolucion` (base
> `ccad206`). Todo el trabajo SIN COMMITEAR (revisado sobre el working tree). Fecha 2026-07-16.

## Números MEDIDOS por el reviewer (no citados de la bitácora)

| Gate | Baseline declarado | Medido por el reviewer | Delta |
| --- | --- | --- | --- |
| `pnpm typecheck` | 0 | **0 errores** | = |
| `pnpm lint` | 0 err / 139 warn | **0 errores / 139 warnings** | = |
| `pnpm vitest run` (suite completa) | 2907 tests | **2907 tests; 8-9 rojos NO deterministas** | ver abajo |
| Tests SOLO de la 73 (8 archivos, aislados) | — | **147 / 147 verdes** | — |

Los 8-9 rojos de la suite completa son TODOS `Test timed out in 5000ms` en archivos que la
73 NO toca (`HomePage`, `HomePageMaestro`, `HomePageRol`, `OrdenesModuleReuse`,
`OrdenesPagination`, `zona-form`). El conteo varía entre corridas (9 vs 8) y cada archivo
PASA aislado (verificado: `HomePage` 1/1 solo). Son flakes de carga/CPU (mismo género que el
`no-embalaje` documentado), no regresión de la 73.

## Checklist CHECKPOINTS

- [x] `specs/73-*/requirements.md` (EARS R1-R22), `design.md` (con alternativas 8.1-8.6),
  `tasks.md` presentes.
- [ ] **Todas las tasks `[x]`** — FALLA: `T0.1`, `T6.1`, `T6.2`, `T6.3`, `T6.4`, `T7.1`,
  `T7.2`, `T7.3` siguen en `[ ]`.
- [x] typecheck 0 · lint 0.
- [~] `pnpm test`: verde salvo flakes ambientales ajenos (ver arriba).
- [x] Migración aditiva con `down.sql`; round-trip real contra Postgres demostrado (T1.4).
- [x] Sin tabla nueva → sin superficie RLS nueva; `gestion_orden` conserva RLS sin policies.
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda.
- [x] Capas separadas: action→service→repo, interfaces en `lib/interfaces/`.
- [ ] `progress/review_73` con veredicto OK — este archivo; veredicto RECHAZADO.

## Trazabilidad R<n> → test (verificada con el diff en la mano)

R1,R2,R3 (`causa-devolucion.test.ts`), R6,R7,R8,R10,R12,R19-borde
(`gestion-orden-causa-devolucion.test.ts`), R9,R6-action
(`mis-asignaciones-causa-devolucion.test.ts` action), R11,R12,R13,R10-service (service test),
R11,R13,R10,R16-repo (`gestion-orden-repository.test.ts` +5 casos), R14,R15,R16,R20,R11-migración
(`gestion-orden-causa-devolucion-migration.test.ts` + round-trip vivo), R3,R4,R5,R6,R9-UI
(`MisAsignacionesModule.test.tsx`). Todos con asserts reales. R18 queda cubierto por los tests
de `contarIntentos` de la 49, INTACTOS y verdes (la causa no viaja al historial → no es insumo
del conteo, garantizado por construcción).

**HUECO:** **R17 NO tiene test concreto.** Ver bloqueante 1.

## Modificaciones a tests previos (verificadas, NO se aflojó nada)

- `gestion-orden-schemas.test.ts`, `mis-asignaciones-service.test.ts` (10 inputs),
  `mis-asignaciones-action.test.ts`: se AÑADE `causaDevolucion` al input forzado por el tipo;
  las aserciones son idénticas. Legítimo.
- `MisAsignacionesModule.test.tsx`: el caso "DEVOLVER envía solo el motivo" se renombra a
  "…envía la causa y el motivo"; conserva sus 3 aserciones (`resultado`, `motivo`, `evidencia`)
  y añade `fd.get("causaDevolucion")==="wrong_address"`. Legítimo.
- `cierre-detail-migration.test.ts`: `expect(thisDir).toBe(dirs[last])` → compara contra su
  predecesora real (`_order_status_recibido_origen`, `thisDir > previa`). El invariante "última
  del repo para siempre" era sobre-especificado; la nueva aserción sigue verificando el orden
  temporal, patrón que el repo ya usa. NO aflojado.
- `zonas-migration.test.ts`: se apenda `_gestion_orden_causa_devolucion` a la denylist de
  "migraciones apendidas después", igual que 67/75/69. NO aflojado.

## Hallazgos

### BLOQUEANTE 1 — R17 sin test concreto
R17 exige que las 3 causas cuenten IGUAL como intento (feature 47 intacta). La `tasks.md` T6.1
define su "Hecho": *"para la MISMA orden y el MISMO conteo previo, las 3 causas producen el
MISMO seguimiento"*. **Ese test NO existe.** Los tests de la 47 se modificaron para pasar
SIEMPRE `causaDevolucion: "not_found"` — nunca corren `wrong_number`/`wrong_address` por la
ruta de seguimiento. Estructuralmente la regla se conserva (`resolverSeguimientoDevuelta` y
`gestionar` intactos en el diff; la decisión de reintento/escalado se toma antes de la tx y no
lee la causa), por lo que el riesgo en runtime es bajo. Pero por la regla del arnés
(cada `R<n>` → test que lo verifica) el requisito queda huérfano. **Falta:** un test que corra
la misma orden con las 3 causas y afirme el mismo destino de seguimiento (bajo umbral → bodega
responsable con mensajero limpio; en umbral → `rechazada`). Barato de cerrar.

### BLOQUEANTE 2 — CHECKPOINTS/trazabilidad: tasks sin marcar y mapa R→test incompleto
`tasks.md` B0/B6/B7 en `[ ]` (T0.1, T6.1-T6.4, T7.1-T7.3). El CHECKPOINTS exige todas `[x]`.
Además T7.2/R22 (mapa consolidado R1-R22 → test en el progress file) NO está: el impl solo tiene
mapas PARCIALES B1-B4 y B5, y ninguno cita test para R17 ni R18. Cerrar el bloqueante 1 y
consolidar el mapa (marcando B6/B7) salda esto. (T7.3 commits y T0.1 baseline son proceso del
leader.)

### menor 1 — Feature 73 ausente de `feature_list.json`
El último registro es la 72. La 73 no existe en el arnés (bookkeeping del leader). No gatea el
código pero `init.sh` no la reconocerá.

### menor 2 — `./init.sh` no confirmable verde de forma determinista
Su paso `pnpm run test` hereda los flakes de timeout de 5000ms en archivos ajenos (pasan
aislados). typecheck y lint (los otros pasos) pasan. No es defecto de la 73.

### menor 3 — Migración aplicada con `migrate deploy` a mano
Por drift ajeno preexistente (`20260714123909…`, commit `22cf7a3`) `migrate dev` aborta
pidiendo reset de la base del humano. El `backend_dev` escribió la carpeta a mano (2 sentencias
idénticas a `design §1.2`) y aplicó con `deploy`. La migración cumple el estándar: versionada,
`migration.sql`+`down.sql`, round-trip real demostrado contra Postgres vivo (columna/tipo
aparecen tras UP, desaparecen tras rollback, reaparecen tras UP; fila PRE-73 sobrevive con
`causa_devolucion=NULL` y motivo intacto). Aceptable; el drift ajeno sigue ahí y no es de la 73.

### menor 4 — Sin commits
El trabajo está sin commitear (patrón del arnés: el leader commitea). Esperado.

## Verificación de no-regresión 36/47/49
- Feature 47: `resolverSeguimientoDevuelta`, `contarIntentos`, `lib/config/reintentos.ts`
  INTACTOS en el diff. La causa no entra en esa ruta. (Sin embargo, sin test dedicado → R17,
  bloqueante 1.)
- Feature 49: tests de `contarIntentos` sin modificar y verdes; el historial no recibe la causa.
- Feature 36: `motivoSchema` y `MotivoField` sin tocar; `rechazada` conserva motivo+evidencia
  sin selector (test T5.3); las 3 otras ramas rechazan la causa por la `discriminatedUnion`
  (R10, test real). `MotivoField` compartido intacto por construcción.

## Veredicto: **RECHAZADO**

2 bloqueantes (R17 sin test; CHECKPOINTS tasks/mapa) · 4 menores. El código de producción es
correcto y coherente con el spec y las decisiones F1.4; el rechazo es por trazabilidad
(R17 huérfano) y bookkeeping de tasks/mapa, no por un defecto de comportamiento.

---

# Segunda pasada — re-revisión de cierre (2026-07-16)

> Alcance: confirmar si los 2 bloqueantes murieron, SIN re-revisar la feature entera, y
> verificar que el cierre no introdujo regresión ni aflojó tests. Reviewer independiente,
> mismos worktree/rama, trabajo sin commitear.

## Números MEDIDOS por el reviewer en esta pasada

| Gate | Medido | Nota |
| --- | --- | --- |
| `pnpm typecheck` | **0 errores** | = baseline |
| `pnpm lint` | **0 errores / 139 warnings** | = baseline, ninguno nuevo |
| Tests de la 73 en aislado (11 archivos, incl. `mis-asignaciones-service.test.ts` y `orden-historial-service.test.ts`) | **214/214 verdes, 0 rojos** | — |
| Solo casos `-t "73/R17"` en el service test | **7 pasan / 44 skipped** | las 3 causas × (bajo umbral, en umbral) + invariante a===b===c |

## BLOQUEANTE 1 — R17 sin test → **CERRADO**

- Existe el test dedicado en `tests/unit/services/mis-asignaciones-service.test.ts` (describe
  `gestionar — DEVUELTA: reintento vs escalado (feature 47)`), parametrizado sobre
  `CAUSA_DEVOLUCION_SEED` (las 3 causas reales, NO siempre `not_found`).
- Ejercita las 3 causas por la ruta de seguimiento en dos regímenes: BAJO umbral (conteo 0 →
  intento 1) afirma `{destinoEstatusId:"os-en-bodega-satelite", limpiaMensajero:true}` y
  `contarIntentos("o1")` llamado 1 vez; EN umbral (conteo 2 → intento 3) afirma escalado a
  `os-rechazada`, `limpiaMensajero:false`. El tercer caso corre las 3 y afirma `a===b===c`.
  Verifica mismo estado destino + mismo efecto en el conteo, como exige R17.
- Producción NO se tocó para hacerlo pasar: `git diff` de `MisAsignacionesService.ts` es
  +7/-1, aislado a `buildGestionData` (rama `devuelta` propaga `causaDevolucion`);
  `resolverSeguimientoDevuelta` y `contarIntentos` NO aparecen en el diff. Los 7 casos pasan
  tal cual (la regla ya era correcta).

## BLOQUEANTE 2 — trazabilidad / CHECKPOINTS → **CERRADO**

- `tasks.md`: B6 (T6.1-T6.4) y B7 (T7.1, T7.2) marcados `[x]`. Solo T7.3 (commits) y nada más
  quedan en `[ ]` — T7.3 es proceso del leader, aceptable.
- Mapa consolidado R1→R22 → test concreto presente en `progress/impl_73-…` (§ "Mapa
  CONSOLIDADO"), sin huecos. Spot-check: R17 cita los 3 casos reales (verificado en vivo);
  R18 cita `orden-historial-service.test.ts > contarIntentos — derivador` — el archivo NO
  aparece en `git diff` (intacto) y su describe existe (línea 278); R11 cita el test de
  migración y el del repo, ambos existentes.

## Anti-regresión (verificado en esta pasada)

- Cierre = AMPLIACIÓN, no relajación. En los tests modificados NO se borró ni aflojó ninguna
  aserción: las únicas líneas eliminadas son inputs `devuelta` que ganaron `causaDevolucion`
  (forzado por el tipo), un `describe`/`it` renombrado (R27/R28 "envía solo el motivo" →
  "envía la causa y el motivo", sus 3 aserciones conservadas) y un `safeParse` que ganó la
  causa. Cero `expect`/`toBe`/`toEqual`/`toHaveBeen` removidos.
- Feature 47 (`resolverSeguimientoDevuelta`, `contarIntentos`, `lib/config/reintentos.ts`) y
  feature 49 (`OrdenHistorialService.ts`) INTACTAS en el diff de producción.
- menor 1 del review previo (73 ausente de `feature_list.json`) también resuelto: 73
  (`in_progress`) y 74 (`pending`) registradas en el worktree.

## Menores nuevos: **0**

## Veredicto 2ª pasada: **APROBADO (OK)**

Los 2 bloqueantes están cerrados y verificados en ejecución; el cierre no introdujo regresión
ni aflojó tests. Único pendiente T7.3 (commits), que es del leader.
