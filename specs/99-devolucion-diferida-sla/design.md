# Feature 99 — Design

> El CÓMO técnico. Zona: `backend`. Rama: `feature/99-devolucion-diferida-sla`.
> Regla de oro (CLAUDE.md #6): nada inventado. La §0 fija lo VERIFICADO en el código.

---

## §0. Hallazgos verificados en el código (fuente de verdad de este diseño)

### 0.1. El mecanismo REAL del dinero HOY (money-critical)
- `gestion_orden.ingreso_bodega_rechazo` (`Decimal(12,2)`, nullable) es un **snapshot POR
  GESTIÓN** (schema.prisma:436).
- Se **computa desde el `resultado` de la GESTIÓN**, no desde el estado de la orden:
  `ingresoBodegaPorResultado(resultado, tarifa)` (`lib/utils/ingreso-bodega.ts`) devuelve
  `cobroRechazado` SOLO si `resultado === "rechazada"` y `cobroRechazado > 0`; en cualquier otro
  caso `"0.00"`. `derivarIngresoBodega` (`lib/utils/cierre-totales.ts`) itera las gestiones y usa
  `g.resultado`.
- Se **snapshotea al crear el cierre**: `CierreDiaService.solicitarCierre` →
  `CierreDiaRepository.crearCierre` puebla `ingreso_bodega_rechazo` por gestión y
  `cierre_dia.total_ingreso_bodega_rechazos`, todo en la tx del cierre. La wallet lo realiza al
  APROBAR (`WalletFeedService.construirMovimientosDeIngreso` lee `gestion_orden` por `cierreId` +
  `cierre_detail`; también se ancla a `resultado`).
- **Conclusión money-critical:** la feature 47 escala `devuelta → rechazada` con una gestión cuyo
  `resultado` es `devuelta`. Por eso HOY esa orden produce `ingreso_bodega_rechazo = 0.00`: el
  snapshot existente **NO cubre** el rechazo por escalado. El cron de la 99 hereda ese hueco si no
  hace nada. Esto motiva **Option A** (§3.4).
- El propio código ya señala el riesgo inverso (contar de más → "escalar antes de tiempo y cobrar
  `cobroRechazado` mal"): `OrdenHistorialRepository.ts:87`, `IOrdenHistorialRepository.ts:68`.

### 0.2. El contador de intentos
- `OrdenHistorialService.contarIntentos(ordenId)` = `contarPorDestinoVigentes(ordenId, idDe(devuelta))`
  = conteo de transiciones VIGENTES cuyo destino es `devuelta` (excluye gestiones anuladas y
  huérfanas). DERIVADO del historial, sin columna. Alimenta a la vez la regla de reintento y la
  línea de tiempo "intento X de N".

### 0.3. La transición de seguimiento de la 47 (lo que se difiere)
- `MisAsignacionesService.gestionar` (rama `devuelta`) llama a `resolverSeguimientoDevuelta` y pasa
  `seguimiento` a `crearGestionYTransicionar`, que aplica una SEGUNDA `orden.update` +
  `appendCambioEstado` en la misma tx (`GestionOrdenRepository.ts:323-343`). Resultado:
  `intentoActual = contarIntentos + 1`; `>= umbral` → `rechazada` (conserva mensajero);
  `< umbral` → `en_bodega`/`en_bodega_satelite` (limpia mensajero). `origen_tipo` reutilizado =
  `gestion`.

### 0.4. El patrón de cron existente (a clonar)
- `app/api/cron/liberar-reprogramadas/route.ts` (Controller): Bearer `CRON_SECRET`
  (`loadCronConfig().CORTE_DIARIO_SECRET`) ANTES de efectos → 401; deps inyectables (`getSecret`,
  `service`, `now`); `withErrorHandler`; respuesta JSON de conteos sin PII.
- `LiberacionReprogramadaService.ejecutarLiberacion(hoyCR)` (Service): resuelve estatus una vez;
  candidatas del repo; resiliente por orden; idempotente por estado; logger de conteos sin PII.
- `LiberacionReprogramadaRepository`: `findOrdenesLiberables` lee orden + su última gestión
  (`take 1`, `orderBy createdAt desc`) y filtra en memoria por fecha; `liberarOrden` hace
  `updateMany` GUARDADO por `estatusId` (idempotencia) + `appendCambioEstado` DENTRO del `if
  (count > 0)`, en `$transaction`. `origen_tipo = liberacion_reprogramada`, actor `NULL`.
- `resolverDestinoCierre(zonaId, centralZonaId)` (`lib/utils/bodega-responsable.ts`) deriva
  central vs satélite; `IZonaRepository.findCentralZonaId`.

### 0.5. /novedades HOY
- `OrdenRepository.novedadWhere` (repo:1605): `tiendaId` + `deletedAt null` + `estatus.value notIn
  {entregada, devuelta_origen, recibido_origen}` + `gestiones.some({resultado: devuelta, anuladaAt:
  null})`. El comentario dice explícito: "no filtra por estatus actual = devuelta porque la 47 la
  saca de devuelta en la misma tx". Con la 99, la orden SÍ reposa en `devuelta` (§3.5).
- `findCausasDevueltaVigentes(ordenIds)` devuelve `Map<ordenId, {causa, fecha}>` de la última
  gestión `devuelta` vigente. **Ya provee el anclaje (causa + fecha) que necesita la ventana SLA.**

### 0.6. Catálogo / enums
- `ORDER_STATUS_SEED` (lib/types/order-status.ts) incluye `devuelta`, `en_bodega`,
  `en_bodega_satelite`, `rechazada`. La 99 NO agrega estados.
- `GestionCausaDevolucion` = {`not_found`, `wrong_number`, `wrong_address`} (schema:401).
- `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (lib/types/orden-historial.ts): 13 valores; la 99 agrega
  `liberacion_devuelta_sla` y `escalado_devuelta_sla` (§2).
- Migración enum: patrón `ALTER TYPE ... ADD VALUE IF NOT EXISTS` en su PROPIA migración (no en la
  que usa el valor); `down.sql` recrea el enum sin los valores (PG no soporta DROP VALUE). Ver
  `db/migrations/20260714160000_gestion_orden_anulacion` (agregó `deshacer_gestion`).

---

## §1. Modelo de datos

### 1.1. Sin columna nueva de anclaje (Q2 → derivar)
El anclaje de la ventana (causa + timestamp) se DERIVA de la última gestión `devuelta` vigente
(`gestion_orden.causa_devolucion` + `gestion_orden.created_at`, filtrando `anulada_at IS NULL`).
No se agrega `orden.devuelta_at`. Motivo: append-only (49/67), ya expuesto por
`findCausasDevueltaVigentes`, causa y timestamp co-atómicos, sin backfill.

### 1.2. Sin tabla nueva → sin RLS nueva
La 99 no crea tablas. La gestión sintética de rechazo (§3.4) reutiliza `gestion_orden`, que ya
tiene RLS habilitada (service-role only). Por tanto la migración es SOLO el enum de `origen_tipo`
+ su `down.sql`; no hay política RLS nueva que declarar.

### 1.3. Índices
El cron filtra `orden` por `estatus.value = devuelta`. Se apoya en el índice existente
`@@index([estatusId])` (mismo apoyo que usa la 46 para `reprogramada`). No se agrega índice nuevo
(el universo de órdenes en `devuelta` es acotado). Si en producción crece, un índice parcial es
un follow-up medible, no una decisión de esta feature.

### 1.4. Migración (única)
`db/migrations/<ts>_orden_historial_origen_tipo_sla_devuelta/`
- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
  'liberacion_devuelta_sla';` + `... ADD VALUE IF NOT EXISTS 'escalado_devuelta_sla';`
- `down.sql`: RENAME a `_old`, `CREATE TYPE` con los 13 valores previos, `ALTER TABLE
  orden_historial_estado ... TYPE ... USING (...::text::...)`, `DROP TYPE ..._old` (patrón exacto
  de `20260714160000_gestion_orden_anulacion/down.sql`).
- TS: agregar ambos valores a `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (el `satisfies` +
  `_EnsureExhaustive` rompen el build si el SEED y el enum divergen). NO agregar a
  `ORIGEN_TIPOS_CON_GESTION`: `liberacion_devuelta_sla` nunca enlaza gestión, y
  `escalado_devuelta_sla` transiciona a `rechazada` (no a `devuelta`), así que jamás entra al
  conteo de intentos — dejarlo fuera no altera `contarPorDestinoVigentes` (documentar).

---

## §2. Enum `origen_tipo` — dos valores nuevos
| Valor | Transición | Actor | `gestion_orden_id` |
| --- | --- | --- | --- |
| `liberacion_devuelta_sla` | `devuelta → en_bodega`/`en_bodega_satelite` (reintento, R15) | NULL | NULL |
| `escalado_devuelta_sla` | `devuelta → rechazada` (escalado, R16/R17) | NULL | id de la gestión sintética (§3.4) |

Dos valores (no uno) para que la línea de tiempo distinga liberación de escalado (trazabilidad).

---

## §3. Componentes (Controller → Service → Repository)

### 3.1. Cambio en `MisAsignacionesService.gestionar` (R1/R29)
- Eliminar el bloque `if (input.resultado === "devuelta") { resolverSeguimientoDevuelta ... }` y
  la llamada con `seguimiento`. La rama `devuelta` queda: subir evidencia (feature 75) → crear
  gestión con causa (73) → transicionar a `devuelta` (`nuevoEstatusId`), SIN seguimiento.
- Retirar `resolverSeguimientoDevuelta` y las deps que solo servían a esa rama si quedan sin uso
  (`historial.contarIntentos`, `zonaRepo.findCentralZonaId` en este service). La derivación de
  bodega responsable se MUEVE al servicio del cron (§3.3).
- `GestionOrdenRepository.crearGestionYTransicionar`: retirar el parámetro `seguimiento` y su
  bloque (código muerto tras la relocalización).

### 3.2. Controller — nuevo cron `app/api/cron/procesar-devueltas-sla/route.ts` (R10-R13)
Clon de `liberar-reprogramadas/route.ts`:
```
export interface ProcesarDevueltasSlaDeps {
  getSecret?: () => string | null;   // default loadCronConfig().CORTE_DIARIO_SECRET
  service?: IDevolucionSlaService;
  now?: () => Date;                  // reloj inyectable (R13)
}
```
- 401 si secreto ausente / no coincide, ANTES de construir el service (R10). Nunca loguea secreto
  ni PII (R11).
- `service.ejecutar(now())` → 200 con `{ evaluadas, liberadas, escaladas, omitidas }` (R12).
- `GET` exportado para Vercel Cron.

`vercel.json`: agregar `{ "path": "/api/cron/procesar-devueltas-sla", "schedule": "0 * * * *" }`
(horario, Q3). Reusa `CRON_SECRET` (mismo que corte-diario/liberar-reprogramadas).

### 3.3. Service — `DevolucionSlaService` (R14-R19)
Deps por interfaz (inyectables, testeable sin DB): repo del cron, `IZonaRepository.findCentralZonaId`,
`IOrdenRepository.findEstatusIdByValue`, `IOrdenHistorialService.contarIntentos`, logger de conteos.

`ejecutar(now: Date): Promise<{ evaluadas; liberadas; escaladas; omitidas }>`:
1. Resolver una sola vez los `estatus_id` de `devuelta`, `en_bodega`, `en_bodega_satelite`,
   `rechazada`. Si falta alguno → conteos en 0 + warn agregado (R27).
2. `centralZonaId = findCentralZonaId()`.
3. `candidatas = repo.findDevueltasSla()` → por cada orden en `devuelta` no borrada, su última
   gestión `devuelta` vigente: `{ ordenId, zonaId, gestionDevueltaId, mensajeroId, causa,
   ancladaAt }`. `causa === null` → omitir (R28).
4. Por orden (resiliente, try/catch → `omitidas` en fallo, R26):
   - `vencio = venceVentana(causa, ancladaAt, now)`: `not_found` → `now - ancladaAt >= 24h`;
     `wrong_*` → `now - ancladaAt >= 5*24h`. Si no venció → `evaluadas++`, continúa (R14/R13/R17
     ventana viva).
   - `wrong_*` vencido → `escalar(orden)` (R17).
   - `not_found` vencido → `intentos = contarIntentos(ordenId)` (YA incluye la devolución vigente,
     Q4): `intentos >= umbral` → `escalar` (R16); si no → `liberar(orden)` (R15).
5. Sumar `evaluadas/liberadas/escaladas/omitidas`. Warn agregado si `omitidas > 0`.

`liberar(orden)` → `destino = resolverDestinoCierre(zonaId, centralZonaId)` →
`repo.liberarDevueltaSla({ ordenId, destinoEstatusId, estatusDevueltaId })`.
`escalar(orden)` → `repo.escalarDevueltaSla({ ordenId, estatusDevueltaId, estatusRechazadaId,
mensajeroId, motivo })`.

`umbral = reintentosConfig.MIN_INTENTOS_ENTREGA` (R15/R16).

### 3.4. Repository — `DevolucionSlaRepository` (R18/R20-R25) — Option A del dinero
`findDevueltasSla()`: `orden.findMany({ where: { deletedAt: null, estatus: { value: "devuelta" }},
select: { id, zonaId, gestiones: { where: { resultado: "devuelta", anuladaAt: null }, orderBy:
{ createdAt: desc }, take: 1, select: { id, mensajeroId, causaDevolucion, createdAt }}}})`. Filtra
en memoria las que tienen gestión vigente (patrón `findOrdenesLiberables`).

`liberarDevueltaSla(input)` — `$transaction`:
```
updateMany({ where: { id, estatusId: estatusDevueltaId, deletedAt: null },
             data: { estatusId: destinoEstatusId, mensajeroAsignadoId: null, asignadoAt: null }})
if (count > 0) appendCambioEstado(tx, [{ ordenId, estatusOrigenId: estatusDevueltaId,
    estatusDestinoId: destinoEstatusId, actorUsuarioId: null, origenTipo: "liberacion_devuelta_sla" }])
return count > 0
```
Guarda por `estatusId = devuelta` → idempotencia/concurrencia (R24/R25). Limpia mensajero (R15).

`escalarDevueltaSla(input)` — `$transaction` (**Option A**, R20-R23):
```
updateMany({ where: { id, estatusId: estatusDevueltaId, deletedAt: null },
             data: { estatusId: estatusRechazadaId }})   // no toca mensajero (paridad rechazo 47)
if (count === 0) return false                            // ya salió de devuelta (R24/R25/R21)
gestionSintetica = gestionOrden.create({ data: {
    ordenId, mensajeroId,                                // R22: mensajero de la gestión devuelta
    resultado: "rechazada",                              // R20: dispara snapshot 56 + wallet 42/69
    motivo, cierreId: null, anuladaAt: null,             // entra al PRÓXIMO cierre (sin descuadre)
    causaDevolucion: null, evidenciaStoragePath: null }})
appendCambioEstado(tx, [{ ordenId, estatusOrigenId: estatusDevueltaId,
    estatusDestinoId: estatusRechazadaId, actorUsuarioId: null,
    origenTipo: "escalado_devuelta_sla", gestionOrdenId: gestionSintetica.id }])
return true
```
- **R20/R23:** el ingreso se registra reutilizando el snapshot existente: la gestión sintética
  `rechazada` (cierre_id NULL) será tomada por `findGestionesPendientes` del mensajero →
  `derivarIngresoBodega` snapshotea `cobroRechazado` en `crearCierre`. Cero código monetario nuevo,
  `Prisma.Decimal` intacto.
- **R21:** la gestión sintética SOLO se crea si el `updateMany` afectó 1 fila (dentro de la misma
  tx). Reejecución → orden ya no está en `devuelta` → count 0 → no crea gestión → no doble dinero.
- **R18:** ambas escrituras pasan por `appendCambioEstado` en su tx.

### 3.5. Reconciliación de /novedades (R7-R9, Q7)
`OrdenRepository.novedadWhere` pasa de "gestión devuelta vigente + estatus notIn cerrados" a
anclar al estado real:
```
{ tiendaId, deletedAt: null, estatus: { value: "devuelta" } }
```
`NovedadesService.ESTATUS_CERRADOS` deja de ser necesario para el filtro (solo `devuelta`
califica); se puede retirar del predicado. `findCausasDevueltaVigentes` se mantiene (causa +
recencia, R9). Efecto: al liberar/escalar (cron) o resolver (feature 100), la orden sale de
`devuelta` → sale de /novedades, sin doble conteo (R8).

---

## §4. Contratos I/O

### Cron `GET /api/cron/procesar-devueltas-sla`
- **Req:** header `Authorization: Bearer <CRON_SECRET>`. Sin body.
- **401:** `{ "error": "unauthorized" }` (secreto ausente/incorrecto/no configurado).
- **200:** `{ "evaluadas": n, "liberadas": n, "escaladas": n, "omitidas": n }` (sin PII).
- **Error interno:** forma común de `appErrorToResponse` (notificado por el logger, sin secreto).

### Interfaces nuevas
- `IDevolucionSlaService.ejecutar(now: Date)` → `{ evaluadas; liberadas; escaladas; omitidas }`.
- `IDevolucionSlaRepository`: `findDevueltasSla()`, `liberarDevueltaSla(input): Promise<boolean>`,
  `escalarDevueltaSla(input): Promise<boolean>`.

---

## §5. Alternativas descartadas (obligatorio)

1. **Dinero — Option B (escribir `ingreso_bodega_rechazo` sobre la gestión `devuelta` original).**
   DESCARTADA: la gestión `devuelta` que ancló la ventana casi siempre está ya cerrada
   (`cierre_id != NULL`) cuando el cron corre 24h/5d después → modificarla descuadra un cierre
   quizá ya aprobado (libro append-only). Además `derivarIngresoBodega` re-deriva desde `resultado`
   al cerrar y sobrescribiría el valor.

2. **Dinero — Option C (columna de dinero en `orden` + vía de wallet aparte para SLA).**
   DESCARTADA: crea una segunda vía monetaria fuera del snapshot de cierre; la feature 102 declara
   "reusa el snapshot de 56", no una vía nueva; mayor superficie money-critical sin beneficio.

3. **Anclaje — columna `orden.devuelta_at`.** DESCARTADA (Q2): dato redundante con backfill y
   riesgo de desincronización causa/timestamp; el historial/gestión ya lo proveen.

4. **Frecuencia — cron diario 00:00 CR.** DESCARTADA (Q3): alinea con corte-diario pero puede
   retrasar la acción hasta ~24h, desvirtuando la ventana de "24h". Se elige HORARIO con ventana
   rolling.

5. **Reutilizar `origen_tipo = gestion`/`liberacion_reprogramada` para el cron.** DESCARTADA:
   pierde trazabilidad (no distingue SLA de una gestión real ni de una reprogramación); dos
   valores propios son baratos (ALTER TYPE aditivo).

6. **/novedades — conservar el predicado por gestión y AÑADIR `estatus = devuelta`.** DESCARTADA
   (Q7): redundante; el anclaje al estado real basta y es la fuente única, evitando divergencias.

---

## §6. Trazabilidad R → test (resumen; detalle en tasks.md)
| R | Test (unit salvo nota) |
| --- | --- |
| R1/R29 | `mis-asignaciones-service` (invertido): devolver → orden en `devuelta`, sin seguimiento |
| R2/R3 | `orden-historial-service` / repo: `contarIntentos` cuenta la transición `devuelta` |
| R4 | `gestion-orden-repository`: INSERT persiste `causa_devolucion` |
| R5/R6 | `devolucion-sla-repository`: `findDevueltasSla` deriva causa + `ancladaAt`; `devolucion-sla-service`: `venceVentana` (24h / 5d rolling) |
| R7/R8/R9 | `orden-repository.novedades` (invertido) + `NovedadesService`: predicado `estatus = devuelta` |
| R10/R11/R12/R13 | `procesar-devueltas-sla-action`: 401 sin secreto; 200 conteos; reloj inyectado |
| R14/R15/R16 | `devolucion-sla-service`: not_found viva / reintento (<3) / escalado (>=3) |
| R17 | `devolucion-sla-service`: wrong_* → `rechazada` directo al vencer |
| R18/R19 | `devolucion-sla-repository`: `appendCambioEstado` con `origen_tipo` correctos, actor NULL |
| R20/R22/R23 [💰] | `devolucion-sla-repository`: escalar crea gestión sintética `rechazada` del mensajero; `cierre-totales`/`ingreso-bodega`: snapshot la cobra (integración cierre) |
| R21 [💰] | `devolucion-sla-repository`: 2.ª corrida no crea 2.ª gestión (count 0) |
| R24/R25 | `devolucion-sla-repository`: `updateMany` guardado por estado → false idempotente |
| R26 | `devolucion-sla-service`: una orden que lanza no aborta la corrida (omitida) |
| R27 | `devolucion-sla-service`: catálogo incompleto → conteos 0 + warn |
| R28 | `devolucion-sla-service`: causa null → omitida, sin ventana |
| R30 | suite 47 invertida (no aflojada) + aserciones de reintento/escalado en el cron |
| migración | `tests/integration/db`: enum tiene los 2 valores nuevos; `down.sql` reversible |

---

## SUPERADO POR LA FEATURE 239 — 2026-08-19

Dos decisiones de este documento quedan **superadas**. No se borran (este repo conserva las
decisiones revertidas con su fecha y su razón); se marcan.

**§1.1 «Sin columna nueva de anclaje (Q2 → derivar)»** y **§3.5**: el ancla dejó de derivarse del
`created_at` de la gestión. Desde la 239, una orden devuelta **no entra en `devuelta` al gestionar**
—entra en `devolucion_por_confirmar`— y **la aprobación del cierre es la transición**. El ancla es
esa transición, leída del historial (`origen_tipo = anclaje_devolucion`).

**El motivo no fue estético.** Anclar en la gestión mientras la visibilidad dependía de la
aprobación abría una ventana en la que el cron escalaba a `rechazada` **y cobraba** una orden que la
tienda nunca había podido ver. Medido en producción: el retraso gestión→aprobación tiene p90 de
22,1 h y máximo de 48,2 h, contra una ventana `not_found` de 24 h.

Spec: `specs/239-devolucion-espera-cierre/`.
