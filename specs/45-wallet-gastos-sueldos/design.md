# Feature 45 — Wallet: gastos fijos/variables y sueldos — design.md

> Decisiones técnicas. Reutiliza al máximo la infraestructura money-critical de la 42
> (libro `wallet_movimiento`, balance derivado, idempotencia por índice parcial, RLS,
> UI `/wallet`) y el patrón de crons de la 41/46. Cita archivos reales.
>
> **Cambio de alcance F1.4 (2026-07-13):** los **gastos fijos** dejan de registrarse a
> mano; ahora hay una **entidad `gasto_fijo_plantilla`** (CRUD del maestro) y un **cron
> mensual** (`/api/cron/generar-gastos-fijos`) que emite los egresos, idempotente por
> `(plantilla, periodo)`. Gastos variables y sueldos siguen siendo registro manual.

## 0. Principio rector

Los egresos administrativos NO son una entidad nueva: son **filas de egreso** en el libro
polimórfico `wallet_movimiento` (feature 42, `db/schema.prisma` modelo `WalletMovimiento`),
el mismo patrón con el que la 44 emite `egreso_pago_mensajero` en la caja
(`lib/repositories/CierresAdminRepository.ts` → `WalletMovimientoRepository.crearMovimientos(tx, ...)`).
El balance DERIVADO (`WalletMovimientoRepository.agregarBalance` + `lib/utils/wallet-balance.ts`)
los resta sin cambios. La ÚNICA entidad nueva es la **plantilla** de gasto fijo (`gasto_fijo_plantilla`),
que es **configuración recurrente** (mutable) de la que el cron deriva los egresos — NO es parte del libro.

## 1. Modelo de datos

### 1.1 Enums (migración ADITIVA — R21)

Se extiende `wallet_movimiento_categoria` (`db/schema.prisma`, ~línea 595) con DOS valores:

```
egreso_gasto_fijo       // feature 45: gasto fijo (lo emite el CRON, no el form manual)
egreso_gasto_variable   // feature 45: gasto variable (manual)
```

- `egreso_sueldo` YA existe (reservado en la 42) → se reutiliza para sueldos (manual).
- `egreso_gasto` YA existe pero queda **sin uso** (Postgres no permite `DROP VALUE`;
  recrear el tipo para quitarlo sería destructivo e innecesario). Se documenta como reservado.
- `ingreso_ajuste` (existente) se reutiliza para las reversas (§4).
- `wallet_origen_tipo` NO se toca: se usa el valor existente **`gasto`** para los 3 tipos de
  egreso administrativo. La `categoria` distingue fijo/variable/sueldo (evita churn de enum).

Actualización obligatoria en TS (guardas de compilación, no runtime):
- `lib/types/wallet.ts` → añadir ambos valores a `WALLET_MOVIMIENTO_CATEGORIA_SEED`
  (el `satisfies` + `_EnsureCategoriaExhaustive` rompen el build si faltan).
- `app/(app)/wallet/_components/wallet-labels.ts` → `CATEGORIA_LABEL` es un
  `Record<WalletMovimientoCategoria, string>` exhaustivo → añadir etiquetas
  ("Gasto fijo", "Gasto variable") o el build falla. `CATEGORIA_OPTIONS` (filtro del libro)
  se puebla del SEED → las nuevas categorías aparecen automáticamente.

### 1.2 Tabla NUEVA `gasto_fijo_plantilla` (entidad de configuración recurrente, R24–R26)

Definición recurrente que el maestro administra. **Es CONFIGURACIÓN mutable** (a diferencia del
libro `wallet_movimiento`, que es inmutable): SÍ lleva `updated_at` y se edita/activa/desactiva.
NO se borra (R25): la desactivación (`activa=false`) detiene la generación futura y preserva el
rastro de qué generó cada egreso.

```prisma
// Feature 45: plantilla recurrente de gasto fijo. Configuración mutable (NO es el libro).
// El cron mensual lee las ACTIVAS y emite un egreso egreso_gasto_fijo por cada una.
// RLS habilitada sin policies (solo service role, patrón wallet_movimiento).
model GastoFijoPlantilla {
  id        String   @id @default(uuid())
  concepto  String   // nombre/concepto del gasto fijo (obligatorio, no vacío)
  monto     Decimal  @db.Decimal(12, 2) // > 0
  activa    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  @@index([activa]) // cron: WHERE activa = true
  @@map("gasto_fijo_plantilla")
}
```

**Periodicidad (F1.4-b):** SIEMPRE mensual, día 1 fijo. **NO** se modela `dia_del_mes`: mantiene el
cron mensual (`0 6 1 * *`) simple; un día configurable exigiría un cron DIARIO con filtro → follow-up
(ver §7.3). El "periodo" es el mes calendario `YYYY-MM`; la fecha del egreso es `now()` del día 1.

### 1.3 Forma de una fila de egreso administrativo en `wallet_movimiento` (sin columnas nuevas)

| Columna | Gasto variable / Sueldo (manual) | Gasto fijo (cron) |
| --- | --- | --- |
| `tipo` | `egreso` (R1) | `egreso` (R1/R27) |
| `categoria` | `egreso_gasto_variable` \| `egreso_sueldo` (R2) | `egreso_gasto_fijo` (R27) |
| `monto` | `Decimal(12,2)` > 0, desde STRING (R4) | `= plantilla.monto` (R27) |
| `origen_tipo` | `gasto` (R3) | `gasto` (R27) |
| `origen_id` | `NULL` (R3) → fuera del índice único parcial → sin dedup, cada egreso manual es una fila | **`"<plantillaId>:<YYYY-MM>"`** (R28) → DENTRO del índice único parcial → dedup por (plantilla, mes) |
| `descripcion` | concepto del gasto o nombre+periodo del trabajador (obligatoria, R5) | `"<concepto> — <YYYY-MM>"` |
| `registrado_por` | id del maestro autenticado (R3) | `NULL` (automático, R27) |
| `fecha_movimiento` / `created_at` | `now()` (default) | `now()` (default) |

**Clave de idempotencia del cron (R28) — EXACTA:** la tupla del índice único parcial existente
`wallet_movimiento_origen_categoria_uq (origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`
queda, para un gasto fijo, en `('gasto', '<plantillaId>:<YYYY-MM>', 'egreso_gasto_fijo')`. Es única por
plantilla y por mes → a lo sumo UN egreso por (plantilla, periodo). Reejecutar el cron el mismo mes es un
no-op vía `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING), sin TOCTOU.

**No colisión con el índice existente:** NO se crea ni se altera ningún índice. La reversa usa
`origen_id = <uuid del egreso>` con `categoria = ingreso_ajuste` (tupla distinta); los egresos manuales usan
`origen_id = NULL` (fuera del índice). El formato `<uuid>:<YYYY-MM>` no puede coincidir con un uuid puro. Por
tanto la nueva regla de unicidad convive con la de la reversa sin colisión.

## 2. Capas (Controller → Service → Repository)

### 2.1 Repository

**(a) `WalletMovimientoRepository`** (`lib/repositories/`, + `IWalletMovimientoRepository`) — extensión aditiva:
- Se REUTILIZA `crearMovimientos(tx, movs)` tal cual para el egreso manual, la reversa Y los egresos del cron
  (idempotente por `skipDuplicates` → ON CONFLICT DO NOTHING sobre el índice parcial).
- NUEVO `obtenerPorId(id): Promise<WalletMovimientoDTO | null>` — lee el egreso original para la reversa
  (monto server-side, R13; evita que el cliente falsee el monto).
- NUEVO `agregarPorCategoria(filtros): Promise<Record<categoria, string>>` — `groupBy` `categoria` con
  `_sum.monto` sobre `buildWhere`, acotado a las 3 categorías administrativas → desglose (R11). Salida STRING.

**(b) NUEVO `GastoFijoPlantillaRepository`** (`lib/repositories/`, + `IGastoFijoPlantillaRepository`):
- `crear({concepto, monto})`, `actualizar(id, {concepto, monto})`, `setActiva(id, activa)` (R24/R25).
- `listar(): PlantillaDTO[]` (todas, orden por `created_at` desc) (R26).
- `listarActivas(): PlantillaDTO[]` (`WHERE activa = true`) — consumo del cron (R27).
- `obtenerPorId(id)`. Montos SIEMPRE STRING (`toFixed(2)`) en el DTO (R12). NO borra (sin `delete`).

### 2.2 Service

**(a) NUEVO `WalletEgresoService`** (`lib/services/`, impl. `IWalletEgresoService`). Recibe por inyección
`IWalletMovimientoRepository` + un `WalletTxClient` (el PrismaClient), igual que `WalletService`. Guardia
`ROL_AUTORIZADO = "maestro"` (R17), espejo de `WalletService`.
- `registrarEgreso(input, actor)` — `actor.rol !== "maestro"` → `forbidden` (R17). Mapea
  `input.tipoEgreso ∈ {gasto_variable, sueldo}` → `categoria` (R2). `crearMovimientos(writeClient, [{
  tipo:"egreso", categoria, monto, origenTipo:"gasto", origenId:null, descripcion, registradoPor: actor.usuarioId }])`
  (R1/R3/R7). Relee y devuelve el movimiento (patrón `WalletService.registrarMovimientoManual`).
- `reversarEgreso(input, actor)` — guardia maestro (R17/R18). `obtenerPorId(movimientoId)`; si no existe o no
  es egreso administrativo (`tipo=egreso` ∧ `origen_tipo=gasto`) → `not_found`. `crearMovimientos(writeClient,
  [{ tipo:"ingreso", categoria:"ingreso_ajuste", monto: original.monto, origenTipo:"gasto", origenId: original.id,
  descripcion:"Reverso de <detalle>", registradoPor: actor.usuarioId }])` (R13/R16). Idempotencia (R15): la
  tupla `(gasto, <egresoId>, ingreso_ajuste)` es única en el índice parcial → segundo intento no-op vía
  `skipDuplicates`; reporta `already_reversed` si `count===0`. Aplica igual a egresos generados por el cron (R32).
- `verDesgloseEgresos(filtros, actor)` — guardia maestro; `agregarPorCategoria` → totales por tipo (R11).

**(b) NUEVO `GastoFijoPlantillaService`** (`lib/services/`, impl. `IGastoFijoPlantillaService`). Recibe
`IGastoFijoPlantillaRepository`. Guardia `maestro` en todos los métodos (R17): `crearPlantilla`,
`actualizarPlantilla`, `activarPlantilla`/`desactivarPlantilla` (R25), `listarPlantillas` (R26). Sin borrado.

**(c) NUEVO `GeneracionGastosFijosService`** (`lib/services/`, impl. `IGeneracionGastosFijosService`) — lógica
del cron (patrón `CorteDiarioService`/`LiberacionReprogramadaService`). Recibe `IGastoFijoPlantillaRepository`,
`IWalletMovimientoRepository` y un `WalletTxClient`. Método `ejecutarGeneracion(now: Date)`:
- `periodo = periodoMensualCR(now)` (R30, §5.3).
- `plantillas = repo.listarActivas()` (R27; las inactivas no entran).
- Construye un array de movimientos: por cada plantilla `{ tipo:"egreso", categoria:"egreso_gasto_fijo",
  monto: p.monto, origenTipo:"gasto", origenId: `${p.id}:${periodo}`, descripcion: `${p.concepto} — ${periodo}`,
  registradoPor: null }` (R27).
- `count = crearMovimientos(writeClient, movs)` — un ÚNICO `createMany` (atómico, R31) con `skipDuplicates`
  (idempotente por el índice parcial, R28). Devuelve `{ periodo, plantillasActivas: movs.length, egresosGenerados: count }`
  (conteos, SIN PII, R29).

`WalletService` (42) se deja INTACTO (no se toca su firma) → sin regresión (R9).

### 2.3 Controllers

**(a) Server Actions (mutación/lectura interna, no Route API):**
- `lib/actions/wallet-egresos.ts` (`'use server'`, patrón `lib/actions/wallet.ts`):
  `registrarEgresoAdministrativoAction`, `reversarEgresoAdministrativoAction`, `verDesgloseEgresosAction`.
  Resuelven actor con `resolveActorFromSession`, validan con zod bajo `withErrorHandler`; `unauthenticated`
  (R18) y `validation_error` (ZodError, R4/R5/R19) en el borde; `forbidden`/`ok`/`not_found` del service.
- `lib/actions/gasto-fijo-plantilla.ts` (`'use server'`): `crearPlantillaAction`, `actualizarPlantillaAction`,
  `setActivaPlantillaAction`, `listarPlantillasAction` (mismo patrón; `validation_error` R24, `forbidden` R17).

**(b) Route Handler del cron** — `app/api/cron/generar-gastos-fijos/route.ts`, **clon del patrón 41/46**:
- `GET(req)` → `handleGenerarGastosFijos(req, deps)` con `deps` inyectables (secreto, service, `now`) para tests.
- **Auth ANTES de efectos (R29):** `expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))()`;
  `provided = bearerToken(req)`; si `expected===null || provided===null || provided!==expected` → `401`
  (`{ error: "unauthorized" }`) sin construir el service ni tocar la DB. Reutiliza el MISMO `CRON_SECRET`
  (env, `lib/config/cron.ts`), igual que `liberar-reprogramadas`.
- Bajo `withErrorHandler`: `hoy = (deps.now ?? (() => new Date()))()`; `resumen = service.ejecutarGeneracion(hoy)`;
  responde `{ periodo, plantillasActivas, egresosGenerados }` (conteos, sin PII, R29). Errores → `appErrorToResponse`
  (notificado por el logger, sin secreto).

**Zod** (schemas de borde):
```ts
// lib/types/wallet.ts (junto a los existentes; reutiliza montoPositivoSchema)
export const registrarEgresoAdministrativoSchema = z.object({
  tipoEgreso: z.enum(["gasto_variable", "sueldo"]),                 // R19 (gasto_fijo NO: lo emite el cron)
  monto: montoPositivoSchema,                                       // R4 (STRING, >0, 2 dec)
  descripcion: z.string().trim().min(1, "La descripción es obligatoria."), // R5
});
export const reversarEgresoSchema = z.object({ movimientoId: z.string().uuid() }); // R13

// lib/types/gasto-fijo-plantilla.ts (nuevo)
export const crearGastoFijoPlantillaSchema = z.object({
  concepto: z.string().trim().min(1, "El concepto es obligatorio."), // R24
  monto: montoPositivoSchema,                                        // R24 (STRING, >0, 2 dec)
});
export const actualizarGastoFijoPlantillaSchema = crearGastoFijoPlantillaSchema.extend({
  id: z.string().uuid(),
});
export const setActivaPlantillaSchema = z.object({ id: z.string().uuid(), activa: z.boolean() }); // R25
```

**Contratos I/O** (frontera → cliente): montos SIEMPRE STRING (R12). DTOs:
```ts
type WalletMovimientoDTO = { ... };                 // reutiliza el de la 42
type DesgloseEgresosDTO = { gastoFijo: string; gastoVariable: string; sueldo: string; total: string };
type GastoFijoPlantillaDTO = { id: string; concepto: string; monto: string; activa: boolean;
                               createdAt: string; updatedAt: string };
```

## 3. Frontend (`app/(app)/wallet/`)

- `app/(app)/wallet/page.tsx` (Server Component role-aware, YA existe): además del pre-fetch actual,
  pre-obtiene el desglose (`verDesgloseEgresosAction`) y las plantillas (`listarPlantillasAction`) y los pasa
  por props (datos sensibles → props, nunca fetch cliente).
- `WalletModule.tsx`: monta, junto a `RegistrarMovimientoManualDialog`, un `RegistrarEgresoAdministrativoDialog`,
  una tarjeta de desglose y el panel de plantillas. Al registrar/reversar/editar plantilla llama `recargar(...)` +
  `router.refresh()` (R23), patrón existente.
- NUEVO `app/(app)/wallet/_components/RegistrarEgresoAdministrativoDialog.tsx` (egreso manual, R22a):
  `Select` de tipo **{Gasto variable, Sueldo}** (SIN "gasto fijo"), `Input` de monto (STRING,
  `inputMode="decimal"`, regex >0 sin `parseFloat`), `textarea` de descripción (label adaptado: "Concepto"
  para gasto variable / "Trabajador y periodo" para sueldo). Reutiliza `Modal`/`Select`/`Input`/`Label`.
- NUEVO `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` (CRUD de plantillas, R22b): tabla/lista
  con `concepto`, `monto` (`money()`), toggle `activa` (activar/desactivar → `setActivaPlantillaAction`), botón
  "Editar" (dialog reutilizado) y botón "Nueva plantilla" (dialog crear). Deja claro que los egresos de gasto
  fijo **los genera el cron**, no este panel (nota/tooltip). Layout recomendado: una `Card` "Gastos fijos
  (plantillas)" con la lista + acciones, aparte de la `Card` de egreso manual y de la de desglose.
- NUEVO `app/(app)/wallet/_components/DesgloseEgresosCard.tsx`: totales por tipo (STRING + `money()`), reflejan
  el conjunto filtrado (R11).
- `WalletLedger.tsx`: sin cambios de lógica; muestra las nuevas categorías vía `CATEGORIA_LABEL`. La reversa se
  ofrece como acción por fila SOLO sobre egresos administrativos (`origen_tipo==="gasto"` ∧ `tipo==="egreso"`) —
  incluye los generados por el cron —, con confirmación (`Modal`), R22c/R14/R32.

Autorización (R17): la página `notFound()` a no-maestro (ya vigente); las actions revalidan el rol server-side.

## 4. Corrección / reversa (append-only, R13–R16, R32)

- La reversa es un `ingreso_ajuste` con `origen_tipo=gasto` + `origen_id`=id del egreso → net cero en el
  balance (`+ingreso` compensa `-egreso`), sin `UPDATE`/`DELETE` (R14/R16).
- La descripción referencia el egreso ("Reverso de: <detalle original>").
- Idempotencia por el índice único parcial YA existente `wallet_movimiento_origen_categoria_uq`: la tupla
  `(gasto, <egresoId>, ingreso_ajuste)` es única → a lo sumo una reversa (R15).
- **Egreso generado por el cron (R32):** tiene `tipo=egreso` ∧ `origen_tipo=gasto`, así que es reversable por el
  mismo camino (la reversa referencia su `id` uuid, distinto de su `origen_id` derivado). Para dejar de generarlo
  en el futuro, se DESACTIVA la plantilla (`activa=false`, R25) — no se borra ni la plantilla ni el egreso.

  > **⚠️ SUPERSEDED 2026-08-29 por la ficha 332** (`specs/332-eliminar-plantilla-gasto-fijo`).
  > La plantilla SÍ se puede borrar desde esa fecha, por decisión humana; desactivarla sigue siendo
  > la pausa reversible y sigue siendo lo correcto cuando la intención es «por ahora no». Lo que NO
  > cambia —y por eso la línea de arriba se conserva VERBATIM, con este bloque AÑADIDO detrás— es la
  > otra mitad de la frase: **el egreso no se borra nunca**. El libro es inmutable y el borrado de
  > la plantilla se detiene antes de él; el movimiento sobrevive con su monto, su fecha, su
  > `origen_id` y su descripción intactos, y se explica solo porque ésta ya lleva concepto y periodo.

## 5. Migraciones

### 5.1 Enum aditivo — `db/migrations/<ts>_wallet_egreso_gasto_fijo_variable/` (R21)

`migration.sql` (aditivo, patrón feature 41 `cierre_estado_vencido`):
```sql
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_fijo';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_variable';
```
(No se usan los valores en la misma migración → seguro; `IF NOT EXISTS` = idempotente.)

`down.sql` (recrea el tipo sin los 2 valores; espejo del down de `vencido`). Precondición R21: NINGUNA fila de
`wallet_movimiento` con esas categorías (si la hubiera, el `USING` cast FALLA y aborta — correcto). Se
sueltan/recrean los índices que referencian `categoria`:
```sql
DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";
DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";

ALTER TYPE "wallet_movimiento_categoria" RENAME TO "wallet_movimiento_categoria_old";
CREATE TYPE "wallet_movimiento_categoria" AS ENUM (
  'ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod',
  'ingreso_iva_flete','ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
  'ingreso_ajuste','egreso_pago_tienda','egreso_pago_mensajero',
  'egreso_gasto','egreso_sueldo','egreso_ajuste'
);
ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"
  TYPE "wallet_movimiento_categoria" USING ("categoria"::text::"wallet_movimiento_categoria");
DROP TYPE "wallet_movimiento_categoria_old";

CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"("tipo","categoria");
CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"
  ON "wallet_movimiento"("origen_tipo","origen_id","categoria") WHERE "origen_id" IS NOT NULL;
```
RLS de `wallet_movimiento` NO se toca (R20).

### 5.2 Tabla nueva de plantillas — `db/migrations/<ts>_gasto_fijo_plantilla/` (R33)

`migration.sql` (aditivo; patrón `wallet_tienda_movimiento` de la 43: tabla + índice + RLS sin policies):
```sql
CREATE TABLE "gasto_fijo_plantilla" (
  "id" TEXT NOT NULL,
  "concepto" TEXT NOT NULL,
  "monto" DECIMAL(12,2) NOT NULL,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gasto_fijo_plantilla_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gasto_fijo_plantilla_activa_idx" ON "gasto_fijo_plantilla"("activa");
-- RLS habilitada sin policies (solo service role), patrón wallet_movimiento/wallet_tienda_movimiento.
ALTER TABLE "gasto_fijo_plantilla" ENABLE ROW LEVEL SECURITY;
```
`down.sql` (DROP TABLE arrastra índices; no hay enum propio ni FK):
```sql
DROP TABLE IF EXISTS "gasto_fijo_plantilla";
```
Ambas migraciones se separan (enum vs. tabla) para round-trips independientes. Orden: la del enum primero, la de
la tabla después (independientes entre sí; sin dependencia de datos).

Verificación: `pnpm db:migrate` → `pnpm db:rollback` (`scripts/db-rollback.ts` aplica `down.sql`) →
`prisma migrate status` up-to-date al reaplicar (round-trip, R21/R33).

### 5.3 Utilidad de periodo CR (R30)

Extender `lib/utils/fecha-cr.ts` con `periodoMensualCR(now: Date): string` que devuelve `YYYY-MM` de la fecha
CALENDARIO de Costa Rica (UTC−6), reutilizando `CR_OFFSET_MS`/`startOfDayCR`. Fronteras testeables por inyección
de `now`: `2026-07-01T06:00:00Z` (00:00 CR del 1 jul) → `"2026-07"`; `2026-07-01T05:59:00Z` (23:59 CR del 30 jun)
→ `"2026-06"`.

## 6. Vercel Cron (schedule, R30)

`vercel.json` — añadir la entrada (mantener las de 41/46):
```json
{ "path": "/api/cron/generar-gastos-fijos", "schedule": "0 6 1 * *" }
```
`0 6 1 * *` = 06:00 UTC del día 1 = **00:00 CR del día 1** (UTC−6), misma convención de hora CR que
`corte-diario` (`0 6 * * *`) y `liberar-reprogramadas` (`0 6 * * *`). Auth por el MISMO `CRON_SECRET` (Bearer).

## 7. Verificación money-critical (resumen)

- Egreso (manual o cron) resta del balance derivado exactamente una vez (R8/R31) — test de agregación.
- Cron idempotente por (plantilla, periodo): reejecutar el mismo mes NO duplica ni cambia el balance (R28/R31) —
  test de integración DB que corre el cron dos veces.
- Cron: plantillas inactivas NO generan; hora CR en fronteras (R27/R30) — test de service + util `periodoMensualCR`.
- Auth `CRON_SECRET` antes de efectos (R29) — test del handler (401 sin/incorrecto secreto, sin tocar DB).
- Reversa = net cero + idempotente por índice parcial, aplica a egresos del cron (R15/R16/R32) — test integración DB.
- Sin regresión de 42/43/44: suite existente de `wallet-service`/`wallet-movimiento-repository`/`wallet-idempotencia`/
  `cierres-admin` verde (R9).
- Solo-maestro y unauthenticated (R17/R18) — tests de service + action.
- Round-trip de ambas migraciones (R21/R33) — tests de integración `db`.

## 8. Alternativas descartadas

### 8.1 Registro MANUAL de gastos fijos (recomendación del spec original) — DESCARTADA por el humano
El spec v1 recomendaba tratar "fijo" como una categoría más y registrarlo a mano cada periodo (sin tabla ni cron).
- **Por qué se descarta:** el humano eligió (F1.4-b) la **auto-generación por cron**: menos trabajo manual mensual,
  menos olvidos y consistencia (mismo monto cada mes). El costo (una tabla de plantillas + un cron) se paga una vez.

### 8.2 Entidad propia `gasto`/`sueldo` para el EGRESO (tabla nueva del movimiento) — DESCARTADA
Modelar los egresos en una tabla dedicada y emitir aparte un movimiento en `wallet_movimiento`.
- **Por qué se descarta:** duplica la fuente de verdad money-critical (dos escrituras que deben cuadrar
  atómicamente → doble conteo/desincronización), contradice la Q4 de la 42 (tabla ÚNICA polimórfica para 43/44/45)
  y re-implementa balance/idempotencia/RLS/UI. La plantilla NUEVA es solo configuración recurrente (no el libro),
  así que NO duplica el libro: sigue habiendo una sola fuente de verdad money (`wallet_movimiento`).

### 8.3 `periodo` como COLUMNA en `wallet_movimiento` + índice único nuevo — DESCARTADA
Añadir una columna `periodo` a la tabla compartida y un índice único `(plantilla, periodo)`.
- **Por qué se descarta:** contamina la tabla polimórfica con una columna que 42/43/44 no usan, y obliga a crear/
  coordinar un índice único nuevo con el `origen_categoria_uq` existente (riesgo de romper la idempotencia de la
  reversa/44). La **clave derivada `origen_id = "<plantillaId>:<YYYY-MM>"`** reutiliza el índice parcial existente
  sin tocar el esquema del libro ni el índice — más simple y seguro.

### 8.4 `dia_del_mes` configurable en la plantilla (cron DIARIO con filtro) — DESCARTADA (v1)
Permitir que cada plantilla defina su día del mes y correr un cron diario que filtre `dia_del_mes = hoy(CR)`.
- **Por qué se descarta:** el humano aprobó el schedule mensual `0 6 1 * *`; un cron diario con filtro es más
  superficie (más ejecuciones, más lógica de fronteras) para un caso que v1 no requiere. Se difiere a follow-up.

### 8.5 `origen_tipo=sueldo` nuevo + reversa como categoría dedicada — DESCARTADA
- **Por qué se descarta:** churn de enum innecesario. La `categoria` ya distingue sueldo; y `ingreso_ajuste` +
  `origen_tipo=gasto` ya modela la reversa de forma idempotente por el índice parcial vigente, sin migración extra.
