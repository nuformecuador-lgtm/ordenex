# Feature 36 — Mensajero: "Mis asignaciones" y gestión de órdenes · design.md

Zone: `fullstack` · complexity: `high` · depends_on: 17 (`done`), 34 (`pending`) · branch: `feature/36-mensajero-mis-asignaciones`

> Puerta **F1.4 ABIERTA**. Este design implementa los requisitos con los valores
> **recomendados** de las 7 decisiones (marcados `prov. F1.4-x`). Si el humano decide otra
> opción, los puntos afectados se ajustan sin reescribir la arquitectura (los enganches —
> service/repo/action/storage — son estables). No se implementa hasta cerrar F1.4.

Arquitectura por capas (`docs/architecture.md`): Controller (Server Action, `'use server'`) →
Service (lógica de negocio pura, testeable, DI por interfaces) → Repository (Prisma).
Mutaciones internas por Server Action, nunca `fetch` a rutas internas. Entrada externa validada
en el borde con zod. Errores vía `withErrorHandler` + `toActionError` (features 10/11).

---

## 1. Modelo de datos

### 1.1 Estados nuevos de `order_status` (R1–R4) `prov. F1.4-a,b`

Se añaden a `ORDER_STATUS_SEED` (`lib/types/order-status.ts`, fuente única de verdad) — 11.º y
12.º valores:

```ts
"aceptada",   // feature 36: aceptada por el mensajero / por entregar (prov. F1.4-a)
"rechazada",  // feature 36: resultado RECHAZO de la gestion (prov. F1.4-b)
```

`seedOrderStatus` (upsert por `value`) los siembra sin cambios de código. Labels en la capa de
presentación `app/(app)/ordenes/_components/estatus-label.ts` (el `Record` tipado sobre
`ORDER_STATUS_SEED` obliga a añadirlos o el build rompe, R33): `aceptada` → "Aceptada / por
entregar"; `rechazada` → "Rechazada".

> Si F1.4-b mapea RECHAZO a `devuelta_origen`, se omite el valor `rechazada` (seed, migración y
> label) y el service usa `findEstatusIdByValue('devuelta_origen')`.

### 1.2 Enum `metodo_pago_value` (R5) `prov. F1.4-c`

Enum Postgres nativo, patrón `VehiculoValue`/`RolValue`. Fuente única de verdad en
`lib/types/metodo-pago.ts`:

```ts
export const METODO_PAGO_SEED = ["efectivo", "simpe", "transferencia"] as const;
export type MetodoPagoValue = (typeof METODO_PAGO_SEED)[number];
```

```prisma
enum MetodoPagoValue {
  efectivo
  simpe
  transferencia
  @@map("metodo_pago_value")
}
```

### 1.3 Tabla `gestion_orden` (R6–R8) `prov. F1.4-d`

Un registro por gestión, discriminado por `resultado`. Campos nullable según resultado:

```prisma
model GestionOrden {
  id                   String            @id @default(uuid())
  ordenId              String            @map("orden_id")       // FK -> orden
  mensajeroId          String            @map("mensajero_id")   // FK -> usuario (el actor)
  resultado            GestionResultado                          // enum discriminador
  // --- ENTREGADA ---
  montoRecibido        Decimal?          @map("monto_recibido") @db.Decimal(12, 2)
  metodoPago           MetodoPagoValue?  @map("metodo_pago")
  // --- ENTREGADA / RECHAZO (evidencia foto) ---
  evidenciaStoragePath String?           @map("evidencia_storage_path") // path bucket privado, NO URL
  evidenciaContentType String?           @map("evidencia_content_type") // image/jpeg|png|webp
  // --- REPROGRAMAR / DEVOLUCION / RECHAZO ---
  motivo               String?
  // --- REPROGRAMAR ---
  fechaReprogramacion  DateTime?         @map("fecha_reprogramacion") @db.Date
  createdAt            DateTime          @default(now()) @map("created_at")

  orden     Orden   @relation(fields: [ordenId], references: [id])
  mensajero Usuario @relation(fields: [mensajeroId], references: [id])

  @@index([ordenId])
  @@index([mensajeroId])
  @@map("gestion_orden")
}

enum GestionResultado {
  entregada
  reprogramada
  devuelta
  rechazada
  @@map("gestion_resultado")
}
```

- **RLS habilitada sin políticas anon/authenticated** (solo service role), patrón
  `mensajero_documento`/`orden`/`cobro` (R7).
- La evidencia guarda `storage_path` de bucket PRIVADO, nunca URL pública (R8); se firma al
  mostrar. `evidencia_content_type` acompaña para el `contentType` de la subida (patrón
  `mensajero_documento`).
- Lado inverso en `Orden` (`gestiones GestionOrden[]`) y `Usuario` (`gestionesRealizadas
  GestionOrden[]`). Nota: una orden puede acumular varias gestiones a lo largo de reintentos
  (features 46/47) — no se fuerza `@@unique(ordenId)`; en esta feature cada `aceptada` produce una
  gestión.

### 1.4 Bloqueo 1-a-1 persistente (R19–R21) `prov. F1.4-e`

**Recomendado:** puntero nullable en `usuario` a la orden que el mensajero tiene activa en
gestión, robusto ante recarga (R20):

```prisma
ordenEnGestionId String? @map("orden_en_gestion_id") // feature 36: orden activa 1-a-1; NULL = ninguna
```

- Al "escoger" una orden `aceptada`, el service setea `usuario.orden_en_gestion_id = ordenId`
  (solo si estaba NULL o ya apuntaba a esa orden → idempotente); intento de escoger otra con una
  activa distinta → `conflict` (R21).
- Al completar cualquiera de los 4 resultados (o al "soltar" explícitamente), se limpia
  (`orden_en_gestion_id = NULL`) dentro de la misma transacción → libera las demás (R19).
- Al recargar, "Mis asignaciones" lee `orden_en_gestion_id` del actor y renderiza esa orden como
  activa y las demás bloqueadas (R20).

> Alternativa (F1.4-e = solo-UI): se elimina la columna; el bloqueo vive solo en el estado del
> componente. El resto del diseño (services/actions) no cambia salvo por no persistir el puntero.

### 1.5 Migración (up/down OBLIGATORIO, R2/R3/R7)

`db/migrations/<ts>_gestion_orden_estados_metodo_pago/`:

`migration.sql` (UP), en orden:
```sql
-- 1) estados nuevos de order_status (patron features 17/28/30)
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'aceptada';
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'rechazada';
INSERT INTO "order_status" ("id","value") VALUES
  (gen_random_uuid()::text,'aceptada'),
  (gen_random_uuid()::text,'rechazada')
  ON CONFLICT ("value") DO NOTHING;

-- 2) enum metodo de pago
CREATE TYPE "metodo_pago_value" AS ENUM ('efectivo','simpe','transferencia');

-- 3) enum resultado de gestion
CREATE TYPE "gestion_resultado" AS ENUM ('entregada','reprogramada','devuelta','rechazada');

-- 4) puntero de bloqueo 1-a-1 (prov. F1.4-e)
ALTER TABLE "usuario" ADD COLUMN "orden_en_gestion_id" TEXT;
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_orden_en_gestion_id_fkey"
  FOREIGN KEY ("orden_en_gestion_id") REFERENCES "orden"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) tabla gestion_orden + RLS + indices + FKs
CREATE TABLE "gestion_orden" (
  "id" TEXT PRIMARY KEY,
  "orden_id" TEXT NOT NULL,
  "mensajero_id" TEXT NOT NULL,
  "resultado" "gestion_resultado" NOT NULL,
  "monto_recibido" DECIMAL(12,2),
  "metodo_pago" "metodo_pago_value",
  "evidencia_storage_path" TEXT,
  "evidencia_content_type" TEXT,
  "motivo" TEXT,
  "fecha_reprogramacion" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden"("id") ON UPDATE CASCADE;
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON UPDATE CASCADE;
CREATE INDEX "gestion_orden_orden_id_idx" ON "gestion_orden"("orden_id");
CREATE INDEX "gestion_orden_mensajero_id_idx" ON "gestion_orden"("mensajero_id");
ALTER TABLE "gestion_orden" ENABLE ROW LEVEL SECURITY;
```

`down.sql` (DOWN), en orden inverso:
```sql
DROP TABLE IF EXISTS "gestion_orden";
DROP TYPE IF EXISTS "gestion_resultado";
DROP TYPE IF EXISTS "metodo_pago_value";
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_orden_en_gestion_id_fkey";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "orden_en_gestion_id";
-- Revertir estados de catalogo SOLO si ninguna orden los referencia (patron feature 17):
DELETE FROM "order_status" WHERE "value" IN ('aceptada','rechazada')
  AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s ON o."estatus_id"=s."id"
    WHERE s."value" IN ('aceptada','rechazada'));
-- (los valores del enum order_status_value NO se eliminan: Postgres no soporta DROP VALUE;
--  inocuo mientras ninguna fila los referencie — mismo criterio que features 17/28/30.)
```

> Nota de riesgo (patrón feature 17 §1.1): `ALTER TYPE ... ADD VALUE` no puede ir dentro de una
> transacción en Postgres antiguos y un valor recién agregado no es usable en la MISMA
> transacción; el runner de migraciones ya maneja este patrón (features 17/30). `IF NOT EXISTS`
> lo hace idempotente.

---

## 2. Máquina de estados (transiciones de esta feature)

```
en_espera_aceptacion ──(aceptar, R15)──▶ aceptada
                                            │
        ┌───────────────────────────────────┼───────────────────────────────┐
   (entregar,R23)                     (reprogramar,R26)   (devolver,R28)  (rechazar,R30)
        ▼                                    ▼                 ▼               ▼
    entregada                          reprogramada         devuelta        rechazada
```

Guardias por estado de ORIGEN (R17/R18/R31):

| Acción | Origen permitido | Destino | Efectos |
| --- | --- | --- | --- |
| Aceptar | `en_espera_aceptacion` | `aceptada` | — (no toca `mensajero_asignado_id`) |
| Escoger para gestión | `aceptada` | `aceptada` | `usuario.orden_en_gestion_id = ordenId` |
| Entregar | `aceptada` | `entregada` | `gestion_orden(entregada)` + storage; limpia puntero |
| Reprogramar | `aceptada` | `reprogramada` | `gestion_orden(reprogramada)`; limpia puntero |
| Devolver | `aceptada` | `devuelta` | `gestion_orden(devuelta)`; limpia puntero |
| Rechazar | `aceptada` | `rechazada` | `gestion_orden(rechazada)` + storage; limpia puntero |

Toda acción valida además `orden.mensajero_asignado_id === actor.usuarioId` (R31). Origen o
propiedad inválidos → rechazo (`conflict`/`forbidden`) sin efectos en datos ni storage.

---

## 3. Capa de servicio

Nuevo `lib/services/MisAsignacionesService.ts` implementa
`lib/interfaces/services/IMisAsignacionesService.ts`. Separado de `OrdenService`/
`GuiaAsignacionService` (una responsabilidad por servicio, patrón feature 17 §3): su dominio es
el flujo del mensajero (aceptar + gestionar + storage de evidencias). Recibe por constructor
(DI por interfaces, testeable sin DB/red):

- `IGestionOrdenRepository` (nuevo) — persistencia de `gestion_orden`, transiciones de orden del
  mensajero y puntero de bloqueo.
- `IOrdenRepository` (extendido) — lectura de "mis asignaciones" y `findEstatusIdByValue`.
- `IFileStorage` (reuso feature 21) — subir/limpiar evidencias.
- `ISignedUrlProvider` (reuso feature 22) — firmar URLs de evidencia al listar/mostrar.

Autorización (R12): `actor.rol !== 'mensajero'` → `{ status: 'forbidden' }`. Sin actor →
`unauthenticated` (lo resuelve la action antes del service, patrón feature 17).

### 3.1 `listarMisAsignaciones(actor)` (R9–R13)
- Lee órdenes con `mensajero_asignado_id = actor.usuarioId`, `deleted_at IS NULL`, estado ∈
  {`en_espera_aceptacion`, `aceptada`}. Devuelve dos grupos (`porAceptar`, `porGestionar`) +
  `ordenEnGestionId` del actor (para el bloqueo, R20). Detalle completo por orden (R11) reusando
  la proyección del listado (`OrdenListItemDTO`-like con nombres de tienda/zona).

### 3.2 `aceptarAsignaciones(input, actor)` (R14–R17)
Input: `{ ordenIds: string[] }` (lote, R16 `prov. F1.4-g`).
1. Autorización de rol.
2. Cargar las órdenes (`findByIdsForTransicion` extendido para traer `mensajeroAsignadoId`).
3. Validar por orden: pertenece al actor (R17) y estado origen `en_espera_aceptacion` (R17);
   fallo → `forbidden`/`conflict`, aborta sin efectos.
4. Transacción: `UPDATE orden SET estatus_id = <aceptada> WHERE id IN (...) AND
   mensajero_asignado_id = actor AND estatus_id = <en_espera_aceptacion>`.

Resultado discriminado (patrón feature 17):
```ts
type AceptarResult =
  | { status: "ok"; aceptadas: string[] }
  | { status: "forbidden" }
  | { status: "conflict"; detalle: Array<{ ordenId: string; motivo: string }> };
```

### 3.3 `escogerParaGestion(ordenId, actor)` (R19–R21)
Setea `usuario.orden_en_gestion_id` (idempotente si ya apunta a esa orden); si apunta a otra →
`conflict` (R21). Requiere orden `aceptada` del actor.

### 3.4 `gestionar(input, actor, archivo?)` (R22–R32)
Contrato de entrada discriminado por `resultado` (validado con zod en la action):
```ts
type GestionarInput =
  | { ordenId: string; resultado: "entregada"; montoRecibido: number; metodoPago: MetodoPagoValue }   // + File evidencia
  | { ordenId: string; resultado: "reprogramada"; fechaReprogramacion: string; motivo: string }
  | { ordenId: string; resultado: "devuelta"; motivo: string }
  | { ordenId: string; resultado: "rechazada"; motivo: string };                                       // + File evidencia
```
Resultado:
```ts
type GestionarResult =
  | { status: "ok"; ordenId: string; estado: string }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };
```
Algoritmo:
1. Autorización de rol; cargar orden; validar propiedad (R31) y origen `aceptada` (R18/R31); si
   hay puntero de bloqueo y apunta a otra orden → `conflict` (R21).
2. Validación por resultado (R22/R25/R27/R29): campos obligatorios; `montoRecibido > 0`;
   `fechaReprogramacion` futura; motivo no vacío; foto MIME imagen + tamaño ≤ máx (R24).
3. **entregada/rechazada:** subir foto a bucket privado ANTES de la transacción, obtener
   `storage_path` (patrón feature 21 §3.2). Path recomendado:
   `{ordenId}/{resultado}-{timestamp}.{ext}` (no adivinable, único).
4. Transacción Prisma: `INSERT gestion_orden` (campos según resultado) + `UPDATE orden SET
   estatus_id = <resultado>` (via `findEstatusIdByValue`) + `UPDATE usuario SET
   orden_en_gestion_id = NULL` (libera, R19).
5. **Atomicidad de storage (R23/R30):** si la transacción falla tras subir → `IFileStorage.remove`
   best-effort; si la subida falla → abortar antes de escribir en DB (sin registro parcial).

### 3.5 Firma de evidencias (lectura)
Al listar/mostrar una gestión con evidencia, el service usa `ISignedUrlProvider.createSignedUrl`
(TTL corto, configurable) sobre `evidencia_storage_path` (patrón feature 22). Nunca se expone el
path crudo ni URL pública.

### 3.6 Repository (`IGestionOrdenRepository` / extensión de `IOrdenRepository`)
- `findMisAsignaciones(mensajeroId, estados: string[]): OrdenListItemDTO[]` (o método propio con
  la proyección de detalle) — filtrado en DB por mensajero (R13).
- `getOrdenEnGestion(mensajeroId): string | null`.
- `setOrdenEnGestion(mensajeroId, ordenId | null): void` (idempotente, con guardia de conflicto).
- `aceptarLote(tx, ordenIds, mensajeroId, aceptadaEstatusId): number` (UPDATE con guardia de
  origen y propiedad en el WHERE).
- `crearGestionYTransicionar(tx, { ordenId, mensajeroId, gestionData, nuevoEstatusId }): void`
  (INSERT `gestion_orden` + UPDATE `orden.estatus_id` + limpiar puntero). Bajo
  `prisma.$transaction`.
- Reusa `findEstatusIdByValue(value)` existente (`IOrdenRepository`).

---

## 4. Capa de acción (Server Actions) y UI

### 4.1 Server Actions — `lib/actions/mis-asignaciones.ts` (`'use server'`)
Patrón `lib/actions/ordenes-guia.ts` (resuelve actor, valida con zod, delega en service,
`withErrorHandler` + traducción de `AppErrorShape`):
- `listarMisAsignaciones(deps?)` — solo `mensajero`; devuelve grupos + evidencias firmadas.
- `aceptarAsignaciones(input, deps?)` — zod `aceptarSchema` (`{ ordenIds: string[].min(1) }`).
- `escogerParaGestion(input, deps?)`.
- `gestionar(formData, deps?)` — **recibe `FormData`** (campos + `File` de evidencia en
  entrega/rechazo), porque las Server Actions soportan archivos nativamente y evita crear una
  Route API (patrón feature 21 §3.1). zod discriminado por `resultado` (`gestionarSchema`),
  revalida MIME/tamaño de la foto en servidor (R24).

Todas devuelven `forbidden`/`conflict`/`validation_error` como resultado de dominio (no
excepción), y `unauthenticated` desde el borde (patrón feature 17).

### 4.2 UI — `app/(app)/mis-asignaciones/` (rol `mensajero`)
- `page.tsx` (Server Component): resuelve actor por `cookies()` (`resolveActorFromSession`); si
  `rol !== 'mensajero'` → no renderiza el módulo (o redirige). Pre-fetch de "mis asignaciones" y
  pasa datos a componentes `private/` por props (architecture.md).
- Componente cliente `_components/MisAsignacionesModule.tsx`: dos apartados (R10) —
  "Por aceptar" (`en_espera_aceptacion`) y "Por gestionar" (`aceptada`) — con DataTable (feature
  7) + Paginación (feature 8) y el detalle completo por orden (R11).
- **Por aceptar:** botón "Aceptar" (lote, R16) — única acción (R14, sin "rechazar"). Modal async
  (feature 13) de confirmación → `aceptarAsignaciones`.
- **Por gestionar:** al "escoger" una orden se marca activa (`escogerParaGestion`) y las demás se
  deshabilitan (R19); el estado activo viene de `ordenEnGestionId` del backend (R20). Modal de
  gestión con selección de resultado (4 opciones) y campos condicionales:
  - ENTREGADA: `input[type=file] accept="image/*"` + `monto` + select `metodo_pago`.
  - REPROGRAMAR: date picker (fecha futura) + `motivo`.
  - DEVOLUCIÓN: `motivo`.
  - RECHAZO: `input[type=file]` + `motivo`.
  Envía `FormData` a `gestionar`. `ok` → Toast (feature 11) + refresco; error de dominio → error
  por campo/Toast.
- Sidebar: agregar item "Mis asignaciones" en `app/(app)/_components/Sidebar.tsx` visible para
  `mensajero` (los items del sidebar no son hoy sensibles al rol; ver Nota de riesgo).

### 4.3 Config — `lib/config/gestion.ts` (patrón `postulacion.ts`)
`GESTION_EVIDENCIA_BUCKET` (default `gestion-evidencias`, `prov. F1.4-f`), `MAX_FILE_BYTES`,
MIME permitidos (`image/jpeg|png|webp`), TTL de URL firmada — todo por env, sin hardcode
(architecture.md "sin hardcode de contexto"). Se crea el bucket privado por script/seed (no
público), como `mensajero-docs`.

---

## 5. Alternativas descartadas (obligatorio)

### A. Tablas separadas por resultado (entrega/reprogramacion/devolucion/rechazo) — DESCARTADA
Normalizar los NOT-NULL por tipo con una tabla por resultado. **Descartada** `prov. F1.4-d`:
(1) los consumidores (features 37/38 cierre) leen "la gestión de la orden" — con 4 tablas cada
lectura une 4 orígenes; (2) multiplica migraciones y RLS; (3) el volumen de campos (≤ 5) no
justifica la normalización. → Un `gestion_orden` con discriminador `resultado` + nullables.

### B. Evidencias como `bytea`/base64 en Postgres — DESCARTADA
Guardar la foto en la DB. **Descartada** (mismo argumento que feature 21 §2): infla base/backups
con binarios, no aprovecha CDN/URLs firmadas, y complica el límite de payload de Server Actions.
→ Supabase Storage privado + `storage_path` + URL firmada (reuso `IFileStorage`/`ISignedUrlProvider`).

### C. Bloqueo 1-a-1 solo en la UI — DESCARTADA (recomendación, ver F1.4-e)
Deshabilitar las demás órdenes solo mientras el modal está abierto. **Descartada** como opción
por defecto porque no sobrevive a una recarga ni a dos pestañas: dos órdenes podrían gestionarse
en paralelo, violando la regla de negocio. → Puntero `usuario.orden_en_gestion_id` persistido +
guardia de `conflict` en el service (R20/R21). (Queda como alternativa formal para F1.4-e.)

### D. Reusar `OrdenService.actualizar` para las transiciones del mensajero — DESCARTADA
Empujar aceptar/gestionar por el `actualizar` genérico (que ya toca `estatusId`). **Descartada**
(mismo criterio que feature 17 §5.D): `actualizar` no ofrece subida de evidencia atómica, ni
guardia por propiedad/origen del mensajero, ni el puntero de bloqueo; mezclarlo degradaría un
CRUD estable. → Servicio dedicado `MisAsignacionesService`.

### E. Método de pago como tabla-catálogo con FK — DESCARTADA (recomendación, ver F1.4-c)
Tabla `metodo_pago` + FK (patrón `order_status`). **Descartada** como opción por defecto: 3
valores fijos, no administrables por UI ni referenciados por múltiples tablas; un enum nativo da
tipado exhaustivo sin tabla/FK/seed extra. (Queda como alternativa formal para F1.4-c.)

---

## 6. Notas de riesgo para el implementer (no bloquean el spec)

- **Sidebar por rol:** hoy `SIDEBAR_ITEMS` es estático y no filtra por rol. Añadir "Mis
  asignaciones" requiere decidir visibilidad por rol (mostrar solo a `mensajero`) — coordinar con
  el patrón de `app/(app)/page.tsx`/`ordenes/page.tsx` (rol resuelto server-side). No inventar un
  sistema de menús por rol si no existe; como mínimo, la PÁGINA valida el rol (defensa real).
- **`ALTER TYPE ADD VALUE` fuera de transacción:** ver §1.5 (patrón features 17/30).
- **`estatus-label` exhaustivo (R33):** añadir `aceptada`/`rechazada` o el build rompe
  (esperado, no silenciar).
- **Dependencia feature 34 `pending`:** "Mis asignaciones" ya cubre asignaciones de satélite por
  diseño (filtra por `mensajero_asignado_id`). No se construye la 34 aquí; confirmar F1.4-j.
- **Storage no unit-testeable:** subir/firmar reales se testean con dobles de
  `IFileStorage`/`ISignedUrlProvider` (sin red), patrón features 21/22 (R34).
- **Órdenes con varias gestiones (46/47):** el modelo no fuerza `@@unique(ordenId)` para no
  bloquear reintentos futuros; en esta feature cada orden `aceptada` produce una gestión.

## 7. Trazabilidad R → test

La tabla completa `R1`–`R34` vive en `requirements.md > Tabla de trazabilidad`. El `implementer`
la reproduce con rutas de test concretas en `progress/impl_36-mensajero-mis-asignaciones.md`
(CHECKPOINTS: cada `R<n>` → al menos un test; storage mockeado).
