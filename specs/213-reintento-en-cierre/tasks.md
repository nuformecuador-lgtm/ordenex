# Feature 213 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas
de su mismo grupo. Cada tarea lleva su criterio de **hecho**.

> **PUERTA DE APROBACIÓN.** T0 es bloqueante para TODO lo demás: las 12 preguntas
> abiertas de `requirements.md` tienen que estar respondidas por el humano antes
> de escribir una línea de código de producción. Sin eso, T3 en adelante no se
> puede empezar (no se sabe qué predicado escribir).

Baseline declarado: worktree `C:/w213`, rama `feature/213-reintento-en-cierre`
desde `origin/dev` (ca73e771), dependencias instaladas, cliente Prisma generado,
**typecheck en VERDE**. Antes de afirmar cualquier delta, volver a medir (los
baselines caducan con cualquier PR ajeno).

---

## Grupo 0 — La puerta (bloqueante)

- [ ] **T0 — Llevar las 12 preguntas abiertas al humano y registrar las
  respuestas.** Q1–Q6 (ficha) y Q7–Q12 (descubiertas). Cada respuesta se escribe
  en `requirements.md` sustituyendo el `⛔ BLOQUEADO POR Qn` del requisito
  afectado, y en el `status_note` de la ficha.
  **Hecho:** ni un `⛔` sin resolver en `requirements.md`; R3, R18, R19, R24 y R27
  con texto EARS definitivo.
  **Depende de:** nada. **Bloquea:** T2–T13.

- [ ] **T1 — [P] Medición previa contra producción (⛔ Q4, patrón `160/D7`).**
  Consulta de SOLO LECTURA: para las órdenes que hoy reposan en `devuelta`,
  conteo con el criterio viejo vs. el nuevo, y cuántas cruzan
  `reintentosConfig.MIN_INTENTOS_ENTREGA` en cada dirección.
  **Hecho:** la consulta y su resultado, con fecha y base, pegados en
  `design.md §7.1`; el número de órdenes afectadas dicho en voz alta al humano
  ANTES de T0.
  **Depende de:** nada (informa T0).

---

## Grupo 1 — El criterio (núcleo)

- [ ] **T2 — Declarar la lista de resultados que cuentan.** Constante de
  INCLUSIÓN sobre `GestionResultado` (`{rechazada, devuelta, reprogramada}`) con
  `satisfies`, en `lib/types/` junto a los tipos de gestión, con la prosa del
  porqué (contar de más = cobrar antes de tiempo).
  **Hecho:** existe la constante, el `satisfies` rompe el build si un valor sale
  del enum, y hay un test que afirma que es lista de INCLUSIÓN (todos los demás
  resultados quedan fuera).
  **R:** R1, R2. **Depende de:** T0.

- [ ] **T3 — Reescribir el predicado único.** `whereIntentosVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts:105`) pasa a mirar
  `gestion_orden`: `resultado IN <lista>` + `anulada_at IS NULL` + el ancla del
  cierre decidida en Q2. Sigue siendo UNA función pura consumida por los DOS
  métodos de conteo.
  **Hecho:** `contarIntentosVigentes` y `contarIntentosVigentesEnLote` usan el
  mismo `where`; el lote sigue siendo UNA consulta (`groupBy`) y el lote vacío
  sigue sin emitir consulta.
  **R:** R1, R4, R5, R7, R8. **Depende de:** T2.

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
  consultas, orden sin intentos → `0`.
  **R:** R1, R2, R5, R7, R8. **Depende de:** T7.

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

- [ ] **T12 — Reescribir los tests del escalado SLA. [💰]**
  `tests/unit/services/devolucion-sla-service.test.ts`, bloque `:170-233`.
  Escenarios construidos con CIERRES, no con filas de historial. Añadir: (a)
  no-doble-conteo corte automático → aprobación sobre la misma orden; (b) el caso
  del lazo de `rechazada` según Q3; (c) el caso de `devuelta` sin cierre según Q5.
  **Hecho:** cada caso dice explícitamente si la orden escala o se libera; los
  bloques `:83-131`, `:234-248`, `:249-268` y `:269-330` siguen VERDES sin tocarse
  (R16).
  **R:** R15, R16, R18, R4, R5. **Depende de:** T3, T0 (Q3/Q5).

- [ ] **T13 — Semillas de analítica y equivalencia.**
  `tests/integration/db/_semilla-rollup.ts`, `analytics-daily-job.test.ts`,
  `analitica-operativa-equivalencia.test.ts`: las semillas deben crear cierres,
  no solo filas de historial.
  **Hecho:** el CHECK `primer_intento_ok <= entregas` se respeta; los tests
  corren **con datos** (verificar que no retornan temprano: comparar el número de
  aserciones ejecutadas, no el `passed`); la decisión de Q10 queda reflejada.
  **R:** R23, R24. **Depende de:** T3, T0 (Q10).

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

- [ ] **T15 — Guardia de «sin migración» (o derogación explícita).**
  **Hecho:** `git diff --name-only -- db/` vacío **o**, si Q1 se resolvió
  materializando, `160/R7` declarado DEROGADO por escrito en `requirements.md`
  con migración `up`+`down.sql` y backfill.
  **R:** R27. **Depende de:** T0.

- [ ] **T16 — Inventario de rojos medido contra la tabla de `design.md §6`.**
  **Hecho:** todo rojo de la corrida está en la tabla; ninguno se «arregló»
  conservando la afirmación vieja; cualquier rojo fuera de la tabla se reporta
  como hallazgo, no se silencia. Ojo con la suite degradada: comparar el total de
  archivos (~649) antes de creerse el conteo.
  **Depende de:** T8–T14.

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
| R3 | `orden-historial-repository.test.ts` (caso del ancla del cierre, T8); `devolucion-sla-service.test.ts` (T12) — **texto pendiente de Q2** |
| R4 | `devolucion-sla-service.test.ts` (no-doble-conteo corte → aprobación, T12); `orden-historial-repository.test.ts` (T8) |
| R5 | `orden-historial-repository.test.ts` (gestión anulada no cuenta, T8); `intentos-entrega-criterio-unico.test.ts` (T10) |
| R6 | `intentos-entrega-criterio-unico.test.ts` (suite entera, T10) |
| R7 | `orden-historial-repository.test.ts` (1 consulta con N ids; 0 con lote vacío, T8); `orden-historial-service.test.ts` (T11) |
| R8 | `orden-historial-repository.test.ts` + los 8 consumidores que ya asertan el `0` explícito (T14) |
| R9 | `orden-historial-service.test.ts` (degradación segura, T11) |
| R10 | `devolucion-sla-service.test.ts` (una `devuelta` sin cierre no suma, T12) |
| R11 | `devolucion-sla-service.test.ts` (una `reprogramada` sin cierre no suma, T12) |
| R12 | `criterio-intento-entrega.test.ts` (T9) |
| R13 | Guardia de fuente: `grep` sin resultados sobre el criterio viejo (T4) + typecheck |
| R14 | `criterio-intento-entrega.test.ts` (no-regresión del mapa, T9) + la suite existente de transiciones de la 140, verde sin tocar |
| R15 | `devolucion-sla-service.test.ts` (T12) |
| R16 | `devolucion-sla-service.test.ts`, bloques `:83-131`, `:234-268`, `:269-330` verdes SIN cambios de aserción (T12/T14) |
| R17 | `devolucion-sla-dinero.test.ts` verde **sin tocarse** (T14) |
| R18 | `devolucion-sla-service.test.ts` (caso del lazo de `rechazada`, T12) — **pendiente de Q3** |
| R19 | La medición fechada de T1 en `design.md §7.1` (evidencia documental, no test) |
| R20 | Las ~40 suites de consumidores y UI verdes sin tocarse (T14) |
| R21 | Los casos de alcance por rol/zona/tienda ya existentes en los 6 servicios, verdes (T14) |
| R22 | `intentos-no-alcance.test.ts` verde sin tocarse (T14) |
| R23 | `metrics.test.ts` (`R11 · los intentos no se redefinen`, T6/T13) + CHECK de base |
| R24 | `analitica-operativa-equivalencia.test.ts` + `analytics-daily-job.test.ts` (T13) — **pendiente de Q10** |
| R25 | `criterio-intento-entrega.test.ts` (T9) + la derogación escrita en `requirements.md` |
| R26 | `criterio-intento-entrega.test.ts` (T9) + prosa retirada (T6) |
| R27 | `git diff --name-only -- db/` vacío, o derogación escrita (T15) |
| R28 | Revisión de prosa (T6) + `metrics.test.ts` (T6) |
