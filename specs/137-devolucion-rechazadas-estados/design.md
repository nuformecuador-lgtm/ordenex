# Feature 137 — Diseño técnico

> Referencias de código real leídas: `lib/services/CierresAdminService.ts`,
> `lib/repositories/CierresAdminRepository.ts` (`resolverCierre` + bloque `liberacionSinGestionar`),
> `lib/utils/bodega-responsable.ts` (`resolverDestinoCierre`), `lib/types/order-status.ts`,
> `lib/services/DevolucionOrigenService.ts`, `lib/services/RecepcionOrigenService.ts`,
> `lib/services/DevolucionSlaService.ts` + `lib/repositories/DevolucionSlaRepository.ts`,
> `lib/repositories/registrar-cambio-estado.ts` (`appendCambioEstado`),
> `app/(app)/ordenes/_components/EstatusBadge.tsx`, `OrdenesTabs.tsx`, `DevolverATiendaModal.tsx`,
> `db/migrations/20260722140000_order_status_sin_gestionar/*`,
> `db/migrations/20260722150000_orden_historial_origen_sin_gestionar/*`.

## §0. Dependencia con 135 y 136 (precondición de implementación)

- **135 (renombrado).** La 137 diseña con los nombres NUEVOS. Antes de implementar la 137 debe
  estar mergeado el renombrado de la 135: `recibido_origen → en_tienda`,
  `devuelta_origen → devolviendo_a_tienda`, `en_bodega → en_bodega_central`. Los servicios
  existentes que la 137 repurposa/reusa (`DevolucionOrigenService`, `RecepcionOrigenService`) ya
  deben referirse a los destinos renombrados. Si la 137 se implementa antes que la 135, sustituir
  mentalmente los literales por los viejos, pero el orden correcto es 135 → 136 → 137.
- **136 (recepción central).** Provee el mecanismo de recepción física en la bodega central
  (escaneo QR por maestro/admin). La 137 lo REUSA para la transición
  `en_ruta_devolucion_central → por_devolver_a_tienda` (ver §4.3). El contrato exacto de reuso es
  pregunta abierta #3 de `requirements.md`.

## §1. Modelo de datos

No hay tablas nuevas. Todo el cambio es aditivo sobre catálogos/enum existentes y sobre columnas ya
existentes de `orden` (`estatus_id`) y `orden_historial_estado`.

### 1.1 Catálogo `order_status` (+3 valores) — R1/R2

`order_status` es una TABLA de valores (no enum, desde `20260714123909`). Se agregan tres filas.

- **Fuente de verdad TS.** Añadir a `ORDER_STATUS_SEED` en `lib/types/order-status.ts`:
  `por_devolver`, `en_ruta_devolucion_central`, `por_devolver_a_tienda`. El seed idempotente
  (`seedOrderStatus`) hace upsert por `value`.
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
- **DOWN:** recrear el enum sin `devolucion_rechazada` (rename a `_old` → `CREATE TYPE` con la lista
  previa → `ALTER TABLE ... USING` → `DROP TYPE _old`). **Ojo:** la "lista previa" debe reflejar el
  estado del enum inmediatamente ANTES de la 137, incluyendo cualquier valor que agreguen 135/136.
  Coordinar con esas migraciones al escribir el down.

Las **cuatro transiciones manuales** (R13/R15/R17/R19) NO agregan valores de enum: reusan
`ajuste_estado`, como ya hacen `DevolucionOrigenService` y `RecepcionOrigenService` (comentario
explícito en `RecepcionOrigenService`: evitar `ADD VALUE` porque Postgres no admite `DROP VALUE`).

## §2. Disparo por aprobación del cierre (R5–R11)

Se EXTIENDE el mismo mecanismo que la 109 usa para liberar `sin_gestionar`, en el MISMO punto y la
MISMA transacción.

### 2.1 `CierresAdminService.aprobarCierre` (service)

Hoy resuelve `liberacionSinGestionar` (estatus destino por zona + `centralZonaId`) y lo pasa a
`resolverCierre`. Se añade en paralelo la config `devolucionRechazadas`:

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

Se pasa `devolucionRechazadas` a `resolverCierre` SOLO en la rama `aprobado` (igual que
`liberacionSinGestionar`). En `rechazarCierre` NO se pasa (R10).

### 2.2 `CierresAdminRepository.resolverCierre` (repo, dentro de `$transaction`)

Dentro del bloque `if (res.count === 1 && nuevoEstado === "aprobado")`, DESPUÉS de la liberación de
`sin_gestionar`, se añade un bloque `devolucionRechazadas` que reusa el `cierre.mensajeroId` ya
leído:

1. `orden.findMany({ where: { mensajeroAsignadoId: cierre.mensajeroId, estatusId: rechazadaId,
   deletedAt: null }, select: { id, zonaId } })`.
2. Agrupar por destino con `resolverDestinoCierre(zonaId, centralZonaId)`:
   `bodega_central → porDevolverATiendaId`; `bodega_satelite → porDevolverId`.
3. Por cada grupo: `updateMany({ where: { id: { in }, estatusId: rechazadaId, deletedAt: null },
   data: { estatusId: destinoId } })`. **NO** toca `mensajeroAsignadoId`, `asignadoAt` ni
   `prioridad` (R8; diferencia deliberada con `sin_gestionar`, que sí limpia mensajero + prioridad
   porque va a RE-reparto — aquí va a devolución, no se reasigna).
4. Solo para las que transicionaron (`count > 0`): `appendCambioEstado(tx, ...)` con
   `estatusOrigenId = rechazadaId`, `estatusDestinoId = destinoId`,
   `actorUsuarioId = resueltoPor` (el admin, R11), `origenTipo = "devolucion_rechazada"`.

**Idempotencia (R7):** la guarda `estatusId = rechazadaId` en el `WHERE` del `updateMany` (R20);
una segunda aprobación encuentra 0 filas → no-op. **Atomicidad (R6):** todo dentro de la misma
`$transaction` que la transición del cierre y los feeds de wallet; un fallo hace rollback total.
**Cobertura de escalados SLA (R12):** el `escalarDevueltaSla` (99) NO limpia `mensajero_asignado_id`
(paridad con rechazo directo 47/48) y crea la gestión sintética con `cierre_id = null` ("entra al
próximo cierre"); por tanto una `rechazada` de origen SLA queda con su mensajero y es recogida por
este mismo `findMany` cuando ese mensajero cierra y su cierre se aprueba. No hace falta tocar
`DevolucionSlaService`.

### 2.3 Interfaces afectadas

- `lib/interfaces/repositories/ICierresAdminRepository.ts`: `ResolverCierreInput` gana el campo
  opcional `devolucionRechazadas?: { rechazadaId; porDevolverId; porDevolverATiendaId; centralZonaId }`.
- `CierresAdminPrismaClient` ya incluye `orden` vía la liberación de la 109 (reuso directo).

## §3. Retiro de la salida manual directa de `rechazada` (R9)

Hoy `DevolucionOrigenService.devolverATienda` transiciona `rechazada → devuelta_origen` y el botón
"Devolver a la tienda" vive en la tab `rechazada` de `OrdenesTabs`. Con la 137, la ÚNICA salida de
`rechazada` es la aprobación del cierre (R9). Por tanto:

- Se **repurposa** `DevolucionOrigenService` para el paso 3 del flujo (ver §4.4):
  origen `rechazada → por_devolver_a_tienda`, destino ya renombrado por 135
  (`devolviendo_a_tienda`), y autz simplificada a maestro/admin (central).
- Se **retira** de la tab `rechazada` la acción "Devolver a la tienda" (`DevolverATiendaModal`); la
  tab `rechazada` queda como estado de espera pasivo (sale por cierre).

## §4. Transiciones manuales del flujo

Todas siguen el patrón existente: service puro (guarda de estado + autz), `updateMany` guardado por
`WHERE estatus_id = origen` (R20), `appendCambioEstado` (`ajuste_estado`, R21) en la misma tx.

### 4.1 `por_devolver → en_ruta_devolucion_central` — R13/R14 (nuevo service)

- **Service nuevo:** `lib/services/EnvioDevolucionCentralService.ts`
  (`enviarACentral(ordenId, actor)`), molde de `DevolucionOrigenService`.
- **Guarda de estado:** origen `por_devolver`; idempotente si ya en `en_ruta_devolucion_central`;
  otro estado → `conflict`.
- **Autz (R14):** adminSatelite cuya `findUsuarioZonaId(actor)` coincide con `orden.zonaId`. Reusa
  el molde `esBodegaResponsable` (rama satélite). Cualquier otro → `forbidden`.
- **Persistencia:** `OrdenRepository.update(ordenId, { estatusId: destinoId }, { actorUsuarioId,
  origenTipo: "ajuste_estado" })` (choke point 49), destino `en_ruta_devolucion_central`.
- **Borde:** Server Action `lib/actions/envio-devolucion-central.ts` (zod `{ ordenId: uuid }`),
  espejo de `lib/actions/devolucion-origen.ts`.

### 4.2 (no aplica — hueco intencional para mantener numeración con el diagrama)

### 4.3 `en_ruta_devolucion_central → por_devolver_a_tienda` — R15/R16 (reusa 136)

- La recepción central de la **136** (escaneo QR en central por maestro/admin) es el disparador. La
  137 registra/gobierna el par origen→destino `en_ruta_devolucion_central → por_devolver_a_tienda`
  en ese mecanismo. Guarda de estado `en_ruta_devolucion_central` (R20); idempotente si ya en
  `por_devolver_a_tienda` (R16). Autz maestro/admin (central).
- Contrato exacto sujeto a la 136 (pregunta abierta #3). Si la 136 expone su recepción con un mapa
  de transiciones válido, la 137 solo añade la entrada; si no, se coordina una extensión mínima.

### 4.4 `por_devolver_a_tienda → devolviendo_a_tienda` — R17/R18 (repurposa DevolucionOrigenService)

- **Repurpose de `DevolucionOrigenService`:** cambiar la constante de ORIGEN de `rechazada` a
  `por_devolver_a_tienda`; el destino ya es `devolviendo_a_tienda` por 135.
- **Autz (R18):** maestro/admin (central). `por_devolver_a_tienda` es, por construcción, un estado
  siempre físicamente en la central (las satélite llegan solo tras la recepción central §4.3), así
  que la autz NO usa `esBodegaResponsable` por-zona (daría el actor equivocado para una orden de
  zona satélite ya recibida en central). Se sustituye por un check central directo
  (`rol === "maestro" || rol === "admin"`).
- Guarda de estado `por_devolver_a_tienda` (R20); idempotente si ya `devolviendo_a_tienda`.
- El borde `lib/actions/devolucion-origen.ts` y su schema se conservan (el input sigue siendo
  `{ ordenId }`); cambia la semántica del origen. Actualizar doc-comments y tests.

### 4.5 `devolviendo_a_tienda → en_tienda` — R19 (reusa flujo existente, sin cambios de transición)

- `RecepcionOrigenService.recibirEnOrigen` (QR de la tienda) YA hace este salto: sus constantes
  origen/destino pasan a `devolviendo_a_tienda`/`en_tienda` por el renombrado de la 135. La 137 NO
  agrega lógica de transición aquí; solo verifica que el último tramo funciona con los nombres
  nuevos y que la tab/entrada de UI de la tienda sigue apuntando al escáner existente.

## §5. Frontend

- **`EstatusBadge.tsx` (R4):** agregar a `ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT` y (opcional)
  `ORDER_STATUS_CLASS` los tres valores. Propuesta:
  - `por_devolver` → "Por devolver" · variant `warning`.
  - `en_ruta_devolucion_central` → "Devolviendo a B. Central" · variant `info`.
  - `por_devolver_a_tienda` → "Por devolver a tienda" · variant `warning`.
  (Textos a confirmar, pregunta abierta #1.)
- **`OrdenesTabs.accionesDe` (maestro/admin):**
  - `rechazada`: RETIRAR la acción "Devolver a la tienda" (R9).
  - `por_devolver_a_tienda`: AÑADIR acción "Enviar a la tienda" que abre el modal repurposado
    (§4.4). Reusa `DevolverATiendaModal` (renombrar label/textos a "Enviar a la tienda") apuntando
    a la Server Action existente.
- **Superficie del adminSatelite (R13, pregunta abierta #2):** montar en `/recepcion-satelite`
  (`RecepcionSateliteModule`) un listado/acción de las órdenes en `por_devolver` de su zona con el
  botón "Enviar a central" → Server Action `enviarACentral`. (Se elige esa superficie porque
  `accionesLote` de `OrdenesTabs` es maestro-only.)
- **Recepción central (136):** la página/escáner central de la 136 gana la fila del par de estados
  §4.3; la 137 no crea página nueva.
- **Recepción tienda (existente):** sin cambios de UI más allá del renombrado 135.

## §6. Alternativa descartada

**Coexistencia: mantener `DevolucionOrigenService` con su salida directa `rechazada →
devolviendo_a_tienda` Y añadir el flujo centralizado en paralelo.**

Descartada porque crea DOS salidas de `rechazada` que compiten: la manual (botón, en cualquier
momento) y la del cierre (aprobación). Consecuencias:

1. **Carrera y doble manejo:** un admin podría devolver manualmente una `rechazada` a la tienda
   antes de aprobar el cierre, y luego la aprobación intentaría re-devolverla; habría que blindar
   ambas rutas contra la otra, duplicando guardas.
2. **Rompe la regla de negocio:** las devoluciones satélite deben pasar SIEMPRE por la central. La
   salida directa `rechazada → devolviendo_a_tienda` de una orden satélite se saltaría el tramo
   central (`por_devolver → en_ruta_devolucion_central → recepción central`), que es justamente el
   objetivo de la feature.
3. **Ambigüedad de estado:** `rechazada` tendría dos significados operativos simultáneos ("lista
   para devolver manual" y "esperando aprobación de cierre"), imposible de reflejar de forma
   testeable.

Por eso se elige **reemplazar** (R9): la única salida de `rechazada` es la aprobación del cierre, y
la acción manual "enviar a la tienda" se corre una etapa más adelante, sobre `por_devolver_a_tienda`
(§4.4). El costo asumido —repurposar un service `done` y actualizar sus tests— es preferible a
sostener dos flujos en conflicto.

## §7. Verificación (resumen)

- Unit (services): guarda de estado, autz por rol/zona, idempotencia y `conflict` de cada
  transición nueva/repurposada, con dobles sin DB.
- Unit (repo, `resolverCierre`): con dobles/tx fake, verificar el ruteo `rechazada → por_devolver /
  por_devolver_a_tienda` por zona, el append `devolucion_rechazada`, la no-mutación de
  mensajero/prioridad, la idempotencia y que un `rechazado` de cierre no dispara nada.
- Integración: aprobación de un cierre con rechazadas mixtas (central + satélite) → estados
  correctos + historial; recorrido completo por-orden hasta `en_tienda`.
- `./init.sh` + suite en verde (regla 5 del arnés). Migraciones con `down.sql` probadas por
  `db:rollback`.
