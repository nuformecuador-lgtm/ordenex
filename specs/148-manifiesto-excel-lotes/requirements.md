# Feature 148 — Manifiesto Excel al crear o mover órdenes · requirements

> Notación EARS. Cada `R<n>` debe terminar mapeado a un test concreto (ver `tasks.md`).
> Alcance cerrado con el humano ANTES del spec (D1/D2/D3, ver `design.md §0`): generación
> en CLIENTE, 5 puntos de enganche, SIN modelo nuevo en base de datos.

## Glosario

- **Lote**: conjunto de órdenes afectadas por UNA operación por lote (creación por carga
  masiva o transición de estado por lote).
- **Manifiesto**: archivo `.xlsx` con una fila por orden del lote y las 11 columnas de R2.
- **Flujo**: cada uno de los 5 puntos de enganche (R13–R17).
- **Módulo de manifiesto**: el único componente de software que arma las filas del
  manifiesto para todos los flujos.

---

## A. Armado del manifiesto (servicio único)

**R1** — El sistema DEBE armar el manifiesto de CUALQUIER flujo con un único módulo de
manifiesto; ningún flujo DEBE construir filas de manifiesto por su cuenta.

**R2** — ~~El manifiesto DEBE tener exactamente estas 11 columnas, en este orden:
`num_guia`, `num_remision`, `destinatario`, `telefono`, `direccion`, `zona`, `monto`,
`origen`, `destino`, `responsable`, `fecha`.~~

> **DEROGADO Y REFORMULADO el 2026-07-29 por la feature 160 (su R28).** Ver la nota de
> corrección al final de esta sección. El manifiesto SIGUE teniendo esas columnas, en ese
> orden relativo; lo que deja de ser cierto es el **"exactamente"**: el conjunto es ABIERTO
> y crece cuando la orden gana un dato nuevo.

**R3** — CUANDO se arma un manifiesto para un lote de N órdenes válidas, el sistema DEBE
producir exactamente N filas de datos, una por orden, en el mismo orden en que las órdenes
fueron recibidas.

**R4** — El sistema DEBE poblar `num_guia`, `num_remision`, `destinatario`, `telefono` y
`direccion` con los datos vigentes de la orden en el momento de armar el manifiesto.

**R5** — SI una orden no tiene `num_guia` asignado, ENTONCES el sistema DEBE dejar la celda
`num_guia` vacía, sin abortar el manifiesto ni sustituir el valor por un texto inventado.

**R6** — El sistema DEBE poblar `zona` con el NOMBRE de la zona de la orden (no su id).

**R7** — El sistema DEBE poblar `monto` con el valor numérico de cobro de la orden; SI la
orden no tiene monto de cobro, ENTONCES la celda DEBE quedar vacía.

**R8** — El sistema DEBE poblar `origen` y `destino` con la ubicación de salida y la
ubicación de llegada del movimiento propio de CADA flujo, según la tabla de `design.md §4`.

**R9** — El sistema DEBE poblar `responsable` con la persona que queda a cargo de las
órdenes tras la operación, según la tabla de `design.md §4`.

**R10** — El sistema DEBE poblar `fecha` con la fecha calendario de Costa Rica del momento
en que se ejecuta la operación, en formato `YYYY-MM-DD`.

**R11** — El manifiesto NO DEBE contener identificadores internos, banderas de borrado ni
datos que no sean de la orden (en particular: ids internos, `deleted_at`, notas ni datos de
otras entidades).

> **REFORMULADO el 2026-07-29 por la feature 160 (su R28).** El texto original decía "fuera
> de las 11 columnas de R2". El lado PROHIBITIVO sigue intacto y es lo que se conserva
> arriba; la referencia al conjunto cerrado de 11 columnas se retira.

### Nota de corrección — 2026-07-29 (feature 160, R28 · design 160 §6.3)

Decisión del humano, textual: *"cada que un dato de una orden es agregado, este dato también
debe aparecer en los manifiestos, y el número de intentos es un dato propio de una orden"*.

Lectura correcta de esta spec: R2/R11 nunca quisieron decir "el manifiesto está congelado en
11 columnas". Su intención era **que el manifiesto refleje los datos de la tabla de órdenes** y
que no se cuelen ahí campos que no son de la orden (`ordenId`, `tiendaId`, `deletedAt`). El
"11" era el inventario **de ese momento**, no un tope.

**Regla vigente, que reemplaza al conjunto cerrado:**

> **El manifiesto refleja los datos de la orden.** Lleva una columna por cada dato propio de la
> orden que el producto haya decidido exponer, y ese conjunto **crece** cuando la orden gana un
> dato nuevo. Ni el código ni sus pruebas DEBEN afirmar que el manifiesto tiene un número
> cerrado de columnas: las pruebas verifican que ciertas columnas ESTÁN, con su clave y su
> orden relativo, no que no existan otras.

**Efecto concreto:** el manifiesto suma la columna `intentos` (intentos de entrega vigentes de
la orden), con valor numérico `0` para las órdenes sin intentos — celda con `0`, no celda
vacía. Las aserciones de "exactamente N columnas" se retiraron de
`tests/unit/utils/manifiesto-xlsx.test.ts` y `tests/unit/services/manifiesto-service.test.ts`.

**R12** — SI una orden solicitada no existe o está borrada, ENTONCES el sistema DEBE
omitirla del manifiesto, reportar cuántas se omitieron y NO abortar el manifiesto de las
demás.

## B. Archivo y descarga

**R13** — CUANDO el usuario pide la descarga del manifiesto, el sistema DEBE producir un
archivo `.xlsx` válido, reabrible por un lector de hojas de cálculo, con una sola hoja y
una fila de cabecera con los nombres de columna de R2.

**R14** — El sistema DEBE nombrar el archivo descargado
`manifiesto-<flujo>-<YYYY-MM-DD>.xlsx`, donde `<flujo>` identifica el punto de enganche y
`<YYYY-MM-DD>` es la fecha de R10.

**R15** — El sistema DEBE generar el binario del manifiesto en el navegador del usuario y
descargarlo directamente, SIN persistirlo en almacenamiento ni en base de datos.

**R16** — MIENTRAS el manifiesto se está generando, el sistema DEBE impedir que se dispare
una segunda generación del mismo lote.

**R17** — SI el lote no tiene ninguna orden con fila de manifiesto, ENTONCES el sistema NO
DEBE ofrecer la descarga y NO DEBE generar ningún archivo.

## C. Puntos de enganche (los 5 flujos)

**R18** — CUANDO una carga masiva de órdenes termina con al menos una orden creada, el
sistema DEBE ofrecer al usuario la descarga del manifiesto de las órdenes creadas en ese
lote.

**R19** — CUANDO la generación de guía por lote (incluida su variante "asignar desde
bodega") termina con éxito, el sistema DEBE ofrecer la descarga del manifiesto de las
órdenes del lote.

**R20** — CUANDO el ruteo a bodega satélite por lote termina con éxito, el sistema DEBE
ofrecer la descarga del manifiesto de las órdenes ruteadas.

**R21** — CUANDO la asignación desde la bodega satélite termina con éxito, el sistema DEBE
ofrecer la descarga del manifiesto de las órdenes asignadas.

**R22** — CUANDO el envío de devolución a la bodega central termina, el sistema DEBE
ofrecer la descarga del manifiesto de las órdenes efectivamente enviadas (excluyendo las
que fallaron).

**R23** — CUANDO el envío a la tienda termina, el sistema DEBE ofrecer la descarga del
manifiesto de las órdenes efectivamente enviadas (excluyendo las que fallaron).

## D. Aislamiento respecto a la operación de negocio

**R24** — El armado y la descarga del manifiesto NO DEBEN modificar ningún dato de negocio.

**R25** — SI el armado o la descarga del manifiesto falla, ENTONCES el sistema DEBE
conservar íntegramente el resultado de la operación de negocio ya cometida (sin revertirla,
sin reintentarla y sin re-ejecutar la acción de negocio).

**R26** — SI el armado o la descarga del manifiesto falla, ENTONCES el sistema DEBE
informar el fallo al usuario con un mensaje accionable, manteniendo visible el resultado de
la operación de negocio.

**R27** — El sistema NO DEBE alterar el contrato de entrada ni el resultado de éxito/error
que hoy devuelven los servicios de negocio de los 5 flujos por causa de esta feature.

## E. Autorización y borde

**R28** — SI la petición de datos del manifiesto llega sin sesión válida, ENTONCES el
sistema DEBE rechazarla sin devolver datos de ninguna orden.

**R29** — DONDE el actor sea una llave de API, el sistema DEBE incluir en el manifiesto
únicamente órdenes de la tienda dueña de esa llave.

**R30** — SI la entrada de la petición de datos del manifiesto no es válida (selección
vacía, identificador malformado o flujo desconocido), ENTONCES el sistema DEBE rechazarla
con un error de validación y sin devolver datos.

---

## Preguntas abiertas

Estas quedan para el gate F1.4 (se repiten numeradas en `design.md §9`); ninguna se resolvió
por suposición:

1. **"Envío a la tienda" (R23)**: localizado como `DevolucionOrigenService.devolverATienda`
   (`lib/services/DevolucionOrigenService.ts:35`), que es POR ORDEN; el lote existe solo en
   la UI (`app/(app)/ordenes/_components/DevolverATiendaModal.tsx:49-52`, loop `await`).
   ¿Se acepta enganchar el manifiesto al lote de la UI (selección del modal) sin tocar el
   service?
2. **Etiqueta de la bodega central en `origen`/`destino`**: se propone el `nombre` de la
   zona marcada `esCentral`. ¿Qué texto se usa si no hay zona central configurada?
3. **`monto` con IVA/flete**: se propone el valor de cobro al destinatario
   (`orden.monto_cobrar`), no el costo de envío. ¿Correcto?
4. **`telefono`**: se usa el teléfono del DESTINATARIO. ¿Correcto (vs. el de la tienda)?
5. **`fecha`**: fecha de la OPERACIÓN (día en que se descarga el manifiesto), no la fecha de
   creación de la orden. ¿Correcto?
6. **Carga masiva por chunks**: el manifiesto cubre el lote completo del archivo (todas las
   filas creadas), no chunk por chunk. ¿Correcto?
7. **Descarga automática vs. botón**: se propone un BOTÓN explícito en el resultado de cada
   flujo (no descarga automática al cerrar el modal). ¿Se acepta?
