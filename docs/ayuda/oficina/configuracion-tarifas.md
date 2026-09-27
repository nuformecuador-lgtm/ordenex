---
titulo: Configuración · Tarifas
modulo: configuracion
pantalla: /configuracion/tarifas
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/configuracion/tarifas/page.tsx
  - app/(app)/configuracion/tarifas/_components/
---

# Configuración · Tarifas

Acá se define **cuánto cuesta cada cosa**: lo que se le cobra a la tienda y lo que se le paga al
mensajero. Es la pantalla que alimenta todos los números de dinero del sistema.

> **Tocar esto cambia lo que se cobra y lo que se paga de aquí en adelante.** No es una pantalla de
> consulta: cada cifra de acá termina en la factura de una tienda y en el pago de un mensajero.

## Qué se configura

**Costos por zona.** Cada zona tiene su tarifa. Las zonas se crean acá mismo, y se arman eligiendo
sobre el catálogo geográfico — provincia, cantón, distrito — con su buscador.

**Comisión por cobro contra entrega (%).** El porcentaje que Ordenex cobra por recaudar la plata del
cliente. Es lo que después aparece como *Comisión COD* en la cuenta de la tienda.

**Cobro por vehículo.** Lo que varía según el tipo de vehículo que hace la entrega.

**Quién paga qué**, según sea administrador de tienda o cuenta por API key.

## Cómo se relaciona con el resto

| Lo que definís acá | Dónde aparece |
| --- | --- |
| Tarifa de la zona | El flete en la cuenta de la tienda |
| Comisión COD | *Comisión COD* en **Wallet · Tiendas** y en el **Mi wallet** de la tienda |
| Pago por entrega | Lo que se le debe al mensajero en **Wallet · Mensajeros** |

## Antes de cambiar una tarifa

Lo que cambiás **aplica de aquí en adelante**, no reescribe lo ya cobrado. Las entregas viejas
conservan la tarifa con la que se calcularon, y eso es lo correcto: una factura emitida no cambia
porque hoy suban los precios.

Conviene avisar a las tiendas afectadas antes, no después de que vean la diferencia.

## Lo que esta pantalla NO hace

- **No recalcula lo ya cobrado.** Lo pasado queda como estaba.
- **No define quién cubre qué zona.** Eso es la asignación de mensajeros y bodegas.
