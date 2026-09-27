---
titulo: Rastrear un paquete
modulo: paquete
pantalla: /paquete/[numGuia]
roles: [publico]
actualizado: 2026-09-25
fuentes:
  - app/paquete/[numGuia]/page.tsx
  - app/_landing/RastreoDialog.tsx
  - lib/services/RastreoPublicoService.ts
  - components/shared/EstadoInfo.tsx
  - components/shared/nota-pendiente-confirmacion.ts
  - lib/types/order-status.ts
  - lib/config/devolucion-sla.ts
---

# Rastrear un paquete

La página pública donde **el cliente final** consulta su paquete. **No hace falta iniciar sesión**: se
entra con el enlace que lleva el número de guía.

Es el enlace que los mensajeros mandan por WhatsApp con la plantilla, y el que la tienda le pasa a su
cliente.

## Qué muestra

Los datos de esa entrega: **destinatario**, **teléfono**, **dirección**, **producto**, la **tienda** que
lo envía y el **monto a cobrar** si es contra entrega. Y la **ubicación**, cuando está registrada.

## Rastrear desde la página principal

En la página principal de Ordenex está el botón **Rastrear envío**. Pide el **número de guía** y los
**últimos 4 dígitos del teléfono** del destinatario, y muestra **en qué estado va el envío** y su
recorrido, con fecha y hora de Costa Rica.

Cada estado lleva un botón **(i)** que explica qué significa: se abre al pasar el puntero o al tocarlo
—en el teléfono, al tocar— y se cierra al tocar fuera. Es **el mismo texto** que ven la tienda, la
oficina y el mensajero en la aplicación.

**«Entregado · pendiente de confirmación».** Cuando el mensajero ya registró qué pasó, el cliente lo
ve al instante con esa nota (o con el resultado que sea: «Novedad · pendiente de confirmación»…). Quiere
decir que el mensajero ya lo registró y falta que se apruebe su cierre del día; al aprobarse, queda el
estado confirmado. Si el mensajero deshace la gestión, la nota desaparece.

## Qué significa cada estado

Son los textos del botón **(i)**:

| Estado | Qué significa |
| --- | --- |
| **Por recolectar en tienda** | El paquete está en la tienda y todavía no hay un mensajero asignado para recogerlo. |
| **Recolectando** | Ya hay un mensajero asignado y va camino a la tienda a recoger el paquete. |
| **En ruta a bodega central** | El mensajero recogió el paquete en la tienda y lo lleva a la bodega central. |
| **En preparación** | El paquete ya está en nuestra bodega y se está preparando su guía para despacharlo. |
| **En bodega central** | El paquete está en la bodega central, listo para asignarse a un mensajero o enviarse a una bodega satélite. |
| **En ruta a bodega satélite** | El paquete viaja desde la bodega central hacia la bodega satélite de su zona. |
| **En bodega satélite** | El paquete llegó a la bodega satélite de su zona y espera ser asignado a un mensajero. |
| **Mensajero recogiendo en la bodega** | El paquete ya tiene mensajero asignado, que debe recogerlo en la bodega para salir a reparto. |
| **En reparto** | El mensajero tiene el paquete y lo lleva al destinatario. Si ya lo gestionó, vas a ver el resultado como «pendiente de confirmación» hasta que se apruebe su cierre del día. |
| **Entregado** | El paquete fue entregado al destinatario y la bodega lo confirmó al aprobar el cierre del mensajero. |
| **Reprogramado** | No se pudo entregar y se acordó una nueva fecha. El paquete vuelve a su bodega para asignarse de nuevo. |
| **Novedad** | El mensajero no pudo entregar el paquete (cliente no localizado, número o dirección errados). La tienda debe decidir si se vuelve a intentar o se devuelve. Si no responde: con cliente no localizado, a las 24 horas vuelve a salir a reparto; con número o dirección errados, a los 5 días se devuelve a la tienda. Si ya agotó sus intentos, se devuelve antes. |
| **Novedad interna** | El mensajero terminó el día con el paquete encima y sin registrar qué pasó con él. Al aprobarse su cierre, el paquete vuelve a su bodega para asignarse de nuevo. |
| **Devolución a origen por rechazo** | El destinatario rechazó el paquete. Al aprobarse el cierre, empieza su regreso a la tienda. |
| **Incidente** | El paquete se dañó, se perdió o fue robado. Quedó reportado para su revisión. |
| **Por devolver a bodega central** | El paquete devuelto está en la bodega satélite, esperando ser enviado a la bodega central. |
| **Devolviendo a bodega central** | El paquete devuelto viaja de la bodega satélite a la bodega central. |
| **Por devolver a tienda** | El paquete devuelto está en la bodega central, esperando ser enviado a la tienda. |
| **Devolviendo a tienda** | El paquete va camino de regreso a la tienda. También pasa aquí cuando la tienda cancela el envío. |
| **Devuelta a tienda** | La tienda recibió de vuelta su paquete. Fin del recorrido. |

**Y la nota de ayuda**, que no es un estado: el mensajero pidió ayuda a la tienda con esta entrega. El
paquete sigue en reparto hasta que se registre su gestión.

## Por qué importa que sea pública

El cliente final no tiene cuenta en Ordenex ni debería necesitarla. Esta página existe para que pueda
confirmar que su paquete existe, que va a su dirección y cuánto le van a cobrar, sin llamar a nadie.

## Si un cliente dice que no le funciona

**Casi siempre es el número de guía.** El enlace lleva la guía dentro; si se copió cortado o se
escribió a mano con un dígito de más, no encuentra nada.

Lo más rápido es **volver a mandarle el enlace** desde la plantilla de WhatsApp, que lo arma solo con
la guía correcta.

## Lo que esta página NO hace

- **No se cambia nada desde acá.** Es solo de consulta. Una dirección mal puesta se corrige desde
  **Novedades**, del lado de la tienda.
- **La página del enlace no muestra el estado ni el recorrido.** El cliente ve los datos de su entrega;
  el estado y el recorrido están en **Rastrear envío**, en la página principal.
