# Feature 148 — Manifiesto Excel por lote · bitácora del BACKEND_DEV

Rama `feature/148-manifiesto-excel-lotes`, worktree `../ordenex-wt-148`, base
`origin/dev` @ `55b0cd4` (+ `03bcf62`, el spec ya commiteado).

Alcance ejecutado: **T1, T2, T3, T4, T5, T6** (fases 0 y 1) + **T15, T16, T18** (tests).
Fuera de alcance y NO tocado: fase 2 (`lib/utils/xlsx-template.ts`,
`lib/utils/manifiesto-xlsx.ts`), fase 3 (`components/**`, `app/**`) y `tests/components/**`.

## Archivos

**Nuevos**
- `lib/types/manifiesto.ts` (T1) — `MANIFIESTO_FLUJOS`, `ManifiestoFilaDTO` (11 columnas),
  `ManifiestoOmitidaDTO`, `manifiestoSchema`, `ManifiestoInput`, `ManifiestoResult`.
- `lib/interfaces/services/IManifiestoService.ts` (T2) — `armar(input, actor)`.
- `lib/services/ManifiestoService.ts` (T5) — servicio único + `BODEGA_CENTRAL_FALLBACK`.
- `lib/actions/manifiesto.ts` (T6) — Server Action `obtenerManifiesto`.
- `tests/unit/services/manifiesto-service.test.ts` (T15, 32 tests).
- `tests/unit/repositories/orden-repository.manifiesto.test.ts` (T16, 11 tests).
- `tests/integration/actions/manifiesto-action.test.ts` (T18, 14 tests).

**Modificados**
- `lib/interfaces/repositories/IOrdenRepository.ts` (T3) — **estrictamente aditivo**:
  `ManifiestoOrdenRow` + `findManifiestoByIds` + `findManifiestoByRemisiones` +
  `findUsuarioNombre`. Ninguna firma existente cambió.
- `lib/repositories/OrdenRepository.ts` (T4) — `WITH_MANIFIESTO`, `toManifiestoOrdenRow`
  y los 3 métodos.
- 5 tests ajenos que declaran fakes **exhaustivos** de `IOrdenRepository`
  (`asignacion-mensajero-service`, `bulk-orden-service`, `bulk-orden-service.carga-api`,
  `orden-service`, `rol-admin-satelite-authz`): +3 stubs `vi.fn()` cada uno. Sin cambio de
  comportamiento; es el coste mecánico inevitable de ampliar la interfaz.

**NO tocado, como exige R27/D3**: `BulkOrdenService`, `GuiaAsignacionService`,
`AsignacionSateliteService`, `EnvioDevolucionCentralService`, `DevolucionOrigenService`,
`db/schema.prisma`, `db/migrations/**`. Cero migraciones, cero `down.sql`, cero RLS nueva.

## Decisiones de implementación

1. **`findUsuarioNombre` no estaba en `design.md §3`.** `Actor` solo lleva
   `{ usuarioId, rol }`, y R9/§9.8 exige el NOMBRE del usuario que ejecutó. Resolverlo en
   el borde metería Prisma dentro de la Server Action, así que se lee en el repositorio,
   con el precedente exacto de `findUsuarioFulfillment` / `findUsuarioZonaId` /
   `findUsuarioVehiculoId`, que ya viven en `IOrdenRepository`.
2. **Nombre de la zona central sin tocar `IZonaRepository`.** Se compone
   `findCentralZonaId()` + `findById(id, false).nombre`, inyectados como
   `Pick<IZonaRepository, "findCentralZonaId" | "findById">` (patrón `ZonaRepo` de
   `CorteDiarioService`/`CierreDiaService`). Sin zona central → literal `"Bodega central"`
   (§9.2): la descarga nunca falla ni deja la celda vacía.
3. **R24 blindado por tipos y verificado en ejecución.** Los repos entran al service como
   `Pick<>` de métodos `find*`, así que ni siquiera son alcanzables los de escritura; el
   test de R24 pasa además un `Proxy` que registra cualquier acceso fuera de los 3 métodos
   de lectura, en los 6 flujos.
4. **Vía por `num_remision` acotada siempre a `actor.usuarioId`** (R29), la misma
   acotación que `AsignacionMensajeroService.resumenCargaMasiva`. Es correcta porque la
   carga masiva vía sesión es exclusiva del `adminTienda` y su `tiendaId` ES su
   `usuarioId` (`BulkOrdenService.cargarMasiva:251-253`). Un actor de otro rol no alcanza
   remisiones ajenas: no encuentra ninguna y todas salen `omitidas`.
5. **`responsable` sin nombre resoluble → cadena vacía.** Si `findUsuarioNombre` devuelve
   `null` (usuario borrado entre la operación y la descarga) se emite `""` en vez de
   inventar un texto de rol, que §9.8 prohíbe explícitamente. Es un borde que no debería
   ocurrir con sesión válida; queda documentado como deuda menor abajo.

## Mapa R → test (los R de MI mitad)

| R | Test |
|---|---|
| R1 | `manifiesto-service.test.ts` › "arma las filas de los 6 flujos con el mismo servicio" + "la carga masiva usa el MISMO servicio por num_remision" |
| R2 | `manifiesto-service.test.ts` › "no expone ids internos ni campos fuera de las 11 columnas" (asserta las 11 claves EN ORDEN) |
| R3 | `manifiesto-service.test.ts` › "devuelve N filas para N ordenes validas, en el orden en que se pidieron" + "un id repetido no duplica la fila" |
| R4 | `orden-repository.manifiesto.test.ts` › "proyecta guia, remision, destinatario, telefono y direccion de la orden"; `manifiesto-service.test.ts` › "proyecta num_guia, num_remision, destinatario, telefono y direccion tal cual" |
| R5 | `manifiesto-service.test.ts` › "deja num_guia vacio cuando la orden aun no tiene guia"; repo › "sin guia y sin mensajero asignado -> null" |
| R6 | `manifiesto-service.test.ts` › "usa el nombre de la zona, no su id" |
| R7 | `manifiesto-service.test.ts` › "deja monto vacio cuando la orden no tiene monto de cobro" + "un monto de cero se emite como 0" + "propaga el monto de cobro al destinatario" |
| R8 | `manifiesto-service.test.ts` › los 8 casos de "R8/R9 — origen, destino y responsable por flujo" (uno por fila de `design.md §4`) + "sin zona central configurada, origen/destino caen al literal de respaldo" |
| R9 | `manifiesto-service.test.ts` › "responsable es el mensajero asignado cuando el flujo asigna mensajero" + "responsable es el nombre del usuario que ejecuto cuando no hay mensajero"; repo › "devuelve usuario.nombre por id" |
| R10 | `manifiesto-service.test.ts` › "fecha es la fecha calendario CR de la operacion" + "todas las filas del lote comparten la misma fecha" |
| R11 | `manifiesto-service.test.ts` › "no expone ids internos ni campos fuera de las 11 columnas"; repo › "la proyeccion NO pide deleted_at, notas, producto ni geografia" |
| R12 | `manifiesto-service.test.ts` › "omite las que no existen (o estan borradas) y NO aborta el lote" + "reporta la remision omitida con la referencia recibida"; repo › "excluye las ordenes borradas..." (x2) |
| R24 | `manifiesto-service.test.ts` › "no invoca ningun metodo de escritura del repositorio en ninguno de los 6 flujos"; `manifiesto-action.test.ts` › "no ejecuta ninguna mutacion" |
| R27 | Verificado por construcción y por la suite: los 5 servicios de negocio no aparecen en el diff y sus tests siguen verdes sin tocarlos. |
| R28 | `manifiesto-action.test.ts` › "devuelve unauthenticated y no consulta el service sin sesion" + "la sesion se exige ANTES de validar la entrada" |
| R29 | `manifiesto-service.test.ts` › los 5 tests de "aislamiento por dueño cuando el actor es una API key"; repo › "acota por tienda al buscar por num_remision" |
| R30 | `manifiesto-action.test.ts` › los 9 casos de "entrada invalida -> validation_error sin devolver datos" |

R13–R23, R25 y R26 son de las fases 2 y 3 (generación del `.xlsx`, botón compartido y
enganche en los 5 flujos): quedan para el `frontend_dev` (T7–T14, T17, T19–T21).

## Verificación ejecutable

Baseline medido en este worktree sobre `55b0cd4` **antes** de cualquier cambio
(typecheck y lint por mí; suite confirmada por el leader):

| | Baseline | Después de mi trabajo | Delta |
|---|---|---|---|
| `pnpm typecheck` | 0 errores | **0 errores** | 0 |
| `pnpm lint` | 145 problemas (0 errores, 145 warnings) | **145 problemas (0 errores, 145 warnings)** | 0 |
| `pnpm test --run` | 518 archivos / 5308 tests, 0 fallos | **521 archivos / 5365 tests, 0 fallos** (168.43 s) | +3 archivos / +57 tests, 0 regresiones |

5308 + 57 (32 + 11 + 14) = 5365 exacto: ningún test ajeno cambió de estado y no hay
warnings de lint nuevos.

## Deuda / puntos abiertos para el reviewer

1. **Fakes exhaustivos de `IOrdenRepository`.** Cinco suites declaran el repo como objeto
   literal completo, así que CUALQUIER método nuevo en la interfaz las rompe en typecheck.
   Se resolvió agregando stubs. No es deuda nueva de esta feature, pero conviene saber que
   el patrón `as unknown as IOrdenRepository` (el que usan `etiqueta-guia-service.test.ts`
   y `guia-asignacion-service.test.ts`) es el que no se rompe.
2. **`responsable` vacío** si `findUsuarioNombre` devuelve `null` (ver decisión 5). No se
   inventa texto porque §9.8 lo prohíbe; si el humano prefiere otro respaldo, es un cambio
   de una línea en `ManifiestoService.armar`.
3. **`design.md §4` afirma que `num_remision` es único por tienda**; en
   `db/schema.prisma:448` es `@unique` GLOBAL. No cambia nada del código (acotar por
   `tiendaId` sigue siendo lo correcto por R29), pero la afirmación del design es inexacta.
4. **Conflicto previsible con la feature 143** (`design.md §5`): afecta solo a
   `lib/utils/xlsx-template.ts`, que es fase 2 y NO está en mi diff.
