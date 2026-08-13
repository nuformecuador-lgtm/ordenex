# Feature 206 — vista en pantalla (2026-08-13)

El PR #369 la cerró con 19 casos, y dejó un hueco declarado: **el alcance agrupado no se había
visto**, porque exige un reparto con **dos o más imputaciones vivas** y la base local solo tenía un
cierre con pendiente. Este documento cierra ese hueco y deja la receta, que costó más que el
arreglo.

## Lo que se vio, citando la pantalla

**La previsualización del reparto sobre DOS cierres:**

```
Cierre del 2026-08-13 · Se aplica ₡3.400,00 · Pendiente hoy: ₡3.400,00 · Queda pendiente: ₡0,00
Cierre del 2026-08-13 · Pago parcial · Se aplica ₡600,00 · Pendiente hoy: ₡1.700,00 · Queda pendiente: ₡1.100,00
```

**El diálogo con el alcance**, que es lo que no existía antes de la 206:

```
Qué se anula
  Este pago se repartió entre varios cierres. Anular el reparto completo deshace todas sus
  imputaciones con este mismo motivo, en un solo acto.
  (•) Solo este pago          ← marcada por defecto
  ( ) Todas las imputaciones de este reparto
```

Al elegir el grupo, el botón pasa de «Anular pago» a **«Anular el reparto»**: dice qué va a pasar.

**El efecto, medido en la base:** el reparto de ₡4.000 pasó de **2 imputaciones vigentes a 0**, con
**una anulación por imputación y el mismo motivo en las dos** — que es literalmente «un acto, un
motivo».

## LA RECETA, porque montar el caso no es trivial

El reparto produce **N imputaciones solo si hay N cierres con pendiente**, y el monto tiene que
**exceder el pendiente del primero**. Con un solo cierre pendiente, la acción agrupada no es
alcanzable ni existiendo el código.

Para conseguir el segundo cierre, la cadena que funcionó:

1. **Disparar el cron de reprogramadas** — devolvió 2 órdenes a `en_bodega_central`:
   `GET /api/cron/liberar-reprogramadas` con `Authorization: Bearer $CRON_SECRET` (el secreto está
   en el `.env` local). **Es `GET`, no `POST`: con POST responde 405.**
2. De las dos liberadas, **solo una era asignable**: la otra no tiene lat/lon y el gate de la
   feature 92 **aborta el lote entero** si una sola falla.
3. Asignar → recoger → **entregar cobrando por SINPE** (para que el efectivo quede en 0 y
   `min(P,E)` deje pendiente) → solicitar cierre → aprobarlo como admin.
4. Con dos pendientes (₡3.400 y ₡1.700), un pago de **₡4.000** se reparte obligatoriamente entre
   los dos.

Las tres trampas de conducir el panel del mensajero siguen vigentes y están en la memoria de
sesión: **hace falta permiso de geolocalización** (sin él no sale ni un POST), **la foto de
evidencia es obligatoria**, y la casilla de la tabla es un `[role="checkbox"]`.

## Lo que sigue sin verse, y no es de esta ficha

El **aviso de excluidos** de la 205: necesita un cierre que NO se pueda imputar. Con todos los
cierres aprobados e imputables, no es alcanzable.
