# Feature 32 — Etiqueta de guía con QR y código de barras — requirements (EARS)

> Estado: `in_progress` (F2.0). **F1.4 APROBADA por el humano 2026-07-11** (ver "Decisiones F1.4"
> más abajo). Decisión clave: la etiqueta es un **PDF de 100mm × 100mm** por orden (no HTML print).
>
> Depende de la feature 17 (Generar guía asigna `num_guia`). Alcance: generar y
> renderizar una ETIQUETA imprimible por orden con QR + código de barras, y
> exponer los datos necesarios. NO construye la recepción por escaneo (feature 33,
> que CONSUME el QR) ni cambia el flujo de asignación/ruteo (features 17/30).
>
> Glosario: "orden imprimible" = orden con `num_guia` asignado (no borrada). El
> QR/barcode y sus datos de etiqueta se DERIVAN de datos ya existentes en `orden`
> y su geografía/tienda; esta feature NO crea tablas nuevas.

## Requisitos funcionales

### Lectura de datos de la etiqueta (backend)

- **R1** — El sistema DEBE exponer una Server Action de solo lectura que, dado un
  conjunto de identificadores de orden, devuelva por cada orden un payload de
  etiqueta con TODOS estos campos resueltos: `numGuia`, `numRemision`,
  `destinatario`, `telefonoDest`, `direccion`, `producto`, `montoCobrar`,
  `tiendaNombre`, `zonaNombre`, `provinciaNombre`, `cantonNombre`,
  `distritoNombre` y el valor a codificar en QR y en código de barras.
  *Verificable:* dado un id de orden con guía y geografía completas, el resultado
  contiene todos los campos con los nombres legibles resueltos (no IDs).

- **R2** — SI una orden solicitada NO tiene `num_guia` asignado, ENTONCES el
  sistema DEBE excluirla del resultado de etiquetas y reportarla como no
  imprimible (no se genera etiqueta sin `num_guia`).
  *Verificable:* input con una orden sin `num_guia` no produce etiqueta para ella
  y sí la señala como omitida.

- **R3** — SI una orden solicitada no existe o está borrada (`deleted_at` no
  nulo), ENTONCES el sistema DEBE excluirla del resultado y reportarla como no
  encontrada, sin abortar las etiquetas de las órdenes válidas del lote.
  *Verificable:* input con un id inexistente y uno válido devuelve la etiqueta del
  válido y marca el otro como omitido.

- **R4** — CUANDO una orden imprimible no tiene `distrito` asignado
  (`distritoId` nulo), el sistema DEBE devolver `distritoNombre` como `null` y
  aun así producir la etiqueta con el resto de la geografía (zona, provincia,
  cantón).
  *Verificable:* orden sin distrito devuelve etiqueta con `distritoNombre: null`.

- **R5** — El sistema DEBE resolver el `montoCobrar` como valor numérico
  serializable (no `Decimal`) o `null` cuando la orden no lo trae, sin
  hardcodear moneda ni símbolo en el backend (el formato/moneda se resuelve por
  configuración en la capa de presentación).
  *Verificable:* orden con `montoCobrar` devuelve `number`; orden sin él devuelve
  `null`; el backend no emite símbolo de moneda.

- **R6** — El sistema NUNCA DEBE exponer en el payload de etiqueta campos
  internos (`deletedAt`) ni datos ajenos a la etiqueta.
  *Verificable:* el DTO de etiqueta no contiene `deletedAt`.

### Codificación QR y código de barras

- **R7** — Cada etiqueta DEBE incluir un código QR cuyo contenido codifica un
  identificador estable de la orden que la feature 33 pueda usar para la
  recepción por escaneo (valor recomendado: `orden.id`; decisión final en
  Preguntas abiertas (a)).
  *Verificable:* el payload de etiqueta expone el `qrValue` esperado y el
  componente renderiza un QR a partir de él.

- **R8** — Cada etiqueta DEBE incluir un código de barras cuyo contenido codifica
  `num_guia` (valor recomendado; decisión final en Preguntas abiertas (b)).
  *Verificable:* el payload expone el `barcodeValue` esperado y el componente
  renderiza un barcode legible a partir de él.

### Presentación e impresión (frontend)

- **R9** — El sistema DEBE renderizar, por cada orden imprimible del lote, una
  etiqueta que muestre de forma legible: `num_guia`, `num_remision`,
  destinatario, teléfono, dirección, zona/provincia/cantón/distrito, producto,
  monto a cobrar y tienda, además del QR (R7) y el código de barras (R8).
  *Verificable:* test de componente comprueba que todos los campos y ambos
  códigos están presentes en el DOM de la etiqueta.

- **R10** — CUANDO el usuario dispara la impresión, el sistema DEBE presentar las
  etiquetas en un formato imprimible (una hoja con el lote, una etiqueta por
  orden) usando el flujo de impresión del navegador, sin depender de generación
  de PDF en servidor.
  *Verificable:* el disparador invoca el mecanismo de impresión del navegador y
  el estilo de impresión aísla las etiquetas del resto de la UI.

- **R11** — CUANDO se solicitan etiquetas para una selección de N órdenes de las
  cuales M tienen `num_guia`, el sistema DEBE renderizar exactamente M etiquetas
  e informar al usuario de las N−M omitidas (por no tener guía / no existir).
  *Verificable:* selección mixta produce M etiquetas y un aviso de las omitidas.

- **R12** — SI ninguna orden de la selección es imprimible, ENTONCES el sistema
  DEBE informarlo y no abrir un lote de impresión vacío.
  *Verificable:* selección sin guías muestra aviso y no dispara impresión.

### Permisos

- **R13** — El sistema DEBE permitir solicitar/imprimir etiquetas únicamente a los
  roles autorizados desde la vista de revisión del maestro (recomendado:
  `maestro`; `admin` solo-lectura; ver Pregunta abierta (f)); para cualquier otro
  rol DEBE responder `forbidden`.
  *Verificable:* actor no autorizado recibe `forbidden`; maestro recibe datos.

- **R14** — SI la petición no tiene sesión válida, ENTONCES el sistema DEBE
  responder `unauthenticated` antes de tocar datos.
  *Verificable:* sin actor, la action devuelve `unauthenticated`.

### Validación de entrada

- **R15** — El sistema DEBE validar la entrada de la Server Action en el borde con
  un validador (zod): lista no vacía de identificadores de orden con formato
  válido; entrada inválida DEBE devolver `validation_error`.
  *Verificable:* input con lista vacía o id malformado devuelve `validation_error`.

## Decisiones F1.4 (APROBADAS por el humano 2026-07-11)

- **(a) QR codifica `orden.id`** (UUID estable). La feature 33 lo escanea para recepción (lookup por PK).
- **(b) Código de barras codifica `num_guia`** (numérico, CODE128/1D para lector físico). [recomendado]
- **(c) Render = PDF real, cada etiqueta EXACTAMENTE `100mm × 100mm`.** ⚠️ CAMBIO vs. la recomendación
  (era HTML `window.print()`): el humano exige un **PDF descargable** con página/etiqueta cuadrada de
  100×100 mm. Implica una vía de generación de PDF además de las libs de QR/barcode. RECONCILIACIÓN con
  (d): `qrcode.react` y `react-barcode` renderizan SVG en el DOM; para producir el PDF de 100×100 mm el
  implementer debe (opción recomendada) renderizar la etiqueta a 100×100 mm y convertirla a PDF
  (p. ej. DOM→canvas→PDF con `html2canvas`+`jspdf`, o embebido del SVG del QR/barcode como imagen en
  un PDF con `jspdf`/`pdf-lib`). Esto AÑADE una dep de generación de PDF (a elegir por el implementer,
  liviana y mantenida) por encima de qrcode.react + react-barcode. R9–R12 quedan referidas a este PDF
  100×100 mm (una etiqueta cuadrada por orden; el lote produce un PDF multipágina, una etiqueta por página).
- **(d) Librerías QR + barcode = `qrcode.react` + `react-barcode`** (deps nuevas) + la dep de PDF que
  imponga (c) (ver reconciliación arriba).
- **(e) Disparo = acción EXPLÍCITA "Imprimir etiquetas" sobre la selección/lote** (desacoplada de
  "Generar guía"); el lote genera un PDF multipágina (una etiqueta 100×100 mm por orden con `num_guia`).
- **(f) Rol = `maestro`**, sobre órdenes que YA tienen `num_guia` (apartados `en_espera_aceptacion`,
  `en_bodega`, `en_ruta_bodega_satelite`); órdenes sin guía se omiten (R2). [recomendado]
- **(g) Reimpresión permitida sin límite ni auditoría** (la etiqueta es derivada, sin estado propio). [recomendado]

## Preguntas abiertas (registro histórico — RESUELTAS arriba en Decisiones F1.4)

- **(a) Qué codifica el QR.** Recomendación: `orden.id` (UUID estable e inmutable).
  Trade-off: la feature 33 escanea el QR para RECIBIR el paquete; `orden.id` es un
  lookup directo por PK, robusto aunque cambie cualquier otro dato, y no depende de
  que la guía sea numérica. Alternativa `num_guia`: legible por humanos y ligado al
  documento físico, pero es `Int` reutilizable conceptualmente y obliga a un lookup
  por índice único; menos directo para el escaneo de recepción. Recomiendo `orden.id`.

- **(b) Qué codifica el código de barras.** Recomendación: `num_guia` (numérico,
  ideal para lectores físicos de barras 1D tipo CODE128/EAN). Alternativa
  `num_remision`: es el identificador que trae la tienda, pero es `String` provisto
  por el usuario (longitud/charset variable) y menos apto como barcode operativo.
  Recomiendo `num_guia` para el barcode y reservar el QR para el id de recepción.

- **(c) Render de la etiqueta.** Recomendación: HTML imprimible con CSS
  `@media print` + `window.print()`, sin dependencia de generación de PDF. Es más
  simple, no añade peso de servidor y es suficiente para etiquetas de envío.
  Alternativa: PDF generado por librería (p. ej. layout fijo A6/etiqueta 4x6"),
  útil si se requiere archivar/adjuntar el PDF, pero añade dependencia pesada y
  complejidad de layout. Recomiendo HTML imprimible; a definir el tamaño de etiqueta
  objetivo (sugerencia: 4x6" / 100x150 mm, estándar de etiqueta de envío).

- **(d) Librerías QR + barcode (deps NUEVAS).** No hay ninguna hoy en `package.json`.
  Candidatas mantenidas y livianas, compatibles con Next App Router (componentes
  cliente): QR → `qrcode.react` (render React SVG/canvas, sin efectos, encaja en
  Client Component) o `qrcode` (genera dataURL, más imperativo). Barcode →
  `react-barcode` (wrapper de `jsbarcode`, render declarativo) o `bwip-js` (más
  formatos, más pesado). Combinación recomendada: **`qrcode.react` + `react-barcode`**
  (ambas declarativas, SSR-safe si se montan como Client Components, livianas).
  Decisión final e instalación efectiva: humano.

- **(e) Disparo y alcance.** Recomendación: acción EXPLÍCITA "Imprimir etiquetas"
  sobre la selección/lote (no acoplar la impresión al momento de "Generar guía" de
  la feature 17). Alcance: una hoja con el LOTE completo (varias etiquetas), una
  etiqueta por orden. Motivo: desacopla impresión de asignación, permite reimprimir
  y no fuerza abrir el diálogo de impresión en cada generación. A confirmar si
  además se desea un atajo opcional "imprimir al generar".

- **(f) Rol y apartados/estados desde los que se imprime.** Recomendación: el
  `maestro` imprime desde la vista de revisión (feature 17), sobre órdenes que YA
  tienen `num_guia` (apartados `en_espera_aceptacion`, `en_bodega`,
  `en_ruta_bodega_satelite`). ¿Debe `admin` poder imprimir (solo-lectura) o queda
  excluido? ¿Se habilita en los apartados de origen `en_fulfillment`/`en_preparacion`
  (que aún NO tienen guía y por R2 quedarían omitidas)?

- **(g) Reimpresión.** ¿Se permite reimprimir la etiqueta de una orden ya
  impresa? Recomendación: sí, sin límite (la etiqueta es derivada, no hay estado
  propio). Confirmar si se requiere marcar/auditar impresiones (fuera del alcance
  actual salvo indicación).
