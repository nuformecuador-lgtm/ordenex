# Feature 213 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas
de su mismo grupo. Cada tarea lleva su criterio de **hecho**.

> **PUERTA DE APROBACIÓN — estado 2026-08-13.** **Ocho de las doce preguntas están
> CERRADAS** (D6–D12): el predicado ya se puede escribir y el grupo 1 está
> desbloqueado. **Siguen ABIERTAS Q3, Q4, Q5 y Q10**, y bloquean tareas concretas
> (T12b, T13 y el cierre de la feature). **T1 y T1b hay que ejecutarlas ANTES de
> volver a la puerta**: son la entrada que el humano necesita para decidir Q4 y Q5.

Baseline declarado: worktree `C:/w213`, rama `feature/213-reintento-en-cierre`
desde `origin/dev` (ca73e771), dependencias instaladas, cliente Prisma generado,
**typecheck en VERDE**. Antes de afirmar cualquier delta, volver a medir (los
baselines caducan con cualquier PR ajeno).

---

## Grupo 0 — La puerta

- [x] **T0 — Cerrar preguntas con el humano.** ~~12~~ **8 cerradas** el 2026-08-13:
  Q1/Q2/Q6/Q9 por el humano (D6–D8) y Q7/Q8/Q11/Q12 como llamadas de juicio del
  leader (D9–D12), verificadas contra el código. Registradas en
  `requirements.md` §Segunda ronda + §Preguntas cerradas, y como R29–R33.
  **Pendiente:** Q3, Q4, Q5, Q10 → **T0b**.
  **Hecho:** R3 y R27 desbloqueados con texto EARS definitivo.

- [ ] **T0b — Volver a la puerta con las CUATRO que faltan.** Q3 (lazo de
  `rechazada`), Q4 (efecto retroactivo), Q5 (cierre que nunca se aprueba, con las
  tres mitigaciones de `design.md §7bis`), Q10 (KPI persistido).
  **Hecho:** ni un `⛔` sin resolver en `requirements.md`; R18, R19 y R24 con texto
  EARS definitivo. **Depende de:** T1, T1b. **Bloquea:** T12b, T13, T18.

- [ ] **T1 — [P] Ejecutar la medición del efecto retroactivo (⛔ Q4).** La consulta
  ya está escrita en `design.md §7.6` (solo lectura, dos consultas: resumen y
  detalle con `LIMIT 100`). Solo hay que correrla contra la base real.
  **Hecho:** resultado pegado en `design.md §7.6` **con fecha y base**; si
  `empiezan_a_escalar > 0`, la lista de esas órdenes se le enseña al humano una por
  una. **Depende de:** nada. **Informa:** T0b.

- [ ] **T1b — [P] Dimensionar el riesgo de Q5.** Ejecutar la consulta de cierres no
  aprobados por estado y antigüedad (`design.md §7bis`, final).
  **Hecho:** resultado pegado en `design.md §7bis` con fecha; cuántos cierres
  `vencido`/`rechazado`/`solicitado` llevan más de 7 y más de 30 días.
  **Depende de:** nada. **Informa:** T0b.

---

## Grupo 1 — El criterio (núcleo)

- [ ] **T2 — Declarar la lista de resultados que cuentan.** Constante de
  INCLUSIÓN sobre `GestionResultado` (`{rechazada, devuelta, reprogramada}`) con
  `satisfies`, en `lib/types/` junto a los tipos de gestión, con la prosa del
  porqué (contar de más = cobrar antes de tiempo).
  **Hecho:** existe la constante, el `satisfies` rompe el build si un valor sale
  del enum, y hay un test que afirma que es lista de INCLUSIÓN (todos los demás
  resultados quedan fuera).
  **R:** R1, R2, R33. **Depende de:** nada (Q6 cerrada por D6).

- [ ] **T3 — Reescribir el predicado único.** `whereIntentosVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts:105`) pasa a mirar `gestion_orden`
  con el predicado ya decidido (`design.md §3.1`): `resultado IN <lista>` +
  `anulada_at IS NULL` + `cierre_id IS NOT NULL` +
  `cierre: { estado: 'aprobado' }` (**D8**). Sigue siendo UNA función pura
  consumida por los DOS métodos de conteo.
  **Hecho:** los dos métodos usan el mismo `where`; **el conteo es de `cierre_id`
  DISTINTOS, no de gestiones** (`distinct` / `groupBy(["cierreId"])` en el
  individual; `groupBy(["ordenId","cierreId"])` en el lote) — un `count()` a secas
  violaría R29; el lote sigue siendo UNA consulta y el lote vacío sigue sin emitir
  consulta.
  **R:** R1, R3, R4, R5, R7, R8, R29, R30, R31, R32. **Depende de:** T2.
  **NO toca `db/`** (R27/D7).

- [ ] **T4 — Retirar el criterio viejo por completo.** Fuera
  `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (`lib/types/orden-historial.ts:147`) y las
  ramas de destino del predicado. `ORIGEN_TIPOS_CON_GESTION` (`:117`) **se queda**.
  **Hecho:** `grep -r ORIGEN_TIPOS_REPROGRAMADA_INTENTO` devuelve 0 en `lib/`,
  `app/`, `components/` y `tests/`; typecheck verde; no queda ningún camino de
  lectura que derive intentos de destinos de transición.
  **R:** R10, R11, R13. **Depende de:** T3.

- [ ] **T5 — Simplificar el contrato.** `CriterioIntento`
  (`lib/interfaces/repositories/IOrdenHistorialRepository.ts:65`) y
  `resolverCriterio` (`lib/services/OrdenHistorialService.ts:95`) dejan de
  necesitar ids de `order_status`. R9 pasa a sostenerse sobre el enum de Prisma.
  **Hecho:** los 11 call-sites siguen compilando sin cambios (mismos tipos de
  retorno); el JSDoc de las dos interfaces describe el criterio nuevo.
  **R:** R6, R9. **Depende de:** T3.

- [ ] **T6 — [P] Actualizar la prosa que afirma el criterio viejo.** El bloque
  `lib/types/orden-historial.ts:56-116` (60 líneas de justificación familia por
  familia), el JSDoc de `whereIntentosVigentes` (`:82-104`), el de
  `contarIntentosVigentes{,EnLote}` en la interfaz (`:107-138`), el comentario de
  `DevolucionSlaService.ts:109-116` y la `descripcion` de `primer_intento_ok`
  (`lib/analytics/metrics.ts:335`).
  **Hecho:** ningún comentario del repo afirma que el intento se derive de
  destinos de transición; `grep -ri "destino reprogramada"` no devuelve prosa
  vigente que lo declare como criterio.
  **R:** R28. **Depende de:** T4.

---

## Grupo 2 — Tests del criterio (van con T2–T6, no después)

- [ ] **T7 — Reescribir el evaluador semántico compartido.**
  `tests/fixtures/intentos-entrega.ts:59-108` (`filaCasaIntento`,
  `prismaHistorialSobreFilas`) desestructura la forma del `where` viejo. Se
  reescribe sobre filas de `gestion_orden`. **Sigue siendo UNO solo.**
  **Hecho:** `fakeIntentosEnLote` (`:20`) intacto (lo usan ~10 suites que deben
  seguir verdes); el evaluador nuevo lo consumen T8 y T9.
  **R:** R6. **Depende de:** T3.

- [ ] **T8 — [P] Reescribir los tests del predicado.**
  `tests/unit/repositories/orden-historial-repository.test.ts`, bloques `:191-268`,
  `:270-323` y `:325-571` (18 casos).
  **Hecho:** cobertura equivalente caso a caso: cada resultado que cuenta, cada
  uno que no, gestión anulada, lote de N con 1 consulta, lote vacío con 0
  consultas, orden sin intentos → `0`. **Más los casos NUEVOS de la segunda ronda**
  (fila #17 de `design.md §6`): cierre `solicitado`/`vencido`/`rechazado` → no
  cuenta y `aprobado` → cuenta (R3); dos gestiones vigentes en el MISMO cierre
  aprobado → 1 (R29); 3 cierres aprobados → 3 (R30); el conteo no mira el estado
  actual de la orden (R31).
  **R:** R1, R2, R3, R5, R7, R8, R29, R30, R31. **Depende de:** T7.

- [ ] **T9 — [P] Reescribir los tests del criterio declarado.**
  `tests/unit/types/criterio-intento-entrega.test.ts` (7 casos): la parte de
  coherencia con el mapa de la 140 se conserva como **guardia de no-regresión del
  mapa** (R14); la de familias de origen se sustituye por la lista de resultados.
  **Hecho:** el caso «es lista de INCLUSIÓN» sobrevive con el objeto nuevo; hay un
  caso que afirma que ninguna arista del mapa cambió.
  **R:** R2, R12, R14. **Depende de:** T2.

- [ ] **T10 — Adaptar el test de criterio ÚNICO.**
  `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera).
  **No cambia de propósito: es el test más importante de la feature.**
  **Hecho:** monta el repositorio REAL (sin mockear el conteo) y afirma que cron
  SLA, drawer y lote dan el MISMO número para la misma orden.
  **R:** R6. **Depende de:** T7.

- [ ] **T11 — [P] Reescribir los tests del servicio.**
  `tests/unit/services/orden-historial-service.test.ts`, bloques `:303-357`,
  `:359-407` y el caso `:169`.
  **Hecho:** los casos de `resolverCriterio` se sustituyen; sobreviven lote vacío
  (R7), `0` (R8) y degradación segura (R9).
  **R:** R7, R8, R9, R20. **Depende de:** T5.

- [ ] **T11b — [P] Reescribir los casos de ANULACIÓN como casos de MONOTONÍA.**
  Fila #16 de `design.md §6`: `orden-historial-repository.test.ts:475` y `:489`,
  `orden-historial-service.test.ts:154`, `devolucion-sla-service.test.ts:184`. Hoy
  afirman que anular una gestión **BAJA** el número; con D12 el número nunca baja,
  y lo que la anulación impide es que **LLEGUE A SUBIR**.
  **Hecho:** ningún test del repo afirma que el conteo pueda decrecer; hay un caso
  explícito de monotonía (misma orden, dos lecturas, el segundo número ≥ el
  primero). R5 sobrevive como «una gestión anulada no cuenta», no como «descuenta».
  **R:** R5, R32. **Depende de:** T3.

- [ ] **T12 — Reescribir los tests del escalado SLA. [💰]**
  `tests/unit/services/devolucion-sla-service.test.ts`, bloque `:170-233`.
  Escenarios construidos con CIERRES APROBADOS, no con filas de historial. Añadir:
  (a) no-doble-conteo (dos gestiones vigentes en el mismo cierre aprobado → 1;
  re-aprobar → mismo número); (b) cierre `solicitado`/`vencido`/`rechazado` → la
  orden NO escala.
  **Hecho:** cada caso dice explícitamente si la orden escala o se libera; los
  bloques `:83-131`, `:234-248`, `:249-268` y `:269-330` siguen VERDES sin tocarse
  (R16).
  **R:** R3, R4, R5, R15, R16, R29. **Depende de:** T3.

- [ ] **T12b — ⛔ Los dos casos que dependen de decisión.** (a) el lazo de
  `rechazada` (Q3); (b) la orden cuyo cierre nunca se aprueba (Q5) y la mitigación
  que se elija.
  **Hecho:** un caso por decisión, con el comportamiento decidido asertado.
  **R:** R18, y el requisito nuevo que salga de Q5. **Depende de:** T0b.

- [ ] **T13 — ⛔ Semillas de analítica y equivalencia (Q10).**
  `tests/integration/db/_semilla-rollup.ts`, `analytics-daily-job.test.ts`,
  `analitica-operativa-equivalencia.test.ts`: las semillas deben crear cierres
  **aprobados**, no solo filas de historial.
  **Hecho:** el CHECK `primer_intento_ok <= entregas` se respeta; los tests
  corren **con datos** (verificar que no retornan temprano: comparar el número de
  aserciones ejecutadas, no el `passed`); la decisión de Q10 queda reflejada.
  **R:** R23, R24. **Depende de:** T3, T0b (Q10).

---

## Grupo 3 — No regresión y cierre

- [ ] **T14 — [P] Verificar los que deben seguir VERDES sin tocarse.** Las ~40
  suites de §6 de `design.md` (#11, #12, #13, #14): los 8 servicios/acciones
  consumidores, las 12 superficies de UI, `intentos-no-alcance.test.ts` y
  `devolucion-sla-dinero.test.ts`.
  **Hecho:** `git diff --name-only` no toca `components/`, `app/`,
  `tests/components/`, `tests/unit/components/`, `intentos-no-alcance.test.ts` ni
  `devolucion-sla-dinero.test.ts`; y esas suites están verdes.
  **R:** R17, R20, R21, R22. **Depende de:** T3.

- [ ] **T15 — Guardia de «sin migración». Ya no hay rama alternativa.**
  D7 prohíbe materializar el contador y `160/R7` se conserva.
  **Hecho:** `git diff --name-only -- db/` **vacío**. Si aparece cualquier cambio en
  `db/` —schema, migración o `down.sql`— es un incumplimiento de R27 y hay que
  volver a la puerta, no justificarlo.
  **R:** R27. **Depende de:** T3.

- [ ] **T16 — Inventario de rojos medido contra la tabla de `design.md §6`.**
  **Hecho:** todo rojo de la corrida está en la tabla; ninguno se «arregló»
  conservando la afirmación vieja; cualquier rojo fuera de la tabla se reporta
  como hallazgo, no se silencia. Ojo con la suite degradada: comparar el total de
  archivos (~649) antes de creerse el conteo.
  **Depende de:** T8–T14 (y T11b).

- [ ] **T17 — Cerrar la trazabilidad.** Rellenar el mapa R → test real en
  `progress/impl_213.md §2` y en `requirements.md`.
  **Hecho:** ningún `R<n>` sin al menos un test con ruta y nombre de caso reales.
  **Depende de:** T16.

- [ ] **T18 — Gate completo antes del PR.** `./init.sh --rapido` para cerrar cada
  tanda; **`./init.sh` completo antes del PR, sin excepción**.
  **Hecho:** salida verde pegada en `progress/impl_213.md`, con el delta de rojos
  medido contra el baseline REMEDIDO de `dev` (no contra el citado en la bitácora).
  **Depende de:** T17.

---

## §3 — Trazabilidad propuesta `R<n>` → test

El implementer la confirma con nombres de caso reales (T17). Un requisito sin test
es un fallo de la feature.

| Req | Test propuesto |
| --- | --- |
| R1 | `orden-historial-repository.test.ts` (bloque del predicado nuevo, T8); `criterio-intento-entrega.test.ts` (T9) |
| R2 | `criterio-intento-entrega.test.ts` (`entregada`/`incidente` fuera de la lista, T9); `orden-historial-repository.test.ts` (T8) |
| R3 | `orden-historial-repository.test.ts` (cierre `aprobado` cuenta; `solicitado`/`vencido`/`rechazado` no, T8); `devolucion-sla-service.test.ts` (T12) |
| R4 | `devolucion-sla-service.test.ts` (re-aprobar → mismo número, T12); `orden-historial-repository.test.ts` (T8) |
| R5 | `orden-historial-repository.test.ts` (gestión anulada no cuenta, T8); `intentos-entrega-criterio-unico.test.ts` (T10); `T11b` (no descuenta) |
| R6 | `intentos-entrega-criterio-unico.test.ts` (suite entera, T10) |
| R7 | `orden-historial-repository.test.ts` (1 consulta con N ids; 0 con lote vacío, T8); `orden-historial-service.test.ts` (T11) |
| R8 | `orden-historial-repository.test.ts` + los 8 consumidores que ya asertan el `0` explícito (T14) |
| R9 | `orden-historial-service.test.ts` (degradación segura sobre enums, T11) |
| R10 | `devolucion-sla-service.test.ts` (una `devuelta` cuyo cierre no está aprobado no suma, T12) |
| R11 | `devolucion-sla-service.test.ts` (una `reprogramada` cuyo cierre no está aprobado no suma, T12) |
| R12 | `criterio-intento-entrega.test.ts` (T9) |
| R13 | Guardia de fuente: `grep` sin resultados sobre el criterio viejo (T4) + typecheck |
| R14 | `criterio-intento-entrega.test.ts` (no-regresión del mapa, T9) + la suite existente de transiciones de la 140, verde sin tocar |
| R15 | `devolucion-sla-service.test.ts` (T12) |
| R16 | `devolucion-sla-service.test.ts`, bloques `:83-131`, `:234-268`, `:269-330` verdes SIN cambios de aserción (T12/T14) |
| R17 | `devolucion-sla-dinero.test.ts` verde **sin tocarse** (T14) |
| R18 | `devolucion-sla-service.test.ts` (caso del lazo de `rechazada`, **T12b**) — ⛔ **pendiente de Q3** |
| R19 | La medición fechada de **T1** en `design.md §7.6` (evidencia documental, no test) — ⛔ **pendiente de Q4** |
| R20 | Las ~40 suites de consumidores y UI verdes sin tocarse (T14) |
| R21 | Los casos de alcance por rol/zona/tienda ya existentes en los 6 servicios, verdes (T14) |
| R22 | `intentos-no-alcance.test.ts` verde sin tocarse (T14) |
| R23 | `metrics.test.ts` (`R11 · los intentos no se redefinen`, T6/T13) + CHECK de base |
| R24 | `analitica-operativa-equivalencia.test.ts` + `analytics-daily-job.test.ts` (T13) — ⛔ **pendiente de Q10** |
| R25 | `criterio-intento-entrega.test.ts` (T9) + la derogación escrita en `requirements.md` |
| R26 | `criterio-intento-entrega.test.ts` (T9) + prosa retirada (T6) |
| R27 | `git diff --name-only -- db/` **vacío** (T15). Sin rama alternativa: D7 prohíbe materializar |
| R28 | Revisión de prosa (T6) + `metrics.test.ts` (T6) |
| R29 | `orden-historial-repository.test.ts` (dos gestiones vigentes en el MISMO cierre aprobado → 1, T8); `devolucion-sla-service.test.ts` (T12) |
| R30 | `orden-historial-repository.test.ts` (N cierres aprobados con resultado contable → N, T8) |
| R31 | `orden-historial-repository.test.ts` (el resultado cuenta aunque la orden ya cambió de estado; el `where` no menciona `estatus_id`, T8) |
| R32 | **T11b** (ningún test afirma que el conteo baje; caso explícito de monotonía) |
| R33 | `criterio-intento-entrega.test.ts` (`sin_gestionar` no está y no puede estar en la lista, T9/T2) + `orden-historial-repository.test.ts` (una orden cortada sin gestión → 0, T8) |

**Cobertura:** 33 requisitos, 33 con dueño. Los tres que siguen **sin poder
cerrarse** son R18 (Q3), R19 (Q4) y R24 (Q10); más el requisito nuevo que salga de
Q5. Todo lo demás es implementable ya.
