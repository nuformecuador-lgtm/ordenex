# requirements.md — componente carga masiva (feature 9)

> Componente frontend genérico y reutilizable (`components/shared/BulkUpload.tsx`).
> UI pura: NO construye el endpoint backend. Recibe por props la ruta de la API,
> el/los tipo(s) de archivo aceptados y la definición de campos de la plantilla.
> Estilo alineado con `DataTable` (data-driven, sin acoplamiento a dominio).

## Alcance

El componente ofrece dos acciones sobre un mismo bloque de UI:

1. **Descargar plantilla**: genera en cliente un archivo con las columnas
   parametrizadas por props y lo descarga, sin llamar a red.
2. **Cargar archivo**: valida el archivo elegido contra los tipos aceptados y lo
   envía por `POST` multipart a la ruta indicada por props, exponiendo los estados
   de carga, éxito y error mediante callbacks.

Fuera de alcance: definir el route handler / server action destino, parsear el
contenido del archivo subido, validar reglas de negocio del archivo.

## Requisitos (EARS)

### Configuración por props

- **R1** — El sistema DEBE aceptar por props una lista no vacía de definiciones de
  campo (`fields`), cada una con al menos una clave de columna, usada para generar
  la plantilla descargable.
- **R2** — El sistema DEBE aceptar por props la ruta de la API destino (`endpoint`)
  a la que se envía el archivo cargado.
- **R3** — El sistema DEBE aceptar por props el/los tipo(s) de archivo permitido(s)
  (`accept`, p. ej. `csv`, `xlsx`), y usarlos tanto para el atributo `accept` del
  input file como para la validación de la selección.
- **R4** — DONDE se provea un nombre de archivo de plantilla (`templateFileName`),
  el sistema DEBE usarlo como nombre del archivo descargado; en su ausencia DEBE
  usar un nombre por defecto derivado (`plantilla.csv`).

### Descarga de plantilla

- **R5** — CUANDO el usuario active el botón "Descargar plantilla", el sistema DEBE
  generar un archivo cuya primera fila (cabecera) contenga exactamente las columnas
  de `fields`, en el mismo orden en que fueron provistas.
- **R6** — DONDE una definición de campo incluya un valor de ejemplo (`example`),
  el sistema DEBE incluir una segunda fila con esos valores de ejemplo alineados a
  sus columnas; SI ninguna definición aporta ejemplo, ENTONCES el sistema DEBE
  generar solo la fila de cabecera.
- **R7** — CUANDO se genere la plantilla, el sistema DEBE escapar los valores de
  cabecera/ejemplo que contengan el separador, comillas o saltos de línea, de modo
  que el archivo resultante sea un CSV válido.
- **R8** — CUANDO se dispare la descarga, el sistema DEBE entregar el archivo al
  usuario mediante una descarga de navegador (sin navegación de página ni petición
  de red al `endpoint`).

### Selección y validación del archivo

- **R9** — CUANDO el usuario seleccione un archivo, el sistema DEBE mostrar el
  nombre del archivo seleccionado.
- **R10** — SI la extensión del archivo seleccionado no coincide con ninguno de
  los tipos permitidos en `accept`, ENTONCES el sistema DEBE rechazarlo, mostrar
  un mensaje de error accesible y NO habilitar el envío.
- **R11** — MIENTRAS no haya un archivo válido seleccionado, el sistema DEBE
  mantener deshabilitado el botón "Cargar archivo".
- **R21** — CUANDO el navegador provea un MIME type no vacío para el archivo
  seleccionado, el sistema DEBE validarlo contra los MIME permitidos por `accept`;
  SI el MIME provisto contradice (no pertenece a) los tipos permitidos, ENTONCES el
  sistema DEBE rechazar el archivo con mensaje de error accesible y NO habilitar el
  envío, incluso si la extensión fuese válida.
- **R22** — SI el MIME type provisto por el navegador está vacío o ausente,
  ENTONCES el sistema DEBE NO rechazar el archivo por ese motivo y DEBE decidir la
  validez únicamente por la extensión (R10 manda).
- **R23** — DONDE se provea la prop `maxSizeBytes`, SI el archivo seleccionado
  excede ese tamaño en bytes, ENTONCES el sistema DEBE rechazarlo, mostrar un
  mensaje de error accesible y NO habilitar el envío; SI `maxSizeBytes` no se
  provee, ENTONCES el sistema DEBE NO validar el tamaño en cliente (el backend es
  la autoridad final).

### Carga (POST multipart)

- **R12** — CUANDO el usuario active "Cargar archivo" con un archivo válido, el
  sistema DEBE enviar una petición `POST` de tipo `multipart/form-data` a
  `endpoint`, con el archivo bajo el nombre de campo configurable (`fieldName`,
  por defecto `file`).
- **R13** — MIENTRAS la petición esté en curso, el sistema DEBE indicar el estado
  de carga (indicador accesible) y deshabilitar los botones "Cargar archivo" y
  "Descargar plantilla" para evitar envíos duplicados.
- **R14** — CUANDO la respuesta del `endpoint` sea satisfactoria, el sistema DEBE
  mostrar un mensaje de éxito accesible e invocar el callback `onSuccess` con el
  cuerpo de la respuesta (si lo hay).
- **R15** — SI la respuesta del `endpoint` es de error (estado HTTP no exitoso) o
  la petición falla por red, ENTONCES el sistema DEBE mostrar un mensaje de error
  accesible e invocar el callback `onError` con el detalle del fallo, SIN lanzar
  una excepción no controlada.
- **R16** — CUANDO una carga termine (éxito o error), el sistema DEBE volver a un
  estado en el que el usuario pueda reintentar o seleccionar otro archivo.

### Accesibilidad

- **R17** — El sistema DEBE exponer el input de archivo con una etiqueta asociada
  (label) y los botones con nombres accesibles ("Descargar plantilla", "Cargar
  archivo").
- **R18** — El sistema DEBE exponer los mensajes de éxito mediante `role="status"`
  y los de error mediante `role="alert"`, de forma distinguible entre sí.

### Casos límite

- **R19** — SI se monta el componente sin `endpoint`, ENTONCES el sistema DEBE
  mantener el botón "Cargar archivo" deshabilitado (no hay destino al cual enviar),
  sin romper la descarga de plantilla.
- **R20** — SI se monta el componente con `fields` vacío, ENTONCES el sistema DEBE
  deshabilitar el botón "Descargar plantilla" (no hay columnas que generar).

## Trazabilidad

Cada `R<n>` se mapea a un test en `tests/components/BulkUpload.test.tsx`
(ver `tasks.md`).

## Preguntas abiertas

Ninguna. Las tres preguntas iniciales fueron resueltas por decisión humana
(2026-07-09) y convertidas en requisitos firmes:

1. **Formato de plantilla** → RESUELTO: CSV nativo para todos los casos, sin
   dependencia XLSX (ver R5–R8 y `design.md` D1).
2. **Validación de tipo** → RESUELTO: extensión + MIME (ver R10, R21, R22 y
   `design.md` D2).
3. **Límite de tamaño** → RESUELTO: prop opcional `maxSizeBytes` en cliente +
   backend como autoridad final (ver R23 y `design.md` D2).
