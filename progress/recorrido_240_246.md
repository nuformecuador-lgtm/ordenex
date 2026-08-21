# Ver la app — el recorrido de las features 240 y 246

> **Hecho el 2026-08-20 por el leader**, con Playwright y los dos roles (`adminTienda` con su OTP y
> `admin`). Es lo que se vio en pantalla, con el texto leído del navegador.
> Las dos fichas se desarrollaron en paralelo sobre el mismo árbol, así que se recorren juntas.

---

## 240 · «Rechazar» deja de ser una maqueta

### Las acciones de la card de devolución, censadas por su nombre accesible

```
Llamar a Diego Mora
WhatsApp a Diego Mora
Reprogramar la orden de Diego Mora
Rechazar la orden de Diego Mora      ← NUEVA, y hace algo
```

| lo que había que comprobar | resultado |
| --- | --- |
| ¿sigue **«Habilitar»** en una card de devolución? | **NO** — el punto 12 del pedido, arreglado |
| ¿aparece **«Rechazar»**? | **sí** |
| ¿queda **«Devolver»**, la maqueta? | **NO** |

**Los tres defectos que la ficha vino a cerrar, cerrados y vistos.** «Habilitar» estaba justo donde
el pedido decía que no debía estar, y «Devolver» llevaba **desde el 2026-08-12** sin hacer nada.

### La ventana

```
Rechazar la orden

El paquete de Diego Mora (guía 990002) vuelve a tu bodega y la orden se cierra
como rechazada.

Esto le cobra a tu tienda el flete de devolución y no se puede deshacer.
Si preferís volver a intentar la entrega, usá «Reprogramar».

Motivo del rechazo
  Queda guardado con la orden: es lo único que explicará esta decisión si alguien
  pregunta más adelante.

Escribí el motivo para poder rechazar.
[Cancelar] [Rechazar ← deshabilitado]
```

Cuatro cosas que **no** son cosméticas:

- **Dice el precio sin inventar una cifra.** Nombra **el flete de devolución** —lo que la tienda
  paga— y **no** el `cobroRechazado`, que es ingreso de bodega. Esa confusión ya obligó a corregir el
  design de la 237. Y **no lleva número**: los ₡2.600 medidos son un **tope**, la tarifa varía por
  tienda y rige la **congelada**, así que un número fijo sería falso para casi todas.
- **Avisa de que no se puede deshacer**, que es cierto (D6) y es la clase de cosa que la gente
  descubre tarde.
- **Ofrece la alternativa**: «si preferís volver a intentar la entrega, usá Reprogramar». Un aviso que
  sólo prohíbe deja al usuario sin salida.
- **El bloqueo habla**: «Escribí el motivo para poder rechazar», con el botón muerto.

---

## 246 · elegir para qué día es la asignación

Seleccionando órdenes en `/ordenes` y abriendo «Asignar mensajero»:

```
Asignar mensajero
Asigna un mensajero a 2 orden(es) seleccionada(s) de bodega.

  QA-R-0013 · Intentos: 0
  QA-R-0012 · Intentos: 1

Selecciona un mensajero

Día de reparto
  Todo el lote queda para el día que elijas. Puedes cambiarlo antes de asignar.

  ( • ) Hoy · 20 de agosto          ← aria-checked = true
  (   ) Mañana · 21 de agosto
```

- **El selector existe y su defecto es «Hoy»**, explícito y marcado — no un vacío que el servidor
  interprete. Un defecto que asignara «para mañana» sin querer sería peor que el problema que la
  ficha arregla.
- **Las dos opciones muestran la FECHA CONCRETA** («20 de agosto», «21 de agosto»), no sólo la
  palabra. Es la decisión D1/D2 —fecha absoluta, no una marca— **hecha visible**: quien asigna ve
  exactamente qué día está eligiendo.
- **Las fechas las resuelve el servidor**, no el navegador. Importa: el día se corta a medianoche de
  **Costa Rica**, y un reloj de navegador en otro huso habría dado un día distinto sin avisar. Hay
  test y mutación propios para eso.
- **El rótulo explica el alcance**: «todo el lote queda para el día que elijas», que es la pregunta
  que se hace quien marca veinte casillas.

---

## Lo que NO se recorrió, y se dice

- **El paso completo de la 240** —rechazar de verdad y ver el ingreso de bodega— **no se ejecutó**:
  quedó en la ventana. Sus dos caminos están cubiertos por test, y la propiedad hermana **sí se
  verificó contra Postgres en la 237** (una gestión registrada por la tienda con `mensajero_id` del
  mensajero y ₡1.000 de ingreso de bodega en su cierre), que es el mismo mecanismo.
- **El corte nocturno respetando el día de mañana** no se puede provocar a mano sin esperar al cron o
  invocarlo. Está cubierto por tests, incluida la mutación del ancla —el punto donde la ficha se
  rompía sola— pero **no se ha visto con los ojos**.

Las dos ausencias quedan **nombradas y no disimuladas**: en esta pila, «ver la app» ha encontrado un
cierre imposible de aprobar, dos defectos de card y un botón que siempre fallaba. Lo que no se mira,
no está verificado.

## Estado de la base local

Se puso el cobro por rechazo de las tarifas locales en ₡1.000 (estaba en 0) y quedan órdenes de la
tienda QA repartidas entre `ayuda_tienda`, `devuelta` y `rechazada`. Es base **local**; contra
producción sólo se hicieron **lecturas**.
