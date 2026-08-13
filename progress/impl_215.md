# Feature 215 — bitacora de implementacion

**Rama:** `feature/215-reintento-en-cierre` (worktree `C:/w213`, desde `origin/dev`).
**Fecha:** 2026-08-13. **Alcance:** RECORTADO — ver §4.

El intento de entrega deja de derivarse de `orden_historial_estado` (destinos de
transicion) y pasa a derivarse de `gestion_orden`: resultado contable + gestion
vigente + cierre APROBADO. Sin migracion (D7/R27) y sin tocar el mapa de estados.

Predicado implementado, en `whereIntentosVigentes`
(`lib/repositories/OrdenHistorialRepository.ts`):

    conteo(orden) = n.º de cierre_id DISTINTOS entre las gestion_orden tales que
        orden_id = <orden>
    AND resultado IN {rechazada, devuelta, reprogramada}   (D2/D6)
    AND anulada_at IS NULL                                 (R5)
    AND cierre_id IS NOT NULL
    AND cierre.estado = aprobado                           (D8/R3)

---

## 1. Archivos creados / modificados

Ninguno creado. **20 modificados, 0 en `db/`.**

### Produccion (13)

| Archivo | Que cambia |
| --- | --- |
| `lib/types/orden-historial.ts` | **Nueva** `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` (+ `ResultadoIntentoEntrega`), lista de INCLUSION con `satisfies readonly GestionResultado[]`. Vive aqui y no en `lib/types/gestion-orden.ts` porque ese archivo viaja al bundle del cliente y no puede importar `@prisma/client` |
| `lib/repositories/OrdenHistorialRepository.ts` | `whereIntentosVigentes` cambia de tabla; los dos conteos pasan a `groupBy` sobre `gestionOrden`; el `Pick` del cliente gana `gestionOrden` |
| `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | Se RETIRA `CriterioIntento`; las dos firmas pierden el parametro `criterio` |
| `lib/services/OrdenHistorialService.ts` | Se BORRAN `resolverCriterio`, `ESTATUS_DEVUELTA`, `ESTATUS_REPROGRAMADA`; los dos metodos delegan directo |
| `lib/interfaces/services/IOrdenHistorialService.ts` | JSDoc del criterio nuevo |
| `lib/types/orden-historial.ts` | Se BORRA `ORIGEN_TIPOS_REPROGRAMADA_INTENTO`; el bloque de ~60 lineas de prosa del criterio viejo se sustituye. `ORIGEN_TIPOS_CON_GESTION` **se conserva** |
| `lib/services/DevolucionSlaService.ts` | **Solo prosa** (comentario `:109-116`). Cero cambio de logica |
| `lib/analytics/metrics.ts` | `descripcion` de `primer_intento_ok` reescrita; id de criterio renombrado |
| `lib/analytics/types.ts` | El literal del tipo `criterio` sigue al renombre |
| `lib/types/orden.ts`, `lib/types/novedad.ts`, `lib/interfaces/services/IMisAsignacionesService.ts`, `lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts` | **Solo JSDoc**: 4 frases que afirmaban textualmente el criterio viejo (R28) |

Renombre del id de criterio de analitica: `intentos_vigentes_historial` ->
`intentos_por_cierre_aprobado`. El string viejo mentia (historial). No esta
persistido en ninguna tabla: solo vive en el catalogo de metricas.

### Tests (7)

`tests/fixtures/intentos-entrega.ts`,
`tests/unit/repositories/orden-historial-repository.test.ts`,
`tests/unit/types/criterio-intento-entrega.test.ts`,
`tests/unit/services/intentos-entrega-criterio-unico.test.ts`,
`tests/unit/services/orden-historial-service.test.ts`,
`tests/unit/services/devolucion-sla-service.test.ts`,
`tests/unit/analytics/metrics.test.ts`.

### Lo que NO se toco (verificado con `git status`)

`db/` (R27, guardia de la feature), `components/`, `app/`,
`tests/unit/components/`, `tests/components/`, `intentos-no-alcance.test.ts`,
`devolucion-sla-dinero.test.ts`, y los cinco archivos que la feature 208 tiene en
vuelo (`CierreDiaService`, `CierreDiaRepository`, `CierresAdminRepository`,
`GestionOrdenRepository`, `MisAsignacionesService`).

---

## 2. Trazabilidad `R<n>` -> test

| Req | Test (ruta + nombre del caso) |
| --- | --- |
| R1 | `orden-historial-repository.test.ts` · «R1: el resultado `%s` en un cierre APROBADO cuenta como intento» (3 casos) · `criterio-intento-entrega.test.ts` · «R1: la lista es EXACTAMENTE rechazada, devuelta y reprogramada» + «R1: `rechazada` cuenta, y con el criterio viejo no contaba por ninguna via» |
| R2 | `orden-historial-repository.test.ts` · «R2: el resultado `%s` NO cuenta, ni con el cierre aprobado» (2 casos) · `criterio-intento-entrega.test.ts` · «R2: `entregada` e `incidente` NO estan en la lista» |
| R3 | `orden-historial-repository.test.ts` · «R3: cierre `aprobado` -> cuenta», «R3: cierre en `%s` -> NO cuenta» (3 casos), «R3: gestion del dia AUN SIN CERRAR (`cierre_id` NULL) -> NO cuenta» · `devolucion-sla-service.test.ts` · «R15/R3: 3 cierres APROBADOS ... -> ESCALA», «R3 (Q5): los mismos 3 resultados con los cierres en `%s` -> conteo 0 -> LIBERA» |
| R4 | `orden-historial-repository.test.ts` · «R4: el `where` del LOTE es IDENTICO al del individual salvo `ordenId`», «R4: individual y lote coinciden sobre las mismas filas» · `orden-historial-service.test.ts` · «R4: individual y lote comparten el punto unico y dan el mismo numero» · `devolucion-sla-service.test.ts` · «R29/R4: ... y releer da lo mismo» (re-aprobar el mismo cierre no duplica) |
| R5 | `orden-historial-repository.test.ts` · «R5: una gestion ANULADA no cuenta, y la exclusion es un filtro de LECTURA» · `orden-historial-service.test.ts` · «R5/R32: la gestion anulada NO cuenta (no descuenta) ...» · `devolucion-sla-service.test.ts` · «R5: gestiones anuladas antes de que su cierre se apruebe -> no llegan a contar» |
| R6 | `intentos-entrega-criterio-unico.test.ts` · **suite entera**, describe «R6 — el cron SLA, el drawer y el lote ven EL MISMO numero» (repo REAL sobre el doble de Prisma) · `orden-historial-service.test.ts` · «R6: consume `contarIntentosVigentes`, y el contrato no expone un conteo sin filtrar» |
| R7 | `orden-historial-repository.test.ts` · «R7: con N ids emite EXACTAMENTE 1 consulta (groupBy) y CERO count/findMany», «R7: `ids` vacio -> Map vacio y CERO consultas» · `orden-historial-service.test.ts` · «R7: consulta el repo UNA vez para todo el lote ...», «R7: lote vacio -> Map vacio, sin tocar el repo NI el catalogo» · `intentos-entrega-criterio-unico.test.ts` · «R7: el lote de N ordenes emite UNA sola consulta» |
| R8 | `orden-historial-repository.test.ts` · «R8: orden sin gestiones contables -> 0» · `orden-historial-service.test.ts` · «R8: sin intentos -> 0 explicito», «R8: una orden sin intentos no viene en el Map (el llamador aplica `?? 0`)» + los 8 consumidores que ya asertan el 0 explicito (§3) |
| R9 | `orden-historial-service.test.ts` · «R9: el conteo NO consulta el catalogo de estados ni una sola vez», «R9: con el catalogo VACIO el numero es el mismo (el criterio no se apoya en el)» |
| R10 | `devolucion-sla-service.test.ts` · «R10: una `devuelta` del mensajero cuyo cierre AUN no esta aprobado no suma por si sola» |
| R11 | `devolucion-sla-service.test.ts` · «R11: una `reprogramada` del mensajero cuyo cierre aun no esta aprobado no suma por si sola» |
| R12 | **REASIGNADO (Grupo 4).** `orden-historial-repository.test.ts` · «R12: la reprogramacion de la TIENDA no cuenta, aunque su cierre este APROBADO», «R12: `devuelta` real + reprogramacion de la tienda en OTRO cierre aprobado -> 1, no 2», «R12: las dos en el MISMO cierre aprobado tambien -> 1 (R29 no lo tapa: es el origen)» · `devolucion-sla-service.test.ts` · «R12: 2 visitas reales + la reprogramacion de la TIENDA (cierre aprobado) -> 2, LIBERA y NO cobra» [💰]. El caso viejo de `criterio-intento-entrega.test.ts` medía el MAPA, no el predicado: se reasigna a R14 |
| R13 | `criterio-intento-entrega.test.ts` · «R13/R25: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` ya NO existe como export» + guardia de fuente: grep sin resultados en `lib/`, `app/`, `components/` + typecheck verde |
| R14 | `criterio-intento-entrega.test.ts` · «R14: siguen existiendo EXACTAMENTE 2 aristas con destino `reprogramada` (#13 y #22)», «R14: `devuelta` sigue teniendo al menos una arista ...», «R14/158-Q-D: las salidas de `incidente` siguen siendo las 6 declaradas», «R14/D3: no existe ningun estado `indemnizada`» |
| R15 | `devolucion-sla-service.test.ts` · «R15/R3: 3 cierres APROBADOS con resultado contable, umbral 3 -> ESCALA» · `intentos-entrega-criterio-unico.test.ts` · «R15: 1 devuelta + 2 reprogramadas en 3 cierres APROBADOS -> drawer 3 y el cron ESCALA» |
| R16 | `devolucion-sla-service.test.ts` · bloques de ventana 24h, `wrong_*`, atribucion (R22), reloj inyectable y resiliencia/idempotencia — **verdes SIN cambio de asercion** + «R16: `wrong_number`/`wrong_address` siguen escalando DIRECTO, sin consultar el conteo», «R16: el conteo se consulta UNA vez por orden y con SU id» |
| R17 | `tests/unit/services/devolucion-sla-dinero.test.ts` — **verde sin tocarse** (4 casos de dinero) |
| R18 | **(a)+(c)+(d)** `intentos-entrega-criterio-unico.test.ts` · «R18-a/b/c/d: la sintetica del cron NO suma como INTENTO pero SI cobra como RECHAZO» (repo REAL sobre el doble de Prisma: el cron compara 3 >= umbral y escala; la sintetica en el cierre `c4` APROBADO deja el conteo en 3, no 4, en individual y en lote; `ingresoBodegaPorResultado("rechazada", tarifa)` sigue devolviendo el cobro) · **(b)** `orden-historial-repository.test.ts` · «R18-b: la sintetica del ESCALADO SLA no cuenta, aunque su cierre este APROBADO» y `devolucion-sla-service.test.ts` · «R18-b: 2 visitas reales + la sintetica del ESCALADO SLA (cierre aprobado) -> 2, LIBERA» · **(c)** los casos R15/R16 preexistentes de `devolucion-sla-service.test.ts`, verdes SIN cambio de asercion · **(d)** `devolucion-sla-dinero.test.ts`, **verde sin tocarse** |
| R19 | **SIN DUEÑO — bloqueado por Q4.** La medicion contra la base real no se ejecuto |
| R20 | Las ~40 suites de consumidores y UI, **verdes sin tocarse** (§3) · `orden-historial-service.test.ts` · «R10/R20: `intentos` sale del punto unico nuevo y el umbral sigue viajando» |
| R21 | Los casos de alcance por rol/zona/tienda ya existentes, verdes sin tocarse: `orden-historial-service.test.ts` (bloque de autorizacion, 13 casos) + los 6 servicios consumidores |
| R22 | `tests/unit/types/intentos-no-alcance.test.ts` — **verde sin tocarse** |
| R23 | `tests/unit/analytics/metrics.test.ts` · «primer_intento_ok remite al criterio de intentos vigentes del historial» (id actualizado), «primer_intento_ok no declara umbral propio ni columna materializada», «ninguna otra metrica inventa un criterio de intentos distinto» |
| R24 | **SIN DUEÑO — bloqueado por Q10.** No implementado; ver §5 (1 rojo declarado) |
| R25 | `criterio-intento-entrega.test.ts` · «R13/R25: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` ya NO existe como export» + la derogacion escrita en `requirements.md` |
| R26 | `criterio-intento-entrega.test.ts` · «R26: `ORIGEN_TIPOS_CON_GESTION` sobrevive con su dueno real (la nulidad del enlace)» + prosa del doble conteo retirada de `lib/types/orden-historial.ts` |
| R27 | `git diff --name-only -- db/` **vacio** (medido, §3) |
| R28 | Revision de prosa: `lib/types/orden-historial.ts`, JSDoc de `whereIntentosVigentes` y de las dos interfaces, comentario de `DevolucionSlaService`, `descripcion` de `primer_intento_ok`, 4 JSDoc de campo `intentos` y `metrics.test.ts` |
| R29 | `orden-historial-repository.test.ts` · «R29: DOS gestiones vigentes contables en el MISMO cierre aprobado -> 1, no 2», «R29: dos gestiones vigentes de la misma orden en el MISMO cierre -> 1 en el lote» · `devolucion-sla-service.test.ts` · «R29/R4: 2 gestiones vigentes en el MISMO cierre aprobado -> conteo 1 -> LIBERA» · `intentos-entrega-criterio-unico.test.ts` · «R29: 2 gestiones vigentes en el MISMO cierre aprobado -> 1, y el cron LIBERA» |
| R30 | `orden-historial-repository.test.ts` · «R30: 3 cierres aprobados distintos con resultado contable -> 3», «caso mixto: de 7 gestiones solo cuentan 2 cierres aprobados distintos» |
| R31 | `orden-historial-repository.test.ts` · «R31: el `where` no menciona el estado ACTUAL de la orden», «R31: el resultado cuenta aunque la orden ya haya cambiado de estado despues» |
| R32 | `orden-historial-repository.test.ts` · «R32: anadir una gestion ANULADA no hace bajar el conteo (no sube, no baja)», «R32: cuando el cierre pasa de `solicitado` a `aprobado`, el conteo SUBE (nunca baja)» · `orden-historial-service.test.ts` · «R32: dos lecturas del drawer separadas por la aprobacion de un cierre -> el numero no baja» |
| R33 | `criterio-intento-entrega.test.ts` · «R33: `sin_gestionar` no esta en la lista y NO PUEDE estar (no es un GestionResultado)» · `orden-historial-repository.test.ts` · «R33: una orden cortada por el cron (sin ninguna gestion) -> 0» |
| R34 | **(a)** `orden-historial-repository.test.ts` · «R6/R12/R18-b: en el LOTE las sinteticas tampoco cuentan, con el mismo predicado» + los dos casos por familia (R12 y R18-b) · **(b)** sin columna nueva ni migracion: `git diff --name-only -- db/` **vacio** · **(c)** `criterio-intento-entrega.test.ts` · «R34-a: la lista es EXACTAMENTE `gestion`…», «R34-c: es lista de INCLUSION — TODAS las demas familias del enum quedan FUERA», «R34-c: el predicado usa la lista con `in` y NO contiene ningun `none` ni `notIn`» + `orden-historial-repository.test.ts` · «R34-c: el `some` filtra por familia con `in` y repite el `ordenId` (sin `none`/`notIn`)» · **(d)** `orden-historial-repository.test.ts` · «R34-d: gestion contable, vigente y en cierre APROBADO pero SIN fila de historial -> 0» |

**Cobertura: 33 de 34 requisitos con test real** (tras el Grupo 4). **Sin dueño y sin
implementar: R19 (Q4, medición no ejecutada contra la base real) y R24 (Q10).** R18,
R34 y R12 —que figuraba como cubierto y NO lo estaba— quedan cerrados en §8.

---

## 3. Verificacion — salida real (2026-08-13, worktree `C:/w213`)

    $ pnpm exec tsc --noEmit -p tsconfig.json
    (salida vacia)  exit=0

    $ git diff --name-only -- db/
    (vacio)                                <- R27, guardia de la feature

    $ grep -rn "ORIGEN_TIPOS_REPROGRAMADA_INTENTO" lib/ app/ components/
    (0 resultados; en tests solo dentro del caso que afirma que ya no existe)
    $ grep -rn "intentos_vigentes_historial" lib/ app/ components/ tests/
    (0 resultados; solo la nota historica del renombre en metrics.ts)

    $ pnpm exec vitest run  <las 6 suites tocadas>
     Test Files  6 passed (6)
          Tests  153 passed (153)

    $ pnpm exec vitest run  <11 consumidores + UI + analytics + intentos-no-alcance + devolucion-sla-dinero>
     Test Files  148 passed (148)
          Tests  1702 passed (1702)

    $ pnpm exec vitest run tests/integration/db/analytics-daily-job.test.ts \
                           tests/integration/db/analitica-operativa-equivalencia.test.ts
     Test Files  1 failed | 1 passed (2)
          Tests  1 failed | 30 passed (31)     <- el rojo esta declarado en §5

    $ pnpm exec eslint $(git diff --name-only)
    (0 errores, 0 warnings)  exit=0

Suites consumidoras verificadas verdes sin tocarse: `manifiesto-service`,
`mis-asignaciones-service`, `NovedadesService`, `orden-service`,
`recepcion-satelite-{service,paginado,completo,vigencia}`,
`rechazos-sla-tienda-service`, `liberacion-reprogramada-action`,
`orden-historial-action`, `satelite-catalogos`, `devolucion-sla-dinero`,
`intentos-no-alcance`, `tests/unit/analytics/` completo,
`components/intentos-entrega.test.tsx`, `components/ordenes-columns.test.tsx`.

**Pendiente antes del PR (T18):** `./init.sh` completo, con el delta de rojos
medido contra un baseline REMEDIDO de `dev`. Esta bitacora no lo sustituye.

---

## 4. Alcance recortado — lo que NO se implemento y por que

| Req | Bloqueado por | Estado |
| --- | --- | --- |
| **R18** | ~~Q3~~ **CERRADA por D13** el 2026-08-13 | **IMPLEMENTADO en el Grupo 4 (§8).** Esta fila queda como historico |
| **R19** | **Q4** — efecto retroactivo; falta EJECUTAR la consulta de `design.md §7.6` contra la base real y pegar el resultado con fecha | No se ejecuto ninguna consulta contra ninguna base |
| **R24** | **Q10** — deriva del KPI `primer_intento_ok` PERSISTIDO en `analytics_daily` (CHECK `primer_intento_ok <= entregas`) | No implementado. Consecuencia medida en §5 |

**Q5 sigue ABIERTA y sin mitigacion.** No se implemento M1, M2 ni M3 de
`design.md §7bis`. El camino queda **DOCUMENTADO, no tapado**, en tres sitios:

- `lib/repositories/OrdenHistorialRepository.ts` (JSDoc del predicado): con el
  ancla en `aprobado` el riesgo de la feature no es cobrar de mas, es NO COBRAR.
- `lib/services/DevolucionSlaService.ts:122`: Q5 nombrada como abierta.
- `tests/unit/services/intentos-entrega-criterio-unico.test.ts` · caso
  **«Q5 (ABIERTA): con los cierres en `solicitado` el conteo es 0 y el cron LIBERA
  en bucle»**, y `devolucion-sla-service.test.ts` ·
  «R3 (Q5): los mismos 3 resultados con los cierres en `%s` -> conteo 0 -> LIBERA».
  Esos dos casos **asertan el comportamiento actual, que es el riesgo**: si el
  humano elige una mitigacion, son los tests que hay que cambiar.

---

## 5. El unico rojo — CAIDO en la tanda del Grupo 5 (ver §9)

> **Estado 2026-08-13 (segunda tanda):** este rojo ya **NO existe**. T13 lo cerro
> reescribiendo la SEMILLA, con las aserciones intactas. Lo que sigue se conserva
> como registro de la causa medida; el arreglo esta en **§9.1**.

### Como estaba (registro historico)

    tests/integration/db/analytics-daily-job.test.ts
      > medidas (T6.4) > primer intento vs entrega tras una devolucion previa (R17)
      AssertionError: expected [1, 1] to deeply equal [1, 0]

Causa medida, leyendo la semilla (`:620-648`): crea una `gestion_orden` con
resultado `devuelta` **sin `cierre_id`**, mas una transicion de historial a
`devuelta`. Con el criterio nuevo esa gestion cuenta 0 => la entrega de hoy pasa a
contarse como `primer_intento_ok = 1`. Es **exactamente** el efecto que
`design.md` §8 anticipo (el KPI subira mecanicamente).

Arreglarlo = reescribir las semillas para que creen **cierres aprobados**, que es
**T13, bloqueado por Q10/R24**. **No se toco.** El test corre CON datos (no
retorna temprano): 28 de 29 casos del archivo pasan.

**Desbloqueado por D15 y hecho: ver §9.1.** Hoy el archivo pasa 29 de 29.

`analitica-operativa-equivalencia.test.ts` pasa **con datos**: 2/2, sin retorno
temprano.

---

## 6. Tests reexpresados — que mutacion sigue matando cada uno

Ninguno se borro ni se relajo. Cada afirmacion vieja o se reexpresa conservando lo
que mataba, o se sustituye por otra que mata la misma mutacion.

### `orden-historial-repository.test.ts` (3 bloques, 18 casos -> 25)

| Viejo | Nuevo | Mutacion que sigue matando |
| --- | --- | --- |
| «el OR de DESTINOS es (devuelta) o (reprogramada+gestion), por INCLUSION» | «INCLUSION: el filtro de resultados usa `in` y NO contiene ningun `notIn`» | Reescribir la lista como NEGRA: un `resultado` futuro del enum empezaria a contar solo, adelantaria el escalado y cobraria `cobroRechazado` antes de tiempo |
| «R12: con N ids emite 1 consulta» | «R7: 1 groupBy y CERO count/findMany» | N+1 por fila en el listado paginado |
| «R13: `ids` vacio -> 0 consultas» | idem bajo R7 | Quitar la guarda temprana |
| «R4: el `where` del LOTE es el MISMO» | «R4: IDENTICO salvo `ordenId`» (compara los objetos tras borrar `ordenId`) | Un segundo `where` copia-pegado: el numero de la UI diverge del que dispara el dinero |
| «R24: NO cuenta la de una gestion ANULADA» y «160/R5: la reprogramada anulada tampoco» | «R5: una gestion ANULADA no cuenta, y la exclusion es un filtro de LECTURA», mas **2 casos nuevos de monotonia (R32)** | Quitar `anuladaAt: null`; y ademas: reintroducir cualquier camino que haga BAJAR el conteo, o convertir la exclusion en escritura |
| «160/R3: destino `incidente` no altera el conteo» | «R2: el resultado X NO cuenta, ni con el cierre aprobado» (`entregada`, `incidente`) | Meter `entregada` o `incidente` en la lista |
| «160/R6: sin `reprogramada` en el catalogo, solo la rama A» | RETIRADO (el criterio ya no usa ids de catalogo); su proposito, la degradacion segura, se traslada a los dos casos R9 del servicio | Reintroducir una dependencia de catalogo que degrade a 0 |
| — | **NUEVOS**: R3 (`aprobado` si; `solicitado`/`vencido`/`rechazado`/`cierre_id` NULL no), R29, R30, R31, R33 | R29 mata la mutacion groupBy -> count() **por dos vias**: la forma del `by` y el numero medido, porque el doble de Prisma **respeta el `by`** en vez de regalar el grano |

### `criterio-intento-entrega.test.ts` (7 casos -> 12)

- «R1: es lista de INCLUSION — todas las demas FAMILIAS quedan fuera» ->
  «R1: es una lista de INCLUSION — TODOS los demas RESULTADOS del enum quedan
  fuera». **Mismo proposito, mismo dinero protegido**, objeto nuevo.
- «R2: `reprogramacion_tienda` NO esta en la lista (seria doble conteo)» ->
  R12 reexpresado como no-regresion del mapa: la CONCLUSION sobrevive, el
  razonamiento del doble conteo desaparece (R26).
- Los casos de `TRANSICIONES` (#13/#22, salidas de `incidente`, `indemnizada`)
  **conservan lo que miden** — que el mapa no cambio (R14) — y pierden solo la
  derivacion «cuenta como intento», que ya no es cierta.
- **Nuevos**: R33 (`sin_gestionar` no puede estar) y R13/R25 (el export retirado
  ya no existe). Este ultimo mata dejar un derivador legado por compatibilidad.

### `orden-historial-service.test.ts`

- La asercion `toHaveBeenCalledWith("o1", CRITERIO)` pasa a `("o1")` en los 4 sitios.
- «R12: resuelve el catalogo UNA vez», «criterio con `reprogramadaId: null`» y
  «individual y lote reciben el MISMO criterio» -> **sustituidos por R9
  reexpresado**: «el conteo NO consulta el catalogo ni una vez» y «con el catalogo
  VACIO el numero es el mismo». **Mata reintroducir una traduccion de catalogo que
  devuelva `null` y degrade el conteo a 0 en silencio.**
- Sobreviven sin cambio de afirmacion: lote vacio (R7), 0 explicito (R8), y «no
  expone `contarPorDestino` ni `contarPorDestinoVigentes`».
- «67/R28: 2 devueltas, 1 anulada -> 1» -> «R5/R32: la gestion anulada NO cuenta
  (no descuenta)», mas un caso nuevo de monotonia sobre dos lecturas del drawer.

### `intentos-entrega-criterio-unico.test.ts` — ADAPTADO, proposito INTACTO

Sigue montando `OrdenHistorialRepository` REAL, `OrdenHistorialService` REAL y
`DevolucionSlaService` REAL sobre el doble de Prisma; solo cambia el andamiaje
(filas de `gestion_orden` en vez de filas de historial). **Mata cualquier segunda
definicion de intento entre drawer, cron y lote (R6).** Anadidos el caso R29 y
el caso Q5.

### `devolucion-sla-service.test.ts` (DINERO) — bloque `:170-232`

Se reescribio **sobre el repositorio REAL mas `prismaGestionSobreFilas`**, no sobre
`fakeHistorial(n)`: con el conteo mockeado ningun caso probaba el criterio, solo
la aritmetica del umbral.

| Viejo | Nuevo | Mutacion que sigue matando |
| --- | --- | --- |
| «160/R8: 2 reprogramaciones + 1 devuelta -> ESCALA» | «R15/R3: 3 cierres APROBADOS con resultado contable -> ESCALA» | Que el umbral deje de dispararse: el rechazo no se cobra nunca |
| «160/R5/R8: las mismas ANULADAS -> el conteo BAJA a 1 y LIBERA» | «R5: gestiones anuladas antes de que su cierre se apruebe -> no llegan a contar» | Contar gestiones anuladas: escalar antes de tiempo. **Ya no afirma que el numero baje** (R32) |
| «160/R2/R8: la reprogramacion de la TIENDA no cuenta» | «R29/R4: 2 gestiones vigentes en el MISMO cierre aprobado -> 1 -> LIBERA, y releer da lo mismo» | Contar por gestion en vez de por cierre: el umbral se alcanza al doble de velocidad, cobro antes de tiempo |
| — | **NUEVOS**: R3 parametrizado (`solicitado`/`vencido`/`rechazado`), R10, R11 | Anclar el conteo en `cierre_id IS NOT NULL` o en `vencido` en vez de en `aprobado` (rompe D8, y con `vencido` rompe ademas R32) |
| «160/R9: `wrong_*` escalan directo sin consultar el conteo» y «una consulta por orden con SU id» | **Conservados sin cambio de afirmacion** (renumerados a R16) | Que el criterio nuevo contamine la rama de rechazo directo |

Los bloques `:83-131`, `:234-248`, `:249-268` y `:269-330` **no se tocaron y
quedaron verdes** (R16).

### `metrics.test.ts`

Solo el literal del id (3 ocurrencias). **Lo que el test afirma no cambio**: que
`primer_intento_ok` REMITE al punto unico, que no declara umbral propio ni columna
materializada, y que ninguna otra metrica inventa un criterio distinto (R23).

---

## 7. Notas para el reviewer y para el merge

1. **Deuda NOMBRADA, no olvido** (`design.md` §3.1, opcion (a), elegida a
   proposito): `whereIntentosVigentes` y los dos `contarIntentosVigentes` siguen
   viviendo en `OrdenHistorialRepository` aunque el dato ya salga de
   `gestion_orden`. El nombre historial miente un poco. Mover los 11 call-sites a
   un `IntentosEntregaService` en el MISMO PR mezclaria el cambio de significado con
   un refactor de superficie y dejaria al reviewer sin diff legible. Esta escrito
   como tal en el codigo.
2. **Se salio levemente del alcance literal en 4 archivos, y se declara**:
   `lib/types/orden.ts`, `lib/types/novedad.ts`,
   `lib/interfaces/services/IMisAsignacionesService.ts` y
   `lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts` tenian JSDoc
   que afirmaba **textualmente** el criterio viejo. R28 lo prohibe. Son **solo
   comentarios**: cero cambio de tipos, firmas o comportamiento.
   **Aviso de merge:** `IMisAsignacionesService.ts` es un archivo que la feature 208
   toca en el checkout principal. El roce seria un conflicto de COMENTARIO, trivial
   pero real. El archivo vetado (`lib/services/MisAsignacionesService.ts`) NO se
   toco.
3. **Al mergear la 208**, comprobar lo que `design.md` §9 exige: que no introduce
   un cuarto estado de `cierre_dia` ni un segundo camino de vinculacion de
   `gestion_orden.cierre_id`. La 215 no escribe esos archivos, pero **depende de su
   semantica**.
4. **R32 es un cambio de comportamiento OBSERVABLE**: hoy deshacer una gestion
   BAJA el numero (160/R5); tras esta feature una gestion solo cuenta cuando ya no
   es anulable. Si aparece un camino que lo haga bajar —anulacion administrativa
   fuera de ventana, borrado fisico de `gestion_orden`, o un cierre que salga de
   `aprobado`— **R32 se rompe y hay que volver a la puerta**, no parchear el test.

---

## 8. Grupo 4 (T19–T22) — el discriminador de las gestiones SINTETICAS

**Fecha:** 2026-08-13. **Cierra:** R18 (Q3/D13), R34 y el incumplimiento de **R12**
que 7d9471c3 dejo abierto. Diseño: `design.md §3.4`. **Sin migracion** (R27).

### 8.1 Que cambia

El predicado unico gana una **SEXTA condicion**: la gestion tiene que nacer de una
**VISITA REAL**, no ser sintetica.

    AND EXISTS fila de `orden_historial_estado` de esa gestion
        con `origen_tipo IN ORIGEN_TIPOS_VISITA_REAL`   (hoy: ["gestion"])

El discriminador es **ESTRUCTURAL, no heuristico** (nada de `motivo LIKE 'escalado
SLA%'`): toda gestion se crea en la MISMA transaccion que su fila de historial
(verificado en `GestionOrdenRepository.ts:443-455`, append incondicional), y esa
fila lleva el `origen_tipo` de la familia que la produjo. Las dos sinteticas del
sistema —`escalado_devuelta_sla` (cron SLA) y `reprogramacion_tienda` (tramite de
escritorio de la tienda)— quedan fuera.

**Lista de INCLUSION, jamas de exclusion (R34-c):** con lista negra una familia
sintetica FUTURA empezaria a contar sola, adelantaria el escalado y cobraria un
`cobroRechazado` (56, dinero real) antes de tiempo, en silencio.

**R34-d, ausencia de dato:** una gestion legada sin fila de historial NO cuenta. Es
la direccion segura del error: contar de menos retrasa el escalado (inofensivo);
contar de mas cobra un rechazo antes de tiempo.

**R18-d — deja de contar como INTENTO, sigue cobrando como RECHAZO.** Son dos
caminos independientes: el ingreso de bodega se deriva de `resultado` en
`ingresoBodegaPorResultado` / `derivarIngresoBodega` (`lib/utils/ingreso-bodega.ts:18`,
`lib/utils/cierre-totales.ts:44`), que **no** consultan el conteo. `R18-c`: la
condicion de escalado del cron NO cambia — sigue comparando el conteo contra el
umbral antes de escalar.

### 8.2 Archivos modificados (8; **0 en `db/`**)

| Archivo | Que cambia |
| --- | --- |
| `lib/types/orden-historial.ts` | **Nueva** `ORIGEN_TIPOS_VISITA_REAL` (`["gestion"]`, `satisfies readonly OrdenHistorialOrigenTipo[]`) con la prosa del porque |
| `lib/repositories/OrdenHistorialRepository.ts` | Sexta condicion en `whereIntentosVigentes`; **nuevo** `export type FiltroOrdenIntentos = string \| { in: string[] }` (interseccion exacta de lo que aceptan `GestionOrdenWhereInput["ordenId"]` y `OrdenHistorialEstadoWhereInput["ordenId"]`, porque el MISMO valor viaja a los dos modelos — sin `any` ni doble aserto); JSDoc con el bloque de rendimiento |
| `tests/fixtures/intentos-entrega.ts` | El evaluador semantico UNICO aprende filas de historial: `FilaGestionFake` gana un campo **REQUERIDO** con las familias que enlazan la gestion (`[]` = legada sin historial). Requerido a proposito: el typecheck obliga a que cada fila declare su origen y ninguna suite queda verde por defecto silencioso. `fakeIntentosEnLote` **intacto** |
| `tests/unit/repositories/orden-historial-repository.test.ts`, `tests/unit/types/criterio-intento-entrega.test.ts`, `tests/unit/services/intentos-entrega-criterio-unico.test.ts`, `tests/unit/services/devolucion-sla-service.test.ts` | Casos nuevos del discriminador + declaracion explicita de la familia en cada fila existente |
| `specs/215-reintento-en-cierre/design.md` | §3.4: evidencia fechada de T22 |

**NO se toco** ninguno de los 5 archivos que la 208 tiene en vuelo
(`CierreDiaService`, `CierreDiaRepository`, `CierresAdminRepository`,
`GestionOrdenRepository`, `MisAsignacionesService`), ni `db/`, ni `components/`,
ni `app/`, ni `intentos-no-alcance.test.ts`, ni `devolucion-sla-dinero.test.ts`.

### 8.3 El `ordenId` repetido dentro del `some` no es decorativo

`orden_historial_estado` **no tiene indice por `gestion_orden_id`** (los tres que
existen son `[ordenId, createdAt]`, `[ordenId, estatusDestinoId]` y
`[actorUsuarioId, origenTipo, createdAt]`, `db/schema.prisma:1546-1557`; la FK no
crea indice en Postgres). Repitiendo el filtro por `orden_id` dentro del `EXISTS`,
el planner entra por indice y `gestion_orden_id` queda como filtro residual. Medido
(§8.5): **sin** repetirlo, `Seq Scan`.

### 8.4 Verificacion — salida real (2026-08-13, worktree `C:/w213`)

    $ pnpm exec tsc --noEmit -p tsconfig.json
    (salida vacia)  exit=0

    $ git diff --name-only -- db/
    (vacio)                                <- R27, guardia de la feature

    $ pnpm exec vitest run  <orden-historial-repository, criterio-intento-entrega,
                             intentos-entrega-criterio-unico, orden-historial-service,
                             devolucion-sla-service, devolucion-sla-dinero>
     Test Files  6 passed (6)
          Tests  128 passed (128)

    $ pnpm exec vitest run  <11 consumidores + analytics + UI + intentos-no-alcance>
     Test Files  146 passed (146)
          Tests  1690 passed (1690)

    $ pnpm exec vitest run tests/integration/db/analytics-daily-job.test.ts \
                           tests/integration/db/analitica-operativa-equivalencia.test.ts
     Test Files  1 failed | 1 passed (2)
          Tests  1 failed | 30 passed (31)   <- EL MISMO rojo de §5 (R24/Q10), sin tocar

    $ pnpm exec eslint <los 7 archivos tocados>
    (sin salida)  exit=0

**El unico rojo sigue siendo el de R24/Q10**, mismo archivo y mismo caso
(«primer intento vs entrega tras una devolucion previa», `expected [1,1] to deeply
equal [1,0]`). Delta de rojos del Grupo 4: **0**.

**Verificacion de mutacion, hecha en caliente:** eliminando la condicion
`historialEstados` del predicado, las suites del criterio pasan a
`34 failed | 62 passed`; restaurada, `128 passed`. La sexta condicion esta
realmente cubierta por tests, no por prosa.

### 8.5 T22 — la medicion, y lo que NO demuestra

**No hubo que parar: el plan NO pidio indice nuevo sobre `gestion_orden_id`**, y
`db/` sigue intacto.

⚠️ **Medido contra la base LOCAL de desarrollo, minuscula** (78 ordenes, 44
`gestion_orden`, 278 `orden_historial_estado`, 7 `cierre_dia`). **No es produccion y
los planes NO son extrapolables.** Lo que si demuestra limpio:

- Con el `orden_id` repetido dentro del `some`: `Index Scan using
  orden_historial_estado_orden_id_estatus_destino_id_idx` (`Index Cond: orden_id =
  …`, `origen_tipo` residual). **Sin** repetirlo: `Seq Scan on
  orden_historial_estado`. El truco de `design.md §3.4` se confirma.
- Individual: 0.195 ms / 6 buffers -> 0.150 ms / 3 buffers.
- Lote de 100: 0.486 ms / 24 buffers -> 2.800 ms / 164 buffers, con `Seq Scan`
  repetido 23 veces sobre 278 filas ⇒ **NO CONCLUYENTE** a este volumen.
- Filas legadas de R34-d (`gestiones_sin_historial`): **0** en local. **No es el
  numero de produccion.**

**Queda pendiente medir con volumen real**, por la misma puerta que Q4. Detalle
fechado en `design.md §3.4`.

### 8.6 Tests reexpresados en el Grupo 4

| Viejo | Nuevo | Mutacion que sigue matando |
| --- | --- | --- |
| `criterio-intento-entrega.test.ts` · «**R12**/R14: ninguna arista del mapa decide por si sola un intento de entrega» | «**R14**: …» (mismo cuerpo, **ni una linea cambiada**; el `describe` pasa de `215/R12/R14` a `215/R14`) | Las MISMAS: devolver al mapa una arista con marca `cuentaComoIntento`, o reintroducir un `via` que coincida con un `GestionResultado`. Lo unico que se retira es la etiqueta R12, que apuntaba al MAPA y no al PREDICADO — un requisito cuyo test mide otra cosa es un requisito sin dueño. R12 tiene ahora 4 casos reales (§2) |
| «R4: el `where` del LOTE es IDENTICO al del individual salvo `ordenId`» | Igual, normalizando tambien el `ordenId` anidado en el `some`, **mas 2 aserciones nuevas** (que el `ordenId` de dentro es el mismo que el de fuera, en individual y en lote) | Un segundo `where` copia-pegado; **y ademas**, ahora, quitar el `ordenId` redundante del `some` (la mutacion de rendimiento que degrada a seq scan) |

Ningun test se borro ni se relajo.

---

## 9. Grupo 5 (T13, T23, T24) — la DERIVA DECLARADA de `primer_intento_ok` (D15)

Tanda del 2026-08-13 (segunda). Desbloqueada por **D15** («declara la deriva con
fecha de corte», Q10 cerrada). Cierra **R24** (a/b/c/d/e) y **R35**, y con T13 cae
**el ultimo rojo declarado** de la feature.

**Diff de la tanda: 5 archivos. 0 en `db/`, 0 en `app/`, 0 en `components/`.**

| Archivo | Tarea | Que cambia |
| --- | --- | --- |
| `tests/integration/db/_semilla-rollup.ts` | T13 | Helper nuevo `crearCierreAprobado` + `crearGestion` acepta `cierreId` opcional |
| `tests/integration/db/analytics-daily-job.test.ts` | T13 | Solo el caso de R17: la `devuelta` se vincula a un cierre aprobado. **Aserciones intactas** |
| `lib/analytics/metrics.ts` | T23 | Solo prosa: bloque de declaracion + `descripcion` de `primer_intento_ok` |
| `lib/services/AnaliticaRollupService.ts` | T23 | Solo prosa: docblock de `contarPrimerIntento` |
| `lib/services/AnaliticaOperativaService.ts` | T23 | Solo prosa: docblock de `completarPrimerIntentoEnCubos` |

### 9.1 T13 — el ultimo rojo, cerrado por la SEMILLA (no por la asercion)

`tests/integration/db/analytics-daily-job.test.ts` · «primer intento vs entrega
tras una devolucion previa (R17)».

**Causa:** la semilla creaba la `gestion_orden` con resultado `devuelta` **sin
`cierre_id`** (`crearGestion` ni siquiera aceptaba uno, y el archivo no creaba
ningun `cierre_dia`). Con el criterio nuevo esa devolucion no contaba, la entrega
de hoy parecia primer intento y `primerIntentoOk` salia `1` donde el test espera `0`.

**Arreglo, todo en la semilla:**

- **Helper nuevo, exportado, en `_semilla-rollup.ts`** (no copiado en el test):
  `crearCierreAprobado(tx, { mensajeroId, zonaId, at })` que devuelve el id. Crea un
  `cierre_dia` con `estado: "aprobado"`, `destinoTipo: "bodega_central"`,
  `destinoZonaId`, y `solicitadoAt`/`resueltoAt`/`createdAt` en el pasado aislado de
  2001. Sin totales: los defaults son 0 y el rollup no los lee.
- **`SemillaGestion` gana `readonly cierreId?: string | null`** y `crearGestion` lo
  escribe (`g.cierreId ?? null`). Opcional y con default `null`, **exactamente como
  `anuladaAt`**: los ~15 call-sites existentes no se tocan (typecheck verde lo
  confirma).
- En el caso, la `devuelta` de la orden `reintentada` se vincula a ese cierre.
- **La sexta condicion del predicado (visita real, R34) se VERIFICO, no se asumio:**
  la fila de `orden_historial_estado` con `origenTipo: "gestion"` y
  `gestionOrdenId` ya estaba en la semilla. Como `whereIntentosVigentes` es un AND
  de las seis, si el `EXISTS` fallara la devolucion no contaria y `primerIntentoOk`
  seguiria en 1: el verde lo prueba.
- **Prosa corregida (R28):** el comentario de la semilla decia «transicion a
  `devuelta` de una gestion no anulada» — criterio VIEJO. Ahora dice gestion
  `devuelta` vigente, de visita real y **en un cierre APROBADO**.

**Las dos aserciones que NO se tocaron** (son la unica prueba de que el KPI
distingue reintento de primer intento; relajarlas habria sido borrar lo que el test
existe para medir):

    expect([trasDevolucion?.entregas, trasDevolucion?.primerIntentoOk]).toEqual([1, 0]);
    expect([alPrimerIntento?.entregas, alPrimerIntento?.primerIntentoOk]).toEqual([1, 1]);

El CHECK de base `primer_intento_ok <= entregas` se respeta (0 <= 1 y 1 <= 1).

**Que el test corre CON DATOS, y no pasa "por vacio"** — deuda conocida del repo,
asi que se exigio evidencia POSITIVA, no el `passed`:

1. **El early-return del archivo es un `skip`, no un `return`:**
   `const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip` (`:45`),
   con `HAY_BASE_DE_DATOS = urlDeBaseDeDatos() !== undefined`
   (`_postgres-real.ts:32`). Sin base, vitest reportaria **skipped**, no **passed**.
   Reporta `29 passed`, `0 skipped`.
2. **Canario temporal:** se inserto una asercion imposible dentro del cuerpo del
   caso, despues de los dos `toBeDefined` y ANTES de las aserciones del KPI. La
   corrida fallo **en esa linea** con `1 failed | 28 passed`. Es decir: el cuerpo
   **llega hasta ahi** con `trasDevolucion` y `alPrimerIntento` ya definidos, o sea
   que las dos filas del rollup existen de verdad. Canario retirado y re-corrido en
   verde.
3. Refuerzo: el `expect(filas).toHaveLength(2)` del propio caso es incompatible con
   "pasar por vacio".

### 9.2 T23 — la declaracion de la deriva, en los TRES sitios de `design.md` §8.3

Solo prosa. Cero cambios de logica, firma, tipo o calculo.

| Sitio | Ruta | Lineas |
| --- | --- | --- |
| La DEFINICION de la metrica | `lib/analytics/metrics.ts` | bloque `:331-374` + `descripcion` `:378-379` (metrica `:375-396`) |
| Quien PERSISTE las filas con el escalon | `lib/services/AnaliticaRollupService.ts` | docblock de `contarPrimerIntento`, `:223-262` |
| La version VIVA del mismo KPI | `lib/services/AnaliticaOperativaService.ts` | docblock de `completarPrimerIntentoEnCubos`, `:886-935` |

Los tres son **autosuficientes** —quien lee solo uno se entera de las tres cosas,
que es el punto de R24-b— y los tres dicen:

1. **El cambio de criterio, SIN re-backfill (R24-a).** `primer_intento_ok` cambio de
   criterio con la 215 (el «intento previo» ya no sale de destinos de transicion,
   sale de gestiones dentro de un cierre APROBADO) y el historico **no se
   re-backfillea**: el escalon se ASUME. Con los dos motivos escritos: reescribiria
   meses de KPI ya reportados, y **seria falso** —aquellos cierres no estaban
   aprobados *en el momento de aquel calculo*.
2. **La regla del corte, por `updated_at` y NO por `fecha` (R24-c, R35).** Textual:
   *toda fila con `updated_at` anterior al despliegue de la 215 esta calculada con
   el criterio viejo; toda fila con `updated_at` posterior, con el nuevo, **sea cual
   sea su `fecha`***. Y la frase que R24-c exige con esas palabras: **una fila de una
   fecha anterior al corte que se RECALCULA despues del corte pasa al criterio
   NUEVO**. Con el motivo: el job recalcula dias pasados (backfill) y el upsert
   refresca `updated_at` en cada recalculo (`AnaliticaRollupRepository.ts:434,453`),
   asi que el corte es por **cuando se calculo**, no por **que dia mide**. Y con la
   razon de que no haya constante ni columna: `updated_at` **ya existe**, luego sin
   columna, tabla ni migracion (R27), y sin ninguna `FECHA_CORTE_*` que adivinar o
   mantener (mecanismos M-B/M-C descartados en `design.md` §8.2).
3. **El efecto INTRADIA, propiedad NUEVA y PERMANENTE (R24-d).** Una entrega cuya
   orden tiene cierres **sin aprobar** reporta 0 intentos previos y cuenta como
   primer intento, asi que el KPI **sube durante el dia y baja al aprobarse los
   cierres**. Escrito explicitamente que **no es un artefacto de la migracion de
   criterio y no desaparece con la deriva declarada**. Corolario incluido: el mismo
   dia puede dar dos valores distintos segun cuando se recalcule.

Los tres cierran recordando el invariante que NO cambia (R23/R24-e): el KPI sigue
REMITIENDO al punto unico (`OrdenHistorialService.contarIntentos*`), sin `COUNT`
propio, sin umbral propio, sin columna materializada, y `primer_intento_ok <=
entregas` se mantiene.

**Guardias que CONDICIONARON la redaccion (ninguna roja, ninguna relajada):**

- `analytics-daily-guards.test.ts:641-652` exige que todo literal `analytics_daily`
  en `metrics.ts` fuera de comentarios este dentro de `tablas: [...]`. Como
  `descripcion` es codigo y no comentario, ahi la tabla se nombra «el rollup
  diario»; el nombre real solo aparece en el comentario adyacente. **Queda escrito
  en el propio comentario para que nadie lo "arregle".**
- `metrics.test.ts:419` exige que toda `descripcion` cite las gestiones anuladas:
  conservado.
- `catalogo-universo.guardia.test.ts` (R7) prohibe el patron «numero + …
  estados/estatus/values» en cualquier `descripcion`: se redacto evitando poner
  «215» a menos de dos palabras de esos sustantivos.
- `etiquetas-visibles.guardia.test.ts` fija que las `descripcion` van sin tildes:
  respetado.
- **No hay guardia de longitud maxima de `descripcion`**, asi que la declaracion
  cabe en el propio dato y no hubo que degradarla a solo-comentario.

**Lo que NO se toco, y es medido, no un olvido.** El aviso **no llega a la PANTALLA**
de analitica: el texto visible sale de
`app/(app)/analitica/_components/operativo/catalogo-paneles.ts` y `textos.ts`, y los
`descripcion:` del catalogo «no llegan a pantalla»
(`etiquetas-visibles.guardia.test.ts:32-34`). Escribirlo ahi tocaria `app/`, contra
R20 y contra la guardia de la feature; un `COMMENT ON COLUMN` seria migracion,
contra R27. **Llevar el aviso a la pantalla es ficha aparte**, declarada en
`requirements.md` §Tension declarada de la cuarta ronda.

### 9.3 T24 — LA ANOTACION DEL DESPLIEGUE (accion humana, PENDIENTE)

> ## ⬜ INSTANTE REAL DEL DESPLIEGUE DE LA 215 — **SIN ANOTAR**
>
> **Fecha y hora, con zona horaria:** `__________________________`
> *(rellenar UNA SOLA VEZ, DESPUES del despliegue, por quien lo ejecute)*
>
> **Commit desplegado:** `__________________________`

**Hoy esa fecha NO SE CONOCE, y no se inventa.** El criterio nuevo empieza a regir
cuando este codigo se **despliega**, no cuando se decide ni cuando se mergea el PR.
Cualquier valor escrito aqui antes del hecho seria una fecha falsa, que es **peor
que no tener ninguna** — es exactamente por lo que `design.md` §8.2 descarto la
constante en codigo (M-B) y la variable de entorno (M-C) y eligio derivar el corte
del dato (M-A).

**Que se pierde si esta anotacion no llega a hacerse: solo la etiqueta comoda.**
La serie **sigue siendo interpretable fila a fila** por `analytics_daily.updated_at`
(R35): la regla del corte esta escrita en los tres sitios de §9.2 y no necesita esta
casilla para aplicarse. Comparando el `updated_at` de una fila con la fecha del
despliegue —que siempre se puede recuperar del historial de despliegues aunque nadie
la anote aqui— se sabe con que criterio se calculo. Esta casilla solo ahorra ese
paso.

**Por eso T24 NO bloquea el PR**, no toca codigo y no exige re-desplegar.

### 9.4 Verificacion — salida real (2026-08-13, worktree `C:/w213`)

| # | Comando | Resultado |
| --- | --- | --- |
| 1 | `vitest run tests/integration/db/analytics-daily-job.test.ts` | **29 tests, 29 verdes** (antes: 1 failed / 28 passed). 0 skipped |
| 2 | `vitest run` job + `analitica-operativa-equivalencia` | **2 files, 31 tests, 31 passed** |
| 3 | `vitest run tests/integration/db/analytics-daily-` (los 4: job, backfill, guards, migration) | **4 files, 123 tests, 123 passed** |
| 4 | `vitest run tests/unit/analytics/` + `criterio-intento-entrega` + `orden-historial-repository` + `intentos-entrega-criterio-unico` + `devolucion-sla-dinero` | **136 files, 1482 tests, 1482 passed** |
| 5 | `pnpm exec tsc --noEmit -p tsconfig.json` | **exit 0**, sin salida |
| 6 | `pnpm exec eslint` sobre los 5 archivos tocados | **exit 0**, sin salida |
| 7 | `git diff --name-only -- db/` | **VACIO** (R27) |
| 8 | `git diff --name-only -- app/ components/` | **VACIO** (R20) |

`devolucion-sla-dinero.test.ts` entra en el punto 4 **sin haberse tocado**: sigue
verde, o sea que el ingreso de bodega por rechazo no cambio (R17).

**Ningun rojo. Ninguna guardia ajena en rojo. Ninguna guardia relajada.**

### 9.5 Trazabilidad de la tanda

| Req | Test / evidencia |
| --- | --- |
| R23 | `analytics-daily-job.test.ts` · «primer intento vs entrega tras una devolucion previa (R17)» verde **con las aserciones intactas** · `metrics.test.ts` (el KPI sigue remitiendo al punto unico) · CHECK `primer_intento_ok <= entregas` en base |
| R24-a | §9.2 punto 1 escrito en los tres sitios; **cero filas de `analytics_daily` reescritas** (el diff no incluye ningun script de backfill) |
| R24-b | Los tres sitios de `design.md` §8.3, con rango de lineas en §9.2 |
| R24-c | §9.2 punto 2: la regla por `updated_at` y la frase de la fila recalculada, con esas palabras, en los tres sitios |
| R24-d | §9.2 punto 3: el efecto intradia como propiedad nueva y permanente, en los tres sitios |
| R24-e | `analytics-daily-job.test.ts` verde sin tocar aserciones + `metrics.test.ts` verde: sin `COUNT` propio, sin umbral propio, sin columna materializada |
| R35 | La regla se apoya en `analytics_daily.updated_at`, columna **preexistente**; `git diff -- db/` VACIO (sin columna, tabla ni migracion) · **T24** = §9.3, la casilla del despliegue, sin anotar y declarada como tal |
| R28 | El comentario de la semilla que afirmaba el criterio viejo, reescrito (§9.1) |
