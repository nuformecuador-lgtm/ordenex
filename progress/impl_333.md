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
