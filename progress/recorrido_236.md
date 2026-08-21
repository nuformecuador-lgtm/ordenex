# T7.7 — Ver la app: el recorrido de la feature 236, anotado

> **Hecho el 2026-08-19 por el leader**, entrando como `adminTienda` —con su OTP, leído del log del
> dev server— y conduciendo Chromium con Playwright. Es **lo que se vio en pantalla**, con el texto
> leído del navegador.

---

## 1 · Las tres pestañas, y el subtítulo que ya no miente

```
[ Ayuda solicitada ]  [ En devolución ]  [ Rechazadas por plazo vencido ]
     ↑ seleccionada por defecto

Novedades
Las órdenes en las que tus mensajeros piden ayuda, tus órdenes en devolución y
las que llegaron a rechazo por vencerse el plazo
```

- La pestaña de ayuda existe, se llama **«Ayuda solicitada»** y va **primera**, como se firmó (D6).
- El subtítulo **nombra las tres superficies**. Antes decía sólo «Tus órdenes en devolución y las que
  llegaron a rechazo por vencerse el plazo», y desde la 235 eso era **falso** para las órdenes en
  ayuda que caían en esa lista.

## 2 · La card

```
Guía 990002   ·  Esperando tu respuesta  ·
Diego Mora · Cafetera · Intentos: 1
Alajuela · Tambor
COBRAR ₡0
Intentos de contacto: 0
```

El chip dice **«Esperando tu respuesta»** (D6) y **no** pinta causa de devolución, que es lo que
correspondía: no hay ninguna.

Acciones sobre esa card, censadas por su nombre accesible:

| acción | ¿está? |
| --- | --- |
| Llamar / WhatsApp | sí |
| **Habilitar la orden de …** | sí |
| **Abrir la conversación de la orden de …** | **sí — es la que no existía** |
| Registrar un intento de contacto | sí |

## 3 · Lo que la ficha vino a arreglar: **la tienda lee el motivo**

Pulsando «Abrir la conversación»:

```
Notas de la orden
Conversación sobre la orden de Karla Vargas.

Notas con el mensajero

Marco · 19 ago 2026, 2:38 p. m.
El portón está cerrado y nadie contesta. ¿Confirman si dejo el paquete con el vecino?

Tania · Vos · 19 ago 2026, 2:39 p. m.
Confirmado: dejalo con el vecino del portón azul, ya avisamos.

[Escribí una nota  0/200]  [Publicar nota]  [Cerrar]
```

**Eso es exactamente lo que hasta hoy era imposible.** Y hay un detalle que lo hace más elocuente:
esas dos notas **ya estaban ahí** —las escribió el recorrido de la 235— y **nadie podía verlas**. El
hilo llevaba días con contenido y sin lector.

## 4 · Responder **sin rescatar** la orden (D4)

Se escribió desde la card, sin pulsar «Habilitar», y la nota entró:

```
Tania · Vos · 19 ago 2026, 9:56 p. m.
Confirmado: la direccion correcta es 200 m sur del parque. Segui con esa.
```

La orden **sigue en ayuda**. Es lo que D4 firmó, y no es permiso nuevo: R34 de la 235 ya había puesto
`ayuda_tienda` en la ventana de escritura de los dos roles; lo que faltaba era la superficie.

## 5 · El corte del servidor, visto desde el cliente

Cambiando a «En devolución» con tres órdenes en ayuda vivas:

```
¿aparece Karla Vargas (que está en AYUDA)?:  false
lo que sí aparece:  Guía 990004 · Cliente no localizado · Andres Chaves
```

**Una orden vive en una sola pestaña.** No es disciplina de la pantalla: el predicado sale de una
declaración única y `count` y `find` lo comparten por construcción.

## 6 · El estado vacío — el primero que la tienda va a conocer

Medido a propósito, porque `progress/medicion_236.md` dice que en producción hay **0 órdenes en
`ayuda_tienda` y 0 en `devuelta`**: la pestaña **nace vacía** y lo estará un tiempo.

```
Ningún mensajero te pidió ayuda

Cuando un mensajero necesite que resuelvas algo de una orden que lleva encima,
aparecerá acá con su mensaje.
```

Es **una superficie de pleno derecho**, no un `null`: dice qué falta y qué va a pasar cuando ocurra.
Y los controles que no aplican —«Descargar», «Mosaico/Detalle»— **no se pintan**, así que no hay
botones que no hagan nada.

## 7 · Lo que NO se pudo ver aquí

- **La descarga por pestaña (D3)** no se ejercitó desde el navegador: el sandbox bloquea las
  descargas que la propia página inicia. Queda cubierta por sus tests, y **anotada como pendiente de
  mirar con los ojos** la primera vez que alguien la use de verdad.
- **D8** —que «Habilitar» deje de afirmar que habilitó cuando no movió nada— necesita **ganar la
  carrera** contra el mensajero para verse, y eso no se reproduce a mano de forma fiable. Sus dos
  caminos están cubiertos por test; lo que se vio aquí es el camino normal.

## 8 · Estado de la base local al terminar

Tres órdenes de la tienda QA quedaron en `ayuda_tienda` con nota en su hilo, y hay **6 notas vivas**
(las de este recorrido más las que dejó el de la 235). Es base **local**; producción no se tocó — lo
único que se hizo contra ella fue la **lectura** de `progress/medicion_236.md`.
