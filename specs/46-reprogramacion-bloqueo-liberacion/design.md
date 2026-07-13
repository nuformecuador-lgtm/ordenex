# Feature 46 — Reprogramación: bloqueo y liberación programada — design.md

> Decisiones técnicas para implementar `requirements.md`. Reutiliza al máximo la
> infra existente (features 36/41/30/33/54). Las decisiones marcadas *(F1.4-x)*
> dependen de la respuesta a la pregunta abierta correspondiente; aquí se documenta
> el camino recomendado.

## 1. Modelo de datos

### 1.1 Marca de liberación (única migración)

Se añade UNA columna a `orden` (no hay tabla nueva → no hay RLS nueva; la RLS de
`orden` no cambia):

```prisma
// model Orden (db/schema.prisma) — feature 46
liberadaReprogramadaAt DateTime? @map("liberada_reprogramada_at") // NULL = nunca liberada por reprogramación
```

- **Propósito:** marcador de auditoría + fuente del aviso derivado (R15/R18).
  NO es el mecanismo de idempotencia (eso lo da la transición de estatus, §4).
- **Índice:** parcial para la ruta del aviso (bodega consulta "liberadas hoy"):
  `CREATE INDEX orden_liberada_reprogramada_at_idx ON orden (liberada_reprogramada_at) WHERE liberada_reprogramada_at IS NOT NULL;`
  (índice parcial va a mano en `migration.sql`; Prisma no lo expresa — patrón ya
  usado en `wallet_movimiento`/`cierre_bodega`).
- **Migración:** `db/migrations/<ts>_orden_liberada_reprogramada_at/` con
  `migration.sql` (ADD COLUMN + CREATE INDEX) y `down.sql` (DROP INDEX + DROP COLUMN).
  Round-trip obligatorio (R18, `pnpm run db:rollback`).

### 1.2 Lo que NO se toca / NO se crea

- No se añade columna de idempotencia tipo "liberada" booleana: es redundante con el
  estatus (§4) y con `liberada_reprogramada_at`.
- No se crea tabla de notificaciones (F1.4-d, aviso derivado).
- No se crea `order_status` nuevo: la liberación reutiliza `en_bodega` /
  `en_bodega_satelite` ya sembrados (`ORDER_STATUS_SEED`).
- No se modela contador de intentos ni historial (fuera de alcance, R21).
- `gestion_orden.fecha_reprogramacion` / `.motivo` ya existen (feature 36): se LEEN.

## 2. Selección de órdenes a liberar (repository)

Nuevo `ILiberacionReprogramadaRepository` / `LiberacionReprogramadaRepository`
(`lib/interfaces/repositories/` + `lib/repositories/`). Solo Prisma, sin lógica.

- `findOrdenesLiberables(hoyCR: Date): Promise<OrdenLiberableRow[]>`
  - `where`: `estatus.value = "reprogramada"`, `deletedAt = null`, y existe una
    `gestion_orden` con `resultado = "reprogramada"` y `fecha_reprogramacion <= hoyCR`.
    Se toma la fecha de la gestión reprogramada MÁS RECIENTE (`orderBy createdAt desc`,
    `take 1`) como fecha vigente (R10).
  - `select`: `id`, `zonaId` (para derivar bodega), y la `fecha_reprogramacion` vigente.
- `liberarOrden(input): Promise<boolean>` — UPDATE guardado y atómico por orden:
  ```
  UPDATE orden
     SET estatus_id = :destinoEstatusId,
         mensajero_asignado_id = NULL,
         liberada_reprogramada_at = :corridaAt
   WHERE id = :ordenId
     AND estatus_id = :estatusReprogramadaId   -- guarda de estado (idempotencia/carrera)
     AND deleted_at IS NULL
  ```
  Devuelve `count > 0`. El `WHERE estatus_id = reprogramada` garantiza que dos
  corridas concurrentes (o una re-corrida) no re-liberen (R17): la primera saca la
  orden de `reprogramada`, la segunda afecta 0 filas.
- `findLiberadasHoy(zonaFilter, hoyCR)` — para el aviso (§6); alternativamente el
  loader del aviso reusa el repo de listado de órdenes existente filtrando por
  `liberada_reprogramada_at::date = hoyCR` + estatus destino + zona.

`resolveEstatusId(value)` reutiliza `findEstatusIdByValue` (ya en `IOrdenRepository`).

## 3. Servicio de liberación (business logic)

Nuevo `ILiberacionReprogramadaService` / `LiberacionReprogramadaService`
(`lib/services/`), inyectando el repo nuevo + `IZonaRepository` (para
`findCentralZonaId`) + reusando `resolverDestinoCierre` de
`lib/utils/bodega-responsable.ts` para derivar central/satélite.

```
ejecutarLiberacion(hoyCR: Date): Promise<LiberacionResult>
```

Algoritmo (patrón `CorteDiarioService.ejecutarCorte`, resiliente por ítem):

1. `centralZonaId = await zonaRepo.findCentralZonaId()`.
2. `ordenes = await repo.findOrdenesLiberables(hoyCR)` (R10).
3. Resolver `estatusId` destino una vez: `en_bodega` y `en_bodega_satelite`
   (`findEstatusIdByValue`); si falta el seed → resultado de error controlado.
4. `corridaAt = new Date()` (una marca única para toda la corrida).
5. Por cada orden: derivar bodega con `resolverDestinoCierre(orden.zonaId,
   centralZonaId)` → `bodega_central` ⇒ `en_bodega`, `bodega_satelite` ⇒
   `en_bodega_satelite` (R12). Llamar `repo.liberarOrden(...)`. `try/catch` por
   orden: si falla, log agregado (sin PII) e incrementa `omitidas` (R14); no aborta.
6. Devolver `{ evaluadas, liberadas, omitidas }` (sin PII, R7/R19).

El service NO conoce HTTP, la fecha se le inyecta (testeable sin reloj real).
`hoyCR` la calcula el controller o un util `startOfDayCR()` (§5).

`LiberacionResult` en `lib/interfaces/services/ILiberacionReprogramadaService.ts`
(patrón `CorteDiarioResult`).

## 4. Idempotencia (derivada, sin tabla de dedupe) — F1.4-e

La orden liberada sale de `reprogramada` → `findOrdenesLiberables` (R10) ya no la
ve; `liberarOrden` con `WHERE estatus_id = reprogramada` es idempotente ante
carreras. Mismo principio que la feature 41 (design A3 descartó la tabla de dedupe).
`liberada_reprogramada_at` es auditoría/aviso, no candado.

## 5. Endpoint cron + hora CR — F1.4-b

- Route handler NUEVO `app/api/cron/liberar-reprogramadas/route.ts`, **clon exacto**
  del patrón de `corte-diario`:
  - `GET` (Vercel Cron invoca GET). Auth `Authorization: Bearer <CRON_SECRET>` con
    `loadCronConfig().CORTE_DIARIO_SECRET`; sin/incorrecto/no configurado → `401` sin
    construir el service (R6). Función `handleLiberarReprogramadas(req, deps)` con
    inyección de `getSecret` + `service` para tests (patrón `handleCorteDiario`).
  - Éxito → `200` con `{ evaluadas, liberadas, omitidas }` (R7). Errores vía
    `withErrorHandler` / `appErrorToResponse`, sin secreto (R19).
- `vercel.json`: se AÑADE una segunda entrada de cron (R8):
  ```json
  { "crons": [
    { "path": "/api/cron/corte-diario",        "schedule": "0 6 * * *" },
    { "path": "/api/cron/liberar-reprogramadas","schedule": "0 6 * * *" }
  ] }
  ```
  `0 6 * * *` = 06:00 UTC = 00:00 America/Costa_Rica (UTC-6, sin DST) (R8/R9).
- **Hora CR (R9):** util `startOfDayCR(now = new Date()): Date` en `lib/utils/`
  (o reutilizar helper de fecha si aparece uno). Convierte "ahora" a la fecha CR y
  devuelve el instante que representa "hoy" para comparar contra
  `fecha_reprogramacion` (`@db.Date`, almacenada a medianoche UTC por la feature 36:
  ver `crearGestionYTransicionar`, `new Date(\`${fecha}T00:00:00.000Z\`)`). La
  comparación se hace por fecha (día), no por instante, para evitar off-by-one por
  el offset de -6h. Cubierto por test unitario con fechas frontera (23:59 y 00:01 CR).

## 6. Aviso derivado en la bodega responsable — F1.4-d

- Sin tabla nueva. La vista de la bodega (Server Component) pre-carga las órdenes
  "liberadas hoy": `estatus IN (en_bodega|en_bodega_satelite)` + `zona` de la bodega
  + `liberada_reprogramada_at::date = hoyCR`. Se muestra como badge/sección
  "Liberadas hoy (reprogramación)".
- **Destinatario (R16):** maestro para `en_bodega` (zona central); adminSatelite de
  la zona para `en_bodega_satelite`. Se reutiliza el guard de permisos/zona ya
  existente en las páginas de bodega (features 17/34). Componente `private/` recibe
  los datos por props (no fetchea datos sensibles).
- El mensajero previo NO recibe aviso (su vínculo se rompió en la liberación, R13).

## 7. Bloqueo server-side (guardas en servicios existentes) — F1.4-c

El estatus `reprogramada` NO es origen válido de ninguna asignación, así que el
bloqueo es INHERENTE. Se añade un guardia EXPLÍCITO y TIPADO (defensa en profundidad,
mensaje accionable) en los servicios de dominio, ANTES de persistir:

- Constante compartida en `lib/services` (o `lib/utils`):
  `MSG_ORDEN_REPROGRAMADA_BLOQUEADA = "orden reprogramada: bloqueada hasta la fecha de reprogramacion"`.
- `GuiaAsignacionService.generarGuia` y `.asignarDesdeBodega` (maestro, R2): en el
  bucle de validación por orden, si `orden.estatusValue === "reprogramada"` →
  `detalle.push({ ordenId, motivo: MSG_ORDEN_REPROGRAMADA_BLOQUEADA })` (aborta el
  lote sin efectos, patrón existente `detalle.length > 0 → conflict`).
- `AsignacionSateliteService.asignar` (adminSatelite, R3): idéntico, en su bucle de
  validación por orden.
- Envío (R4): `MisAsignacionesService.recogerAsignaciones` / `.gestionar` ya exigen
  origen `en_espera_aceptacion` / `en_reparto`; una orden `reprogramada` es rechazada
  por origen. Se cubre con test explícito (no requiere código nuevo, salvo confirmar
  el mensaje).

`FindByIdsForTransicion` ya proyecta `estatusValue`, así que el guardia no añade
queries. El guardia se sitúa junto a las validaciones de origen existentes, no en el
borde HTTP (R20).

## 8. Partición backend / frontend (para el implementer)

**Backend (backend_dev) — grueso:**
- Migración `orden_liberada_reprogramada_at` (up + down + índice parcial) y campo en
  `db/schema.prisma`.
- `ILiberacionReprogramadaRepository` + `LiberacionReprogramadaRepository`.
- `ILiberacionReprogramadaService` + `LiberacionReprogramadaService` (usa
  `resolverDestinoCierre`).
- Route handler `/api/cron/liberar-reprogramadas` + entrada en `vercel.json`.
- Util `startOfDayCR` (+ tests de frontera).
- Guardas de bloqueo en `GuiaAsignacionService` (x2) y `AsignacionSateliteService`
  + constante `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`.

**Frontend (frontend_dev):**
- Sección/badge "Liberadas hoy (reprogramación)" en la vista de bodega
  (central = maestro; satélite = adminSatelite), datos por props desde el Server
  Component (`private/`).

## 9. Contratos I/O

- `GET /api/cron/liberar-reprogramadas`
  - Req: header `Authorization: Bearer <CRON_SECRET>`.
  - `401` `{ error: "unauthorized" }` | `200` `{ evaluadas, liberadas, omitidas }`.
- `LiberacionReprogramadaService.ejecutarLiberacion(hoyCR)` →
  `{ evaluadas: number; liberadas: number; omitidas: number }`.
- Guardas de bloqueo: reusan los tipos de resultado existentes de cada servicio
  (`{ status: "conflict"; detalle: DetalleConflicto[] }`).

## 10. Alternativas descartadas

- **A1 — Plegar la liberación dentro de `corte-diario` (un solo cron).** DESCARTADA
  (F1.4-b). Mezcla dos dominios (dinero/cierres vs. estado de órdenes); un fallo en el
  corte arrastraría la liberación y viceversa, y el resumen/observabilidad se enreda.
  Un endpoint separado con el MISMO schedule/secret mantiene cada job pequeño,
  aislado y testeable. Coste: una entrada más en `vercel.json`.

- **A2 — Tabla de dedupe/ejecuciones `liberacion_run(fecha)` para la idempotencia.**
  DESCARTADA (F1.4-e). La transición de estatus fuera de `reprogramada` ya hace que
  una segunda corrida no encuentre trabajo (mismo argumento que la feature 41, A3).
  Añadiría tabla + RLS + mantenimiento sin beneficio.

- **A3 — Derivar el aviso "liberadas hoy" SIN columna, solo desde `gestion_orden` +
  estatus actual.** DESCARTADA. Es frágil: una orden liberada y luego re-asignada el
  mismo día ya no estaría en `en_bodega`, y no habría forma robusta de saber que fue
  liberada HOY vs. otra causa de estar en bodega. La columna `liberada_reprogramada_at`
  es un marcador barato (una columna + índice parcial, sin tabla ni RLS) que hace el
  aviso determinista y auditable.

- **A4 — Liberar a `en_espera_aceptacion` con el mismo mensajero previo.** DESCARTADA
  como recomendación (F1.4-a; queda como alternativa a decisión humana). Reasignar al
  mismo mensajero ignora que pudo cambiar de zona o estar bloqueado por un cierre
  pendiente (feature 41), y rompe el handoff por bodega. Volver a `en_bodega` /
  `en_bodega_satelite` (sin mensajero) reusa el flujo de re-asignación 17/34 y es
  coherente con la semántica de esos estatus.

- **A5 — Bloqueo por flag booleano `orden.bloqueada` en vez de derivarlo del estatus
  `reprogramada`.** DESCARTADA. Duplicaría el estado real (drift ante fallos parciales)
  igual que el A1 descartado de la feature 41. El estatus `reprogramada` +
  `fecha_reprogramacion` ya es la única fuente de verdad; el bloqueo se deriva de ahí.
