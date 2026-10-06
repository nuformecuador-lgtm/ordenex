# 476 — Informe de picking por WhatsApp — requirements

> Un informe más del catálogo de la 474 (`lib/whatsapp-envios/informes/`), que implementa su contrato
> `InformeWhatsapp<P>`. Leído de la rama `feature/474-envios-automaticos-whatsapp` (aún no en `dev`),
> en el worktree `.claude/worktrees/agent-ae9899ade67378902` (HEAD `52e349f5`): `lib/whatsapp-envios/informes/{tipos,catalogo,prueba-envio,aviso-interno}.ts`,
> `lib/services/EjecucionEnvioService.ts`, `lib/types/envios-whatsapp.ts`,
> `specs/474-envios-automaticos-whatsapp/design.md`, `progress/impl_474.md`. No tuve `git`: leí los
> archivos de ese worktree, que es la rama con backend + frontend de la 474.
>
> Maquetas aprobadas: `design-whatsapp/PdfPicking.dc.html` y `design-whatsapp/ParamsPicking.dc.html`.
> Las decisiones que se apartan de ellas están en `design.md` §1 y en las «Preguntas abiertas» de abajo.

## Glosario

- **Tienda con fulfillment**: usuario de rol `adminTienda` con `usuario.fulfillment = true`.
- **Orden en preparación**: orden con `deleted_at IS NULL` cuyo estado es `en_preparacion`.
- **Picking de una tienda**: el conjunto de órdenes en preparación de UNA tienda con fulfillment,
  leído en el instante en que el motor genera el informe (la «foto»).
- **Días en preparación** de una orden: los días calendario de Costa Rica entre la fecha CR en que
  entró en `en_preparacion` y la fecha CR del instante de generación.
- **Orden atrasada**: orden en preparación con días en preparación ESTRICTAMENTE mayores que el
  parámetro N («más de N días»).
- **Identificador de una orden**: su número de remisión (ver R11).
- **Producto interpretado**: cada ítem `cantidad * nombre` que sale del texto libre `orden.producto`
  con el parser medido de la ficha 345 (`lib/analytics/producto-parse.ts`).

## Requisitos

### Registro en el catálogo

- **R1** — El sistema DEBE registrar en el catálogo de informes de WhatsApp un informe de clave
  `picking` y nombre «Picking», que declare generar documento, que NO sea apto para `adminTienda`,
  que no ofrezca ningún evento y que no sea solo por evento.
- **R2** — El informe `picking` DEBE declarar exactamente dos parámetros: `tiendaId` (una tienda,
  obligatoria) y `diasAtraso` (entero entre 1 y 30, valor por defecto 2). SI los parámetros guardados
  no cumplen esa forma, ENTONCES el sistema DEBE rechazar el guardado con un error en el campo
  correspondiente.
- **R3** — CUANDO el formulario de un envío pinta el parámetro «Tienda» del picking, el sistema DEBE
  ofrecer solo las tiendas con fulfillment, ordenadas por nombre, y cada una con su número actual de
  órdenes en preparación y de órdenes atrasadas según el N que haya en el formulario.
- **R4** — SI quien pide la lista de tiendas del picking no es `maestro`, ENTONCES el sistema DEBE
  responder `forbidden` sin leer ninguna orden.
- **R5** — SI un envío con el informe `picking` incluye el rol `adminTienda` o un usuario de ese rol
  entre sus destinatarios, ENTONCES el sistema DEBE rechazar el guardado con un error en
  `destinatarios`.

### Qué órdenes entran (la foto)

- **R6** — CUANDO el motor genera el informe `picking`, el sistema DEBE tomar exactamente las órdenes
  no borradas, en estado `en_preparacion`, cuya tienda es la del parámetro `tiendaId` y tiene
  `fulfillment = true` en ese instante; ninguna otra.
- **R7** — SI la tienda del parámetro no existe, no es `adminTienda` o ya no tiene fulfillment al
  generar, ENTONCES el sistema DEBE terminar la ejecución en `error` con un motivo que diga que la
  tienda del envío ya no tiene fulfillment y que hay que revisar el envío, sin mandar ningún mensaje.
- **R8** — SI la tienda no tiene ninguna orden en preparación al generar, ENTONCES el sistema DEBE
  responder «vacío» con el motivo «La tienda <nombre> no tiene órdenes en preparación.» y no mandar
  ningún mensaje.
- **R9** — El sistema NO DEBE escribir nada en las órdenes ni en ninguna tabla de órdenes al generar
  el informe (sin lotes, sin códigos de lote, sin marcas): una orden que sigue en preparación en la
  generación siguiente DEBE volver a salir, y una que avanzó de estado NO DEBE salir.

### Productos y cantidades

- **R10** — El sistema DEBE interpretar el texto `orden.producto` de cada orden como una lista de
  productos `cantidad * nombre` con las reglas de la ficha 345: varios productos por orden, cantidad
  1 cuando el texto no trae marcador de cantidad, y el mismo producto identificado por su clave
  normalizada (mayúsculas, espacios repetidos y puntos finales no distinguen productos).
- **R11** — CUANDO una misma orden trae el mismo producto en varios ítems, el sistema DEBE sumar sus
  cantidades y contar esa orden UNA sola vez en ese producto.
- **R12** — CUANDO varias formas escritas comparten la misma clave de producto, el sistema DEBE
  mostrar la forma que aparece en más órdenes y, en empate, la menor por comparación de unidades de
  código.
- **R13** — SI el texto de producto de una orden no deja ningún producto interpretable, ENTONCES el
  sistema DEBE contarla en el total de órdenes, con 0 unidades, y listarla en una fila «Sin producto
  indicado».

### Días en preparación y atrasadas

- **R14** — El sistema DEBE calcular los días en preparación de cada orden tomando como entrada al
  estado la última transición registrada hacia `en_preparacion` en el historial de estados de la
  orden y, si no hay ninguna, la creación de la orden; ambas fechas en calendario de Costa Rica.
- **R15** — El sistema DEBE marcar como atrasada toda orden con días en preparación > `diasAtraso`, y
  NO DEBE marcar la que tenga exactamente `diasAtraso` días.

### El PDF

- **R16** — DONDE la plantilla del envío lleva documento, el sistema DEBE generar UN PDF A4 de la
  tienda del envío cuyo encabezado muestre el nombre de la tienda, la fecha larga y la hora de Costa
  Rica del instante de generación («hora de Costa Rica»), el número de órdenes y el número de
  unidades.
- **R17** — El PDF DEBE tener una tabla con una fila por producto: nombre, unidades, los
  identificadores de las órdenes que lo llevan (con «×k» cuando una orden lleva k > 1 unidades de
  ese producto) y una casilla vacía para marcar; ordenada por unidades descendente y, en empate, por
  nombre ascendente por unidades de código.
- **R18** — El sistema DEBE usar como identificador de cada orden su número de remisión y, SI la orden
  tiene número de guía, añadirlo entre paréntesis («<remisión> (guía <n>)»).
- **R19** — MIENTRAS haya al menos una orden atrasada, el PDF DEBE mostrar sobre la tabla un bloque que
  diga cuántas órdenes llevan más de N días en preparación y liste sus identificadores con sus días,
  de más a menos días, y DEBE pintar esos identificadores en la tabla con una marca distinta que
  incluya sus días.
- **R20** — El PDF DEBE cerrar la tabla con una fila de total con el número de productos, el total de
  unidades y el número de órdenes.
- **R21** — SI el contenido no cabe en una página, ENTONCES el sistema DEBE continuar en páginas
  siguientes repitiendo la cabecera de la tabla, y cada página DEBE llevar un pie con la tienda, la
  fecha y hora de la foto y «Página X de Y».
- **R22** — SI un texto que viene de los datos (nombre de tienda, producto, remisión) contiene un
  carácter que la fuente del PDF no puede imprimir, ENTONCES el sistema DEBE sustituirlo por «?» y
  avisar en el PDF de cuántos caracteres se sustituyeron; NO DEBE borrarlo en silencio ni hacer fallar
  la ejecución.
- **R23** — El sistema DEBE nombrar el PDF `picking-<tienda>-<AAAA-MM-DD>.pdf`, con `<tienda>` en
  minúsculas ASCII separadas por guiones y la fecha calendario de Costa Rica.
- **R24** — DONDE la plantilla del envío NO lleva documento, el sistema DEBE devolver solo los valores
  de las variables, sin generar PDF.

### Variables

- **R25** — El informe `picking` DEBE declarar las variables `tienda`, `ordenes`, `unidades`,
  `productos`, `atrasadas`, `dias_atraso`, `remision_desde`, `remision_hasta`, `fecha` y `hora`, un dato
  cada una, y DEBE dar a cada una un valor no vacío cuando hay contenido. (`destinatario_nombre` la
  añade la 474 como común.)
- **R26** — El sistema DEBE dar a `remision_desde` y `remision_hasta` la primera y la última remisión de
  las órdenes del picking en el orden natural de remisiones de la ficha 423.
- **R27** — Los valores de `ordenes`, `unidades`, `productos` y `atrasadas` DEBEN ser iguales a las
  cifras que imprime el PDF de la misma ejecución.
- **R28** — El sistema DEBE expresar `fecha` («DD/MM/AAAA») y `hora` («HH:mm») en la hora de pared de
  Costa Rica del instante de generación.

### Calidad

- **R29** — El sistema DEBE leer las órdenes del picking con un número de consultas a la base que no
  dependa del número de órdenes.
- **R30** — El informe `picking` registrado en el catálogo DEBE leer de la base real: generado por
  `informePorClave("picking")` contra Postgres, DEBE devolver las órdenes sembradas para esa tienda.

## Preguntas abiertas

1. **Un envío por tienda en vez de «Tiendas» con casillas** (design §1, decisión D1). El contrato de
   la 474 manda UN documento y UN juego de valores por ejecución, y solo una ejecución programada por
   envío y día (`UNIQUE (envio_id, fecha_cr) WHERE origen = 'programado'`). Para que «cada tienda
   reciba su propio PDF» sin rehacer el motor, se crea un envío por tienda (hoy tres: Sicommer,
   Gameos, Nuform) y el parámetro es «Tienda», de una sola elección. Se aparta de la maqueta aprobada
   `ParamsPicking.dc.html`, que pinta casillas. ¿Lo aceptas, o prefieres que se amplíe el motor de la
   474 para mandar varios documentos por ejecución (design §9, alternativa A)?
2. **Que no llegue a `adminTienda`** (D3). El picking lo hace la bodega de Ordenex, y permitir que le
   llegue a la tienda sin enseñarle datos de otras pediría ampliar el validador de destinatarios de
   la 474 (hoy es un booleano por informe). ¿Lo dejas fuera, o lo pides como ficha aparte?
3. **La columna dice «Remisiones», no «Guías»** (D2). Por construcción, las órdenes en preparación no
   tienen guía: nacen sin ella (`resolverDestinoCreacion`, `conGuia: false`) y la guía se genera al
   salir hacia `en_bodega_central`. La maqueta dice «Guías que lo llevan» con números de guía. ¿Te
   vale la remisión como identificador en el papel?
