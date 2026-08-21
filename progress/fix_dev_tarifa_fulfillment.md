# fix — el doble de tarifa sin `fulfillment` (rojo heredado de `dev`)

Rama `feature/238-confirmacion-fisica-cierre`, sobre `54c4ed6d`. **Sin commit.**

## 1. Diagnostico contrastado — COINCIDO

Los tres tests money-critical de la feature 69 en
`tests/integration/db/cierre-detail-congelado.test.ts` morian con
`TypeError: Cannot read properties of undefined (reading 'toFixed')` en
`lib/repositories/TarifaVigentePorTiendaRepository.ts:103`. Lo verificado, punto por punto:

**(a) El rojo ya estaba en `dev`, no lo trajo el merge.** No me quede en el diff: escribi el
fichero EXACTO de `origin/dev` a un path temporal y lo corri. Sale rojo solo, con la misma
traza y los mismos 3 casos:

```
 FAIL  tests/integration/db/tmp-dev-baseline.test.ts > Feature 69/R17 ... (y los otros 2)
TypeError: Cannot read properties of undefined (reading 'toFixed')
 > TarifaVigentePorTiendaRepository.resolveTarifasPorTiendas lib/repositories/TarifaVigentePorTiendaRepository.ts:103:36
 Test Files  1 failed (1)  |  Tests  3 failed (3)
```

(el temporal se borro; `git status` quedo limpio antes de tocar nada). El fuente de produccion
es blob-identico a `origin/dev` (`ec584e9f954a940fb32d55461119bc4e6ed839c4` en ambos) y el test
en `origin/dev` tiene 0 menciones de `fulfillment`: lo introdujo `891de8be` (branch `ux`), que
anadio `fulfillment` al `select` y al mapeo del batch y actualizo 2 dobles, pero no este.

**(b) NO hay ningun camino donde `fulfillment` pueda faltar de verdad.** Comprobaciones:

- `db/schema.prisma:1112` — `fulfillment Decimal @db.Decimal(12, 2)`: NOT NULL y **sin
  `@default`**. La migracion que creo la tabla lo confirma
  (`20260710120000_cobros/migration.sql:12`: `"fulfillment" DECIMAL(12,2) NOT NULL`) y ningun
  `ALTER TABLE "tarifas"` posterior la vuelve nullable.
- Sin default y NOT NULL, una fila creada sin el campo la rechaza Postgres al INSERT: no puede
  existir una fila leible sin valor. Ademas la escritura lo exige antes: `lib/types/tarifa.ts:24`
  lo pide con `montoSchema` en el zod de creacion, y `TarifaRepository.ts:46` lo escribe siempre.
- El unico lector es el batch, y su `select` lo pide explicitamente. El singular
  (`resolveTarifaPorTienda`) NO lo selecciona **ni lo lee**: usa `TARIFA_SELECT` y
  `toTarifaVigente`, que no lo mencionan. No hay un segundo `select` con el hueco.
- No hay `$queryRaw`/`$executeRaw` sobre `tarifas` en ningun sitio (grep vacio), asi que no hay
  una fila construida a mano que esquive la proyeccion.
- (Y si el cliente Prisma estuviera rancio, `select: { fulfillment: true }` daria un error de
  VALIDACION de Prisma, no un `undefined`.)

Conclusion: **el defecto esta en el doble, no en produccion.** No toque `lib/`.

## 2. Que cambie

Un solo fichero: `tests/integration/db/cierre-detail-congelado.test.ts` (+8/-0).

- `interface TarifaRow`: `+ fulfillment: Prisma.Decimal;`
- fila `ta1`: `+ fulfillment: dec("300.00"),`
- fila `ta2` (la tarifa "muy distinta" que se da de alta despues de solicitar):
  `+ fulfillment: dec("8000.00"),`

**Forma:** `dec()` es `new Prisma.Decimal(...)`, exactamente lo que usan los otros 7 campos
Decimal de ese mismo doble, y exactamente lo que devuelve Prisma para un `Decimal @db.Decimal`
— un objeto con `.toFixed`, que es lo que el mapeo consume. Es tambien la forma del doble
hermano que `891de8be` si actualizo
(`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts:31`:
`fulfillment: new Prisma.Decimal("300")`). No use `string` ni `number`: ninguno de los dos es
lo que llega en real.

**El doble no miente en los otros campos Decimal**: los 7 son `Prisma.Decimal` como en el
esquema. Dos divergencias menores, benignas y NO tocadas: `status` esta tipado `string` en vez
del enum `EstadoTarifa`, y `tarifa.findMany` del doble no honra el `select` (devuelve la fila
entera). Ninguna afecta al resultado, porque el mapeo construye el objeto de salida campo a
campo.

## 3. Barrido del resto del arbol (lo que dejo `891de8be`)

- **Instancias de la clase real del resolver contra un doble de Prisma:** solo dos en todo el
  arbol — este fichero (roto, arreglado) y
  `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` (ya actualizado por
  `891de8be`). No queda ningun tercero.
- **Dobles de la INTERFAZ `ITarifaVigentePorTiendaRepository`** que devuelven
  `TarifaVigenteResuelta`: el unico que construye el objeto completo es
  `cierre-dia-repository.test.ts` (`TARIFA_T1`), ya actualizado. El resto devuelve `new Map()`
  o `null` y no puede tener el hueco.
- **Dobles de fila de `cierre_detail` SIN `tarifaFulfillment`** — 9 ficheros:
  `wallet-idempotencia.test.ts`, `cierre-detalle-causa-monto.test.ts`,
  `cierre-dia-repository.test.ts`, `cierre-pagos-lectura.test.ts`,
  `cierres-bodega-admin-repository.test.ts`, `cierres-admin-service.test.ts`,
  `wallet-feed-service.test.ts`, `wallet-tienda-feed-service.test.ts`,
  `cierre-detalle.test.ts`. **Ninguno esta roto hoy** y NO los toque: el unico lector de esa
  columna es `toTarifaSnapshot` (`CierresAdminRepository.ts:199`), y los dos ficheros que SI
  pasan por ahi (`cierres-admin-repository.test.ts`, `cierres-gestiones-descarga-dto.test.ts`)
  ya lo traen. Los demas van por `tarifaDe`, que reconstruye los 7 campos de la formula y no
  mira `tarifaFulfillment`.
  **Anotado como deuda latente**: son 9 dobles que ya no coinciden con la fila real. El mas
  cercano al filo es `cierre-pagos-lectura.test.ts` — se salva solo porque su fixture fija
  `tarifaId: null` y `toTarifaSnapshot` corta antes; con un `tarifaId` no nulo reventaria igual
  que este. **No es de esta tanda.**

## 4. La mutacion: los 3 casos siguen teniendo dientes

Con el doble arreglado, dos mutaciones sobre `lib/services/WalletFeedService.ts` (aplicadas,
medidas y REVERTIDAS).

**M1 — el snapshot usa la tarifa VIGENTE en vez de la congelada** (`tarifa: tarifaDe(d)` ->
resolver en vivo por `d.tiendaId`). Mata los 2 casos de R18:

```
AssertionError: expected '7777.00' to be '1000.00' // Object.is equality
 > tests/integration/db/cierre-detail-congelado.test.ts:445  (ingreso_flete: sale ta2, la nueva)

AssertionError: expected undefined to be '1000.00' // Object.is equality
 > tests/integration/db/cierre-detail-congelado.test.ts:466  (R9/(c): sin tarifa viva -> nada)
 Tests  2 failed | 1 passed (3)
```

**M2 — el monto VIVO de la orden en vez del congelado.** R17 sobrevive a M1 porque su palanca
es la orden, no la tarifa; M2 lo mata con el descuadre exacto que la feature existe para evitar:

```
AssertionError: expected '4999.95' to be '500.00' // Object.is equality
 > tests/integration/db/cierre-detail-congelado.test.ts:392  (99999 * 5% en vez de 10000 * 5%)
 Tests  1 failed | 2 passed (3)
```

Los 3 casos mueren ante la regresion que vigilan. No quedaron verdes-pase-lo-que-pase.

### sha256

| fichero | antes | mutado | despues |
|---|---|---|---|
| `tests/integration/db/cierre-detail-congelado.test.ts` | `2b10b7bf...` (rojo) | — | `573ae6bf...` (verde) |
| `lib/services/WalletFeedService.ts` | `a2a92f86...` | M1 `4895bd03...` / M2 `748ac087...` | `a2a92f86...` (identico) |
| `lib/services/WalletTiendaFeedService.ts` | `5348ebaa...` | — | `5348ebaa...` (sin tocar) |

Completos:
- test antes `2b10b7bfb192ac4880216d56cb33c33e0e4ff5a1fb70b9c6333ee0327b7dc805`
- test despues `573ae6bf54666125c8ff242314843d63beeca7c53f5d775fc5b5f0ba61ce8b17`
- `WalletFeedService.ts` antes y despues `a2a92f86886edcf9e6aa850324d8f72cdcddeb6e40c67f9669eb314f8ad2de67`
- `WalletFeedService.ts` mutado M1 `4895bd03cdee9bfce55a3a4cca3826994de7b7da5405836de5d0260566c6ffbb`
- `WalletFeedService.ts` mutado M2 `748ac087b0afd32b4ef91eda94e2e1534571682651a10b403163231febbc51c7`

`git status` final: **solo** `M tests/integration/db/cierre-detail-congelado.test.ts`.

## 5. Salidas reales

```
$ npx vitest run tests/integration/db/cierre-detail-congelado.test.ts --reporter=verbose
 OK ... > Feature 69/R17 ... > los movimientos salen con los valores CONGELADOS y cuadran con los total_* del cierre 7ms
 OK ... > Feature 69/R18 ... > los movimientos salen con la tarifa CONGELADA, no con la vigente al aprobar 1ms
 OK ... > Feature 69/R18 ... > R9/(c): una tienda que se queda SIN tarifa vigente al aprobar sigue liquidando la congelada 1ms
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ npx tsc --noEmit
EXIT=0   (sin salida)

$ npx eslint tests/integration/db/cierre-detail-congelado.test.ts
EXIT=0   (sin salida)

$ npx vitest run tests/integration/db tests/unit/repositories
 Test Files  2 failed | 206 passed (208)
      Tests  2 failed | 2810 passed (2812)
```

Los 2 rojos que quedan NO son de este arreglo y NO los toque:

1. `orden-mensajero-meta-drop-nota-migration.test.ts` — la guardia de `down.sql`, en rojo por
   las **dos migraciones que trajo `dev`** (ya conocidas y decididas fuera de alcance):
   `expected [ '20260819120000_gestion_pagos_editados', '20260819140000_cierre_detail_tarifa_fulfillment' ] to deeply equal []`.
2. `analytics-daily-job.test.ts` — **ambiental, no codigo**:
   `PrismaClientKnownRequestError: The column (not available) does not exist in the current database`.
   La base local no tiene aplicadas las migraciones nuevas de `dev`; se cura con
   `prisma migrate deploy`, no con un cambio de fuente.

## Veredicto

El defecto era del doble, no de produccion: puesto al dia, los 3 casos money-critical de la
feature 69 vuelven a verde y siguen muriendo ante la regresion que vigilan.
