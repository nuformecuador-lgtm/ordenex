# 456 — Textos del botón de información, APROBADOS por el humano (2026-09-23)

Insumo de la 456, no es su spec. Nombres definitivos de la 455; sin `devolucion_por_confirmar`
ni `ayuda_tienda` (los retira la 454). Mismo texto para todos los roles y el rastreo público.

| Estado | Texto |
|---|---|
| Por recolectar en tienda | El paquete está en la tienda y todavía no hay un mensajero asignado para recogerlo. |
| Recolectando | Ya hay un mensajero asignado y va camino a la tienda a recoger el paquete. |
| En ruta a bodega central | El mensajero recogió el paquete en la tienda y lo lleva a la bodega central. |
| En preparación | El paquete ya está en nuestra bodega y se está preparando su guía para despacharlo. |
| En bodega central | El paquete está en la bodega central, listo para asignarse a un mensajero o enviarse a una bodega satélite. |
| En ruta a bodega satélite | El paquete viaja desde la bodega central hacia la bodega satélite de su zona. |
| En bodega satélite | El paquete llegó a la bodega satélite de su zona y espera ser asignado a un mensajero. |
| Mensajero recogiendo en la bodega | El paquete ya tiene mensajero asignado, que debe recogerlo en la bodega para salir a reparto. |
| En reparto | El mensajero tiene el paquete y lo lleva al destinatario. Si ya lo gestionó, verás el resultado como «pendiente de confirmación» hasta que se apruebe su cierre del día. |
| Entregado | El paquete fue entregado al destinatario y la bodega lo confirmó al aprobar el cierre del mensajero. |
| Reprogramado | No se pudo entregar y se acordó una nueva fecha. El paquete vuelve a su bodega para asignarse de nuevo. |
| Novedad | El mensajero no pudo entregar el paquete (cliente no localizado, número o dirección errados). La tienda debe decidir si se vuelve a intentar o se devuelve. Si no responde: con cliente no localizado, a las 24 horas vuelve a salir a reparto; con número o dirección errados, a los 5 días se devuelve a la tienda. Si ya agotó sus intentos, se devuelve antes. |
| Novedad interna | El mensajero terminó el día sin gestionar el paquete. Al aprobarse su cierre, el paquete vuelve a su bodega para asignarse de nuevo. |
| Devolución a origen por rechazo | El destinatario rechazó el paquete. Al aprobarse el cierre, empieza su regreso a la tienda. |
| Incidente | El paquete se dañó, se perdió o fue robado. Quedó reportado para su revisión. |
| Por devolver a bodega central | El paquete devuelto está en la bodega satélite, esperando ser enviado a la bodega central. |
| Devolviendo a bodega central | El paquete devuelto viaja de la bodega satélite a la bodega central. |
| Por devolver a tienda | El paquete devuelto está en la bodega central, esperando ser enviado a la tienda. |
| Devolviendo a tienda | El paquete va camino de regreso a la tienda. También pasa aquí cuando la tienda cancela el envío. |
| Devuelta a tienda | La tienda recibió de vuelta su paquete. Fin del recorrido. |

## Validado contra el código (2026-09-23)
- Novedad: plazos en `lib/config/devolucion-sla.ts` (5 días `wrong_*`, 24 h `not_found`); decisión en
  `DevolucionSlaService` (`not_found` reintenta salvo tope; `wrong_*` escala). Tope `MIN_INTENTOS_ENTREGA`
  = 3 por defecto, configurable por env (`lib/config/reintentos.ts`): por eso el texto no da el número.
  Si cambian los plazos, este texto debe leer de ese config, no repetir el número a mano.
- Incidente: causas `danado`/`perdido`/`robado` (`GestionCausaIncidente`).

## Nota «pendiente de confirmación» (454)
Formato único en todas partes: «<resultado> · pendiente de confirmación», para los 5 resultados que
registra el mensajero (Entregado, Reprogramado, Novedad, Devolución a origen por rechazo, Incidente).
La ayuda lleva su propia nota «Ayuda solicitada a la tienda». Novedad interna no lleva nota.
