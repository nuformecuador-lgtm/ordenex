---
titulo: Wallet · Caja
modulo: wallet
pantalla: /wallet
roles: [maestro, admin]
actualizado: 2026-09-25
fuentes:
  - app/(app)/wallet/_components/WalletModule.tsx
  - app/(app)/wallet/_components/CajaResumenCard.tsx
  - app/(app)/wallet/_components/BarraComposicionCaja.tsx
  - app/(app)/wallet/_components/ComposicionGananciaCard.tsx
  - app/(app)/wallet/_components/WalletLedger.tsx
  - app/(app)/wallet/_components/DocumentoCajaAcciones.tsx
  - app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx
  - app/(app)/wallet/_components/wallet-conceptos-manuales.ts
  - app/(app)/wallet/_components/wallet-labels.ts
  - app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx
  - lib/services/PagoPorCuentaTiendaService.ts
  - lib/services/AporteCapitalService.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/utils/comprobante.ts
  - lib/types/wallet.ts
---

# Wallet · Caja

**La caja de Ordenex**: todo lo que entra y todo lo que sale. Es la pantalla del dinero de la empresa,
no del de las tiendas ni del de los mensajeros —esos tienen la suya—.

## Qué vas a ver

**El resumen de caja**, arriba: la cifra grande, lo que **entró** y lo que **salió**, la **ganancia de
Ordenex**, el **saldo inicial y aportes** y **lo que Ordenex les debe a las tiendas**.

**Cómo se compone la ganancia**, desglosada por concepto, para ver de dónde sale de verdad el margen —
fletes, comisiones, IVA— y no solo el total.

**El desglose de egresos**, del otro lado.

**El libro**: la lista de movimientos, uno por línea, con su concepto, su categoría, de quién es el
dinero (**Ordenex**, **Tienda** u **Ordenex (capital)**) y de dónde viene.

## La cifra grande: «Flujo de dinero registrado» o «Dinero en caja»

La cifra grande es siempre la misma cuenta —**lo que entró menos lo que salió**—, pero **cambia de
nombre** según lo que la app sabe:

| La tarjeta dice | Cuándo | Qué significa |
| --- | --- | --- |
| **Flujo de dinero registrado** | No hay un saldo inicial registrado | Lo que entró menos lo que salió **desde el primer movimiento de la caja**. La tarjeta dice desde qué día cuenta |
| **Dinero en caja** | Alguien registró un saldo inicial | El saldo inicial más lo que entró menos lo que salió desde entonces |
| **Movimiento neto del periodo** | Tenés filtros puestos | Lo que entró menos lo que salió **en el periodo que elegiste**. No es el dinero que hay hoy |

> **«Flujo de dinero registrado» no es el saldo del banco.** La app no sabe con cuánto dinero empezó
> Ordenex: solo cuenta lo que se registró desde que se empezó a usar. Por eso, mientras no haya un
> saldo inicial, la tarjeta no usa las palabras «Dinero en caja» y no pinta la barra de reparto.

### Por qué el flujo puede salir negativo

Si la tarjeta dice **Flujo de dinero registrado** y la cifra es negativa, **no es un error**: parte de
los pagos se hicieron con dinero que Ordenex ya tenía **antes** de usar la app, y ese dinero no está
registrado. La salida sí quedó anotada; la plata con la que se pagó, no. La tarjeta lo dice con una
línea debajo de la cifra.

Si en cambio la tarjeta dice **Dinero en caja** y sale negativa, **sí hay algo que revisar**: el dinero
en caja no puede ser negativo. Revisá el saldo inicial y los pagos registrados.

### Lo que Ordenex les debe a las tiendas

Es la **suma de los saldos de todas las tiendas**, ya descontados el flete, la comisión y el
impuesto. Si sale negativa, la tarjeta lo dice en palabras: son **las tiendas las que le deben a
Ordenex**, y cuánto. El detalle de cada tienda está en **Wallet · Tiendas** («Ver la deuda de cada
tienda»).

Los **cobros de un costo a una tienda** bajan el saldo de la tienda **sin pasar por la caja**, así que
no aparecen como salida en este libro.

### La barra de reparto

Solo aparece cuando hay un saldo inicial registrado (la cifra dice **Dinero en caja**). Parte el
dinero en **De las tiendas** y **De Ordenex** (ganancia más aportes). Si uno de los dos está en
negativo, la barra no se parte y en su lugar te dice qué pasa.

## De dónde entra el dinero solo

La mayoría de los movimientos **no los teclea nadie**: entran cuando se aprueba el cierre de un
mensajero. En ese momento se registra lo recaudado, los fletes, las comisiones y lo que se le paga al
mensajero, todo de una vez.

Por eso la caja va al ritmo de los cierres, no de las entregas: una entrega de hoy aparece cuando su
cierre se apruebe.

## Lo que sí se registra a mano

**Registrar movimiento** abre un diálogo con **siete conceptos en tres grupos**. Al elegir uno, el
diálogo dice con una frase qué le pasa a la caja, al saldo de la tienda (si la toca) y a la ganancia.

| Grupo | Conceptos |
| --- | --- |
| **Sale dinero de la caja** | Gasto variable · Sueldo · Pago por cuenta de una tienda · Ajuste que resta dinero |
| **Entra dinero a la caja** | Saldo inicial o aporte de capital · Ajuste que suma dinero |
| **No mueve la caja** | Cobrar un costo a una tienda |

**Gastos fijos.** En vez de teclear el mismo gasto cada mes, se define una plantilla con **cada cuánto
se cobra**, y se puede **activar o desactivar** sin borrarla. Los que quedan pendientes de cobrar
aparecen en su propio panel.

**Cobros de rechazos de tienda** tienen también su panel de pendientes.

## Pago por cuenta de una tienda, o cobrar un costo: no son lo mismo

> **Elegir el equivocado descuadra la caja.** Los dos bajan el saldo de la tienda, pero solo uno
> registra que salió dinero. Ya pasó: pagos hechos por cuenta de una tienda se anotaron como cobros,
> y la caja quedó mostrando dinero que ya se había ido.

La pregunta que decide es una sola: **¿salió dinero de Ordenex hacia otra persona?**

| | Pago por cuenta de una tienda | Cobrar un costo a una tienda |
| --- | --- | --- |
| **Cuándo se usa** | Ordenex **le pagó a un tercero en nombre de la tienda**: su proveedor, su publicidad, su personal | Ordenex **le cobra algo** a la tienda y no le paga nada a nadie |
| **La caja** | **Baja**: sale dinero de la caja | **No cambia** |
| **El saldo de la tienda** | Baja en el monto | Baja en el monto |
| **La ganancia de Ordenex** | No cambia | No cambia |
| **En el libro de la tienda sale como** | «Pago por cuenta de la tienda» | «Cobro de Ordenex» |
| **En la caja sale como** | «Pago por cuenta de una tienda», con dueño **Tienda** | No sale |

**Un ejemplo.** Ordenex le paga **₡50.000 a Facebook** por la publicidad de una tienda, con dinero de
Ordenex.

- Bien registrado, como **Pago por cuenta de una tienda**: la caja baja ₡50.000 (esa plata se fue a
  Facebook) y el saldo de la tienda baja ₡50.000 (se lo descontás). Todo cuadra.
- Mal registrado, como **Cobrar un costo a una tienda**: el saldo de la tienda baja igual, pero la caja
  **no registra la salida**. La caja queda mostrando ₡50.000 que ya no están.

Y al revés: si le entregaste a la tienda material de despacho en la bodega y se lo cobrás, **no salió
dinero hacia nadie**. Eso es **Cobrar un costo a una tienda**.

### Qué pide el pago por cuenta

- **La tienda** por la que se paga (solo tiendas activas).
- **A quién se le pagó**: un nombre libre —Facebook, Jet Cargo, el nombre de una persona—.
- **El monto**, **la fecha** y **el motivo del pago**.
- **El método de pago**: Efectivo, SINPE o Transferencia. **En SINPE y transferencia la referencia es
  obligatoria.**
- **Un comprobante**, si lo tenés. Es opcional.

Si la tienda no tiene saldo suficiente, **el pago se registra igual y su saldo queda en contra**: la
tienda le debe ese dinero a Ordenex. Al registrarlo, el aviso te dice en cuánto quedó su saldo y si
quedó en contra.

## Saldo inicial o aporte de capital

Es **dinero de Ordenex que entra a la caja y no es ganancia**. Es opcional: si nadie lo registra, la
cifra grande sigue siendo el **Flujo de dinero registrado**.

- **Saldo inicial**: el dinero que Ordenex tenía al empezar a usar la app. **Solo puede haber uno.** Su
  fecha no puede ser posterior al día del primer movimiento de la caja. Si hay que cambiarlo, se anula
  el vigente y se registra otro.
- **Aporte de capital**: dinero de Ordenex que entra después.

Se piden **qué es** (saldo inicial o aporte), **el monto**, **la fecha**, **el motivo** y, si lo tenés,
**un comprobante**.

> **La app nunca propone una cifra.** El monto lo escribe una persona que sabe cuánto había. El campo
> arranca vacío y no trae ni un ejemplo de importe: si no sabés la cifra real, no lo registres.

Al registrar un saldo inicial, la cifra grande pasa a llamarse **Dinero en caja** y aparece la barra de
reparto. Si se anula, vuelve a **Flujo de dinero registrado**. La ganancia no cambia en ningún caso.

## Anular: con motivo, y sin borrar nada

Un **pago por cuenta** o un **saldo inicial o aporte** no se editan. Si hubo un error, se anulan desde
su fila en el libro de la caja con **Anular…**:

- **El motivo es obligatorio.** Queda guardado junto a la anulación.
- Se registra **hoy** un **movimiento contrario** por el mismo monto. El registro original, su
  comprobante y su historial **quedan intactos**: no se borra nada.
- La fila original pasa a decir **Anulado**. Una anulación no se deshace.
- Al anular un pago por cuenta, la caja y el saldo de la tienda **vuelven a subir** en el monto. En el
  libro de la tienda aparece «Pago por cuenta anulado».

Si te dice **«Ya estaba anulado; no se registró nada más»**, alguien se te adelantó.

Los gastos variables, los sueldos y los ajustes no se anulan: son inmutables una vez registrados.

## El comprobante

- **Opcional.** Imagen JPEG, PNG o WebP, o un PDF, de hasta 4 MB.
- Se guarda **privado**: no tiene un enlace público. **Ver comprobante**, en la fila del libro, lo abre
  con un enlace que dura poco.
- Si el comprobante no se pudo guardar, **no se registra nada**: probá de nuevo.

## Las fechas, en hora de Costa Rica

Todas las fechas de esta pantalla son días de Costa Rica: el «desde» de la cifra grande, la fecha de
un pago o de un saldo inicial (**no puede ser posterior a hoy** en Costa Rica) y la de una anulación,
que se fecha **el día en que se anula**. Los movimientos a mano tienen además un límite hacia atrás: si
te pasás, la app te dice el primer día admitido.

## Los cobros que eran pagos por cuenta

Algunos cobros antiguos se registraron como **cobro de un costo** cuando en realidad eran pagos hechos
por cuenta de una tienda. Se corrigieron añadiendo su salida en la caja: en el libro aparecen como
**Pago por cuenta de una tienda** con el origen **Cobro reclasificado como pago por cuenta**. Esas
salidas no se anulan desde acá, y la tienda los sigue viendo igual que antes en su libro.

## Buscar

Filtros por **concepto** y **categoría**, más el buscador. Y se puede **descargar** el libro para
cuadrar fuera.

## Lo que esta pantalla NO hace

- **No muestra lo que le debés a cada tienda.** Eso es **Wallet · Tiendas**.
- **No muestra lo que le debés a cada mensajero.** Eso es **Wallet · Mensajeros**.
- **No es el saldo del banco**, salvo que alguien haya registrado el saldo inicial real.
- **No se editan movimientos.** Un pago por cuenta o un saldo inicial se anulan con motivo; los demás
  son inmutables.
- **No se corrigen cifras de entregas.** Un movimiento que nació de un cierre se arregla en el cierre,
  no acá.
