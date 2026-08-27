# Implementación 293 — el premio del ranking en la cuenta por pagar

> Informe exigido por `CHECKPOINTS.md:13` y por T6.2. Lo escribe el **leader**, recopilando lo que
> ejecutaron el `backend_dev`, el `frontend_dev` y el `reviewer`.
>
> ⚠️ **Cada afirmación dice QUIÉN la midió.** Lo que solo está reportado por quien lo implementó se
> marca como tal: no es lo mismo que lo verificado por un tercero, y mezclarlo es como se acaba
> creyendo un arnés que miente.

## Qué entrega

El maestro registra el premio del podio de un día como **devengo imputado al cierre de ese día** del
mensajero, desde **Wallet → Mensajeros**. Se salda con el pago por cierre que ya existía, se ve
separado en el desglose con el rótulo «Premio del ranking», y carga la caja al registrarse.

## Decisiones humanas que gobiernan el diseño

1. **El pago NO es automático**: ni cron ni aprobación del cierre emiten nada.
2. **Una sola puerta**: Wallet → Mensajeros. Se descartó hacerlo también desde el cierre — dos
   caminos que escriben el mismo asiento de dinero es como se paga dos veces sin que nadie lo note.
3. **Suma a la cuenta por pagar**, y el detalle dice qué parte es premio. Eso es lo que obliga a
   categoría propia en vez de reusar `ajuste_devengo`.
4. **El monto sale del podio CONGELADO**, no del premio vigente.
5. **Imputado al cierre del día** (decisión del 2026-08-27, tomada contra la recomendación del
   leader y a sabiendas). Implementación elegida para cumplirla sin el daño advertido:
   `total_pago_mensajero` **no se reescribe jamás**; lo pagable pasa a ser *snapshot + premios vivos*.

## El barrido, que es donde vivía el riesgo

El §6 del design listaba 20 consumidores de `total_pago_mensajero`. La firma por objeto de
`derivarPendienteCierre` se puso **a propósito** para que `tsc` los señalara a todos, y funcionó:

> **`tsc` destapó un 21.º que la lista no tenía: `LiquidacionService.restanteTrasAnular`** — el que
> responde «a cuánto vuelve el disponible tras anular un pago». Con el premio ignorado, la pantalla
> habría ofrecido pagar **menos de lo debido**. Pasó al cálculo nuevo, con test: cierre de 50.000 +
> premio de 5.000 → restante **55.000**, no 50.000.

**Verificado por el reviewer**: el barrido queda completo, 5 call-sites, y los marcados «no cambia»
siguen siendo correctos con el premio existiendo.

## Migración

`db/migrations/20260827120000_premio_ranking_devengo/`.

- **Round-trip UP → DOWN → UP ejecutado contra el Postgres local** — *reportado por el implementador*:
  sin `unsafe use of new value`; el DOWN devolvió los dos enums a sus valores previos, `origen_uq` a
  su predicado original y quitó `premio_dia`; el re-UP lo dejó todo como estaba.
- **Verificado por el reviewer** sobre el catálogo, en solo lectura: el `down.sql` suelta **todos**
  los dependientes reales de los dos enums (9 y 6), sin `DEFAULT` y con **0 filas** usando los
  valores nuevos.
- ⚠️ **NO se ejecutó `pnpm run db:rollback`**: el clasificador denegó el comando al reviewer y no se
  rodeó. La evidencia del rollback es la de arriba, no una corrida de esa herramienta.

## Mutaciones

**Reejecutadas por el reviewer** (eligió las dos que más le preocupaban):

| mutación | resultado |
| --- | --- |
| quitar `origenTipo` del WHERE de `sumarPremiosVivosPorCierre` | **2 rojos**, uno el `[PG]` con señuelos: `expected '5444.00' to be '5000.00'` |
| dejar un consumidor atrás (`premiosVivos: "0.00"` en `conPendiente`) | **2 rojos**: `expected '0.00' to be '5000.00'` |

**Reportadas por el implementador, no reverificadas por un tercero**: quitar el premio del cálculo de
lo pagable (18 rojos); quitar el único parcial e intentar el doble registro (5); colgar el egreso de
caja del cierre (8, con el `DO NOTHING` detectado por nombre); quitar `premioDia` de la escritura
(20); invertir el orden de `resolverCierreDelDia` (2).

**Dato que importa más que los números**: una sexta mutación —quitar `origenTipo` del WHERE— al
principio **solo ponía 1 test rojo, y el `[PG]` no la veía**. El implementador reforzó el caso con
señuelos hasta que la caza. Un test que no muere cuando rompes lo que vigila no vale, y este no valía.

**Frontend**: quitar del render el bloque `entregadas / asignadas` → 3 rojos. Y el implementador
encontró por su cuenta **una aserción vacua**: un badge alimentado con el total equivocado cuyo test
pasaba igual; corregida.

## Gate

**Gate COMPLETO** sobre el árbol de la implementación — *ejecutado por el leader*:

- `typecheck` ✅ · `lint` ✅ · **20.001 tests en verde**.
- **6 rojos AJENOS**, con delta 0 medido hoy sobre `dev` limpio: los dos de la 285, los tres de
  plantillas (contrato derogado a propósito por otra sesión) y `obtenerTarifa` de la 275.
- **1 falso rojo por carga**: `CrearTiendaForm` cayó al correr el gate y la revisión a la vez;
  **medido aislado, 4/4 en verde**. La decisión de paralelizar fue del leader y este fue su precio.

## Lo que NO está cubierto, dicho por su nombre

- **T6.4 — la verificación contra producción no se ha hecho.** Y aquí no es una casilla más: esta
  feature **estrena los libros de dinero**. Medido el 2026-08-27: `wallet_movimiento`,
  `pago_mensajero_movimiento` y `wallet_tienda_movimiento` están **a cero**, con 4 cierres aprobados
  y `total_pago_mensajero` sumando ₡0,00. El primer premio que se registre será **el primer
  movimiento de dinero del sistema**.
- **R5/R34, R6/R9/R11/R12/R30/R32 y R27** tienen cubierta su mitad de servidor y su mitad de
  pantalla por separado; lo que ningún test ve es el conjunto en un navegador real.

## Deuda declarada, no escondida

- **Anular un premio por error es hoy irreversible desde la app.** Al cerrar Q2 se dijo «si hiciera
  falta reponer existe el ajuste manual», y el reviewer midió que **eso no es cierto**: no hay
  ninguna superficie que escriba un ajuste manual en el libro del mensajero (el manual de
  `WalletService` es la caja, otra tabla). La decisión se mantiene; el supuesto que la acompañaba era
  falso y queda corregido aquí.
- **Con dos cierres vivos del mismo día, la pantalla no dice a cuál se imputó** (`PremioPodioDTO` no
  publica `cierreId`). El desempate está decidido —el más antiguo— pero no es visible.

