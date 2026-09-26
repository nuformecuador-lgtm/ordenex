# 458-B — Fase 0 (TB.1): fotografías y mutaciones

Árbol: `feature/458-B` = `origin/dev` @ `752e40df` + solo los tests de este documento. Base:
clon `ordenex_458b`.

## 1. Las fotografías existentes, verdes ANTES de tocar nada

```
pnpm exec vitest run tests/integration/db/caja-caracterizacion-459.test.ts tests/integration/db/caja-invariante-tiendas.test.ts
 Test Files  2 passed (2)
      Tests  27 passed (27)        ← 0 skipped
```

## 2. La fotografía nueva: `tests/integration/db/wallet-caracterizacion-458.test.ts`

Escenario `tests/integration/db/_fixtures/wallet-458.ts`: tienda C y mensajero M con seis filas a mano
cada uno (instantes fijos, dos pares del mismo instante: uno que desempata el id y otro que SOLO
desempata el `created_at`), cada fila de la tienda con su contrapartida en la caja; un pago de un
gasto de la tienda C por el servicio REAL; bodega Z con tres consolidaciones (una rechazada).
Literales a mano en los comentarios del test.

```
pnpm exec vitest run tests/integration/db/wallet-caracterizacion-458.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)          ← 0 skipped
```

## 3. Mutaciones medibles HOY, con autocomprobación

Arnés (script de un solo uso, fuera del repo): por cada mutación (1) exige que el patrón aparezca
EXACTAMENTE una vez, (2) comprueba que el archivo cambió, (3) corre SOLO la fotografía con reporter
JSON y exige `numTotalTests > 0`, (4) restaura el original byte a byte y comprueba que es idéntico.

| Mutación | Archivo | Tests | Rojos (nombre del caso) |
| --- | --- | --- | --- |
| **M1 hoy** — invertir el signo del saldo de la tienda (`cred.sub(deb)` → `deb.sub(cred)`) | `lib/utils/saldo-tienda.ts` | 6 | «R84: saldo y desglose de la tienda C»; «R91 (R8): «De las tiendas» del escenario = saldo de la tienda C» |
| **Control positivo** — quitar `emitirEgresoDePagoPorCuenta` | `lib/services/PagoPorCuentaTiendaService.ts` | 6 | «R85/R91: la caja del escenario…»; «R91 (R8)…» |
| **Bodega** — el pendiente cuenta las consolidaciones rechazadas (`NO_RECHAZADAS = {}`) | `lib/repositories/SaldosSatelitesRepository.ts` | 6 | «R84: pendiente de la bodega Z (la consolidacion rechazada no cuenta)» |

Las tres: `aplicado=true`, `restaurado=true`. `git diff --stat` al terminar: **vacío**.

**M2 y M12 de §8.2** (quitar `created_at` del `ORDER BY` de la ventana; totales del periodo sin
excluir el par anulado) apuntan a código que HOY no existe: la ventana del saldo corrido y los
totales netos nacen en TB.6 (`EstadoCuentaRepository`/`EstadoCuentaService`). La fotografía ya trae
los empates que las harán medibles (pares c1/c2 y c3/c4, m1/m2 y m3/m4); se miden en TB.6 y otra vez
en TB.15, en el anexo de este documento.

## Anexo TB.15 — la fase 0 repetida sobre el árbol FINAL (`9708560b`)

Mismo arnés con autocomprobación (patrón exactamente una vez, archivo cambiado, `numTotalTests > 0`,
restauración byte a byte). Primero contra las TRES fotografías juntas
(`caja-caracterizacion-459`, `caja-invariante-tiendas`, `wallet-caracterizacion-458`: 45 tests); las
que las fotografías no pueden ver por construcción, además contra su test dedicado.

| # §8.2 | Mutación | Fotografías | Test dedicado | Rojo (caso) |
| --- | --- | --- | --- | --- |
| 1 | signo del saldo corrido al revés (tienda) | **4/45** | — | 458 «TB.6 R20», «TB.6 R16» |
| 2 | sin `created_at` en el `ORDER BY` de la ventana (tienda) | **3/45** | — | 458 «TB.6 R20», «TB.6 R16» |
| 2b | ídem, mensajero | **1/45** | — | 458 «TB.6 R20» |
| 3 | quitar la cuenta del `WHERE` de `cierresDeLaCuenta` | — | — | **No aplica en 458-B**: `cierresDeLaCuenta` es de la 458-A (`FiltrosWalletService`) y no existe en este árbol |
| 4 | `egreso_reverso_flete_devolucion` como `efectivo` | **4/45** | — | 459 fase 0 |
| 5 | `flete_devolucion_anulado` en `cargos` | **1/45** | — | 459 fase 0 |
| 6 | anular el rechazo sin el crédito de la tienda | **5/45** | — | 459 fase 0 |
| 7 | reverso del flete con otro monto (el del IVA) | **4/45** | — | 459 fase 0 |
| 7b | contra-asiento del egreso con un monto que no es el del original | **1/45** | — | 459/461 «R7 y R8 al céntimo tras cada camino» |
| 8 | constancia del egreso sin `skipDuplicates` | 0/45 | **1/2** | «R67: dos anulaciones a la vez dejan UN solo juego» |
| 8b | constancia del rechazo sin `skipDuplicates` | 0/45 | **1/2** | ídem |
| 9 | `EFECTO_POR_TIPO` del aporte sin la línea de capital | 0/45 | **3/19** | «Así queda predice lo que queda R44/R50», «R45» |
| 10 | `tipoDeDocumentoOriginal` sin `rechazo_tienda_cobro` | 0/45 | **1/10** | «la anulación uniforme por las actions» |
| 11 | `LectoresDocumentosCaja.egresos` que no mira la base | 0/45 | **2/10** | ídem |
| 12 | totales del periodo sin excluir el par anulado | **4/45** | — | 458 «TB.6 R20», «TB.6 R16» |

Todas `aplicado=true`, `restaurado=true`; `git status` sin cambios tras el lote.

**Por qué 8–11 no las ve la fotografía, y no es un hueco:** las fotografías miden IMPORTES. La 8 es una
carrera (dos transacciones a la vez; una fotografía secuencial no la puede provocar), la 9 no escribe
(es la previsualización), la 10 y la 11 cambian si una fila OFRECE «Anular…» o se pinta anulada, no
cuánto dinero hay. Las cinco caen en su test dedicado contra Postgres, que es donde viven. Se deja
anotado en vez de meter en la fotografía de la 459 aserciones de otra naturaleza (la fotografía solo
cambia en el bloque «a propósito» que dice el spec).

**Fotografías sin mutar, sobre el árbol final:** `3 passed (3)`, `45 passed (45)`, 0 skipped.
