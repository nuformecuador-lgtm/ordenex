# 166 — Saneamiento de la ventana de día de `RankingService` (18:00–18:00 CR)

> Zona: `backend` · SDD · `depends_on: null` · rama `feature/166-ranking-ventana-dia`
> Origen: decisión **D6** de la feature 135 (puerta F1.4 del 2026-07-30), task **T0.3**.

## 0. Contexto verificado en código (no copiado de la ficha)

Verificado sobre `origin/dev` @ `64957dca`, en el worktree `C:\w166`:

- `lib/services/RankingService.ts:60-61` (la ficha acierta en las líneas):

  ```ts
  const desde = startOfDayCR(now);
  const hasta = new Date(desde.getTime() + UN_DIA_MS);   // UN_DIA_MS = 24 h, línea 17
  ```

- Esas dos cotas viajan a `RankingRepository` (`lib/repositories/RankingRepository.ts:21` y `:34`)
  y se comparan contra **dos columnas `timestamp`**, no contra `@db.Date`:
  - `gestion_orden.created_at` (`GestionOrden.createdAt`) — numerador (entregadas).
  - `orden.asignado_at` (`Orden.asignadoAt`, `db/schema.prisma:496`, `DateTime?`) — denominador
    (asignadas).
- `startOfDayCR` (`lib/utils/fecha-cr.ts:19-25`) devuelve la **medianoche UTC** de la fecha
  calendario CR (convención `@db.Date` de la feature 46). Costa Rica es **UTC−6 fijo, sin DST**.
  Por tanto `[startOfDayCR(now), +24 h)` es `[00:00Z, 24:00Z)` = **18:00 CR del día anterior →
  18:00 CR de hoy**, no el día natural de Costa Rica.
- La convención correcta para columnas `timestamp` es la de la feature 144:
  `inicioDelDiaCREnUtc(fecha)` = `${fecha}T06:00:00.000Z` y `inicioDelDiaSiguienteCREnUtc(fecha)`
  (`lib/utils/fecha-cr.ts:106-119`). Es la que adoptó la analítica (`lib/analytics/ranges.ts`).
- **`RankingService` es el ÚNICO consumidor de `startOfDayCR` que la usa contra columnas
  `timestamp`.** Los otros tres la usan contra fechas calendario / `@db.Date` y son **legítimos**:
  `lib/actions/liberacion-reprogramada.ts:85`, `lib/services/jobs/liberar-reprogramadas-handler.ts:72`
  (ambos comparan `fecha_reprogramacion`, `@db.Date`) y `lib/utils/periodicidad.ts:67,105`
  (aritmética de calendario sobre `fecha_cobro`).

### Consecuencia observable hoy

Una entrega registrada a las **19:00 CR del día D** no aparece en el ranking del día D: cuenta en
el del día D+1. Y el ranking que un mensajero ve a las 09:00 CR del día D **arrastra** las entregas
de 18:00–24:00 CR del día D−1. El corte diario del negocio, en cambio, ya es la medianoche CR
(`vercel.json`: `/api/cron/corte-diario`, `0 6 * * *` = 00:00 CR).

## 1. Alcance

**Dentro:** la resolución de la ventana «hoy (CR)» de `RankingService.obtenerRanking`, la
documentación que hoy declara la divergencia como vigente, y las guardias/tests que la congelan.

**Fuera:** el contrato de salida del ranking, la autorización, el podio, los premios, la descarga
(feature 170), la analítica, y cualquier otro consumidor de `startOfDayCR`.

## 2. Definiciones

- **Día CR:** el día calendario de Costa Rica de `now`, es decir `fechaCalendarioCR(now)`.
- **Ventana del día CR:** `[inicioDelDiaCREnUtc(f), inicioDelDiaSiguienteCREnUtc(f))` con
  `f = fechaCalendarioCR(now)`; ambos bordes caen en `...T06:00:00.000Z`. Semiabierta: `desde`
  inclusivo, `hasta` exclusivo.
- **Ventana vieja:** `[startOfDayCR(now), +24 h)`, bordes en `...T00:00:00.000Z`.

## 3. Requisitos (EARS)

**R1.** El sistema DEBE resolver la ventana «hoy» del ranking diario como la **ventana del día CR**
de `now`, con ambos bordes en `...T06:00:00.000Z`.

**R2.** CUANDO se solicita el ranking, el sistema DEBE pasar a los conteos de entregadas y de
asignadas **exactamente la misma** pareja `(desde, hasta)`, semiabierta `[desde, hasta)`.

**R3.** SI un evento contable del ranking ocurre entre las 18:00:00 CR y las 23:59:59.999 CR del día
CR de `now`, ENTONCES el sistema DEBE contarlo en el ranking de **ese** día y NO en el del día
siguiente.

**R4.** SI un evento contable del ranking ocurre entre las 18:00:00 CR y las 23:59:59.999 CR del día
CR **anterior** a `now`, ENTONCES el sistema NO DEBE contarlo en el ranking de hoy.

**R5.** El sistema DEBE tratar la cota superior como **exclusiva**: el evento situado exactamente en
las 00:00:00.000 CR del día siguiente queda FUERA, y el situado en 23:59:59.999 CR queda DENTRO.

**R6.** El sistema NO DEBE usar `startOfDayCR` en `lib/services/RankingService.ts` ni en
`lib/repositories/RankingRepository.ts`, ni escribir en ellos ninguna aritmética de zona horaria u
offset propios (`6 * 60 * 60 * 1000`, `21600000`, `24 * 60 * 60 * 1000`, `T06:00`, `T18:00`,
`toISOString().slice`).

**R7.** El sistema DEBE derivar la ventana **solo** de `now`: MIENTRAS se ejecuta el cálculo del
ranking, no DEBE haber ninguna lectura de reloj sin argumento (`new Date()` / `Date.now()`) en la
ruta de resolución de la ventana, de modo que dos invocaciones con el mismo `now` produzcan la
misma ventana.

**R8.** El sistema DEBE preservar sin cambios el contrato de salida de `obtenerRanking`
(`status`, `ranking[]` con `posicion`/`mensajeroId`/`nombre`/`entregadasHoy`/`asignadasHoy`/`pct`
STRING/`premio` STRING|null, `premios`, `esEditable`), su orden de clasificación y sus reglas de
autorización.

**R9.** MIENTRAS la ventana del ranking sea la ventana del día CR, la documentación de
`lib/analytics/ranges.ts` NO DEBE afirmar que el ranking usa una ventana 18:00–18:00 ni que
analítica y ranking reportan cifras distintas para «hoy»; DEBE declarar la divergencia **cerrada**
citando esta feature.

**R10.** El sistema DEBE seguir prohibiendo `startOfDayCR`, el offset escrito a mano y
`toISOString().slice` dentro de `lib/analytics/**`: la guardia se **reexpresa**, no se retira.

**R11.** El sistema DEBE conservar `startOfDayCR` exportada y documentada en
`lib/utils/fecha-cr.ts` como la convención válida para fechas `@db.Date`.

**R12.** El sistema NO DEBE alterar la ventana ni el comportamiento de ningún otro consumidor de
`startOfDayCR` (`lib/actions/liberacion-reprogramada.ts`,
`lib/services/jobs/liberar-reprogramadas-handler.ts`, `lib/utils/periodicidad.ts`).

**R13.** CUANDO se resuelven, para el mismo `now`, la ventana del ranking y el rango
`{ preset: "dia" }` de `lib/analytics/ranges.ts`, el sistema DEBE producir **cotas idénticas**
(`desde` y `hasta` iguales al milisegundo).

**R14.** MIENTRAS el día CR está en curso, el sistema DEBE seguir usando como cota superior las
24:00 CR del propio día (no `now`): el ranking cubre el día completo, igual que antes del cambio.

**R15.** El sistema DEBE dejar escrita en `lib/services/RankingService.ts` la razón del cambio
—ventana del día natural CR vía `inicioDelDiaCREnUtc`, feature **166**— para que la corrección no
se revierta por parecer «inconsistente» con `startOfDayCR`.

**R16.** El sistema NO DEBE requerir migración de base de datos, backfill ni recálculo de datos
persistidos: no existe ninguna tabla que almacene resultados de ranking (ver §5, HALLAZGO H2).

## 4. Trazabilidad `R<n>` → test

| R | Test que lo verifica |
| --- | --- |
| R1 | `tests/unit/services/ranking-service.test.ts` › «la ventana de hoy es el día natural CR: ambos bordes en `T06:00:00.000Z`» |
| R2 | `ranking-service.test.ts` › «pasa la MISMA pareja (desde, hasta) a entregadas y a asignadas» |
| R3 | `ranking-service.test.ts` › «la entrega de las 19:00 CR cuenta HOY, no mañana» (mutación: volver a `startOfDayCR` → rojo) |
| R4 | `ranking-service.test.ts` › «la entrega de las 19:00 CR de AYER queda fuera del ranking de hoy» |
| R5 | `ranking-service.test.ts` › «23:59:59.999 CR dentro; 00:00:00.000 CR del día siguiente fuera (cota exclusiva)» |
| R6 | `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` › censo de `startOfDayCR`, offsets y literales horarios en service + repositorio |
| R7 | `ranking-service.test.ts` › «dos llamadas con el mismo `now` producen la misma ventana» + guardia: sin `new Date()`/`Date.now()` sin argumento en la ruta de la ventana |
| R8 | `ranking-service.test.ts` (suite existente de la 76: R2–R19) + `tests/unit/actions/ranking-actions.test.ts`, sin modificar sus asserts |
| R9 | `tests/unit/analytics/ranges-reuso.guardia.test.ts` › caso reexpresado «declara la divergencia CERRADA (166)» |
| R10 | `ranges-reuso.guardia.test.ts` › censos de `startOfDayCR`, `6*60*60*1000`, `21600000`, `toISOString().slice` en `lib/analytics/**` (intactos) |
| R11 | `tests/unit/utils/fecha-cr.test.ts` y `tests/unit/utils/fecha-cr-filtros.test.ts` (sin cambios, verdes) |
| R12 | `tests/unit/services/liberar-reprogramadas-handler.test.ts`, `tests/unit/utils/periodicidad.test.ts` (sin cambios, verdes) |
| R13 | `ranking-service.test.ts` › «la ventana coincide al milisegundo con `resolverRango({preset:"dia"}, now)`» |
| R14 | `ranking-service.test.ts` › «la cota superior son las 24:00 CR, no `now`» |
| R15 | `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` › la fuente del service cita `inicioDelDiaCREnUtc` y la ficha 166 |
| R16 | `tests/unit/guards/ranking-ventana-dia.guardia.test.ts` › no hay migración nueva bajo `db/migrations/**` asociada a esta feature y el esquema de `premio_ranking` no cambia |

## 5. Preguntas abiertas

> Ninguna de estas la puede cerrar el spec_author. **Q1 bloquea la implementación**; Q2–Q4 pueden
> responderse en la puerta de aprobación.

**Q1 — ¿Qué se hace con los rankings ya publicados?** Cambiar la ventana cambia las cifras que se
leen. Opciones **realmente disponibles en este código** (ver H2: no hay resultados persistidos):

| Opción | En qué consiste | Coste | Riesgo |
| --- | --- | --- | --- |
| **A. Recalcular el histórico** | Recomputar y republicar rankings pasados | **No aplicable**: no existe tabla ni snapshot de resultados; sí existe la fuente (`gestion_orden`, `orden.asignado_at`), pero no hay dónde escribir ni qué comparar. Exigiría inventar persistencia = feature nueva, no `low` | Construir un almacén de rankings solo para justificar un recálculo |
| **B. Fecha de corte** (ventana vieja antes de X, nueva desde X) | Mantener las dos ventanas en el código, seleccionadas por fecha | Alto para lo que resuelve: el ranking **solo muestra «hoy»** (no acepta fecha; `/ranking` llama a `obtenerRankingAction()` sin argumentos), así que la rama «vieja» sería código muerto desde el día 1 | Dos verdades vivas en el mismo servicio: exactamente lo que esta feature viene a eliminar |
| **C. Discontinuidad declarada** (recomendada) | Aplicar la ventana nueva sin backfill, dejando escrito el día y la hora del corte | Bajo: 3 líneas de código + prosa | El día del despliegue, quien haya visto el ranking antes y después ve cifras distintas; las entregas de 18:00–24:00 CR del día anterior desaparecen del conteo de hoy |

**Recomendación del spec_author: C**, con dos condiciones que el humano debe ratificar:
(1) desplegar en franja de baja actividad —entre 00:00 y ~06:00 CR—, porque a esa hora la
diferencia entre ambas ventanas afecta al menor número de órdenes; (2) dejar la fecha/hora exacta
del corte anotada en `progress/current.md` y en la cabecera del servicio.

**Q2 — ¿Hay premios ya pagados sobre el podio de la ventana vieja, y qué se hace si el podio del día
del despliegue cambia de ocupantes al recalcularse?** El sistema **no registra ganadores ni pagos**:
`premio_ranking` guarda solo `posicion`/`monto`/`descripcion` (3 filas sembradas por migración) y no
hay ningún enlace a `wallet_movimiento`. El pago, por tanto, ocurre **fuera del sistema** y esta
decisión es operativa, no técnica.

**Q3 — ¿Se comunica el cambio a los mensajeros?** El ranking es reconocimiento público (feature 76,
podio top 3 + premios). Un mensajero que entregó a las 20:00 CR verá su entrega «moverse» de día.
No hay canal de anuncio en el alcance de esta ficha.

**Q4 — ¿Se anota la supersesión en `specs/76-ranking-mensajeros/`?** Su `requirements.md:40-41` y
`design.md:18-20` definen «Hoy(CR)» con `startOfDayCR + 24 h` como contrato. La propuesta del
spec_author es **añadir una nota de supersesión** (sin reescribir el histórico del spec); si el
humano prefiere no tocar specs cerrados, se omite y basta con la nota en esta feature.

---

## 6. Respuestas de la puerta humana — 2026-08-04

Registradas por el leader tras presentarle §5 con los hallazgos H1–H7. **No se reabren.**

| | Decisión | Consecuencia |
|---|---|---|
| **Q1** | **Opción C — discontinuidad declarada.** Ni recálculo ni fecha de corte. | La ficha **sigue siendo `low`** (H6). No hay backfill, no hay migración, no se inventa persistencia de rankings ni se parametriza por fecha un servicio que solo conoce «hoy». |
| **Q2** | **Desplegar de madrugada (00:00–06:00 CR) y nada más.** | A esa hora el podio del día está prácticamente vacío, así que **no hay ocupantes que desplazar** y no se toca ningún premio ya pagado. No se anota un podio previo ni se honra el viejo. |
| **Q3** | **Sí: se comunica a los mensajeros**, y queda escrito aquí como tarea de despliegue. | El envío lo hace el humano; la obligación de **no olvidarlo al mergear** es de esta feature. El mensaje debe decir lo único que el mensajero nota: una entrega hecha después de las 18:00 CR **ya no cuenta para el día anterior**, cuenta para el día en que ocurrió. |
| **Q4** | **Sí: nota de supersesión en los specs de la 76**, apendada. | En `specs/76-ranking-mensajeros/requirements.md:40-41` y `design.md:18-20`. **Apendar, no reescribir**: la 76 es `done` y aprobada, y su texto se conserva tal cual con la nota debajo. |

**Ventana de despliegue: obligatoria, no una preferencia.** Es lo que hace que Q2 sea inocuo. Si el
merge cae fuera de 00:00–06:00 CR, la premisa de «podio vacío» deja de sostenerse y hay que volver a
preguntar antes de desplegar.
