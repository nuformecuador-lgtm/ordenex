# requirements.md — ordenes: carga masiva (endpoint) (feature 15)

> Endpoint backend que recibe un archivo **CSV o XLSX**, lo parsea, valida y
> resuelve cada fila, y crea órdenes en lote soportando volúmenes altos. Es la
> contraparte del componente `components/shared/BulkUpload.tsx` (feature 9), que
> hace `POST` `multipart/form-data` con el archivo bajo el campo `file` a una
> `endpoint` URL. Por eso la contraparte es un **Route Handler** (no Server
> Action): el consumidor es un componente genérico que hace `fetch` a una ruta.
>
> Zona: backend · Complejidad: high · depends_on: null.
> Reutiliza: capas de feature 6 (`OrdenService`/`OrdenRepository`/`lib/types/orden.ts`),
> catálogo `order_status` + `ORDER_STATUS_SEED` (feature 6), manejador de errores
> feature 10 (`withErrorHandler`, `appErrorToResponse`, `AppErrorShape`), y lectura
> de sesión de feature 1 (`SessionRepository`, cookie `session`).

## Alcance

- Añadir a `Orden` las columnas `direccion`, `monto_cobrar` y `mensajero_sugerido_id`
  (relación nueva con `Usuario`), vía migración Prisma con `down.sql` + RLS.
- Añadir el estatus `en_preparacion` al catálogo `order_status` (fuente de verdad
  en TS) y convertirlo en el estatus por defecto de las órdenes creadas por esta
  carga.
- Un Route Handler `POST` que reciba el archivo, lo parsee (CSV y XLSX), valide y
  resuelva por fila, deduplique por `num_remision` y persista en lote.
- Devolver un **resumen por fila + totales** (éxito parcial), usando la estructura
  de error de feature 10 para fallos estructurales.

**Fuera de alcance:** UI del modal (feature 14), pantalla de resumen/edición y
selector de mensajero (feature 16), estados de revisión a bodega (feature 17),
sembrar la geografía (tablas `zona`/`provincia`/`canton`/`distrito` hoy vacías) y
sembrar usuarios mensajero. **La carga masiva para roles `maestro`/`admin` (con
selección de tienda) es una feature futura fuera de alcance:** este endpoint lo
usa ÚNICAMENTE el rol `adminTienda`, que crea órdenes para su propia tienda.

## Columnas del archivo (contrato de entrada, orden de la plantilla)

`num_remision`, `destinatario`, `telefono`, `provincia`, `canton`, `distrito`,
`direccion`, `producto`, `notas`, `monto_cobrar`, `mensajero_sugerido_id`.

Mapeo a `Orden`: `num_remision`→`numRemision`, `destinatario`→`destinatario`,
`telefono`→`telefonoDest`, `provincia`/`canton`/`distrito` → FKs resueltas por
nombre, `direccion`→`direccion` (**columna nueva**), `producto`→`producto`,
`notas`→`notas`, `monto_cobrar`→`montoCobrar` (**columna nueva**),
`mensajero_sugerido_id`→`mensajeroSugeridoId` (**columna nueva + relación**).

---

## Requisitos (EARS)

### Esquema y migración

- **R1** — El sistema DEBE añadir a la tabla `orden` las columnas `direccion`
  (texto, nullable), `monto_cobrar` (`DECIMAL(12,2)`, nullable) y
  `mensajero_sugerido_id` (texto, nullable), mapeadas en snake_case vía Prisma
  `@map`, sin alterar las columnas existentes.
- **R2** — El sistema DEBE crear la relación `orden.mensajero_sugerido_id` →
  `usuario.id` como FK nullable con `ON DELETE SET NULL`, y un índice sobre
  `mensajero_sugerido_id`.
- **R3** — El sistema DEBE entregar la migración con `migration.sql` (UP) y
  `down.sql` (DOWN) que revierta exactamente los cambios (drop de columnas/FK/índice),
  sin tocar tablas ni columnas preexistentes; `orden` ya tiene RLS habilitada y la
  migración DEBE conservarla sin añadir policies (acceso solo por service role).
- **R4** — El sistema DEBE poder crear una orden sin `peso` (las órdenes de carga
  masiva no traen peso): la migración vuelve `orden.peso` NULLABLE. El
  `crearOrdenSchema` del CRUD (feature 6) sigue exigiendo `peso > 0`, de modo que los
  tests de creación existentes no cambian y solo se relaja la restricción a nivel de
  columna.

### Estatus nuevo y default

- **R5** — El sistema DEBE incluir el valor `en_preparacion` en la fuente única de
  verdad `ORDER_STATUS_SEED` (`lib/types/order-status.ts`), de modo que el seed
  idempotente (`seedOrderStatus`) lo cree por `value` sin duplicar los existentes.
- **R6** — El sistema DEBE incluir, en la migración de esta feature, un `INSERT`
  idempotente (`ON CONFLICT (value) DO NOTHING`) de `en_preparacion` en
  `order_status`, para bases de datos ya migradas donde el script de seed pudiera
  no re-ejecutarse; el `down.sql` DEBE eliminar esa fila SOLO si no está referenciada
  por ninguna orden.
- **R7** — CUANDO se cree una orden sin estatus explícito (tanto en el CRUD de
  feature 6 como en esta carga masiva), el sistema DEBE asignarle el estatus cuyo
  `value` es `en_preparacion`. El default es **global**: `en_preparacion` sustituye
  a `en_bodega` como estatus por defecto de TODA orden nueva.
- **R8** — El sistema DEBE fijar `en_preparacion` como `ordenesConfig.DEFAULT_ESTATUS_VALUE`
  (antes `en_bodega`), afectando al CRUD de feature 6 y a la carga masiva por igual;
  el test de creación de feature 6 que hoy afirma `en_bodega` DEBE actualizarse a
  `en_preparacion`. El `value` almacenado es el slug `en_preparacion` (consistente
  con `en_bodega`, `devuelta_origen`); la etiqueta visible "en preparación" es de
  presentación, fuera de este spec.

### Endpoint y autorización

- **R9** — El sistema DEBE exponer un Route Handler `POST` en
  `app/api/ordenes/carga-masiva/route.ts` que acepte `multipart/form-data` con el
  archivo bajo el campo `file` (nombre por defecto de `BulkUpload`).
- **R10** — SI la petición no trae una sesión válida (cookie `session`), ENTONCES el
  sistema DEBE responder con `AppErrorShape` código `UNAUTHORIZED` (HTTP 401) vía
  `appErrorToResponse`, sin procesar el archivo.
- **R11** — El sistema DEBE autorizar esta carga masiva ÚNICAMENTE al rol
  `adminTienda`; SI el rol del actor es cualquier otro (`maestro`, `admin`,
  `mensajero` o desconocido), ENTONCES DEBE responder `FORBIDDEN` (HTTP 403), sin
  procesar el archivo. (La carga masiva para `maestro`/`admin` es una feature
  futura fuera de alcance.)
- **R12** — SI la petición no incluye un archivo bajo el campo `file`, ENTONCES el
  sistema DEBE responder `VALIDATION_ERROR` (HTTP 422) con un `fieldErrors.file`
  descriptivo.

### Parseo CSV y XLSX

- **R13** — El sistema DEBE aceptar archivos con extensión `.csv` y `.xlsx`; SI la
  extensión/tipo no es ninguna de esas, ENTONCES DEBE responder `VALIDATION_ERROR`
  (HTTP 422) sin intentar parsear.
- **R14** — CUANDO el archivo sea CSV, el sistema DEBE parsearlo respetando comillas,
  separadores escapados y saltos de línea dentro de celdas (CSV válido), tomando la
  primera fila como cabecera.
- **R15** — CUANDO el archivo sea XLSX, el sistema DEBE leer la primera hoja,
  tomando la primera fila como cabecera y las siguientes como datos.
- **R16** — CUANDO se lea la cabecera, el sistema DEBE mapear las columnas esperadas
  por nombre (insensible a mayúsculas y espacios sobrantes); SI faltan columnas
  obligatorias (`num_remision`, `destinatario`, `telefono`, `provincia`, `canton`),
  ENTONCES DEBE responder `VALIDATION_ERROR` (HTTP 422) indicando las columnas
  ausentes, sin procesar filas.
- **R17** — SI el archivo no contiene filas de datos (solo cabecera o vacío),
  ENTONCES el sistema DEBE responder `VALIDATION_ERROR` (HTTP 422) con un mensaje de
  "archivo sin filas".

### Validación y resolución por fila

- **R18** — Para cada fila, el sistema DEBE validar los campos obligatorios
  (`num_remision`, `destinatario`, `telefono`, `producto` no vacíos); SI alguno falta,
  ENTONCES la fila DEBE marcarse como `error` con sus `fieldErrors`, sin abortar el
  resto del archivo.
- **R19** — El sistema DEBE resolver `provincia`, `canton` y `distrito` por NOMBRE a
  sus FKs de forma jerárquica (cantón dentro de la provincia resuelta; distrito
  dentro del cantón resuelto), con comparación insensible a mayúsculas y espacios.
- **R20** — SI un nombre de provincia/cantón/distrito no existe (o es ambiguo dentro
  de su padre), ENTONCES la fila DEBE marcarse como `error` con el `fieldError`
  geográfico correspondiente, sin abortar el resto del archivo. La geografía sembrada
  es un **prerrequisito operativo externo** a esta feature (las tablas hoy están
  vacías); el endpoint reporta el fallo por fila sin inventar filas geográficas.
- **R21** — CUANDO se resuelva la provincia de una fila, el sistema DEBE derivar
  `zona_id` desde `provincia.zona_id` (la `zona` no viene en el archivo y `orden.zona_id`
  es NOT NULL).
- **R22** — DONDE una fila traiga `mensajero_sugerido_id`, el sistema DEBE verificar
  que ese id corresponde a un `usuario` con rol `mensajero`; SI no existe o su rol no
  es `mensajero`, ENTONCES la fila DEBE marcarse como `error`. SI la columna viene
  vacía, el sistema DEBE persistir `mensajero_sugerido_id = NULL` (campo opcional).
- **R23** — DONDE una fila traiga `monto_cobrar`, el sistema DEBE parsearlo como
  número decimal ≥ 0; SI no es numérico o es negativo, ENTONCES la fila DEBE marcarse
  como `error`. SI viene vacío, DEBE persistir `NULL`.
- **R24** — El sistema DEBE fijar `tienda_id = actor.usuarioId` en TODA orden creada
  (el rol está garantizado como `adminTienda` por R11, que crea para su propia
  tienda). NO existe campo `multipart` `tiendaId` ni columna de tienda por fila; la
  tienda nunca viene en el archivo ni en el `FormData`.

### Deduplicación por `num_remision`

- **R25** — CUANDO una fila traiga un `num_remision` que ya existe en la base de
  datos (orden no borrada), el sistema DEBE NO crear una nueva orden y DEBE incluir
  en el resultado de esa fila el estatus (`value`) de la orden existente, marcándola
  como `duplicada`.
- **R26** — SI dos o más filas del mismo archivo comparten `num_remision`, ENTONCES
  el sistema DEBE crear a lo sumo una y marcar las restantes como `duplicada`
  (dedup intra-archivo), de forma determinista (primera ocurrencia gana).

### Alto volumen

- **R27** — El sistema DEBE persistir las órdenes válidas en lotes (batch), no una
  petición por fila, usando inserción masiva; DEBE usar `skipDuplicates` para tolerar
  carreras de `num_remision` sin abortar el lote.
- **R28** — El sistema DEBE rechazar (`VALIDATION_ERROR`, HTTP 422) archivos que
  excedan el límite de tamaño en bytes o el límite de filas configurables (valores
  por defecto en `lib/config/` con override por entorno, patrón `ordenesConfig`),
  antes de persistir.
- **R29** — El sistema DEBE procesar el archivo con semántica de **éxito parcial**:
  una fila inválida o duplicada NO impide crear las filas válidas; el resultado
  reporta el desglose. (No es todo-o-nada por archivo.)

### Forma de respuesta

- **R30** — CUANDO el archivo se procese, el sistema DEBE responder HTTP 200 con un
  resumen JSON: `{ total, creadas, duplicadas, conError, filas: [...] }`, donde cada
  fila incluye `fila` (número 1-based de datos), `numRemision`, `resultado`
  (`"creada" | "duplicada" | "error"`), y según el caso `estatus` (value, para
  duplicada/creada) o `errores` (`Record<string,string[]>`, para error).
- **R31** — SI ocurre un fallo estructural (sin sesión, rol no autorizado, archivo
  ausente/ilegible/tipo inválido/sin filas/límites excedidos, o error interno),
  ENTONCES el sistema DEBE responder con un `AppErrorShape` vía `appErrorToResponse`
  (feature 10), nunca con el resumen de éxito parcial.
- **R32** — El resultado NUNCA DEBE exponer `deleted_at`, `password_hash` ni datos
  internos; el estatus duplicado se expone solo por su `value`.

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md` (unit de servicio/parseo +
integración del Route Handler con DB de test).

## Decisiones cerradas (humano, 2026-07-10)

- **[ABIERTO-1] RESUELTO → sí, `peso` NULLABLE** a nivel de columna. El
  `crearOrdenSchema` del CRUD (feature 6) sigue exigiendo `peso > 0`; solo se relaja
  la columna. Refleja R4.
- **[ABIERTO-2] RESUELTO → default GLOBAL.** `en_preparacion` es el default de TODA
  orden nueva: `ordenesConfig.DEFAULT_ESTATUS_VALUE` cambia de `en_bodega` a
  `en_preparacion` (afecta feature 6) y se actualiza el test de creación de feature 6.
  Refleja R7/R8.
- **[ABIERTO-3] RESUELTO → slug `en_preparacion`.** La etiqueta visible
  "en preparación" es de presentación, fuera de este spec. Refleja R5/R8.
- **[ABIERTO-4] RESUELTO → geografía = prerrequisito externo.** Tablas vacías; el
  endpoint reporta el fallo por fila sin inventar filas. Sembrar geografía no es
  alcance de esta feature. Refleja R20.
- **[ABIERTO-5] RESUELTO → `zona` se deriva de la provincia** (`provincia.zona_id`);
  el archivo no trae columna zona. Refleja R21.
- **[ABIERTO-6] RESUELTO → carga masiva SOLO para rol `adminTienda`.** `tienda_id`
  SIEMPRE = `actor.usuarioId`. No hay campo `multipart` `tiendaId` ni tienda por
  fila. Cualquier otro rol (`maestro`/`admin`/`mensajero`/desconocido) → `FORBIDDEN`.
  La carga masiva para `maestro`/`admin` es una feature futura fuera de alcance.
  Refleja R11 (autorización) y R24 (tienda del actor).
