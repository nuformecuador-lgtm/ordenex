# Feature 143 — Descargar en Excel las filas con error de la carga masiva

> Zona: `frontend` · Complejidad: `medium` · `depends_on: 142` (plantilla v2, ya en `dev`).
> Notación EARS (`docs/specs.md`). Cada `R<n>` debe terminar mapeado a un test.

## Contexto

Tras validar un archivo de carga masiva, el modal muestra los hallazgos (paso
"Revisar hallazgos") con una tabla de solo lectura de las filas cuyo
`resultado === "error"`. Hoy el usuario debe corregirlas a mano en su archivo
original, buscándolas una por una. Esta feature añade un botón que descarga un
`.xlsx` con esas filas, en el mismo formato de la plantilla vigente, más una
columna con el motivo, para corregir y volver a subir sin retrabajo.

## Alcance

Dentro:
- Botón de descarga en la superficie que ya lista las filas con error.
- Generación del binario XLSX en el navegador (sin endpoint nuevo, sin backend).
- Garantía explícita de round-trip: el archivo exportado se puede volver a subir.

Fuera:
- **Errores de CABECERA.** Si el archivo se rechaza por columnas obligatorias
  ausentes (`findMissingHeaders`), no llega a validarse ninguna fila: no existe
  el grupo `errores` y por tanto no hay nada que exportar. Ver R17.
- **Errores de la carga REAL (post-confirmación).** El botón vive únicamente en el
  paso de vista previa. El paso `asignacion` (posterior a la carga real) hoy solo
  avisa por toast y no tiene ninguna superficie que liste filas con error:
  añadirla sería construir UI nueva fuera del objetivo, y el momento útil de la
  descarga es **antes** de crear nada (decisión de gate G-1). Ver R20.
- **Formato CSV.** Solo `.xlsx`, el formato de la plantilla vigente
  (decisión de gate G-3). Ver R21.
- Filas `duplicada` (ya existentes o repetidas intra-archivo). Solo `error`.
- Corregir, reintentar o re-enviar filas desde la propia app.
- Cualquier cambio de contrato en el backend, el endpoint de chunks o el schema
  de fila.

## Decisiones de producto ya cerradas con el humano (no re-abrir)

- **D-A.** El motivo del error viaja en una **columna extra al final**, después
  de `notas`, con cabecera exacta `motivo_error`. **Una sola hoja.** No hay hoja
  aparte.
- **D-B.** Las celdas de las 8 columnas de la plantilla llevan los **valores
  crudos del archivo original** (lo que el usuario tecleó, tal como lo devolvió
  el parser del navegador en `FilaParseada.row`), cruzados por número de línea.
  No se exportan valores normalizados ni derivados.

## Decisiones del gate F1.4 (cerradas con el humano)

- **G-1.** Alcance = **solo la vista previa**. El botón vive únicamente en
  `OrdenesCargaPreview`. Los errores de la carga real post-confirmación quedan
  fuera de alcance explícito (R20).
- **G-2.** La **identificación de la fila original viaja dentro de
  `motivo_error`**, como prefijo `Fila N — ` al principio de la celda, una sola
  vez aunque haya varios campos/mensajes. Resuelve el caso de `num_remision`
  vacío o repetido sin añadir una segunda columna extra, respetando D-A
  ("una sola columna extra al final") (R6, R7, R22).
- **G-3.** **Solo `.xlsx`**. No se ofrece descarga en CSV (R21).

## Requisitos

### Formato del archivo

**R1.** El sistema DEBE generar un archivo XLSX de **una sola hoja** cuyas
columnas sean, en este orden: las 8 columnas de la plantilla vigente
(`ORDENES_BULK_FIELDS`, en el orden de esa lista) y, como **última** columna,
`motivo_error`.

**R2.** El sistema DEBE escribir como texto de cada celda de cabecera la **clave
máquina exacta** de la columna (`destinatario`, `telefono`,
`direccion_destinatario`, `monto_cobrar`, `producto`, `num_remision`, `peso`,
`notas`, `motivo_error`), sin etiquetas legibles, sin sufijos y sin marcas de
obligatoriedad.

**R3.** El sistema DEBE emitir exactamente una fila de datos por cada fila con
`resultado === "error"` de la clasificación vigente, conservando el orden en que
esas filas aparecen en la clasificación.

**R4.** Para cada fila con error cuyo número de fila case con la `linea` de una
fila parseada del archivo original, el sistema DEBE escribir en cada una de las
8 columnas de la plantilla el **valor crudo** que esa fila parseada tiene bajo
la clave de la columna, y celda vacía si la clave no está presente.

**R5.** SI una fila con error no tiene número de fila (`null`) o su número no
casa con ninguna fila parseada, ENTONCES el sistema DEBE emitir igualmente su
fila, con las 8 columnas de la plantilla vacías salvo `num_remision` (que toma
el valor conocido de la fila con error, o vacío si no hay), y sin interrumpir la
generación del resto del archivo ni lanzar un error.

**R6.** El sistema DEBE escribir en `motivo_error` el número de la fila original
como prefijo, seguido del detalle del error, con el formato
`Fila <N> — <detalle>` (p. ej. `Fila 7 — telefono: debe tener 8 dígitos`), donde
`<detalle>` es exactamente el texto que se muestra en la columna "Motivo" de la
tabla de órdenes con error para esa misma fila.

**R7.** SI una fila con error no aporta ningún mensaje de detalle (mapa de
errores vacío o sin mensajes), ENTONCES el sistema DEBE escribir en
`motivo_error` el prefijo seguido del motivo genérico, es decir
`Fila <N> — Error de validación`.

**R8.** El sistema DEBE producir un texto de `motivo_error` **determinista**: el
detalle lista los campos separados por `; ` y los mensajes de un mismo campo por
`, `, y dos generaciones sobre la misma clasificación producen exactamente el
mismo texto, celda por celda.

### Interacción

**R9.** CUANDO el usuario pulse el botón de descarga, el sistema DEBE generar el
binario en el navegador y disparar la descarga **sin realizar ninguna petición
de red** (ni al endpoint de chunks ni a ninguna ruta nueva).

**R10.** CUANDO se dispare la descarga, el sistema DEBE nombrar el archivo
`ordenes-con-error-<AAAAMMDD>-<HHmm>.xlsx`, con fecha y hora locales del momento
de la descarga.

**R11.** MIENTRAS la clasificación vigente no tenga ninguna fila con error, el
sistema NO DEBE renderizar el botón de descarga.

**R12.** MIENTRAS una generación esté en curso, el sistema DEBE mostrar el botón
en estado ocupado y NO DEBE iniciar una segunda generación aunque se pulse de
nuevo.

**R13.** SI la generación del archivo falla, ENTONCES el sistema DEBE informar
al usuario del fallo, dejar el botón nuevamente disponible y mantener operativo
el resto del paso (tabla de errores y confirmación de la carga).

### Round-trip (el riesgo central)

**R14.** El archivo exportado DEBE poder re-subirse: al re-parsearlo, la
comprobación de cabeceras obligatorias no DEBE reportar ninguna columna ausente,
tanto por la vía del parser del navegador como por la del parser del servidor.

**R15.** El sistema DEBE producir, al re-parsear el archivo exportado, para cada
una de las 8 claves de la plantilla, **el mismo valor** que produciría el mismo
archivo sin la columna `motivo_error`; es decir, la columna extra no altera el
resultado del parseo de ninguna otra columna, en ambos parsers.

**R16.** El sistema DEBE descartar silenciosamente la clave `motivo_error` al
validar una fila re-subida: la fila validada no contiene ese campo y su presencia
no produce ningún error de validación.

**R17.** MIENTRAS un archivo sea rechazado por cabecera incompleta, el sistema NO
DEBE ofrecer la descarga de filas con error (no hay clasificación ni filas con
error en ese estado).

### No regresión

**R18.** El sistema DEBE seguir generando la plantilla de carga masiva vacía
exactamente con sus 8 columnas y sin `motivo_error`.

**R19.** El módulo que compone las filas a exportar DEBE ser puro (sin DOM, sin
React) y NO DEBE cargar la librería de generación XLSX en el bundle inicial: la
dependencia se resuelve con import dinámico dentro de la función que construye
el binario.

### Alcance cerrado en el gate F1.4

**R20.** MIENTRAS el modal esté en el paso posterior a la carga real
(asignación), el sistema NO DEBE ofrecer la descarga de filas con error: la
descarga existe únicamente en el paso de vista previa (decisión G-1).

**R21.** El sistema DEBE ofrecer la descarga **únicamente** en formato `.xlsx`
(decisión G-3); no DEBE existir una opción de descarga en CSV para las filas con
error.

**R22.** SI una fila con error no tiene número de fila (`null`) o su número no
casa con ninguna fila parseada, ENTONCES el sistema DEBE omitir el prefijo
`Fila <N> — ` y escribir en `motivo_error` solo el detalle (o el motivo genérico
de R7), sin inventar un número de fila.

---

**Preguntas abiertas: ninguna.** Las tres que quedaban tras la primera redacción
se resolvieron en el gate F1.4 (ver "Decisiones del gate F1.4" arriba y
`design.md > Preguntas abiertas — resueltas`).
