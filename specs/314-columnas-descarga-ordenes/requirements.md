# Ficha 314 — la descarga del listado de órdenes deja elegir qué columnas salen

Requisitos en notación EARS. Sin decisiones de implementación (esas van en `design.md`).

## Contexto y alcance

Hoy el botón de descarga de `/ordenes` emite **15 columnas fijas** (`COLUMNAS_DESCARGA_ORDENES`,
verificado en `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts`). Al descargar un
**manifiesto** el usuario ya puede elegir columnas desde la feature 194. Esta ficha lleva esa
misma capacidad a la descarga del listado de órdenes, **reutilizando** el mecanismo existente en
vez de escribir otro, y le añade **reordenar**.

Tres decisiones tomadas por el humano el 2026-08-28, que aquí NO se reabren:

1. El mecanismo se **generaliza**, pero se **enciende solo en órdenes**. Las otras tablas del
   `DataTable` no cambian hoy.
2. El catálogo de órdenes se **amplía** con siete datos que ya viajan en el DTO del listado y hoy
   no se exportan.
3. El selector **gana reordenar**, y eso aplica al componente entero y a todos los sitios donde se
   use, **manifiesto incluido**.

**Fuera de alcance:** el backend (verificado: los siete datos ya viajan en el DTO que devuelve
`listarOrdenesCompleto`), las columnas que se ven en la tabla en pantalla, y encender el selector
en cualquier otra tabla.

---

## Grupo A — el selector en la descarga de órdenes

**R1.** CUANDO el usuario abre el listado de órdenes y la descarga está disponible, el sistema DEBE
ofrecer, junto al botón de descarga, un control propio que abre la elección de columnas.

**R2.** CUANDO el usuario abre ese control, el sistema DEBE presentar una opción por cada columna
del catálogo de descarga de órdenes, sin omitir ninguna.

**R3.** El sistema DEBE nombrar cada opción con el mismo encabezado con el que esa columna sale en
el archivo.

**R4.** MIENTRAS una columna esté marcada en el ámbito de órdenes, el sistema DEBE emitirla en el
archivo descargado.

**R5.** MIENTRAS una columna esté desmarcada en el ámbito de órdenes, el sistema NO DEBE emitirla
en el archivo descargado.

**R6.** CUANDO el usuario pulsa el botón de descarga, el sistema DEBE producir el archivo en un
solo paso con la elección ya guardada, sin pedir confirmación de columnas.

**R7.** SI la acción del usuario dejaría el archivo sin ninguna columna marcada, ENTONCES el
sistema DEBE impedirla y mantener marcada al menos una columna.

**R8.** CUANDO el usuario pulsa «Restablecer», el sistema DEBE dejar todas las columnas del ámbito
marcadas y en el orden declarado por el catálogo.

**R9.** CUANDO el usuario cambia la elección, el sistema DEBE conservarla en ese navegador para las
descargas siguientes, incluso después de recargar la página.

**R10.** El sistema DEBE mantener separada la preferencia de cada ámbito: cambiar la de órdenes NO
DEBE alterar la de ningún flujo de manifiesto, ni al revés.

---

## Grupo B — el catálogo de órdenes se amplía

**R11.** El sistema DEBE ofrecer como columnas elegibles de la descarga de órdenes, además de las
que ya ofrece, el teléfono del destinatario, las notas, el peso, el día de reparto, la fecha de
reprogramación, el flete con IVA y la comisión con IVA.

**R12.** El sistema DEBE emitir el flete con IVA y la comisión con IVA tal como los entrega el
servidor, sin operar con ellos en el navegador.

**R13.** El sistema DEBE emitir el día de reparto y la fecha de reprogramación tal como los entrega
el servidor, sin construir ninguna fecha en el navegador.

**R14.** SI la orden no trae dato para una columna, ENTONCES el sistema DEBE emitir esa celda vacía
y nunca un texto de relleno de pantalla.

**R15.** El sistema NO DEBE emitir en ninguna columna del catálogo identificadores internos,
credenciales, secretos ni banderas de borrado.

**R16.** MIENTRAS el usuario no tenga preferencia guardada para el ámbito de órdenes, el sistema
DEBE emitir el catálogo completo, en el orden declarado por el catálogo.

**R17.** El sistema DEBE conservar el orden relativo que hoy tienen entre sí las columnas ya
existentes del catálogo de órdenes.

---

## Grupo C — reordenar

**R18.** CUANDO el usuario abre el selector, el sistema DEBE ofrecer, para cada columna, una forma
de moverla hacia arriba y hacia abajo dentro de la lista.

**R19.** CUANDO el usuario mueve una columna, el sistema DEBE reflejar el nuevo orden en la lista y
conservarlo para las descargas siguientes.

**R20.** MIENTRAS haya un orden guardado para un ámbito, el sistema DEBE emitir las columnas de ese
archivo en ese orden.

**R21.** El sistema DEBE ofrecer el reordenamiento en todos los lugares donde se use el selector,
el manifiesto incluido.

**R22.** SI una columna es la primera de la lista, ENTONCES el sistema DEBE impedir moverla hacia
arriba.

**R23.** SI una columna es la última de la lista, ENTONCES el sistema DEBE impedir moverla hacia
abajo.

**R24.** CUANDO el usuario mueve una columna, el sistema NO DEBE cambiar si esa columna está
marcada o desmarcada, ni la de ninguna otra.

**R25.** El sistema DEBE permitir mover tanto las columnas marcadas como las desmarcadas.

---

## Grupo D — una columna publicada después de que el usuario fijara su orden

Este grupo es la razón de que la ficha lleve SDD. La feature 194 guarda las columnas **ocultas** y
no las visibles, precisamente para que una columna publicada mañana **aparezca sola** sin migrar la
preferencia de nadie. Un orden explícito guardado reabre la pregunta de **dónde cae** esa columna.

**R26.** CUANDO se publique una columna nueva en un catálogo, el sistema DEBE presentarla marcada y
emitirla, sin que haya que migrar ni reescribir la preferencia ya guardada de ningún usuario.

**R27.** CUANDO se publique una columna nueva y el usuario ya tuviera un orden guardado, el sistema
DEBE colocarla inmediatamente después de la columna que la precede en el catálogo y que esté
presente en el orden del usuario.

**R28.** SI ninguna columna del catálogo que preceda a la columna nueva está presente en el orden
guardado del usuario, ENTONCES el sistema DEBE colocarla al principio de la lista.

**R29.** SI el orden guardado contiene una clave que ya no corresponde a ninguna columna publicada,
ENTONCES el sistema DEBE ignorarla.

**R30.** El sistema DEBE seguir tratando como válida una preferencia guardada antes de esta ficha:
las mismas columnas ocultas y el orden del catálogo.

**R31.** SI la preferencia guardada es ilegible, tiene otra forma, o dejaría el archivo sin
columnas, ENTONCES el sistema DEBE proceder como si no hubiera preferencia y NUNCA impedir la
descarga.

**R32.** MIENTRAS haya dos superficies vivas del mismo ámbito, el sistema DEBE reflejar en ambas el
cambio de preferencia sin recargar la página.

---

## Grupo E — lo que no cambia

**R33.** DONDE una tabla no declare ámbito de preferencia de columnas, el sistema NO DEBE mostrar
el selector y DEBE emitir todas las columnas que esa tabla declara.

**R34.** El sistema DEBE conservar, en la descarga de órdenes, el mismo conjunto de filas, los
mismos filtros aplicados, el mismo acotamiento por rol, los mismos formatos ofrecidos y el mismo
nombre de archivo que produce hoy.

**R35.** El mecanismo de preferencia de columnas NO DEBE asumir un número fijo de columnas: opera
sobre la lista de columnas publicadas que recibe.

---

## Trazabilidad

El mapa `R<n>` → test concreto vive en `tasks.md`, sección «Mapa de trazabilidad». Un requisito sin
test es un fallo de la feature.

---

## Preguntas abiertas — RESPONDIDAS por el humano el 2026-08-28

Las cuatro quedaron cerradas antes de implementar. Ninguna se reabre.

| # | Respuesta |
| --- | --- |
| 1 | **Los siete encabezados se aceptan tal cual**, incluidos «Fecha de reprogramación» (y no «Liberada el») y «Peso (kg)» (y no «Peso»). |
| 2 | **Los dos importes salen como TEXTO**, igual que el resto de descargas de dinero. Excel no los autosuma, y se acepta: convertirlos reintroduciría en el navegador la aritmética que la feature 204 quitó, y ahí 14 de 66 órdenes medidas salían un céntimo desviadas del cierre. |
| 3 | **Una sola preferencia para toda la pantalla** de órdenes, no una por pestaña. |
| 4 | **Las siete columnas nuevas van INTERCALADAS por afinidad**: el teléfono junto al destinatario, el peso junto al producto, los dos importes junto al monto, las dos fechas junto a la de creación (y las notas al final, por ser texto largo). El orden relativo de las 15 actuales no cambia (R17). |

Además, la **Q7 de `tasks.md`** —no era una decisión, sino la consecuencia de la 3 y la 4— queda
**ratificada**: quien nunca abra el selector pasa de 15 a 22 columnas en su archivo.

El texto original de las cuatro preguntas se conserva abajo, para que se lea qué se preguntó y con
qué alternativas, no solo qué se respondió.

---

1. **Encabezados de las siete columnas nuevas.** Los encabezados son contrato (hay una guardia que
   exige una aserción literal de orden sobre el catálogo), así que se confirman antes de
   implementar. Propuesta, con su procedencia:

   | Dato | Encabezado propuesto | De dónde sale |
   | --- | --- | --- |
   | `telefonoDest` | Teléfono del destinatario | no hay etiqueta previa en la app; se propone |
   | `notas` | Notas de la tienda | nombre canónico en `lib/types/plantilla-datos.ts` |
   | `peso` | Peso (kg) | nombre canónico «Peso»; la unidad va en el encabezado para que la celda siga siendo numérica |
   | `fechaRepartoISO` | Día de reparto | nombre canónico en `lib/types/plantilla-datos.ts` |
   | `fechaReprogramacion` | Fecha de reprogramación | la tabla en pantalla la llama «Liberada el», que fuera de la pestaña de reprogramadas se entiende peor |
   | `fleteConIva` | Flete + IVA | idéntico al de la tabla en pantalla |
   | `comisionConIva` | Comisión + IVA | idéntico al de la tabla en pantalla |

   ¿Se aceptan los siete? En particular «Fecha de reprogramación» frente a «Liberada el», y
   «Peso (kg)» frente a «Peso». → **SÍ, los siete tal cual** (2026-08-28).

2. **Los dos importes salen como texto.** `fleteConIva` y `comisionConIva` llegan del servidor como
   cadena de escala 2 (feature 204) y se emiten **tal cual**, igual que ya hace el desglose de
   tiendas. La consecuencia es que en Excel esa celda es texto y la hoja no la autosuma.
   Convertirla a número reintroduciría en el navegador la aritmética que la 204 quitó (14 de 66
   órdenes medidas salían un céntimo desviadas). ¿Se acepta el mismo criterio que en el resto de
   descargas de dinero, o se prefiere celda numérica asumiendo la conversión? → **TEXTO, el mismo
   criterio que el resto de descargas de dinero** (2026-08-28).

3. **Una preferencia para toda la pantalla, o una por pestaña.** `/ordenes` filtra por estado y por
   otros criterios dentro de la misma pantalla. El manifiesto sí separa por flujo porque cada flujo
   es una operación distinta. Propuesta: **una sola** preferencia para toda la descarga de
   `/ordenes`. ¿Se confirma? → **SÍ, una sola para toda la pantalla** (2026-08-28).

4. **Las columnas nuevas se intercalan por afinidad** (el teléfono junto al destinatario, el peso
   junto al producto, los dos importes junto al monto, las dos fechas junto a la de creación) en
   vez de añadirse todas al final. El orden **relativo** de las 15 actuales no cambia (R17), pero
   quien hoy lea la hoja por número de columna verá desplazamientos. ¿Se confirma la afinidad, o se
   prefiere añadirlas al final para no mover ni una posición? → **SÍ, intercaladas por afinidad**
   (2026-08-28).
