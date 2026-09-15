---
titulo: Por recoger
modulo: mis-asignaciones
pantalla: /mis-asignaciones/recoger
roles: [mensajero]
actualizado: 2026-09-15
fuentes:
  - app/(app)/mis-asignaciones/_components/RecogerModule.tsx
  - app/(app)/mis-asignaciones/_components/recoger-grupos.ts
  - app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts
  - lib/services/MisAsignacionesService.ts
---

# Por recoger

Acá están los paquetes que **te asignaron pero todavía no tenés encima**. Cuando recogés uno, se pasa
solo a **Reparto**, que es donde vas a trabajarlo.

## Recoger un paquete

Arriba del todo, siempre a la vista, tenés dos formas de hacerlo — y las dos hacen exactamente lo
mismo:

- **Escanear** el código con la cámara.
- **Escribir el número de guía** a mano.

Usá la que te sirva. Si la cámara no abre o el código está estropeado, escribí el número y listo.

> Solo podés recoger **paquetes asignados a vos**. Si escaneás uno que es de otro mensajero, la app te
> lo va a decir en vez de aceptarlo.

## Las dos pestañas

**Órdenes por recoger** — las que podés recoger hoy.

**Órdenes para otro día** — las que te asignaron pero están reservadas para una fecha posterior.

Están separadas a propósito: las de otro día **no las podés recoger todavía**, ni escaneándolas. No es
que estén escondidas —las ves, sabés que las tenés— pero el sistema no te va a dejar adelantarte.

Si el cliente de una de esas te pide que se la llevés hoy, no vas a poder. Está reservada para su
fecha y hay que respetarla.

## Buscar

El buscador filtra entre tus paquetes por recoger. Escribí el número de guía y te lo deja a la vista.

## Cosas que te pueden pasar

**«No podés trabajar hasta resolver tus cierres».** Si tenés cierres del día pendientes, la app te
frena acá también y te dice cuál resolver. Andá a **Cierre del día**, resolvelo, y se te habilita solo.

**Escaneás y no pasa nada.** Revisá que sea una guía tuya y que no sea de las de *otro día*. Esas dos
son las causas casi siempre.

## Lo que esta pantalla NO hace

- **No se entregan paquetes acá.** Una vez recogido, el paquete se trabaja en **Reparto**.
- **No hay chat acá.** El chat con el cliente aparece cuando el paquete ya lo llevás encima.
