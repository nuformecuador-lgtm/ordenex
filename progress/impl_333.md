# Bitácora — Ficha 333 · Tandas **T0 + A + B + C** (backend: datos, tipos/contratos, repositorios)

> Encargo acotado: **T0, A, B y C**. Las tandas **D, E, F, G, H e I NO se han hecho** — van en
> encargos posteriores. Este documento dice qué queda listo, qué queda **explícitamente diferido**
> y con qué evidencia.
>
> Rama: `feature/333-gasto-fijo-autorizacion` (ya existía; T0.1 se saltó por encargo).
> Fecha: 2026-08-29.

---

## T0 · Preparación

### T0.3 — ¿Contra QUÉ base se migró? (lo primero, porque decide todo lo demás)

```
$ pnpm exec prisma migrate status
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from db\schema.prisma.
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
168 migrations found in prisma/migrations
Database schema is up to date!
```

**Host: `localhost:5432`, base `ordenex`, esquema `public` — LA LOCAL.** Sin drift previo declarado
por `migrate status`. Ninguna migración salió de esta máquina.

### T0.2 — Los seis símbolos, confirmados EN EL ARCHIVO REAL (no en el grafo)

| Símbolo | Archivo:línea | Qué se leyó allí |
| --- | --- | --- |
| `wallet_movimiento_origen_categoria_uq` | `db/migrations/20260712160000_wallet_movimiento/migration.sql:71` | `CREATE UNIQUE INDEX ... ("origen_tipo","origen_id","categoria") WHERE "origen_id" IS NOT NULL` |
| `notificacion_dedupe_key` | `db/migrations/20260727120000_notificacion/migration.sql:89` | `UNIQUE ("evento","entidad_id","destinatario_rol","destinatario_usuario_id") NULLS NOT DISTINCT WHERE "entidad_id" IS NOT NULL` |
| `esAccesoTotal` | `lib/auth/acceso-total.ts:7` | `ROLES_ACCESO_TOTAL = [maestro, admin]` (línea 5) |
| `periodoDe` | `lib/utils/periodicidad.ts:104` | `meses -> "YYYY-MM"`, resto `-> "YYYY-MM-DD"`. **Intacta: esta tanda no la toca.** |
| `notificadorNoOp` | `lib/notificaciones/notificadores.ts:78` | intersección de 7 tipos de notificador, `async () => {}` |
| El `Promise.all` de `/wallet` | `app/(app)/wallet/page.tsx:37` | 4 acciones pre-obtenidas (`listarMovimientos`, `verResumenCaja`, `verDesgloseEgresos`, `listarPlantillasPaginado`) |

### T0.2b — ¿Está la 332 mergeada?

**SÍ.** `eliminarPlantilla` existe y está implementado:

- `lib/services/GastoFijoPlantillaService.ts:104` — `async eliminarPlantilla(input, actor)`, con
  guardia `esAccesoTotal` y `repo.eliminar(input.id)`.
- `lib/actions/gasto-fijo-plantilla.ts:158` — `eliminarPlantillaAction`.
- `lib/repositories/GastoFijoPlantillaRepository.eliminar` (`deleteMany`).

**Consecuencia para las tandas siguientes:** **F1b va por la rama «332 ya mergeada»** — hay que
MODIFICAR `eliminarPlantilla` para abrir transacción, llamar a `cancelarPendientesDePlantilla` y
devolver el conteo real; y **G7 SÍ cubre R55**. Y hasta que F1b se haga, **en cuanto exista un cobro
`pendiente` el borrado fallará en voz alta** por el CHECK `gasto_fijo_cobro_pendiente_con_plantilla`
— comportamiento buscado (R46), ya medido abajo, pero es un rojo esperado, no una sorpresa.

---

## Tanda A · Datos

### A1 — `db/migrations/20260829120000_gasto_fijo_cobro/migration.sql`

`CREATE TYPE gasto_fijo_cobro_estado` (los 4 valores) + `CREATE TABLE gasto_fijo_cobro` + índices +
`ENABLE ROW LEVEL SECURITY` + `ALTER TABLE gasto_fijo_plantilla ADD COLUMN requiere_aprobacion
BOOLEAN NOT NULL DEFAULT true`. Cabecera larga con el porqué de cada restricción.

**Cuenta de restricciones, dicho en voz alta porque `tasks.md > A1` dice «los cinco CHECK» y
`design.md §1.3` nombra CINCO restricciones que son CUATRO `CHECK` + UN `UNIQUE`:**

| Objeto | Tipo | Motivo |
| --- | --- | --- |
| `gasto_fijo_cobro_pendiente_con_plantilla` | CHECK | la cascada del borrado, garantizada en la base (R46) |
| `gasto_fijo_cobro_decision_registrada` | CHECK | una decisión sin «cuándo» no es escribible (R15/R21) |
| `gasto_fijo_cobro_movimiento_solo_aprobado` | CHECK | sólo un aprobado apunta al libro (R21/R49) |
| `gasto_fijo_cobro_monto_positivo` | CHECK | espejo del invariante del libro (R52) |
| `gasto_fijo_cobro_origen_uq` | UNIQUE(origen_id) | la idempotencia, total y no parcial (R9/R22/R51) |

**No se inventó un quinto CHECK para cuadrar el número**: una restricción que el diseño no pidió es
una regla que nadie decidió. Verificado en la base (`pg_constraint`, `contype='c'`):
`gasto_fijo_cobro_decision_registrada | gasto_fijo_cobro_monto_positivo |
gasto_fijo_cobro_movimiento_solo_aprobado | gasto_fijo_cobro_pendiente_con_plantilla`.

**Las tres FK**, como pide el diseño: `plantilla_id → gasto_fijo_plantilla ON DELETE SET NULL`,
`decidido_por → usuario ON DELETE RESTRICT`, `movimiento_id → wallet_movimiento ON DELETE RESTRICT`.

**Los tres índices** de `design.md §1.3`: `(estado, generado_el)`, `(plantilla_id)`, `(decidido_por)`.

**Un SEXTO objeto, y es la ÚNICA desviación de diseño de esta tanda — declarada, no escondida:**
`gasto_fijo_cobro_movimiento_uq` (`UNIQUE(movimiento_id)`). `design.md §1.3` pide DOS cosas que en
Prisma no pueden ser ciertas a la vez:

1. «las **tres back-relations** obligatorias … `WalletMovimiento.cobroGastoFijo` (**`GastoFijoCobro?`,
   uno a uno**)», y
2. «`movimiento_id` … **sin índice a propósito**».

Prisma **exige `@unique`** en el lado que sostiene la FK de una relación 1-1 y falla con `P1012` sin
él (medido: `prisma validate` lo rechazó literalmente). Se resolvió honrando la **cardinalidad
declarada** y documentando el índice en los dos sitios (esquema y migración): la nota de §1.3 hablaba
del **btree simple** de la FK `RESTRICT` —que efectivamente NO existe, porque nadie consulta por esa
columna y el libro no se borra jamás—, mientras que el `UNIQUE` **enuncia un invariante que era
cierto y no estaba escrito**: una fila del libro salda como mucho UN cobro. Coste: un btree en una
tabla que crece un puñado de filas al día. **Si el revisor prefiere lo contrario, la alternativa es
cambiar la back-relation a `GastoFijoCobro[]` y soltar el índice; son dos líneas.**

`migration.sql` **no contiene ningún `UPDATE`, `DELETE` ni `INSERT`** sobre tablas existentes
(afirmado por test, ver A8).

### A2 — `.../20260829120000_gasto_fijo_cobro/down.sql`

`DROP TABLE gasto_fijo_cobro` → `DROP TYPE gasto_fijo_cobro_estado` → `ALTER TABLE
gasto_fijo_plantilla DROP COLUMN requiere_aprobacion`, en ese orden (el `DROP TYPE` no puede ir antes
de que muera la columna que depende de él). Cabecera con lo que se pierde al revertir: **los cobros
sí; los movimientos del libro NO** — esa asimetría es la que hace seguro el `DROP TABLE`.

**Ejercitado de verdad contra la base local** (ver «rollback» más abajo).

### A3 — `db/migrations/20260829130000_notificacion_evento_gasto_fijo_cobro/migration.sql`

Sólo los **dos** `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
(`notificacion_evento += 'gasto_fijo_cobro_pendiente'`,
`notificacion_entidad_tipo += 'gasto_fijo_cobro_dia'`). **Carpeta aparte y timestamp posterior** por
el `55P04`; la cabecera lo explica y además explica por qué la entidad es **el día CR** y no el cobro.

### A4 — `.../20260829130000_.../down.sql` · **la pregunta obligatoria, respondida por escrito**

Recrea **los dos** tipos con la lista previa exacta: **OCHO** valores en `notificacion_evento`
(4 de la 146 + 1 de la 253 + 1 de la 262 + **2** de la 271) y **SEIS** en
`notificacion_entidad_tipo` (4 de la 146 + 1 de la 253 + 1 de la 262).

**¿El down de la migración que creó el enum recrea-con-lista o sólo dropea?** Respondido sobre los
**cuatro** downs anteriores de estos dos tipos:

| down previo | Qué hace | ¿Se toca? |
| --- | --- | --- |
| `20260727120000_notificacion` (146, los CREÓ) | **sólo dropea** (`DROP TYPE IF EXISTS` de los dos; allí se van también las tablas) | **NO.** Foto histórica; los valores nuevos no cambian nada de lo que aquel down debe hacer. |
| `20260820210000_..._postulacion_recurso` (253) | recrea con lista los DOS tipos: 4 y 4 | **NO.** Su lista es «los enums antes de la 253» y sigue siendo cierta. |
| `20260822140000_..._dia_reparto_corregido` (262) | recrea con lista los DOS tipos: 5 y 5 | **NO.** Ídem. |
| `20260823120000_..._bloqueo_cierre` (271) | recrea con lista **sólo** `notificacion_evento`: 6 | **NO.** Ídem; su up tampoco tocó `entidad_tipo`. |

**Comprobación mecánica, no promesa:**

```
$ git diff --name-only | grep -i "down.sql"
(vacío)
```

Y las cuatro afirmaciones de arriba están además **atadas por test** (A8, bloque «los CUATRO
`down.sql` anteriores NO se tocan»): si alguien edita uno, el test cae.

**Precondición ruidosa (R54)** escrita en la cabecera y **ejercitada**: con una fila que use el valor
nuevo, el `USING` del `ALTER COLUMN` falla y el rollback aborta. Ni un `DELETE` ni un `UPDATE` para
«hacer sitio».

### A5 — `db/schema.prisma`

- `enum GastoFijoCobroEstado` (`@@map("gasto_fijo_cobro_estado")`).
- `model GastoFijoCobro` con cabecera larga: la clave `origen_id` (formato congelado, R11) y las
  copias de `concepto`/`monto` (R7/R16/R47).
- `GastoFijoPlantilla.requiereAprobacion Boolean @default(true) @map("requiere_aprobacion")`.
- Las **tres back-relations**: `GastoFijoPlantilla.cobros`, `Usuario.cobrosGastoFijo`
  (`@relation("GastoFijoCobroDecisor")`) y `WalletMovimiento.cobroGastoFijo` (`GastoFijoCobro?`).
- `NotificacionEvento += gasto_fijo_cobro_pendiente`, `NotificacionEntidadTipo +=
  gasto_fijo_cobro_dia` (este último con el comentario largo de la entidad-día).

```
$ pnpm exec prisma validate
The schema at db\schema.prisma is valid 🚀

$ pnpm exec prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script
-- This is an empty migration.
```

**«Empty migration» = la base y el datamodel coinciden exactamente**: `migrate diff` no propone nada
que las migraciones no hayan escrito.

### A6 — Aplicación contra la base local

**Desviación forzada por estado PREVIO del repo, no por esta ficha:** `pnpm run db:migrate`
(`prisma migrate dev`) **no se puede usar en esta máquina**. Devuelve:

```
The migration `20260827160000_orden_num_remision_unico_parcial` was modified after it was applied.
We need to reset the "public" schema at "localhost:5432"
```

Es un desajuste de checksum **anterior a este trabajo** (esa migración tiene un solo commit,
`fcd4e6e8`, de la ficha 294; nadie la editó en git). `migrate dev` sólo ofrece **resetear la base**,
que habría borrado datos ajenos. Se aplicó con **`prisma migrate deploy`** —el mismo camino que usa
el build (`scripts/migrate-deploy.ts`)—, que tolera el desajuste y **no borra nada**:

```
$ pnpm exec prisma migrate deploy
170 migrations found in prisma/migrations
Applying migration `20260829120000_gasto_fijo_cobro`
Applying migration `20260829130000_notificacion_evento_gasto_fijo_cobro`
All migrations have been successfully applied.

$ pnpm exec prisma generate
✔ Generated Prisma Client (v7.8.0)

$ pnpm exec prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
170 migrations found in prisma/migrations
Database schema is up to date!
```

Estado real de la columna nueva: `requiere_aprobacion` → `{"column_default":"true","is_nullable":"NO"}`.
Índices creados: `gasto_fijo_cobro_decidido_por_idx`, `gasto_fijo_cobro_estado_generado_el_idx`,
`gasto_fijo_cobro_movimiento_uq`, `gasto_fijo_cobro_origen_uq`, `gasto_fijo_cobro_pkey`,
`gasto_fijo_cobro_plantilla_id_idx`.

No había dev server levantado, así que no hubo cliente Prisma rancio que reiniciar.

#### Los dos `down.sql`, aplicados y revertidos de verdad

`pnpm run db:rollback` revierte **siempre la última carpeta por orden alfabético**, así que por sí
solo no alcanza la migración de la tabla. Secuencia real ejecutada:

1. `pnpm run db:rollback` → `Rollback completado: 20260829130000_notificacion_evento_gasto_fijo_cobro`
   (los dos enums recreados con su lista previa; **sin error**).
2. `pnpm exec prisma db execute --file=db/migrations/20260829120000_gasto_fijo_cobro/down.sql`
   → `Script executed successfully.` (tabla, tipo y columna fuera).
3. `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260829120000_gasto_fijo_cobro'`
   (lo mismo que hace `scripts/db-rollback.ts`).
4. `pnpm exec prisma migrate deploy` → **las dos vuelven a aplicarse sin error**.

Base final: `Database schema is up to date!` y `migrate diff` vacío.

### A7 — `tests/integration/db/gasto-fijo-cobro-migration.test.ts` · **CORRIÓ, no «skipped»**

8 tests, **todos ejecutados** contra Postgres real (`localhost:5432/ordenex`), todo dentro de
`enTransaccionRevertida` + `serializarEscriturasReales`: no queda ni una fila.

- **R50** — RLS: `pg_class.relrowsecurity` de `gasto_fijo_cobro` es `true`, + un CONTROL que compara
  con `wallet_movimiento` y `gasto_fijo_plantilla`.
- **R52** — `monto = 0` y `monto = -1` violan `gasto_fijo_cobro_monto_positivo`, + CONTROL de que
  `0.01` SÍ entra y se relee como `"0.01"` (anti-vacuidad: sin él, un `INSERT` roto por otra causa
  daría verde).
- **R46** — borrar una plantilla con un cobro `pendiente` **aborta** con
  `gasto_fijo_cobro_pendiente_con_plantilla`; **tras cancelarlo, el MISMO borrado funciona** y el
  cobro sobrevive con `plantilla_id = NULL`, `estado = 'cancelado'`, `monto = "80000.00"`.
- **R47** — borrada la plantilla, el cobro **aprobado** conserva concepto, monto, período, decisor,
  instante y enlace, y **su movimiento del libro sigue intacto** (monto, `origen_id` y descripción).

**Nada se salta en silencio:** si la base no tuviera ni un `usuario` (FK `decidido_por`), el helper
**lanza** con un mensaje que nombra el seed; **no hay ni un `return` mudo**.

### A8 — `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts` · **CORRIÓ**

20 tests, todos ejecutados. Cubre: el up aditivo (exactamente 2 sentencias), la migración de la tabla
**sin `UPDATE`/`DELETE`/`INSERT`** y con su `down.sql` (R53), el down con **ocho** y **seis** valores
en orden, los **cuatro** downs previos intactos, la escritura real de un aviso con el evento y la
entidad nuevos, el **down que ABORTA** con una fila del valor nuevo (R54) con su CONTROL, y
`notificacion_dedupe_key` conservando `UNIQUE` + `NULLS NOT DISTINCT` + `WHERE (entidad_id IS NOT
NULL)` **medido DESPUÉS de correr el down** (que es donde el `ALTER COLUMN ... TYPE` destruye y
rehace los índices), no sólo sobre la base tal cual.

---

## ⭑ La mutación exigida: quitar el CHECK **mata** el test (salida ROJA real)

```
$ pnpm exec prisma db execute --file=<ALTER TABLE "gasto_fijo_cobro" DROP CONSTRAINT "gasto_fijo_cobro_monto_positivo";>
Script executed successfully.

$ pnpm exec vitest run tests/integration/db/gasto-fijo-cobro-migration.test.ts
     × ⭑ monto = 0 -> viola `gasto_fijo_cobro_monto_positivo` 160ms
     × ⭑ monto negativo -> viola el MISMO CHECK 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/integration/db/gasto-fijo-cobro-migration.test.ts > 333/A7 — R52: la base rechaza un
 cobro con monto cero o negativo > ⭑ monto = 0 -> viola `gasto_fijo_cobro_monto_positivo`
AssertionError: promise resolved "undefined" instead of rejecting
 FAIL  tests/integration/db/gasto-fijo-cobro-migration.test.ts > 333/A7 — R52: la base rechaza un
 cobro con monto cero o negativo > ⭑ monto negativo -> viola el MISMO CHECK
AssertionError: promise resolved "undefined" instead of rejecting
 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
VITEST_EXIT=1
```

**Restaurado en el acto** (`ADD CONSTRAINT ... CHECK ("monto" > 0)` → `Script executed successfully.`)
y verificado: los 4 CHECK vuelven a estar en `pg_constraint` y el archivo vuelve a **8 passed (8)**.

> Las otras dos mutaciones de la regla de dinero (**R14** «cobrar el monto de la plantilla en vez del
> copiado» y **R51** «borrar `gasto_fijo_cobro_origen_uq`») **no se pueden ejecutar todavía**: sus
> tests son **D7/D8**, que dependen del servicio de la tanda D. Quedan pendientes para ese encargo, y
> el `origen_uq` ya está en la base esperándolas.

---

## Tanda B · Tipos y contratos

- **B1** — `lib/types/gasto-fijo-cobro.ts` (nuevo): `GastoFijoCobroDTO` con **`monto: string`**, los
  tres schemas zod `.strict()` (`listarCobrosPendientesSchema` con **cero claves**,
  `decidirCobroGastoFijoSchema`, `contarCobrosPendientesDePlantillaSchema`), los cuatro resultados de
  servicio y los cuatro de action. **El DTO NO expone `origenId`, `plantillaId` ni `movimientoId`**
  (comprobado a ojo y afirmado en el propio archivo). Ninguna entrada acepta monto del cliente.
- **B2** — `lib/types/gasto-fijo-plantilla.ts`: `requiereAprobacion: boolean` en el DTO y
  `requiereAprobacion: z.boolean().default(true)` en `crearGastoFijoPlantillaSchema` (heredado por
  `actualizarGastoFijoPlantillaSchema` vía su `.extend()`). El comentario deja escrito que **el
  default en `actualizar` NO es inocuo** —una edición que no envíe el campo lo deja en «requiere
  aprobación»— y que por eso el diálogo de la tanda G debe enviarlo siempre; se deja con default
  porque así lo fija `design.md §8` y porque la dirección del default es la segura.
- **B3** — `lib/types/notificacion.ts`: `gasto_fijo_cobro_pendiente` y `gasto_fijo_cobro_dia`, este
  último con el comentario obligatorio: **la entidad es EL DÍA CR, no el cobro**, citando que con el
  cobro `notificacion_dedupe_key` admitiría una sola fila por (evento, cobro, maestro) para siempre y
  el recordatorio del día 2 **no saldría nunca, en silencio** — el fallo exacto de la 262.
- **B4** — `lib/interfaces/repositories/IGastoFijoCobroRepository.ts` (+ `CrearCobroPendienteInput`,
  `GastoFijoCobroRegistro`, `GastoFijoCobroTxClient`, `GastoFijoCobroEstadoDecidido`) y
  `lib/interfaces/services/IGastoFijoCobroService.ts`. Ampliado `IWalletMovimientoRepository` con
  **`obtenerPorOrigen(tx, origenTipo, origenId, categoria)`**.

---

## Tanda C · Repositorios

- **C1** — `lib/repositories/GastoFijoCobroRepository.ts` (nuevo). Los siete métodos que enumera C1:
  `crearPendientes` (`createMany({ skipDuplicates: true })`), `obtenerPorId(id, tx?)`,
  `listarPendientes(tope)`, `contarPendientes()`, `marcarDecidido` (**`WHERE id AND estado =
  'pendiente'`**, devuelve el `count`), `enlazarMovimiento` y `cancelarPendientesDePlantilla`
  (devuelve el `count`). Money-safe: `Decimal.toFixed(2)` al leer, `new Prisma.Decimal(string)` al
  escribir. **El archivo no contiene `parseFloat`, `Number(` ni `+monto`** (comprobado).
  El orden de la cola es **total** (`generadoEl`, `createdAt`, `id`): `generado_el` es `DATE`, así que
  todos los cobros de una corrida empatan **por construcción** y una sola columna dejaría el orden
  indefinido — la lección que la 334 dejó escrita en `WalletMovimientoRepository.listar`.
- **C2** — `WalletMovimientoRepository.obtenerPorOrigen` (`findFirst`, único por el índice **parcial**,
  por eso `findFirst` y no `findUnique`). **El libro sigue sin `update` ni `delete`**: el test de
  superficie (`R47`) sigue afirmando la lista **cerrada** de métodos, ahora con seis, y su segunda
  aserción («ni update, ni delete, ni actualizar, ni eliminar, ni borrar») queda **intacta**.
- **C3** — `GastoFijoPlantillaRepository`: `requiereAprobacion` en `toDTO`, en `crear` y en
  `actualizar`. En los **inputs de escritura** va **opcional**, con la misma forma —y el mismo
  comentario— que `CrearMovimientoInput.fechaMovimiento`/`.id`: «la clave sólo viaja si el llamador
  la trae». Ausente en `crear` ⇒ manda el `DEFAULT true` de la columna; ausente en `actualizar` ⇒ la
  fila **conserva** su valor. Lo aprieta a obligatorio **D4**, cuando el servicio lo pase siempre.

---

## Mapa `R<n> → test` de LO QUE ESTA TANDA ENTREGA

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| **R1** (dos valores, y sólo dos) | `el interruptor tiene EXACTAMENTE dos valores; nada que no sea booleano cruza el borde` + los dos de «cobra sola» explícito | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` |
| **R2** | `R2: crear SIN el interruptor deja la plantilla en «requiere aprobacion»` (+ anti-vacuidad con `false` explícito, + la variante de `actualizar`) | `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` |
| **R46** | `borrar una plantilla con un cobro pendiente ABORTA RUIDOSAMENTE` + `TRAS CANCELARLO, el MISMO borrado funciona` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| **R47** | `borrada la plantilla, el cobro APROBADO conserva concepto, monto, periodo y decisión, y su movimiento sigue intacto` | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| **R50** | `gasto_fijo_cobro tiene ROW LEVEL SECURITY activada en el catalogo` (+ CONTROL) | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| **R52** | `monto = 0 -> viola gasto_fijo_cobro_monto_positivo`, `monto negativo -> viola el MISMO CHECK` (+ CONTROL del céntimo) | `tests/integration/db/gasto-fijo-cobro-migration.test.ts` |
| **R53** | `el UP de la tabla NO reescribe ni borra ninguna fila preexistente`, `lo UNICO que altera de una tabla preexistente es la columna del interruptor`, `las dos migraciones traen down.sql`, `recrea notificacion_evento con los OCHO previos`, `recrea notificacion_entidad_tipo con los SEIS previos`, + los cuatro «los `down.sql` anteriores NO se tocan» | `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts` |
| **R54** | `el DOWN con una fila del evento nuevo ABORTA RUIDOSAMENTE (no borra nada)` + `CONTROL: SIN filas del valor nuevo, ese MISMO down corre entero y el indice de dedupe SOBREVIVE` | `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts` |
| **R51** (la mitad de base) | el índice `gasto_fijo_cobro_origen_uq` existe y es `UNIQUE` sobre `origen_id`; **su test de comportamiento + la mutación son D8** | — |
| **R11** | **no se toca `periodoDe`**: `git diff` no incluye `lib/utils/periodicidad.ts`; el formato queda congelado en el contrato del repositorio y en la cabecera de la migración | — |

**Los 47 requisitos restantes (R3–R45, R48, R49, R55–R57) son de las tandas D–I y NO están
cubiertos.** No se declara ninguno «passed» por vacío.

---

## Verificación (salidas reales)

```
$ pnpm typecheck
> tsc --noEmit
(sin salida)                                   TYPECHECK_EXIT=0
```

```
$ pnpm lint
✖ 127 problems (0 errors, 127 warnings)
```
127 warnings, **0 errores** — es el baseline del repo (todas son `no-unused-vars` en tests ajenos).
Sobre los archivos de esta tanda, en concreto:
```
$ pnpm exec eslint <los 13 archivos nuevos/modificados de la ficha>
(sin salida)                                   ESLINT_EXIT=0
```

```
$ pnpm exec prisma validate
The schema at db\schema.prisma is valid 🚀

$ pnpm exec prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
170 migrations found in prisma/migrations
Database schema is up to date!
```

```
$ pnpm exec vitest related --run \
    lib/types/gasto-fijo-cobro.ts lib/types/gasto-fijo-plantilla.ts lib/types/notificacion.ts \
    lib/interfaces/repositories/IGastoFijoCobroRepository.ts \
    lib/interfaces/services/IGastoFijoCobroService.ts \
    lib/interfaces/repositories/IWalletMovimientoRepository.ts \
    lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts \
    lib/repositories/GastoFijoCobroRepository.ts lib/repositories/GastoFijoPlantillaRepository.ts \
    lib/repositories/WalletMovimientoRepository.ts lib/services/CajaBackfillTesoreriaService.ts

 Test Files  138 passed (138)
      Tests  2127 passed | 26 skipped (2153)
   Duration  136.21s                            RELATED_EXIT=0
```

```
$ pnpm exec vitest run tests/integration/db/gasto-fijo-cobro-migration.test.ts \
                      tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts

 Test Files  2 passed (2)
      Tests  28 passed (28)
```
Los 28 **SE EJECUTARON** (`HAY_BASE_DE_DATOS` verdadero); ninguno salió `skipped`.

```
$ pnpm exec vitest run tests/unit/types/gasto-fijo-plantilla-schema.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)      (9 previos + los 5 de la ficha 333)
```

### ⚠️ Un rojo PREEXISTENTE en las guardias, que NO es de esta ficha

```
$ pnpm run test:guardias
 Test Files  1 failed | 162 passed (163)
      Tests  1 failed | 2477 passed (2478)

 FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
 estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de ruta:
 + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Evidencia de que viene de `dev` y no de aquí: `lib/actions/tarifas.ts` **no aparece en
`git diff --name-only`** (0 coincidencias); `obtenerTarifa` **no tiene ni un importador en todo el
árbol** (`grep -rn "obtenerTarifa" app lib components` devuelve sólo su propia declaración); y el
último commit que tocó ese archivo es `b7bd887a` (ficha 273). **Esta tanda no lo introdujo y no lo
arregla** — se reporta para que el leader decida.

---

## Archivos creados / modificados

**Nuevos**
```
db/migrations/20260829120000_gasto_fijo_cobro/{migration.sql,down.sql}
db/migrations/20260829130000_notificacion_evento_gasto_fijo_cobro/{migration.sql,down.sql}
lib/types/gasto-fijo-cobro.ts
lib/interfaces/repositories/IGastoFijoCobroRepository.ts
lib/interfaces/services/IGastoFijoCobroService.ts
lib/repositories/GastoFijoCobroRepository.ts
tests/integration/db/gasto-fijo-cobro-migration.test.ts
tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
```

**Modificados (producción)**
```
db/schema.prisma
lib/types/gasto-fijo-plantilla.ts
lib/types/notificacion.ts
lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts
lib/interfaces/repositories/IWalletMovimientoRepository.ts
lib/repositories/GastoFijoPlantillaRepository.ts
lib/repositories/WalletMovimientoRepository.ts
lib/services/CajaBackfillTesoreriaService.ts   (RecolectorDeFilasDeCaja: 5.º método que lanza)
```

**Modificados (tests) — propagación mecánica de dos campos obligatorios**

`requiereAprobacion` en 14 fixtures de `GastoFijoPlantillaDTO` / entradas del schema, y
`obtenerPorOrigen: vi.fn()` en 9 dobles de `IWalletMovimientoRepository`:
```
tests/components/paginacion/BajoRiesgoPaginacion.test.tsx
tests/integration/db/generacion-gastos-fijos.test.ts
tests/integration/wallet-page.test.tsx
tests/unit/actions/gasto-fijo-plantilla-actions.test.ts
tests/unit/actions/wallet-listados-descarga-action.test.ts
tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx
tests/unit/components/wallet-gastos-fijos-panel.test.tsx
tests/unit/components/wallet-periodicidad-labels.test.ts
tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts
tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts
tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts
tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts
tests/unit/repositories/cierres-admin-repository.test.ts
tests/unit/repositories/incidente-admin-repository.test.ts
tests/unit/repositories/wallet-movimiento-repository.test.ts
tests/unit/services/gasto-fijo-plantilla-service.test.ts
tests/unit/services/gasto-fijo-plantillas-completo.test.ts
tests/unit/services/gasto-fijo-plantillas-paginado.test.ts
tests/unit/services/generacion-gastos-fijos-service.test.ts
tests/unit/services/wallet-egreso-service.test.ts
tests/unit/services/wallet-indemnizacion-no-reversable.test.ts
tests/unit/services/wallet-service.test.ts
tests/unit/types/gasto-fijo-plantilla-schema.test.ts   (+ los 5 tests de R1/R2)
```

**Dos literales `toEqual` se AMPLIARON, no se relajaron** (regla «literal: contrato o polizón»):

1. `tests/unit/repositories/wallet-movimiento-repository.test.ts` — la superficie del libro pasa de
   cinco a **seis** métodos porque entra una **lectura**; la aserción «ni update, ni delete» queda
   igual y la lista sigue siendo cerrada.
2. `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` — el literal de lo que el borde entrega
   al servicio gana `requiereAprobacion: true`, que es **exactamente** el default que el schema pone
   sobre una entrada que no lo manda. Sigue siendo un literal, no un spread del propio schema.

---

## Lo que queda DIFERIDO, dicho en voz alta (no es «hecho», no es «olvidado»)

1. **`GeneracionGastosFijosResult` NO se amplió con `cobrosPendientesCreados` /
   `cobrosPendientesTotales`** (la última viñeta de B4). Motivo medido: los dos campos son
   obligatorios por contrato, y **tres suites afirman la forma de ese resultado con `toEqual`
   literal** (`tests/unit/services/generacion-gastos-fijos-service.test.ts:74` y `:125`,
   `tests/integration/actions/generar-gastos-fijos-route.test.ts:21` y `:72`,
   `tests/integration/db/generacion-gastos-fijos.test.ts:123`). Ampliarlo sin **D3** deja el árbol
   rojo en tests cuya actualización pertenece a **D3/D6**. **Va con D3, en el mismo commit que la
   partición por `requiereAprobacion`.**
2. **No existe `contarPendientesDePlantilla` en el repositorio.** `tasks.md > C1` enumera los métodos
   y ése no está; pero `design.md §9.2` exige `contarCobrosPendientesDePlantillaAction` para R55.
   **Quien haga D2/F1 tendrá que añadir esa lectura** (`count({ where: { plantillaId, estado:
   "pendiente" } })`). Se deja sin inventar para no decidir por la tanda que la usa.
3. **`requiereAprobacion` es opcional en los inputs del repositorio de plantillas** hasta que **D4**
   lo pase desde el servicio; ahí puede pasar a obligatorio.
4. **Las mutaciones de R14 y R16/R51** (monto de la plantilla vs. copiado; borrar
   `gasto_fijo_cobro_origen_uq`) **no se ejecutaron**: sus tests son **D7/D8**.
5. **F1b va por la rama «332 mergeada»** (ver T0.2b).

---

## Contrato que queda para la tanda D

```
IGastoFijoCobroRepository (lib/interfaces/repositories/IGastoFijoCobroRepository.ts)
  crearPendientes(tx, inputs: CrearCobroPendienteInput[]): Promise<number>
  obtenerPorId(id, tx?): Promise<GastoFijoCobroRegistro | null>
  listarPendientes(tope: number): Promise<GastoFijoCobroDTO[]>     // pendiente, más antiguo primero
  contarPendientes(): Promise<number>                              // TODOS, no los de hoy
  marcarDecidido(tx, id, "aprobado"|"rechazado"|"cancelado", actorId, ahora): Promise<number>
  enlazarMovimiento(tx, id, movimientoId): Promise<void>
  cancelarPendientesDePlantilla(tx, plantillaId, actorId, ahora): Promise<number>

IWalletMovimientoRepository
  obtenerPorOrigen(tx, origenTipo, origenId, categoria): Promise<WalletMovimientoDTO | null>
```

`marcarDecidido` devuelve **`0` = `ya_decidido`** y **`1` = la decisión es tuya**: es la transición
con `WHERE id AND estado='pendiente'` que serializa a dos humanos. `crearPendientes` es idempotente
por `gasto_fijo_cobro_origen_uq` y devuelve las filas realmente insertadas. `origen_id` llega ya
resuelto desde arriba (`"<plantillaId>:<periodo>"`) y **el repositorio no lo compone, ni lo parsea, ni
lo reescribe**.

---

## Veredicto

**T0, A, B y C entregadas y verificadas contra la base local: typecheck y lint limpios, esquema
válido, migraciones aplicadas y revertidas de verdad, 28 tests contra Postgres EJECUTADOS y la
mutación del CHECK matando dos de ellos — con cinco puntos diferidos declarados arriba para las
tandas D–I.**

---
---

# Bitácora — Ficha 333 · Tandas **D + E + F** (servicios, notificación y borde)

> Encargo acotado: **D, E y F**. Las tandas **G (pantalla), H (censos y guardias) e I (cierre) NO se
> han hecho** — van en encargos posteriores. Fecha: 2026-08-29. Rama:
> `feature/333-gasto-fijo-autorizacion` (ya existía; no se creó, no se cambió, no se commiteó nada:
> el commit es del leader).
>
> Base usada para todo lo que corre contra Postgres: **`localhost:5432/ordenex`, esquema `public`**
> (la LOCAL, la misma de las tandas A–C; `migrate status` → *up to date*, 170 migraciones).

---

## Lo que se hizo, tarea por tarea

### Tanda D · Servicios

| T | Qué quedó | Archivo |
| --- | --- | --- |
| **D1** | `ROLES_DECIDEN_COBRO_GASTO_FIJO` + `puedeDecidirCobroGastoFijo`, junto a `esAccesoTotal`, que **no se tocó** (el diff del archivo es puramente aditivo). | `lib/auth/acceso-total.ts` |
| **D2** | `GastoFijoCobroService`: `listarPendientes` (guard `esAccesoTotal`), `aprobar` y `rechazar` (guard `puedeDecidirCobroGastoFijo`), `cancelarPorPlantilla` y —**añadido en esta tanda**— `contarPendientesDePlantilla`. `aprobar` sigue paso a paso `design §6.3` dentro de `runTx`. No importa Prisma: recibe los dos repos, el cliente de escritura y el runner por constructor. | `lib/services/GastoFijoCobroService.ts` (nuevo) |
| **D3** | `GeneracionGastosFijosService`: partición por `requiereAprobacion`, las **dos** escrituras dentro de **una** `runTx`, `contarPendientes()` **fuera** de ella y el notificador **fuera** de ella, con default no-op. | `lib/services/GeneracionGastosFijosService.ts` |
| **D4** | `crearPlantilla`/`actualizarPlantilla` pasan `requiereAprobacion` al repositorio. Guards intactos (`esAccesoTotal`). | `lib/services/GastoFijoPlantillaService.ts` |
| **D5** | 35 casos con dobles: R14, R16, R17, R19, R20, R21, R23, R24, R25, R45, R49, R55, R56. | `tests/unit/services/gasto-fijo-cobro-service.test.ts` (nuevo) |
| **D6** | +14 casos: R5, R6, R7, R8, R10, R11, R12, R29, R30, R32, R34. | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| **D7** | 12 casos **contra Postgres**: R15, R17, R18 (concurrencia REAL), R19, R20, R21, R45, R55, R56. | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` (nuevo) |
| **D8** | 9 casos **contra Postgres**: R9, R10, R22, R51. | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` (nuevo) |

**Añadido que la tanda C no traía y D2/F1 necesitaban (R55):**
`IGastoFijoCobroRepository.contarPendientesDePlantilla(plantillaId)` +
`GastoFijoCobroRepository.contarPendientesDePlantilla` (`count({ where: { plantillaId, estado:
"pendiente" } })`). Su `WHERE` se prueba **donde vive**, contra Postgres, con las dos condiciones
ejercidas por separado (`333/D7 — R55`).

**Tipos nuevos que la tanda D introduce en los contratos** (para que nadie los busque en Prisma):
`GastoFijoCobroTx` / `GastoFijoCobroTxRunner` (`IGastoFijoCobroService.ts`),
`GeneracionGastosFijosTx` / `GeneracionGastosFijosTxRunner` (`IGeneracionGastosFijosService.ts`),
`EliminarPlantillaTx` / `EliminarPlantillaTxRunner` y `GastoFijoPlantillaTxClient`. Todos siguen el
precedente de `LiquidacionTxRunner`: el ejecutor de transacciones **se inyecta**, el servicio no
importa Prisma.

### Tanda E · Notificación

| T | Qué quedó | Archivo |
| --- | --- | --- |
| **E1** | `textoCobrosGastoFijoPendientes(n)` (singular/plural), `GastoFijoCobroPendienteContexto { pendientes, diaCR }` y `emitirGastoFijoCobroPendiente` — `warning`, `entidadTipo: "gasto_fijo_cobro_dia"`, `entidadId: diaCR`, destinatario `rol: maestro`, `anexo: null`. El texto vive **sólo** aquí. | `lib/notificaciones/emitir.ts` |
| **E2** | `GastoFijoCobroPendienteNotificador`, `notificarGastoFijoCobroPendienteCon(repo, logger?)` (best-effort) y el binding `notificarGastoFijoCobroPendienteReal`. `notificadorNoOp` gana el tipo nuevo en su intersección (ahora son 8). | `lib/notificaciones/notificadores.ts` |
| **E3** | `buildService()` **inyecta** `notificarGastoFijoCobroPendienteReal` (5.º argumento). El `CRON_SECRET` se sigue verificando antes de cualquier efecto. | `app/api/cron/generar-gastos-fijos/route.ts` |
| **E4** | 11 casos: R29, R30, R32, R33, R35. Con un repositorio doble que reproduce **las dos** barreras reales (la guardia de no-leídas y el índice único). | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` (nuevo) |
| **E5** | El cableado del cron entra en el censo **afirmando sobre el uso efectivo**, y `GeneracionGastosFijosService.ts` entra en `SERVICES_CON_NOTIFICADOR` (que pasa de 7 a 8). | `tests/unit/services/notificacion-notificadores-reales.test.ts` |
| **E6** | La lista literal de eventos pasa a **nueve** valores; se añade su hermana, la lista literal de **siete** `entidad_tipo`. El título del caso deja de llevar un número atrasado («exactamente seis» cuando ya eran ocho). | `tests/unit/services/notificacion-productores-wiring.test.ts` |
| **E7** | 6 casos **contra Postgres**: R31 y su contraparte R30, más el control de que quien rechaza el duplicado es `notificacion_dedupe_key` con su `NULLS NOT DISTINCT`. | `tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts` (nuevo) |

### Tanda F · Borde

| T | Qué quedó | Archivo |
| --- | --- | --- |
| **F1** | Las **cuatro** Server Actions con el patrón exacto de `wallet-egresos.ts`. Ninguna acepta monto del cliente (`.strict()`). | `lib/actions/gasto-fijo-cobro.ts` (nuevo) |
| **F1b** | **La 332 está mergeada** (comprobado en el archivo real: `lib/services/GastoFijoPlantillaService.ts` tiene `eliminarPlantilla`), así que fue la rama **«modificar»**: `eliminarPlantilla` abre transacción, cancela y borra, y `EliminarPlantillaServiceResult.ok` gana `pendientesCancelados`. | `lib/services/GastoFijoPlantillaService.ts`, `lib/interfaces/services/IGastoFijoPlantillaService.ts`, `lib/repositories/GastoFijoPlantillaRepository.ts` (+ `tx?` en `eliminar`), `lib/actions/gasto-fijo-plantilla.ts` (composition root) |
| **F2** | 18 casos: R26 en las **cuatro** actions + `validation_error`, + el orden sesión-antes-de-parse. | `tests/unit/actions/gasto-fijo-cobro-actions.test.ts` (nuevo) |
| **F3** | 16 casos: R27 y R28, sobre fuente **sin imports ni comentarios**, con el cuerpo de cada método recortado por conteo de llaves (porque el archivo usa los DOS predicados, cada uno en su sitio). | `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts` (nuevo) |
| **F4** | 12 casos: R43 — conversiones, aritmética sobre montos y `toFixed` admitido **sólo** sobre `Prisma.Decimal`. | `tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts` (nuevo) |

---

## Archivos tocados

**Producción — nuevos (2):**
`lib/services/GastoFijoCobroService.ts`, `lib/actions/gasto-fijo-cobro.ts`.

**Producción — modificados (14):**
`lib/auth/acceso-total.ts`, `lib/interfaces/repositories/IGastoFijoCobroRepository.ts`,
`lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts`,
`lib/interfaces/services/IGastoFijoCobroService.ts`,
`lib/interfaces/services/IGastoFijoPlantillaService.ts`,
`lib/interfaces/services/IGeneracionGastosFijosService.ts`,
`lib/repositories/GastoFijoCobroRepository.ts`, `lib/repositories/GastoFijoPlantillaRepository.ts`,
`lib/services/GastoFijoPlantillaService.ts`, `lib/services/GeneracionGastosFijosService.ts`,
`lib/notificaciones/emitir.ts`, `lib/notificaciones/notificadores.ts`,
`lib/actions/gasto-fijo-plantilla.ts`, `app/api/cron/generar-gastos-fijos/route.ts`.

**Tests — nuevos (7):**
`tests/unit/services/gasto-fijo-cobro-service.test.ts`,
`tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts`,
`tests/unit/actions/gasto-fijo-cobro-actions.test.ts`,
`tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts`,
`tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts`,
`tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts`,
`tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts`,
`tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts`. *(ocho, contando los tres de
integración.)*

**Tests — modificados (9):**
`tests/unit/services/generacion-gastos-fijos-service.test.ts`,
`tests/unit/services/gasto-fijo-plantilla-service.test.ts`,
`tests/unit/services/gasto-fijo-plantillas-completo.test.ts`,
`tests/unit/services/gasto-fijo-plantillas-paginado.test.ts`,
`tests/unit/services/notificacion-notificadores-reales.test.ts`,
`tests/unit/services/notificacion-productores-wiring.test.ts`,
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`,
`tests/integration/db/generacion-gastos-fijos.test.ts`,
`tests/integration/actions/generar-gastos-fijos-route.test.ts`.

**Nada de esto se tocó:** `feature_list.json`, `progress/current.md`, `specs/`, `app/(app)/`,
`components/`, `db/migrations/**`, `db/schema.prisma`.

---

## Mapa `R<n>` → test (alcance D+E+F)

| R | Test que lo cubre (nombre real del caso) | Archivo |
| --- | --- | --- |
| R1 | `crearPlantilla pasa requiereAprobacion = %s al repositorio, tal cual` (×2) + el gemelo de actualizar | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R3 | `crear: forbidden sin tocar el repositorio` / `editar: forbidden sin tocar el repositorio` | idem |
| R5 | `R5: una plantilla que COBRA SOLA escribe el mismo egreso que antes de la ficha, y no crea cobro` | `tests/unit/services/generacion-gastos-fijos-service.test.ts` |
| R6 | `R6: una plantilla que REQUIERE APROBACION crea el cobro y NO toca el libro` | idem |
| R7 | `R7: el cobro guarda el concepto y el monto de la plantilla, y el monto viaja como STRING` | idem |
| R8 | `R8: la clave del cobro es EXACTAMENTE la que el libro habria recibido…` | idem |
| R9 | `⭑ la segunda corrida inserta CERO y la corrida termina en éxito` | `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` |
| R10 | `⭑ si la escritura de cobros falla EN EL MOTOR, no queda ningún egreso de la corrida` (+ control positivo) y `R10: las dos escrituras van dentro de UNA sola transaccion…` | idem + unit de generación |
| R11 | `R11: el periodo del cobro sale de periodoDe y conserva su formato` (×3: meses/dias/semanas) | unit de generación |
| R12 | `las inactivas no llegan ni al libro ni a la cola, sea cual sea su interruptor` | idem |
| R13 | `R29: token correcto -> 200 con resumen SIN PII` (literal de 6 claves + tipos) | `tests/integration/actions/generar-gastos-fijos-route.test.ts` |
| R14 | `⭑ la fila del libro es exactamente la que el requisito describe` + `⭑ la clave que se escribe sale del COBRO…` + `⭑ el autor NO es null…` | `tests/unit/services/gasto-fijo-cobro-service.test.ts` |
| R15 | `⭑ el camino feliz deja LAS CUATRO cosas…` + `⭑ si la escritura del libro falla EN EL MOTOR, NO queda la decisión` | `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` |
| R16 | `⭑ el monto escrito es el del cobro, no uno leido en el momento de aprobar` + `⭑ money-safe: el monto cruza como STRING…` | unit de servicio |
| R17 | `⭑ aprobar DOS veces seguidas…`, `⭑ un cobro RECHAZADO no se puede aprobar…`, `⭑ el WHERE estado='pendiente' está EN LA SENTENCIA` | integración aprobación |
| R18 | `⭑ una gana con ok y la otra pierde con ya_decidido; el libro queda con UNA fila` | idem |
| R19 | `⭑ el caso MIXTO: no se crea un segundo movimiento y yaEstabaEnElLibro es true` (+ control) | idem |
| R20 | `⭑ R20: aprobar un cobro que no existe responde not_found sin escribir nada` | idem + unit |
| R21 | `⭑ el libro no se toca en absoluto` + `⭑ un cobro RECHAZADO no se puede aprobar…` | unit + integración |
| R22 | `⭑ tras rechazar, la corrida del día siguiente del MISMO período no crea nada…` | integración idempotencia |
| R23 | `%s sobre un cobro ya decidido responde ya_decidido` (×2) + `el servicio NO expone ninguna forma de reabrir o editar` | unit de servicio |
| R24 | `⭑ %s con rol %s -> forbidden, sin tocar el repositorio` (×4) + su control positivo | idem |
| R25 | `con acceso total la cola se devuelve` (maestro y admin) | idem |
| R26 | Las **cuatro** actions sin sesión + `⭑ la sesion se comprueba ANTES del parse` | `tests/unit/actions/gasto-fijo-cobro-actions.test.ts` |
| R27 | `⭑ aprobar y rechazar usan el predicado ESTRECHO y NO el ancho` (+ 4 más) | `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts` |
| R28 | `⭑ los servicios censados siguen usandolo` + `⭑ el CRUD de plantillas conserva el guard ancho…` + `⭑ dentro del propio servicio de cobros, LEER sigue siendo de acceso total` | idem |
| R29 | `⭑ una fila warning al rol maestro, con el dia CR como entidad` + `R29/R30: con pendientes, avisa con el TOTAL…` | `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts` + unit de generación |
| R30 | `⭑ y sin que nadie haya leido el primero: dias distintos, entidades distintas` + `⭑ el recordatorio del día siguiente SALE…` | idem + `tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts` |
| R31 | `⭑ la segunda emisión del mismo día no crea nada, y en la tabla queda UNA fila` + la contraprueba sobre el índice | dedupe contra Postgres |
| R32 | `R32: sin pendientes, NO se llama al notificador` | unit de generación |
| R33 | `⭑ resuelve sin lanzar, y el fallo se loggea con la operacion y su causa` | unit del aviso |
| R34 | `app/api/cron/generar-gastos-fijos/route.ts inyecta el notificador real` + la guardia derivada + `R34: el DEFAULT del service es el no-op` | `notificacion-notificadores-reales.test.ts` + unit de generación |
| R35 | `⭑ solo el numero…` + `⭑ la fila entera es opaca…` + el literal completo de la fila en la base | unit del aviso + dedupe |
| R36 | `el enum de eventos sigue siendo un inventario CERRADO, y la lista es LITERAL` + `el enum de ENTIDADES tambien…` | `notificacion-productores-wiring.test.ts` |
| R43 | los 12 casos de la guardia money-safe + `⭑ R43: el monto cruza la frontera como STRING, sin tocarse` | guardia + actions |
| R45 | `⭑ cancelarPorPlantilla usa el tx QUE RECIBE…` + `R45: cancela ANTES de borrar, con el mismo tx…` + `⭑ cancelar por plantilla devuelve el número REAL…` | unit de servicio + unit de plantillas + integración aprobación |
| R48 | `setActivaPlantilla(false) no llama a la cancelacion ni abre transaccion` (+ el de reactivar) | `gasto-fijo-plantilla-service.test.ts` |
| R49 | `la cola solo pide pendiente…` + `aprobar un cobro cancelado no escribe nada` | unit de servicio |
| R51 | `⭑ dos INSERT con el mismo origen_id violan gasto_fijo_cobro_origen_uq` + `⭑ la unicidad es TOTAL, no parcial` (+ control) | integración idempotencia |
| R55 | `⭑ el WHERE lleva las DOS condiciones: la plantilla Y el estado` + `acceso total -> el conteo del repositorio, tal cual` | integración aprobación + unit de servicio |
| R56 | `R56: reporta el numero REALMENTE cancelado…` + `333/R56: el numero de pendientes cancelados viaja del service al borde` | unit de plantillas + unit de actions |

**Los que NO son de estas tandas** (y por qué): R2 lo cubre `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` (tanda B, ya verde); R4, R37–R42 y R44 son de la tanda **G**; R46, R47, R50, R52, R53 y R54 los cubren los dos archivos de integración de la tanda **A**, que se re-ejecutaron aquí y siguen verdes; **R57 es de H4** y NO se ha escrito (ver abajo).

---

## Verificación — salidas reales

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TYPECHECK_EXIT=0
```

Limpio, sin una sola línea de error.

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores.** Las 127 advertencias son `no-unused-vars` sobre parámetros `_algo` de suites ajenas y
son el estado previo del árbol: ninguna cae en un archivo de esta ficha.

### `pnpm exec vitest related --run` sobre los 16 archivos de producción tocados

```
 Test Files  620 passed (620)
      Tests  9098 passed | 26 skipped (9124)
   Duration  269.93s
```

### Corrida explícita POR NOMBRE de los 20 archivos de test creados o modificados

*(los 16 de esta tanda + los 4 de las tandas A–C que este trabajo vuelve a tocar de rebote)*

```
 Test Files  20 passed (20)
      Tests  326 passed (326)
```

### Los CINCO archivos que corren contra Postgres — **EJECUTADOS, no saltados**

```
$ pnpm exec vitest run tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts \
    tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts \
    tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts \
    tests/integration/db/gasto-fijo-cobro-migration.test.ts \
    tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts

 Test Files  5 passed (5)
      Tests  55 passed (55)
```

**55 casos ejecutados contra `localhost:5432/ordenex`, CERO `skipped`.** Sin `DATABASE_URL` el
`describe.skip` los habría saltado y el resumen lo diría; no lo dice.

### `pnpm exec vitest run guard` (las guardias corren siempre, no las selecciona el grafo)

```
 Test Files  1 failed | 164 passed (165)
      Tests  1 failed | 2505 passed (2506)
```

El único rojo es `superficie-de-uso.guardia` y está explicado abajo. Ninguna otra guardia del árbol
—incluida `plantilla-gasto-fijo-borrado.guardia` de la 332, cuyos docstrings esta tanda edita— se
movió.

---

## Las mutaciones de la regla de dinero — **ejecutadas, con su salida ROJA**

> Las tres se aplicaron, se midió el rojo y se **revirtieron**, verificando después que el árbol
> vuelve a verde. `git status` al final no muestra ninguna de ellas.

### (a) Cobrar el monto de la plantilla en vez del copiado → **R14 y R16 mueren**

Mutación: en `GastoFijoCobroService.aprobar`, `monto: cobro.monto` → un importe que **no** es la
copia (el que tendría la plantilla si alguien la hubiera editado entre generar y aprobar).

```
     × ⭑ el servicio escribe el monto que LEE del cobro, sin tocarlo
     × ⭑ la fila del libro es exactamente la que el requisito describe
     × ⭑ el monto escrito es el del cobro, no uno leido en el momento de aprobar
     × ⭑ money-safe: el monto cruza como STRING y conserva sus decimales exactos
     × ⭑ el camino feliz deja LAS CUATRO cosas, y el movimiento lleva la clave y el monto copiado
AssertionError: expected '85000.00' to be '12345.67'
AssertionError: expected '85000.00' to be '80000.00'
 Test Files  3 failed (3)
      Tests  5 failed | 54 passed (59)
```

Mata casos en **tres** archivos a la vez: el unit del servicio, la integración contra Postgres y la
guardia money-safe. Revertida → `59 passed (59)`.

### (b) Quitar `estado = 'pendiente'` del `WHERE` de la transición → **R17 y R18 mueren**

Mutación: en `GastoFijoCobroRepository.marcarDecidido`, `where: { id, estado: "pendiente" }` →
`where: { id }`.

```
     × ⭑ aprobar DOS veces seguidas: la segunda no toca el libro y no reescribe la decisión
     × ⭑ un cobro RECHAZADO no se puede aprobar: `ya_decidido` y ni una fila en el libro
     × ⭑ el `WHERE estado = 'pendiente'` está EN LA SENTENCIA: sobre un decidido afecta 0 filas
     × ⭑ una gana con `ok` y la otra pierde con `ya_decidido`; el libro queda con UNA fila
AssertionError: expected { status: 'ok', …(1) } to deeply equal { status: 'ya_decidido' }
AssertionError: expected 1 to be +0
AssertionError: expected [ 'ok', 'ok' ] to deeply equal [ 'ok', 'ya_decidido' ]
 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 43 passed (47)
```

**`expected [ 'ok', 'ok' ]` es el hallazgo:** con el `WHERE` mutado, las DOS aprobaciones
simultáneas se dan por buenas. El unit con dobles **sobrevive**, y eso está dicho por escrito en su
cabecera: los dobles no ven el SQL. Revertida → verde.

### (c) Borrar `gasto_fijo_cobro_origen_uq` → **R51 muere**

Mutación: `DROP INDEX "gasto_fijo_cobro_origen_uq"` **dentro de la transacción revertida del propio
test**. El DDL de Postgres es transaccional, así que el índice vuelve solo al hacer rollback: la
base compartida no se toca ni un segundo fuera de esa transacción.

```
     × ⭑ dos `INSERT` con el mismo `origen_id` violan `gasto_fijo_cobro_origen_uq`
AssertionError: promise resolved "undefined" instead of rejecting
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

Revertida → `9 passed (9)`, con el índice intacto (los otros dos casos del bloque, que dependen de
él, siguen en verde).

### (extra, R34) Quitar el ARGUMENTO del notificador dejando el `import` → **E5 muere**

Es el fallo exacto que el `corte-diario` tuvo en producción, reproducido a propósito:

```
     × app/api/cron/generar-gastos-fijos/route.ts inyecta el notificador real
     × cada `notificar*Real` exportado lo PASA algun fichero de lib/ o app/, no solo lo importa
AssertionError: expected '\r\nexport interface GenerarGastosFij…' to contain
  'notificarGastoFijoCobroPendienteReal'
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
```

Caen **las dos**: la guardia del archivo y la derivada del árbol, **con el `import` intacto**.
Revertida → `23 passed (23)`.

### (extra, R27) Unificar el guard de `aprobar` con `esAccesoTotal` → **F3 muere**

```
     × ⭑ aprobar con rol `admin` -> forbidden, sin tocar el repositorio
     × ⭑ `aprobar` y `rechazar` usan el predicado ESTRECHO y NO el ancho
     × y el codigo REAL no lo contiene: la contraprueba de arriba no esta midiendo su propio ruido
AssertionError: `aprobar` autoriza con esAccesoTotal
 Test Files  2 failed (2)
      Tests  3 failed | 48 passed (51)
```

Revertida → `51 passed (51)`.

---

## Rojos y desviaciones declaradas

### 1. `superficie-de-uso.guardia` está ROJA, y por DOS motivos distintos

```
+   "lib/actions/gasto-fijo-cobro.ts:124 aprobarCobroGastoFijoAction",
+   "lib/actions/gasto-fijo-cobro.ts:170 contarCobrosPendientesDePlantillaAction",
+   "lib/actions/gasto-fijo-cobro.ts:102 listarCobrosPendientesAction",
+   "lib/actions/gasto-fijo-cobro.ts:145 rechazarCobroGastoFijoAction",
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
```

- **Las cuatro de esta ficha: es el estado esperado entre F y G**, y `tasks.md` lo dice en **H3**
  («si alguna no lo tuviera, es un bug de G»). Las consume la pantalla, que es la tanda G. **NO se
  les puso `@sin-superficie`**: sería una excepción falsa que habría que retirar mañana.
- **`lib/actions/tarifas.ts:67 obtenerTarifa` es PREEXISTENTE y ajeno a la 333.** No lo importa
  ningún módulo, no lleva anotación, y su archivo lo tocó por última vez la feature 273.
  **Medido, no razonado:** se apartó `lib/actions/gasto-fijo-cobro.ts` del árbol, se volvió a correr
  la guardia y siguió roja con `obtenerTarifa` como único hallazgo. O sea: **esta guardia ya estaba
  roja en la rama antes de esta tanda**, y la corrida completa del leader la va a encontrar.

### 2. Dónde queda el símbolo que R57 tiene que buscar (H4)

`design §9.3/§9.5` dice que `eliminarPlantilla` «llama a (1)» y que la guardia debe encontrar
**`cancelarPendientesDePlantilla`** en su fuente. Lo implementado es la **cadena**:

```
GastoFijoPlantillaService.eliminarPlantilla
      -> this.cobros.cancelarPorPlantilla(tx, id, actor, ahora)     [IGastoFijoCobroService]
            -> repo.cancelarPendientesDePlantilla(tx, …)            [IGastoFijoCobroRepository]
```

Se hizo así porque **D2 exige que `cancelarPorPlantilla` exista en el servicio** y R45/R56 están
trazados a `gasto-fijo-cobro-service.test.ts`, o sea al método del SERVICIO. Meter además el
repositorio de cobros dentro de `GastoFijoPlantillaService` dejaría `cancelarPorPlantilla` sin ningún
consumidor —código muerto— y saltaría la capa. Es el mismo patrón de «puerto estrecho» que
`LiquidacionService` usa con `ICajaPagoTiendaFeedService`.

**Consecuencia para quien escriba H4:** el símbolo que hay que afirmar en la fuente de
`GastoFijoPlantillaService.eliminarPlantilla` es **`cancelarPorPlantilla`**, no
`cancelarPendientesDePlantilla` (que vive un nivel más abajo, en `GastoFijoCobroService`). Si se
prefiere el literal del design, hay que invertir la inyección y borrar el método del servicio; **esa
decisión no se tomó aquí**.

### 3. El fixture de tres suites cambia de `requiereAprobacion: true` a `false`

En `generacion-gastos-fijos-service.test.ts`, `generacion-gastos-fijos.test.ts` (integración) y —por
el mismo motivo— en el fixture de plantillas de las suites de listado, el helper `plantilla()` pasa a
nacer en **«cobra sola»**. **Ningún cuerpo de test se editó** para el camino automático: lo que
cambia es el default del helper, y cambia porque esas suites SON el testigo de R5 («el camino
automático queda idéntico»). Con `true` habrían pasado a medir el camino nuevo con el nombre del
viejo. Los casos del cobro pendiente ponen `true` **explícitamente**, que es donde esa palabra se
lee.

### 4. Los tres `toEqual` literales del resumen del cron, actualizados A MANO

`generacion-gastos-fijos-service.test.ts`, `generacion-gastos-fijos.test.ts` y
`generar-gastos-fijos-route.test.ts` afirman la forma del resumen con un literal. Se les añadieron
`cobrosPendientesCreados` y `cobrosPendientesTotales` **escribiéndolos**, no derivándolos del
resultado: ese literal ES el contrato (R13). En el del route handler se añadió además una aserción
sobre las **claves** ordenadas, para que un campo nuevo con nombre de dinero no pueda cruzar solo.

### 5. `wallet_movimiento` NO tiene ningún `CHECK` — hallazgo de esta tanda

Se descubrió escribiendo la inyección de fallo de R15: un movimiento con `monto = 0` **entra sin
protestar**. El invariante del importe del libro vive en el borde (zod) y en el servicio, no en la
tabla; la tabla del COBRO sí lo tiene (`gasto_fijo_cobro_monto_positivo`, R52). El caso de R15
provoca el fallo por la FK `wallet_movimiento_registrado_por_fkey`, y queda escrito ahí por qué.

### 6. El caso de concurrencia (R18) es el ÚNICO que COMMITEA

Dos transacciones que se pelean por una fila necesitan que esa fila esté commiteada y necesitan DOS
conexiones: dentro de una transacción revertida no hay concurrencia que medir. Ese bloque —y sólo
ése— escribe de verdad y limpia lo suyo con una MARCA (`TEST-333-APROBACION`) en un `finally`, en
`beforeAll` **y** en `afterAll`, en el orden que las FK obligan (cobros → movimientos → plantillas).
Hay un caso final que comprueba que la base queda **con cero filas** de esa marca.

### 7. Lo que NO se hizo, por encargo

- **Tanda G** entera (pantalla): R4, R37–R42, R44 y el R55 de la confirmación.
- **Tanda H**: H1 (censo de descarga), H2, H3 (superficie de las cuatro actions) y **H4 (R57)**.
  R57 **no tiene test**: es el único requisito del alcance backend que queda sin cubrir, y queda
  dicho en voz alta aquí en vez de darse por «passed» por vacío.
- **Tanda I**: `./init.sh` completo, repaso a mano y PR.
- Ningún comando `git` que escriba. Ninguna migración nueva. Ningún `down.sql` tocado.

---

## Contrato que queda para la pantalla (tanda G)

```ts
// lib/actions/gasto-fijo-cobro.ts  ('use server')
listarCobrosPendientesAction(input?: unknown, deps?)
  -> { status:"ok"; items: GastoFijoCobroDTO[]; total: number }
   | { status:"forbidden" } | { status:"unauthenticated" }
   | { status:"validation_error"; fieldErrors }

aprobarCobroGastoFijoAction({ id: uuid }, deps?)
  -> { status:"ok"; yaEstabaEnElLibro: boolean }
   | { status:"ya_decidido" } | { status:"not_found" } | { status:"forbidden" }
   | { status:"unauthenticated" } | { status:"validation_error"; fieldErrors }

rechazarCobroGastoFijoAction({ id: uuid }, deps?)
  -> { status:"ok" } | { status:"ya_decidido" } | { status:"not_found" }
   | { status:"forbidden" } | { status:"unauthenticated" } | { status:"validation_error"; fieldErrors }

contarCobrosPendientesDePlantillaAction({ plantillaId: uuid }, deps?)
  -> { status:"ok"; pendientes: number } | { status:"forbidden" }
   | { status:"unauthenticated" } | { status:"validation_error"; fieldErrors }

// lib/types/gasto-fijo-cobro.ts
GastoFijoCobroDTO = { id, concepto, monto: string, periodo, generadoEl, estado }
```

- **`total` NO es `items.length`** (R41): `items` viene recortado a `gastoFijoConfig.MAX_PAGE_SIZE`
  y el `total` lo cuenta el servidor. La cabecera pinta `total`.
- **`monto` es STRING con dos decimales** de punta a punta (R43): se pinta con `money(...)`, sin
  `parseFloat`, sin `Number(` y sin aritmética.
- **`yaEstabaEnElLibro`** distingue los dos finales felices y el mensaje tiene que decir la verdad
  (R19): `false` = «se cobró ahora»; `true` = «ya estaba en el libro; se marcó aprobado y no se
  cobró dos veces».
- **`ya_decidido` no es un error del usuario**: es el final normal cuando alguien decidió antes.
- **Los botones sólo si `actor.rol === maestro`** (R40) — y es comodidad: la autorización real la
  hace el servicio (R24), que responde `forbidden` al `admin` igualmente.
- **`eliminarPlantillaAction` ahora devuelve `{ status:"ok", pendientesCancelados: number }`**: es el
  número REAL cancelado (R56), el que el mensaje posterior al borrado debe usar.

---

## Veredicto

**D, E y F entregadas: typecheck y lint sin errores, 620 archivos relacionados en verde (9.098
tests), los 20 archivos tocados verdes por nombre, 55 casos EJECUTADOS contra Postgres —ninguno
saltado— y las cinco mutaciones (las tres de dinero más las de R34 y R27) aplicadas, muertas y
revertidas; con un rojo esperado en `superficie-de-uso.guardia` que la tanda G cierra y otro
PREEXISTENTE y ajeno (`obtenerTarifa`) que ya venía en la rama, y con R57 declarado SIN cubrir
porque su guardia es H4.**

---
---

# Ficha 333 — Tandas **G** (pantalla) y **H** (censos y guardias)

> Encargo acotado: **G y H**. La tanda **I (cierre) NO se ha hecho**: es del leader. No se corrió
> `./init.sh`, no se tocó `feature_list.json`, `progress/current.md`, `specs/`, `lib/`, `db/` ni
> ninguna migración, y no se ejecutó ni un comando `git` que escriba.
>
> Fecha: 2026-08-29. Rama: `feature/333-gasto-fijo-autorizacion` (ya existía).

---

## Lo que se hizo, tarea por tarea

### Tanda G · Pantalla

- **G1** — `app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx` (nuevo). `Card` +
  `CardHeader` + `CardTitle` + `CardDescription` + `CardAction` con `Badge variant="warning"` +
  `DataTable`. **Sin `descarga`, sin `Pagination`, sin contador derivado del largo del array**: el
  número de la insignia sale del `total` del servidor. Acciones por fila **sólo si `puedeDecidir`**.
  El monto se pinta con `money(...)` sobre el STRING; el archivo no contiene `parseFloat` ni
  `Number(`. Los textos viven en un módulo puro nuevo,
  `app/(app)/wallet/_components/cobro-gasto-fijo-labels.ts`.
- **G2** — `WalletModule.tsx`: monta la sección **entre la tarjeta de la caja y la de la ganancia**
  (design §7). Con `total === 0` **no la renderiza**; y la propia sección se retira sola cuando su
  relectura devuelve la cola vacía (decidir el último cobro sin recargar la ruta). Tras
  aprobar/rechazar, `onCambio` recarga libro + resumen + composición + desglose con los filtros
  vigentes, y la sección relee lo suyo con su `mutate` — el mismo ciclo del panel de plantillas.
- **G3** — `app/(app)/wallet/page.tsx`: `listarCobrosPendientesAction({})` entra en el `Promise.all`
  que ya existía; `{ items, total }` y `puedeDecidirCobros = actor.rol === RolValue.maestro` bajan
  por props. **El guard de la página no se tocó**: sigue siendo `esAccesoTotal` (el admin VE la
  cola). Un `forbidden` de esa lectura deja la página en `notFound`, como las otras cuatro.
- **G4** — `GastoFijoPlantillaDialog.tsx` gana el `Switch` «Requiere aprobación» con su ayuda y la
  línea que nombra la posición elegida («Cobra sola» / «Requiere aprobación»), y **envía el campo
  SIEMPRE**, al crear y al editar. `GastosFijosPlantillasPanel.tsx` gana la columna «Cobro» con su
  `Badge`. El texto sale del módulo puro `gasto-fijo-estado-label.ts`, que ya tenía ese patrón.
  **La descripción de la tarjeta se corrigió**: decía que el sistema cobra estos gastos por su
  cuenta según su periodicidad —cierto hasta esta ficha— y ahora nombra las dos posibilidades.
- **G5** — `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx` (nuevo, 22 casos):
  R37, R38, R39, R40, R41, R42 (+ el matiz de R19 y los cuatro fallos con mensaje propio).
- **G6** — `tests/unit/components/wallet-page-cobros-pendientes.test.tsx` (nuevo, 10 casos): R44,
  más R40 y R41 en la frontera servidor→cliente.
- **G7** — `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` (ampliado, 27 → 38 casos):
  R4, R48 en la superficie y **R55/R56** (la 332 está mergeada, así que R55 SÍ se cubre; ver T0.2b
  de la tanda A). `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` (ampliado,
  14 → 19 casos): R1/R2/R4 del interruptor, con el caso que discrimina el default silencioso.

### Tanda H · Censos y guardias

- **H1** — `tests/unit/descarga/censo-tablas.ts`: la sección nueva queda registrada como `fuera`
  con su nota obligatoria (cola de decisión efímera; lo aprobado aterriza en el libro de la caja,
  que sí descarga). Los totales de `cobertura-tablas.guardia.test.ts` se actualizaron con los
  números **MEDIDOS por la propia guardia** (dijo 28 donde el registro decía 27), no con los del
  spec 170: **28 archivos / 28 instancias de `<DataTable>`, 8 exclusiones con `<DataTable>`,
  9 `fuera` en total y 29 tablas censadas**.
- **H2** — `contadores-cabecera.guardia`: **no hubo que registrar nada**, como `tasks.md` predecía.
  Y la guardia demostró que sirve: se puso ROJA por el patrón `({X.length})` escrito **dentro de un
  comentario** del panel nuevo (escanea el fuente crudo, no distingue prosa de código). Se reescribió
  la frase; el registro sigue con sus DOS entradas de siempre.
- **H3** — `superficie-de-uso.guardia`: **las cuatro actions nuevas tienen consumidor de
  producción** y han salido de la lista. Ver la comprobación pegada abajo.
- **H4** — `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` (ampliado, 27 → 37
  casos): **R57**, condicional a que exista una operación de borrado en el árbol, buscada **por
  forma** (`async (eliminar|borrar|remover)…Plantilla…(`) y no por un nombre fijo.

---

## ⚠️ H4 afirma `cancelarPorPlantilla`, no `cancelarPendientesDePlantilla`

`design.md §9` escribió que la fuente de `eliminarPlantilla` debía contener
`cancelarPendientesDePlantilla`. Lo implementado por la tanda F es una **cadena de dos eslabones**:

```
GastoFijoPlantillaService.eliminarPlantilla
      -> this.cobros.cancelarPorPlantilla(tx, id, actor, ahora)   [IGastoFijoCobroService]
            -> repo.cancelarPendientesDePlantilla(tx, …)          [IGastoFijoCobroRepository]
```

Afirmar el nombre del REPOSITORIO en la fuente del servicio de plantillas vigilaría un sitio donde
ese nombre no aparece nunca. La guardia afirma **los dos eslabones, cada uno donde vive**:

1. el cuerpo de la operación de borrado contiene `cancelarPorPlantilla(` **dentro** de su
   transacción (y el `repo.eliminar(` también: R45 es «las dos o ninguna», así que cancelar fuera
   de la transacción también se caza), y
2. el cuerpo de `GastoFijoCobroService.cancelarPorPlantilla` contiene
   `cancelarPendientesDePlantilla(`, y el repositorio declara ese método.

Sin (2), el puerto podría vaciarse y (1) seguiría verde afirmando que se llama a algo que ya no
hace nada. Todo sobre el **uso efectivo**: fuente sin comentarios NI imports.

---

## Mapa `R<n>` → test de ESTA tanda

| R | Qué exige | Test que lo cubre |
| --- | --- | --- |
| R4 | el interruptor en la tabla y en el diálogo | `wallet-gastos-fijos-panel.test.tsx` («la tabla tiene columna «Cobro»…», «la descripción de la tarjeta ya no promete…») + `wallet-gasto-fijo-plantilla-dialog.test.tsx` (5 casos del interruptor) |
| R1/R2 (superficie) | dos valores; nueva nace en «requiere aprobación» | `wallet-gasto-fijo-plantilla-dialog.test.tsx` («R2: una plantilla NUEVA nace…», «apagarlo crea…») |
| R37 | sección que llama la atención, con las primitivas del módulo | `wallet-cobros-pendientes-panel.test.tsx` («es una región con título…», «lo que llama la atención es un `Badge` del tema…») |
| R38 | sin pendientes, la sección no se renderiza | id. («con el total del servidor en cero no se renderiza NADA», «tampoco queda una tarjeta vacía cuando la cola se vacía mirándola») |
| R39 | concepto, período, monto, fecha; del más antiguo al más reciente | id. («concepto, período, monto y fecha…», «⭑ los ordena del MÁS ANTIGUO…») |
| R40 | acciones sólo para el maestro | id. («el maestro ve Aprobar y Rechazar…», «⭑ el admin ve la tabla ENTERA y ningún botón…») + `wallet-page-cobros-pendientes.test.tsx` («⭑ el admin VE la cola y NO puede decidirla») |
| R41 | el número es el del servidor | id. («⭑ sale del `total` del SERVIDOR…») + `wallet-page-cobros-pendientes.test.tsx` («el `total` llega tal cual al módulo») |
| R42 | aprobar/rechazar refresca sección + cifras y avisa | id. (bloque «decidir refresca y avisa», 8 casos) |
| R43 (pantalla) | el monto se pinta como cadena | `gasto-fijo-cobro-money-safe.guardia.test.ts` (el panel entra en el censo) + `wallet-cobros-pendientes-panel.test.tsx` («⭑ el monto se pinta con `money`…») + `wallet-page-cobros-pendientes.test.tsx` («⭑ el monto cruza la frontera como CADENA») |
| R44 | pre-obtenido en el servidor y pasado por props | `wallet-page-cobros-pendientes.test.tsx` (bloque entero, incluidos los tres casos de «no se lee sin pasar por el guardia») |
| R48 (superficie) | desactivar no cancela lo ya generado | `wallet-gastos-fijos-panel.test.tsx` («⭑ desactivar sólo apaga la plantilla…») |
| R55 | la confirmación dice cuántos se cancelan, leído al abrir | id. (6 casos del bloque «la confirmación dice cuántos cobros cancela») |
| R56 | el aviso posterior lleva el número REAL | id. («⭑ tras borrar, el aviso lleva el número REALMENTE cancelado») |
| R57 | si existe borrado, cancela en su transacción | `plantilla-gasto-fijo-borrado.guardia.test.ts`, bloque «(g)» + su autocomprobación (6 casos) |

**R55 SÍ aplica**: la 332 está mergeada (`GastoFijoPlantillaService.eliminarPlantilla` existe;
comprobado en el archivo real, ver T0.2b arriba). Nada de esta tanda se declara «no aplicable».

---

## Verificación — salidas REALES

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```

(sin una sola línea de error; en la primera pasada sí las hubo — `"conflict"` faltaba en el tipo de
fallo de la decisión y `WalletDescarga.test.tsx` no pasaba las props nuevas — y se corrigieron.)

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
```

**0 errores.** Los 127 avisos son los preexistentes del árbol (`_input`, `_err`… sin usar en tests
ajenos); ninguno cae en un archivo de esta tanda.

### `pnpm exec vitest related --run` sobre los 7 archivos de producción tocados

```
 Test Files  10 passed (10)
      Tests  140 passed (140)
   Duration  18.11s
```

### Corrida explícita POR NOMBRE de los 10 archivos de test creados o modificados

```
 Test Files  10 passed (10)
      Tests  170 passed (170)
   Duration  12.28s
```

(`wallet-cobros-pendientes-panel`, `wallet-page-cobros-pendientes`, `wallet-gastos-fijos-panel`,
`wallet-gasto-fijo-plantilla-dialog`, `integration/wallet-page`, `components/descarga/WalletDescarga`,
`descarga/cobertura-tablas.guardia`, `descarga/contadores-cabecera.guardia`,
`guards/plantilla-gasto-fijo-borrado.guardia`, `guards/gasto-fijo-cobro-money-safe.guardia`.)

### Las guardias, que NO las selecciona el grafo — `pnpm exec vitest run guard`

```
 Test Files  1 failed | 164 passed (165)
      Tests  1 failed | 2514 passed (2515)
```

El único rojo es `superficie-de-uso.guardia`, y es el PREEXISTENTE y ajeno (`obtenerTarifa`): ver la
comprobación de abajo.

### El censo de descargas — `pnpm exec vitest run tests/unit/descarga`

```
 Test Files  37 passed (37)
      Tests  244 passed (244)
```

### Toda la capa de pantalla — `pnpm exec vitest run tests/unit/components tests/components`

```
 Test Files  343 passed (343)
      Tests  4723 passed | 26 skipped (4749)
   Duration  309.95s
```

---

## ⭑ La comprobación que cierra la tanda: `superficie-de-uso.guardia`

Las cuatro actions nuevas estaban **sin superficie** al terminar la tanda F, y ese archivo **ya
estaba en el baseline** por una deuda ajena, así que la comparación por archivo del gate habría
salido verde mintiendo si esta tanda quedaba a medias. Estado AHORA:

```
$ pnpm exec vitest run tests/unit/guards/superficie-de-uso.guardia.test.ts

AssertionError: estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de
ruta: …
- Expected
+ Received
- []
+ [
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
+ ]
 Test Files  1 failed (1)
      Tests  1 failed | 17 passed (18)
```

**La lista ha vuelto a tener SOLO `obtenerTarifa`.** Las cuatro de la ficha 333
—`listarCobrosPendientesAction`, `aprobarCobroGastoFijoAction`, `rechazarCobroGastoFijoAction` y
`contarCobrosPendientesDePlantillaAction`— desaparecieron de ella porque ahora las importa código
alcanzable desde una raíz de ruta:

| Action | Quién le da superficie |
| --- | --- |
| `listarCobrosPendientesAction` | `app/(app)/wallet/page.tsx` (pre-fetch) y el panel (relectura) |
| `aprobarCobroGastoFijoAction` | `CobrosGastoFijoPendientesPanel.tsx` (botón «Aprobar») |
| `rechazarCobroGastoFijoAction` | `CobrosGastoFijoPendientesPanel.tsx` (botón «Rechazar») |
| `contarCobrosPendientesDePlantillaAction` | `GastosFijosPlantillasPanel.tsx` (confirmación de borrado) |

`lib/actions/tarifas.ts:67 obtenerTarifa` **es la deuda preexistente y ajena**: su archivo lo tocó
por última vez la feature 273, no lleva anotación `@sin-superficie` y la tanda F ya lo midió
apartando su propio archivo del árbol. **No se le puso anotación**: sería una excepción de una ficha
que no es ésta. El gate la seguirá encontrando y es lo correcto.

---

## Las mutaciones — aplicadas, ROJAS y revertidas

Cinco, no tres. Todas se aplicaron sobre el árbol real, se corrió el test, se pegó el rojo y se
restauró el archivo (verificado después: `git diff -- lib/` **vacío** y el panel byte a byte igual
que antes).

### (a) Pintar el monto con `Number(...)` → **muere la guardia money-safe**

`render: (c) => money(c.monto)` → `render: (c) => money(String(Number(c.monto)))`

```
     × ⭑ ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni un `+` unario sobre el monto
AssertionError: conversion de dinero a numero en el camino del cobro: expected [ Array(1) ] to
deeply equal []
+ [
+   "app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx: Number(",
+ ]
 Tests  1 failed | 11 passed (12)
```

**Y el dato incómodo, dicho en voz alta: el test de render NO la mata** (22/22 verdes con la
mutación puesta). `money(String(Number("300000.00")))` pinta exactamente «₡300.000», así que la
pérdida del céntimo es invisible en pantalla — que es justo por lo que R43 se prueba con una guardia
estática y no sólo con un render. Por eso el panel **se añadió al censo de
`gasto-fijo-cobro-money-safe.guardia.test.ts`**, que hasta esta tanda decía por escrito que la
pantalla no estaba porque todavía no existía.

### (b) Mostrar los botones de decidir también al `admin` → **muere R40**

`const columnas = puedeDecidir ? […]` → `const columnas = true ? […]`

```
     × concepto, período, monto y fecha de generación, en ese orden y en palabras
     × ⭑ el admin ve la tabla ENTERA y ningún botón de decisión
AssertionError: expected [ Array(5) ] to deeply equal [ Array(4) ]
expected document not to contain element, found <th …
 Tests  2 failed | 20 passed (22)
```

### (c) Usar `items.length` como total → **muere R41**

`totalPorAprobarTexto(cola.total)` → `totalPorAprobarTexto(cola.items.length)`

```
     × ⭑ sale del `total` del SERVIDOR, no del largo de lo pintado
TestingLibraryElementError: Unable to find an element with the text: 7 por aprobar.
 Tests  1 failed | 21 passed (22)
```

Nota: `contadores-cabecera.guardia` **no** habría cazado esta forma (persigue el patrón
`({X.length})` en el JSX, y aquí el largo entra por un parámetro). El que la mata es el caso de
comportamiento, con `items` de 2 y `total` de 7.

### (d) Borrar la cancelación del borrado de plantilla → **muere H4 (R57)**

En `lib/services/GastoFijoPlantillaService.ts`, `await this.cobros.cancelarPorPlantilla(…)` → `0`.

```
     × ⭑ cada operación de borrado cancela los pendientes DENTRO de su transacción
     × el borrado REAL del árbol no tiene ninguna pieza que falte (control positivo)
AssertionError: una plantilla no puede desaparecer dejando cobros en `pendiente` (R45/R46/R57)
+ [
+   "lib/services/GastoFijoPlantillaService.ts#eliminarPlantilla: falta la llamada a
+    `cancelarPorPlantilla`",
+ ]
```

Restaurado y verificado: `git diff --stat -- lib/` **no devuelve nada**.

### (e) Abrir la confirmación sin leer cuántos pendientes cancela → **muere R55**

`onClick={() => pedirConfirmacionDeBorrado(p)}` → `onClick={() => setAEliminar(p)}` (la conducta
anterior a esta ficha).

```
     × ⭑ el número se pide AL ABRIR la confirmación, no viene con el listado
     × ⭑ enseña «se cancelarán N cobros pendientes» ANTES de aceptar
     × con un solo pendiente lo dice en singular
     × sin cobros pendientes lo dice también: el cero es una respuesta
     × ⭑ si el número no se puede leer, se dice — no se finge un cero
     × ⭑ tras borrar, el aviso lleva el número REALMENTE cancelado (R56)
 Tests  6 failed | 32 passed (38)
```

Además, las guardias de la ficha se auto-comprueban con mutaciones **en memoria** (sin tocar el
árbol): H4 lleva casos que le dan un cuerpo que borra sin cancelar, otro que cancela FUERA de la
transacción y otro sin transacción, y un control positivo sobre el código real para que los tres
rojos no puedan venir de un detector que marque todo.

---

## Archivos creados / modificados en esta tanda

**Producción (7):**

```
app/(app)/wallet/page.tsx                                            (modificado)
app/(app)/wallet/_components/WalletModule.tsx                        (modificado)
app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx      (NUEVO)
app/(app)/wallet/_components/cobro-gasto-fijo-labels.ts              (NUEVO)
app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx          (modificado)
app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx            (modificado)
app/(app)/wallet/_components/gasto-fijo-estado-label.ts              (modificado)
```

**Tests (10):**

```
tests/unit/components/wallet-cobros-pendientes-panel.test.tsx        (NUEVO, 22 casos)
tests/unit/components/wallet-page-cobros-pendientes.test.tsx         (NUEVO, 10 casos)
tests/unit/components/wallet-gastos-fijos-panel.test.tsx             (27 -> 38 casos)
tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx    (14 -> 19 casos)
tests/integration/wallet-page.test.tsx                               (mock + fixture de la cola)
tests/components/descarga/WalletDescarga.test.tsx                    (props nuevas del módulo)
tests/unit/descarga/censo-tablas.ts                                  (H1: la tabla nueva, `fuera`)
tests/unit/descarga/cobertura-tablas.guardia.test.ts                 (H1: totales medidos)
tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts        (el panel entra en el censo)
tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts       (H4: R57, 27 -> 37 casos)
```

---

## Decisiones y deuda declaradas (no son olvidos)

1. ~~**La columna «Cobro» NO entró en el archivo descargable de las plantillas.**~~ **CERRADA el
   2026-08-29 por decisión del leader** — ver «Cierre de la divergencia nº1» al final de este
   documento. Lo que decía, y se conserva para que se entienda la corrección: *«`gastos-fijos-
   descarga-columnas.ts` sigue con sus CINCO columnas y su `toEqual` literal intacto. El módulo
   dice de sí mismo que «el archivo refleja lo que la tabla enseña», así que esto es una
   divergencia y se declara: `tasks.md > G4` pide el `Badge` en la tabla y el `Switch` en el
   diálogo, y nada del archivo; ampliarlo obliga a reescribir un contrato literal de las fichas
   170/85 que no está en el alcance de ésta. Es una línea más su literal el día que se decida.»*
   El leader lo resolvió al revés y con razón: el criterio de ese módulo está escrito y la ficha 85
   ya lo cumplió con «Periodicidad» y «Próximo cobro»; dejar «Cobro» fuera lo rompía **en
   silencio**, que es como se acumula la deuda que después nadie sabe explicar.
2. **El orden de la cola se aplica TAMBIÉN en la pantalla** (`sort` estable por `generadoEl`),
   aunque el servidor ya la entregue ordenada. Sin eso, el caso de R39 estaría afirmando contra su
   propio fixture; con eso, el test le da la lista al revés y exige que salga ordenada. El desempate
   fino del servidor (`created_at`, `id`) se conserva porque el `sort` es estable y el DTO —a
   propósito— no expone `createdAt`.
3. **La sección relee con SWR + `mutate`**, igual que el panel de plantillas, y no con estado local.
   Es lo que `design.md §7` pide literalmente («`mutate()` de la sección + `onCambio()` al módulo»)
   y lo que hace que la tarjeta desaparezca sola al decidir el último cobro. La primera lectura
   sigue siendo la del servidor (R44): SWR arranca con `fallbackData`.
4. **`ya_decidido` se anuncia con `toast.info`, no con `toast.error`**, y hay un caso que lo afirma
   contando los toasts de variante `error`. No es cosmético: alguien decidió antes, y llamarlo error
   haría dudar de si el cobro se duplicó.
5. **No se verificó nada en el navegador.** La comprobación con ojos (`/wallet` con un pendiente
   sembrado, aprobar, rechazar, mirar la campana) es **I3** y es del leader. Lo que estos tests no
   pueden ver: cómo queda el `Badge variant="warning"` en modo oscuro sobre la tarjeta real, y si la
   sección «llama la atención» de verdad entre la caja y la ganancia.

---

## Cierre de la divergencia nº1 — «Cobro» entra en el archivo descargable de plantillas

> Encargo del leader del 2026-08-29, posterior a la entrega de G+H. Alcance EXACTO: el módulo de
> columnas de la descarga y su test. **No se tocó nada más**: ni `lib/`, ni la sección de cobros
> pendientes, ni ningún otro test, ni un solo comando `git` que escriba.

**Por qué se cierra así, y no como yo la había declarado.** `gastos-fijos-descarga-columnas.ts`
tiene escrito en su propia cabecera que el archivo refleja lo que la tabla enseña, y la ficha 85 lo
cumplió al añadir «Periodicidad» y «Próximo cobro» con ese mismo argumento. La ficha 333 añade a la
tabla la columna que dice **si esa plantilla se cobra sola o espera una decisión** —lo que separa un
egreso automático de uno autorizado— y dejarla fuera del archivo rompía el criterio sin que nada
fallara. Un Excel de plantillas que no lo diga obliga a abrir la pantalla para saber cuáles cobran
solas, que es justo lo que el archivo existe para evitar.

### Qué cambió

- **`app/(app)/wallet/_components/gastos-fijos-descarga-columnas.ts`**
  - `COLUMNAS_DESCARGA_GASTOS_FIJOS` pasa de CINCO a SEIS: entra `{ clave: "cobro", encabezado:
    "Cobro" }`.
  - `filaDescargaGastoFijo` proyecta
    `cobro: interruptorPlantillaGastoFijo(plantilla.requiereAprobacion === true)`.
    **La etiqueta sale del módulo puro compartido** (`gasto-fijo-estado-label.ts`), el mismo del que
    la tabla saca su `Badge`: escribir aquí un literal propio dejaría el texto declarado en dos
    sitios y el día que uno cambiara, tabla y Excel dirían cosas distintas de la misma fila sin que
    nada se pusiera rojo.
    El `=== true` no es adorno: lo copia de `activa` justo encima, porque bajo
    `columnas-sensibles.guardia` el DTO es una **sonda** (un `Proxy` que responde truthy a cualquier
    lectura) y sin la comparación estricta el `false` no se distinguiría del proxy.
  - **«Cobro» va la ÚLTIMA, no en el quinto puesto donde la tabla la pinta**, y la diferencia queda
    escrita en el módulo en vez de dejarla adivinar: añadir al final no mueve de sitio a ninguna de
    las cinco columnas que ya salían, así que una hoja guardada, una fórmula o un filtro hechos
    sobre un archivo anterior siguen apuntando a la misma columna. Insertarla en medio se los
    llevaría por delante sin avisar. (Cambiar el orden de la TABLA para que coincidan sería tocar
    la pantalla, que el encargo excluye.)

- **`tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts`**
  - El `toEqual` de claves y de encabezados se actualizó **A MANO**, de cinco entradas a seis, en
    los dos literales. **No** se sustituyó por una derivación de la propia constante: comparar
    `COLUMNAS.map(...)` consigo misma queda verde por construcción y deja de fijar el contrato —la
    familia de fallo que este repo ya tiene medida.
  - **Caso nuevo que discrimina:** proyecta las DOS situaciones y espera literales **distintos**
    (`"Requiere aprobación"` / `"Cobra sola"`). Con una sola plantilla, una columna que devolviera
    siempre lo mismo —o que leyera el campo equivocado— pasaría igual.
  - Dos casos más: la etiqueta compartida queda fijada contra literales (mismo patrón que
    `periodicidadLegible` en este archivo), y **«Cobro» no se confunde con «Estado»** — una
    plantilla `Inactiva` sigue diciendo `Requiere aprobación`, porque desactivar detiene la
    generación futura y no cambia quién autoriza (R48).

### Verificación — salidas REALES

```
$ pnpm typecheck
> tsc --noEmit                                   (sin una sola línea de error)

$ pnpm lint
✖ 127 problems (0 errors, 127 warnings)          (los mismos avisos preexistentes del árbol)

$ pnpm exec vitest run tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ pnpm exec vitest run tests/unit/descarga        (los censos de descarga, que corren siempre)
 Test Files  37 passed (37)
      Tests  247 passed (247)                     (244 -> 247: los tres casos nuevos)

$ pnpm exec vitest related --run app/(app)/wallet/_components/gastos-fijos-descarga-columnas.ts
 Test Files  8 passed (8)
      Tests  102 passed (102)
```

**Ningún censo movió sus totales, y no es un olvido: `cobertura-tablas.guardia` cuenta INSTANCIAS de
`<DataTable>` y archivos, no columnas de descarga.** Los números que H1 dejó medidos (28 archivos /
28 instancias / 8 exclusiones / 9 `fuera` / 29 tablas) siguen siendo los mismos, y la corrida
completa de `tests/unit/descarga` lo confirma en verde sin tocar una línea de la guardia.

### La mutación, ROJA y revertida

Se hizo que la columna devolviera **siempre** el mismo texto para las dos situaciones
(`interruptorPlantillaGastoFijo(plantilla.requiereAprobacion === true)` →
`interruptorPlantillaGastoFijo(true)`):

```
     × ⭑ dice cosas DISTINTAS en las dos situaciones, con literales
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected 'Requiere aprobación' to be 'Cobra sola' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

Revertida y comprobada: el archivo vuelve a proyectar
`interruptorPlantillaGastoFijo(plantilla.requiereAprobacion === true)` (línea 99) y la suite vuelve
a 9/9.

**Con esto, la divergencia nº1 queda CERRADA.** Las otras cuatro decisiones declaradas siguen como
estaban.

---

## Censos de inventario cerrado que amplía esta ficha

**Qué son y por qué se tocan.** Cinco archivos de `tests/integration/db/` mantienen inventarios
**cerrados** —listas literales escritas a mano— sobre los enums de la campana, sobre qué migraciones
pueden llamarse «de notificaciones» y sobre qué tablas nacieron con `DEFAULT` en `updated_at`. No son
un obstáculo: existen precisamente para que **ampliar un enum sea un acto deliberado y no un
descuido**. La 333 los rompe por diseño al añadir `notificacion_evento += gasto_fijo_cobro_pendiente`,
`notificacion_entidad_tipo += gasto_fijo_cobro_dia` y la tabla `gasto_fijo_cobro`.

Se han actualizado **conservando su propósito**: siguen siendo inventarios cerrados, ahora con un
valor más, siguiendo el patrón que ya dejaron las fichas 253, 262 y 271 en esos mismos archivos —el
valor nuevo **al final y en orden de adición**, y cada entrada con el motivo escrito al lado (qué
ficha la añadió y por qué).

**Todos los literales se actualizaron A MANO.** Ninguno se convirtió en derivado de la fuente que
vigila: un censo que lea su lista esperada del propio `schema.prisma` o del propio `pg_enum` queda
verde por construcción y deja de fijar nada. Eso se escribió explícitamente en los archivos donde
faltaba (`schema-drift-saneamiento.test.ts` y el de la 253), para que el siguiente que pase no lo
«simplifique».

**Ningún `down.sql` anterior se tocó.** `git diff --name-only` al terminar devuelve exactamente los
cinco archivos de test y nada más:

```
tests/integration/db/no-migration-102.test.ts
tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
tests/integration/db/schema-drift-saneamiento.test.ts
```

### La tanda H del spec NO enumeró ninguno de estos cinco

`specs/333-gasto-fijo-autorizacion/tasks.md` §«Tanda H · Censos y guardias que esta ficha DEBE
actualizar» lista **H1–H4** y las cuatro son de otra familia: `censo-tablas.ts`,
`contadores-cabecera.guardia`, `superficie-de-uso.guardia` y `plantilla-gasto-fijo-borrado.guardia`.
Su encabezado dice *«ninguna de estas tres se selecciona por el grafo de imports: corren siempre y se
ponen rojas solas si se olvidan; están aquí para que no se descubran en el gate»* — y es exactamente
lo que pasó con **estos otros cinco**, que tampoco se seleccionan por imports y que **el spec no
nombró**. Aparecieron en el `./init.sh` completo, no antes. Queda escrito como hueco del spec.

**La regla que faltaba, dicha para la próxima ficha:** *toda ficha que añada un valor a
`notificacion_evento` o a `notificacion_entidad_tipo` rompe CUATRO archivos de censo
(`no-migration-102`, el de la 253, el de la 262 y el de la 271), y toda ficha que cree una tabla con
`DEFAULT` en `updated_at` rompe un quinto (`schema-drift-saneamiento`).* Esos cinco deberían
aparecer, por nombre, en la tanda H de cualquier ficha con esas dos formas.

### 1 · `tests/integration/db/no-migration-102.test.ts`

- **Afirmaba:** «la única migración de notificaciones es la de la 146, salvo las declaradas arriba»,
  con tres excepciones declaradas (253, 262, 271).
- **Afirma ahora:** lo mismo, con una **cuarta** excepción declarada,
  `_notificacion_evento_gasto_fijo_cobro`, y un párrafo en el docblock que dice de qué ficha es y por
  qué. Se deja escrito además que la tabla que sí crea la 333 (`gasto_fijo_cobro`) vive en **otra**
  migración que no lleva la palabra «notificacion» y no es infra de campana, de modo que las dos
  aserciones sobre `schema.prisma` (los DOS modelos de la 146, las CINCO tablas/enums con nombre de
  notificación) siguen siendo las mismas y siguen verdes. La guardia **no se relajó**: la lista sigue
  cerrada y sigue exigiendo que cada excepción declarada EXISTA.
- **Mutación** (quitar `"_notificacion_evento_gasto_fijo_cobro"` de la lista) → **ROJO**:

```
 FAIL  tests/integration/db/no-migration-102.test.ts > Feature 102 · SIN migracion nueva (R3) > la unica migracion de notificaciones es la de la 146, salvo las declaradas arriba
AssertionError: hay una migracion con concepto de notificacion que nadie declaro en `MIGRACIONES_NOTIFICACIONES_POSTERIORES`: o es de la 102 (y entonces R3/R17 se rompio) o es de otra feature y hay que nombrarla ahi con su motivo: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "20260829130000_notificacion_evento_gasto_fijo_cobro",
+ ]

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

### 2 · `tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts` (ficha 271)

- **Afirmaba:** «la base tiene los **OCHO** eventos, con los dos nuevos AL FINAL y en orden de
  adición».
- **Afirma ahora:** «la base tiene los **NUEVE** eventos, con los dos de la 271 y el de la 333 AL
  FINAL y en orden de adición». **El nombre del caso se actualizó**: decía OCHO y ya son nueve, y un
  nombre desactualizado es la forma más barata de que el próximo lector desconfíe del archivo entero.
  Se añadió una nota que delimita qué crece y qué no: **solo este caso** mira la base aplicada; el UP
  de la 271, su DOWN con los SEIS previos y las afirmaciones sobre los `down.sql` de la 146/253/262
  son **fotos históricas** y siguen intactas.
- **No se tocó** el caso «⭑ CONTROL: SIN filas del evento nuevo, ese MISMO down corre entero sin
  fallar», y se comprobó por qué no hacía falta: todo lo que la 333 escribe en `notificacion` corre
  dentro de `enTransaccionRevertida` + `serializarEscriturasReales` (un `pg_advisory_xact_lock`), el
  mismo lock que toma ese control, así que ninguna fila con `gasto_fijo_cobro_pendiente` queda
  commiteada ni visible para él. Verde medido, no supuesto.
- **Mutación** (quitar `"gasto_fijo_cobro_pendiente"` de la lista esperada) → **ROJO**:

```
 FAIL  tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts > 271 / §3.2 — la base aplicada, y el DOWN ejercitado de verdad > la base tiene los NUEVE eventos, con los dos de la 271 y el de la 333 AL FINAL y en orden de adicion
AssertionError: expected [ 'orden_rechazada', …(8) ] to deeply equal [ 'orden_rechazada', …(7) ]

- Expected
+ Received

    "cierre_dia_por_aprobar",
    "postulacion_recurso_pendiente",
    "dia_reparto_corregido",
    "cierre_dia_vencido",
    "mensajero_bloqueado_por_cierres",
+   "gasto_fijo_cobro_pendiente",

 Test Files  1 failed (1)
      Tests  1 failed | 14 passed (15)
```

### 3 · `tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts` (ficha 262)

- **Afirmaba, en cuatro casos:** `NotificacionEvento` de `schema.prisma` como inventario CERRADO (8
  valores), `NotificacionEntidadTipo` igual (6), «la base tiene los **SEIS** eventos, con el nuevo AL
  FINAL» (que ya listaba 8: el nombre mentía desde la 271) y «y los **SEIS** tipos de entidad».
- **Afirma ahora:** los mismos cuatro inventarios cerrados con un valor más cada uno
  (`gasto_fijo_cobro_pendiente` / `gasto_fijo_cobro_dia`), al final y en orden de adición, cada uno
  con su motivo al lado. **Los dos nombres se corrigieron** a «los **NUEVE** eventos, con el de esta
  ficha y los posteriores AL FINAL» y «y los **SIETE** tipos de entidad». Se añadió una cabecera que
  dice qué cuatro casos crecen (los que miran el presente), cuáles son fotos históricas y **por qué
  siguen siendo literales**.
- **Mutación** (quitar los dos valores de las cuatro listas) → **ROJO en los cuatro**:

```
 FAIL  … (R52) > `NotificacionEvento` del schema gana el valor y sigue siendo un inventario CERRADO
AssertionError: expected [ 'orden_rechazada', …(8) ] to deeply equal [ 'orden_rechazada', …(7) ]
+   "gasto_fijo_cobro_pendiente",
 FAIL  … (R52) > `NotificacionEntidadTipo` del schema, igual
AssertionError: expected [ 'orden', 'usuario', …(5) ] to deeply equal [ 'orden', 'usuario', …(4) ]
+   "gasto_fijo_cobro_dia",
 FAIL  … la base aplicada, y el DOWN ejercitado de verdad > la base tiene los NUEVE eventos, con el de esta ficha y los posteriores AL FINAL
AssertionError: expected [ 'orden_rechazada', …(8) ] to deeply equal [ 'orden_rechazada', …(7) ]
+   "gasto_fijo_cobro_pendiente",
 FAIL  … la base aplicada, y el DOWN ejercitado de verdad > y los SIETE tipos de entidad
AssertionError: expected [ 'orden', 'usuario', …(5) ] to deeply equal [ 'orden', 'usuario', …(4) ]
+   "gasto_fijo_cobro_dia",

 Test Files  1 failed (1)
      Tests  4 failed | 18 passed (22)
```

### 4 · `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts` (ficha 253)

- **Afirmaba:** los cuatro casos equivalentes a los de la 262 (los dos enums de `schema.prisma` y los
  dos de la base aplicada), con los nombres «la base tiene los **SEIS** eventos» y «y los **SEIS**
  tipos de entidad».
- **Afirma ahora:** los mismos cuatro con el valor de la 333 al final y con su motivo; nombres
  corregidos a «los **NUEVE** eventos» y «los **SIETE** tipos de entidad». Se actualizaron también
  los dos bloques `ACTUALIZADO EL …` para que digan quién amplió qué y cuándo (262, 271, 333) y para
  dejar por escrito que estas listas **siguen siendo literales a propósito**.
- **Mutación** (quitar los dos valores de las cuatro listas) → **ROJO en los cuatro**:

```
 FAIL  … > `NotificacionEvento` del schema gana el valor, y sigue siendo un inventario CERRADO
AssertionError: expected [ 'orden_rechazada', …(8) ] to deeply equal [ 'orden_rechazada', …(7) ]
+   "gasto_fijo_cobro_pendiente",
 FAIL  … > `NotificacionEntidadTipo` del schema, igual
AssertionError: expected [ 'orden', 'usuario', …(5) ] to deeply equal [ 'orden', 'usuario', …(4) ]
+   "gasto_fijo_cobro_dia",
 FAIL  … la base aplicada, y el down ejercitado de verdad > la base tiene los NUEVE eventos, con los nuevos al final y en orden de adicion
AssertionError: expected [ 'orden_rechazada', …(8) ] to deeply equal [ 'orden_rechazada', …(7) ]
+   "gasto_fijo_cobro_pendiente",
 FAIL  … la base aplicada, y el down ejercitado de verdad > y los SIETE tipos de entidad
AssertionError: expected [ 'orden', 'usuario', …(5) ] to deeply equal [ 'orden', 'usuario', …(4) ]
+   "gasto_fijo_cobro_dia",

 Test Files  1 failed (1)
      Tests  4 failed | 15 passed (19)
```

### 5 · `tests/integration/db/schema-drift-saneamiento.test.ts`

- **Afirmaba:** «el censo encuentra las **seis** tablas cuyo `CREATE TABLE` le puso default a
  `updated_at`» — `api_key`, `gasto_fijo_plantilla`, `jobs`, `premio_ranking`, `ruta_optimizada`,
  `webhook_suscripcion`.
- **Afirma ahora:** «el censo encuentra las **SIETE**…», con `gasto_fijo_cobro` en su sitio del orden
  alfabético y el motivo al lado: su `CREATE TABLE`
  (`20260829120000_gasto_fijo_cobro/migration.sql:96`) escribe
  `"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, así que **cae sola en el censo**;
  el modelo `GastoFijoCobro` lo declara con `@default(now())` y por eso el caso siguiente («cada una
  de esas tablas declara `@default(now())`») sigue verde y `migrate dev` no propondrá un
  `DROP DEFAULT` sobre ella.
- **Aquí está la única mitad derivada, y es correcta:** la lista de la **izquierda** la deriva
  `tablasConDefaultEnUpdatedAt()` recorriendo `db/migrations/**`; la de la **derecha** la escribe una
  persona. Son fuentes distintas, así que la comparación mide algo. Se añadió una nota que lo dice y
  advierte de que derivar las dos de la misma fuente dejaría el caso verde por construcción.
- **Mutación** (quitar `"gasto_fijo_cobro"` de la lista literal) → **ROJO**:

```
 FAIL  tests/integration/db/schema-drift-saneamiento.test.ts > updated_at · el modelo declara el DEFAULT que el SQL creo > el censo encuentra las SIETE tablas cuyo CREATE TABLE le puso default a updated_at
AssertionError: expected [ 'api_key', 'gasto_fijo_cobro', …(5) ] to deeply equal [ 'api_key', …(5) ]

- Expected
+ Received

    "api_key",
+   "gasto_fijo_cobro",
    "gasto_fijo_plantilla",
    "jobs",
    "premio_ranking",
    "ruta_optimizada",
    "webhook_suscripcion",

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

### Verificación de los cinco, junta

Antes de tocar nada, con la 333 ya commiteada, los cinco estaban rojos: **11 casos fallando de 79**.
Después:

```
$ pnpm exec vitest run tests/integration/db/no-migration-102.test.ts \
    tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts \
    tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts \
    tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts \
    tests/integration/db/schema-drift-saneamiento.test.ts

 Test Files  5 passed (5)
      Tests  79 passed (79)
   Duration  874ms
```

**79 pasados, 0 saltados, 0 fallidos.** Los casos que hablan con Postgres **corrieron de verdad**, no
se saltaron: con `--reporter=verbose` aparecen con tiempos de consulta reales (172–175 ms los tres
«la base tiene los NUEVE eventos», 21–32 ms los «se puede ESCRIBIR de verdad») y no hay ni un `skip`
en la salida. Y las cinco mutaciones de arriba lo confirman por el otro lado: cada censo enrojece
cuando se le quita el valor nuevo, o sea que **ninguno estaba verde por vacío**.

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida)                       exit 0

$ pnpm exec eslint <los cinco archivos>
(sin salida)                       exit 0
```

**Veredicto:** los cinco censos siguen siendo inventarios cerrados, ahora con el valor de la 333
declarado a mano y con su motivo; ninguno se relajó, ninguno se dejó rojo y ningún `down.sql` se
tocó.

---

## Repaso a mano (I3) — 2026-08-29, navegador real, dos roles y dos temas

Hecho por el leader tras el gate verde. Con Playwright sobre `pnpm dev` en local, sembrando **tres
cobros pendientes** en la base local para ver la sección con datos de verdad (borrados al terminar:
0 cobros y 0 plantillas al cerrar).

**LA COMPROBACIÓN QUE IMPORTABA — la excepción a la paridad de la ficha 94, en la app real:**

| rol | ve la sección | botones `Aprobar` | botones `Rechazar` |
|---|---|---|---|
| `admin` | sí, «3 por aprobar» | **0** | **0** |
| `maestro` | sí, «3 por aprobar» | **3** | **3** |

Es la decisión del humano del 2026-08-29 funcionando de punta a punta, no un test de render con un
doble. Cero errores de navegador en las tres sesiones.

**Presentación.** La sección va entre la tarjeta de la caja y la del libro, con `Badge` de conteo a
la derecha del título y `DataTable` con Concepto / Período / Monto / Generado el / Acciones. El texto
de apoyo —«Nadie los cobró todavía: el dinero sigue en la caja y esperan tu decisión.»— dice en una
línea qué está en juego. **Verificada en modo CLARO y OSCURO**: en los dos se lee, el `Badge` mantiene
contraste y `Aprobar` (relleno) domina sobre `Rechazar` (contorno), que es la jerarquía correcta.

**UN SUSTO QUE NO ERA UN DEFECTO, anotado para que nadie lo repita.** La columna «Generado el» mostró
«30 de agosto de 2026» mientras la cabecera decía 29/08/2026, lo que parecía un desfase UTC↔CR de los
que este repo ya ha pagado caros. **No lo es, y se comprobó en vez de suponerse:** el servicio escribe
`generadoEl` con `fechaCalendarioCR(now)` (`GeneracionGastosFijosService.ts:111`) y la pantalla lo
pinta desde una cadena `YYYY-MM-DD`, sin zona horaria de por medio. El desfase lo introdujo **la
semilla del repaso**, que escribió `new Date()` en crudo y Prisma truncó al día **UTC** en una columna
`@db.Date`. Lección para el próximo que siembre datos a mano contra esta tabla: usa el día calendario
CR, o te fabricas un falso positivo.

**Otro tropiezo del entorno, por si vuelve a pasar.** El primer intento dio `500` en `/login`: había
un `next dev` ANTERIOR vivo en el puerto 3000 —con un cliente Prisma previo a la migración, o sea sin
la tabla nueva— y el servidor recién levantado se había ido al 3001. El síntoma es idéntico al de un
cliente rancio; la causa era un servidor viejo que no murió al pararlo.

**Límite declarado.** No se ejercitó `Aprobar` ni `Rechazar` a través de la pantalla: eso está cubierto
por los tests de integración contra Postgres (incluida la concurrencia). Lo que este repaso añade es lo
que ningún test veía: que la sección **existe, se encuentra, se lee en los dos temas y ofrece los
botones exactamente a quien debe**.
