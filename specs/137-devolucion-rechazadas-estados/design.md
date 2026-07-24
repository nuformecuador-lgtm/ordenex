# Feature 137 — Diseño técnico

> Referencias de código real leídas: `lib/services/CierresAdminService.ts`,
> `lib/repositories/CierresAdminRepository.ts` (`resolverCierre` + bloque `liberacionSinGestionar`),
> `lib/utils/bodega-responsable.ts` (`resolverDestinoCierre`), `lib/types/order-status.ts`,
> `lib/services/DevolucionOrigenService.ts`, `lib/services/RecepcionOrigenService.ts`,
> `lib/services/DevolucionSlaService.ts` + `lib/repositories/DevolucionSlaRepository.ts`
> (`escalarDevueltaSla`: NO limpia `mensajero_asignado_id`, gestión sintética con `cierre_id=null`),
> `lib/repositories/registrar-cambio-estado.ts` (`appendCambioEstado`),
> `lib/services/RecepcionSateliteService.ts` (`listar`, scoping de `porDevolver`),
> `app/(app)/ordenes/page.tsx` (`EXCLUDE_POR_ROL`), `app/(app)/ordenes/_components/EstatusBadge.tsx`,
> `OrdenesTabs.tsx` (`accionesDe`/`accionesLote`), `DevolverATiendaModal.tsx`,
> `app/(app)/recepcion-satelite/page.tsx` + `RecepcionSateliteModule.tsx` (checkbox
> `SelectAllCheckbox` + `Checkbox` + `Set` de seleccionados, sección "Recibidas"),
> `db/migrations/20260722140000_order_status_sin_gestionar/*`,
> `db/migrations/20260722150000_orden_historial_origen_sin_gestionar/*`.

## §0. Dependencia con 135 y 136 (precondición de implementación)

- **135 (renombrado).** Antes de implementar la 137 debe estar mergeado: `recibido_origen →
  devuelta_a_tienda` (estado FINAL), `devuelta_origen → devolviendo_a_tienda`, `en_bodega →
  en_bodega_central`. Los servicios que la 137 repurposa/reusa (`DevolucionOrigenService`,
  `RecepcionOrigenService`) ya deben apuntar a esos destinos renombrados.
- **136 (recepción central).** Provee la recepción física en la bodega central (escaneo QR / input
  de guía por maestro/admin). La 137 la REUSA para `devolviendo_a_bodega_central →
  por_devolver_a_tienda` (§4.3). Contrato exacto = pregunta abierta #2.

## §1. Modelo de datos

No hay tablas nuevas. Todo el cambio es aditivo sobre catálogos/enum existentes y columnas ya
existentes de `orden` (`estatus_id`) y `orden_historial_estado`.

### 1.1 Catálogo `order_status` (+3 valores) — R1/R2

`order_status` es una TABLA de valores (no enum, desde `20260714123909`). Se agregan tres filas:
`por_devolver`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda`.

- **Fuente de verdad TS.** Añadir los 3 `value` a `ORDER_STATUS_SEED` en `lib/types/order-status.ts`.
  El seed idempotente (`seedOrderStatus`) hace upsert por `value`.
- **Migración UP** (patrón EXACTO de `20260722140000_order_status_sin_gestionar/migration.sql`):
  tres `INSERT ... SELECT gen_random_uuid()::text, '<value>' WHERE NOT EXISTS (...)`. Aditiva; no
  toca columnas ni RLS.
- **Migración DOWN** (patrón `.../down.sql`): `DELETE FROM order_status WHERE value IN (...) AND NOT
  EXISTS (orden que lo referencie) AND NOT EXISTS (historial que lo referencie)`.

`order_status` ya tiene su RLS de features previas; no se agrega RLS nueva (no hay tabla nueva).

### 1.2 Enum `orden_historial_origen_tipo` (+1 valor) — R3

Se agrega `devolucion_rechazada` para clasificar la transición disparada por la aprobación del
cierre (paralelo a `liberacion_sin_gestionar` de la 109). Va en migración PROPIA (Postgres no
permite USAR un valor de enum recién añadido en la misma transacción que lo añadió; el primer uso
ocurre en runtime al aprobar cierres). Patrón EXACTO de
`20260722150000_orden_historial_origen_sin_gestionar/*`:

- **UP:** `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'devolucion_rechazada';`
- **DOWN:** recrear el enum sin `devolucion_rechazada`. La "lista previa" del down debe reflejar el
  estado del enum inmediatamente ANTES de la 137, incluyendo valores que agreguen 135/136 —
  coordinar al escribir el down.

Las **cuatro transiciones de lote/recepción** (R13/R15/R17/R18) NO agregan valores de enum: reusan
`ajuste_estado`, como ya hacen `DevolucionOrigenService`/`RecepcionOrigenService` (comentario
explícito en `RecepcionOrigenService`: evitar `ADD VALUE` porque Postgres no admite `DROP VALUE`).

## §2. Disparo por aprobación del cierre (R5–R12)

Se EXTIENDE el mismo mecanismo que la 109 usa para liberar `sin_gestionar`, en el MISMO punto y la
MISMA transacción.

### 2.1 `CierresAdminService.aprobarCierre` (service)

Además de `liberacionSinGestionar`, se resuelve la config `devolucionRechazadas`:

```
const [ ..., rechazadaId, porDevolverId, porDevolverATiendaId ] = await Promise.all([
  ...,
  this.ordenRepo.findEstatusIdByValue("rechazada"),
  this.ordenRepo.findEstatusIdByValue("por_devolver"),
  this.ordenRepo.findEstatusIdByValue("por_devolver_a_tienda"),
]);
const devolucionRechazadas =
  rechazadaId !== null && porDevolverId !== null && porDevolverATiendaId !== null
    ? { rechazadaId, porDevolverId, porDevolverATiendaId, centralZonaId }  // centralZonaId ya resuelto
    : undefined; // catálogo incompleto (seed pendiente) -> no-op defensivo
```

Se pasa a `resolverCierre` SOLO en la rama `aprobado`. `rechazarCierre` NO la pasa (R10).

### 2.2 `CierresAdminRepository.resolverCierre` (repo, dentro de `$transaction`)

Dentro de `if (res.count === 1 && nuevoEstado === "aprobado")`, DESPUÉS de la liberación de
`sin_gestionar`, se añade un bloque `devolucionRechazadas` que reusa `cierre.mensajeroId`:

1. `orden.findMany({ where: { mensajeroAsignadoId: cierre.mensajeroId, estatusId: rechazadaId,
   deletedAt: null }, select: { id, zonaId } })`.
2. Agrupar por destino con `resolverDestinoCierre(zonaId, centralZonaId)`:
   `bodega_central → porDevolverATiendaId`; `bodega_satelite → porDevolverId`.
3. Por grupo: `updateMany({ where: { id: { in }, estatusId: rechazadaId, deletedAt: null },
   data: { estatusId: destinoId } })`. **NO** toca `mensajeroAsignadoId`, `asignadoAt` ni
   `prioridad` (R8; diferencia deliberada con `sin_gestionar`, que sí limpia mensajero + prioridad
   porque va a RE-reparto — aquí va a devolución, no se reasigna).
4. Solo las que transicionaron (`count > 0`): `appendCambioEstado(tx, ...)` con
   `estatusOrigenId = rechazadaId`, `estatusDestinoId = destinoId`,
   `actorUsuarioId = resueltoPor` (R11), `origenTipo = "devolucion_rechazada"`.

**Idempotencia (R7):** la guarda `estatusId = rechazadaId` en el `WHERE` del `updateMany` (R22); una
segunda aprobación encuentra 0 filas. **Atomicidad (R6):** todo dentro de la misma `$transaction`.
**Cobertura de escalados SLA (R12):** `escalarDevueltaSla` (99) NO limpia `mensajero_asignado_id`
(paridad con rechazo directo 47/48) y crea la gestión sintética con `cierre_id = null` ("entra al
próximo cierre"); por tanto una `rechazada` de origen SLA queda con su mensajero y la recoge este
mismo `findMany` cuando ese mensajero cierra y su cierre se aprueba. No hace falta tocar
`DevolucionSlaService`.

### 2.3 Interfaces afectadas

- `lib/interfaces/repositories/ICierresAdminRepository.ts`: `ResolverCierreInput` gana el campo
  opcional `devolucionRechazadas?: { rechazadaId; porDevolverId; porDevolverATiendaId; centralZonaId }`.
- `CierresAdminPrismaClient` ya incluye `orden` (reuso directo de la liberación 109).

## §3. Retiro de la salida manual directa de `rechazada` (R9)

Hoy `DevolucionOrigenService.devolverATienda` hace `rechazada → devuelta_origen`, con dos
superficies: la tab `rechazada` de `OrdenesTabs` (`DevolverATiendaModal`, maestro) y la sección
"Por devolver a tienda" del `RecepcionSateliteModule` (per-fila `FilaPorDevolver`, adminSatelite).
Con la 137 la ÚNICA salida de `rechazada` es la aprobación del cierre (R9). Por tanto:

- Se **retira** la acción manual desde `rechazada` en AMBAS superficies.
- La acción "enviar a la tienda" se corre una etapa más adelante, a `por_devolver_a_tienda` (§4.4).

## §4. Transiciones del flujo

Todas siguen el patrón existente: service puro (guarda de estado + autz), `updateMany` guardado por
`WHERE estatus_id = origen` (R22), `appendCambioEstado` (`ajuste_estado`, R23) en la misma tx.

### 4.1 ENVÍO satélite `por_devolver → devolviendo_a_bodega_central` — R13/R14 (nuevo service, LOTE)

- **Service nuevo:** `lib/services/EnvioDevolucionCentralService.ts`
  (`enviarACentral(ordenId, actor)`), molde de `DevolucionOrigenService`.
- **Guarda de estado:** origen `por_devolver`; idempotente si ya en `devolviendo_a_bodega_central`;
  otro estado → `conflict`.
- **Autz (R14):** adminSatelite cuya `findUsuarioZonaId(actor)` coincide con `orden.zonaId` (molde
  `esBodegaResponsable`, rama satélite). Cualquier otro → `forbidden`.
- **Persistencia:** `OrdenRepository.update(ordenId, { estatusId: destinoId }, { actorUsuarioId,
  origenTipo: "ajuste_estado" })` (choke point 49), destino `devolviendo_a_bodega_central`.
- **Borde:** Server Action `lib/actions/envio-devolucion-central.ts` (zod `{ ordenId: uuid }`),
  espejo de `lib/actions/devolucion-origen.ts`.
- **LOTE en UI:** el `RecepcionSateliteModule` reutiliza su checkbox existente (`SelectAllCheckbox` +
  `Checkbox` + `Set` de seleccionados, hoy en la sección "Recibidas") con un `Set` de selección
  propio para la sección "Por devolver", y un botón "Enviar a central" que hace loop
  `enviarACentral({ ordenId })` sobre la selección (patrón `DevolverATiendaModal`, que ya itera
  `await` por orden). NO se inventa mecanismo nuevo.

### 4.3 RECEPCIÓN central `devolviendo_a_bodega_central → por_devolver_a_tienda` — R17 (reusa 136)

- La recepción central de la **136** (escaneo QR / input de guía en central por maestro/admin) es el
  disparador. La 137 registra/gobierna el par `devolviendo_a_bodega_central → por_devolver_a_tienda`
  en ese mecanismo. Guarda de estado `devolviendo_a_bodega_central` (R22); idempotente si ya en
  `por_devolver_a_tienda`. Autz maestro/admin (central).
- Contrato exacto sujeto a la 136 (pregunta abierta #2).

### 4.4 ENVÍO central `por_devolver_a_tienda → devolviendo_a_tienda` — R15/R16 (repurposa DevolucionOrigenService, LOTE)

- **Repurpose de `DevolucionOrigenService`:** cambiar la constante de ORIGEN de `rechazada` a
  `por_devolver_a_tienda`; el destino ya es `devolviendo_a_tienda` por 135.
- **Autz (R16):** maestro/admin (central). `por_devolver_a_tienda` es, por construcción, un estado
  siempre físicamente en la central (las satélite llegan solo tras la recepción central §4.3), así
  que la autz NO usa `esBodegaResponsable` por-zona (daría el actor equivocado para una orden de
  zona satélite ya recibida en central). Se sustituye por check central directo
  (`rol === "maestro" || rol === "admin"`).
- Guarda de estado `por_devolver_a_tienda` (R22); idempotente si ya `devolviendo_a_tienda`.
- **LOTE en UI:** reusar el checkbox de `OrdenesTabs.accionesLote` (maestro/admin). En `accionesDe`,
  la tab `por_devolver_a_tienda` ofrece la acción "Enviar a la tienda" que abre el
  `DevolverATiendaModal` (relabelado) y hace loop sobre la selección con la Server Action existente
  `devolverATienda` (mismo input `{ ordenId }`).
- El borde `lib/actions/devolucion-origen.ts` y su schema se conservan (input `{ ordenId }`); cambia
  la semántica del origen. Actualizar doc-comments y tests.

### 4.5 RECEPCIÓN tienda `devolviendo_a_tienda → devuelta_a_tienda` — R18 (reusa flujo existente)

- `RecepcionOrigenService.recibirEnOrigen` (QR/guía de la tienda) YA hace este salto: sus constantes
  origen/destino pasan a `devolviendo_a_tienda`/`devuelta_a_tienda` por el renombrado de la 135. La
  137 NO agrega lógica de transición aquí; solo verifica el último tramo con los nombres nuevos y
  que la entrada de UI de la tienda (escáner existente) sigue apuntando bien.

## §5. Frontend

### 5.1 Etiquetas — R4

`EstatusBadge.tsx`: agregar a `ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT` y (opcional)
`ORDER_STATUS_CLASS` los tres valores:

- `por_devolver` → "Por devolver" · variant `warning`.
- `devolviendo_a_bodega_central` → "Devolviendo a bodega central" · variant `info`.
- `por_devolver_a_tienda` → "Por devolver a tienda" · variant `warning`.

(`devuelta_a_tienda` y `devolviendo_a_tienda` son etiquetas de la 135, no de la 137.)

### 5.2 Envíos por lote (reuso del checkbox existente)

- **Central (maestro/admin) — `OrdenesTabs.accionesDe`:**
  - `rechazada`: RETIRAR la acción "Devolver a la tienda" (R9). Queda tab de espera pasiva.
  - `por_devolver_a_tienda`: AÑADIR acción "Enviar a la tienda" (reusa `DevolverATiendaModal`
    relabelado + `devolverATienda`).
- **Satélite (adminSatelite) — `RecepcionSateliteModule`:** convertir la sección "Por devolver" de
  cards per-fila (`FilaPorDevolver` + `devolverATienda`) a una `DataTable` seleccionable (mismo
  patrón que "Recibidas": `SelectAllCheckbox` + `Checkbox` + `Set` propio) con botón "Enviar a
  central" → loop `enviarACentral`. Eliminar `FilaPorDevolver` y el uso de `devolverATienda` aquí.

### 5.3 Visibilidad (integrada) — R19/R20/R21

- **Central (maestro/admin), R19:** `OrdenesTabs` deriva las tabs del catálogo menos `exclude`;
  `EXCLUDE_POR_ROL[maestro|admin] = ["pendiente"]`, así que los 4 estados del flujo **auto-aparecen**
  como tabs sin cambio de config. Solo verificar. Archivos: `app/(app)/ordenes/page.tsx`,
  `OrdenesTabs.tsx`.
- **Tienda (adminTienda), R20:** `EXCLUDE_POR_ROL[adminTienda]` hoy es
  `["pendiente","devuelta","en_bodega","en_bodega_satelite","en_ruta_bodega_satelite"]`. Los estados
  del tramo tienda (`por_devolver_a_tienda`, `devolviendo_a_tienda`, `devuelta_a_tienda`) NO están
  excluidos → **auto-aparecen**. Nota de coordinación 135: `"en_bodega"` de esa lista pasa a
  `"en_bodega_central"` con el renombrado (ajuste que introduce/culmina la 135). Verificar que los 4
  estados del flujo no queden excluidos para la tienda. Archivo: `app/(app)/ordenes/page.tsx`.
- **Satélite (adminSatelite), R21:** `/recepcion-satelite` NO es catálogo-driven; sus secciones son
  explícitas. Cambios:
  - `RecepcionSateliteService.listar` hoy clasifica `porDevolver` = órdenes en `rechazada` de la
    zona (línea con `ESTADO_RECHAZADA`). Cambiar el scope a `por_devolver` y AÑADIR un grupo
    `enTransitoACentral` = órdenes en `devolviendo_a_bodega_central` de la zona (informativo).
    Archivos: `lib/services/RecepcionSateliteService.ts` + su repositorio (la query que lista las
    órdenes de la zona por estado) + la interfaz del DTO de la acción.
  - `RecepcionSateliteModule` + `page.tsx`: la sección "Por devolver" pasa a accionable-por-lote
    (§5.2) sobre `por_devolver`; añadir una sección informativa (read-only) para
    `devolviendo_a_bodega_central`.

## §6. Alternativa descartada

**Coexistencia: mantener `DevolucionOrigenService` con su salida directa `rechazada →
devolviendo_a_tienda` Y añadir el flujo centralizado en paralelo.**

Descartada porque crea DOS salidas de `rechazada` que compiten: la manual (botón/lote, en cualquier
momento) y la del cierre (aprobación). Consecuencias:

1. **Carrera y doble manejo:** un admin podría devolver manualmente una `rechazada` antes de aprobar
   el cierre, y luego la aprobación intentaría re-devolverla; habría que blindar ambas rutas contra
   la otra, duplicando guardas.
2. **Rompe la regla de negocio:** las devoluciones satélite deben pasar SIEMPRE por la central. La
   salida directa de una orden satélite se saltaría el tramo central (`por_devolver →
   devolviendo_a_bodega_central → recepción central`), que es el objetivo de la feature.
3. **Ambigüedad de estado:** `rechazada` tendría dos significados operativos simultáneos, imposible
   de reflejar de forma testeable.

Por eso se **reemplaza** (R9): la única salida de `rechazada` es la aprobación del cierre, y la
acción manual de envío se corre a `por_devolver` (satélite) / `por_devolver_a_tienda` (central). El
costo asumido —repurposar un service `done` y actualizar sus tests— es preferible a sostener dos
flujos en conflicto.

## §7. Verificación (resumen)

- Unit (services): guarda de estado, autz por rol/zona, idempotencia y `conflict` de cada transición
  nueva/repurposada, con dobles sin DB.
- Unit (repo, `resolverCierre`): con dobles/tx fake, ruteo `rechazada → por_devolver /
  por_devolver_a_tienda` por zona, append `devolucion_rechazada`, no-mutación de
  mensajero/prioridad, idempotencia, y que un `rechazado` de cierre no dispara nada.
- Unit/UI (visibilidad): las tabs de central/tienda incluyen los estados esperados; la acción de
  lote satélite opera sobre la selección; el scope satélite lista `por_devolver` /
  `devolviendo_a_bodega_central`.
- Integración: aprobación de un cierre con rechazadas mixtas (central + satélite) → estados
  correctos + historial; recorrido completo por-orden hasta `devuelta_a_tienda`.
- `./init.sh` + suite en verde (regla 5 del arnés). Migraciones con `down.sql` probadas por
  `db:rollback`.
