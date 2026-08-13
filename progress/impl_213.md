# Feature 213 — bitacora de implementacion

**Rama:** `feature/213-reintento-en-cierre` (worktree `C:/w213`, desde `origin/dev`).
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
| `lib/types/gestion-orden.ts` | **Nueva** `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` (+ `ResultadoIntentoEntrega`), lista de INCLUSION con `satisfies readonly GestionResultado[]` |
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
| R12 | `criterio-intento-entrega.test.ts` · «R12/R14: ninguna arista del mapa decide por si sola un intento de entrega» |
| R13 | `criterio-intento-entrega.test.ts` · «R13/R25: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` ya NO existe como export» + guardia de fuente: grep sin resultados en `lib/`, `app/`, `components/` + typecheck verde |
| R14 | `criterio-intento-entrega.test.ts` · «R14: siguen existiendo EXACTAMENTE 2 aristas con destino `reprogramada` (#13 y #22)», «R14: `devuelta` sigue teniendo al menos una arista ...», «R14/158-Q-D: las salidas de `incidente` siguen siendo las 6 declaradas», «R14/D3: no existe ningun estado `indemnizada`» |
| R15 | `devolucion-sla-service.test.ts` · «R15/R3: 3 cierres APROBADOS con resultado contable, umbral 3 -> ESCALA» · `intentos-entrega-criterio-unico.test.ts` · «R15: 1 devuelta + 2 reprogramadas en 3 cierres APROBADOS -> drawer 3 y el cron ESCALA» |
| R16 | `devolucion-sla-service.test.ts` · bloques de ventana 24h, `wrong_*`, atribucion (R22), reloj inyectable y resiliencia/idempotencia — **verdes SIN cambio de asercion** + «R16: `wrong_number`/`wrong_address` siguen escalando DIRECTO, sin consultar el conteo», «R16: el conteo se consulta UNA vez por orden y con SU id» |
| R17 | `tests/unit/services/devolucion-sla-dinero.test.ts` — **verde sin tocarse** (4 casos de dinero) |
| R18 | **SIN DUEÑO — bloqueado por Q3.** No implementado |
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

**Cobertura: 30 de 33 requisitos con test real. Tres sin dueño y sin implementar:
R18 (Q3), R19 (Q4), R24 (Q10).**

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
| **R18** | **Q3** — si la gestion sintetica `rechazada` que crea el escalado SLA suma un intento a la orden que lo causo | No implementado, no preparado tras flag, no adivinado |
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

## 5. El unico rojo, y esta en la tabla de `design.md` §6 (fila #10)

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
   `gestion_orden.cierre_id`. La 213 no escribe esos archivos, pero **depende de su
   semantica**.
4. **R32 es un cambio de comportamiento OBSERVABLE**: hoy deshacer una gestion
   BAJA el numero (160/R5); tras esta feature una gestion solo cuenta cuando ya no
   es anulable. Si aparece un camino que lo haga bajar —anulacion administrativa
   fuera de ventana, borrado fisico de `gestion_orden`, o un cierre que salga de
   `aprobado`— **R32 se rompe y hay que volver a la puerta**, no parchear el test.
