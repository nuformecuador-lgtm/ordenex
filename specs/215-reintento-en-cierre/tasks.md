# Feature 215 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas
de su mismo grupo. Cada tarea lleva su criterio de **hecho**.

> **ESTADO 2026-08-13 — los grupos 1, 2 y 3 YA ESTÁN IMPLEMENTADOS** (commit
> `7d9471c3`; bitácora en `progress/impl_215.md`): 20 archivos modificados, 0 en
> `db/`, 30 requisitos con test real. Las tareas hechas van marcadas `[x]`.
>
> **Once preguntas CERRADAS** (D6–D15). **Queda Q4**, que no es una decisión sino
> una **medición sin ejecutar** (T1) y solo bloquea R19.
>
> **Trabajo NUEVO pendiente, en dos frentes:**
> - **Grupo 4** (T19–T22), tercera ronda: el discriminador de las gestiones
>   sintéticas. Implementa R18/R34 y **corrige un incumplimiento de R12** que la
>   implementación dejó abierto.
> - **Grupo 5** (T13, T23), cuarta ronda: la **deriva declarada** de
>   `primer_intento_ok` y el **último rojo declarado**, ya desbloqueados por D15.

Baseline declarado: worktree `C:/w213`, rama `feature/215-reintento-en-cierre`
desde `origin/dev` (ca73e771), dependencias instaladas, cliente Prisma generado,
**typecheck en VERDE**. Antes de afirmar cualquier delta, volver a medir (los
baselines caducan con cualquier PR ajeno).

---

## Grupo 0 — La puerta

- [x] **T0 — Cerrar preguntas con el humano.** **10 de 12 cerradas** el 2026-08-13
  en tres rondas: Q1/Q2/Q6/Q9 (D6–D8), Q7/Q8/Q11/Q12 como llamadas de juicio del
  leader (D9–D12) y **Q3/Q5** (D13/D14). Registradas en `requirements.md` §Segunda
  ronda, §Tercera ronda y §Preguntas cerradas, y como R29–R34.
  **Hecho:** R3, R18 y R27 desbloqueados con texto EARS definitivo.

- [ ] **T0b — Volver a la puerta con lo ÚNICO que falta: Q4.** No es una decisión;
  es la medición de T1 sin ejecutar. **Q10 quedó cerrada por D15** (deriva declarada
  con fecha de corte) y con ella R24 y R35.
  **Hecho:** ni un `⛔` sin resolver en `requirements.md`; R19 con texto EARS
  definitivo. **Depende de:** T1. **Bloquea:** T18.

- [ ] **T1 — [P] Ejecutar la medición del efecto retroactivo (⛔ Q4).** La consulta
  ya está escrita en `design.md §7.6` (solo lectura, dos consultas: resumen y
  detalle con `LIMIT 100`). Solo hay que correrla contra la base real.
  **Hecho:** resultado pegado en `design.md §7.6` **con fecha y base**; si
  `empiezan_a_escalar > 0`, la lista de esas órdenes se le enseña al humano una por
  una. **Depende de:** nada. **Informa:** T0b.

- [ ] **T1b — [P] Dimensionar el riesgo ACEPTADO de Q5.** Ejecutar la consulta de
  cierres no aprobados por estado y antigüedad (`design.md §7bis`, final). **Ya no
  informa ninguna decisión** (D14 cerró Q5 aceptando el riesgo): sirve para saber si
  el supuesto operativo se sostiene en producción.
  **Hecho:** resultado pegado en `design.md §7bis` con fecha; cuántos cierres
  `vencido`/`rechazado`/`solicitado` llevan más de 7 y más de 30 días.
  **Depende de:** nada. **No bloquea nada.**

---

## Grupo 1 — El criterio (núcleo)

- [x] **T2 — Declarar la lista de resultados que cuentan.** Constante de
  INCLUSIÓN sobre `GestionResultado` (`{rechazada, devuelta, reprogramada}`) con
  `satisfies`, en `lib/types/` junto a los tipos de gestión, con la prosa del
  porqué (contar de más = cobrar antes de tiempo).
  **Hecho:** existe la constante, el `satisfies` rompe el build si un valor sale
  del enum, y hay un test que afirma que es lista de INCLUSIÓN (todos los demás
  resultados quedan fuera).
  **R:** R1, R2, R33. **Depende de:** nada (Q6 cerrada por D6).

- [x] **T3 — Reescribir el predicado único.** `whereIntentosVigentes`
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

- [x] **T4 — Retirar el criterio viejo por completo.** Fuera
  `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (`lib/types/orden-historial.ts:147`) y las
  ramas de destino del predicado. `ORIGEN_TIPOS_CON_GESTION` (`:117`) **se queda**.
  **Hecho:** `grep -r ORIGEN_TIPOS_REPROGRAMADA_INTENTO` devuelve 0 en `lib/`,
  `app/`, `components/` y `tests/`; typecheck verde; no queda ningún camino de
  lectura que derive intentos de destinos de transición.
  **R:** R10, R11, R13. **Depende de:** T3.

- [x] **T5 — Simplificar el contrato.** `CriterioIntento`
  (`lib/interfaces/repositories/IOrdenHistorialRepository.ts:65`) y
  `resolverCriterio` (`lib/services/OrdenHistorialService.ts:95`) dejan de
  necesitar ids de `order_status`. R9 pasa a sostenerse sobre el enum de Prisma.
  **Hecho:** los 11 call-sites siguen compilando sin cambios (mismos tipos de
  retorno); el JSDoc de las dos interfaces describe el criterio nuevo.
  **R:** R6, R9. **Depende de:** T3.

- [x] **T6 — [P] Actualizar la prosa que afirma el criterio viejo.** El bloque
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

- [x] **T7 — Reescribir el evaluador semántico compartido.**
  `tests/fixtures/intentos-entrega.ts:59-108` (`filaCasaIntento`,
  `prismaHistorialSobreFilas`) desestructura la forma del `where` viejo. Se
  reescribe sobre filas de `gestion_orden`. **Sigue siendo UNO solo.**
  **Hecho:** `fakeIntentosEnLote` (`:20`) intacto (lo usan ~10 suites que deben
  seguir verdes); el evaluador nuevo lo consumen T8 y T9.
  **R:** R6. **Depende de:** T3.

- [x] **T8 — [P] Reescribir los tests del predicado.**
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

- [x] **T9 — [P] Reescribir los tests del criterio declarado.**
  `tests/unit/types/criterio-intento-entrega.test.ts` (7 casos): la parte de
  coherencia con el mapa de la 140 se conserva como **guardia de no-regresión del
  mapa** (R14); la de familias de origen se sustituye por la lista de resultados.
  **Hecho:** el caso «es lista de INCLUSIÓN» sobrevive con el objeto nuevo; hay un
  caso que afirma que ninguna arista del mapa cambió.
  **R:** R2, R12, R14. **Depende de:** T2.

- [x] **T10 — Adaptar el test de criterio ÚNICO.**
  `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera).
  **No cambia de propósito: es el test más importante de la feature.**
  **Hecho:** monta el repositorio REAL (sin mockear el conteo) y afirma que cron
  SLA, drawer y lote dan el MISMO número para la misma orden.
  **R:** R6. **Depende de:** T7.

- [x] **T11 — [P] Reescribir los tests del servicio.**
  `tests/unit/services/orden-historial-service.test.ts`, bloques `:303-357`,
  `:359-407` y el caso `:169`.
  **Hecho:** los casos de `resolverCriterio` se sustituyen; sobreviven lote vacío
  (R7), `0` (R8) y degradación segura (R9).
  **R:** R7, R8, R9, R20. **Depende de:** T5.

- [x] **T11b — [P] Reescribir los casos de ANULACIÓN como casos de MONOTONÍA.**
  Fila #16 de `design.md §6`: `orden-historial-repository.test.ts:475` y `:489`,
  `orden-historial-service.test.ts:154`, `devolucion-sla-service.test.ts:184`. Hoy
  afirman que anular una gestión **BAJA** el número; con D12 el número nunca baja,
  y lo que la anulación impide es que **LLEGUE A SUBIR**.
  **Hecho:** ningún test del repo afirma que el conteo pueda decrecer; hay un caso
  explícito de monotonía (misma orden, dos lecturas, el segundo número ≥ el
  primero). R5 sobrevive como «una gestión anulada no cuenta», no como «descuenta».
  **R:** R5, R32. **Depende de:** T3.

- [x] **T12 — Reescribir los tests del escalado SLA. [💰]**
  `tests/unit/services/devolucion-sla-service.test.ts`, bloque `:170-233`.
  Escenarios construidos con CIERRES APROBADOS, no con filas de historial. Añadir:
  (a) no-doble-conteo (dos gestiones vigentes en el mismo cierre aprobado → 1;
  re-aprobar → mismo número); (b) cierre `solicitado`/`vencido`/`rechazado` → la
  orden NO escala.
  **Hecho:** cada caso dice explícitamente si la orden escala o se libera; los
  bloques `:83-131`, `:234-248`, `:249-268` y `:269-330` siguen VERDES sin tocarse
  (R16).
  **R:** R3, R4, R5, R15, R16, R29. **Depende de:** T3.

- [x] ~~**T12b** — casos pendientes de Q3/Q5~~ → **Q3 se implementa en el Grupo 4;
  Q5 no genera trabajo (D14 acepta el riesgo sin mitigación).**

→ **T13 se mueve al Grupo 5** (desbloqueada por D15).

---

## Grupo 5 — CUARTA RONDA: la deriva declarada de `primer_intento_ok` (D15)

Desbloqueado por D15 («declara la deriva con fecha de corte»). Diseño completo en
`design.md §8`. **Nada de este grupo está implementado.**

- [ ] **T13 — Arreglar el ÚLTIMO rojo declarado SIN tocar lo que el test mide. [💰]**
  `tests/integration/db/analytics-daily-job.test.ts` · «primer intento vs entrega
  tras una devolucion previa (R17)» (`:602-663`).

  **La instrucción es explícita y no admite atajo: se REESCRIBE LA SEMILLA, NO LA
  ASERCIÓN.** El test está rojo porque su semilla crea la gestión `devuelta`
  **sin `cierre_id`** (`crearGestion` en `_semilla-rollup.ts:235-248` ni siquiera
  acepta uno, y ahí no se crea ningún `cierre_dia`), así que con el criterio nuevo
  esa devolución no cuenta y la entrega de hoy parece un primer intento. Lo que hay
  que hacer es **darle a esa `devuelta` su `cierre_dia` APROBADO**: ampliar la
  semilla con un helper que cree el cierre y vincule la gestión.

  > ⛔ **PROHIBIDO cambiar el número esperado.** Las aserciones de `:660-661`
  > —`primerIntentoOk` 0 para la reintentada, 1 para la limpia— son la ÚNICA prueba
  > de que el KPI distingue un reintento de un primer intento. Relajarlas es borrar
  > lo que el test existe para medir. Si alguien «lo arregla» así, el reviewer lo
  > rechaza.

  **Hecho:** el caso vuelve a verde **con las mismas aserciones**; el helper nuevo
  vive en `_semilla-rollup.ts` (no copiado en el test); el CHECK
  `primer_intento_ok <= entregas` se respeta; y se verifica que el test corre **con
  datos** (comparar aserciones ejecutadas, no el `passed`: con tabla vacía estos
  tests retornan temprano y pasan en falso).
  **R:** R23, R24-e. **Depende de:** T3. **No depende de** T19–T22.

- [ ] **T23 — Escribir la declaración de la deriva. [P]** Los cuatro sitios de
  `design.md §8.3`: `lib/analytics/metrics.ts` (`descripcion` de `primer_intento_ok`,
  `:334-335`), `AnaliticaRollupService.ts` (junto a `contarPrimerIntento`,
  `:230-242`), `AnaliticaOperativaService.ts` (`:894-901`) y `progress/impl_215.md`.

  Cada uno DEBE decir las tres cosas: (1) que el criterio cambió y el histórico **no
  se re-backfillea**; (2) la regla del corte — *toda fila con `updated_at` anterior
  al despliegue de la 215 está calculada con el criterio viejo; toda fila posterior,
  con el nuevo, **sea cual sea su `fecha`**, porque el job recalcula días pasados*;
  (3) el efecto **INTRADÍA**: una entrega cuya orden tiene cierres sin aprobar
  reporta 0 intentos previos, así que el KPI **sube durante el día y baja al
  aprobarse los cierres** — propiedad nueva y permanente, no un artefacto del cambio.

  **Hecho:** los cuatro sitios escritos; `git diff --name-only` NO toca `app/`,
  `components/` ni `db/` (R20/R27; el aviso en pantalla es ficha aparte, ver
  `requirements.md` §Tensión declarada); `metrics.test.ts` sigue verde.
  **R:** R24-a, R24-b, R24-c, R24-d, R35. **Depende de:** nada.

- [ ] **T24 — ACCIÓN HUMANA EN EL DESPLIEGUE (documental).** Anotar el instante real
  del despliegue en `progress/impl_215.md` y como fecha legible en la `descripcion`
  de la métrica.
  **No toca código, no exige re-desplegar, no bloquea el PR.** Si se olvida, la serie
  **sigue siendo interpretable fila a fila** por `updated_at` (R35) — se pierde solo
  la etiqueta cómoda. Esa es la razón de haber elegido el mecanismo derivado y no una
  constante en código (`design.md §8.2`).
  **Hecho:** la fecha/hora del despliegue escrita, con zona horaria.
  **R:** R35. **Depende de:** el despliegue.

---

## Grupo 3 — No regresión y cierre

- [x] **T14 — [P] Verificar los que deben seguir VERDES sin tocarse.** Las ~40
  suites de §6 de `design.md` (#11, #12, #13, #14): los 8 servicios/acciones
  consumidores, las 12 superficies de UI, `intentos-no-alcance.test.ts` y
  `devolucion-sla-dinero.test.ts`.
  **Hecho:** `git diff --name-only` no toca `components/`, `app/`,
  `tests/components/`, `tests/unit/components/`, `intentos-no-alcance.test.ts` ni
  `devolucion-sla-dinero.test.ts`; y esas suites están verdes.
  **R:** R17, R20, R21, R22. **Depende de:** T3.

- [x] **T15 — Guardia de «sin migración». Ya no hay rama alternativa.**
  D7 prohíbe materializar el contador y `160/R7` se conserva.
  **Hecho:** `git diff --name-only -- db/` **vacío**. Si aparece cualquier cambio en
  `db/` —schema, migración o `down.sql`— es un incumplimiento de R27 y hay que
  volver a la puerta, no justificarlo.
  **R:** R27. **Depende de:** T3.

- [x] **T16 — Inventario de rojos medido contra la tabla de `design.md §6`.**
  **Hecho:** todo rojo de la corrida está en la tabla; ninguno se «arregló»
  conservando la afirmación vieja; cualquier rojo fuera de la tabla se reporta
  como hallazgo, no se silencia. Ojo con la suite degradada: comparar el total de
  archivos (~649) antes de creerse el conteo.
  **Depende de:** T8–T14 (y T11b).

- [x] **T17 — Cerrar la trazabilidad** (30 de 33 req; R18/R19/R24 sin dueño)**.** Rellenar el mapa R → test real en
  `progress/impl_215.md §2` y en `requirements.md`.
  **Hecho:** ningún `R<n>` sin al menos un test con ruta y nombre de caso reales.
  **Depende de:** T16.

- [ ] **T18 — Gate completo antes del PR.** `./init.sh --rapido` para cerrar cada
  tanda; **`./init.sh` completo antes del PR, sin excepción**.
  **Hecho:** salida verde pegada en `progress/impl_215.md`, con el delta de rojos
  medido contra el baseline REMEDIDO de `dev` (no contra el citado en la bitácora),
  y el rojo declarado de Q10 (`analytics-daily-job.test.ts`) enumerado como tal.
  **Depende de:** T17, T22, T0b.

---

## Grupo 4 — TERCERA RONDA: el discriminador de las gestiones sintéticas (D13)

**Nada de este grupo está implementado.** Es lo que abre el cierre de Q3, y de paso
corrige el incumplimiento de R12 que 7d9471c3 dejó abierto. Diseño completo, con
archivo:línea, en `design.md §3.4`.

- [x] **T19 — Declarar la lista de familias de VISITA REAL.** Constante de
  INCLUSIÓN sobre `OrdenHistorialOrigenTipo` (hoy: `["gestion"]`) con `satisfies`,
  en `lib/types/orden-historial.ts`, con la prosa del porqué: una familia sintética
  futura NO puede empezar a contar sola.
  **Hecho:** existe la constante; el `satisfies` rompe el build si el valor sale del
  enum; hay un test que afirma que es lista de INCLUSIÓN y que
  `escalado_devuelta_sla` y `reprogramacion_tienda` quedan fuera.
  **R:** R34-c. **Depende de:** nada.

- [x] **T20 — Añadir la condición al predicado único.** En `whereIntentosVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts`), la sexta condición:
  `historialEstados: { some: { ordenId: <el mismo filtro>, origenTipo: { in: <lista> } } }`.
  El `ordenId` redundante dentro del `some` **no es decorativo**: es lo que hace que
  el `EXISTS` entre por `@@index([ordenId, createdAt])` en vez de por un
  `gestion_orden_id` sin índice (`design.md §3.4`).
  **Hecho:** el predicado sigue siendo UNO solo para los dos conteos (R6); el lote
  sigue siendo UNA consulta (R7); typecheck verde. **NO toca `db/`** (R27).
  **R:** R12, R18-b, R34-a, R34-b. **Depende de:** T19.

- [x] **T21 — Tests del discriminador. [💰]** En
  `orden-historial-repository.test.ts` y `criterio-intento-entrega.test.ts`; el
  fixture `tests/fixtures/intentos-entrega.ts` necesita **filas de historial además
  de gestiones**.
  **Hecho:** cuatro casos nuevos — (a) la sintética del escalado SLA no cuenta
  aunque su cierre esté aprobado (R18-b); (b) la reprogramación de la tienda no
  cuenta aunque su cierre esté aprobado (**R12, el que hoy falta**); (c) la lista es
  de INCLUSIÓN (R34-c); (d) una gestión sin fila de historial no cuenta (R34-d).
  Y **R12 se REASIGNA**: deja de apuntar al caso del mapa
  («R12/R14: ninguna arista decide por sí sola…», que se queda cubriendo solo R14).
  **R:** R12, R18, R34. **Depende de:** T20.

- [~] **T22 — Medir el coste de la consulta. [💰] — PARCIAL, medido solo contra la
  base LOCAL de desarrollo (78 órdenes, 44 `gestion_orden`, 278
  `orden_historial_estado`, 7 `cierre_dia`). NO es producción y los planes NO son
  extrapolables.** Lo que sí quedó demostrado limpio: con el `orden_id` repetido
  dentro del `some` el `EXISTS` entra por índice (`Index Cond: orden_id = …`,
  `origen_tipo` residual) y SIN repetirlo el planner elige `Seq Scan` — el truco de
  `design.md §3.4` se confirma. El plan **NO pidió índice nuevo**, así que no hubo
  que parar. El lote de 100 no es concluyente a este volumen. Filas legadas de
  R34-d: 0 en local (no en producción). Queda pendiente medir con volumen real,
  misma puerta que Q4. Detalle fechado en `design.md §3.4`.** `EXPLAIN (ANALYZE, BUFFERS)` de
  las dos rutas (individual y lote de 100) antes y después de T20; y la consulta de
  filas legadas de `design.md §3.4` (gestiones contables sin fila de historial).
  **Hecho:** los planes y el conteo de legadas pegados en `design.md §3.4` con
  fecha. **SI el plan pidiera un índice nuevo sobre `gestion_orden_id`: PARAR.** Eso
  es una migración, D7/R27 la prohíben, y es decisión del humano — no se añade «de
  paso».
  **R:** R27 (que no se cruce), R34-d. **Depende de:** T20.

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
| R12 | **T21** · la reprogramación de la tienda no cuenta aunque su cierre esté aprobado. ⚠️ El caso actual (`criterio-intento-entrega.test.ts` · «R12/R14: ninguna arista decide por sí sola…») mide el MAPA, no el predicado: se **reasigna a R14** |
| R13 | Guardia de fuente: `grep` sin resultados sobre el criterio viejo (T4) + typecheck |
| R14 | `criterio-intento-entrega.test.ts` (no-regresión del mapa, T9) + la suite existente de transiciones de la 140, verde sin tocar |
| R15 | `devolucion-sla-service.test.ts` (T12) |
| R16 | `devolucion-sla-service.test.ts`, bloques `:83-131`, `:234-268`, `:269-330` verdes SIN cambios de aserción (T12/T14) |
| R17 | `devolucion-sla-dinero.test.ts` verde **sin tocarse** (T14) |
| R18 | **T21** · (a) la gestión sintética del escalado SLA no cuenta aunque su cierre esté aprobado; (c) el cron sigue validando el umbral antes de escalar (`devolucion-sla-service.test.ts`, casos existentes de R15/R16); (d) `devolucion-sla-dinero.test.ts` verde sin tocarse = sigue cobrando como rechazo |
| R19 | La medición fechada de **T1** en `design.md §7.6` (evidencia documental, no test) — ⛔ **pendiente de Q4** |
| R20 | Las ~40 suites de consumidores y UI verdes sin tocarse (T14) |
| R21 | Los casos de alcance por rol/zona/tienda ya existentes en los 6 servicios, verdes (T14) |
| R22 | `intentos-no-alcance.test.ts` verde sin tocarse (T14) |
| R23 | `metrics.test.ts` (`R11 · los intentos no se redefinen`, T6/T13) + CHECK de base |
| R24 | **T13** · «primer intento vs entrega tras una devolucion previa (R17)» verde **con las aserciones intactas** (R24-e) · **T23** · guardia de prosa en los cuatro sitios de `design.md §8.3` (R24-a/b/c/d) |
| R25 | `criterio-intento-entrega.test.ts` (T9) + la derogación escrita en `requirements.md` |
| R26 | `criterio-intento-entrega.test.ts` (T9) + prosa retirada (T6) |
| R27 | `git diff --name-only -- db/` **vacío** (T15). Sin rama alternativa: D7 prohíbe materializar |
| R28 | Revisión de prosa (T6) + `metrics.test.ts` (T6) |
| R29 | `orden-historial-repository.test.ts` (dos gestiones vigentes en el MISMO cierre aprobado → 1, T8); `devolucion-sla-service.test.ts` (T12) |
| R30 | `orden-historial-repository.test.ts` (N cierres aprobados con resultado contable → N, T8) |
| R31 | `orden-historial-repository.test.ts` (el resultado cuenta aunque la orden ya cambió de estado; el `where` no menciona `estatus_id`, T8) |
| R32 | **T11b** (ningún test afirma que el conteo baje; caso explícito de monotonía) |
| R33 | `criterio-intento-entrega.test.ts` (`sin_gestionar` no está y no puede estar en la lista, T9/T2) + `orden-historial-repository.test.ts` (una orden cortada sin gestión → 0, T8) |
| R34 | **T19** (lista de INCLUSIÓN) + **T21** (a/b/c/d) + **T22** (conteo de gestiones legadas sin fila de historial) |
| R35 | **T23** (la regla del corte escrita en los cuatro sitios, sin constante nueva) + **T24** (la anotación del despliegue) + guardia: `git diff -- db/` vacío |

**Cobertura:** 35 requisitos, 35 con dueño.

- **30 cerrados y verdes** en `7d9471c3` (mapa real con nombres de caso en
  `progress/impl_215.md §2`).
- **R12, R18 y R34** → Grupo 4 (T19–T22). R12 figuraba como cubierto y **no lo
  estaba**: su test medía el mapa, no el predicado.
- **R24 y R35** → Grupo 5 (T13, T23, T24), desbloqueados por D15. Con T13 se cierra
  **el último rojo declarado** de la feature.
- **R19** → lo único que sigue dependiendo de algo externo: ejecutar la medición de
  T1 (Q4). No es una decisión, es una consulta sin correr.
