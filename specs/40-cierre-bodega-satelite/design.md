# Feature 40 — Cierre de bodega satélite → bodega principal · design.md

Zone: `fullstack` · complexity: `high` · depends_on: 38 (`done`, transitivamente 37) · branch: `feature/40-cierre-bodega-satelite`

> Puerta **F1.4 ABIERTA**. Este design implementa los requisitos con los valores **recomendados**
> de `requirements.md > Preguntas abiertas` (`prov. F1.4-x`). Si el humano elige otra opción, se
> ajustan los puntos marcados sin reescribir la arquitectura (los enganches action/service/repo son
> estables). **No se implementa hasta cerrar F1.4.**

Arquitectura por capas (`docs/architecture.md`): Controller (Server Action `'use server'`) → Service
(lógica de negocio pura, DI por interfaces, testeable sin DB/red) → Repository (Prisma). Mutaciones
internas por Server Action, nunca `fetch` a rutas internas. Entrada externa validada con zod en el
borde. Errores vía `withErrorHandler` + traducción de `AppErrorShape` (patrón
`lib/actions/cierres-admin.ts`). Money-safe: los `Decimal` cruzan como **string**.

La 40 es un **doble espejo**:
- El lado **adminSatelite (solicitar)** es el espejo de la feature 37 (mensajero solicita `cierre_dia`),
  pero un nivel arriba: agrega `cierre_dia` `aprobado` en un `CierreBodega`.
- El lado **maestro (aprobar/rechazar)** es el espejo de la feature 38 (admin resuelve `cierre_dia`),
  aplicado a `CierreBodega`.

---

## 1. Modelo de datos

### 1.1 Tabla nueva `CierreBodega` + FK en `cierre_dia` (`prov. F1.4-a/b/e/g/k`)

```prisma
// Feature 40: cierre de NIVEL BODEGA. El adminSatelite consolida los cierre_dia
// `aprobado` de su zona y solicita el cierre a la bodega central; el maestro lo
// aprueba/rechaza. Reusa el enum CierreEstado (37). Totales agregados SNAPSHOT
// (money-critical). Auditoria del maestro (patron feature 38). RLS habilitada sin
// policies (solo service role, patron cierre_dia/gestion_orden/orden).
model CierreBodega {
  id                 String       @id @default(uuid())
  zonaId             String       @map("zona_id")          // zona satelite que cierra
  solicitadoPor      String       @map("solicitado_por")   // adminSatelite actor (FK usuario)
  estado             CierreEstado @default(solicitado)     // reuso enum feature 37 (F1.4-b)
  totalEfectivo      Decimal      @default(0) @map("total_efectivo") @db.Decimal(12, 2)      // snapshot agregado R10
  totalSimpe         Decimal      @default(0) @map("total_simpe") @db.Decimal(12, 2)         // snapshot agregado R10
  totalTransferencia Decimal      @default(0) @map("total_transferencia") @db.Decimal(12, 2) // snapshot agregado R10
  totalGeneral       Decimal      @default(0) @map("total_general") @db.Decimal(12, 2)       // snapshot agregado R10
  solicitadoAt       DateTime     @default(now()) @map("solicitado_at")
  resueltoPor        String?      @map("resuelto_por")     // maestro actor; NULL mientras solicitado (R20)
  resueltoAt         DateTime?    @map("resuelto_at")      // marca de tiempo de la resolucion (R20)
  motivoRechazo      String?      @map("motivo_rechazo")   // obligatorio SOLO al rechazar (R17); NULL si aprobado/solicitado
  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")

  zona                 Zona        @relation(fields: [zonaId], references: [id])
  solicitadoPorUsuario Usuario     @relation("CierreBodegaSolicitadoPor", fields: [solicitadoPor], references: [id])
  resueltoPorUsuario   Usuario?    @relation("CierreBodegaResueltoPor", fields: [resueltoPor], references: [id])
  cierresDia           CierreDia[] // los cierre_dia incluidos (cierre_bodega_id)

  @@index([zonaId])
  @@index([estado])
  @@index([solicitadoPor])
  @@index([resueltoPor])
  @@map("cierre_bodega")
}
```

Añadir a `model CierreDia` (feature 37):
```prisma
cierreBodegaId String?       @map("cierre_bodega_id") // feature 40: nullable; NULL = cierre_dia aun no consolidado en bodega
cierreBodega   CierreBodega? @relation(fields: [cierreBodegaId], references: [id], onDelete: SetNull)
// + @@index([cierreBodegaId]) // feature 40: listar consolidables (cierre_bodega_id IS NULL)
```

Añadir a `model Usuario`:
```prisma
cierresBodegaSolicitados CierreBodega[] @relation("CierreBodegaSolicitadoPor")
cierresBodegaResueltos   CierreBodega[] @relation("CierreBodegaResueltoPor")
```

Añadir a `model Zona`:
```prisma
cierresBodega CierreBodega[]
```

> **No se añade `destinoTipo` al `CierreBodega`:** su destino es SIEMPRE la bodega central. El
> alcance del maestro es "todos los cierre de bodega" y el del adminSatelite es `zona_id = su zona`
> (columnas indexadas). (F1.4 abierta: si se quisiera destino variable, se añadiría; hoy es constante.)

### 1.2 Índice único parcial (R8/`prov. F1.4-g`)

A lo sumo un `CierreBodega` `solicitado` por zona a la vez, garantizado en la DB (espejo del índice
parcial `zona.esCentral`). Prisma no expresa índices parciales → va en el SQL de la migración:

```sql
CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"
  ON "cierre_bodega" ("zona_id") WHERE "estado" = 'solicitado';
```

### 1.3 Migración (up/down OBLIGATORIO, R24/R25)

`db/migrations/<ts>_cierre_bodega/`. Patrón features 37/38 (`CREATE TABLE` + FK + índices + RLS +
`ALTER TABLE ADD COLUMN`; todo en transacción, sin `ALTER TYPE ADD VALUE` porque se **reusa** el
enum `cierre_estado`).

`migration.sql` (UP), resumen:
```sql
-- 1) tabla cierre_bodega (reusa el enum cierre_estado de la feature 37).
CREATE TABLE "cierre_bodega" (
  "id" TEXT NOT NULL,
  "zona_id" TEXT NOT NULL,
  "solicitado_por" TEXT NOT NULL,
  "estado" "cierre_estado" NOT NULL DEFAULT 'solicitado',
  "total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_simpe" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_general" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "solicitado_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resuelto_por" TEXT,
  "resuelto_at" TIMESTAMP(3),
  "motivo_rechazo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cierre_bodega_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_solicitado_por_fkey"
  FOREIGN KEY ("solicitado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_resuelto_por_fkey"
  FOREIGN KEY ("resuelto_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cierre_bodega_zona_id_idx" ON "cierre_bodega"("zona_id");
CREATE INDEX "cierre_bodega_estado_idx" ON "cierre_bodega"("estado");
CREATE INDEX "cierre_bodega_solicitado_por_idx" ON "cierre_bodega"("solicitado_por");
CREATE INDEX "cierre_bodega_resuelto_por_idx" ON "cierre_bodega"("resuelto_por");
CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"
  ON "cierre_bodega"("zona_id") WHERE "estado" = 'solicitado';   -- R8/F1.4-g
ALTER TABLE "cierre_bodega" ENABLE ROW LEVEL SECURITY;           -- R24

-- 2) FK nullable cierre_bodega_id en cierre_dia (R9/R21). ON DELETE SET NULL.
ALTER TABLE "cierre_dia" ADD COLUMN "cierre_bodega_id" TEXT;
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_cierre_bodega_id_fkey"
  FOREIGN KEY ("cierre_bodega_id") REFERENCES "cierre_bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cierre_dia_cierre_bodega_id_idx" ON "cierre_dia"("cierre_bodega_id");
```

`down.sql` (DOWN, orden inverso):
```sql
DROP INDEX IF EXISTS "cierre_dia_cierre_bodega_id_idx";
ALTER TABLE "cierre_dia" DROP CONSTRAINT IF EXISTS "cierre_dia_cierre_bodega_id_fkey";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "cierre_bodega_id";
DROP TABLE IF EXISTS "cierre_bodega"; -- arrastra sus FKs e indices (incl. el unico parcial)
-- El enum cierre_estado NO se toca (es de la feature 37).
```

> RLS: `zona`/`usuario`/`cierre_dia` ya tienen RLS de migraciones previas; no se tocan. La tabla
> nueva la habilita el UP (sin policies → solo service role).

---

## 2. Contratos (I/O)

Se **reutilizan** `CierreTotales`, `CierreGrupos` y `CierreDetalleGestion` de
`lib/interfaces/services/ICierreDiaService.ts` (feature 37). Nuevos tipos de la 40
(`lib/interfaces/services/ICierreBodegaService.ts` y `.../ICierresBodegaAdminService.ts`):

```ts
// Cabecera de un cierre de bodega (cola/histórico maestro + histórico adminSatelite).
export interface CierreBodegaResumen {
  cierreBodegaId: string;
  zonaId: string;
  zonaNombre: string;
  solicitadoPorId: string;
  solicitadoPorNombre: string;    // resuelto (no id crudo)
  estado: CierreEstado;           // solicitado | aprobado | rechazado
  totales: CierreTotales;         // snapshot agregado (money-safe string, R13)
  cantidadCierres: number;        // # de cierre_dia incluidos
  solicitadoAt: string;           // ISO
  resueltoAt: string | null;      // ISO; null si solicitado (R20)
  motivoRechazo: string | null;   // solo rechazado (R17)
}

// Un cierre_dia incluido, con su detalle de gestiones (reuso 37) + su total snapshot.
export interface CierreBodegaDetalleCierre {
  cierreDiaId: string;
  mensajeroId: string;
  mensajeroNombre: string;
  totales: CierreTotales;         // snapshot del cierre_dia (money-safe)
  grupos: CierreGrupos;           // por resultado (reuso CierreDetalleGestion de la 37)
  // R14/F1.4-f: NO se incluye pago al mensajero (feature 39).
}

// --- Lado adminSatelite (solicitar): espejo de ICierreDiaService (feature 37) ---
export type ListarConsolidacionServiceResult =
  | {
      status: "ok";
      consolidables: CierreBodegaResumenLite[]; // cierre_dia aprobados sin cierre de bodega (R5)
      totalesAgregados: CierreTotales;          // suma de los consolidables (previo al snapshot)
      puedesSolicitar: boolean;                 // R6/R7
      motivoBloqueo: string | null;             // texto accionable si !puedesSolicitar
      cierresBodegaPasados: CierreBodegaResumen[]; // histórico propio de la zona (F1.4-h)
      sinZona: boolean;                         // adminSatelite sin zona (R4)
    }
  | { status: "forbidden" };                    // rol != adminSatelite (R1)

export type SolicitarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; totales: CierreTotales }
  | { status: "forbidden" }                      // rol != adminSatelite (R1)
  | { status: "conflict"; motivo: string }       // R6 solicitados pendientes / R7 vacío / R8 duplicado
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R4 sin zona

// --- Lado maestro (aprobar/rechazar): espejo de ICierresAdminService (feature 38) ---
export type ListarCierresBodegaAdminServiceResult =
  | { status: "ok"; pendientes: CierreBodegaResumen[]; historico: CierreBodegaResumen[] } // R15
  | { status: "forbidden" };                     // rol != maestro (R2)

export type CierreBodegaDetalleServiceResult =
  | { status: "ok"; cierre: CierreBodegaResumen; cierres: CierreBodegaDetalleCierre[] } // R11–R13
  | { status: "forbidden" }                       // rol != maestro (R2)
  | { status: "no_encontrada" };                  // id inexistente (R19)

export type AprobarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; estado: "aprobado" }   // R16
  | { status: "forbidden" } | { status: "no_encontrada" } | { status: "conflict" };

export type RechazarCierreBodegaServiceResult =
  | { status: "ok"; cierreBodegaId: string; estado: "rechazado" }  // R17
  | { status: "forbidden" } | { status: "no_encontrada" } | { status: "conflict" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // motivo vacío (R17)
```

`CierreBodegaResumenLite` = la cabecera de un `cierre_dia` consolidable (mensajero + totales
snapshot), reusando lo que la 37 ya expone en `CierrePasadoDTO`.

> **Money-safe:** los `Decimal` cruzan como **string** (nunca `number`/`parseFloat`); los totales
> del resumen son el **snapshot** (no se recomputan al mostrar).

---

## 3. Capa de servicio

Dos servicios dedicados (separación de dominios, mismo criterio que 37 §5.E / 38 alt. E: no se
ensancha `CierreDiaService`/`CierresAdminService`).

### 3.1 `CierreBodegaService` — lado adminSatelite (R1/R3–R10) — espejo de `CierreDiaService`
- DI por constructor (Pick de interfaces, dobles de test): `ICierreBodegaRepository`,
  `IOrdenRepository` (`findUsuarioZonaId`), `ISignedUrlProvider` (firmar evidencias del detalle, R12).
- Rol autorizado: `adminSatelite`; otro → `forbidden` (R1).
- `listarConsolidacion(actor)`:
  1. `zonaId = ordenRepo.findUsuarioZonaId(actor)`; `null` → `{ ...vacío, sinZona: true }` (R4).
  2. `repo.findCierresDiaConsolidables(zonaId)` (R5) + `repo.contarCierresDiaSolicitados(zonaId)` (R6)
     + `repo.findCierresBodegaByZona(zonaId)` (histórico F1.4-h).
  3. `totalesAgregados` = suma con `Prisma.Decimal` de los snapshots consolidables (exacto, string).
  4. Gate `puedesSolicitar`/`motivoBloqueo`: `solicitados>0` → bloqueo R6; `consolidables===0` →
     bloqueo R7.
- `solicitarCierreBodega(actor)`:
  1. Rol (R1) → `zonaId` (R4) → `contarCierresDiaSolicitados` (R6) → `findCierresDiaConsolidables`
     (R7) → `existeCierreBodegaSolicitado` (R8). Cualquiera falla → `conflict`/`validation_error`.
  2. `totales` = suma agregada de los consolidables (R10, mismo cálculo que 3.1.3).
  3. `repo.crearCierreBodega({ zonaId, solicitadoPor: actor.usuarioId, cierreDiaIds, totales })` (R9):
     transacción `INSERT cierre_bodega` + `updateMany cierre_dia SET cierre_bodega_id = nuevo WHERE
     id IN (cierreDiaIds) AND cierre_bodega_id IS NULL AND estado='aprobado' AND destino_zona_id=zona`
     (guardia de propiedad + no-consolidadas + aprobadas, concurrencia-segura).

### 3.2 `CierresBodegaAdminService` — lado maestro (R2/R11–R23) — espejo de `CierresAdminService`
- DI: `ICierresBodegaAdminRepository`, `ISignedUrlProvider` (R12). Rol autorizado: `maestro`
  (R2; el alcance del maestro es "todos los cierre de bodega", sin filtro de zona — todos van a la
  central).
- `listarCierresBodegaAdmin(actor)`: rol (R2) → `repo.findCierresBodega()` → partir por estado:
  `solicitado` → `pendientes` (R15); `aprobado`/`rechazado` → `historico` (F1.4-h). Totales snapshot
  string (R13). Sin firmar evidencias (la cabecera no las lleva).
- `verCierreBodegaDetalle(cierreBodegaId, actor)` (R11–R13, R19): rol (R2) →
  `repo.findCierreBodegaConDetalle(id)` (cierre + sus `cierre_dia` + gestiones `WITH_DETALLE`);
  `null` → `no_encontrada` (R19). Firmar en lote las evidencias con `ISignedUrlProvider`
  (`cierreConfig.SIGNED_URL_TTL_SECONDS`, reuso 37/38). Agrupar cada cierre_dia por resultado con
  `toDetalleDTO` (reuso 37). Totales = snapshot (R13).
- `aprobarCierreBodega(id, actor)` (R16/R18–R20) / `rechazarCierreBodega(id, motivo, actor)`
  (R17–R20): rol (R2); (rechazo) motivo no vacío → `validation_error` (R17). Delega en
  `repo.resolverCierreBodega({ id, nuevoEstado, resueltoPor: actor.usuarioId, motivoRechazo })`
  (§3.3). Mapear `updated`→`ok`; `conflict`→`conflict` (R18); `fuera_de_alcance`→`no_encontrada` (R19).

### 3.3 Transición guardada (R16–R22) — `resolverCierreBodega`

```ts
const res = await prisma.cierreBodega.updateMany({
  where: { id, estado: "solicitado" },                 // R18: guardia de estado (idempotente/race-safe)
  data: { estado: nuevoEstado, resueltoPor, resueltoAt: new Date(), motivoRechazo },
});
if (res.count === 1) return "updated";
const existe = await prisma.cierreBodega.count({ where: { id } });
return existe > 0 ? "conflict" : "fuera_de_alcance"; // R18 vs R19
```

> **R21/R22:** `resolverCierreBodega` NO toca `cierre_dia` (no desvincula `cierre_bodega_id`), NI la
> bodega, NI wallet. Un solo `UPDATE` de estado + auditoría (sin `$transaction` multi-tabla).

### 3.4 Repositorios (solo Prisma; alcance en el WHERE, nunca en memoria)

- `ICierreBodegaRepository` (adminSatelite):
  - `findCierresDiaConsolidables(zonaId): CierreDiaConsolidableRow[]` — `cierre_dia` WHERE
    `estado='aprobado' AND destino_tipo='bodega_satelite' AND destino_zona_id=zonaId AND
    cierre_bodega_id IS NULL` (R5). Usa `[destinoTipo, destinoZonaId]` + `[estado]`.
  - `contarCierresDiaSolicitados(zonaId): number` — WHERE `destino_tipo='bodega_satelite' AND
    destino_zona_id=zonaId AND estado='solicitado'` (R6).
  - `existeCierreBodegaSolicitado(zonaId): boolean` (R8).
  - `crearCierreBodega(input): string` — transacción INSERT + link (R9/R10).
  - `findCierresBodegaByZona(zonaId): CierreBodegaResumen[]` — histórico propio (F1.4-h).
- `ICierresBodegaAdminRepository` (maestro):
  - `findCierresBodega(): CierreBodegaResumenRow[]` — todos, join a `zona`/`usuario` para nombres +
    `_count.cierresDia`, `orderBy solicitadoAt desc` (R15). Money-safe → string.
  - `findCierreBodegaConDetalle(id): { cierre, cierresDia: { resumen, gestiones }[] } | null` — el
    cierre + sus `cierre_dia` (WHERE `cierre_bodega_id=id`) cada uno con sus gestiones `WITH_DETALLE`
    (reuso 37) (R11).
  - `resolverCierreBodega(input): 'updated'|'conflict'|'fuera_de_alcance'` (§3.3).

---

## 4. Capa de acción (Server Actions) y UI

### 4.1 Server Actions — `lib/actions/cierre-bodega.ts` (`'use server'`)
Patrón `lib/actions/cierres-admin.ts` (resuelve actor, `withErrorHandler`, deps inyectables,
`UnauthenticatedError` en el borde, zod para mutaciones, traducción de `AppErrorShape`):
- `listarConsolidacion(deps?)` — solo `adminSatelite` (R1).
- `solicitarCierreBodega(deps?)` — solo `adminSatelite`; sin input de negocio (R9).
- `listarCierresBodegaAdmin(deps?)` — solo `maestro` (R2).
- `verCierreBodegaDetalle(input, deps?)` — zod `{ cierreBodegaId: uuid }` (R11).
- `aprobarCierreBodega(input, deps?)` — zod `{ cierreBodegaId: uuid }` (R16).
- `rechazarCierreBodega(input, deps?)` — zod `{ cierreBodegaId: uuid, motivo: string ≥ 1 }` (R17).

`lib/types/cierre-bodega.ts`: schemas zod del borde + `*Result` (resultado de dominio +
`unauthenticated`), espejo de `lib/types/cierres-admin.ts`.

### 4.2 UI — extender `app/(app)/cierres-admin/` (`prov. F1.4-l`)
Recomendado: **misma ruta** `/cierres-admin` (feature 38), con una sección adicional "Cierre de
bodega". `page.tsx` (Server Component) resuelve el actor:
- `adminSatelite`: además de su cola de cierres de mensajero (38), una sección de **consolidación**
  (lista de `cierre_dia` aprobados consolidables + totales agregados) con botón **"Solicitar cierre
  de bodega"** (deshabilitado con motivo si `!puedesSolicitar`, R6/R7) y su **histórico** de cierres
  de bodega. Si `sinZona` (R4), estado vacío con aviso.
- `maestro`: además de su cola de cierres de mensajero (38), la **cola de cierres de bodega**
  `solicitado` + histórico; abrir uno → `verCierreBodegaDetalle` → Modal/Sheet (feature 13) con el
  detalle agregado (por cada cierre_dia, su detalle por resultado — reuso del render de la 37/38 —,
  visor de evidencia firmada R12, totales por cierre y agregados R11/R13). Botones **Aprobar** /
  **Rechazar** (Rechazar exige **motivo**, R17). Confirmación async → Server Action; `ok` → Toast +
  refresco; `conflict`/`no_encontrada`/`forbidden` → Toast accionable + refresco.
- Componentes sensibles en `private/`, datos por props desde el Server Component (architecture.md).
- Defensa real: `notFound()` server-side por rol (R1/R2). El item de sidebar ya existe
  (`/cierres-admin`, roles `maestro`/`adminSatelite`); no requiere cambio (la sección se muestra
  dentro). Si se opta por módulo nuevo (alternativa F1.4-l), añadir item en
  `lib/auth/menu-visibility.ts`.

### 4.3 Config — reuso `lib/config/cierre.ts`
`SIGNED_URL_TTL_SECONDS` + bucket privado de evidencias de la 36/37/38 (sin hardcode, sin secretos).

---

## 5. Alternativas descartadas (obligatorio)

### A. Cierre de bodega derivado on-the-fly sin tabla — DESCARTADA `prov. F1.4-a`
Calcular el "cierre de bodega" agrupando los `cierre_dia` aprobados al vuelo, sin entidad persistida.
**Descartada:** las features 41 (bloqueos/vencidos) y 42 (caja) necesitan aprobar/rechazar y alimentar
la caja sobre una **entidad estable** con snapshot congelado; sin tabla no hay dónde persistir la
aprobación del maestro ni el número money-critical. → Tabla `CierreBodega` + FK `cierre_bodega_id`
(espejo exacto de `gestion_orden.cierre_id` de la 37).

### B. Enum propio `CierreBodegaEstado` — DESCARTADA `prov. F1.4-b`
Un enum nuevo para el estado del cierre de bodega. **Descartada:** los valores
`solicitado`/`aprobado`/`rechazado` calzan idénticos a `CierreEstado` (37); duplicar el enum agrega
una migración de tipo y una segunda fuente de verdad sin aportar semántica. → Reuso de `CierreEstado`.

### C. Recomputar los totales agregados al mostrar — DESCARTADA `prov. F1.4-e`
Re-sumar los `cierre_dia` al abrir el cierre de bodega en vez de usar el snapshot. **Descartada** por
money-critical (mismo criterio que 37 §5.C / 38 alt. C): el maestro aprueba EXACTAMENTE el número
congelado al solicitar; recomputar arriesga divergencia si un `cierre_dia` cambiara. → **Snapshot**
agregado; el detalle deriva de las gestiones (inmutables por su `cierre_id`).

### D. Rechazo que DESVINCULA los `cierre_dia` (`cierre_bodega_id = null`) — DESCARTADA `prov. F1.4-j`
Al rechazar, poner `cierre_bodega_id = null` para re-consolidar de inmediato. **Descartada:** (1)
rompe la inmutabilidad del snapshot money-critical; (2) deja el cierre de bodega `rechazado` sin
detalle derivable; (3) el desbloqueo/re-solicitud de la bodega es responsabilidad explícita de la
**feature 41**. → Rechazo inmutable + `motivo_rechazo`; la 41 decide el desbloqueo.

### E. Transición sin guardia de estado (leer-comprobar-escribir) — DESCARTADA `prov. F1.4-j`
Leer el cierre de bodega, verificar `estado==='solicitado'` en memoria, luego `update`. **Descartada:**
race entre dos operaciones sobre el mismo cierre. → `updateMany ... WHERE id=X AND estado='solicitado'`;
`count` decide `updated`/`conflict` (atómico, patrón 38).

### F. Calcular el pago al mensajero aquí — DESCARTADA `prov. F1.4-f`
Incluir en el detalle el monto a pagar a cada mensajero por zona. **Descartada:** es el alcance
explícito de la **feature 39** (que depende de la 24/tarifas por zona). → Se omite; hueco = placeholder
nulo documentado para la 39 (R14).

### G. Incluir/bloquear por `cierre_dia` rechazados — DESCARTADA `prov. F1.4-c/d`
Incluir los `cierre_dia` `rechazado` en el cierre de bodega o bloquear la bodega mientras existan.
**Descartada:** un rechazado no aporta dinero cuadrado; su re-solicitud/desbloqueo lo maneja la 41.
→ Se consolidan SOLO los `aprobado`; los `rechazado` se excluyen y no bloquean; la precondición que sí
bloquea es tener `cierre_dia` `solicitado` sin resolver (R6).

### H. Un solo servicio para ambos lados — DESCARTADA
Meter solicitar (adminSatelite) y aprobar/rechazar (maestro) en un único servicio. **Descartada**
(criterio 37 §5.E / 38 alt. E): mezcla dos dominios/roles con dependencias distintas. →
`CierreBodegaService` (solicitar) + `CierresBodegaAdminService` (resolver), espejo de 37 y 38.

---

## 6. Notas de riesgo para el implementer (no bloquean el spec)

- **Alcance en el WHERE, no en memoria (R2/R3):** el filtro por `zona_id`/estado va en la query
  (repo), nunca cargando todo y filtrando en el service. El reviewer rechaza fugas de otra zona.
- **Guardia de estado obligatoria (R18):** transición vía `updateMany ... WHERE estado='solicitado'`;
  nunca `update` tras `findUnique`.
- **Link concurrencia-seguro (R9):** el `updateMany` que setea `cierre_bodega_id` DEBE llevar la
  guardia `cierre_bodega_id IS NULL AND estado='aprobado' AND destino_zona_id=zona` en el WHERE, para
  no consolidar dos veces ni robar cierre_dia de otra zona en una race.
- **Money-safe cruzando la frontera:** serializar `Decimal` como **string** (no `number`); no
  `parseFloat`. Totales agregados = snapshot (no recomputar). La suma agregada al solicitar usa
  `Prisma.Decimal` (exacto).
- **Evidencias solo firmadas (R12):** nunca exponer `evidenciaStoragePath`; firmar con TTL corto,
  patrón 21/22/36/37/38. Storage no unit-testeable → doble de `ISignedUrlProvider`.
- **Reuso del detalle de la 37:** `WITH_DETALLE`/`toPendienteRow` (`CierreDiaRepository`),
  `toDetalleDTO` (`CierreDiaService`), `CierreDetalleGestion`/`CierreGrupos`/`CierreTotales` — todos
  exportados. NO duplicar el mapper de detalle.
- **Índice único parcial (R8):** Prisma no lo expresa; va en el SQL de la migración (y por eso el
  schema Prisma NO lleva `@@unique` sobre `[zonaId]`). El service igual valida
  (`existeCierreBodegaSolicitado`) para un mensaje limpio; el índice es la defensa DB (una `P2002` en
  la creación se traduce a `conflict`).
- **RLS:** `cierre_bodega` la habilita el UP; `cierre_dia`/`zona`/`usuario` ya la tienen (no se tocan).
- **`maestro` sin zona:** el maestro es global; su alcance es "todos los cierre de bodega" sin filtro
  de zona (no pasar zona al WHERE).

## 7. Trazabilidad R → test
La tabla `R1`–`R25` (+ E2E) vive en `requirements.md > Tabla de trazabilidad`. El `implementer` la
reproduce con rutas de test concretas en `progress/impl_40-cierre-bodega-satelite.md` (CHECKPOINTS:
cada `R<n>` → al menos un test; storage mockeado; E2E si F1.4-l = sí).
