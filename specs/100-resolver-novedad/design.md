# Feature 100 — Design

> Reutiliza al máximo la base ya mergeada en `dev`: la máquina de estados, el choke point
> `appendCambioEstado` (49), el bloqueo/liberación de `reprogramada` (46), la regla de zona
> (`resolverDestinoCierre` + `findCentralZonaId`) y el patrón de acción manual de bodega con
> autz rol+zona (48, `DevolucionOrigenService`). NO introduce tablas nuevas. Como mucho, una
> migración ADITIVA de dos valores de enum con su `down.sql`.

## 0. Contexto verificado (referencias, no se reimplementan)

| Pieza | Ubicación | Qué aporta a la 100 |
| --- | --- | --- |
| Choke point historial | `lib/repositories/registrar-cambio-estado.ts` (`appendCambioEstado`) | Toda transición se registra en la MISMA tx (R20). |
| Estados devuelta/reprogramada/en_bodega/en_bodega_satelite | `lib/types/order-status.ts` (ya sembrados) | Origen y destinos; sin estados nuevos. |
| Liberación por SLA (reintento) | `DevolucionSlaRepository.liberarDevueltaSla` | Molde exacto del "recuperar" (UPDATE guardado + limpia mensajero + append). |
| Bloqueo + liberación de reprogramada | Feature 46: `LiberacionReprogramadaRepository.findOrdenesLiberables` / cron `liberar-reprogramadas` | Lee `fecha_reprogramacion` de la gestión `reprogramada` vigente para liberar al llegar la fecha → el "reprogramar" debe crear esa gestión. |
| Gestión + transición atómica | `GestionOrdenRepository.crearGestionYTransicionar` | Patrón de crear gestión + `orden.update` + `appendCambioEstado` en una tx. |
| Acción manual de bodega (rol+zona) | `DevolucionOrigenService` (48) + `lib/actions/devolucion-origen.ts` | Patrón de `esBodegaResponsable` + Server Action. |
| Autz por tienda | `NovedadesService`/`OrdenService` (`where.tiendaId = actor.usuarioId`) | Autz del reprogramar. |
| Enum de origen | `OrdenHistorialOrigenTipo` (schema.prisma) + `lib/types/orden-historial.ts` | Donde se añaden los dos valores nuevos. |
| Fecha CR | `lib/types/gestion-orden.ts` (`esFechaFutura`), `lib/utils/fecha-cr.ts` | Validación de la fecha de reprogramación. |

## 1. Modelo de datos

**Sin tablas nuevas. Sin RLS nueva.** Se reutilizan `orden`, `gestion_orden` y
`orden_historial_estado` (esta última conserva su RLS de la 49). `gestion_orden.mensajero_id` es
NOT NULL → la gestión sintética de reprogramación (R3) SIEMPRE lleva un `mensajero_id` (el de la
última gestión `devuelta` vigente, R5).

### 1.1 Migración (ADITIVA, dos valores de enum)

`db/migrations/<ts>_orden_historial_origen_tipo_resolver_novedad/`

- `migration.sql` (patrón exacto de la 99 `..._sla_devuelta`):
  ```sql
  ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'reprogramacion_tienda';
  ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'recuperacion_manual';
  ```
  Va sola (Postgres prohíbe usar un valor de enum recién añadido en la misma tx que lo añadió;
  su primer uso ocurre en tiempo de ejecución de las acciones). Aditiva: no altera tablas.
- `down.sql`: RECREA el enum sin los dos valores (Postgres no soporta `DROP VALUE`), listando los
  15 valores previos (49 + 67 + 88 + los 2 de la 99). Precondición documentada: ninguna fila de
  `orden_historial_estado.origen_tipo` con los valores a eliminar (si la hay, el `USING` del
  `ALTER COLUMN` falla ruidosamente y aborta el rollback — correcto: no se borra auditoría en
  silencio).

Fuente única de verdad TS: añadir ambos a `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`
(`lib/types/orden-historial.ts`). NO se añaden a `ORIGEN_TIPOS_CON_GESTION`: siguiendo el
precedente de la 99, aunque `reprogramacion_tienda` enlaza una gestión, su destino es
`reprogramada` (no `devuelta`), así que jamás entra en el derivador de intentos y dejarlo fuera es
inocuo (documentar el porqué junto al SEED).

> Alternativa (ver §6): reusar `origen_tipo = gestion` para reprogramar y NO tocar el enum. Se
> descarta.

## 2. Reprogramar (adminTienda)

### 2.1 Capas

- **Server Action** `lib/actions/resolver-novedad.ts` → `reprogramarNovedad(input)`
  (`'use server'`, patrón `devolucion-origen.ts`): `resolveActorFromSession`, zod
  (`{ ordenId: uuid, fechaReprogramacion: /^\d{4}-\d{2}-\d{2}$/ (refine esFechaFutura),
  motivo?: string }`, R4/R23), `withErrorHandler`, delega al service.
- **Service** `lib/services/ReprogramacionTiendaService.ts` (`IReprogramacionTiendaService`):
  1. `findById(ordenId)` (excluye borradas). No existe → `not_found`.
  2. Autz: `actor.rol === 'adminTienda' && orden.tiendaId === actor.usuarioId`, si no → `forbidden`
     (R6).
  3. Guarda de estado: `orden.estatusValue === 'devuelta'`; si no → `conflict` (R7).
  4. Resolver `estatusReprogramadaId = findEstatusIdByValue('reprogramada')`; null → `config_error`.
  5. Delegar al repo la transición atómica (R2/R3/R20).
- **Repository** `GestionOrdenRepository.reprogramarDesdeDevuelta(input)` (método NUEVO en el repo
  que ya crea gestiones): en UNA `$transaction`, UPDATE guardado por `estatus_id = devuelta`
  (`updateMany`, R21) → `reprogramada`; SOLO si `count > 0` crea la gestión sintética
  (`resultado=reprogramada`, `fecha_reprogramacion`, `motivo`, `mensajero_id` = última `devuelta`
  vigente leída dentro de la tx, R5) y hace `appendCambioEstado` (`actor = adminTienda`,
  `origen_tipo = reprogramacion_tienda`, `gestion_orden_id` = la gestión creada), R11/R20. Devuelve
  `boolean` (false si `count === 0` → el service responde `conflict`, R7).

### 2.2 Contrato I/O

```
reprogramarNovedad(input: unknown): Promise<
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string }
  | { status: "config_error" }
  | { status: "validation_error"; fieldErrors }
  | { status: "unauthenticated" }
>
```

### 2.3 Interacción con feature 46 / 47 / 99 (invariantes a preservar con test)

- Tras reprogramar, la orden está en `reprogramada` con `fecha_reprogramacion` futura → el bloqueo
  server-side de la 46 (`GuiaAsignacionService`/`AsignacionSateliteService`) la rechaza y el cron
  `liberar-reprogramadas` la libera a bodega al llegar la fecha (R9). El cron SLA 99 no la ve (no
  está en `devuelta`).
- El contador de intentos NO cambia (destino `reprogramada`, no `devuelta`; R8).
- Money-neutral (R10): el cierre solo acredita `entregada`/`rechazada`. La gestión sintética
  `reprogramada` puede quedar vinculada al cierre del mensajero atribuido (`cierre_id`) pero aporta
  $0.00 — consistente con las reprogramadas existentes.

## 3. Recuperar a bodega (bodega dueña)

### 3.1 Capas

- **Server Action** `lib/actions/resolver-novedad.ts` → `recuperarABodega(input)`: zod
  `{ ordenId: uuid }`, patrón idéntico a `devolverATienda`.
- **Service** `lib/services/RecuperacionBodegaService.ts` (`IRecuperacionBodegaService`), calcado
  de `DevolucionOrigenService`:
  1. `findById(ordenId)`; null → `not_found`.
  2. Guarda de estado: `estatusValue === 'devuelta'`; si no → `conflict` (R16).
  3. Autz por bodega responsable ANTES de escribir (`esBodegaResponsable(destinoTipo, orden.zonaId,
     actor)` con `resolverDestinoCierre(orden.zonaId, findCentralZonaId())`): central → maestro/
     admin; satélite → `adminSatelite` cuya `findUsuarioZonaId == orden.zonaId`; resto → `forbidden`
     (R15).
  4. Resolver destino: `en_bodega` (central) o `en_bodega_satelite` (satélite); `findEstatusIdByValue`
     null → `config_error`.
  5. Delegar al repo (R13/R14/R17/R20).
- **Repository** `RecuperacionBodegaRepository.recuperarABodega(input)` (NUEVO, molde de
  `DevolucionSlaRepository.liberarDevueltaSla`; `Pick<PrismaClient,"orden"|"$transaction">`):
  `$transaction` → `updateMany` guardado por `estatus_id = devuelta` (R21) con
  `{ estatusId: destino, mensajeroAsignadoId: null, asignadoAt: null }` (R14); SOLO si `count > 0`,
  `appendCambioEstado` (`estatusOrigenId = devuelta`, `estatusDestinoId = destino`,
  `actorUsuarioId = actor`, `origenTipo = recuperacion_manual`, R17). Devuelve `boolean`.

> NO se toca `orden.prioridad` (R19): la columna no existe hoy (feature 101).

### 3.2 Contrato I/O

```
recuperarABodega(input: unknown): Promise<
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string }
  | { status: "config_error" }
  | { status: "validation_error"; fieldErrors }
  | { status: "unauthenticated" }
>
```

## 4. UI

### 4.1 Reprogramar — `/novedades` (adminTienda)
- `app/(app)/novedades/_components/NovedadesModule.tsx`: por cada `NovedadDTO`, un botón
  "Reprogramar" que abre un modal (reusa `components/ui` modal existente) con un
  `<input type="date">` (default `mananaCalendarioCR`, `min` = mañana) y un textarea opcional de
  motivo. Confirmar → `reprogramarNovedad({ ordenId, fechaReprogramacion, motivo })`; `ok` → toast +
  quitar la fila (ya no es novedad); error → toast por status (patrón `cambiarPagina`).
- La página `page.tsx` ya guarda rol `adminTienda` + `notFound` (defensa en profundidad, R22): sin
  cambios de guarda.
- `NovedadDTO` ya trae `id`; no requiere campos nuevos.

### 4.2 Recuperar — superficies existentes de cada bodega (NO en /novedades)
- **adminSatelite** — `/recepcion-satelite`: extender `RecepcionSateliteService.listar` para incluir
  un grupo `devueltas` (órdenes `devuelta` de su zona, mismo patrón que el `porDevolver` que la 48
  añadió). `RecepcionSateliteModule.tsx` muestra ese grupo con un botón "Recuperar" →
  `recuperarABodega({ ordenId })`.
- **maestro/admin** — `/ordenes`: sobre las órdenes en `devuelta` de la zona central, un botón
  "Recuperar" (patrón `DevolverATiendaModal`/`OrdenesRevisionMaestro` de la 48) →
  `recuperarABodega({ ordenId })`. La elegibilidad real la impone el service (R15); la UI solo
  muestra el botón para las órdenes candidatas.
- `menu-visibility.ts`: SIN cambios (no se abre `/novedades` a la bodega).

## 5. Seguridad / RLS
- Sin tablas nuevas → sin políticas RLS nuevas. `orden_historial_estado` mantiene su RLS de la 49.
- Toda autz es server-side en el service (R22); las páginas aplican defensa en profundidad por rol.
- Mutaciones internas → Server Actions (no route handlers), conforme a `architecture.md`.
- Logs sin PII (R24): solo conteos/estados, nunca teléfono ni destinatario.

## 6. Alternativas consideradas y DESCARTADAS

1. **Reprogramar como transición sin gestión (fecha en una columna nueva de `orden`).**
   Descartada: `fecha_reprogramacion` vive SOLO en `gestion_orden`, y el cron de liberación de la
   46 lee la fecha de la gestión `reprogramada` vigente. Sin gestión, la orden quedaría en
   `reprogramada` BLOQUEADA para siempre (nunca liberada), o habría que DUPLICAR el mecanismo de la
   46 con una columna nueva en `orden` (migración + código redundante + dos fuentes de verdad de la
   fecha). La gestión sintética reusa la 46 intacta. **Elegida: gestión sintética.**

2. **Recuperar reusando `liberarDevueltaSla` directamente.**
   Descartada: ese método fija `actor = NULL` y `origen_tipo = liberacion_devuelta_sla`, que
   etiquetarían una acción MANUAL de un admin como si fuera el cron y perderían la trazabilidad del
   actor. Se añade un método hermano con `actor` y `origen_tipo = recuperacion_manual`. **Elegida:
   método nuevo, molde de `liberarDevueltaSla`.**

3. **Reusar `origen_tipo = gestion` para reprogramar y evitar la migración de enum.**
   Descartada: `gestion` implica hoy actor = mensajero en todos sus call-sites; usarlo con actor
   `adminTienda` rompería esa asunción y ensuciaría la línea de tiempo (no se distinguiría tienda de
   mensajero). Un valor propio (`reprogramacion_tienda`) cuesta ~2 líneas de enum + down.sql y deja
   la auditoría legible. **Elegida: valor de enum nuevo.**

4. **Poner "Recuperar a bodega" en `/novedades`, abriéndola a los roles de bodega.**
   Descartada: `/novedades` es, por diseño de la 87, una vista solo-`adminTienda` filtrada por
   tienda; ampliarla a maestro/admin/adminSatelite mezclaría dos alcances (tienda vs bodega) y dos
   filtros (por tienda vs por zona) en una sola página. La 48 ya estableció el patrón de exponer la
   acción de bodega en las superficies propias de cada bodega. **Elegida: superficies existentes de
   bodega.**

## 7. Trazabilidad R → test (borrador; el implementer la cierra en `progress/impl_100.md`)

| R | Test (archivo · caso) |
| --- | --- |
| R1 | `tests/components/NovedadesModule.test.tsx` · "muestra el botón Reprogramar por orden" |
| R2 | `tests/unit/repositories/GestionOrdenRepository.reprogramarDesdeDevuelta` · "transiciona devuelta→reprogramada vía appendCambioEstado" |
| R3 | idem · "crea gestión reprogramada con fecha en la misma tx" |
| R4 | `tests/unit/actions/resolver-novedad` · "fecha no futura → validation_error" |
| R5 | repo test · "atribuye mensajero_id de la última devuelta vigente" |
| R6 | `tests/unit/services/ReprogramacionTiendaService` · "otra tienda / rol no adminTienda → forbidden" |
| R7 | service/repo test · "orden fuera de devuelta → conflict, count 0, sin efectos" |
| R8 | `tests/unit/...` · "contarIntentos no cambia tras reprogramar" |
| R9 | integración · "reprogramada bloqueada + cron SLA la salta" |
| R10 | `tests/unit/...` cierre · "gestión reprogramada sintética aporta $0.00" |
| R11 | repo test · "historial actor=adminTienda, origen_tipo=reprogramacion_tienda" |
| R12 | `tests/components/RecepcionSateliteModule.test.tsx` + ordenes · "botón Recuperar visible" |
| R13 | `tests/unit/repositories/RecuperacionBodegaRepository` · "devuelta→en_bodega / en_bodega_satelite por zona" |
| R14 | idem · "limpia mensajero_asignado_id y asignado_at" |
| R15 | `tests/unit/services/RecuperacionBodegaService` · "no responsable → forbidden (matriz rol×zona)" |
| R16 | service/repo test · "fuera de devuelta → conflict, count 0" |
| R17 | repo test · "historial actor=admin, origen_tipo=recuperacion_manual" |
| R18 | integración · "tras recuperar, cron SLA la salta y queda asignable" |
| R19 | test estático/unit · "no referencia orden.prioridad" |
| R20 | repo tests (ambos) · "si el append falla, revierte el UPDATE" |
| R21 | repo tests (ambos) · "UPDATE guardado por estatus=devuelta; segunda corrida count 0" |
| R22 | `tests/components/*Page.test.tsx` + action tests · "notFound por rol / unauthenticated sin sesión" |
| R23 | action tests · "ordenId no-uuid → validation_error" |
| R24 | revisión + test de logger · "sin PII en warn/error" |

Migración: round-trip (rollback → pending → deploy → up-to-date) verificado, como en la 99.
