# Feature 126 — analítica: servicios operativos · requirements

> **Estado: puerta T0 CERRADA el 2026-08-02.** Las cinco respuestas del humano están al final
> de este archivo bajo «Decisiones del humano (2026-08-02)» y **mandan sobre cualquier
> redacción anterior**. R18, R19, R24 y R25 están reescritos sobre ellas; R33–R36 nacen de
> ellas. No queda ningún requisito «sujeto a T0».
>
> Zona `backend`. Convive con la **127** (`analitica: servicios financieros`), también
> `in_progress`. El reparto de archivos entre ambas es vinculante y está en
> `design.md §1`. Este spec **no** escribe en ningún archivo de la 127.

## Glosario mínimo (todos verificados en `C:/w126`, no supuestos)

- **Rollup**: `analytics_daily` (`db/schema.prisma:1858-1898`). Grano
  `(fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion)`; 10 medidas.
  `mensajero_id` y `causa_devolucion` son NULLABLE **con significado de dominio**.
- **Fecha cerrada**: fecha calendario CR cuyo día ya cerró y para la cual el job de la 124
  (`AnaliticaRollupService.agregarFecha`) ya corrió. El job se dispara a las 00:30 CR del día
  siguiente: **el día en curso NUNCA tiene filas en el rollup**.
- **Gestión vigente**: fila de `gestion_orden` con `anulada_at IS NULL`
  (`db/schema.prisma:721`).
- **`DENOMINADOR_GESTIONES`**: `entregas + devoluciones + rechazos + incidentes`
  (`lib/analytics/metrics.ts`, usado por las tres tasas).
- **`ConsultaAnalitica`**: tipo opaco de la 122 (`lib/analytics/consulta.ts`), única forma
  legal de pasar filtro+rango+alcance+política de identidad a un repositorio de analítica.
- **Horizonte del historial**: `HORIZONTE_HISTORIAL_CR = "2026-07-13"`
  (`lib/analytics/backfill-rango.ts:33`), con `esNoComparable(fecha)` ya exportado. Por
  debajo de él `analytics_daily` está **legítimamente vacía**: `orden_historial_estado` nació
  en `db/migrations/20260713120000_...` sin backfill.
- **Penumbra**: órdenes que existían el 2026-07-13 y no volvieron a transicionar. No entran
  en ningún cubo, **y esto no caduca** (`specs/125-.../design.md §11`).
- **Fila huérfana `en_fulfillment`**: `en_fulfillment` **no** está en `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts:54-80`, la 155 lo retiró) pero la fila de `order_status`
  sobrevive y 37 filas de `orden_historial_estado` la referencian. El rollup congela el
  estatus **desde el historial**, así que ese id **sale en un `GROUP BY estatus_id` real**.

## Vara de verificación

Este spec sigue la vara del proyecto: **un requisito no está cubierto porque exista un test
verde, sino porque una mutación concreta de la implementación pone rojo un test NOMBRADO.**
Cada requisito lleva su mutación y el nombre del test que debe caer.

---

## Requisitos

### A. Frontera de la entrega

**R1.** El sistema DEBE exponer TODA lectura de analítica operativa a través de Server Actions
declaradas en `lib/actions/analitica-operativa.ts`, y NO DEBE crear ninguna ruta bajo
`app/api/` para ellas.
*Mutación:* mover una de las lecturas a `app/api/analitica/route.ts`.
*Rojo:* `operativa-frontera.guardia.test.ts` > «ninguna ruta de app/api consulta analítica
operativa».

**R2.** El sistema NO DEBE escribir, actualizar ni borrar ninguna fila de `analytics_daily`,
`orden`, `gestion_orden` ni `orden_historial_estado`: la 126 es **de solo lectura** sobre el
rollup y sobre el dominio.
*Mutación:* añadir `prisma.analyticsDaily.upsert(...)` en el repositorio lector.
*Rojo:* `operativa-solo-lectura.guardia.test.ts` > «ningún módulo de la 126 muta el rollup ni
el dominio».

**R3.** El sistema NO DEBE modificar ninguno de los archivos declarados propiedad de la 127
(`lib/analytics/metrics.ts`, `lib/services/AnaliticaFinancieraService.ts`,
`lib/repositories/ConciliacionCierresAnaliticaRepository.ts`,
`lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts`,
`tests/unit/analytics/_fake-prisma-dinero.ts` y los guardias `financiera-*`), y NO DEBE crear
`lib/actions/analitica.ts` (nombre genérico prohibido para ambas features).
*Mutación:* tocar una línea de `lib/analytics/metrics.ts` en el PR de la 126.
*Rojo:* `operativa-frontera-127.guardia.test.ts` > «el diff de la 126 no toca archivos de la
127» (guardia branch-scoped; su retirada se decide en T13, ver `tasks.md`).

### B. El borde: auditar → 403 → seudonimizar (R39/R40/R41 de la 122)

**R4.** CUANDO una Server Action de analítica operativa recibe una petición, el sistema DEBE
construir la consulta con `prepararConsultaAnalitica(raw, actor, metricaId, now)` y DEBE pasar
a servicios y repositorios **únicamente** el `ConsultaAnalitica` resultante; NINGUNA firma DEBE
aceptar `AnaliticaFiltroInput`, `AlcanceDatos` ni el filtro crudo por separado.
*Mutación:* cambiar la firma del repositorio a `(filtro: AnaliticaFiltroInput, alcance: AlcanceDatos)`.
*Rojo:* no compila **y** `alcance-obligatorio.guardia.test.ts` > «ningún archivo de
lib/{repositories,services,actions} consulta analítica sin el tipo opaco».

**R5.** CUANDO `prepararConsultaAnalitica` devuelve `status: "forbidden"`, el borde DEBE
llamar EXPLÍCITAMENTE a `logger.logError(describirDenegado({...}))` **antes** de responder, y
DEBE devolver `{ status: "forbidden" }` sin datos: NO DEBE devolver `ok` con ceros, ni lista
vacía, ni 200 con `data: []`.
*Mutación:* borrar la llamada al logger y confiar en `withErrorHandler`/`normalizeError` (que
solo loguea en la rama de error desconocido, `lib/errors/normalize.ts:22,45` — trampa
verificada y escrita en `lib/analytics/auditoria.ts`).
*Rojo:* `analitica-operativa-action.test.ts` > «un denegado deja rastro en el logger antes de
responder 403».

**R6.** CUANDO `prepararConsultaAnalitica` devuelve `status: "validation_error"`, el sistema
DEBE devolver `fieldErrors` y NO DEBE ejecutar NINGUNA consulta: el repositorio debe recibir
**cero** llamadas.
*Mutación:* mover el parseo después de la primera consulta.
*Rojo:* `analitica-operativa-action.test.ts` > «una entrada inválida no toca la base ni una
vez».

**R7.** MIENTRAS `consulta.politicaIdentidad === "seudonima"`, la **cadena serializada
completa** de la respuesta NO DEBE contener ningún identificador real de mensajero.
*Mutación:* devolver `mensajeroId` junto a la etiqueta seudónima "por comodidad de la UI".
*Rojo:* `operativa-seudonimizacion.test.ts` > «ningún uuid de mensajero sobrevive a
JSON.stringify de la respuesta» (se asierta sobre la serialización, no sobre los campos que la
UI pinta: en el App Router lo que no se pinta igualmente viaja).

**R8.** El sistema DEBE proyectar el cubo `mensajero_id IS NULL` del rollup como el literal
`MENSAJERO_SIN_ASIGNAR` (`lib/analytics/types.ts`) antes de seudonimizar, y NO DEBE
descartarlo, ni convertirlo en `null` serializado, ni etiquetarlo como "Mensajero N".
*Mutación:* filtrar las filas con `mensajeroId === null` al proyectar.
*Rojo:* `operativa-sin-asignar.test.ts` > «el cubo sin asignar sobrevive a la proyección y a
la seudonimización».

### C. Semántica heredada de la 135 (D10) — gestiones vs órdenes

**R9.** El sistema DEBE etiquetar cada serie devuelta con la `unidadDeConteo` que declara el
catálogo para esa métrica, tomada de `getMetrica(id)` y NO de una tabla propia.
*Mutación:* escribir `unidadDeConteo: "orden"` a mano en la proyección de `entregas`.
*Rojo:* `operativa-contrato-catalogo.test.ts` > «la unidad de conteo de cada serie sale del
catálogo».

**R10.** El sistema DEBE calcular `tasa_entrega`, `tasa_devolucion` y `tasa_rechazo` con
denominador `entregas + devoluciones + rechazos + incidentes` **del mismo recorte y del mismo
cubo agregado**; y CUANDO ese denominador sea 0, DEBE devolver `null`, no `0`, no `NaN` y no
lanzar.
*Mutación:* dividir entre `ordenesCreadas` (la "corrección" que el aviso de la 135 anticipa).
*Rojo:* `operativa-tasas.test.ts` > «la tasa de entrega divide entre gestiones, no entre
órdenes» y > «denominador cero devuelve null».

**R11.** El sistema NO DEBE emitir ninguna serie que sume dos métricas para las que
`sonSumables(a, b) === false`.
*Mutación:* añadir una serie "total gestionado" que sume `entregas + ordenes_creadas`.
*Rojo:* `operativa-sumabilidad.guardia.test.ts` > «ninguna composición del servicio suma
métricas no sumables».

**R12.** El sistema NO DEBE sumar `ordenes_estado_stock` entre fechas — **tampoco** para los
tres estatus terminales, donde D2-B2 de la 124 la vuelve *de hecho* un flujo. El embudo de un
rango de N días DEBE devolverse como **serie por fecha**, no como un total.
*Mutación:* devolver `SUM(ordenes_estado_stock)` agrupado solo por estatus para el rango.
*Rojo:* el tripwire ya existente de R43 de la 124 (`analytics-daily-guards.test.ts`) **más**
`operativa-embudo.test.ts` > «el embudo de un rango de tres días devuelve tres puntos, no uno
sumado».

**R13.** CUANDO un `GROUP BY estatus_id` devuelve un estatus que **no** está en
`ORDER_STATUS_SEED` (caso confirmado: la fila huérfana `en_fulfillment`), el sistema DEBE
incluirlo en el resultado con la etiqueta que le da la tabla `order_status`, y NO DEBE lanzar
ni descartarlo en silencio.
*Mutación:* mapear el estatus con un `Record<OrderStatusValue, string>` hardcodeado y
`throw`/`!` ante una clave desconocida.
*Rojo:* `operativa-estatus-huerfano.test.ts` > «un estatus fuera del seed no rompe el embudo y
conserva su etiqueta».

**R14.** El sistema DEBE calcular `tiempo_ciclo` sumando `seg_ciclo_acum` y `seg_ciclo_n` de
todos los cubos del recorte **antes** de dividir, y CUANDO `seg_ciclo_n` agregado sea 0 DEBE
devolver `null`. NO DEBE promediar promedios ni serializar `BigInt`.
*Mutación:* calcular el promedio por fila y luego promediar los promedios.
*Rojo:* `operativa-tiempo-ciclo.test.ts` > «el promedio de ciclo suma numerador y denominador
antes de dividir» y > «la respuesta no contiene BigInt» (`JSON.stringify` de un `BigInt`
lanza `TypeError`; ver `IAnaliticaRollupService.ts:8-11`).

**R15.** El sistema DEBE agrupar `motivos_devolucion` por `causa_devolucion` **incluyendo el
cubo `NULL`** (devoluciones sin causa tipificada: el histórico anterior a la feature 73 no se
backfilleó, `db/schema.prisma:700-707`), etiquetado explícitamente como "sin causa
tipificada", y NO DEBE descartarlo.
*Mutación:* añadir `causaDevolucion: { not: null }` al `where`.
*Rojo:* `operativa-motivos-devolucion.test.ts` > «las devoluciones sin causa tipificada
aparecen en su propio cubo».

### D. Fuente de datos: rollup, intradía y ventana ciega

**R16.** MIENTRAS el rango solicitado contenga **solo fechas cerradas**, las 14 métricas
`clase: "snapshot"` DEBEN leerse de `analytics_daily` y NO DEBEN consultar `orden`,
`gestion_orden` ni `orden_historial_estado`.
*Mutación:* servir `entregas` con un `groupBy` sobre `gestion_orden`.
*Rojo:* `operativa-fuente.guardia.test.ts` > «una métrica snapshot con rango cerrado no toca
las tablas vivas».

**R17.** El sistema DEBE servir `aging_por_estado` —única métrica `clase: "live"` del
catálogo— contra `orden` + `orden_historial_estado`, y NO DEBE servirla desde el rollup.
*Mutación:* servirla leyendo `analytics_daily`.
*Rojo:* `operativa-fuente.guardia.test.ts` > «la única métrica live no lee el rollup».

**R18.** *(T0-Q1 = B, 2026-08-02)* CUANDO el rango solicitado incluye el **día en curso** —que
por construcción no tiene filas en el rollup, porque el job de la 124 corre a las 00:30 CR
sobre el día que cerró—, el sistema DEBE completar ese día calculándolo **en vivo** sobre
`orden`, `gestion_orden` y `orden_historial_estado` con las MISMAS definiciones del agregador
de la 124, y DEBE marcar ese punto con `parcial: true` y `corteAt` (el instante usado como
cota superior).
*Mutación:* devolver el día en curso como un punto normal, indistinguible de un día cerrado.
*Rojo:* `operativa-intradia.test.ts` > «el punto del día en curso viene marcado como parcial y
con su instante de corte».

**R19.** *(T0-Q2 = B, 2026-08-02)* CUANDO el rango solicitado incluye fechas para las que
`esNoComparable(fecha) === true`, el sistema DEBE devolver en la respuesta un bloque
`cobertura` que enumere esas fechas y las declare **no comparables**, y NO DEBE presentarlas
como ceros indistinguibles de un día real sin actividad. El horizonte DEBE tomarse de
`HORIZONTE_HISTORIAL_CR` / `esNoComparable` (`lib/analytics/backfill-rango.ts`, feature 125):
el sistema NO DEBE declarar una segunda constante de horizonte.
*Mutación (a):* devolver los ceros del rollup sin el bloque `cobertura`.
*Mutación (b):* escribir `"2026-07-13"` como literal propio en el módulo de la 126.
*Rojo:* `operativa-cobertura.test.ts` > «un rango que cruza el horizonte del historial declara
sus fechas no comparables» y > «el horizonte se importa de la 125 y no se reescribe» (censo:
la fecha literal aparece en **un** solo archivo del árbol de código).

**R20.** El sistema DEBE declarar en la respuesta la **penumbra** como limitación conocida y
permanente (órdenes vivas el 2026-07-13 que nunca volvieron a transicionar no entran en ningún
cubo) mediante una constante única con su procedencia, y NO DEBE intentar estimarla, simularla
ni rellenarla.
*Mutación:* sumar un "ajuste de penumbra" calculado sobre `orden.created_at`.
*Rojo:* `operativa-cobertura.test.ts` > «el sistema no inventa filas para la penumbra».

### E. Alcance por rol (frontera multi-tenant)

**R21.** El sistema DEBE recortar el rollup con la columna `mensajeroId` de `analytics_daily`
(`db/schema.prisma:1863`, índice `analytics_daily_mensajero_fecha_idx`) y NO con
`mensajeroAsignadoId`, que es la columna de `orden`; y la función de recorte del rollup DEBE
estar tipada contra el modelo real (`Prisma.AnalyticsDailyWhereInput`), no como
`Record<string, string>`.
*Contexto:* defecto **confirmado** en `lib/analytics/alcance-columnas.ts:75-86` (feature 122,
ya mergeada): el tipo laxo impide que el compilador lo vea.
*Mutación:* revertir la clave a `mensajeroAsignadoId`.
*Rojo:* no compila **y** `alcance-adaptadores.test.ts` > «whereRollup nombra la columna del
rollup, no la de orden».

**R22.** MIENTRAS el actor sea `mensajero`, ninguna fila devuelta DEBE corresponder a un
mensajero distinto de él, **ni** al cubo `MENSAJERO_SIN_ASIGNAR` (una orden sin asignar no es
"propia" de nadie, R28 de la 122).
*Mutación:* aplicar el recorte con `OR mensajeroId IS NULL` "para que le cuadre el total".
*Rojo:* `operativa-aislamiento.test.ts` > «un mensajero no ve el cubo sin asignar».

**R23.** MIENTRAS el actor sea `adminSatelite`, el recorte DEBE aplicarse sobre la zona
**congelada de la orden** (`analytics_daily.zona_id`, que la 124 puebla desde `orden.zona_id`)
y NUNCA sobre la zona del usuario mensajero.
*Mutación:* unir con `usuario` y recortar por `usuario.zona_id`.
*Rojo:* `operativa-aislamiento.test.ts` > «la zona del recorte es la de la orden, no la del
mensajero que la gestionó».

**R24.** *(T0-Q5 = A, 2026-08-02)* MIENTRAS `politicaIdentidad === "seudonima"`, el sistema
DEBE rechazar con `forbidden` **y auditar** (mismo camino de R5) toda consulta cuyo filtro
nombre `mensajero_id`, cerrando el oráculo residual contra R39 de la 122: un `adminTienda`
puede enviar `mensajero_id:[uuid]` y confirmar por el conteo si ese mensajero trabajó para él,
pese a la seudonimización. El rechazo NO DEBE recortar la desagregación seudónima que D5 de la
122 le concedió: el `adminTienda` pierde el **filtro**, no la **vista**.
*Mutación (a):* aceptar el filtro y devolver el conteo.
*Mutación (b):* responder `forbidden` pero además dejar de emitir las series por mensajero
seudonimizadas para ese rol.
*Rojo:* `operativa-oraculo.test.ts` > «un adminTienda no puede sondear por mensajero_id» y
> «un adminTienda sigue viendo la desagregación seudónima por mensajero».
*No se parchea* `recortarFiltro` de la 122 (feature ajena ya mergeada).

### F. Rendimiento

**R25.** *(T0-Q1 = B, 2026-08-02 — en alcance, ya no condicional)* Toda consulta intradía DEBE
apoyarse en un índice declarado **en `db/schema.prisma`** (no solo en el `.sql`: si el
datamodel no lo declara, el siguiente `prisma migrate dev` propondrá borrarlo), y la migración
que lo cree DEBE traer su `down.sql`.
*Contexto verificado:* `gestion_orden` **no** tiene índice por `created_at`
(`db/schema.prisma:736-739`: solo `ordenId`, `mensajeroId`, `cierreId`, `anuladaPor`). El job
nocturno de la 124 tolera el escaneo; una ruta por-request no.
*Mutación:* borrar el índice de la migración y dejar la consulta intradía.
*Rojo:* `analitica-operativa-indices.test.ts` (integración) > «la consulta intradía de
gestiones usa índice» (`EXPLAIN` sin `Seq Scan` sobre `gestion_orden`) y
`db-rollback` aplica el `down.sql` sin error.

**R26.** El sistema NO DEBE ejecutar una consulta por métrica cuando varias métricas comparten
cubo: las 13 métricas de rollup del mismo grano DEBEN resolverse con **una** agregación.
*Mutación:* llamar al repositorio una vez por métrica en el bucle del servicio.
*Rojo:* `analitica-operativa-service.test.ts` > «un tablero de cinco métricas hace una sola
consulta al rollup» (se cuentan las llamadas al repositorio mockeado).

### G. Guardias heredados que la 126 debe re-alcanzar o reparar

**R27.** El sistema DEBE re-alcanzar el guardia R42 de la 124
(`tests/integration/db/analytics-daily-guards.test.ts` > «NADIE lee el rollup todavía»):
levantar la prohibición **solo** para el repositorio lector declarado de la 126, dejándola
vigente para cualquier otro archivo del árbol.
*Mutación:* añadir un `prisma.analyticsDaily.findMany` en un segundo archivo (p. ej. el
servicio, o un componente).
*Rojo:* `analytics-daily-guards.test.ts` > «un solo archivo puede LEER la tabla: el lector
declarado de la 126».
*Prohibido:* aflojar el guardia borrando el caso o ampliando la lista a un directorio.

**R28.** El sistema DEBE endurecer el guardia R18 de la 122
(`alcance-obligatorio.guardia.test.ts`) para que además del censo por nombre detecte al
**forjador**: `as ConsultaAnalitica` y `as unknown as ConsultaAnalitica`.
*Contexto:* deuda (a) del review de la 122 del 2026-08-01: hoy `recibeConsultaPreparada`
(línea 88) es un `test(/\bConsultaAnalitica\b/)`, así que un archivo que **forja** el tipo con
un cast pasa el censo por mencionar la palabra.
*Mutación:* introducir en el repositorio lector
`const c = { filtro, alcance } as unknown as ConsultaAnalitica`.
*Rojo:* `alcance-obligatorio.guardia.test.ts` > «un cast a ConsultaAnalitica no cuenta como
recibirla».

**R29.** El sistema DEBE ampliar `alcance-bordes.guardia.test.ts` para que censo los bordes
**reales** (`app/` y `lib/actions/`) además de los bordes sintéticos.
*Contexto:* deuda (b) del mismo review: hoy el archivo solo prueba bordes sintéticos y su
comentario promete ponerse rojo cuando aterrice la 126; no lo haría.
*Mutación:* quitar la llamada al logger de la Server Action (la misma mutación de R5).
*Rojo:* `alcance-bordes.guardia.test.ts` > «todo borde real de analítica audita antes de
responder 403».

### H. Contrato de salida y errores

**R30.** Toda respuesta `ok` DEBE declarar: el `metricaId`, el `RangoResuelto` usado, la
**fecha de referencia** de los puntos, y NO DEBE contener ningún `BigInt` ni ninguna `Date`
sin serializar de forma estable.
*Mutación:* devolver `segCicloAcum` tal cual desde Prisma.
*Rojo:* `operativa-contrato-salida.test.ts` > «la respuesta es JSON-serializable sin
excepciones».

**R31.** El sistema DEBE ser determinista: misma entrada y mismo `now` inyectado ⇒ misma
salida. NO DEBE haber ningún `Date.now()` ni `new Date()` implícito en el servicio.
*Mutación:* usar `new Date()` dentro del servicio en vez del reloj inyectado.
*Rojo:* `analitica-operativa-service.test.ts` > «dos llamadas con el mismo reloj inyectado dan
el mismo resultado» y `operativa-solo-lectura.guardia.test.ts` > «el servicio no construye
fechas por su cuenta».

**R32.** CUANDO una consulta falla, el sistema DEBE propagar el error envuelto con la
**operación** y la **métrica**, y el mensaje NO DEBE contener ids de orden, guías,
destinatarios, teléfonos ni ningún dato ajeno al solicitante.
*Mutación:* incluir el `where` completo (con los ids del filtro y del alcance) en el mensaje.
*Rojo:* `operativa-errores.test.ts` > «el error nombra la etapa y la métrica y no filtra
identificadores».

### I. Requisitos nacidos de las decisiones del 2026-08-02

**R33.** *(de Q1=B, contención de la duplicación)* El sistema DEBE probar que el camino
intradía y el rollup producen **los mismos cubos** para una misma fecha: dada una fecha ya
cerrada, ejecutar el camino intradía con `corteAt` = corte de ese día DEBE dar, cubo a cubo y
medida a medida, lo mismo que las filas que el job de la 124 escribió para esa fecha.
*Por qué es un requisito y no una buena práctica:* la 126 declara sus propias consultas
intradía (D13), así que hay **dos** implementaciones de las mismas definiciones; sin este test
la divergencia sería silenciosa y aparecería como «los números de hoy no cuadran con los de
ayer».
*Mutación:* cambiar una sola definición en el camino intradía (p. ej. quitar
`anulada_at IS NULL` de las gestiones, o usar `gestion_orden.mensajero_id` en vez del
mensajero de la orden para la coordenada).
*Rojo:* `analitica-operativa-equivalencia.test.ts` (integración) > «el intradía de una fecha
cerrada reproduce exactamente las filas del rollup».

**R34.** *(de Q2=B)* El bloque `cobertura` DEBE ser **obligatorio** en el contrato de salida
(`SerieOperativa`), no opcional, para que ningún consumidor pueda ignorarlo por omisión; y el
spec DEBE dejar el **aviso dirigido** a la 131 y la 133 de que ese bloque se pinta.
*Por qué:* si la información existe y no se ve, la decisión de Q2 no compra nada; la
diferencia entre «cero» y «no se sabe» solo existe cuando llega al píxel.
*Mutación:* declarar `cobertura?: Cobertura` (opcional) para que la UI pueda no consumirlo.
*Rojo:* no compila el fixture de contrato **y** `operativa-contrato-salida.test.ts` >
«cobertura es obligatoria en toda respuesta ok».

**R35.** *(de Q4=A)* El sistema DEBE servir `sin_gestionar` **derivándola del embudo**
(proyección de `ordenes_estado_stock` sobre el estatus `sin_gestionar`), y DEBE declarar en la
respuesta, con todas las letras, que su semántica es **«sin gestionar HOY»** —universo B2 de la
124: órdenes vivas en ese estado al corte, más las que llegaron a terminal ese día— y **NO**
«sin gestionar acumuladas». El sistema NO DEBE sumarla entre fechas (queda cubierta por R12
como cualquier proyección del stock).
*Por qué es requisito y no comentario:* leída como acumulada es un número muy distinto, y no
hay nada en el nombre de la métrica que impida esa lectura.
*Mutación (a):* servirla como suma de `ordenes_estado_stock` del rango.
*Mutación (b):* borrar de la respuesta la declaración de semántica.
*Rojo:* `operativa-sin-gestionar.test.ts` > «sin_gestionar se deriva del embudo y no se suma
entre fechas» y > «la serie declara la semántica HOY (universo B2)».
*Frontera:* esta declaración vive en el contrato de la **126**. Escribirla también en el
catálogo exigiría tocar `lib/analytics/metrics.ts`, que es de la 127: **queda anotada para la
ficha 175** (ver Decisiones, Q3), no se hace aquí.

**R36.** *(de Q5=A)* El rechazo de R24 DEBE vivir en un **helper exportado y único**, no
inline en la Server Action, para que la **134** (export CSV) consuma exactamente el mismo
predicado en vez de reimplementarlo.
*Mutación:* copiar la comprobación dentro de la acción y borrar el helper.
*Rojo:* `operativa-oraculo.test.ts` > «el predicado del oráculo se exporta una sola vez» (censo:
la comprobación aparece en un único archivo de `lib/`).

---

## Trazabilidad exigida

`progress/impl_126.md` debe contener el mapa `R1..R36 → test nombrado`. Un requisito sin test
nombrado es un fallo de la feature (`docs/specs.md > Trazabilidad`, `CHECKPOINTS.md`).

---

## Decisiones del humano (2026-08-02) — puerta T0 CERRADA

| # | Decisión | Efecto en el spec |
|---|---|---|
| **Q1** | **(B)** Completar el día abierto **en vivo**. La migración de índices sobre `gestion_orden.created_at` **entra en el alcance** de la 126. | R18 reescrito, R25 deja de ser condicional, **R33** nuevo (equivalencia intradía↔rollup), **D6/D13** en `design.md` |
| **Q2** | **(B)** Bloque `cobertura` en la respuesta, reusando `esNoComparable`/`HORIZONTE_HISTORIAL_CR` de la 125. | R19 reescrito, **R34** nuevo (obligatorio + aviso dirigido a 131/133), D9 |
| **Q3** | **(C)** Ficha propia después = **feature 175**, con **(A)** como estado transitorio: la 126 **NO toca `lib/analytics/metrics.ts`**. | R3 intacto, divergencias declaradas en `design.md §9` y en `progress/impl_126.md` |
| **Q4** | **(A)** Derivarla del embudo, sin migración, con la semántica escrita con todas las letras. | **R35** nuevo, D14 |
| **Q5** | **(A)** Cerrarlo en la 126: `forbidden` + auditoría, en un **helper reutilizable** que la 134 consume. No se parchea `recortarFiltro` de la 122. | R24 reescrito, **R36** nuevo, D12 |

**Las dos divergencias del catálogo que hereda la ficha 175** (verificadas, con ruta y línea):

1. `lib/analytics/metrics.ts:220` — `incidentes` declara `estadoProduccion: "declarada"`, pero
   **sí** tiene columna en el rollup (`db/schema.prisma:1873`) y la 126 está obligada a leerla:
   es el cuarto término de `DENOMINADOR_GESTIONES` de las tres tasas.
   **Riesgo transitorio dimensionado:** la **133** decide qué paneles pinta con
   `estadoProduccion`; hasta que la 175 aterrice, puede **ocultar `incidentes`** creyéndolo sin
   productor, cuando la 126 lo sirve con datos reales.
2. `lib/analytics/metrics.ts:115-128` — `ordenes_por_estado` declara
   `definicion.estados = ORDER_STATUS_SEED` (19 valores, terminales incluidos), mientras la
   columna real contiene el **universo B2** de la 124
   (`specs/124-analitica-job-agregacion-diaria/design.md §4.3`). La 126 es quien la sirve a la
   UI, así que la divergencia se vuelve visible aquí. Misma nota aplica a la semántica de
   `sin_gestionar` (R35), que también debería quedar escrita en el catálogo.

A continuación queda el registro de lo que se pesó en cada pregunta, con la opción elegida
marcada **✔ ELEGIDA**.

### Q1 — El día en curso no existe en el rollup. ¿Qué muestra el tablero de "hoy"?

**Hecho verificado:** el job de la 124 corre a las 00:30 CR y agrega **el día que cerró**. Por
tanto `analytics_daily` **nunca** tiene filas del día en curso. El preset `dia` de la 135
resuelve al **día natural CR de `now`**, es decir, hoy. Consecuencia literal: si las métricas
`snapshot` se sirven solo del rollup, **el preset por defecto del tablero operativo devuelve
cero filas siempre**, y el tablero nace vacío.

- **(A) Solo días cerrados.** Las 14 métricas `snapshot` recortan el rango a la última fecha
  cerrada y la respuesta declara `hasta_efectiva`. *Consecuencia:* el tablero "hoy" muestra
  **ayer** y lo dice; el jefe de operación no puede ver su propia jornada en curso; se ahorra
  toda la ruta intradía, la migración de índices (R25) y el riesgo de dos verdades. Coste
  ~0 y valor operativo bajo: es un tablero de ayer.
- **(B) Completar el día en curso en vivo. ✔ ELEGIDA (2026-08-02).** Para el día abierto, la 126
  reejecuta **las mismas consultas del agregador de la 124** con ventana `[00:00 CR, ahora)` y
  el punto se marca `parcial: true` con su instante de corte. *Consecuencia:* el tablero sirve
  la jornada en curso; a cambio (i) hace falta **una migración de índices** sobre
  `gestion_orden.created_at` (hoy no existe: `db/schema.prisma:736-739`) porque una ruta
  por-request no puede escanear la tabla; (ii) aparece una **segunda implementación de las
  definiciones** salvo que se reuse el repositorio del escritor de la 124, que hoy es global y
  **no aplica recorte por rol** — reusarlo obliga a recortar en memoria (correcto, pero
  computa la operación entera de la compañía en cada request de un `adminTienda`); (iii) el
  guardia R42 hay que abrirlo un poco más de lo que R27 supone.
  **Resuelto en D13:** no se reusa el repositorio de la 124 (sus seis consultas son plantillas
  `$queryRaw` cerradas sobre `VentanaDia`, sin costura para inyectar un `where`); la 126
  declara consultas propias recortadas y la duplicación se contiene con **R33**. El riesgo del
  recorte en memoria queda **descartado por diseño**, no aceptado.
- **(C) Intradía solo para el subconjunto barato.** Se sirve en vivo únicamente
  `aging_por_estado` (que ya es `live` y se apoya en el índice existente
  `orden_historial_estado(orden_id, created_at)`), y el resto de métricas se sirven cerradas
  como en (A). *Consecuencia:* la mitad del tablero es de hoy y la otra mitad de ayer, con dos
  fechas de referencia distintas en la misma pantalla. Barato, y una fuente permanente de
  "¿por qué no cuadran estos dos números?".

**Efecto de la decisión:** R18 reescrito, R25 pasa a alcance firme (migración de índices),
**R33** nuevo, T6/T7 de `tasks.md` dejan de ser condicionales, y la disyuntiva (ii) queda
resuelta en **D13** de `design.md`.

### Q2 — Cinco días ciegos al principio de la historia (y una penumbra que no caduca)

**Hecho verificado:** `orden_historial_estado` nació el **2026-07-13** sin backfill; la primera
migración del repo es del **2026-07-08**. Bajo ese horizonte, `analytics_daily` está
legítimamente vacía y **no es un fallo** (la 125 ya lo modeló como `no_comparable`). Además,
las órdenes vivas el 13/07 que nunca volvieron a transicionar **no entran en ningún cubo,
nunca**.

- **(A) Silencio.** El rango devuelve los ceros del rollup como cualquier otro día.
  *Consecuencia:* un tablero de "julio" muestra una caída a cero en los primeros días y la
  lectura natural es "la operación se paró", no "no lo sabemos". Es el escenario en que
  alguien abre un bug de datos que no existe.
- **(B) Declararlo en la respuesta. ✔ ELEGIDA (2026-08-02),** con el añadido de que el bloque
  es **obligatorio** en el contrato y la 131/133 debe pintarlo (**R34**). La respuesta lleva un bloque `cobertura`
  que enumera las fechas `no_comparable` (reusando `esNoComparable` /
  `HORIZONTE_HISTORIAL_CR`, ya exportados por la 125) y una nota permanente de penumbra.
  *Consecuencia:* el contrato de salida crece un campo y la 131/133 tiene que pintarlo (si no
  lo pinta, la información existe pero no se ve); a cambio "cero" y "no se sabe" dejan de ser
  el mismo píxel.
- **(C) Rechazar el rango.** `validation_error` si el rango cruza el horizonte.
  *Consecuencia:* nadie puede consultar julio completo desde la analítica, ni siquiera para
  ver la parte buena; y el rechazo aparecerá cada vez que alguien pida "todo el histórico".

**Efecto de la decisión:** R19 reescrito, **R34** nuevo (bloque obligatorio + aviso dirigido a
la 131/133), contrato de salida en `design.md §5.2`.

### Q3 — La 126 necesita escribir en `lib/analytics/metrics.ts`, que es de la 127

La regla 1 del arnés permite dos features backend a la vez **solo si no hay conflicto de
archivos**. Hay dos ediciones del catálogo que la 126 provoca, y **no las resuelvo por mi
cuenta**:

1. **`estadoProduccion` desactualizado.** `incidentes` está marcado `declarada`
   (`lib/analytics/metrics.ts:220`) pero **sí** tiene columna en el rollup
   (`analytics_daily.incidentes`) y la 126 está **obligada** a leerlo: es el cuarto término de
   `DENOMINADOR_GESTIONES` de las tres tasas. Al aterrizar la 126, `incidentes` pasa a ser
   `producida` de hecho, y el catálogo dirá lo contrario.
2. **Divergencia de contrato declarada por la 124.** El catálogo define `ordenes_por_estado`
   con `definicion.estados = ORDER_STATUS_SEED` (los 19 valores, incluidos los tres
   terminales); leído al pie de la letra, el stock de cada día incluiría todas las órdenes que
   han existido jamás. La 124 se apartó a propósito (D2=B2): la columna contiene los estados
   **no terminales** más las que llegaron a terminal **ese día**. La 126 es quien sirve esa
   columna a la UI, así que la divergencia se vuelve visible aquí.

- **(A) La 126 no toca `metrics.ts`; la divergencia queda declarada en el spec de la 126 y en
  `progress/impl_126.md`.** *Consecuencia:* cero conflicto con la 127, y un catálogo que
  miente en dos puntos hasta que alguien lo arregle. La 133 usa `listarMetricas({rol})` y
  `estadoProduccion` para decidir paneles: puede ocultar `incidentes` por creerlo sin
  productor.
- **(B) La 126 hace las dos ediciones y la 127 rebasa.** *Consecuencia:* es exactamente el
  conflicto que la regla 1 existe para evitar; la 127 está siendo implementada **ahora mismo**
  y `metrics.ts` es su archivo. Rebase de un archivo grande y muy comentado, con riesgo de
  perder líneas del catálogo financiero.
- **(C) Ficha propia de corrección de catálogo, después de que aterricen las dos. ✔ ELEGIDA
  (2026-08-02) = feature 175,** con (A) como estado transitorio.
  *Consecuencia:* nadie toca `metrics.ts` en paralelo, la corrección se hace una vez y con su
  propio test; el coste es que la mentira vive el tiempo que tarde esa ficha.

**Efecto de la decisión:** (C) = **feature 175**, con (A) como estado transitorio explícito. R3
se mantiene tal cual y las dos divergencias quedan declaradas arriba y en `design.md §9`.

### Q4 — `sin_gestionar`: métrica del catálogo sin columna en el rollup

**Hecho verificado:** `sin_gestionar` está en el catálogo como `snapshot` con
`fuente: rollup`, granos `fecha/zona/mensajero` y `estadoProduccion: "declarada"`
(`lib/analytics/metrics.ts:232-247`). Pero **`analytics_daily` no tiene ninguna columna
`sin_gestionar`** (`db/schema.prisma:1867-1876`): sus 10 medidas no la incluyen. El estado
`sin_gestionar` **sí** aparece como un valor de `estatus_id` dentro de
`ordenes_estado_stock`.

- **(A) La 126 la deriva del embudo. ✔ ELEGIDA (2026-08-02)** — con la semántica escrita con
  todas las letras en el contrato (**R35**). (Proyección de `ordenes_estado_stock` filtrada por el
  estatus `sin_gestionar`, agregando la dimensión `tienda` que la métrica no declara).
  *Consecuencia:* la métrica existe hoy, sin migración ni cambio en el job; pero hereda la
  semántica **B2** del stock (§ Q3.2), o sea "sin gestionar hoy", no "sin gestionar
  acumuladas", y ese matiz hay que escribirlo o alguien lo leerá como deuda acumulada.
- **(B) Se queda sin productor.** La 126 la deja `declarada` y no la sirve. *Consecuencia:* el
  catálogo ofrece una métrica que ninguna acción responde; la 131/133 tiene que filtrar por
  `estadoProduccion` para no pintar un panel muerto. La 135 (D8) dice explícitamente que una
  métrica `declarada` **no es deuda** de la 126: esta opción es legítima.
- **(C) Columna propia en el rollup.** Migración + cambio en el job de la 124 + backfill.
  *Consecuencia:* la métrica queda bien fundada, pero saca a la 126 de su frontera y le mete
  mano al escritor de otra feature ya mergeada, con re-backfill de toda la historia.

**Efecto de la decisión:** (A). Nace **R35**, con la semántica «sin gestionar HOY» (universo
B2) escrita en el contrato de la 126; escribirla también en el catálogo cruzaría la frontera de
la 127 y queda para la **ficha 175**.

### Q5 — Oráculo residual contra R39 de la 122: el sondeo por `mensajero_id`

**Hecho verificado (deuda (c) del review de la 122):** `recortarFiltro`
(`lib/analytics/consulta.ts:144-166`) solo interseca **la dimensión del alcance**. Un
`adminTienda` está recortado por `tienda_id`, así que su `mensajero_id: [uuid]` **pasa tal
cual** al `where`. La seudonimización le oculta el nombre en la salida, pero **el conteo le
confirma** si ese mensajero trabajó para él. Con una lista de uuids obtenida por otra vía,
reconstruye la relación mensajero↔tienda que D5 de la 122 quiso ocultar.

- **(A) Cerrarlo en la 126. ✔ ELEGIDA (2026-08-02)** — en un helper reutilizable que la 134
  consume (**R36**). Cuando la política es `seudonima`, un filtro que
  nombre `mensajero_id` se responde `forbidden` (`filtro_fuera_de_alcance`) y se audita.
  *Consecuencia:* el `adminTienda` **pierde** el filtro por mensajero (sigue viendo la
  desagregación seudónima completa, que es lo que D5 le concedió); la corrección vive en el
  borde de la 126 y no en el módulo de la 122, así que la 134 (export CSV) tendrá que repetirla
  o consumirla.
- **(B) Cerrarlo en la 122** (parche en `recortarFiltro`). *Consecuencia:* queda arreglado para
  todos los consumidores de una vez, pero toca una feature ajena **ya mergeada** y hay que
  pedírselo a alguien, con su propio PR y su ventana.
- **(C) Aceptar el riesgo y declararlo.** *Consecuencia:* la seudonimización queda como
  cosmética frente a un atacante con una lista de uuids; se documenta en `design.md §9` y en
  `progress/impl_126.md`. Es defendible si el modelo de amenaza no incluye a un `adminTienda`
  malicioso, pero conviene decirlo con esas palabras.

**Efecto de la decisión:** R24 reescrito + **R36** (helper único), T9.5 de `tasks.md` deja de
ser condicional.
