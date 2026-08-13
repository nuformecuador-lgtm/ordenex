# Feature 213 — el desglose del recaudo se captura y se lee

> **Mitad FRONTEND de la partición de la 212** (regla F1.0 de `AGENTS.md`). La 212 creó
> `gestion_orden_pago`, adaptó el borde de escritura y el cálculo, y **ya está en producción**
> (release #359, migración aplicada el 2026-08-13 15:12:20). Lo que entregó es capacidad sin
> superficie: hoy no hay forma de registrar una entrega cobrada con dos métodos.
>
> ⛔ **ESTA FICHA NO RETIRA NADA.** El retiro de la forma escalar (`metodoPago` en el borde, la
> columna `gestion_orden.metodo_pago`, el campo escalar del DTO y `normalizarPagos`) es la
> **ficha 214**, por decisión humana explícita del 2026-08-12 [Q3], y no antes de que ESTA esté
> **desplegada**.
>
> ⚠️ **Trampa documental verificada el 2026-08-13:** `lib/utils/pagos-recaudo.ts:47-49` dice que
> `normalizarPagos` es «exactamente el punto que **la 213** borrará cuando cierre la puerta de
> compatibilidad», y `lib/interfaces/services/ICierreDiaService.ts:36` dice que el retiro del
> campo escalar «lo decide **la 213**». Las dos frases contradicen [Q3]: el retiro es la 214.
> Un implementador que las obedezca rompe producción durante la ventana. **R20 las corrige.**

## Contexto medido, no supuesto

| Medición (producción, 2026-08-13, solo lectura) | Valor |
| --- | --- |
| Gestiones con recaudo (`monto_recibido > 0` y método) | 16 |
| Gestiones `entregada` | 16 |
| **Gestiones con método escalar y SIN línea de desglose** | **0** |
| Gestiones con método escalar y monto nulo o cero | 0 |

La tercera fila es la que autoriza a R10: leer **solo** el desglose para pintar no pierde ni una
etiqueta de los datos reales, porque el backfill cubrió exactamente las 16 filas que tenían algo
que desglosar.

## A. La captura: el panel del mensajero

**R1.** MIENTRAS el resultado elegido es `entregada` y la orden tiene cobro (`montoCobrar > 0`),
el panel DEBE ofrecer un editor de desglose con **una línea por método** (`metodo` + `monto`), y
DEBE arrancar con **exactamente una línea** vacía de método y con el monto igual al total a
cobrar.

**R2.** MIENTRAS el editor tiene una sola línea, el panel DEBE mantener su monto igual al total a
cobrar y NO DEBE permitir editarlo. *(Con un único método el monto está determinado por R11 de la
212: la suma debe igualar el total. Un campo editable que solo admite un valor es una trampa.)*

**R3.** CUANDO la persona añade una segunda línea, el panel DEBE volver **todos** los montos
editables y DEBE dejar el monto de la línea nueva vacío. *(No reparte el total por su cuenta: la
mitad exacta casi nunca es el cobro real, y un número inventado que cuadra es peor que un campo
vacío.)*

**R4.** El panel NO DEBE permitir más líneas que métodos disponibles, ni ofrecer en una línea un
método ya elegido en otra. *(Decisión [D2] de la 212: `@@unique(gestion_id, metodo)`. Dos
transferencias se registran como UNA línea con el monto sumado.)*

**R5.** El panel DEBE permitir quitar una línea MIENTRAS haya más de una, y al quedar una sola
DEBE volver al comportamiento de R2.

**R6.** MIENTRAS el editor tiene dos o más líneas, el panel DEBE mostrar de forma permanente la
suma de los montos capturados y el total a cobrar, y SI la suma no coincide EXACTAMENTE con el
total, ENTONCES DEBE mostrar el descuadre **antes** de que la persona intente enviar.

**R7.** CUANDO la persona confirma la gestión, el panel DEBE enviar el **desglose** (`pagos`) y
NO DEBE enviar el campo escalar `metodoPago`. *(R13 de la 212 rechaza las dos formas a la vez.)*

**R8.** CUANDO la persona confirma, el panel DEBE descartar las líneas sin método o sin monto
**antes** de enviar. *(Decisión humana [Q2] del 2026-08-12: filtrar es responsabilidad del panel;
el borde rechaza todo monto no positivo, así que una fila en blanco que llegue al servidor es un
error de validación, no una línea de 0.)*

**R9.** SI la orden es SIN cobro (`montoCobrar` 0 o nulo), ENTONCES el panel DEBE enviar **cero
líneas** y NO DEBE enviar ningún método. *(Hoy `GestionarOrdenPanel.tsx:331` fuerza `efectivo`
para el enum del backend; con desglose, «sin cobro» significa CERO líneas — R14 de la 212.)*

**R9b.** El panel DEBE comprobar el cuadre con **los mismos** helpers del borde
(`lib/utils/pagos-recaudo.ts`: `aCentimos`, `sumaCuadra`), sin reimplementar la comparación.
*(Una segunda fórmula del mismo dinero es exactamente el defecto que la feature 201 borró trece
veces, y la 204 midió en pantalla.)*

## B. La lectura: las tres pantallas

**R10.** Las tres presentaciones por gestión (`CierreDiaModule.tsx:886`,
`cierre-detalle-shared.tsx:898`, `cierre-factura.tsx:959`) DEBEN derivar el método mostrado
**exclusivamente del desglose `pagos`**, sin consultar el campo escalar `metodoPago`.
*(Autorizado por la medición: 0 filas reales tienen escalar sin línea. Y una gestión con escalar
y sin línea sería un defecto de escritura: mostrar «—» lo delata, mientras que un fallback lo
esconde.)*

**R11.** SI una gestión tiene **exactamente una** línea de pago, ENTONCES el sistema DEBE mostrar
solo la etiqueta legible del método, sin repetir el monto. *(El monto ya vive en su propia
columna; hoy la pantalla muestra exactamente eso y el caso de una línea es el 100 % de los datos
actuales: no debe cambiar de aspecto.)*

**R12.** SI una gestión tiene **dos o más** líneas, ENTONCES el sistema DEBE mostrar cada método
con su monto, en el orden de declaración del enum (`efectivo`, `SINPE`, `transferencia`) que ya
impone la consulta.

**R13.** SI una gestión no tiene ninguna línea, ENTONCES el sistema DEBE mostrar el mismo
marcador de ausencia que hoy (`—`).

**R14.** El sistema DEBE declarar el formato del desglose **en un solo lugar** y consumirlo desde
las tres pantallas y las dos descargas. *(R16 de la 188: no dos declaraciones separadas del mismo
criterio. Es el requisito que impide que la pantalla y el Excel diverjan en el separador.)*

**R15.** Las etiquetas DEBEN salir de `METODO_LABEL`; el sistema NO DEBE mostrar nunca el `value`
crudo del enum.

**R16.** El sistema DEBE formatear cada monto del desglose con el formateador único de dinero
(`lib/config/moneda.ts`). *(Feature 201: la app mostró la misma moneda de cuatro maneras
distintas; no se abre una quinta.)*

## C. Las dos descargas

**R17.** Las dos descargas (`cierre-dia-descarga-columnas.ts:101`,
`cierre-gestiones-descarga-columnas.ts:115`) DEBEN emitir el desglose **concatenado en la celda
escalar «Método»** que ya existe. *(Decisión [D4] de la 212: no se abre una columna por método ni
se multiplica la fila.)*

**R18.** El sistema NO DEBE alterar las constantes `COLUMNAS_DESCARGA_*` ni el orden de sus
columnas. *(Trece archivos de test congelan ese orden con `map(c => c.clave).toEqual(…)`; cambia
el CONTENIDO de una celda, no la forma del archivo.)*

**R19.** Las dos descargas DEBEN producir la misma cadena que la pantalla para la misma gestión.
*(Corolario verificable de R14, y el que hace que un solo test de mutación proteja los cinco
sitios.)*

## D. Lo que esta ficha NO toca

**R20.** El sistema DEBE corregir los dos comentarios que atribuyen el retiro de la forma escalar
a esta ficha (`lib/utils/pagos-recaudo.ts:47-49` e
`lib/interfaces/services/ICierreDiaService.ts:36`) para que apunten a la **214**.

**R21.** El sistema NO DEBE retirar ni el parámetro `metodoPago` del borde de escritura, ni
`normalizarPagos`, ni la columna `gestion_orden.metodo_pago`, ni el campo escalar del DTO.
*(Decisión [Q3]. Mientras haya un panel viejo vivo en producción mandando la forma escalar,
retirarla rompe la app. El orden correcto es: 213 desplegada → 214.)*

**R22.** El sistema NO DEBE modificar `computeTotales` ni ninguna fuente de los totales
`total_efectivo` / `total_simpe` / `total_transferencia`, que ya suman desde el desglose (R21-R30
de la 212). Esta ficha es de captura y presentación, y **la `E` del `min(P, E)` con que se paga a
los mensajeros no se toca**.

**R23.** El sistema NO DEBE modificar `CajaCodFeedService`, `WalletTiendaFeedService`,
`RecaudoAnaliticaRepository`, `AnaliticaFinancieraService`, `descripcion-pago.ts` ni ningún camino
de `LiquidacionPago` [D1/R33 de la 212].

## Preguntas abiertas para la puerta humana

**Q1 — ¿el desglose en pantalla va concatenado o apilado?** R12 dice «cada método con su monto»
sin fijar la forma. Propuesta: **la misma cadena en los cinco sitios**
(`Efectivo ₡5.000 + Transferencia ₡3.000`), porque R14 lo exige y porque una celda de tabla con
altura variable descuadra las cinco tablas. La alternativa —apilado en la factura, concatenado en
las tablas— es más bonita en el comprobante y cuesta una segunda declaración del formato.

**Q2 — ¿cuántos métodos por entrega?** El enum tiene tres (`efectivo`, `SINPE`, `transferencia`),
así que el tope natural de R4 es 3. Se confirma que no hay razón de negocio para limitarlo a 2.

**Q3 — el aspecto de «sin cobro».** Con R9 + R13, una entrega sin cobro pasa a mostrar `—` donde
hoy dice «Efectivo». Ya se aprobó a sabiendas el 2026-08-12 para la ventana entre merges, y esta
ficha lo vuelve permanente: **es el aspecto correcto** (no hubo cobro, no hay método). Se pide
confirmación de que sigue siendo lo deseado, no de la implementación.
