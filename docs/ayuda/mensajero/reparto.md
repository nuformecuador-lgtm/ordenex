---
titulo: Reparto
modulo: mis-asignaciones
pantalla: /mis-asignaciones/reparto
roles: [mensajero]
actualizado: 2026-09-25
fuentes:
  - app/(app)/mis-asignaciones/_components/RepartoModule.tsx
  - app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx
  - app/(app)/mis-asignaciones/_components/SolicitarAyudaModal.tsx
  - app/(app)/mis-asignaciones/_components/RecuperarAyudaButton.tsx
  - app/(app)/mis-asignaciones/_components/pos-card/PosCardHeader.tsx
  - components/shared/EstadoInfo.tsx
  - components/shared/nota-pendiente-confirmacion.ts
  - lib/types/order-status.ts
  - app/(app)/mis-asignaciones/_components/chat/ChatFlotante.tsx
  - app/(app)/mis-asignaciones/_components/chat/ChatOrdenesLista.tsx
  - app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx
  - app/(app)/mis-asignaciones/_components/chat/chat-contactos.ts
  - app/(app)/mis-asignaciones/_components/useFiltroCantonDistrito.ts
  - lib/services/MisAsignacionesService.ts
  - lib/constants/bloqueo-mensajero.ts
---

# Reparto

Aquí están los paquetes que **ya llevás encima** y tenés que entregar hoy. Es tu pantalla de trabajo
del día: desde acá ves la ruta, le escribís al cliente y registrás lo que pasó con cada entrega.

Los paquetes que todavía no recogiste no están acá — esos viven en **Recoger en bodega**.

## Qué vas a ver

**Tus órdenes, ordenadas por la ruta.** No están por orden de llegada ni alfabético: están en el orden
en que te conviene visitarlas. Si la ruta cambia porque te moviste, tocá **Sincronizar ruta** y se
vuelve a calcular.

**El mapa**, arriba, con la ruta dibujada. Se puede plegar si te estorba y se queda plegado mientras
trabajás.

**Las órdenes en las que pediste ayuda a la tienda** también aparecen acá, abajo, en su propio grupo:
**Con ayuda solicitada**. Siguen en reparto; lo que cambia es que esperan a que la tienda te responda.

**El botón de información.** Junto al estado de cada orden hay un pequeño botón **(i)**. Tocalo y te
explica qué significa ese estado —en el teléfono se abre al tocar y se cierra al tocar fuera—. Es el
mismo texto que ven la tienda, la oficina y el cliente.

> **Sobre tu ubicación:** la app **no te pide el GPS al entrar**. Solo lo usa cuando vos tocás
> «Sincronizar ruta». Si nunca lo tocás, nunca te lo pide.

## Encontrar una orden rápido

Dos formas, y sirven a la vez:

- **El buscador**: escribí el número de guía. Busca solo entre las órdenes de esta pantalla.
- **Filtro por cantón y distrito**: las opciones que te muestra salen de *tus propias órdenes* — si no
  tenés nada en Escazú, Escazú no aparece en la lista. Se limpia con **Limpiar filtros**.

## Escribirle al cliente

Cada orden tiene su chat. Lo abrís desde la orden y la conversación **queda guardada contra esa
orden**: si el paquete pasa a otro mensajero, la conversación no se pierde.

Hay plantillas listas para los mensajes más comunes, así no tenés que escribir lo mismo cada vez.

**Están todas tus órdenes, no solo las que llevás encima.** En la lista de conversaciones vas a ver
también los paquetes que todavía no recogiste, en sus propios grupos:

| Grupo | Qué hay ahí |
| --- | --- |
| **En reparto** | Lo que ya llevás encima |
| **Para recoger hoy** | Asignados, todavía en bodega, los podés recoger hoy |
| **Para otro día** | Asignados y reservados para una fecha posterior |

Podés escribirle al cliente **desde que te la asignan**, sin esperar a recogerla. Conversar no es
aceptar el paquete: la orden se queda donde está y la seguís recogiendo cuando te toque.

**Ver la orden entera desde el chat.** Dentro de la conversación, **Ver detalle** despliega los
datos completos de esa orden — dirección, producto, teléfono y lo que hay que cobrar — sin salir
del chat.

> **Ojo con las de otro día.** Las que están reservadas para una fecha posterior llevan la marca
> **Para mañana** y, debajo, la fecha desde la que vas a poder recogerla. Si le escribís el día
> antes y el cliente te pide que se la llevés hoy, **no vas a poder**: el sistema no te va a dejar
> recogerla ni gestionarla hasta ese día. Decíselo antes de prometer nada.

## Registrar lo que pasó

En cada orden tenés **Gestionar**, y desde ahí elegís qué pasó:

| Qué pasó | Qué elegís | Cómo se llama el resultado |
| --- | --- | --- |
| La entregaste | **Entregar** | Entregado |
| El destinatario no quiso el paquete | **Rechazar** | Devolución a origen por rechazo |
| El cliente pidió otro día | **Reprogramar** | Reprogramado |
| No se pudo entregar: cliente no localizado, número de celular errado o dirección errada | **Devolver** | Novedad |
| El paquete se dañó, se perdió o te lo robaron | **Reportar incidente** | Incidente |

Si querés dejarla para después sin cerrar nada, está **Gestionar más tarde**: la orden se queda donde
está y seguís con la siguiente.

### Qué pasa después de gestionar: «pendiente de confirmación»

Cuando guardás la gestión, **la orden sale de tu lista de reparto**, pero **su estado todavía no
cambia**: sigue **En reparto** hasta que la oficina **apruebe tu cierre del día**. Recién ahí se aplica
el estado real (Entregado, Novedad, Devolución a origen por rechazo…).

Mientras tanto, la tienda y el cliente ya ven lo que registraste, con una nota: por ejemplo
**«Entregado · pendiente de confirmación»**. Significa eso: vos ya lo registraste y falta que se
apruebe tu cierre.

- **Si te equivocaste**, podés deshacerla desde **Cierre del día** con **Devolver a gestión**, mientras
  no hayas solicitado el cierre. La orden vuelve a tu lista.
- **Si la oficina rechaza tu cierre**, la orden sigue en reparto con su gestión pendiente hasta que lo
  vuelvas a solicitar y se apruebe.

### Pedir ayuda a la tienda

Si no podés resolver una entrega sin la tienda —el teléfono no contesta, la dirección no aparece—, en
el panel de la orden tenés **Solicitar ayuda**. Escribís el motivo y la tienda lo ve en su pantalla de
**Novedades**.

**Pedir ayuda no cambia el estado de la orden.** Sigue **En reparto**, con una nota que avisa que se
solicitó ayuda a la tienda. Mientras la ayuda esté abierta:

- la orden baja al grupo **Con ayuda solicitada**, fuera de tu ruta;
- **no la podés gestionar**;
- **cuenta como pendiente**: no vas a poder solicitar el cierre hasta resolverla.

Se resuelve de tres formas: vos tocás **Recuperar** (retirás la solicitud y la orden vuelve arriba), la
tienda la **habilita** (vuelve a tu lista para que la gestionés), o la tienda la **resuelve por su
cuenta** reprogramándola o rechazándola. En ese último caso la gestión entra en tu cierre del día,
queda pendiente de confirmación como las tuyas y **no la podés deshacer vos**: si hay que corregirla,
escribile a la tienda por el chat de la orden.

## Cosas que te pueden pasar

**«No podés trabajar hasta resolver tus cierres».** Si tenés cierres del día pendientes acumulados, la
app te frena y te dice qué resolver. No es un error: es para que no se te junte el dinero de varios
días sin cuadrar. Resolvé el cierre y se te habilita solo.

**Una orden que dice que es para mañana.** Puede que te asignen un paquete para el día siguiente. Lo
vas a ver marcado, y **no vas a poder recogerlo ni gestionarlo hasta ese día** — aunque el cliente te
diga que se lo llevés hoy. Es a propósito: ese paquete está reservado para esa fecha.

**La ruta dice «desactualizada».** Significa que se asignaron o gestionaron órdenes después del último
cálculo. Tocá **Sincronizar ruta** y se pone al día.

## Lo que esta pantalla NO hace

- **No se recogen paquetes acá.** Eso es en **Recoger en bodega**. Que un paquete para recoger te aparezca
  en el chat no cambia eso: ahí se conversa, no se recoge.
- **No se ve la plata.** Tus pagos y tu cierre del día están en **Mi wallet** y en **Cierre del día**.
- **No se confirma el estado.** Lo que gestionás queda pendiente de confirmación hasta que la oficina
  apruebe tu cierre.
