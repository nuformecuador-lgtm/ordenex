# Decisión ⟨P4⟩ — autorización para tocar `lib/analytics/metrics.ts` desde la feature 173

**Fecha: 2026-08-03 · Autor: humano · Estado: CERRADA.**

## Por qué hace falta este documento

`lib/analytics/metrics.ts` es **el catálogo de la 135 y fuente única de trece features**. La 127
dejó la norma escrita al cerrarse: cada cambio en ese archivo necesita **autorización humana
fechada**, y **esa autorización NO se hereda** — la siguiente feature que lo necesite necesita la
suya. Precedente y formato: `progress/decision_C2_127.md`.

La 173 es esa siguiente feature. Este documento **es** su autorización.

## El problema

Al emitirse por primera vez `egreso_pago_tienda` (Tanda C), la métrica **`egresos`** empieza a
incluir el dinero devuelto a las tiendas. **Su id y su nombre no cambian; su número, sí.** Quien
compare mes contra mes vería un salto que no es un salto.

Y el tablero no tendría la cifra que motivó la feature: «cuánto dinero hay en caja» separado de
«cuánto ganó Ordenex».

## La decisión — respuesta **P4 = (a)**, dada en la puerta de aprobación del 2026-08-03

**Se amplía el catálogo, dentro de la 173 y no diferido a la 175**, con **exactamente tres cosas**:

1. La **descripción** de `egresos` pasa a decir que ahora incluye los pagos a tiendas. Su `id` y su
   nombre **no** cambian.
2. Nace **`dinero_en_caja`** (tesorería: todo lo que entra y sale).
3. Nace **`ganancia_ordenex`** (resultado: lo que Ordenex gana — el mismo número que hoy se llama
   «Balance general»).

Las dos nuevas con `fuente: ledger / wallet_movimiento` y el alcance de las financieras;
`IDS_FINANCIERAS_SERVIDAS` pasa a **10**.

**El motivo de que sea la 173 y no la 175:** el cambio de significado **lo causa esta feature**.
Diferirlo dejaría a `egresos` cambiando de número sin que nada lo declare, que es justo el modo de
fallo que P4 existía para evitar.

## Lo que esta autorización NO cubre

- **NO** se añade `ingreso_ajuste` a `definicion.categorias` de `egresos`. Eso **cambiaría el número
  de una métrica de dinero ya publicada** y es territorio de la **175** (ver el hallazgo del
  `neto`/`bruto` en `progress/impl_173-caja-tesoreria.md` §H7/§H10 y en la ficha de la 175).
- **NO** se parte `egresos` en dos ids. Fue la opción (c) de P4 y el humano no la eligió: cambiar el
  número detrás de un id existente es la peor variante, porque los ids son la clave de las pantallas
  132/134.
- **NO** se tocan las métricas de la 126 ni las tres divergencias que ya tiene dirigidas la 175.

## Alcance verificable

El diff de la 173 sobre `lib/analytics/metrics.ts` debe ser **exactamente** los tres puntos de
arriba. Cualquier otra línea de ese archivo en el diff **está fuera de esta autorización** y el
review debe rechazarla.
