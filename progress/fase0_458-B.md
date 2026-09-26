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
