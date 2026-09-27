---
titulo: Cierre del día
modulo: cierre-dia
pantalla: /cierre-dia
roles: [mensajero]
actualizado: 2026-09-25
fuentes:
  - app/(app)/cierre-dia/_components/CierreDiaModule.tsx
  - lib/services/CierreDiaService.ts
  - lib/services/CierresAdminService.ts
  - lib/repositories/gestion-pendiente.ts
  - lib/repositories/CierreDiaRepository.ts
  - lib/utils/cierre-sin-gestion.ts
---

# Cierre del día

Acá cuadrás el día: pedís tu cierre con todo lo que gestionaste, y la oficina lo revisa y lo aprueba.
Es el paso que convierte tu trabajo del día en plata acreditada.

## Cómo se pide

Cuando terminaste tu jornada, tocás **Solicitar cierre**. El cierre se arma solo con las gestiones que
hiciste: no tenés que escribir nada ni sumar nada a mano.

Una vez enviado, pasa a la oficina para que lo apruebe. Vos no tenés que hacer nada más.

**Qué te puede frenar al pedirlo.** No vas a poder solicitar el cierre si todavía tenés paquetes en
reparto que todavía no gestionaste —incluidas las órdenes en las que pediste ayuda a la tienda y nadie resolvió— o
paquetes asignados que no recogiste. Las órdenes que ya gestionaste **no** te frenan: son justamente
las que entran en el cierre.

## Al aprobarse, se confirma el estado de cada orden

Lo que gestionás durante el día **queda pendiente de confirmación**: la orden sigue **En reparto** y la
tienda la ve, por ejemplo, como **«Entregado · pendiente de confirmación»**. **Cuando la oficina aprueba
tu cierre**, en ese mismo momento se aplica el estado real de cada orden y se registra el dinero.

- **Si lo rechazan**, ninguna orden cambia de estado: siguen en reparto con su gestión pendiente hasta
  que lo vuelvas a solicitar y se apruebe.
- **Si la oficina corrige una gestión** antes de aprobar —por ejemplo, una entrega que en realidad fue un
  rechazo—, al aprobar se aplica el resultado corregido.

## Los estados que vas a ver

| Estado | Qué significa | Qué hacés |
| --- | --- | --- |
| **Solicitado** | Lo enviaste y la oficina todavía no lo revisa | Nada, esperar |
| **Aprobado** | Cuadró. La plata quedó acreditada | Nada |
| **Rechazado** | La oficina encontró algo que no cuadra | Revisar, arreglar y **volver a solicitarlo** |
| **Vencido** | Se te pasó el día sin cerrar | **Volver a solicitarlo** |

**Rechazado y Vencido no son el final del camino.** Los dos se vuelven a solicitar desde la misma
pantalla, con el botón que te aparece. Lo que sí hacen los dos es **frenarte**: mientras tengas uno
sin resolver, no vas a poder seguir trabajando normalmente. Por eso conviene resolverlos temprano.

## El detalle del cierre

Tocando un cierre ves **todo lo que entró**: cada orden, qué pasó con ella, la fecha de la gestión, el
destinatario, la dirección, cuánto se cobró y en qué forma —efectivo, SINPE, transferencia— y la
**evidencia fotográfica** que subiste.

Ahí mismo podés **descargar el detalle** si lo necesitás para cuadrar por tu cuenta.

## Devolver una orden a gestión

Antes de solicitar el cierre, esta pantalla te muestra **lo que gestionaste en el día**, separado por
resultado. Si ves que una orden entró mal —la marcaste como Entregado por error, por ejemplo— tenés
**Devolver a gestión** en su fila. La gestión queda anulada (queda el registro de quién la hizo y
cuándo) y la orden vuelve a tu lista de reparto para que la gestionés bien.

Es la vía correcta para corregir, en vez de dejar que se apruebe algo que no pasó.

- **Solo mientras no hayas solicitado el cierre.** Una vez que la gestión entró en un cierre, ya no se
  devuelve desde acá.
- **Si la gestión la registró la tienda** (desde su pantalla de ayuda), el botón aparece apagado: solo
  ella puede corregirla. Escribile por el chat de la orden.

## Órdenes que pasaron a Novedad interna

Si al cerrar te quedaron paquetes encima que no gestionaste, pasan a **Novedad interna** y aparecen en
el cierre como una lista aparte («Pasaron a Novedad interna»),
para que quede constancia de qué tenías en la mano ese día.

**Novedad interna** quiere decir eso: el mensajero terminó el día con el paquete y sin registrar qué
pasó con él. Al aprobarse el cierre, el paquete vuelve a su bodega para asignarse de nuevo. Las órdenes
que ya gestionaste y esperan confirmación **no** pasan a Novedad interna.

**Cada resultado y cada estado tiene su botón (i)**: tocalo y te explica qué significa.

**Los paquetes reservados para otro día no entran acá.** Se quedan con vos, esperando su fecha.

## Lo que esta pantalla NO hace

- **No se aprueba solo.** Lo aprueba la oficina; vos lo solicitás.
- **No se confirma sola una gestión.** El estado real de cada orden se aplica cuando la oficina aprueba
  el cierre.
- **No se editan montos.** Lo que se cobró sale de las gestiones que hiciste. Si algo está mal, se
  corrige devolviendo la orden a gestión, no cambiando un número.
