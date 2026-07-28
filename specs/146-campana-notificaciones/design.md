# Feature 146 — Campana de notificaciones funcional · design.md

Decisiones técnicas previas al código. Cubre modelo de datos, alcance y RLS, migración up/down,
contratos de las Server Actions, flujo de cada productor, alternativas descartadas, fuera de
alcance, riesgos y las decisiones cerradas en F1.4.

Hechos leídos del código (no supuestos):

- `components/shared/NotificationsBell.tsx` — cliente, `Popover` de Base UI, tipos
  `NotificationType = "alert" | "box" | "warning"`, `NotificationItem { id, notification_type,
  description, anexo?, read? }`, `NotificationsBellProps { notifications? }`,
  `EXAMPLE_NOTIFICATIONS` quemadas, `useState` local para descartar / marcar todas.
- `components/shared/PageHeader.tsx:45` — monta `<NotificationsBell />` **sin props**; el
  header es de presentación pura, server-compatible.
- `lib/repositories/registrar-cambio-estado.ts` — `appendCambioEstado(tx, entradas, emitir,
  catalogo)` es el **único choke point** de toda escritura de `orden.estatus_id` (feature 49),
  ya con guardia de transiciones (feature 140) y con emisión transactional-outbox de webhooks
  (feature 99, parámetro `emitir` inyectable con default real).
- `lib/types/order-status-transiciones.ts` — `en_ruta -> rechazada` vía familia `gestion`
  (#15, rol mensajero) y `devuelta -> rechazada` vía `escalado_devuelta_sla` (#21,
  sistema/cron). Dos vías al MISMO estado: sólo la primera es "rechazada por el destinatario".
- `db/schema.prisma:452,484` — `orden.tienda_id` es FK a `usuario` (el propio usuario
  `adminTienda` dueño de la orden). La zona se deriva del distrito de la orden.
- `db/schema.prisma:140` — `usuario.zona_id` (nullable) es la zona del `adminSatelite`.
- `lib/services/AprobacionPostulacionService.ts:20` — `ROLES_APROBADORES = {maestro, admin}`.
- `lib/services/CierresAdminService.ts` — acceso total `maestro`/`admin`, alcance por zona
  `adminSatelite`.
- `lib/services/CierreDiaService.solicitarCierre` — tres caminos de éxito:
  `transicionarVencidoASolicitado`, `transicionarRechazadoASolicitado` y `crearCierre`.
- `app/api/ordenes/carga-masiva/chunk/route.ts` + `app/(app)/ordenes/_components/carga-masiva-chunks.ts`
  — la carga masiva de UI la **trocea el cliente**: el servidor ve N peticiones y **no sabe
  cuál es la última**. La carga por API key (`BulkOrdenService.cargarViaApi`) sí es una sola
  petición con fin de lote real.
- `db/schema.prisma:35` — `enum RolValue { maestro admin mensajero adminTienda adminSatelite apiKey }`.
- `db/migrations/20260723140000_chat_whatsapp/migration.sql` — patrón vigente de migración:
  enums nativos, FK explícitas con `ON DELETE`, índices a mano cuando Prisma no los expresa,
  `ENABLE ROW LEVEL SECURITY` sin policies (sólo service role), autorización de negocio en el
  service.
- `tests/integration/db/zonas-migration.test.ts:115-216` — invariante de orden de migraciones
  con **denylist a mano**; toda migración nueva debe añadirse allí o el test rompe.
- Última migración existente: `20260724150000_orden_historial_origen_devolucion_rechazada`.

---

## 1. Modelo de datos

Migración nueva: `db/migrations/20260727120000_notificacion/` (`migration.sql` + `down.sql`).

### 1.1 Enums nativos (patrón `RolValue` / `ChatMensajeTipo`)

```sql
CREATE TYPE "notificacion_tipo" AS ENUM ('alert', 'box', 'warning');

CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar'
);

CREATE TYPE "notificacion_entidad_tipo" AS ENUM ('orden', 'usuario', 'cierre_dia', 'carga');
```

`notificacion_evento` es el **inventario cerrado de D1**. Añadir un evento exige migración de
enum: deliberado (mismo criterio que `OrdenHistorialOrigenTipo`), impide que un productor no
especificado se cuele sin revisión.

### 1.2 `notificacion` — una fila por rol destinatario (D4 + F1.4-5)

| columna | tipo | notas |
| --- | --- | --- |
| `id` | `TEXT` PK | uuid generado por Prisma |
| `tipo` | `notificacion_tipo` NOT NULL | mapea 1:1 al icono del componente |
| `evento` | `notificacion_evento` NOT NULL | discriminador de dominio |
| `descripcion` | `TEXT` NOT NULL | texto compuesto en servidor (sin PII sensible, §4.6) |
| `anexo` | `TEXT` NULL | p. ej. `REM-0042`, `Lote #128` |
| `entidad_tipo` | `notificacion_entidad_tipo` NOT NULL | entidad de origen |
| `entidad_id` | `TEXT` NULL | id de la entidad; **sin FK** (referencia polimórfica) |
| `destinatario_rol` | `rol_value` NULL | direccionamiento por rol (D4) |
| `destinatario_usuario_id` | `TEXT` NULL | FK → `usuario(id)` `ON DELETE CASCADE` |
| `tienda_id` | `TEXT` NULL | **alcance** (F1.4-1); FK → `usuario(id)` `ON DELETE CASCADE` |
| `zona_id` | `TEXT` NULL | **alcance** (F1.4-1); FK → `zona(id)` `ON DELETE CASCADE` |
| `created_at` | `TIMESTAMP(3)` NOT NULL DEFAULT `CURRENT_TIMESTAMP` | orden y ventana de 30 días |

`tienda_id` referencia `usuario`, no una tabla `tienda`: en este esquema la tienda **es** el
usuario con rol `adminTienda` (`orden.tienda_id` → `usuario.id`, `schema.prisma:452,484`).

Restricción de destinatario (R4):

```sql
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_destinatario_xor"
  CHECK (("destinatario_rol" IS NULL) <> ("destinatario_usuario_id" IS NULL));
```

Los dos alcances son **independientes y opcionales** (R5): `tienda_id` sólo tiene sentido con
`destinatario_rol = 'adminTienda'` y `zona_id` con `destinatario_rol = 'adminSatelite'`, pero
el esquema no los acopla — un `CHECK` extra añadiría rigidez sin cubrir un fallo real, y la
regla vive en el emisor (`lib/notificaciones/emitir.ts`, único punto de creación).

Índices (R10):

```sql
-- listado por destinatario, ordenado por fecha.
CREATE INDEX "notificacion_rol_created_at_idx"
  ON "notificacion"("destinatario_rol", "created_at" DESC)
  WHERE "destinatario_rol" IS NOT NULL;
CREATE INDEX "notificacion_usuario_created_at_idx"
  ON "notificacion"("destinatario_usuario_id", "created_at" DESC)
  WHERE "destinatario_usuario_id" IS NOT NULL;
-- alcances: evitan el filtro secuencial cuando el actor es adminTienda / adminSatelite.
CREATE INDEX "notificacion_tienda_id_created_at_idx"
  ON "notificacion"("tienda_id", "created_at" DESC) WHERE "tienda_id" IS NOT NULL;
CREATE INDEX "notificacion_zona_id_created_at_idx"
  ON "notificacion"("zona_id", "created_at" DESC) WHERE "zona_id" IS NOT NULL;
CREATE INDEX "notificacion_entidad_idx" ON "notificacion"("entidad_tipo", "entidad_id");
```

Los índices parciales van **a mano** en el `migration.sql` (Prisma no los expresa), patrón
`chat_mensaje_wa_message_id_key` / `wallet_movimiento`.

`entidad_id` **no** lleva FK: apunta a tablas distintas según `entidad_tipo`. El precio es que
una entidad borrada deja una notificación colgada; se acepta porque las notificaciones son
efímeras y de sólo lectura, y porque cuatro columnas FK nullable multiplicarían el esquema por
beneficio nulo en v1. Consecuencia en Riesgos.

### 1.3 `notificacion_lectura` — estado por usuario (D4)

| columna | tipo | notas |
| --- | --- | --- |
| `id` | `TEXT` PK | |
| `notificacion_id` | `TEXT` NOT NULL | FK → `notificacion(id)` `ON DELETE CASCADE` |
| `usuario_id` | `TEXT` NOT NULL | FK → `usuario(id)` `ON DELETE CASCADE` |
| `leida_at` | `TIMESTAMP(3)` NULL | instante de la lectura |
| `descartada_at` | `TIMESTAMP(3)` NULL | instante del descarte |

```sql
CREATE UNIQUE INDEX "notificacion_lectura_notificacion_id_usuario_id_key"
  ON "notificacion_lectura"("notificacion_id", "usuario_id");
CREATE INDEX "notificacion_lectura_usuario_id_idx" ON "notificacion_lectura"("usuario_id");
ALTER TABLE "notificacion_lectura" ADD CONSTRAINT "notificacion_lectura_marca_presente"
  CHECK ("leida_at" IS NOT NULL OR "descartada_at" IS NOT NULL);
```

Semántica: **ausencia de fila = no leída y no descartada**. Descartar implica leída (escribe
ambos instantes) para que descartar una no leída no descuadre el contador. `leida_at` **no**
vive en `notificacion` (D4 corrige la ficha original).

### 1.4 Deduplicación por `(evento, entidad_id)` (F1.4-7, R27)

Regla: no se crea una notificación si ya existe otra **no leída por su destinatario** para el
mismo `(evento, entidad_id, destinatario)`. Caso real: un cierre `rechazado -> solicitado`
re-solicitado el mismo día no debe generar un segundo aviso mientras el admin no leyó el
primero.

"No leída por su destinatario" depende de `notificacion_lectura` (otra tabla), así que **no**
es expresable en un índice único: la dedupe es una **guardia en el emisor**
(`NotificacionRepository.existeNoLeidaPara(evento, entidadId, destinatario)`) dentro del mismo
`tx`/operación, antes del `create`. Como red de seguridad ante carreras se añade un índice
único parcial que impide dos filas idénticas simultáneas:

```sql
CREATE UNIQUE INDEX "notificacion_dedupe_key"
  ON "notificacion"("evento", "entidad_id", "destinatario_rol", "destinatario_usuario_id")
  NULLS NOT DISTINCT
  WHERE "entidad_id" IS NOT NULL;
```

`NULLS NOT DISTINCT` (Postgres 15+) es necesario porque una de las dos columnas de destinatario
es siempre `NULL` por el `CHECK` XOR. Consecuencia aceptada: una notificación ya leída y
repetida para la misma entidad colisionaría con la vieja; el emisor captura la violación de
unicidad y la trata como no-op, que es exactamente el comportamiento de R27.

### 1.5 RLS y filtro de alcance

```sql
ALTER TABLE "notificacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notificacion_lectura" ENABLE ROW LEVEL SECURITY;
```

RLS habilitada **sin policies**: sólo el service role accede, patrón `chat_conversacion` /
`plantilla_mensaje` / `wallet_movimiento`. Este repo **no** usa Supabase Auth: la sesión es
propia (tabla `session` + `resolveActorFromSession`), por lo que dentro de Postgres no existe
`auth.uid()` ni claim de rol con el que escribir una policy por usuario; escribirla sería
ficción (ver A8).

El filtro de alcance decidido en F1.4 se aplica en **un único predicado**
(`NotificacionRepository.predicadoVisibilidad(actor)`), fuente única de verdad de R13–R17:

```
visible(actor) :=
     destinatario_usuario_id = actor.usuarioId
  OR ( destinatario_rol = actor.rol
       AND (tienda_id IS NULL OR tienda_id = actor.usuarioId)
       AND (zona_id   IS NULL OR zona_id   = actor.zonaId) )
```

- Alcance NULL en ambas columnas → visible a todo el rol (R13).
- `tienda_id` con valor → sólo el usuario `adminTienda` que **es** esa tienda (R14); cualquier
  otro `adminTienda` queda fuera (R15).
- `zona_id` con valor → sólo los usuarios del rol con esa `usuario.zona_id` (R16); si el actor
  no tiene zona (`NULL`), la comparación es falsa y no la ve.
- Todo el segundo término se cierra por `destinatario_rol = actor.rol` (R17).

El predicado se usa en **las cuatro acciones** (listar, marcar leída, marcar todas, descartar):
autorizar con el mismo predicado que lista es lo que hace imposible olvidar R35. El actor
necesita `zonaId`, que hoy `resolveActorFromSession` no devuelve: se amplía el tipo `Actor` con
`zonaId` (el dato ya existe en `usuario.zona_id`), cambio aditivo.

### 1.6 `down.sql`

Revierte en orden inverso: `DROP TABLE IF EXISTS "notificacion_lectura"` →
`DROP TABLE IF EXISTS "notificacion"` → `DROP TYPE IF EXISTS` de los tres enums. No toca
ninguna tabla preexistente (migración puramente aditiva, R7).

### 1.7 Denylist del test de orden de migraciones

`tests/integration/db/zonas-migration.test.ts` mantiene a mano la lista de migraciones
"apendidas después". Hay que añadir `!d.endsWith("_notificacion")` o el test rompe. Es la única
edición permitida a un test existente en esta feature.

---

## 2. Capas y archivos

```
lib/types/notificacion.ts                       # tipos de dominio + schemas zod + DTO
lib/interfaces/repositories/INotificacionRepository.ts
lib/interfaces/services/INotificacionService.ts
lib/repositories/NotificacionRepository.ts      # sólo Prisma + predicado de visibilidad
lib/services/NotificacionService.ts             # autorización + reglas de listado
lib/actions/notificaciones.ts                   # 4 acciones + notificarCargaMasivaTerminada
lib/notificaciones/emitir.ts                    # productores (textos + dedupe)
lib/config/notificaciones.ts                    # PAGE_SIZE=50, REFRESH_INTERVAL_MS=60_000, VENTANA_DIAS=30
hooks/useNotificaciones.ts                      # SWR (cliente)
components/shared/NotificationsBell.tsx         # deja de tener estado quemado
```

`NotificationsBell.tsx` se queda en `shared/` (ya está ahí y lo consume `PageHeader`). No pasa
a `private/`: no muestra PII ni balances, y `private/` exige recibir datos por props desde un
Server Component, incompatible con D3 (polling en cliente).

---

## 3. Contratos de las Server Actions

Todas en `lib/actions/notificaciones.ts` con `'use server'`, resuelven el actor con
`resolveActorFromSession`, envuelven con `withErrorHandler` y traducen con `toActionError`,
patrón `lib/actions/aprobacion-postulaciones.ts`. `deps` inyectables (`service?`, `getActor?`)
para test sin DB ni cookies.

### 3.1 DTO hacia el cliente

```ts
export type NotificationType = "alert" | "box" | "warning";

export interface NotificacionDTO {
  id: string;                       // uuid
  notification_type: NotificationType;
  description: string;
  anexo?: string;
  read: boolean;                    // derivado de notificacion_lectura del actor
  createdAt: string;                // ISO-8601
}
```

`NotificationsBell.tsx` conserva `NotificationItem` como **alias público** de `NotificacionDTO`
(F1.4-9, R50): los consumidores externos siguen compilando y el JSX de la lista no cambia.

### 3.2 `listarNotificaciones`

```ts
listarNotificaciones(deps?): Promise<
  | { status: "ok"; items: NotificacionDTO[]; noLeidas: number }
  | { status: "unauthenticated" }
>
```

- Filtro: `predicadoVisibilidad(actor)` (§1.5) **AND** el actor no la descartó **AND**
  `created_at >= now() - 30 días` (F1.4-6).
- Orden `created_at DESC`, límite `notificacionesConfig.PAGE_SIZE = 50`. Sin paginación en v1:
  el popover ya tiene `max-h` con scroll.
- `noLeidas` se calcula sobre el **mismo** conjunto filtrado: el badge nunca puede superar lo
  que la lista muestra.

### 3.3 `marcarNotificacionLeida(id)`

```ts
marcarNotificacionLeida(id: unknown, deps?): Promise<
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
>
```

`upsert` por `(notificacion_id, usuario_id)` con `leida_at = now()` (idempotente, R37).
`forbidden` si existe pero no pasa el predicado de visibilidad (R35).

### 3.4 `marcarTodasLeidas`

```ts
marcarTodasLeidas(deps?): Promise<{ status: "ok"; marcadas: number } | { status: "unauthenticated" }>
```

Inserta filas de lectura para todas las notificaciones visibles-y-no-descartadas del actor
dentro de la ventana, con `ON CONFLICT DO NOTHING` (idempotente, sin read-modify-write).

### 3.5 `descartarNotificacion(id)`

Mismo contrato que 3.3. Escribe `descartada_at = now()` y `leida_at = COALESCE(leida_at, now())`.
**No** borra la fila de `notificacion` (R33): el descarte es por usuario.

### 3.6 `notificarCargaMasivaTerminada` (F1.4-4, R39)

```ts
notificarCargaMasivaTerminada(
  input: unknown,   // { creadas: number; total: number; loteId: string }
  deps?,
): Promise<{ status: "ok" } | { status: "validation_error"; fieldErrors } | { status: "unauthenticated" }>
```

- **Autorización:** la notificación se crea **siempre** con `destinatario_usuario_id =
  actor.usuarioId`. El cliente no puede designar destinatario; no existe parámetro para ello,
  así que un usuario no puede sembrar avisos en la campana de otro.
- **Validación zod:** `creadas` y `total` enteros ≥ 0 con `creadas <= total`; `loteId` uuid
  generado por el cliente al iniciar la carga (R36).
- **Idempotencia (R39):** `entidad_tipo = 'carga'`, `entidad_id = loteId`; la dedupe de §1.4
  (guardia + índice único parcial) convierte la segunda invocación en no-op. Un reintento del
  cliente no duplica el aviso.
- El texto lo compone el servidor; el cliente sólo aporta contadores.

---

## 4. Productores

Ubicación única: `lib/notificaciones/emitir.ts`, una función por evento. Ningún componente ni
route handler compone el texto: descripción y anexo se arman aquí y sólo aquí.

### 4.1 Orden rechazada por el destinatario (R18–R21)

**Choke point: `appendCambioEstado`** (`lib/repositories/registrar-cambio-estado.ts`), no los
services. Razón leída del código: es el ÚNICO punto por el que pasa toda escritura de
`orden.estatus_id` (feature 49 §3.3) y ya está preparado para efectos añadidos por inyección
(`emitir` de la feature 99, `catalogo` de la 140). En `GestionOrdenRepository` habría que
recordar emitirlo en cada camino que produzca un rechazo; aquí es estructuralmente imposible de
olvidar.

Filtro sobre el lote de `CambioEstadoEntrada`:
`value(estatusDestinoId) === "rechazada" && origenTipo === "gestion"`. El segundo predicado
separa el rechazo del destinatario (#15) del escalado por SLA (#21, `escalado_devuelta_sla`),
que también aterriza en `rechazada` y **no notifica** (R19).

Se añade como **quinto parámetro inyectable con default real**
(`emitirNotificaciones: NotificacionEmisor = emisorNotificacionReal`), exactamente el patrón de
`emitir`/`catalogo`: la firma sigue siendo compatible con los ~18 call-sites y los tests pueden
espiarlo.

**Emisión TRANSACCIONAL** (F1.4-3): dentro de la misma `$transaction` del cambio de estado. Es
lo correcto y además lo único posible: en Postgres un error de sentencia aborta la transacción
entera, de modo que "best-effort con try/catch" **dentro** del `tx` no existe. Precedente
exacto: la feature 99 encola el job de webhook en la misma tx (transactional-outbox) asumiendo
el mismo acoplamiento. Consecuencias: R20 (rollback ⇒ sin notificación) y R21 (fallo de emisión
⇒ sin cambio de estado). Riesgo 1.

Filas emitidas por rechazo (4, F1.4-1 + F1.4-5):

| `destinatario_rol` | `tienda_id` | `zona_id` |
| --- | --- | --- |
| `maestro` | NULL | NULL |
| `admin` | NULL | NULL |
| `adminTienda` | `orden.tienda_id` | NULL |
| `adminSatelite` | NULL | zona de la orden |

La zona de la orden se deriva del distrito de la orden dentro de la misma tx; si no se puede
resolver, la fila de `adminSatelite` **no se emite** (las otras tres sí): una fila con
`zona_id` inventado sería peor que un aviso menos.

### 4.2 Carga masiva terminada (R22, R25, R39)

- **Carga por API key** (`BulkOrdenService.cargarViaApi`, una sola petición con fin de lote
  real): emisión al final del método, server-side. Destinatario: `destinatario_usuario_id =
  actor.usuarioId` (dueño de la API key).
- **Carga masiva de UI** (chunks): el servidor no sabe cuál es el último lote — lo trocea
  `procesarEnChunks` en el cliente. Se usa la Server Action explícita
  `notificarCargaMasivaTerminada` (§3.6), invocada por `OrdenesCargaUpload.tsx` al cerrar el
  último chunk (F1.4-4). No se ata a la feature 141: 146 mantiene `depends_on: null`.

**Best-effort** (R25): el productor va después de la operación de negocio, envuelto en
`try/catch` que registra el error y devuelve; una notificación perdida no puede invalidar una
carga de cientos de órdenes ya persistidas.

### 4.3 Postulación de mensajero pendiente (R23, R25)

Punto: `PostulacionMensajeroService.postular`, rama de éxito, **después** de
`crearMensajeroConDocumentos` (fuera de su transacción). Destinatarios: `maestro` y `admin`
(F1.4-2, derivado de `ROLES_APROBADORES`), **dos filas** sin alcance. Best-effort: una
postulación creada con documentos ya subidos no se tira por un fallo de aviso.

### 4.4 Cierre de día por aprobar (R24, R25)

Punto: `CierreDiaService.solicitarCierre`, en los **tres** caminos de éxito leídos del código
(`transicionarVencidoASolicitado`, `transicionarRechazadoASolicitado`, `crearCierre`), tras
comprobar el resultado positivo. **Tres filas**: `maestro` (sin alcance), `admin` (sin alcance)
y `adminSatelite` con `zona_id` = zona destino del cierre (ya resuelta por
`resolverDestinoCierre`). Best-effort. La dedupe de §1.4 evita el segundo aviso cuando el mismo
cierre se re-solicita sin que nadie haya leído el primero.

### 4.5 Best-effort vs. transaccional — resumen

| productor | modo | por qué |
| --- | --- | --- |
| orden rechazada | **transaccional** | vive dentro del `tx` del choke point; try/catch en tx no existe (F1.4-3) |
| carga masiva (API y UI) | best-effort | posterior a la persistencia; no puede invalidar la carga |
| postulación | best-effort | posterior a la escritura atómica + subida de documentos |
| cierre por aprobar | best-effort | posterior a la escritura guardada del cierre |

### 4.6 Textos (sin PII sensible)

| evento | tipo | descripción | anexo |
| --- | --- | --- | --- |
| `orden_rechazada` | `alert` | "Una orden fue rechazada por el destinatario." | `num_guia`/`num_remision` |
| `carga_masiva_terminada` | `box` | "Carga masiva terminada: N órdenes cargadas." | total de filas |
| `postulacion_mensajero_pendiente` | `warning` | "Una postulación de mensajero está pendiente de aprobación." | nombre del postulante |
| `cierre_dia_por_aprobar` | `warning` | "Un mensajero envió su cierre del día para aprobación." | nombre del mensajero / zona |

Nunca dirección, teléfono ni monto.

---

## 5. Frontend

`hooks/useNotificaciones.ts`:

```ts
useSWR("notificaciones", fetcher, {
  refreshInterval: notificacionesConfig.REFRESH_INTERVAL_MS, // 60_000 (D3, F1.4-8)
  revalidateOnFocus: true,
  keepPreviousData: true,
});
```

`fetcher` llama `listarNotificaciones()` y lanza si `status !== "ok"`, para que SWR exponga
`error` — patrón idéntico a `PostulacionesPendientesPanel.tsx` (feature 22).

`NotificationsBell.tsx`:

- Borra `EXAMPLE_NOTIFICATIONS` y el `useState` de datos (R40).
- `<Popover.Root onOpenChange={(open) => { if (open) mutate(); }}>` → revalidación al abrir (R47).
- "Marcar todas" y "X" invocan la Server Action y hacen `mutate()` con actualización optimista.
- `notifications?: NotificationItem[]` se conserva como prop opcional y se usa como
  `fallbackData` de SWR: permite testear sin mockear SWR y **no obliga a tocar `PageHeader`**.
- Error o `unauthenticated` → `items = []`, sin badge, sin romper el header (R48).
- `NotificationItem` se mantiene exportado como alias de `NotificacionDTO` (R50).

---

## 6. Alternativas descartadas

**A1 — `leida_at` en la propia fila de `notificacion` (ficha original).** Incorrecta con
destinatario por rol: el primer admin que leyera apagaría el aviso para todos. Coste de la
elegida: una tabla más y un anti-join; a cambio, estado por usuario exacto.

**A2 — Fan-out: una fila por usuario destinatario.** Listar sería más simple, pero multiplica
las escrituras por el número de usuarios del rol **dentro** de la transacción del cambio de
estado (§4.1) y deja avisos incoherentes cuando alguien entra o sale del rol después del
evento. D4 lo excluye.

**A3 — Supabase Realtime.** Descartada por D3. Además exigiría policies RLS por usuario, que
este repo no puede escribir (sesión propia, sin `auth.uid()`, §1.5).

**A4 — `destinatario_rol` como array (`rol_value[]`) para una sola fila multi-rol.** Obliga a
índice GIN, complica el `CHECK` XOR y rompe la clave de dedupe. F1.4-5 cierra: una fila por rol.

**A5 — Productor de rechazo en `GestionOrdenRepository`.** Cualquier camino nuevo hacia
`rechazada` que no pase por ese repo perdería el aviso en silencio. El choke point lo hace
estructural.

**A6 — Colgar el aviso de carga masiva de la tabla `carga` de la feature 141.** Sería el ancla
natural, pero 141 está `in_progress` y no mergeada, y 146 declara `depends_on: null`. F1.4-4
cierra: acción explícita con `loteId` del cliente. Cuando 141 aterrice, migrar el productor es
un cambio local (mismo `evento`, cambia el origen de `entidad_id`).

**A7 — Route handler `GET /api/notificaciones` + `fetch`.** Descartada por
`docs/architecture.md`: lecturas y mutaciones internas van por Server Action.

**A8 — Policies RLS por usuario en Postgres para el alcance `tienda_id`/`zona_id`.** Sería la
forma "pura" de empujar el filtro a la base. Imposible hoy: la sesión no es Supabase Auth, no
hay `auth.uid()` ni claim de rol en la conexión, y toda la app accede con el service role. Se
sustituye por RLS habilitada (nadie salvo service role) + un **predicado único** en el
repositorio (§1.5), compartido por las cuatro acciones, con tests de los tres casos: alcance
NULL, alcance acotado y negativo (R13–R17).

---

## 7. Fuera de alcance

- **D2 — Aviso de "órdenes con más de 1 día sin asignación".** Omitido explícitamente. Esta
  feature **no** añade: entrada en `vercel.json`, valor nuevo en `JobTipo`, job de barrido,
  route handler de cron ni variable de entorno de umbral.
- Preferencias por usuario (silenciar tipos, canales email/WhatsApp).
- Página "ver todas las notificaciones" y paginación.
- **Purga automática**: no existe (F1.4-6). Ver Riesgo 3.
- Notificaciones para los roles `mensajero` y `apiKey`, y para eventos fuera de D1.

---

## 8. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | El productor transaccional del rechazo puede revertir un cambio de estado si la inserción falla (R21) | Inserción mínima (4 filas + una lectura de zona, todo dentro de la tx), cubierta por test; decisión cerrada en F1.4-3 |
| 2 | El polling de 60 s multiplica consultas por usuario conectado | Índices parciales §1.2, ventana de 30 días, límite 50, `keepPreviousData` |
| 3 | **Deuda conocida:** `notificacion` crece sin purga (D2 prohíbe cron nuevo); la ventana de 30 días acota la consulta, no la tabla | Volumen bajo (4 eventos poco frecuentes); si crece, la purga será una feature aparte con su propio cron |
| 4 | `entidad_id` sin FK deja referencias colgadas si se borra la entidad | Aceptado: la notificación es informativa; el front no navega a la entidad en v1 |
| 5 | La denylist a mano de `zonas-migration.test.ts` rompe con toda migración nueva | Tarea B4 con criterio de "hecho" |
| 6 | La campana hace I/O en **toda** página (está en `PageHeader`) | `fallbackData`, fallo silencioso (R48) y una sola consulta indexada; sin bloquear el render |
| 7 | El alcance vive en código, no en policies de Postgres (§1.5, A8) | Predicado único compartido por las 4 acciones + tests de los tres casos (NULL, acotado, negativo) |
| 8 | `Actor` gana `zonaId`: toca un tipo compartido | Cambio aditivo; el dato ya existe en `usuario.zona_id`, ningún consumidor actual se rompe |
| 9 | `NULLS NOT DISTINCT` exige Postgres 15+ | Supabase corre 15+; el test de migración fija la expresión y falla ruidosamente si el motor no la soporta |

---

## 9. Trazabilidad de alto nivel

| Bloque | Requisitos |
| --- | --- |
| Modelo, migración, RLS | R1–R12 |
| Alcance y visibilidad | R13–R17 |
| Productores | R18–R27 |
| Server Actions | R28–R39 |
| Campana | R40–R50 |

---

## 10. Decisiones cerradas en F1.4

La puerta está aprobada. **No queda ninguna decisión abierta.**

1. **Destinatarios del rechazo: `maestro` + `admin` + el `adminTienda` dueño de la orden + el
   `adminSatelite` de la zona.** *Humano.* El rechazo dispara una devolución que afecta a la
   tienda (su mercancía vuelve) y a la bodega satélite de la zona (la recibe); ambos necesitan
   el aviso, no sólo la administración central. Implica las dos columnas de alcance (§1.2) y el
   predicado de visibilidad (§1.5). **Anula** la propuesta previa de excluir `adminSatelite`
   del v1: sí entra.
2. **Resto de destinatarios:** postulación → `maestro`+`admin` (espejo de `ROLES_APROBADORES`);
   cierre por aprobar → `maestro`+`admin`+`adminSatelite` (espejo del alcance de
   `CierresAdminService`); carga masiva terminada → **usuario ejecutor** (el evento tiene dueño
   natural que no es un rol). *Humano.*
3. **Productor de rechazo TRANSACCIONAL dentro de `appendCambioEstado`,** con el filtro
   `destino === "rechazada" && origenTipo === "gestion"`; el escalado por SLA **no** notifica
   (R19). *Humano.* Dentro de una transacción de Postgres el best-effort no es representable, y
   el choke point es el único punto que garantiza cobertura (§4.1).
4. **Carga masiva por UI: Server Action explícita de "carga terminada"** invocada por el
   cliente al cerrar el último chunk, con autorización al propio ejecutor e idempotencia por
   `loteId` (§3.6). La carga por API notifica server-side, que sí tiene fin de lote real. No se
   pospone ni se ata a la feature 141: 146 mantiene `depends_on: null`. *Humano.*
5. **Una fila de `notificacion` por rol destinatario** (un evento con tres roles = tres filas).
   *Leader.* Mantiene `destinatario_rol` escalar, el índice btree parcial y la clave de dedupe.
6. **Retención: ventana de consulta de 30 días, sin purga.** *Leader.* D2 prohíbe cron nuevo y
   una purga sin barrido programado no existe. Registrado como **deuda conocida** (Riesgo 3).
7. **Deduplicación por `(evento, entidad_id)` mientras exista una no leída,** con guardia en el
   emisor + índice único parcial `NULLS NOT DISTINCT` como red ante carreras (§1.4). *Leader.*
   Evita el aviso repetido del cierre re-solicitado y el doble aviso de carga masiva.
8. **`PAGE_SIZE = 50`, `REFRESH_INTERVAL_MS = 60_000`, ventana `30` días.** *Leader.* Viven en
   `lib/config/notificaciones.ts`, sin literales sueltos.
9. **`NotificationItem` se conserva como alias público de `NotificacionDTO`.** *Leader.* No
   rompe consumidores del componente y deja el JSX de la lista intacto (R50).
</content>
</invoke>
