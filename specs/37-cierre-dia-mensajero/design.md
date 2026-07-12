# Feature 37 — Mensajero: "Cierre del día" · design.md

Zone: `fullstack` · complexity: `high` · depends_on: 36 (`done`) · branch: `feature/37-cierre-dia-mensajero`

> Puerta **F1.4 ABIERTA**. Este design implementa los requisitos con los valores
> **recomendados** de las decisiones (`prov. F1.4-x`, ver `requirements.md > Preguntas
> abiertas`). Si el humano elige otra opción, se ajustan los puntos marcados sin reescribir la
> arquitectura (los enganches service/repo/action son estables). **No se implementa hasta cerrar F1.4.**

Arquitectura por capas (`docs/architecture.md`): Controller (Server Action `'use server'`) →
Service (lógica de negocio pura, testeable, DI por interfaces) → Repository (Prisma).
Mutaciones internas por Server Action, nunca `fetch` a rutas internas. Entrada externa validada
con zod en el borde. Errores vía `withErrorHandler` + traducción de `AppErrorShape` (features
10/11), patrón `lib/actions/recepcion-satelite.ts` / `lib/actions/mis-asignaciones.ts`.

---

## 1. Modelo de datos

### 1.1 Enum `cierre_estado` (R13/R18) `prov. F1.4-d`

Enum Postgres nativo, patrón `GestionResultado`/`RolValue`. Fuente única de verdad en
`lib/types/cierre.ts`:

```ts
export const CIERRE_ESTADO_SEED = ["solicitado", "aprobado", "rechazado"] as const;
export type CierreEstado = (typeof CIERRE_ESTADO_SEED)[number];
```

```prisma
enum CierreEstado {
  solicitado   // la 37 SOLO crea en este estado
  aprobado     // reservado para la feature 38
  rechazado    // reservado para la feature 38
  @@map("cierre_estado")
}
```

> La 37 nunca escribe `aprobado`/`rechazado`; existen en el enum para que la feature 38 no
> requiera una migración de enum adicional (patrón "reservar valores").

### 1.2 Enum `cierre_destino_tipo` (R15) `prov. F1.4-e`

```prisma
enum CierreDestinoTipo {
  bodega_central     // zona del mensajero es GAM -> admin maestro
  bodega_satelite    // resto -> adminSatelite de la zona
  @@map("cierre_destino_tipo")
}
```

### 1.3 Tabla `cierre_dia` (R13–R16/R18/R19) `prov. F1.4-a,e,f`

Un registro por solicitud de cierre. Los totales se **snapshotean** al crear (R14, money-critical);
el detalle se deriva de las `gestion_orden` vinculadas.

```prisma
model CierreDia {
  id                 String            @id @default(uuid())
  mensajeroId        String            @map("mensajero_id")   // FK -> usuario (el actor)
  estado             CierreEstado      @default(solicitado)
  // --- destino derivado server-side al solicitar (para la feature 38) ---
  destinoTipo        CierreDestinoTipo @map("destino_tipo")
  destinoZonaId      String            @map("destino_zona_id") // zona del mensajero (GAM o satelite)
  // --- totales snapshot por metodo de pago + general (money-critical, R14) ---
  totalEfectivo      Decimal           @default(0) @map("total_efectivo") @db.Decimal(12, 2)
  totalSimpe         Decimal           @default(0) @map("total_simpe") @db.Decimal(12, 2)
  totalTransferencia Decimal           @default(0) @map("total_transferencia") @db.Decimal(12, 2)
  totalGeneral       Decimal           @default(0) @map("total_general") @db.Decimal(12, 2)
  solicitadoAt       DateTime          @default(now()) @map("solicitado_at")
  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")

  mensajero    Usuario        @relation("CierreMensajero", fields: [mensajeroId], references: [id])
  destinoZona  Zona           @relation(fields: [destinoZonaId], references: [id])
  gestiones    GestionOrden[] // gestiones incluidas en este cierre (cierre_id)

  @@index([mensajeroId])
  @@index([destinoTipo, destinoZonaId]) // la feature 38 filtra por rol+zona destino
  @@index([estado])
  @@map("cierre_dia")
}
```

- **RLS habilitada sin políticas anon/authenticated** (solo service role), patrón
  `gestion_orden`/`orden`/`mensajero_documento` (R19).
- Lado inverso: `Usuario` (`cierresRealizados CierreDia[] @relation("CierreMensajero")`),
  `Zona` (`cierresDestino CierreDia[]`).

### 1.4 FK `cierre_id` en `gestion_orden` (R13) `prov. F1.4-a,b`

Vínculo nullable: una gestión pertenece a un cierre solo cuando se solicita. `cierre_id IS
NULL` = gestión "del día" aún no cerrada (fuente del listado, R3).

```prisma
// añadir a model GestionOrden (db/schema.prisma, feature 36):
cierreId String?    @map("cierre_id")
cierre   CierreDia? @relation(fields: [cierreId], references: [id])
// + @@index([cierreId])
```

> Alternativa `prov. F1.4-b`: agrupar por fecha calendario en vez de por puntero. Se descarta
> (§5.A). La FK nullable es robusta al corte de medianoche que añadirá la feature 41.

### 1.5 Migración (up/down OBLIGATORIO, R19/R20)

`db/migrations/<ts>_cierre_dia/`. Patrón features 30/33/36.

`migration.sql` (UP), en orden:
```sql
-- 1) enums
CREATE TYPE "cierre_estado" AS ENUM ('solicitado','aprobado','rechazado');
CREATE TYPE "cierre_destino_tipo" AS ENUM ('bodega_central','bodega_satelite');

-- 2) tabla cierre_dia + FKs + indices + RLS
CREATE TABLE "cierre_dia" (
  "id" TEXT PRIMARY KEY,
  "mensajero_id" TEXT NOT NULL,
  "estado" "cierre_estado" NOT NULL DEFAULT 'solicitado',
  "destino_tipo" "cierre_destino_tipo" NOT NULL,
  "destino_zona_id" TEXT NOT NULL,
  "total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_simpe" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_general" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "solicitado_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON UPDATE CASCADE;
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_destino_zona_id_fkey"
  FOREIGN KEY ("destino_zona_id") REFERENCES "zona"("id") ON UPDATE CASCADE;
CREATE INDEX "cierre_dia_mensajero_id_idx" ON "cierre_dia"("mensajero_id");
CREATE INDEX "cierre_dia_destino_tipo_destino_zona_id_idx" ON "cierre_dia"("destino_tipo","destino_zona_id");
CREATE INDEX "cierre_dia_estado_idx" ON "cierre_dia"("estado");
ALTER TABLE "cierre_dia" ENABLE ROW LEVEL SECURITY;

-- 3) FK nullable cierre_id en gestion_orden
ALTER TABLE "gestion_orden" ADD COLUMN "cierre_id" TEXT;
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_cierre_id_fkey"
  FOREIGN KEY ("cierre_id") REFERENCES "cierre_dia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "gestion_orden_cierre_id_idx" ON "gestion_orden"("cierre_id");
```

`down.sql` (DOWN), en orden inverso:
```sql
ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_cierre_id_fkey";
DROP INDEX IF EXISTS "gestion_orden_cierre_id_idx";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "cierre_id";
DROP TABLE IF EXISTS "cierre_dia";
DROP TYPE IF EXISTS "cierre_destino_tipo";
DROP TYPE IF EXISTS "cierre_estado";
```

> `CREATE TYPE`/`CREATE TABLE` sí van en transacción (a diferencia de `ALTER TYPE ADD VALUE`
> de features 17/30/36). Sin riesgo del patrón enum-existente.

---

## 2. Contratos (I/O)

### 2.1 Listar el día + totales (R2–R9)

```ts
type CierreDetalleGestion = {
  gestionId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  zonaNombre: string;
  provinciaNombre: string; cantonNombre: string; distritoNombre: string | null;
  producto: string;
  tiendaNombre: string;
  resultado: "entregada" | "reprogramada" | "devuelta" | "rechazada";
  montoRecibido: string | null;   // Decimal serializado a string (money-safe), solo entregada
  metodoPago: "efectivo" | "SIMPE" | "transferencia" | null;
  motivo: string | null;
  fechaReprogramacion: string | null; // ISO date, solo reprogramada
  evidenciaUrl: string | null;    // URL FIRMADA (R5), nunca el storage_path
};

type CierreTotales = {
  efectivo: string; simpe: string; transferencia: string; general: string; // Decimal->string
};

type ListarCierreDiaResult =
  | { status: "ok";
      grupos: Record<CierreDetalleGestion["resultado"], CierreDetalleGestion[]>;
      totales: CierreTotales;
      puedesSolicitar: boolean;         // R10/R11: false si hay pendientes o no hay gestiones
      motivoBloqueo: string | null;     // texto accionable si !puedesSolicitar
      cierresPasados: CierrePasadoDTO[]; // R18
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
```

> **Money-safe:** los `Decimal` se serializan como **string** cruzando la frontera Server
> Action → cliente (no `number`), para no perder precisión (R9). El cálculo se hace con
> `Prisma.Decimal` en el service/repo.

### 2.2 Solicitar cierre (R10–R16)

```ts
// sin input de negocio: el actor y sus gestiones pendientes lo determinan todo.
type SolicitarCierreResult =
  | { status: "ok"; cierreId: string; totales: CierreTotales; destinoTipo: CierreDestinoTipo }
  | { status: "forbidden" }        // rol != mensajero
  | { status: "conflict"; motivo: string }          // R10 pendientes / R11 vacío / R12 duplicado
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R16 sin zona
```

---

## 3. Capa de servicio — `lib/services/CierreDiaService.ts`

Implementa `lib/interfaces/services/ICierreDiaService.ts`. Responsabilidad única: el cierre del
mensajero. DI por constructor (testeable sin DB/red), patrón `RecepcionSateliteService` /
`AsignacionSateliteService`:

- `ICierreDiaRepository` (nuevo) — lectura de gestiones pendientes con detalle de orden, conteo
  de órdenes pendientes de gestión, existencia de cierre `solicitado`, creación transaccional
  del cierre, lista de cierres pasados.
- `IZonaRepository` (reuso feature 30) — `findGamZonaId()` para el ruteo (R15).
- `IOrdenRepository` (reuso) — `findUsuarioZonaId(actor)` (zona del mensajero, feature 33).
- `ISignedUrlProvider` (reuso feature 22) — firmar `evidenciaStoragePath` al listar (R5).

Autorización (R1/R2): `actor.rol !== 'mensajero'` → `{ status: 'forbidden' }`; sin actor →
`unauthenticated` (lo resuelve la action antes del service, patrón features 33/36).

### 3.1 `listarCierreDia(actor)` (R2–R11, R17, R18)
1. Autorización de rol.
2. `repo.findGestionesPendientes(actor.usuarioId)` — gestiones con `cierre_id IS NULL` +
   detalle de orden (join a `orden`/`tienda`/geografía). **Solo lectura** (R17).
3. Agrupar por `resultado` (R3) y armar el detalle por orden (R4).
4. **Totales (R7/R8/R9):** sumar `montoRecibido` de las `entregada` por `metodoPago` con
   `Prisma.Decimal`; reprogramada/devuelta/rechazada aportan 0. Total general = suma de los tres.
5. Firmar evidencias (R5) con `ISignedUrlProvider.createSignedUrl` (TTL corto configurable).
6. `puedesSolicitar` (R10/R11): `repo.contarOrdenesPendientesGestion(actor) === 0` **y**
   hay ≥ 1 gestión pendiente; en caso contrario `motivoBloqueo` accionable.
7. `cierresPasados`: `repo.findCierresByMensajero(actor)` (R18).

### 3.2 `solicitarCierre(actor)` (R10–R16)
1. Autorización de rol.
2. **Precondición R10:** `contarOrdenesPendientesGestion(actor) === 0`; si no →
   `{ status: 'conflict', motivo: 'Tenés órdenes sin gestionar; gestionalas antes de cerrar.' }`.
3. **R12 (duplicado):** si `existeCierreSolicitado(actor)` → `conflict`.
4. Cargar gestiones pendientes (`cierre_id IS NULL`). **R11:** si vacío → `conflict`.
5. **Ruteo R15/R16:** `zonaId = ordenRepo.findUsuarioZonaId(actor)`; si `null` →
   `validation_error` (R16). `gamZonaId = zonaRepo.findGamZonaId()`;
   `destinoTipo = (zonaId === gamZonaId) ? bodega_central : bodega_satelite`;
   `destinoZonaId = zonaId`.
6. **Totales snapshot R14:** calcular con `Prisma.Decimal` (mismo cálculo que 3.1.4).
7. **Transacción Prisma** (`repo.crearCierre`): `INSERT cierre_dia` (destino + totales) +
   `UPDATE gestion_orden SET cierre_id = <nuevo> WHERE mensajero_id = actor AND cierre_id IS
   NULL` (guardia de propiedad y de no-cerradas en el WHERE → concurrencia-segura). Devuelve id.
8. Retorna `{ ok, cierreId, totales, destinoTipo }`.

### 3.3 Repository — `ICierreDiaRepository` / `CierreDiaRepository`
- `findGestionesPendientes(mensajeroId): CierreDetalleRow[]` — `gestion_orden` con `cierre_id
  IS NULL` + include de `orden` (num_guia, num_remision, destinatario, dirección, geografía,
  producto, tienda). Solo query.
- `contarOrdenesPendientesGestion(mensajeroId): number` — `orden` con `mensajero_asignado_id =
  mensajeroId`, `deleted_at IS NULL`, `estatus.value IN ('en_espera_aceptacion','en_reparto')`.
- `existeCierreSolicitado(mensajeroId): boolean`.
- `crearCierre(tx, { mensajeroId, destinoTipo, destinoZonaId, totales }): string` — INSERT +
  UPDATE de vínculo, bajo `prisma.$transaction`.
- `findCierresByMensajero(mensajeroId): CierrePasadoDTO[]` (R18).

---

## 4. Capa de acción (Server Actions) y UI

### 4.1 Server Actions — `lib/actions/cierre-dia.ts` (`'use server'`)
Patrón `lib/actions/recepcion-satelite.ts` (resuelve actor, `withErrorHandler`, deps inyectables
en tests, `UnauthenticatedError` en el borde):
- `listarCierreDia(deps?)` — solo `mensajero`; devuelve grupos + totales + `puedesSolicitar` +
  cierres pasados con evidencias firmadas.
- `solicitarCierre(deps?)` — sin input de negocio; delega en el service; devuelve el resultado
  de dominio (`conflict`/`validation_error`/`forbidden`) sin excepción.

### 4.2 UI — `app/(app)/cierre-dia/` (rol `mensajero`)
- `page.tsx` (Server Component): resuelve actor por `cookies()` (`resolveActorFromSession`); si
  `rol !== 'mensajero'` → `notFound()` (R1). Pre-fetch del detalle+totales y pasa datos a
  componentes `private/` por props (architecture.md).
- `_components/CierreDiaModule.tsx` (cliente): cuatro secciones por resultado (entregadas /
  reprogramadas / devueltas / rechazadas) con DataTable (feature 7) + detalle por orden (R4) y
  visor de evidencia (URL firmada, R5). Panel de **totales** (efectivo / SIMPE / transferencia /
  general, R7). Botón **"Solicitar cierre"** deshabilitado si `!puedesSolicitar`, con el
  `motivoBloqueo` como tooltip/aviso (R10/R11). Confirmación con Modal async (feature 13) →
  `solicitarCierre`; `ok` → Toast (feature 11) + refresco; error de dominio → Toast.
- Sección "Cierres solicitados" (solo lectura) con estado y totales (R18).
- Sidebar: item "Cierre del día" visible para `mensajero` (misma nota de riesgo de sidebar por
  rol que feature 36 §6; la defensa real es la validación de rol en la página).

### 4.3 Config — `lib/config/cierre.ts`
TTL de la URL firmada de evidencia (reuso del bucket privado de la feature 36, sin hardcode;
architecture.md "sin hardcode de contexto"). Sin secretos en repo.

---

## 5. Alternativas descartadas (obligatorio)

### A. Cierre derivado on-the-fly SIN tabla `cierre_dia` — DESCARTADA `prov. F1.4-a`
Calcular el "cierre" siempre agrupando gestiones por fecha, sin persistir nada. **Descartada:**
las features 38 (aprobar/rechazar), 40 (cierre satélite→central) y 41 (bloqueos, vencidos)
necesitan una **entidad persistente** con estado, destino y totales congelados; sin ella no hay
dónde colgar la aprobación ni el bloqueo. → Tabla `cierre_dia` + FK `cierre_id`.

### B. Agrupar el "día" por fecha calendario en vez de por puntero `cierre_id` — DESCARTADA `prov. F1.4-b`
Definir el cierre como "las gestiones con `created_at` de hoy". **Descartada:** (1) frágil ante
gestiones a caballo de medianoche y ante reintentos (features 46/47); (2) la feature 41 introduce
un corte de medianoche explícito que quedaría en conflicto con un agrupado por fecha implícito.
→ Puntero `cierre_id IS NULL` = pendiente; el cierre "consume" el set al solicitar.

### C. Derivar los totales siempre (sin snapshot) — DESCARTADA `prov. F1.4-f`
No guardar `total_*` en `cierre_dia` y recomputarlos al mostrar. **Descartada** por ser
money-critical: si una gestión cambiara tras solicitar, el número que el admin aprobó (feature 38)
divergiría del recomputado. → **Snapshot** de totales al crear (R14); el detalle sí se deriva de
las gestiones vinculadas (inmutables por su `cierre_id`).

### D. Fijar `destino_admin_id` (un adminSatelite puntual) en el cierre — DESCARTADA `prov. F1.4-e`
Guardar el usuario admin concreto destinatario. **Descartada:** una bodega puede tener varios
adminSatelite/maestros; fijar uno rompería si ese usuario se inactiva. → Guardar
`destino_tipo` + `destino_zona_id`; la feature 38 resuelve el/los admin por rol+zona en su consulta.

### E. Reusar `MisAsignacionesService` (feature 36) para el cierre — DESCARTADA
Empujar el listado+totales+solicitud por el servicio del mensajero de la 36. **Descartada**
(mismo criterio que features 17/36 §5.D): mezclaría dos dominios (gestión de órdenes vs. cierre
de caja) y su set de dependencias (storage/bloqueo vs. zona/ruteo/totales), degradando un
servicio estable. → Servicio dedicado `CierreDiaService`.

---

## 6. Notas de riesgo para el implementer (no bloquean el spec)

- **Drift `zona.esGam`:** el flag GAM lo resuelve `IZonaRepository.findGamZonaId()` (usado por
  feature 30 y `OrdenRepository.esGam`). El snapshot de `db/schema.prisma` que se lea puede no
  mostrar `esGam` en `model Zona`; **usar el resolver existente `findGamZonaId()`**, no leer la
  columna directamente ni asumir su nombre. Si Prisma se queja de drift, sincronizar el schema
  antes (fuera del alcance de esta feature) y avisar al leader.
- **Money-safe cruzando la frontera:** serializar `Decimal` como **string** en los DTO de Server
  Action (no `number`); sumar con `Prisma.Decimal`. El reviewer rechaza `parseFloat` sobre montos.
- **Concurrencia del vínculo:** el `UPDATE ... WHERE cierre_id IS NULL AND mensajero_id = actor`
  hace idempotente/atómico el "consumir" las gestiones; no leer-luego-escribir sin guardia.
- **RLS obligatoria** en `cierre_dia` (patrón `gestion_orden`); sin políticas anon/authenticated.
- **Sidebar por rol:** ver feature 36 §6 (la defensa real es el `notFound` de la página).
- **Storage no unit-testeable:** firmar evidencias se testea con doble de `ISignedUrlProvider`
  (sin red), patrón features 21/22/36.

## 7. Trazabilidad R → test

La tabla `R1`–`R20` (+ E2E) vive en `requirements.md > Tabla de trazabilidad`. El `implementer`
la reproduce con rutas de test concretas en `progress/impl_37-cierre-dia-mensajero.md`
(CHECKPOINTS: cada `R<n>` → al menos un test; storage mockeado; E2E si F1.4-g = sí).
