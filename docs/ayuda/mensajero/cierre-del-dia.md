---
titulo: Cierre del día
modulo: cierre-dia
pantalla: /cierre-dia
roles: [mensajero]
actualizado: 2026-09-15
fuentes:
  - app/(app)/cierre-dia/_components/CierreDiaModule.tsx
  - lib/services/CierreDiaService.ts
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

Si al revisar el detalle ves que una orden entró mal —la marcaste entregada por error, por ejemplo—
tenés **Devolver la orden a gestión**. La orden sale de ese cierre y vuelve a tu lista de trabajo para
que la gestionés bien.

Es la vía correcta para corregir, en vez de dejar que se apruebe algo que no pasó.

## Órdenes que pasaron a Novedad interna

Si al cerrar te quedaron paquetes encima que no gestionaste, pasan a **Novedad interna** y aparecen en
el cierre como una lista aparte («Pasaron a Novedad interna»),
para que quede constancia de qué tenías en la mano ese día.

**Los paquetes reservados para otro día no entran acá.** Se quedan con vos, esperando su fecha.

## Lo que esta pantalla NO hace

- **No se aprueba solo.** Lo aprueba la oficina; vos lo solicitás.
- **No se editan montos.** Lo que se cobró sale de las gestiones que hiciste. Si algo está mal, se
  corrige devolviendo la orden a gestión, no cambiando un número.
