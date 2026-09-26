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
  - app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts
  - lib/services/PagoPorCuentaTiendaService.ts
  - lib/services/AporteCapitalService.ts
  - lib/services/CobroTiendaService.ts
  - lib/services/CajaCobroTiendaFeedService.ts
  - lib/services/AjusteCajaService.ts
  - lib/utils/descripcion-pago-por-cuenta.ts
  - lib/utils/descripcion-cobro-tienda.ts
  - lib/utils/caja-tesoreria.ts
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
fletes, comisiones, IVA, lo que Ordenex les cobra a las tiendas— y no solo el total.

**El desglose de egresos**, del otro lado.

**El libro**: la lista de movimientos, uno por línea, con su concepto, de quién es el dinero
(**Ordenex**, **Tienda** u **Ordenex (capital)**) y de dónde viene.

## Los nombres: siempre desde Ordenex, y diciendo quién le paga a quién

Cada concepto del libro se lee desde Ordenex y dice quién le paga a quién. Los que más se ven:

| En la caja dice | Qué es |
| --- | --- |
| **Flete cobrado a la tienda**, **Comisión de contra-entrega cobrada a la tienda**, **IVA del flete cobrado a la tienda**… | El servicio, cobrado a cada tienda al aprobarse un cierre |
| **Contra-entrega cobrado a los clientes de la tienda** | Lo que el mensajero cobró a los clientes en nombre de la tienda. Es dinero de la tienda |
| **Ordenex le cobra a una tienda** | Un cobro que la oficina le hace a mano a una tienda. Es ganancia de Ordenex |
| **Cobro a una tienda anulado** | La anulación de ese cobro |
| **Ordenex le paga a una tienda** / **Pago a una tienda anulado** | Lo que se le paga a una tienda de su saldo, y su anulación |
| **Ordenex paga un gasto de una tienda** / **Pago de un gasto de una tienda anulado** | Lo que Ordenex le pagó a un tercero en nombre de la tienda, y su anulación |
| **Ordenex le paga a un mensajero** | El pago al mensajero |
| **Sueldo**, **Gasto de Ordenex**, **Gasto fijo de Ordenex** | Lo que Ordenex gasta |
| **Corrección de caja (suma)** / **Corrección de caja (resta)** | Una corrección hecha a mano para cuadrar la caja |
| **Aporte de dinero a la caja** / **Aporte de dinero a la caja anulado** | El saldo inicial o un aporte de Ordenex, y su anulación |

La columna **Origen** dice de dónde nace cada línea con el mismo criterio: **Cierre del día**,
**Registrado a mano**, **Gasto o sueldo registrado a mano**, **Pago de Ordenex a una tienda**, **Pago de
un gasto de una tienda**, **Cobro de Ordenex a una tienda**…

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

Es la **suma de los saldos de todas las tiendas**, ya descontados el flete, la comisión, el impuesto y
**lo que Ordenex les cobró**. Si sale negativa, la tarjeta lo dice en palabras: son **las tiendas las
que le deben a Ordenex**, y cuánto. El detalle de cada tienda está en **Wallet · Tiendas** («Ver la
deuda de cada tienda»).

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
diálogo dice con una frase qué le pasa al dinero de Ordenex, al saldo de la tienda (si la toca) y a la
ganancia, y con qué nombre va a salir en cada libro.

| Grupo | Conceptos |
| --- | --- |
| **Sale dinero de Ordenex** | Gasto de Ordenex · Sueldo · Ordenex paga un gasto de una tienda · Corrección de caja (resta) |
| **Llega dinero a la caja** | Aporte de dinero a la caja · Corrección de caja (suma) |
| **Se descuenta del saldo de una tienda** | Ordenex le cobra a una tienda |

**Gastos fijos.** En vez de teclear el mismo gasto cada mes, se define una plantilla con **cada cuánto
se cobra**, y se puede **activar o desactivar** sin borrarla. Los que quedan pendientes de cobrar
aparecen en su propio panel.

**Cobros de rechazos de tienda** tienen también su panel de pendientes.

## Ordenex le cobra a una tienda: se descuenta de su saldo y es ganancia

Cuando Ordenex le cobra algo a una tienda —material de despacho entregado en la bodega, por ejemplo—
ese cobro **se descuenta del saldo a favor de la tienda** y pasa a ser **ganancia de Ordenex**.
**No llega dinero nuevo** a la caja: el dinero ya estaba ahí, guardado para la tienda, y cambia de
dueño. Por eso:

- La **ganancia de Ordenex** sube en el monto.
- **Lo que Ordenex les debe a las tiendas** baja en el monto, y el saldo de esa tienda también.
- **Entró**, **Salió** y la cifra grande **no cambian**.
- Si la tienda no tiene saldo a favor, **su saldo queda en contra**: le debe ese dinero a Ordenex, y
  se cobra cuando la gestión le vuelva a generar dinero a favor. El cobro no se compara contra ningún
  saldo disponible.

En el libro de la caja sale como **Ordenex le cobra a una tienda**, con tipo **Ingreso**, dueño
**Ordenex** y origen **Cobro de Ordenex a una tienda · la tienda · el motivo**. En **Wallet · Tiendas**
sale como **Ordenex le cobra a la tienda**, y la tienda lo lee en su **Mi wallet** como **Ordenex te
cobró**.

Se pide **la tienda** (solo tiendas activas), **el monto**, **la fecha** y **el motivo del cobro**. Al
registrarlo, el aviso te dice en cuánto quedó el saldo de la tienda y, si quedó en contra, que la
tienda le debe ese dinero a Ordenex.

Algunos cobros antiguos no tenían su línea en la caja: se les añadió al corregir, con el origen
**Cobro de Ordenex a una tienda (línea de caja completada al corregir)**. Se leen y se anulan igual
que los demás.

## Ordenex paga un gasto de una tienda, u Ordenex le cobra a una tienda: no son lo mismo

> **Elegir el equivocado descuadra la caja.** Los dos bajan el saldo de la tienda, pero solo uno
> registra que salió dinero. Ya pasó: pagos hechos en nombre de una tienda se anotaron como cobros,
> y la caja quedó mostrando dinero que ya se había ido.

La pregunta que decide es una sola: **¿salió dinero de Ordenex hacia otra persona?**

| | Ordenex paga un gasto de una tienda | Ordenex le cobra a una tienda |
| --- | --- | --- |
| **Cuándo se usa** | Ordenex **le pagó a un tercero en nombre de la tienda**: su proveedor, su publicidad, su personal | Ordenex **le cobra algo** a la tienda y no le paga nada a nadie |
| **La caja** | **Baja: sale dinero** | **No cambia el dinero: pasa del saldo de la tienda a la ganancia de Ordenex** |
| **El saldo de la tienda** | Baja en el monto | Baja en el monto |
| **La ganancia de Ordenex** | No cambia | **Sube** en el monto |
| **En el libro de la tienda sale como** | «Ordenex paga un gasto de la tienda» | «Ordenex le cobra a la tienda» |
| **En la caja sale como** | «Ordenex paga un gasto de una tienda», con dueño **Tienda** | «Ordenex le cobra a una tienda», con dueño **Ordenex** |

**Un ejemplo.** Ordenex le paga **₡50.000 a Facebook** por la publicidad de una tienda, con dinero de
Ordenex.

- Bien registrado, como **Ordenex paga un gasto de una tienda**: la caja baja ₡50.000 (esa plata se fue
  a Facebook) y el saldo de la tienda baja ₡50.000 (se lo descontás). Todo cuadra.
- Mal registrado, como **Ordenex le cobra a una tienda**: el saldo de la tienda baja igual, pero la caja
  **no registra la salida** y la ganancia sube ₡50.000 que Ordenex no ganó. La caja queda mostrando
  ₡50.000 que ya no están.

Y al revés: si le entregaste a la tienda material de despacho en la bodega y se lo cobrás, **no salió
dinero hacia nadie** y ese dinero **es de Ordenex**. Eso es **Ordenex le cobra a una tienda**.

### Qué pide el pago de un gasto de una tienda

- **La tienda** por la que se paga (solo tiendas activas).
- **A quién se le pagó**: un nombre libre —Facebook, Jet Cargo, el nombre de una persona—.
- **El monto**, **la fecha** y **el motivo del pago**.
- **El método de pago**: Efectivo, SINPE o Transferencia. **En SINPE y transferencia la referencia es
  obligatoria.**
- **Un comprobante**, si lo tenés. Es opcional.

Si la tienda no tiene saldo suficiente, **el pago se registra igual y su saldo queda en contra**: la
tienda le debe ese dinero a Ordenex. Al registrarlo, el aviso te dice en cuánto quedó su saldo y si
quedó en contra.

## Aporte de dinero a la caja

Es **dinero de Ordenex que entra a la caja y no es ganancia**. Es opcional: si nadie lo registra, la
cifra grande sigue siendo el **Flujo de dinero registrado**. Dentro del concepto se elige qué es:

- **Saldo inicial**: el dinero que Ordenex tenía al empezar a usar la app. **Solo puede haber uno.** Su
  fecha no puede ser posterior al día del primer movimiento de la caja. Si hay que cambiarlo, se anula
  el vigente y se registra otro.
- **Aporte**: dinero de Ordenex que entra después.

Se piden **qué es** (saldo inicial o aporte), **el monto**, **la fecha**, **el motivo** y, si lo tenés,
**un comprobante**.

> **La app nunca propone una cifra.** El monto lo escribe una persona que sabe cuánto había. El campo
> arranca vacío y no trae ni un ejemplo de importe: si no sabés la cifra real, no lo registres.

Al registrar un saldo inicial, la cifra grande pasa a llamarse **Dinero en caja** y aparece la barra de
reparto. Si se anula, vuelve a **Flujo de dinero registrado**. La ganancia no cambia en ningún caso.

## Anular: con motivo, y sin borrar nada

Un **pago de un gasto de una tienda**, un **aporte de dinero a la caja**, un **cobro de Ordenex a una
tienda** o una **corrección de caja** no se editan. Si hubo un error, se anulan desde su fila en el
libro de la caja con **Anular…**:

- **El motivo es obligatorio.** Queda guardado junto a la anulación.
- Se registra **hoy** un **movimiento contrario** por el mismo monto. El registro original, su
  comprobante y su historial **quedan intactos**: no se borra nada.
- La fila original pasa a decir **Anulado**. Una anulación no se deshace.
- Al anular un pago de un gasto de una tienda, la caja y el saldo de la tienda **vuelven a subir** en el
  monto. En el libro de la tienda aparece «Pago de un gasto de la tienda anulado».
- Al anular un cobro de Ordenex a una tienda, la **ganancia baja** en el monto, **lo que Ordenex les
  debe a las tiendas** y el saldo de la tienda **vuelven a subir**, y **Entró**, **Salió** y la cifra
  grande no cambian. En la caja aparece **Cobro a una tienda anulado**; en el libro de la tienda,
  «Cobro de Ordenex a la tienda anulado».
- Al anular una corrección de caja, aparece la corrección contraria por el mismo monto.

Si te dice **«Ya estaba anulado; no se registró nada más»**, alguien se te adelantó. Si te dice que el
cobro **no se puede anular desde aquí**, es uno de los cobros antiguos que ya se corrigieron como pago
de un gasto de la tienda, o uno sin su línea en la caja: se explica en el propio aviso.

Un **gasto de Ordenex** o un **sueldo** registrado a mano se **reversa** desde su fila con **Reversar**:
se registra una corrección que suma por el mismo monto, y la fila pasa a decir **Reversado**.

## El comprobante

- **Opcional.** Imagen JPEG, PNG o WebP, o un PDF, de hasta 4 MB. Un cobro a una tienda no lleva
  comprobante.
- Se guarda **privado**: no tiene un enlace público. **Ver comprobante**, en la fila del libro, lo abre
  con un enlace que dura poco.
- Si el comprobante no se pudo guardar, **no se registra nada**: probá de nuevo.

## Las fechas, en hora de Costa Rica

Todas las fechas de esta pantalla son días de Costa Rica: el «desde» de la cifra grande, la fecha de
un pago, de un cobro o de un aporte (**no puede ser posterior a hoy** en Costa Rica) y la de una
anulación, que se fecha **el día en que se anula**. Los movimientos a mano tienen además un límite hacia
atrás: si te pasás, la app te dice el primer día admitido. Al filtrar por fechas, **Desde** y **Hasta**
son días completos de Costa Rica.

## Los cobros que eran pagos de un gasto

Algunos cobros antiguos se registraron como cobro cuando en realidad eran pagos hechos en nombre de
una tienda. Se corrigieron añadiendo su salida en la caja: en el libro aparecen como **Ordenex paga un
gasto de una tienda** con el origen **Cobro reclasificado como pago de un gasto de la tienda**. Esas
salidas no se anulan desde acá, y la tienda los sigue viendo igual que antes en su libro.

## Buscar

Filtros por **concepto** y **tipo**, más el rango de fechas. Y se puede **descargar** el libro para
cuadrar fuera, con los mismos nombres que la tabla.

## Lo que esta pantalla NO hace

- **No muestra lo que le debés a cada tienda.** Eso es **Wallet · Tiendas**.
- **No muestra lo que le debés a cada mensajero.** Eso es **Wallet · Mensajeros**.
- **No es el saldo del banco**, salvo que alguien haya registrado el saldo inicial real.
- **No se editan movimientos.** Un pago de un gasto, un aporte, un cobro a una tienda o una corrección
  se anulan con motivo; un gasto o sueldo se reversa; los demás son inmutables.
- **No se corrigen cifras de entregas.** Un movimiento que nació de un cierre se arregla en el cierre,
  no acá.
