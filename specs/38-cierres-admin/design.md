# Feature 38 — Admin: "Cierres del día (aprobar/rechazar)" · design.md

Zone: `fullstack` · complexity: `high` · depends_on: 37 (`done`) · branch: `feature/38-cierres-admin`

> Puerta **F1.4 ABIERTA**. Este design implementa los requisitos con los valores
> **recomendados** de `requirements.md > Preguntas abiertas` (`prov. F1.4-x`). Si el humano
> elige otra opción, se ajustan los puntos marcados sin reescribir la arquitectura (los
> enganches action/service/repo son estables). **No se implementa hasta cerrar F1.4.**

Arquitectura por capas (`docs/architecture.md`): Controller (Server Action `'use server'`) →
Service (lógica de negocio pura, DI por interfaces, testeable sin DB/red) → Repository
(Prisma). Mutaciones internas por Server Action, nunca `fetch` a rutas internas. Entrada
externa validada con zod en el borde. Errores vía `withErrorHandler` + traducción de
`AppErrorShape`, patrón `lib/actions/cierre-dia.ts` / `lib/actions/recepcion-satelite.ts`.

---

## 1. Modelo de datos

La 38 es principalmente **lectura + transición de estado** sobre lo que dejó la feature 37.
El enum `CierreEstado` ya tiene `aprobado`/`rechazado` reservados (sin migración de enum). El
índice `[destinoTipo, destinoZonaId]` de `cierre_dia` ya existe para el filtro por rol+zona.

### 1.1 Cambio de schema requerido (solo `prov. F1.4-e`)

La única modificación es aditiva, para trazabilidad money/audit y el motivo de rechazo (R14/R11):

```prisma
// añadir a model CierreDia (db/schema.prisma):
resueltoPor   String?   @map("resuelto_por")   // FK -> usuario (admin actor); NULL mientras solicitado
resueltoAt    DateTime? @map("resuelto_at")     // marca de tiempo de la resolución
motivoRechazo String?   @map("motivo_rechazo")  // obligatorio SOLO al rechazar (R11); NULL en aprobado/solicitado

resueltoPorUsuario Usuario? @relation("CierreResueltoPor", fields: [resueltoPor], references: [id])
// + lado opuesto en Usuario: cierresResueltos CierreDia[] @relation("CierreResueltoPor")
// + @@index([resueltoPor])
```

> SI F1.4-e opta por la transición pura (sin auditoría), este apartado se elimina y la 38 NO
> tiene migración (solo lectura + `updateMany` de estado). El resto del design no cambia.

### 1.2 Migración (up/down OBLIGATORIO, R17) — solo si 1.1

`db/migrations/<ts>_cierre_dia_resolucion/`. Patrón features 30/33/36/37.

`migration.sql` (UP):
```sql
ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_por" TEXT;
ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_at" TIMESTAMP(3);
ALTER TABLE "cierre_dia" ADD COLUMN "motivo_rechazo" TEXT;
ALTER TABLE "cierre_dia" ADD CONSTRAINT "cierre_dia_resuelto_por_fkey"
  FOREIGN KEY ("resuelto_por") REFERENCES "usuario"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "cierre_dia_resuelto_por_idx" ON "cierre_dia"("resuelto_por");
-- RLS ya habilitada por la feature 37; no se toca.
```

`down.sql` (DOWN, orden inverso):
```sql
DROP INDEX IF EXISTS "cierre_dia_resuelto_por_idx";
ALTER TABLE "cierre_dia" DROP CONSTRAINT IF EXISTS "cierre_dia_resuelto_por_fkey";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "motivo_rechazo";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "resuelto_at";
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "resuelto_por";
```

> `ALTER TABLE ADD COLUMN` va en transacción (sin el riesgo de `ALTER TYPE ADD VALUE`). La FK
> con `ON DELETE SET NULL` preserva el cierre si el admin se elimina (audit degradado, no roto).

---

## 2. Contratos (I/O)

### 2.1 Listar cierres del admin (R2–R9)

Se **reutiliza** `CierreDetalleGestion` y `CierreTotales` de
`lib/interfaces/services/ICierreDiaService.ts` (feature 37). Nuevos tipos de la 38:

```ts
// Cabecera de un cierre dentro del alcance del admin (cola + histórico).
export interface CierreAdminResumen {
  cierreId: string;
  mensajeroId: string;
  mensajeroNombre: string;        // resuelto (no id crudo)
  estado: CierreEstado;           // solicitado | aprobado | rechazado
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  destinoZonaNombre: string;
  totales: CierreTotales;         // snapshot (money-safe string)
  solicitadoAt: string;           // ISO
  resueltoAt: string | null;      // ISO; null si solicitado (F1.4-e)
  motivoRechazo: string | null;   // solo rechazado (F1.4-e)
}

export type ListarCierresAdminServiceResult =
  | {
      status: "ok";
      pendientes: CierreAdminResumen[];   // estado=solicitado (R4)
      historico: CierreAdminResumen[];    // aprobado/rechazado (R5)
      sinZona: boolean;                   // adminSatelite sin zona (R3)
    }
  | { status: "forbidden" };              // rol != maestro/adminSatelite (R1)

// Detalle completo de UN cierre (R6–R9). Reusa CierreDetalleGestion (37).
export type CierreDetalleAdminServiceResult =
  | {
      status: "ok";
      cierre: CierreAdminResumen;
      grupos: Record<CierreResultado, CierreDetalleGestion[]>; // por resultado (reuso 37)
    }
  | { status: "forbidden" }               // fuera de alcance / rol inválido (R13)
  | { status: "no_encontrada" };          // id inexistente o de otra bodega/zona (R13)
```

### 2.2 Aprobar / rechazar (R10–R14)

```ts
// input validado con zod en el borde: cierreId (uuid) + motivo (solo rechazo).
type AprobarCierreResult =
  | { status: "ok"; cierreId: string; estado: "aprobado" }
  | { status: "forbidden" }               // rol inválido o fuera de alcance (R13)
  | { status: "no_encontrada" }           // id inexistente / otra bodega-zona (R13)
  | { status: "conflict" }                // ya no está `solicitado` (R12)
  | { status: "unauthenticated" };

type RechazarCierreResult =
  | { status: "ok"; cierreId: string; estado: "rechazado" }
  | { status: "forbidden" }
  | { status: "no_encontrada" }
  | { status: "conflict" }                // R12
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // motivo vacío (R11)
  | { status: "unauthenticated" };
```

> **Money-safe:** los `Decimal` cruzan como **string** (nunca `number`/`parseFloat`), igual que
> en la 37. Los totales del resumen son el snapshot; el detalle deriva de las gestiones.

---

## 3. Capa de servicio — `lib/services/CierresAdminService.ts`

Servicio dedicado (no se ensancha `CierreDiaService`, que es del mensajero: mismo criterio que
37 §5.E — separar dominios). Implementa `lib/interfaces/services/ICierresAdminService.ts`. DI
por constructor (Pick de interfaces, dobles de test sin DB/red):

- `ICierresAdminRepository` (nuevo) — listar cierres por alcance, cargar un cierre + sus
  gestiones (detalle), transición guardada de estado.
- `IZonaRepository` (reuso 30/37) — `findCentralZonaId()` (para validar el alcance central).
- `IOrdenRepository` (reuso 33/34/37) — `findUsuarioZonaId(actor)` (zona del adminSatelite).
- `ISignedUrlProvider` (reuso 22/36/37) — firmar `evidenciaStoragePath` del detalle (R7).

Roles autorizados: `maestro` y `adminSatelite`. Cualquier otro → `forbidden`; sin sesión →
`unauthenticated` (lo resuelve la action antes del service, patrón 33/37).

### 3.1 Resolución del alcance (R2/R3) — helper `resolveAlcance(actor)`

```
si actor.rol === 'maestro'      -> { destinoTipo: 'bodega_central', destinoZonaId: null }
si actor.rol === 'adminSatelite':
    zonaId = ordenRepo.findUsuarioZonaId(actor)
    si zonaId === null          -> { sinZona: true }           // R3
    sino                        -> { destinoTipo: 'bodega_satelite', destinoZonaId: zonaId }
si otro rol                     -> forbidden                    // R1
```

> El `maestro` NO se acota por `destinoZonaId` (ve todos los `bodega_central`, que por diseño
> de la 37 son de la zona central). No se lee `zona.esCentral` directo: el destino ya viene
> resuelto y persistido por la 37; la 38 filtra por `destinoTipo`/`destinoZonaId` (columnas
> indexadas). `findCentralZonaId()` solo se usa como verificación defensiva opcional.

### 3.2 `listarCierresAdmin(actor)` (R2–R5)
1. `resolveAlcance(actor)`; `forbidden` / `{ sinZona: true, pendientes: [], historico: [] }`.
2. `repo.findCierresByAlcance(alcance)` → cabeceras (join a `usuario`/`zona` para nombres).
3. Partir por estado: `solicitado` → `pendientes` (R4); `aprobado`/`rechazado` → `historico` (R5).
4. Totales = snapshot del cierre serializado a string (R8/R9). **Sin firmar** evidencias aquí
   (la cabecera no las lleva; se firman al abrir el detalle, R7).

### 3.3 `verCierreDetalle(cierreId, actor)` (R6–R9, R13)
1. `resolveAlcance(actor)`; `forbidden` si rol inválido.
2. `repo.findCierreByIdEnAlcance(cierreId, alcance)` → cierre + gestiones (`WHERE cierre_id =
   cierreId` **acotado por el alcance en el WHERE**, no en memoria). Si `null` → `no_encontrada`
   (R13, no se distingue "no existe" de "otra bodega").
3. Firmar en lote las `evidenciaStoragePath` (R7) con `ISignedUrlProvider.createSignedUrls`
   (reuso del bucket privado de la 36, TTL de `lib/config/cierre.ts`).
4. Agrupar por `resultado` con el mapper `toDetalleDTO` (reuso 37) → `grupos`. Totales del
   resumen = snapshot (R8).

### 3.4 `aprobarCierre(cierreId, actor)` (R10, R12–R14) / `rechazarCierre(cierreId, motivo, actor)` (R11–R14)
1. `resolveAlcance(actor)`; `forbidden` si rol inválido.
2. (rechazo) validar `motivo` no vacío → `validation_error` si vacío (R11) — zod en el borde.
3. `repo.resolverCierre({ cierreId, alcance, nuevoEstado, resueltoPor: actor.usuarioId,
   motivoRechazo })` — transición guardada (§3.5). Devuelve `'updated' | 'conflict' |
   'fuera_de_alcance'`.
4. Mapear: `updated` → `ok`; `conflict` → `conflict` (R12); `fuera_de_alcance` →
   `no_encontrada` (R13).

### 3.5 Repository — `ICierresAdminRepository` / `CierresAdminRepository`

- `findCierresByAlcance(alcance): CierreAdminResumenRow[]` — `cierre_dia` WHERE
  `destino_tipo = alcance.tipo` (+ `destino_zona_id = alcance.zonaId` si adminSatelite), join a
  `usuario`(nombre)/`zona`(nombre), `orderBy solicitadoAt desc`. Usa el índice
  `[destinoTipo, destinoZonaId]`.
- `findCierreByIdEnAlcance(cierreId, alcance): { cierre, gestiones } | null` — el cierre SOLO
  si su `destino_tipo`/`destino_zona_id` casa el alcance (guardia en el WHERE, R13); las
  gestiones con `WITH_DETALLE` (reuso 37) WHERE `cierre_id = cierreId`.
- `resolverCierre({ cierreId, alcance, nuevoEstado, resueltoPor, motivoRechazo }):
  'updated' | 'conflict' | 'fuera_de_alcance'` — **transición atómica y guardada**:

```ts
const res = await prisma.cierreDia.updateMany({
  where: {
    id: cierreId,
    estado: "solicitado",                 // R12: guardia de estado (idempotente/race-safe)
    destinoTipo: alcance.destinoTipo,     // R13: guardia de alcance
    ...(alcance.destinoZonaId ? { destinoZonaId: alcance.destinoZonaId } : {}),
  },
  data: { estado: nuevoEstado, resueltoPor, resueltoAt: new Date(), motivoRechazo },
});
if (res.count === 1) return "updated";
// count 0: distinguir "ya resuelto" (existe en alcance) de "fuera de alcance/inexistente"
const enAlcance = await prisma.cierreDia.count({ where: { id: cierreId, destinoTipo, ...zona } });
return enAlcance > 0 ? "conflict" : "fuera_de_alcance";
```

> **R15:** `resolverCierre` NO toca `gestion_orden` (no desvincula `cierre_id`), NI el mensajero,
> NI wallet. Solo el `UPDATE` de estado + auditoría. Un solo statement, sin `$transaction`
> multi-tabla (no hay segunda tabla que tocar aquí).

---

## 4. Capa de acción (Server Actions) y UI

### 4.1 Server Actions — `lib/actions/cierres-admin.ts` (`'use server'`)
Patrón `lib/actions/cierre-dia.ts` / `recepcion-satelite.ts` (resuelve actor, `withErrorHandler`,
deps inyectables en tests, `UnauthenticatedError` en el borde, zod para la mutación):
- `listarCierresAdmin(deps?)` — solo `maestro`/`adminSatelite`; devuelve pendientes + histórico + `sinZona`.
- `verCierreDetalle(input, deps?)` — zod `{ cierreId: uuid }`; detalle con evidencias firmadas.
- `aprobarCierre(input, deps?)` — zod `{ cierreId: uuid }`; resultado de dominio.
- `rechazarCierre(input, deps?)` — zod `{ cierreId: uuid, motivo: string ≥ 1 }` (R11).

### 4.2 UI — `app/(app)/cierres-admin/` (roles `maestro` / `adminSatelite`)
- `page.tsx` (Server Component): `resolveActorFromSession`; si `rol` no es `maestro` ni
  `adminSatelite` → `notFound()` (R1, defensa real). Pre-fetch de `listarCierresAdmin` y paso
  de datos sensibles a componentes `private/` por props (architecture.md). Si `sinZona` (R3),
  render de estado vacío con aviso.
- `_components/CierresAdminModule.tsx` (cliente): dos secciones — "Pendientes de decisión"
  (`solicitado`, R4) e "Histórico" (aprobado/rechazado, R5), con `DataTable` (feature 7) y
  columnas mensajero/fecha/destino/total general. Abrir un cierre → `verCierreDetalle` →
  Modal/Sheet (feature 13) con el detalle por resultado (reuso del render de detalle de la 37 si
  se promueve a `components/shared/`, ver §6), visor de evidencia (URL firmada, R7) y panel de
  totales por método (R8). Botones **Aprobar** / **Rechazar**; Rechazar abre un sub-modal que
  exige el **motivo** (R11). Confirmación async → Server Action; `ok` → Toast (feature 11) +
  refresco de la ruta; `conflict`/`no_encontrada`/`forbidden` → Toast accionable + refresco.
- Sidebar: item "Cierres del día" visible para `maestro`/`adminSatelite` (misma nota de riesgo
  de sidebar por rol que features 36/37; la defensa real es el `notFound` de la página).

### 4.3 Config — `lib/config/cierre.ts`
Reuso del `SIGNED_URL_TTL_SECONDS` y el bucket privado de evidencias de la 36/37 (sin hardcode,
sin secretos en repo).

---

## 5. Alternativas descartadas (obligatorio)

### A. Rechazo que DESVINCULA las gestiones (`cierre_id = null`) — DESCARTADA `prov. F1.4-a`
Al rechazar, poner `cierre_id = null` en las gestiones para que el mensajero re-solicite ya. **Descartada:**
(1) rompe la inmutabilidad del snapshot money-critical (design 37 §5.C: el número aprobado/rechazado
debe seguir cuadrando con su detalle); (2) deja el cierre `rechazado` sin detalle derivable; (3) el
desbloqueo/re-solicitud del mensajero es responsabilidad explícita de la **feature 41** (no invadir).
→ Rechazo inmutable + `motivo_rechazo`; la 41 decide el desbloqueo/re-solicitud.

### B. DTO de detalle admin propio — DESCARTADA `prov. F1.4-b`
Definir un `CierreDetalleAdmin` nuevo para el detalle por orden. **Descartada:** el
`CierreDetalleGestion` de la 37 ya expone exactamente lo que el admin necesita (orden + resultado
+ montos/método + motivos + evidencia firmada). → **Reuso**; solo se añade
`findGestionesByCierre` (WHERE `cierre_id = X`), gemelo de `findGestionesPendientes` (37).

### C. Recalcular los totales al mostrar en el admin — DESCARTADA `prov. F1.4-e/37-§5.C`
Re-sumar las gestiones del cierre al abrirlo, en vez de usar el snapshot. **Descartada** por
money-critical: el admin debe aprobar/rechazar EXACTAMENTE el número congelado al solicitar
(feature 37 R14); recomputar arriesga divergencia. → Mostrar el **snapshot**; el detalle deriva
de las gestiones (inmutables por su `cierre_id`).

### D. Transición sin guardia de estado (leer-comprobar-escribir) — DESCARTADA `prov. F1.4-d`
Leer el cierre, verificar `estado === 'solicitado'` en memoria, luego `update`. **Descartada:**
dos admins de la misma bodega podrían aprobar/rechazar el mismo cierre en una race y duplicar la
resolución. → `updateMany ... WHERE id = X AND estado = 'solicitado' AND <alcance>`; `count`
decide `updated`/`conflict` (atómico).

### E. Ensanchar `CierreDiaService` (37) con la lógica de admin — DESCARTADA
Meter listar/aprobar/rechazar en el servicio del mensajero. **Descartada** (mismo criterio que
37 §5.E / 17 §5.D): mezcla dos dominios (cierre del mensajero vs. decisión del admin) y sus
dependencias, degradando un servicio estable. → `CierresAdminService` dedicado.

### F. Fijar el admin destinatario al solicitar (feature 37) — YA DESCARTADA en la 37 (§5.D)
La 37 guarda `destino_tipo` + `destino_zona_id`, NO un `destino_admin_id`. La 38 resuelve el/los
admin por rol+zona en su consulta (R2). Se mantiene esa decisión; no se reintroduce aquí.

---

## 6. Notas de riesgo para el implementer (no bloquean el spec)

- **Alcance en el WHERE, no en memoria (R2/R13):** el filtro por `destinoTipo`/`destinoZonaId`
  DEBE ir en la query (repo), nunca cargando todo y filtrando en el service. El reviewer rechaza
  fugas de cierres de otra bodega/zona.
- **Guardia de estado obligatoria (R12):** la transición es `updateMany ... WHERE estado =
  'solicitado'`; nunca `update` directo tras un `findUnique`.
- **Money-safe cruzando la frontera:** serializar `Decimal` como **string** en los DTO (no
  `number`); no `parseFloat` sobre montos. Los totales son snapshot (no recomputar).
- **Evidencias solo firmadas (R7):** nunca exponer `evidenciaStoragePath`; firmar con TTL corto,
  patrón 21/22/36/37. Storage no unit-testeable → doble de `ISignedUrlProvider`.
- **Reuso del render de detalle (37):** el `CierreDiaModule` (37) renderiza el detalle por
  resultado en `app/(app)/cierre-dia/_components/`. Si se comparte con la 38, promover el sub-
  componente de detalle a `components/shared/` SOLO si ambas features lo usan con la misma API
  (architecture.md "sin sobre-ingeniería"); si no, duplicación mínima aceptable en la 38.
- **`maestro` y zona:** el `maestro` no tiene `zonaId` (es global); su alcance es
  `destinoTipo = bodega_central` sin filtro de zona. No pasar su (inexistente) zona al WHERE.
- **RLS:** `cierre_dia` ya tiene RLS (37); la migración de la 38 (si 1.1) NO la desactiva.
- **Sidebar por rol:** ver features 36/37 §6 (la defensa real es el `notFound` de la página).

## 7. Trazabilidad R → test

La tabla `R1`–`R17` (+ E2E) vive en `requirements.md > Tabla de trazabilidad`. El `implementer`
la reproduce con rutas de test concretas en `progress/impl_38-cierres-admin.md`
(CHECKPOINTS: cada `R<n>` → al menos un test; storage mockeado; E2E si F1.4-f = sí).
