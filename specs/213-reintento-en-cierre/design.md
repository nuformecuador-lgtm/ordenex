# Feature 213 — Diseño técnico

Cómo se mueve el punto de conteo del reintento desde la transición hasta el cierre.
Todo anclaje de este documento se verificó abriendo el archivo en `C:/w213`
(rama `feature/213-reintento-en-cierre`, creada desde `origin/dev` ca73e771).

> **Este documento NO resuelve las preguntas abiertas de `requirements.md`.** Donde
> hay decisión pendiente, se enumeran las opciones MEDIDAS con su coste y se marca
> `⛔ Qn`. La sección §5 (alternativas descartadas) es la única donde este spec
> cierra algo, y lo cierra por medición.

---

## 1. Dónde vive el conteo HOY (una sola foto)

```
DevolucionSlaService:117 ─┐                    (dinero: escalado -> cobroRechazado)
OrdenHistorialService:59  ─┤
OrdenService:303,:355     ─┤
MisAsignacionesService:168─┤
RecepcionSatelite:136,209,281─┤
NovedadesService:66       ─┼─> OrdenHistorialService.contarIntentos{,EnLote}
RechazosSlaTienda:56      ─┤        (:64 / :77, resolverCriterio :95)
ManifiestoService:183     ─┤                 │
liberacion-reprogramada:93─┤                 ▼
AnaliticaRollupService:238 ─┤   OrdenHistorialRepository.contarIntentosVigentes{,EnLote}
AnaliticaOperativaService:462─┘        (:188 / :203)
                                             │
                                             ▼
                              whereIntentosVigentes  (:105)   ← EL PUNTO ÚNICO
                                             │
                                             ▼
                              orden_historial_estado + gestion_orden.anulada_at
```

Propiedades del diseño vigente que **hay que preservar** (son requisitos, no
gustos): un solo predicado para los 11 consumidores (R6), lote en una consulta
(R7), degradación segura sin catálogo (R9), y `0` explícito en vez de ausencia (R8).

---

## 2. Modelo de datos

### 2.1 Nada nuevo (propuesta base, `160/R7` intacto)

No se propone tabla, columna, enum, índice ni migración. Todo lo que el criterio
nuevo necesita ya está persistido:

| Dato | Dónde | Línea |
| --- | --- | --- |
| Resultado de la gestión | `gestion_orden.resultado` (enum `GestionResultado`: `entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`) | `db/schema.prisma:727`, enum `:654-662` |
| Pertenencia a un cierre | `gestion_orden.cierre_id` (NULL = no cerrada) | `db/schema.prisma:752` |
| Vigencia | `gestion_orden.anulada_at` (NULL = vigente) | `db/schema.prisma:776` |
| Estado del cierre | `cierre_dia.estado` (`solicitado`/`aprobado`/`rechazado`/`vencido`) | `db/schema.prisma:928`, enum `:900-907` |
| Índices de la ruta caliente | `@@index([ordenId])`, `@@index([cierreId])` sobre `gestion_orden`; `@@index([estado])` sobre `cierre_dia` | `:791`, `:793`, `:956` |

RLS: `gestion_orden` y `cierre_dia` ya tienen RLS habilitada sin policies (solo
service role, `:720-722` y `:923-924`). **No hay tabla nueva ⇒ no hay RLS nueva
que declarar.**

### 2.2 Lo que el detalle del cierre NO sirve (respuesta medida a ⛔ Q1)

`cierre_detail` (`db/schema.prisma:1583-1636`) congela las entradas de la fórmula
del dinero y los descriptivos de la orden. **No tiene columna `resultado`**, y su
grano `(cierre_id, orden_id)` deduplica gestiones (`:1633`; dedupe explícito en
`CierreDiaRepository.ts:540-545`). Derivar el conteo de ahí es imposible sin
añadirle una columna, lo que exigiría migración **y** backfill de cierres pasados.
Por eso la fuente propuesta es `gestion_orden`, no `cierre_detail`.

### 2.3 Si el humano exige materializar (⛔ Q1, rama B)

Coste, escrito antes de escribirlo: migración `up`/`down` sobre `orden`
(p. ej. `intentos_entrega INTEGER NOT NULL DEFAULT 0`), backfill de todas las
órdenes vivas, un incremento transaccional en DOS repositorios distintos
(`CierreDiaRepository.crearCierre` y/o `CierresAdminRepository.resolverCierre`),
idempotencia explícita (hoy la da el propio predicado por construcción), y un
vector de drift permanente entre la columna y los hechos. **`160/R7` quedaría
DEROGADO** y habría que decirlo en `requirements.md` (R27). No se recomienda; ver
§5, alternativa D.

---

## 3. El predicado nuevo: dónde vive y qué forma tiene

### 3.1 Se mantiene el punto único, cambia su fuente

El punto de extensión no se mueve de sitio: sigue siendo **una función pura de
`where`** consumida por los dos métodos de conteo, para que UI y dinero no puedan
divergir por copia-pega (`OrdenHistorialRepository.ts:82-104` explica por qué está
extraída). Lo que cambia es la tabla y las columnas que mira:

```
// hoy  (orden_historial_estado)
ordenId AND (destino=devuelta OR (destino=reprogramada AND origen IN {gestion}))
        AND (nunca-vino-de-gestion OR gestion.anulada_at IS NULL)

// propuesto  (gestion_orden)
ordenId AND resultado IN {rechazada, devuelta, reprogramada}
        AND anulada_at IS NULL
        AND <ANCLA DEL CIERRE>            ⛔ Q2
```

- `contarIntentosVigentes` pasa de `ordenHistorialEstado.count` a
  `gestionOrden.count`; `contarIntentosVigentesEnLote` pasa de `groupBy` sobre
  historial a `groupBy` sobre `gestion_orden` por `ordenId` (R7 se conserva: sigue
  siendo UNA consulta para N órdenes, sobre `@@index([ordenId])`).
- **El repositorio del historial deja de ser el dueño del conteo.** Dos opciones de
  ubicación, ambas compatibles con R6:
  - **(a)** dejar los métodos en `OrdenHistorialService`/`IOrdenHistorialRepository`
    (11 call-sites intactos, cero churn) aunque el dato salga de `gestion_orden`;
  - **(b)** moverlos a un módulo propio (`IntentosEntregaService`) y reapuntar los
    11 call-sites.
  **Recomendación: (a) en el mismo PR, (b) como follow-up.** Mover 11 call-sites y
  cambiar la semántica del número en la misma tanda mezcla dos diffs y le quita al
  reviewer la posibilidad de ver el cambio de significado aislado. Se declara como
  deuda nombrada, no como olvido: el nombre del método pasa a mentir un poco
  («historial») y eso hay que arreglarlo, pero después.

### 3.2 Las tres anclas candidatas (⛔ Q2) — medidas, no supuestas

| # | Ancla | Predicado | Cubre corte automático | Cubre cierre manual | Riesgo medido |
| --- | --- | --- | --- | --- | --- |
| **i** | `cierre_id IS NOT NULL` | `gestion_orden.cierreId: { not: null }` | Sí (`crearCierre` con `estado='vencido'`) | Sí, pero en la **SOLICITUD** del mensajero, no en la aprobación | Es el instante en que la gestión se vuelve inmutable (la ventana de deshacer muere ahí, `CierreDiaService.ts:519-521`) ⇒ idempotencia y monotonía GRATIS (R4, Q12). Pero cuenta antes de que un admin valide nada. |
| **ii** | `cierre.estado = 'vencido'` | join a `cierre_dia` | Sí | **No** | Un cierre `vencido` que se re-solicita pasa a `solicitado` (`CierreDiaRepository.ts:380-386`) y el conteo **BAJARÍA**. Descartable por sí solo. |
| **iii** | `cierre.estado = 'aprobado'` | join a `cierre_dia` | Solo cuando el `vencido` se aprueba | Sí (`CierresAdminRepository.resolverCierre:632-640`) | Es lo que la ficha interpreta. Pero un cierre `rechazado` o un `vencido` sin resolver deja el conteo en 0 indefinidamente ⇒ el cron SLA libera en bucle y no escala nunca (⛔ Q5). Y el corte automático deja de ser un instante que suma: suma la aprobación posterior (⛔ Q9). |

Combinación **i ∨ iii** («cuenta al vincular, y la aprobación no vuelve a sumar»)
satisface R4 trivialmente porque el predicado es declarativo: no hay dos
incrementos que reconciliar, hay una condición que se cumple o no. **Esa es la
propiedad más valiosa del enfoque derivado y la razón principal para no
materializar** (§5-D).

### 3.3 Idempotencia (R4) sin código de idempotencia

Con conteo derivado no existe «sumar dos veces»: el número es una función de las
filas. Reejecutar el cron, re-aprobar un cierre (`resolverCierre` es idempotente
por diseño, `CierresAdminRepository.ts:606-614`) o forzar un `vencido` a
`solicitado` no puede duplicar nada. La única forma de violar R4 sería el grano
(⛔ Q7): dos gestiones vigentes de la misma orden en el mismo cierre.

---

## 4. Rutas, endpoints y contratos I/O

**Sin rutas nuevas, sin endpoints nuevos, sin acciones nuevas, sin cambio de UI.**
Los 11 consumidores siguen llamando a los mismos dos métodos y recibiendo los
mismos tipos (`number` / `Map<string, number>`).

Contratos que SÍ cambian (internos, no expuestos):

| Contrato | Hoy | Después |
| --- | --- | --- |
| `CriterioIntento` (`lib/interfaces/repositories/IOrdenHistorialRepository.ts:65`) | `{ devueltaId, reprogramadaId }` (ids de `order_status`) | El criterio deja de necesitar ids de catálogo: los resultados son valores del enum `GestionResultado`. El tipo se **retira o se sustituye** por la lista de resultados que cuentan. Con ello desaparece la degradación por catálogo incompleto y R9 pasa a sostenerse por otra vía (enum de Prisma, que no puede faltar). |
| `resolverCriterio` (`OrdenHistorialService.ts:95`) | 2 lecturas de `order_status` por llamada | Ya no hace falta: menos I/O por lectura. Su desaparición hay que reflejarla en los tests que la afirman (§6). |
| `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (`lib/types/orden-historial.ts:147`) | Lista blanca de familias que cuentan con destino `reprogramada` | **Se queda SIN DUEÑO.** Su única función era el criterio. R28 exige retirarla, no dejarla huérfana. `ORIGEN_TIPOS_CON_GESTION` (`:117`) **se queda**: la usa la desambiguación de huérfanas y el resto del historial. |
| Prosa `lib/types/orden-historial.ts:56-116` | 60 líneas que justifican familia por familia por qué no cuenta | Deja de ser cierta en bloque. Se reescribe apuntando al criterio nuevo (R28). |
| Nueva lista | — | Constante de resultados que cuentan (`{rechazada, devuelta, reprogramada}`) declarada con `satisfies readonly GestionResultado[]`, **lista de INCLUSIÓN** por el mismo motivo que la de la 160: con lista negra, un `resultado` futuro empezaría a contar solo, adelantaría el escalado y cobraría un `cobroRechazado` antes de tiempo, en silencio. |

---

## 5. Alternativas descartadas (obligatorio)

**A. Añadir `sin_gestionar` a la lista blanca del predicado viejo.** Era la
solución mínima al agujero que abrió la pregunta original (una orden sale, se
corta, vuelve a bodega y sale otra vez con el mismo contador): bastaba con que #16
`en_reparto → sin_gestionar` contara. **Descartada por decisión explícita del
humano** el 2026-08-13, registrada en el `status_note` de la ficha. Coste de la
alternativa elegida frente a esta: se cambia el significado del número para los 11
consumidores en vez de para uno.

**B. Mantener el criterio por transición y añadir el destino `rechazada`.** Habría
hecho contar `rechazada` (D5-a) sin tocar la arquitectura del conteo: una tercera
rama en `whereIntentosVigentes`. **Descartada porque no cumple la decisión:** el
humano no pidió «que `rechazada` también cuente», pidió que el aumento se delegue
al cierre, y explícitamente que las dos aristas que hoy suman dejen de sumar. Con
B el contador seguiría subiendo en el instante de la gestión.

**C. Contar desde `cierre_detail` añadiéndole una columna `resultado`.**
**Descartada por medición:** su grano deduplica por orden (`db/schema.prisma:1633`,
`CierreDiaRepository.ts:540-545`), es una fila declarada INMUTABLE y money-critical
(`:1564-1565`), y exigiría migración + backfill de todos los cierres pasados para
que el conteo histórico existiera. `gestion_orden` ya tiene el dato exacto, con
vigencia y con índices.

**D. Materializar el contador en `orden.intentos_entrega`.** Es la alternativa que
un lector propondrá por rendimiento. **Descartada** (salvo que el humano decida lo
contrario en ⛔ Q1) por cuatro costes concretos: (1) deroga `160/R7`; (2) exige
migración up/down + backfill; (3) obliga a implementar idempotencia REAL en dos
repositorios distintos, cuando el enfoque derivado la tiene por construcción
(§3.3); (4) introduce un vector de drift permanente en un número que dispara
dinero: una columna que se desincroniza de los hechos cobra mal y nadie se entera
hasta la factura. Beneficio real que se pierde: una consulta menos por listado —y
el listado ya paga hoy una consulta por lote (`160/R12`), no por fila.

**E. Mover los 11 call-sites a un servicio nuevo en el mismo PR.** Descartada como
alcance de esta feature (§3.1): mezcla el cambio de significado con un refactor de
superficie y deja al reviewer sin diff legible. Se declara como deuda nombrada.

---

## 6. Guardias y tests que se pondrán ROJOS **POR DISEÑO**

El reviewer rechaza si al implementar aparece un rojo que no esté en esta tabla, y
también si alguno de estos se «arregla» conservando la afirmación vieja. La
columna «Qué hacer» distingue **REESCRIBIR** (la afirmación cambia de significado)
de **RETIRAR** (la afirmación deja de tener objeto) de **ADAPTAR** (solo cambia el
andamiaje, no lo que mide).

| # | Test / guardia | Qué afirma hoy | Por qué se pone rojo | Qué hacer |
| --- | --- | --- | --- | --- |
| 1 | `tests/unit/types/criterio-intento-entrega.test.ts` (7 casos) | `ORIGEN_TIPOS_REPROGRAMADA_INTENTO === ["gestion"]`, que es lista de inclusión, que hay exactamente 2 aristas a `reprogramada`, y que la pareja (`reprogramada`,`gestion`) identifica la #13 | El criterio deja de depender de familias de origen y la lista se retira (R28) | **REESCRIBIR** sobre la lista de `GestionResultado` que cuenta; conservar el caso «es lista de INCLUSIÓN», que es el que protege el dinero |
| 2 | `tests/unit/repositories/orden-historial-repository.test.ts` bloques `contarIntentosVigentes` (`:191-268`), `…EnLote` (`:270-323`) y `whereIntentosVigentes` (`:325-571`) — 18 casos | La forma exacta del `where` (dos ramas de destino, OR de vigencia) y su semántica fila a fila | El predicado cambia de tabla y de columnas | **REESCRIBIR** caso por caso, manteniendo la cobertura de vigencia (R5) y la de lote/lote-vacío (R7) |
| 3 | `tests/fixtures/intentos-entrega.ts:59-108` (`filaCasaIntento`, `prismaHistorialSobreFilas`) | Es un **intérprete a mano de la forma del `where`**: desestructura `where.AND` como `[{OR: destinos}, {OR: vigencia}]` | Cambio ESTRUCTURAL del predicado ⇒ rompe por desestructuración, no por semántica. Arrastra a los tests #2 y #4 | **REESCRIBIR** el evaluador sobre filas de `gestion_orden`. Sigue siendo UNO solo (`160/R4`): dos evaluadores desincronizados hacen justo el daño que se quiere evitar |
| 4 | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera) | Que cron SLA, drawer y lote producen el MISMO número montando el repo REAL sobre el doble de Prisma | Usa el evaluador de #3 y los ids de catálogo | **ADAPTAR** el andamiaje; **el propósito no cambia y es el test más importante de la feature** (R6) |
| 5 | `tests/unit/services/orden-historial-service.test.ts` bloques `:303-357` y `:359-407` (incl. «resuelve el catálogo UNA vez», «criterio con `reprogramadaId: null`», «individual y lote reciben el MISMO criterio») | Que `resolverCriterio` traduce `value → id` y qué criterio viaja al repo | `resolverCriterio` desaparece (§4) | **REESCRIBIR**; conservar los casos de lote vacío (R7) y `0` (R8) |
| 6 | `tests/unit/services/devolucion-sla-service.test.ts` bloque `:170-233` («el criterio ampliado de intentos y el escalado», casos `160/R8`, `160/R5/R8`, `160/R2/R8`) | Que 2 reprogramaciones del mensajero + 1 devuelta ⇒ escala; que la reprogramación de tienda no cuenta | Esos escenarios se construyen con filas de historial y ahora dependen del cierre | **REESCRIBIR** con escenarios de cierre. **DINERO**: cada caso reescrito es un caso de «cuándo se cobra el rechazo» |
| 7 | `tests/unit/services/orden-historial-service.test.ts:169` (`160/R10`) | Que el drawer refleja el criterio ampliado | Mismo motivo | **REESCRIBIR** |
| 8 | `tests/unit/analytics/metrics.test.ts:198-224` (`R11 · los intentos no se redefinen`) | Que `primer_intento_ok.definicion.criterio === "intentos_vigentes_historial"` y que ninguna métrica inventa otro | El id de criterio sigue siendo un string estable ⇒ **verde por accidente**, pero **la `descripcion` de la métrica (`lib/analytics/metrics.ts:335`) afirma textualmente el criterio viejo** («destino devuelta, o destino reprogramada de familia gestion») | **ACTUALIZAR la prosa** (R28) y considerar renombrar el id de criterio; si se renombra, este test es **REESCRIBIR** |
| 9 | `tests/unit/analytics/rollup-service.test.ts`, `tests/unit/analytics/agregado-*.test.ts`, `tests/unit/analytics/_fake-operativa.ts` | `primer_intento_ok` con el doble de `contarIntentosEnLote` | Solo mockean el conteo ⇒ **probablemente verdes**. Lo que cambia es el SIGNIFICADO del KPI | **REVISAR sin tocar**; el problema real es ⛔ Q10, no el test |
| 10 | `tests/integration/db/analytics-daily-job.test.ts`, `tests/integration/db/analitica-operativa-equivalencia.test.ts`, `tests/integration/db/_semilla-rollup.ts` | Que el rollup persistido y la versión viva coinciden, y el CHECK `primer_intento_ok <= entregas` (`db/migrations/20260731120000_analytics_daily/migration.sql:90`) | Las semillas producen intentos vía historial; con el criterio nuevo una entrega cuyo cierre no se procesó cuenta como «primer intento OK» | **REESCRIBIR las semillas** para que creen cierres, no solo filas de historial. **Riesgo alto de verde falso**: con semilla vacía estos tests retornan temprano |
| 11 | `tests/unit/services/manifiesto-service.test.ts`, `mis-asignaciones-service.test.ts`, `NovedadesService.test.ts`, `orden-service.test.ts`, `recepcion-satelite-{service,paginado,completo,vigencia}.test.ts`, `rechazos-sla-tienda-service.test.ts`, `tests/unit/actions/liberacion-reprogramada-action.test.ts`, `orden-historial-action.test.ts` | R11/R12/R13/R14 de la 160: 1 llamada por listado, `0` explícito, sin consulta con lote vacío | Usan `fakeIntentosEnLote` (`tests/fixtures/intentos-entrega.ts:20`), que **no cambia** | **VERDES, y tienen que seguirlo** (R20). Si alguno se pone rojo, es una regresión real |
| 12 | Suites de UI: `tests/unit/components/intentos-entrega.test.tsx`, `ordenes-columns.test.tsx`, `RecepcionSateliteModule.test.tsx`, `NovedadesModule.test.tsx`, `RechazosSlaModule.test.tsx`, `MisAsignacionesModule.test.tsx`, `BodegaLiberadasHoy.test.tsx`, los 5 modales, descargas | Pintado del dato (`IntentosDato`, columna «Intentos», `0` explícito, umbral no viaja) | Reciben el número por props | **VERDES sin tocar** (R20). Cero archivos de `components/` o `app/` en el diff de esta feature |
| 13 | `tests/unit/types/intentos-no-alcance.test.ts` | R29/R30/R31 de la 160: no ordenable, no filtrable, fuera del OpenAPI y de los DTO excluidos | No depende del criterio | **VERDE sin tocar** (R22) |
| 14 | `tests/unit/services/devolucion-sla-dinero.test.ts` (4 casos, marcados `[💰]`) | Que la gestión sintética del escalado cobra `cobroRechazado` igual que un rechazo directo, y que dos sintéticas cobrarían dos veces | No depende del criterio de intentos | **VERDE sin tocar**, y es la evidencia de R17 |
| 15 | Guardia de migraciones: `git diff --name-only -- db/` vacío | `160/R7` | Solo se pone rojo si se elige la rama B de ⛔ Q1 | Si se materializa, **derogar `160/R7` por escrito ANTES** |

Recuento: **6 archivos a REESCRIBIR** (#1,#2,#3,#5,#6 y las semillas de #10),
**1 a ADAPTAR** (#4), **1 prosa a actualizar** (#8), y **~40 archivos que deben
seguir verdes** (#11,#12,#13,#14). Cualquier rojo fuera de esta lista es un
hallazgo, no un daño colateral.

---

## 7. Esto TOCA DINERO: cómo se verifica que no se cobra de más

La cadena es literal y está en el código: `contarIntentos`
(`OrdenHistorialService.ts:64`) → `DevolucionSlaService.ts:117-122` → `escalar`
(`:174-186`) → `DevolucionSlaRepository.escalarDevueltaSla:126` → gestión
sintética `resultado: 'rechazada'` con `cierre_id NULL` (`:145-155`) →
`derivarIngresoBodega` / `ingresoBodegaPorResultado`
(`lib/utils/cierre-totales.ts:44`, `lib/utils/ingreso-bodega.ts:18`) → snapshot
`ingreso_bodega_rechazo` al cerrar (`CierreDiaRepository.ts:507-522`) → wallet al
aprobar (`CierresAdminRepository.ts:664-672`). **Un intento contado antes de
tiempo es un cobro real a la tienda antes de tiempo.**

Cinco verificaciones exigidas, en orden:

1. **Medición previa contra producción (⛔ Q4), patrón `160/D7`.** Antes de tocar
   código: consulta de SOLO LECTURA que cuente, para las órdenes que hoy reposan
   en `devuelta`, el conteo con el criterio viejo y con el nuevo, y liste cuántas
   cruzan el umbral (`reintentosConfig.MIN_INTENTOS_ENTREGA`, default 3) en una
   dirección o en la otra. El resultado, con fecha, va a este design. `160/D7`
   midió 0 órdenes en su día: **ese número no es reutilizable**, hay que volver a
   medir.
2. **Dirección del error declarada.** El repo ya tiene la regla escrita
   (`OrdenHistorialRepository.ts:182-186`): contar de MENOS retrasa el escalado
   (inofensivo); contar de MÁS cobra antes de tiempo. Toda ambigüedad del criterio
   nuevo se resuelve hacia contar de menos, y se testea como tal.
3. **Lista de INCLUSIÓN, no de exclusión** (§4). Un `resultado` futuro no puede
   empezar a contar solo. Test dedicado, heredado del propósito de #1 de §6.
4. **No-doble-conteo entre los dos caminos (R4)** con un escenario que recorra
   corte automático → aprobación sobre la misma orden y afirme el mismo número.
5. **`devolucion-sla-dinero.test.ts` verde sin tocar** (#14 de §6): el monto y los
   disparadores del cobro no cambian (R17). Si ese archivo necesita cambios, el
   alcance de la feature se salió de sitio.

---

## 8. Analítica: la parte que nadie ve venir

`primer_intento_ok` («Entrega al primer intento») se define como «entregas
logradas sin intento previo» y **consume este mismo conteo**
(`AnaliticaRollupService.ts:238`, `AnaliticaOperativaService.ts:462`). Dos hechos
medidos que convierten esto en decisión, no en detalle:

- Es un KPI **PERSISTIDO** en `analytics_daily`, con CHECK
  `primer_intento_ok <= entregas` en base
  (`db/migrations/20260731120000_analytics_daily/migration.sql:90`) y validación
  previa en el servicio (`AnaliticaRollupService.ts:248-254`).
- Con el criterio nuevo, una entrega cuyo cierre aún no se procesó tiene 0
  intentos previos ⇒ **el KPI subirá mecánicamente** para el día en curso y bajará
  al procesarse los cierres, y las filas históricas ya escritas miden otra cosa.

Esto es ⛔ Q10. Sea cual sea la respuesta, R23 exige que el KPI siga sin `COUNT`
propio ni umbral propio: la métrica REMITE al punto único
(`lib/analytics/metrics.ts:344-352`) y esa propiedad no se negocia.

---

## 9. Conflictos con otras features en vuelo

**Feature 208 (`feature/208-pago-multiple-entrega`, en el checkout principal).**
Toca `CierreDiaService`, `CierreDiaRepository`, `CierresAdminRepository`,
`GestionOrdenRepository`, `MisAsignacionesService` y sus interfaces, más
`db/schema.prisma` y una migración nueva (`20260812120000_gestion_orden_pago`).
Solape con esta feature, por archivo:

| Archivo | La 213 lo necesita para | Riesgo |
| --- | --- | --- |
| `lib/repositories/CierreDiaRepository.ts` | Solo **leerlo** (`crearCierre:395`, `:480-483`) para fijar el ancla | **Bajo si la 213 no escribe ahí.** Con el enfoque derivado, no hace falta modificarlo |
| `lib/repositories/CierresAdminRepository.ts` | Solo **leerlo** (`resolverCierre:616`) | Bajo, mismo motivo |
| `lib/services/MisAsignacionesService.ts` | Es consumidor del conteo (`:168`), no se toca | Bajo; sí colisiona en `tests/unit/services/mis-asignaciones-service.test.ts` si ambas lo editan |
| `db/schema.prisma` | **Solo si se elige la rama B de ⛔ Q1** (materializar) | **Alto en ese caso**: la 208 ya tiene migración sin mergear. Otra razón para preferir la vía derivada |
| `lib/services/CierreDiaService.ts` | Solo leerlo (`solicitarCierre:391`, ventana de deshacer `:519-521`) | Bajo |

**Conclusión operativa:** con el diseño derivado (§2.1) el diff de la 213 vive en
`lib/repositories/OrdenHistorialRepository.ts`,
`lib/services/OrdenHistorialService.ts`, `lib/types/orden-historial.ts`, las dos
interfaces y sus tests. **Cero archivos compartidos con la 208.** Si el humano
elige materializar, la 213 pasa a depender del orden de merge con la 208.

---

## 10. Riesgos

1. **Verde falso en los tests de DB** (deuda ya registrada en memoria del repo):
   varias suites de integración retornan temprano con tablas vacías. Las semillas
   de #10 de §6 hay que verificarlas con datos, no con `passed`.
2. **El agujero original puede quedar sin tapar** (⛔ Q9): si `sin_gestionar` no
   cuenta, una orden cortada por el cron sigue volviendo a reparto con el mismo
   contador. Es la pregunta que hay que llevar a la puerta con más énfasis.
3. **Órdenes que dejan de escalar** (⛔ Q5): con el ancla (iii), un cierre nunca
   aprobado congela el conteo en 0 y el cron libera indefinidamente.
4. **El conteo pasa a ser monótono** (⛔ Q12): hoy baja al deshacer una gestión;
   después, la ventana de deshacer muere justo cuando el conteo empieza a contar.
   Es probablemente deseable, pero hay que declararlo y testearlo.
