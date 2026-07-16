# Feature 76 — Design técnico (ranking DIARIO)

> Cubre R1-R24 de `requirements.md`. Respeta el patrón de capas del arnés
> (`docs/architecture.md:33-66`) y el molde de módulo solo-maestro con datos agregados
> (`/wallet`, `/cierres-admin`). Gate F1.4 (a-f) CERRADA y **DS1 RESUELTA**: el denominador
> "asignadas del día" usa la columna nueva `orden.asignado_at` estampada en cada asignación
> (choke-point §4.1). NO quedan sub-decisiones abiertas; solo la limitación conocida LC1 (§2.3).

## 1. Estado actual verificado (no re-descubrir)

- Página **stub**: `app/(app)/ranking/page.tsx:1-9` = solo `<PageHeader title="Ranking" />`
  (sync, sin guard, sin fetch). No hay service/repo/action/interface/test de ranking.
- Menú: `lib/auth/menu-visibility.ts:89-95` → `href:/ranking`, `iconKey:trophy`,
  `roles:["maestro","mensajero"]`, comentario "hoy solo para maestro" (corregir por R20).
- Enum `GestionResultado` (`db/schema.prisma:368-375`): `entregada|reprogramada|devuelta|rechazada`.
- `model GestionOrden` (`db/schema.prisma:397-440`): `mensajeroId` (`@relation("GestionMensajero")`),
  `resultado`, `anuladaAt` (NULL = vigente, feature 67), `createdAt`, `cierreId`.
- **Día CR:** helper `startOfDayCR(now)` (`lib/utils/fecha-cr.ts:19-25`, feature 46/46-R9):
  medianoche UTC del día calendario CR (UTC-6, sin DST). Rango de HOY(CR) =
  `[startOfDayCR(now), startOfDayCR(now) + 24h)`. `UN_DIA_MS` ya definido (`:44`).
- **Umbral configurable:** patrón `readPositiveInt(name, fallback)` + env
  (`lib/config/reintentos.ts:6-22`); se replica para `RANKING_MIN_ASIGNADAS` default 1.
- **Moneda:** `lib/config/moneda.ts` (sin hardcode, R22).
- Mensajeros: `UserRepository.listMensajeros()` (`lib/repositories/UserRepository.ts:117-123`).
- Serialización Decimal→string antes del cliente: `app/(app)/wallet/page.tsx:16-18,29-63`.
- Precedente de montos editables desde UI = tabla Prisma: `model GastoFijoPlantilla`
  (`db/schema.prisma:832-842`) + `GastoFijoPlantillaRepository`/`lib/actions/gasto-fijo-plantilla.ts`.

## 2. Fuentes de datos del cálculo diario (R1/R2) — CLAVE

### 2.1 Numerador: "entregas exitosas del día" (atribución limpia)

Gestiones `GestionOrden` con:
- `resultado = entregada`,
- `anuladaAt IS NULL` (vigente, feature 67 — no premiar intentos deshechos),
- `createdAt ∈ [startOfDayCR(now), +24h)` (HOY CR),
- agrupadas por `mensajeroId` (quien ACTUÓ la entrega).

Fuente limpia y consistente con el resto del arnés. `GestionOrder.createdAt` marca el
instante de la gestión.

### 2.2 Denominador: "órdenes asignadas del día" — DS1 RESUELTA (columna `orden.asignado_at`)

DS1 se cierra con una **columna nueva `orden.asignado_at`** (`DateTime?`, R24) estampada
`= now` en cada asignación/reasignación (R23, choke-point §4.1). El denominador es directo:

```
prisma.orden.groupBy({
  by: ["mensajeroAsignadoId"],
  where: {
    mensajeroAsignadoId: { not: null },
    asignadoAt: { gte: desde, lt: hasta },  // desde=startOfDayCR(now), hasta=+24h
  },
  _count: { _all: true },
})
```

Ya **NO** se consulta `orden_historial_estado` para el denominador. Ventajas: atribución por
el mensajero ACTUALMENTE asignado, un solo timestamp limpio, índice trivial por `asignado_at`.

### 2.3 Limitación conocida LC1 (aceptada, no bloqueante)

Una devolución del mismo día limpia `orden.mensajero_asignado_id` (feature 47,
`limpiaMensajero: true`, `lib/repositories/GestionOrdenRepository.ts:284`; también
`OrdenRepository.rutearBodegaSateliteLote:989` y `LiberacionReprogramadaRepository:87` dejan
NULL). Al quedar `mensajero_asignado_id = NULL`, esa orden sale del denominador de ese
mensajero hasta reasignarse → el % se infla levemente por devoluciones intradía. Es
**consistente** porque esa orden tampoco aporta al numerador. Los paths de limpieza DEBEN
además poner `asignado_at = NULL` (defensivo; el `where` ya filtra por `mensajeroAsignadoId
not null`, así que no afecta el conteo, pero evita un timestamp huérfano). Ver §4.2.

## 3. Query agregada (backend, R1/R2)

Nuevo repo `RankingRepository implements IRankingRepository`, con el rango de día CALCULADO
en el service (que pasa `desde`/`hasta` = `startOfDayCR(now)` y `+24h` al repo, para que el
repo no dependa de `Date.now()` y sea testeable):

- `contarEntregadasPorMensajero(desde, hasta)`:
  `gestionOrden.groupBy({ by:["mensajeroId"], where:{ resultado:"entregada", anuladaAt:null, createdAt:{ gte:desde, lt:hasta } }, _count:{_all:true} })`.
- `contarAsignadasPorMensajero(desde, hasta)` (DS1 resuelta, vía `orden.asignado_at`):
  `orden.groupBy({ by:["mensajeroAsignadoId"], where:{ mensajeroAsignadoId:{ not:null }, asignadoAt:{ gte:desde, lt:hasta } }, _count:{_all:true} })`.
  Ya NO consulta `historialEstados`.

**Índices** (evitar full-scan, `docs/architecture.md:149`): ya existe
`@@index([mensajeroAsignadoId])` (`db/schema.prisma:352`). Añadir en la misma migración de la
columna un `@@index([mensajeroAsignadoId, asignadoAt])` para la query de asignadas del día
(el implementer confirma con `EXPLAIN`). El numerador usa
`gestion_orden(mensajero_id, resultado, created_at)` — verificar/añadir si falta.

El **service** cruza ambos `groupBy` con `listMensajeros()` (incluye mensajeros con 0 para
R3) y produce `{ mensajeroId, nombre, entregadasHoy, asignadasHoy }`.

## 4. Modelo de datos

### 4.0 Columna nueva `orden.asignado_at` (R24)

Añadir al `model Orden` (`db/schema.prisma`, junto a `mensajeroAsignadoId` en `:327`):
`asignadoAt DateTime? @map("asignado_at")` + `@@index([mensajeroAsignadoId, asignadoAt])`.

Migración aditiva `db/migrations/<ts>_orden_asignado_at/`:
- `migration.sql` (UP): `ALTER TABLE "orden" ADD COLUMN "asignado_at" timestamptz NULL;`
  `CREATE INDEX ... ON "orden"("mensajero_asignado_id","asignado_at");`
- `down.sql` (DOWN): `DROP INDEX ...; ALTER TABLE "orden" DROP COLUMN "asignado_at";`
- Las órdenes históricas quedan `NULL` → no cuentan hasta su próxima (re)asignación (R24).
- `orden` ya tiene RLS (tabla existente); no se re-declara.

### 4.1 CHOKE-POINT — writers de asignación que DEBEN estampar `asignado_at = now` (R23)

Enumeración exhaustiva de los puntos que escriben `orden.mensajero_asignado_id` con valor
**no nulo** (asignación/reasignación). Cada uno DEBE setear `asignado_at` en la MISMA
escritura; una task por writer (tasks §T3.x). Ninguna ruta puede omitirlo.

| # | Writer | Ubicación | Contexto |
| - | ------ | --------- | -------- |
| W1 | `OrdenRepository.generarGuiaLote` | `lib/repositories/OrdenRepository.ts:899-901` (`data:{ estatusId, mensajeroAsignadoId: d.mensajeroAsignadoId }`) | Feature 17/49 "Generar guía" — asignación directa/sugerida vía `GuiaAsignacionService`. `mensajeroAsignadoId` puede ser NULL (ruteo sin mensajero) → **estampar `asignado_at` solo cuando el valor es no nulo** (condicional por decisión). |
| W2 | `OrdenRepository.asignarBodegaLote` | `lib/repositories/OrdenRepository.ts:941-943` (`data:{ mensajeroAsignadoId: mensajeroId, estatusId }`) | Feature 26/49 lote del maestro desde bodega (`GuiaAsignacionService.asignarBodegaLote`, `:349`). Siempre no nulo → estampar siempre. |
| W3 | `OrdenRepository.asignarSateliteLote` | `lib/repositories/OrdenRepository.ts:1251-1253` (raw `SET "mensajero_asignado_id" = ${mensajeroId}`) | Feature 34 asignación satélite (`AsignacionSateliteService`). Es SQL crudo → añadir `"asignado_at" = NOW()` al SET (junto a `updated_at`). |
| W4 | `CierreDiaRepository` deshacer-gestión (repone asignación) | `lib/repositories/CierreDiaRepository.ts:481-483` (`data:{ estatusId, mensajeroAsignadoId: mensajeroId }`) | Feature 67: al anular una gestión repone la asignación al mensajero autor (reasignación efectiva) → estampar `asignado_at = now`. |

### 4.2 Paths de LIMPIEZA (set NULL) — deben poner `asignado_at = NULL` (defensivo, LC1)

| # | Path | Ubicación |
| - | ---- | --------- |
| C1 | `GestionOrdenRepository` seguimiento `limpiaMensajero` | `lib/repositories/GestionOrdenRepository.ts:284` |
| C2 | `OrdenRepository.rutearBodegaSateliteLote` (deja NULL en ruteo) | `lib/repositories/OrdenRepository.ts:989` |
| C3 | `LiberacionReprogramadaRepository` handoff a bodega | `lib/repositories/LiberacionReprogramadaRepository.ts:87` |

No afectan el conteo (el `where` filtra `mensajeroAsignadoId not null`), pero limpiar
`asignado_at` evita un timestamp huérfano. Prioridad menor que W1-W4.

### 4.3 Tabla `premio_ranking` (R8/R21)

Prisma model `PremioRanking` (mapea a `premio_ranking`, snake_case):

| Columna     | Tipo                       | Notas |
| ----------- | -------------------------- | ----- |
| `id`        | `String @id` (cuid)        | PK |
| `posicion`  | `Int @unique`              | 1, 2 o 3. `CHECK (posicion BETWEEN 1 AND 3)` |
| `monto`     | `Decimal(12,2)?`           | **NULLABLE** = "sin premio asignado" (R9, decisión d) |
| `descripcion` | `String?` (`TEXT`)       | **NULLABLE** = "sin descripción" (R25); texto libre, `trim`, max ~200 |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt`      | |

- **Monto + descripción** (F1.4-d ampliada 2026-07-16 por pedido del humano): la posición
  guarda un monto opcional Y una descripción opcional (texto libre), independientes entre sí.
- Se siembran las 3 filas (`monto = NULL`, `descripcion = NULL`) en la migración;
  `@unique(posicion)` garantiza R8.
- NO se guarda el mensajero ganador: el ocupante del podio se calcula on-read (R14/R15).

### Migración (aditiva, reversible — R21)

`db/migrations/<ts>_premio_ranking/`:
- `migration.sql` (UP): `CREATE TABLE premio_ranking(...)`, `CHECK` posición, `UNIQUE(posicion)`,
  `INSERT` de las 3 filas seed (`monto NULL`, `descripcion NULL`), `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + políticas.
- `down.sql` (DOWN, obligatorio): `DROP TABLE premio_ranking;`.

### RLS (R21)

`ENABLE ROW LEVEL SECURITY` en `premio_ranking`, política restrictiva (acceso solo por rol de
servicio; sin acceso anónimo). La autorización de negocio (quién edita) vive en el **service**
(R16/R19). El implementer copia el patrón de políticas de la última tabla administrativa con RLS.

### Configuración — umbral de muestra (R7/R22)

Nuevo `lib/config/ranking.ts` espejo de `reintentos.ts`:
```
export function loadRankingConfig() {
  return { MIN_ASIGNADAS_PODIO: readPositiveInt("RANKING_MIN_ASIGNADAS", 1) };
}
```

## 5. Capa de negocio (service, R2-R7, R9, R12, R16-R19, R22)

`RankingService implements IRankingService`, inyecta `IRankingRepository`,
`IUserRepository`, `IPremioRankingRepository`, y recibe `now`/config para testeo. Métodos:

- `obtenerRanking(actor, now = new Date())`:
  1. Autoriza (R16/R17/R18): `maestro` → full+editable; `mensajero` → solo-lectura; otro/sin
     sesión → `{ status:"forbidden" }` (sin datos).
  2. Calcula rango CR: `desde = startOfDayCR(now)`, `hasta = desde + UN_DIA_MS`.
  3. Repo: entregadas + asignadas por mensajero (§3) + `listMensajeros()`.
  4. Por mensajero: `pctDefinido = asignadasHoy > 0` (R3); `pct = redondear1(entregadas/asignadas)`
     en servidor (R2/R12/f). Marca `elegiblePodio = asignadasHoy >= MIN_ASIGNADAS_PODIO` (R7).
  5. Ordena: pct desc → entregadas desc → nombre asc (R4/R5); no-definidos al final.
  6. Lee premios (`PremioRankingRepository.listar()`), serializa `monto` a string|null (R9/R12)
     y pasa `descripcion` string|null tal cual (R25).
  7. Asocia premio↔podio (R14/R15): posición i toma el i-ésimo mensajero elegible; si no hay
     ocupante, la posición queda sin asignar-a-nadie.
  8. Devuelve `{ status:"ok", data:{ ranking, premios, esEditable: actor.rol==="maestro" } }`.

- `editarPremio(actor, { posicion, monto, descripcion })`:
  1. Autoriza SOLO `maestro` (R16/R19); mensajero/otro → `forbidden`.
  2. Valida `posicion ∈ {1,2,3}`, `monto` (null | Decimal ≥ 0, ≤ 2 decimales) — R11 — y
     `descripcion` (null | texto `trim`, max ~200) — R25.
  3. `PremioRankingRepository.upsertPremio(posicion, { monto, descripcion })` (R10/R25).
  4. Unión discriminada `{ status:"ok"|"forbidden"|"unauthenticated"|"invalid" }`.

## 6. Server Actions (controller interno, R10/R11/R19)

`lib/actions/ranking.ts` (`'use server'`):
- `obtenerRankingAction()` → `resolveActorFromSession()`, llama al service, devuelve resultado
  ya serializado (montos y pct string). Prefetch desde la página.
- `editarPremioAction(input)` → zod en el borde (`{ posicion: 1|2|3, monto: string|null,
  descripcion: string|null }`; string vacío → `null` en ambos; `descripcion` con `trim` + max),
  `RankingService.editarPremio`, `revalidatePath("/ranking")`.
  Mutación interna = Server Action, no route handler.

## 7. Página y UI (frontend, R12-R20)

- `app/(app)/ranking/page.tsx` → Server Component role-aware (reemplaza el stub):
  `resolveActorFromSession()`; permite `maestro` y `mensajero`; cualquier otro/sin sesión →
  `notFound()`. Prefetch `obtenerRankingAction()`; si `status!=="ok"` → `notFound()` (defensa en
  profundidad, patrón `wallet/page.tsx:39-46`). Pasa datos serializados (string) + `esEditable`
  por props (R12).
- `app/(app)/ranking/_components/RankingModule.tsx` (cliente): tabla del ranking (posición,
  nombre, %, conteo crudo `entregadas/asignadas`) + tabla de 3 premios. Primitivas
  `components/ui/` (Table, Input, Button). Por posición hay DOS inputs abiertos: **monto**
  (vacío = sin premio, R9) y **descripción** (texto libre, vacío = sin descripción, R25).
  Inputs editables solo si `esEditable` (maestro, R16); mensajero ve solo-lectura, incluida
  la descripción (R17).
- `_components/PremioInputRow.tsx` (o inline): inputs controlados por posición (monto +
  descripción); on-save llama `editarPremioAction`; vaciar y guardar → `monto=null` /
  `descripcion=null`.
- `lib/auth/menu-visibility.ts:89-95`: conservar `["maestro","mensajero"]` y corregir el
  comentario "hoy solo para maestro" para reflejar que maestro+mensajero es intencional (R20).

## 8. Interfaces (arnés, `lib/interfaces/`)

- `lib/interfaces/repositories/IRankingRepository.ts` — `contarEntregadasPorMensajero`, `contarAsignadasPorMensajero`.
- `lib/interfaces/repositories/IPremioRankingRepository.ts` — `listar()`, `upsertPremio(posicion, { monto, descripcion })`.
- `lib/interfaces/services/IRankingService.ts` — `obtenerRanking()`, `editarPremio()`.

## 9. Contratos I/O

```
// obtenerRanking → ok
{
  status: "ok",
  data: {
    ranking: Array<{
      posicion: number | null,       // 1..3 en el podio elegible; null fuera
      mensajeroId: string,
      nombre: string,
      entregadasHoy: number,         // R6 conteo crudo
      asignadasHoy: number,          // R6 conteo crudo (denominador)
      pct: string | null,            // "96.0" | null si asignadasHoy=0 (R3/R12)
      premio: string | null,         // monto asociado si podio+premio (R14), string
    }>,
    premios: Array<{ posicion: 1|2|3, monto: string | null, descripcion: string | null }>,  // R8/R9/R12/R25
    esEditable: boolean,             // true solo para maestro (R16/R17)
  }
}
// editarPremio input (zod): { posicion: 1|2|3, monto: string | null, descripcion: string | null }
// editarPremio → { status: "ok" | "forbidden" | "unauthenticated" | "invalid", message? }
```

## 10. Integraciones

Ninguna externa. Solo Supabase/Postgres vía Prisma. Sin webhooks, sin crons.

## 11. Alternativa descartada

**Alternativa A — Premios como configuración estática (`lib/config/*`) o env, sin tabla.**
Descartada porque el pedido exige **inputs editables por el maestro en runtime** (R10); una
config estática exigiría un deploy por cada cambio de premio. El precedente del repo para
"montos editables por el maestro" es una **tabla Prisma** (`GastoFijoPlantilla`,
`db/schema.prisma:832-842`), no config estática (esa se reserva para umbrales/env, como el
propio umbral de muestra de R7). Además una tabla da auditoría (`createdAt/updatedAt`). Por
eso: **tabla `premio_ranking` con RLS + migración up/down** (§4).

**Alternativa B — Ranking histórico materializado / snapshot diario.** Descartada: el pedido
es DIARIO y "básico"; un `groupBy` acotado a HOY(CR) con índices existentes (§3) es siempre
fresco y no requiere job de snapshot ni tabla de histórico (follow-up).

**Alternativa C (para el denominador) — Proxy vía `orden_historial_estado` (transiciones a
`en_espera_aceptacion` de hoy) o gestiones de hoy.** Descartada por DS1: (i) gestiones =
"gestionadas", no "asignadas"; (ii) el historial NO guarda el mensajero asignado (solo el
actor=maestro) y unir con `mensajero_asignado_id` actual arrastra sesgo de reasignación. La
columna `orden.asignado_at` da un timestamp de asignación limpio y atribuido al mensajero
actual (§2.2). Coste asumido: instrumentar los 4 writers (§4.1).

## 12. Trazabilidad de la resolución DS1 (aislada)

| Elemento | Punto de cambio |
| -------- | --------------- |
| Columna `orden.asignado_at` + índice | migración `<ts>_orden_asignado_at` (§4.0) |
| Estampado en asignación (R23) | writers W1-W4 (§4.1) — una task por writer |
| Limpieza `asignado_at = NULL` (LC1) | paths C1-C3 (§4.2) |
| Denominador | `RankingRepository.contarAsignadasPorMensajero` (§3) + test R1 |
| Limitación LC1 (devolución intradía) | test de `RankingService` (§2.3) |
