# Feature 69 — `cierre_detail`: diseño técnico

> Requisitos en `requirements.md`. Decisiones de arquitectura contra `docs/architecture.md`
> (Controller → Service → Repository, migraciones up/down, RLS) y `docs/conventions.md`.
> Alternativas descartadas en §7 (obligatorio por `docs/specs.md`).
>
> **Gate F1.4 APROBADA por el humano el 2026-07-15** (`requirements.md` §7): (a)–(f) tal cual;
> **(g) por override del humano** (no se filtra `tarifas.status` — §6.1). Rama
> `feature/69-cierre-detail`, desde `origin/dev` `14f6548` (con el PR #75).

## 1. Idea en una frase

El cierre deja de **preguntar** por los datos de la orden y de la tarifa cuando se aprueba, y pasa a
**recordar** los que había cuando se solicitó. `cierre_detail` es esa memoria; los feeds de wallet la
leen a ella y a nadie más.

## 2. Modelo de datos

### 2.1 Tabla nueva `cierre_detail`

Grano **(cierre_id, orden_id)**. Fila **inmutable** (patrón `orden_historial_estado`): sin
`updated_at`, sin `deleted_at`, sin soft delete. Migración **aditiva**: no altera tablas existentes.

| Columna | Tipo | Null | Origen congelado |
| --- | --- | --- | --- |
| `id` | TEXT | no | `uuid()` |
| `cierre_id` | TEXT | no | FK → `cierre_dia` |
| `orden_id` | TEXT | no | FK → `orden` |
| **money-critical** ||||
| `monto_cobrar` | DECIMAL(12,2) | **sí** | `orden.monto_cobrar` (ya es nullable, `schema:323`) |
| `cobra_comision` | BOOLEAN | no | `orden.cobra_comision` |
| `zona_id` | TEXT | no | `orden.zona_id` (FK → `zona`) |
| `tienda_id` | TEXT | no | `orden.tienda_id` (FK → `usuario`) |
| `es_central` | BOOLEAN | no | `zona.es_central` **en ese instante** |
| **tarifa congelada (todas o ninguna, R8/R9)** ||||
| `tarifa_id` | TEXT | sí | FK → `tarifas` (auditoría: *qué fila* se usó) |
| `tarifa_valor_flete` | DECIMAL(12,2) | sí | monto |
| `tarifa_valor_flete_gam` | DECIMAL(12,2) | sí | monto |
| `tarifa_valor_flete_devuelto` | DECIMAL(12,2) | sí | monto |
| `tarifa_valor_flete_devuelto_gam` | DECIMAL(12,2) | sí | monto |
| `tarifa_comision_cod` | DECIMAL(5,2) | sí | porcentaje 0..100 |
| `tarifa_iva_flete` | DECIMAL(5,2) | sí | porcentaje 0..100 |
| `tarifa_iva_comision_cod` | DECIMAL(5,2) | sí | porcentaje 0..100 |
| **descriptivos** ||||
| `num_guia` | INTEGER | sí | `orden.num_guia` (nullable, `schema:309`). **Sin UNIQUE**: es copia, no identidad |
| `num_remision` | TEXT | no | `orden.num_remision` |
| `destinatario` | TEXT | no | `orden.destinatario` |
| `direccion` | TEXT | sí | `orden.direccion` (nullable, `schema:322`) |
| `producto` | TEXT | no | `orden.producto` |
| `tienda_nombre` | TEXT | no | `usuario.nombre` |
| `zona_nombre` | TEXT | no | `zona.nombre` |
| `provincia_nombre` | TEXT | no | `provincia.nombre` |
| `canton_nombre` | TEXT | no | `canton.nombre` |
| `distrito_nombre` | TEXT | sí | `distrito.nombre` (el distrito es el único FK nullable, `schema:318`) |
| `created_at` | TIMESTAMP(3) | no | `CURRENT_TIMESTAMP` |

**Constraints e índices:**
- `CONSTRAINT "cierre_detail_pkey" PRIMARY KEY ("id")`
- `CONSTRAINT "cierre_detail_cierre_id_orden_id_key" UNIQUE ("cierre_id", "orden_id")` — **R2**. Es
  también el índice de la ruta caliente (los feeds filtran por `cierre_id`).
- `CREATE INDEX "cierre_detail_orden_id_idx"` — trazar en qué cierres apareció una orden.
- FKs como `ALTER TABLE` aparte, `ON DELETE RESTRICT ON UPDATE CASCADE` (default del repo): `cierre_id`
  → `cierre_dia`, `orden_id` → `orden`, `zona_id` → `zona`, `tienda_id` → `usuario`, `tarifa_id` →
  `tarifas`. Todas RESTRICT es seguro: **ninguna** de esas tablas borra físicamente (`orden` y
  `tarifas` usan `deleted_at`).
- `ALTER TABLE "cierre_detail" ENABLE ROW LEVEL SECURITY;` **sin policies** — R25, patrón
  `gestion_orden` / `cierre_dia` / `wallet_movimiento`.

**Por qué `es_central` es columna teniendo `zona_id`:** `zona.es_central` es mutable (la 54 la renombró
y la 55 la administrará). Guardar sólo el FK dejaría el vector de descuadre abierto: cambiar la zona
central re-etiquetaría cierres viejos. Lo mismo vale para los 5 nombres desnormalizados.

### 2.2 Prisma (`db/schema.prisma`)

```prisma
model CierreDetail {
  id                          String   @id @default(uuid())
  cierreId                    String   @map("cierre_id")
  ordenId                     String   @map("orden_id")
  montoCobrar                 Decimal? @map("monto_cobrar") @db.Decimal(12, 2)
  cobraComision               Boolean  @map("cobra_comision")
  zonaId                      String   @map("zona_id")
  tiendaId                    String   @map("tienda_id")
  esCentral                   Boolean  @map("es_central")
  tarifaId                    String?  @map("tarifa_id")
  tarifaValorFlete            Decimal? @map("tarifa_valor_flete") @db.Decimal(12, 2)
  // … resto de la tarifa (montos 12,2 / porcentajes 5,2) …
  numGuia                     Int?     @map("num_guia")
  // … resto de descriptivos …
  createdAt                   DateTime @default(now()) @map("created_at")

  cierre CierreDia @relation(fields: [cierreId], references: [id])
  orden  Orden     @relation(fields: [ordenId], references: [id])
  zona   Zona      @relation(fields: [zonaId], references: [id])
  tienda Usuario   @relation("CierreDetailTienda", fields: [tiendaId], references: [id])
  tarifa Tarifa?   @relation(fields: [tarifaId], references: [id])

  @@unique([cierreId, ordenId])
  @@index([ordenId])
  @@map("cierre_detail")
}
```
Más los lados inversos en `CierreDia`, `Orden`, `Zona`, `Usuario`, `Tarifa`.
Convenciones (`docs/conventions.md`): camelCase + `@map` snake_case; dinero `Decimal(12,2)`,
porcentajes `Decimal(5,2)`; **nunca** `number`/`parseFloat` sobre montos (R11).

### 2.3 Migración `db/migrations/20260715140000_cierre_detail/`

`migration.sql` (UP) + `down.sql` (DOWN) **obligatorios** (R24, `docs/architecture.md` §Migraciones).
Cabecera de comentario con feature y `R<n>` (patrón `20260713150000_gasto_fijo_plantilla` para tabla
simple y `20260713120000_orden_historial_estado` para FKs). Estructura del UP:

1. `CREATE TABLE "cierre_detail" (…)` con `"id" TEXT NOT NULL` + `CONSTRAINT "cierre_detail_pkey"`.
2. `UNIQUE` + `CREATE INDEX` como sentencias aparte.
3. Las 5 FKs como `ALTER TABLE … ADD CONSTRAINT … ON DELETE RESTRICT ON UPDATE CASCADE`.
4. `ALTER TABLE "cierre_detail" ENABLE ROW LEVEL SECURITY;` (sin `CREATE POLICY`).
5. **Backfill (R26/R27)** — ver §5.

`down.sql`: `DROP TABLE IF EXISTS "cierre_detail";` (arrastra unique, índice, FKs y RLS; no hay enum
propio que dropear). El backfill no necesita reversa: muere con la tabla.

> **Timestamp:** `20260715140000` va después de la última carpeta existente
> (`20260715120000_order_status_recibido_origen`). Si otra sesión aterriza algo posterior en `dev`, se
> re-numera antes del merge.

## 3. Flujo de escritura (único): `crearCierre`

Verificado que hay **un solo** punto de creación de cierres (requirements §Contexto y (f)). Todo el
snapshot se construye **dentro de la `$transaction` que ya existe** en
`CierreDiaRepository.crearCierre` (`lib/repositories/CierreDiaRepository.ts:165-232`), *después* del
`updateMany` que vincula las gestiones:

```
tx:
  1. cierreDia.create(...)                                  ← ya existe (37/R14, 39/R13, 56/R12)
  2. gestionOrden.updateMany({mensajeroId, cierreId:null, anuladaAt:null}) ← ya existe (67/R16)
     └─ count === 0 ⇒ SinGestionesVinculadas ⇒ rollback ⇒ null   ← ya existe (41/C1)
  3. pago_mensajero  por gestión (agrupado por valor)       ← ya existe (39)
  4. ingreso_bodega_rechazo por gestión                     ← ya existe (56)
  5. ▶ NUEVO: leer las gestiones RECIÉN vinculadas con el detalle de la orden
       tx.gestionOrden.findMany({ where: { cierreId: cierre.id }, select: SNAPSHOT_SELECT })
  6. ▶ NUEVO: deduplicar por ordenId  (grano ORDEN, R2)
  7. ▶ NUEVO: resolver la tarifa vigente de las tiendas distintas, EN LA MISMA tx
  8. ▶ NUEVO: cierreDetail.createMany(filas)                (R3/R4: misma tx, todo-o-nada)
```

**Decisión clave — el snapshot se construye DENTRO de la tx, leyendo lo que el paso 2 realmente
vinculó**, no la lista que el service leyó antes (`findGestionesPendientes`, `CierreDiaService.ts:204`).
Porqué: si una gestión se crea entre la lectura del service y la tx, el `updateMany` (que no lleva
lista de ids) **la vincula igual**. Con el patrón de la 39/56 eso sólo deja un `pago_mensajero` nulo
(inofensivo). Aquí dejaría una orden **sin fila de detalle** ⇒ con R14 (sin fallback) la aprobación
abortaría. Leer dentro de la tx elimina la carrera por construcción. El paso 5 usa el índice
`gestion_orden.cierre_id` (`schema:408`).

**`anulada_at` (R5):** no hace falta filtrar en el paso 5 — el paso 2 ya sólo vincula gestiones
vigentes (67/R16), así que `where: { cierreId }` no puede traer anuladas. El test de R5 fija el
invariante de todos modos.

### 3.1 Resolución de la tarifa dentro de la tx (capas)

`crearCierre` recibe `ITarifaVigentePorTiendaRepository` **por constructor** (inyección por interfaz;
precedente: `CierresAdminRepository` recibe repos y services, `CierresAdminRepository.ts:89-107`). La
interfaz gana un método batch **tx-aware**:

```ts
resolveTarifasPorTiendas(tx: TarifaTxClient, tiendaIds: string[]): Promise<Map<string, TarifaVigente | null>>
```

Una sola query (`findMany` por `tienda_id IN (…)`, `deletedAt: null`, `orderBy createdAt desc`) +
selección del primero por tienda: N tiendas por cierre, no N+1. La regla de resolución (la más
reciente no borrada) queda en **un solo lugar**, compartida con `resolveTarifaPorTienda`.

> El repositorio **no** decide negocio: sólo consulta y proyecta (`docs/architecture.md` §Repository).
> El único cálculo del snapshot es "copiar", y no hay derivación de importes aquí.

### 3.2 Sin cambios en el contrato del service

`CierreDiaService.solicitarCierre` y `CorteDiarioService.ejecutar` **no cambian**: siguen llamando a
`crearCierre(input)` con el mismo input. Es el motivo por el que ambos caminos (solicitud y corte
diario, (f)) quedan cubiertos sin tocarlos. `CrearCierreInput` no se extiende.

## 4. Flujo de lectura: los feeds pasan al snapshot

### 4.1 `WalletFeedService` (42) — R12/R14

Hoy: `gestionOrden.findMany` → `g.orden.{zonaId, montoCobrar, cobraComision, zona.esCentral}` +
`tarifaRepo.resolveTarifaPorZona(zonaId)` (vivos). Pasa a:

```ts
const [detalle, gestiones] = await Promise.all([
  tx.cierreDetail.findMany({ where: { cierreId }, select: DETALLE_SELECT }),
  tx.gestionOrden.findMany({ where: { cierreId }, select: { ordenId: true, resultado: true } }),
]);
const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
for (const g of gestiones) {
  const d = byOrden.get(g.ordenId);
  if (d === undefined) throw new CierreDetalleFaltanteError(cierreId, g.ordenId); // R14
  entradas.push({ input: { resultado: g.resultado, esCentral: d.esCentral, montoCobrar: …, cobraComision: d.cobraComision }, tarifa: tarifaDe(d) });
}
```

- El **grano se respeta**: `cierre_detail` aporta lo de la ORDEN, `gestion_orden` aporta el
  `resultado` (que es de la GESTIÓN). Una orden con 2 gestiones vigentes en el cierre aporta 2
  entradas que comparten la misma fila congelada. Esto es lo que hace correcto el grano ORDEN.
- `tarifaDe(d)`: `null` si `tarifa_id IS NULL` (gap R9 preservado, `derivarIngresoOrden` ya lo maneja,
  `ingreso-ordenex.ts:58`); si no, reconstruye `TarifaVigente` con `toFixed(2)` (money-safe, R11).
- **`WalletFeedService` pierde su dependencia de tarifa**: constructor sin `tarifaRepo`, sin caché
  (`WalletFeedService.ts:43-49` desaparece — la tarifa ya viene congelada por fila). Se actualiza el
  composition root `lib/actions/cierres-admin.ts:69,74`.
- `agregarIngresosPorConcepto` / `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`) **NO se tocan**:
  misma fórmula, mismas entradas, distinta procedencia. R21 se cumple sin cambio de fórmula.

### 4.2 `WalletTiendaFeedService` (43) — R13/R14

Idéntico, con dos diferencias: `tiendaId` sale de `d.tiendaId` (**congelado**: a quién se acredita ya
no puede moverse) y `montoRecibido` se sigue leyendo de `gestion_orden` (es el COD realmente recaudado
por esa gestión: dato de la gestión, ya inmutable de facto). El interruptor Q3 (43/R28) se sigue
leyendo al aprobar: es **política de la casa**, no un dato de la orden — no se congela.

### 4.3 `WalletMensajeroFeedService` (44)

**No se toca.** Ya consume sólo snapshots del `cierre_dia` (`WalletMensajeroFeedService.ts:31-33`). Es
el modelo que las otras dos adoptan.

### 4.4 Detalle del admin (38) — R15/R16/R19

`CierresAdminRepository.findCierreByIdEnAlcance` (`:130-134`) reusa hoy `WITH_DETALLE` +
`toPendienteRow` de la 37, que navegan `gestion_orden.orden.*` **vivo**. Pasa a leer
`cierre_detail` y componerlo con la gestión, devolviendo el **mismo DTO**
(`CierreGestionPendienteRow`) — la UI no cambia.

- `WITH_DETALLE` / `toPendienteRow` **siguen existiendo** para la vista EN VIVO de la 37
  (`findGestionesPendientes`, gestiones con `cierre_id IS NULL`, que por definición no tienen
  snapshot). **R16 = no romper esto.**
- Efecto colateral que resuelve R19: una orden con `deleted_at` sigue mostrándose (hoy también, por
  otra razón: `WITH_DETALLE` no filtra `deletedAt` y la FK es NOT NULL). Con el snapshot deja de
  depender de ese accidente.
- Consumidores de `WITH_DETALLE` verificados: sólo `CierreDiaRepository` y `CierresAdminRepository`.

## 5. Backfill (R26/R27) — decisión (a)

Va en el **UP**, después del `CREATE TABLE`, en SQL puro (una sentencia, sin cursor):

```sql
INSERT INTO "cierre_detail" (id, cierre_id, orden_id, monto_cobrar, cobra_comision, zona_id,
       tienda_id, es_central, tarifa_id, tarifa_valor_flete, …, num_guia, …, created_at)
SELECT gen_random_uuid(), sub.cierre_id, sub.orden_id, o.monto_cobrar, o.cobra_comision, o.zona_id,
       o.tienda_id, z.es_central, t.id, t.valor_flete, …, o.num_guia, …, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT g.cierre_id, g.orden_id
        FROM "gestion_orden" g
       WHERE g.cierre_id IS NOT NULL AND g.anulada_at IS NULL) sub
JOIN "orden" o        ON o.id = sub.orden_id
JOIN "zona" z         ON z.id = o.zona_id
JOIN "usuario" u      ON u.id = o.tienda_id
JOIN "provincia" p    ON p.id = o.provincia_id
JOIN "canton" c       ON c.id = o.canton_id
LEFT JOIN "distrito" d ON d.id = o.distrito_id
LEFT JOIN LATERAL (
  SELECT * FROM "tarifas" ta
   WHERE ta.tienda_id = o.tienda_id AND ta.deleted_at IS NULL
   ORDER BY ta.created_at DESC LIMIT 1
) t ON TRUE
ON CONFLICT ("cierre_id", "orden_id") DO NOTHING;
```

- `DISTINCT (cierre_id, orden_id)` ⇒ grano ORDEN (R2) aunque la orden tenga varias gestiones.
- `anulada_at IS NULL` ⇒ mismo criterio que `crearCierre` (R5).
- El `LATERAL` replica **exactamente** la regla del resolver (por tienda, no borrada, la más reciente).
  **NO lleva `AND ta.status = 'activo'`** — decisión (g), override del humano (§6.1). El backfill y el
  resolver deben coincidir al carácter: si divergieran, un cierre backfilleado y uno nuevo liquidarían
  distinto para los mismos datos.
- `LEFT JOIN` ⇒ tienda sin tarifa deja las columnas `tarifa_*` en NULL: es el gap (R9), no un fallo.
- `ON CONFLICT DO NOTHING` ⇒ idempotente (la migración se puede re-correr tras un rollback).
- **Sin fallback en los lectores**: tras esto, todo cierre existente tiene detalle (R27), y `falta la
  fila` pasa a ser un error legítimo (R14) en vez de un silencio.
- `gen_random_uuid()`: `pgcrypto`/PG13+. Si no estuviera disponible, `md5(random()::text || clock_timestamp()::text)::uuid`.
  **El implementer verifica cuál aplica antes de escribir el SQL** (no se asume).

## 6. Absorción de la feature 68 (desbloquea el build) — R20-R23/R28

Hecho verificado: `tarifas` tiene `tienda_id` + `status` y **no** tiene `zona_id`
(`db/schema.prisma:522-543`); `TarifaVigentePorZonaRepository.ts:22` la consulta por `zonaId` ⇒
`pnpm typecheck` rojo ⇒ `pnpm build` y `./init.sh` rojos.

**Recableo (decisión del humano, ya resuelta):** la tarifa se resuelve por `orden.tienda_id` →
`tarifas.tienda_id`; la **zona sigue eligiendo la COLUMNA** (`valor_flete_gam` vs `valor_flete`,
`valor_flete_devuelto_gam` vs `valor_flete_devuelto`) vía `es_central`, como ya hace
`derivarIngresoOrden` (`ingreso-ordenex.ts:63,84`). La dimensión zona **no se pierde**: vive dentro de
la fila de `Tarifa`. Renombres:

| Antes | Después |
| --- | --- |
| `lib/interfaces/repositories/ITarifaVigentePorZonaRepository.ts` | `…/ITarifaVigentePorTiendaRepository.ts` |
| `interface ITarifaVigentePorZonaRepository` | `ITarifaVigentePorTiendaRepository` |
| `interface TarifaVigentePorZona` | `TarifaVigente` |
| `resolveTarifaPorZona(zonaId)` | `resolveTarifaPorTienda(tiendaId)` **+** `resolveTarifasPorTiendas(tx, tiendaIds)` (§3.1) |
| `lib/repositories/TarifaVigentePorZonaRepository.ts` | `…/TarifaVigentePorTiendaRepository.ts` |

**Lo que NO cambia del `WHERE` (decisión (g), override del humano):** el resolver sigue filtrando
**sólo** `deletedAt: null` + `orderBy createdAt desc`. **`tarifas.status` NO entra** (R22). Es
deliberado, no un olvido: ver §6.1.

**Consumidor final tras la 69:** sólo `CierreDiaRepository` (al **solicitar**). Los feeds dejan de
depender de él (§4.1/4.2) — el resolver se invoca **una vez por cierre, al congelar**, nunca al
aprobar. Ese es exactamente el cambio que mata el vector "cambió la tarifa entre solicitar y aprobar"
(R18).

**Cobertura real (R23, decisión (d)):** `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts`
instancia la **clase real** con un doble de `Pick<PrismaClient,"tarifa">` (patrón
`tests/unit/repositories/cierre-dia-repository.test.ts:38-58`: objeto literal con `vi.fn()` + inyección
por constructor con cast) y afirma los **argumentos exactos** de `tarifa.findFirst` / `findMany`
(`where.tiendaId`, `deletedAt: null`, `orderBy: { createdAt: 'desc' }`, `select`). Hoy **todos** los
tests mockean la interfaz ⇒ la 68 nunca salió en rojo por test.

### 6.1 Decisión (g): `tarifas.status` NO se filtra — deuda conocida y aceptada

**Qué se decidió.** El humano hizo **override** de la recomendación del spec_author (que era filtrar
`status = 'activo'`). El resolver conserva el comportamiento actual: `tienda_id` + `deletedAt: null` +
la más reciente. Una tarifa `inactivo` no borrada **sigue siendo candidata**.

**Razón.** No mezclar **dos cambios de dinero en un mismo PR**. La 69 ya mueve dos ejes monetarios
(*qué* tarifa se resuelve: por tienda, no por zona; y *cuándo* se lee: al solicitar, no al aprobar).
Un tercer eje (*qué filas son candidatas*) haría los tres efectos indistinguibles si algo descuadra.

**Riesgo, sin maquillar.** Mientras `status` no entre en el `WHERE`, **el dinero puede derivarse de una
tarifa `inactivo`**, incluida la de una tienda que dejó de ser `adminTienda` — exactamente lo que
`status` marca (`db/schema.prisma:533`). La 69 **no lo introduce** (existe desde el PR #64) pero
**tampoco lo arregla**, y ahora además lo **congela**: el snapshot registrará fielmente la tarifa
inactiva que se haya elegido. Un cierre puede quedar liquidado, en libro inmutable, contra una tarifa
que la operación considera muerta.

**Contrapartida real:** `tarifa_id` en `cierre_detail` (§2.1) hace la deuda **auditable por primera
vez** — hoy no queda rastro de *qué fila* se usó. Tras la 69 se puede listar qué cierres liquidaron
contra una tarifa hoy inactiva. Eso es lo que haría accionable una futura corrección.

**Fijación en tests:** R22 exige que el test del resolver afirme que el `where` **NO contiene**
`status`. Suena raro testear una ausencia, y es a propósito: si alguien "arregla" el filtro sin pasar
por una gate, el test lo delata en vez de dejar que un cambio de dinero entre de contrabando.

#### La tensión del `TODO` — resuelta explícitamente (no implícita)

El humano pidió un `TODO:` que diga *"la salida prevista es migrarlo a snapshot"*. **Ese texto queda
sin objeto tal cual está escrito, y hay que decirlo en vez de arrastrarlo:**

- **El snapshot de tarifa lo introduce ESTA feature.** R8 congela los 7 valores + `tarifa_id` al
  solicitar. Tras la 69, la tarifa **ya está migrada a snapshot**: no queda nada pendiente en ese eje.
- **Lo que el snapshot NO cambia es cuál fila se elige.** `cierre_detail` congela *los valores de la
  fila que el resolver seleccionó*. Si el resolver elige una `inactivo` (por ser la más reciente no
  borrada), el snapshot congela fielmente… la tarifa equivocada. **Congelar no corrige la selección: la
  vuelve permanente.**
- **Conclusión:** lo pendiente es la **regla de selección de la fila vigente** — decidir si `status`
  entra en el `WHERE` y qué pasa con las tiendas que se quedan sin candidata (⇒ `null` ⇒ gap (c) ⇒
  conceptos 0.00). Coincide con la lectura del leader. El `TODO` se redacta con **esa** framing.

**Reportado al humano** (regla 6 del arnés: no inventar un pendiente vacío ni resolverlo por cuenta
propia). El punto (3) del texto solicitado para el `TODO` se sustituye por la formulación de arriba;
**el texto exacto queda sujeto a su confirmación** antes de que `T2b` lo escriba. El `TODO` **no** queda
sin objeto: cambia de objeto (selección, no congelado).

**Segundo error de typecheck (R28):** `scripts/seed-zonas.ts:257` hace
`prisma.distrito.update({ data: { zonaId } })`; `distrito.zona_id` fue dropeada por
`20260713000000_drop_distrito_zona_id` y la zona del distrito vive en la N:M `zona_distrito`
(feature 24, `schema:300-303`, `@@unique([zonaId, distritoId])`). Se recablea a un upsert sobre
`zona_distrito` (idempotente, R39 de la 24). El resto del script (conteos `asignados` /
`ternasSinCorrespondencia`) no cambia de semántica.

## 7. Alternativas descartadas

### 7.1 Congelar los CONCEPTOS YA DERIVADOS en vez de las ENTRADAS — decisión (b), opción 3

**Descartada.** Era la candidata más fuerte y **la que el leader había sugerido** ("es lo que ya hacen
los `*_movimiento`: guardan el monto agregado por concepto y no copian nada de orden"). Se evaluó a
fondo y el análisis **revirtió esa sugerencia**; el humano aprobó la reversión el 2026-07-15 y pidió
que el razonamiento quedara escrito aquí. Motivos, en orden de peso:

- **Choca con el grano aprobado — argumento decisivo.** Los conceptos derivados dependen del
  `resultado` de la **GESTIÓN**, no de la orden. Verificable en `lib/utils/ingreso-ordenex.ts`:
  **:62** `if (input.resultado === "entregada")` → flete + IVA flete (+ comisión COD + su IVA si
  `cobraComision`); **:82** `if (input.resultado === "devuelta" || input.resultado === "rechazada")` →
  flete de devolución + su IVA; **:92-93** `reprogramada` → `{}` (no aporta a ningún concepto).
  La misma orden produce conceptos **distintos** según cómo terminó cada gestión ⇒ congelarlos exige
  grano **gestión**, que es justo el grano que el humano descartó para `cierre_detail`. Y lo descartó
  con razón: una orden puede acumular varias gestiones vigentes en el mismo cierre (reintentos 46/47;
  `schema:379` documenta explícitamente que **no** se fuerza `@@unique(ordenId)`).
  Las ENTRADAS, en cambio (`monto_cobrar`, `cobra_comision`, `zona`, `tienda`, `es_central`, tarifa),
  **sí** son función de la orden: encajan en el grano (cierre, orden) sin forzar nada.
- **El paralelismo con los `*_movimiento` es aparente.** Esos son la **salida** de un cierre
  **aprobado**. El hueco que hay que tapar está **entre** solicitar y aprobar; ahí lo único estable
  que se puede fijar son las **entradas**.
- **No simplifica.** La 43 necesita el desglose por concepto igual (interruptor Q3), así que serían
  6 columnas de conceptos en lugar de 8 de tarifa: mismo orden de magnitud, menos información.
- **Pierde auditabilidad.** Con las entradas congeladas, la fila es **re-derivable**: entradas +
  fórmula ⇒ salida. Con la salida congelada, "¿por qué este cierre cobró ₡X?" no tiene respuesta en
  la fila.

### 7.2 Tabla `cierre_tarifa` con fila por (cierre, tienda) — pregunta (b), opción 2

**Descartada.** Normaliza (una tienda con 40 órdenes en un cierre no repetiría 7 decimales), pero
añade una segunda tabla, un join en la ruta caliente de aprobación y un segundo `createMany` en la tx,
para ahorrar bytes en una tabla que **ya** desnormaliza 5 nombres a propósito. El ahorro no paga la
complejidad. Si algún día el volumen lo justifica, se migra sin tocar los lectores (el DTO ya está
desacoplado del storage).

### 7.3 Guarda al UPDATE de `orden` en vez del snapshot — pregunta (e)

**Descartada como solución** (y no se añade como complemento en esta feature):

- **No cubre la tarifa**, que es la mitad del bug: cambiar `tarifas` no toca `orden`.
- **Rompe ediciones legítimas**: `OrdenRepository.update` mueve `estatus_id`, `mensajero_asignado_id`,
  `notas`… Una guarda "orden con cierre ⇒ inmutable" rompería 46/47/67. Una guarda selectiva por campo
  money-critical es una feature con su propia gate.
- **Redundante tras el snapshot**: si el cierre no mira la orden viva, editarla ya es inofensivo (R17).

### 7.4 Lectores con fallback a datos vivos, sin backfill — pregunta (a)

**Descartada.** Mantendría dos caminos de lectura money-critical vivos para siempre; el camino B es
justo el bug que esta feature mata, y ningún test podría demostrar que ya no se toma. Con backfill +
`throw` (R14), *falta la fila* es un fallo **ruidoso** en vez de un descuadre silencioso. Ver
`requirements.md` (a) para el riesgo aceptado (el backfill no repara descuadres pasados).

### 7.5 Reparar sólo la 68 y dejar el snapshot para después

**Descartada por el alcance aprobado.** Recablear el resolver por tienda sin congelarlo devuelve el
build a verde y **deja el agujero money-critical abierto**. Además el recableo cambia *qué tarifa*
resuelve cada orden: hacerlo sin congelar movería dinero de cierres ya solicitados.

## 8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| **(g) El dinero puede derivarse de una tarifa `inactivo`** | **NO mitigado — deuda conocida y ACEPTADA** por override del humano (§6.1). No la introduce la 69 (existe desde el PR #64), pero la 69 la congela. Marcador `TODO:` (R30) + `tarifa_id` congelado la hace auditable. Razón: no mezclar dos cambios de dinero en un PR |
| El backfill congela valores ya descuadrados | Aceptado y documentado (a): no hay historial de `monto_cobrar` que permita reconstruir el original. Detiene la sangría, no cura la herida |
| `throw` en el feed (R14) bloquea una aprobación en producción | Es el diseño: preferimos aprobación abortada y visible a descuadre silencioso. R27 (backfill) hace que el caso no deba ocurrir |
| Renombrar la interfaz de tarifa toca 42/43 y sus tests | Contenido: el resolver queda con **un** consumidor (`CierreDiaRepository`); los feeds dejan de depender de él |
| La denylist de `tests/integration/db/zonas-migration.test.ts:127-163` se pone roja | Task explícita `T9`. La última condición (`:163`) no lleva `&&`: hay que reescribirla al apendar |
| Otra sesión aterriza una migración con timestamp posterior | Re-numerar la carpeta antes del merge (la migración aún no está aplicada en ninguna base) |
