# Feature 24 — Gestión de zonas (configuración) · requirements.md

> Notación EARS. Cada `R<n>` es testeable. Sin detalles de implementación
> (esos van en `design.md`). Basado en el esquema real (`db/schema.prisma`).
>
> **REESCRITO 2026-07-10.** El humano corrigió el modelo aprobado antes: la
> geografía de Costa Rica NO es hija de la zona ni se teclea inline. Es un
> **catálogo GLOBAL precargado** (`provincia → cantón → distrito`), sembrado desde
> el **mapa oficial completo** de Costa Rica; las asignaciones de zona se cruzan
> desde el Excel original `public/mapa-geografico-costa-rica.xlsx`. La zona se
> asigna a nivel de **distrito** (`distrito.zona_id`). Se elimina
> `provincia.zona_id`. Las tablas de
> geografía están HOY vacías (feature 6 las creó vacías), así que el remodelado es
> limpio, sin migración de datos.

## Alcance verificable (resumen)

Gestión de ZONAS por el rol `maestro` dentro de `app/(app)/configuracion`. Una
zona lleva `nombre` (único), el PAGO AL MENSAJERO por ENTREGA y por RECHAZO en
esa zona, y un flag `es_gam` (zona central; a lo sumo una). El maestro **compone**
cada zona SELECCIONANDO distritos del catálogo geográfico global precargado
(navegando provincia → cantón → distrito); esa selección asigna
`distrito.zona_id`. Se añade `usuario.zona_id` (nullable) para asignar
mensajero/adminSatelite a su zona. Incluye migración Prisma (up + `down.sql` +
RLS) que **remodela** la geografía y un seed idempotente desde Excel (gate de
despliegue). `orden` NO se toca.

---

## A. Datos y migración (remodelado de geografía)

- **R1** — El sistema DEBE, mediante una migración Prisma con `migration.sql` y su
  `down.sql`, añadir a la tabla `zona` tres columnas: `pago_entrega` (monto,
  precisión fija, no negativo, default `0`), `pago_rechazo` (monto, precisión
  fija, no negativo, default `0`) y `es_gam` (booleano, default `false`). Los
  defaults NO DEBEN romper filas existentes de `zona`.

- **R2** — El sistema DEBE imponer que el `nombre` de una zona sea **único** a
  nivel de base de datos (índice único), comparando en forma normalizada
  (trim + colapso de espacios + normalización de acentos + minúsculas; ver
  `design.md`).

- **R3** — El sistema DEBE garantizar que a lo sumo **una** zona tenga
  `es_gam = true` en todo el sistema, impuesto a nivel de base de datos (índice
  único parcial sobre `es_gam` donde `es_gam = true`).

- **R4** — El sistema DEBE, en la misma migración, **eliminar** de la tabla
  `provincia` la columna `zona_id` junto con su clave foránea
  (`provincia_zona_id_fkey`) y su índice (`provincia_zona_id_idx`), dado que la
  zona deja de ser padre de la geografía.

- **R5** — El sistema DEBE añadir a la tabla `distrito` la columna `zona_id` como
  FK **nullable** hacia `zona(id)`, con índice de soporte. Un distrito pertenece a
  lo sumo a UNA zona; `zona_id` nulo significa "sin zona asignada".

- **R6** — El sistema DEBE añadir a la tabla `usuario` la columna `zona_id` como FK
  **nullable** hacia `zona(id)`, con índice de soporte, sin alterar columnas
  preexistentes de `usuario`.

- **R7** — MIENTRAS existan las FKs `distrito.zona_id` y `usuario.zona_id`, el
  sistema DEBE impedir a nivel de base de datos que un distrito o un usuario
  referencie una zona inexistente (integridad referencial), y DEBE permitir
  `zona_id` nulo en ambas.

- **R8** — MIENTRAS existan distritos, usuarios u órdenes que referencian una
  zona, el sistema DEBE impedir el borrado físico de esa zona a nivel de base de
  datos (FK `ON DELETE RESTRICT`).

- **R9** — El sistema DEBE mantener la jerarquía geográfica: `canton` cuelga de
  `provincia` (`canton.provincia_id`) y `distrito` de `canton`
  (`distrito.canton_id`), sin cambios en esas dos FKs.

- **R10** — El remodelado NO DEBE tocar la tabla `orden`: `orden` conserva sus
  propias FKs directas `zona_id`, `provincia_id`, `canton_id` y `distrito_id`.
  Eliminar `provincia.zona_id` no afecta ninguna FK de `orden`. El `down.sql`
  tampoco DEBE tocar `orden`.

- **R11** — CUANDO se ejecute el `down.sql` de esta migración, el sistema DEBE
  revertir exactamente sus cambios (restaurar `provincia.zona_id` con su FK e
  índice; eliminar `distrito.zona_id`, `usuario.zona_id` y las columnas/índices
  nuevos de `zona`) sin tocar `orden` ni ninguna otra tabla o migración previa.

- **R12** — El sistema DEBE dejar habilitado Row Level Security sobre `zona`,
  `provincia`, `canton` y `distrito` sin definir policies para
  `anon`/`authenticated` (acceso solo vía service role del servidor), coherente
  con `usuario`/`cobro`/`vehiculos`.

## B. Backend — catálogo geográfico global (lectura)

- **R13** — CUANDO un actor invoque cualquier acción de zonas o de catálogo
  geográfico sin sesión válida, el sistema DEBE responder con estado
  `unauthenticated` y NO tocar el service.

- **R14** — DONDE el actor autorizado componga una zona, el sistema DEBE ofrecer
  operaciones de lectura del catálogo global para navegar la jerarquía: listar
  provincias, listar cantones de una provincia y listar distritos de un cantón
  (cada distrito indicando si ya está asignado a alguna zona y a cuál),
  devolviendo estado `ok`.

- **R15** — DONDE otro actor consulte el catálogo de zonas para asignación
  (selectores de usuarios/órdenes), el sistema DEBE ofrecer una operación de
  listado **ligero** de zonas (`{ id, nombre, esGam }`) reutilizable por otras
  features.

## C. Backend — composición y CRUD de zona

- **R16** — SI el actor autenticado no tiene rol de escritura de zonas (ver
  Decisión D2), ENTONCES el sistema DEBE responder `forbidden` y no crear/editar
  datos.

- **R17** — CUANDO el rol autorizado cree una zona con un `nombre` válido, sus
  montos `pago_entrega`/`pago_rechazo` y un conjunto de distritos existentes del
  catálogo global, el sistema DEBE crear la fila `zona` y, atómicamente, asignar
  `distrito.zona_id = <zona>` a cada distrito seleccionado, devolviendo estado
  `ok` con la zona creada.

- **R18** — SI la operación de crear/editar zona falla a mitad (p. ej. un distrito
  del conjunto no existe), ENTONCES el sistema DEBE no persistir ningún cambio de
  esa operación (transacción todo-o-nada).

- **R19** — El sistema DEBE rechazar con estado `validation_error` una
  creación/edición de zona cuyo `nombre` esté vacío, cuyos montos de pago sean
  negativos o no numéricos, o que referencie identificadores de distrito que no
  existan en el catálogo.

- **R20** — SI se intenta asignar a una zona un distrito que YA pertenece a OTRA
  zona, ENTONCES el sistema DEBE responder `conflict` (un distrito, una sola zona)
  sin persistir, salvo que sea la propia zona en edición (reasignación consigo
  misma es idempotente).

- **R21** — SI ya existe una zona con el mismo `nombre` normalizado, ENTONCES una
  creación/edición DEBE responder estado `conflict` y no duplicar.

- **R22** — CUANDO el rol autorizado edite una zona existente, el sistema DEBE
  permitir cambiar su `nombre`, `pago_entrega`, `pago_rechazo`, `es_gam` y el
  **conjunto de distritos asignados** (asignar nuevos y liberar los removidos,
  dejándolos con `zona_id = NULL`), devolviendo estado `ok`; DEBE responder
  `not_found` si la zona no existe.

- **R23** — CUANDO el rol autorizado marque una zona con `es_gam = true`, el
  sistema DEBE garantizar que a lo sumo una zona tenga `es_gam = true` (Decisión
  D5): al marcar una nueva, desmarca la anterior en la misma transacción.

- **R24** — CUANDO el rol autorizado liste zonas, el sistema DEBE devolver estado
  `ok` con los ítems paginados (page/pageSize acotado a un máximo) y el total,
  exponiendo por zona: `id`, `nombre`, `pago_entrega`, `pago_rechazo`, `es_gam` y
  el número de distritos asignados.

- **R25** — El sistema DEBE exponer las operaciones de zona y de catálogo como
  Server Actions cuyo contrato de salida sea un objeto discriminado por `status`
  (`ok` | `validation_error` | `unauthenticated` | `forbidden` | `not_found` |
  `conflict`), reusando el manejador de errores global (feature 10) y sin lanzar
  excepciones no controladas al cliente.

- **R26** — Las Server Actions de zona NUNCA DEBEN exponer campos internos no
  destinados al cliente; DEBEN devolver un DTO explícito con montos como `number`
  (no `Decimal` ni string).

## D. Asignación de zona a usuarios

- **R27** — CUANDO se cree o edite un usuario de rol `mensajero` o `adminSatelite`,
  el sistema DEBE permitir asignar un `zona_id` existente; para otros roles el
  `zona_id` DEBE permanecer nulo.

- **R28** — SI se intenta asignar a un usuario un `zona_id` que no corresponde a
  una zona existente, ENTONCES el sistema DEBE responder `validation_error` y no
  persistir el cambio.

## E. Frontend — pantalla en configuración

- **R29** — MIENTRAS un actor sin rol autorizado acceda a la sección de zonas
  dentro de `app/(app)/configuracion`, el sistema DEBE no renderizar el módulo de
  zonas y mostrar un mensaje de sin permiso (autorización server-side, patrón
  feature 25).

- **R30** — CUANDO el rol autorizado abra la sección de zonas, el sistema DEBE
  mostrar un listado de zonas con DataTable + paginación, precargado en el
  servidor.

- **R31** — CUANDO el rol autorizado pulse crear/editar zona, el sistema DEBE abrir
  un Modal con un formulario que capture: `nombre`, `pago_entrega`,
  `pago_rechazo`, un **toggle `es_gam`** ("marcar como zona central/GAM"), y un
  **selector de distritos** que navega el catálogo global provincia → cantón →
  distrito y permite marcar/desmarcar los distritos de la zona (uno o varios). El
  flag `es_gam` se define EXCLUSIVAMENTE por este toggle de UI (nunca por el seed);
  al marcarlo, el service aplica la invariante de R23 (desmarca la zona GAM
  anterior).

- **R32** — CUANDO una acción de crear/editar/marcar-GAM concluya, el sistema DEBE
  mostrar un Toast de éxito o de error según el `status` devuelto, y refrescar el
  listado en caso de éxito.

- **R33** — SI la Server Action devuelve `validation_error` o `conflict` con
  detalle de campo, el formulario DEBE mostrar los mensajes junto a los campos
  correspondientes (incluido el conflicto de distrito ya asignado) sin perder los
  valores ya ingresados.

## F. Seed del catálogo global (gate de despliegue)

El seed cruza **dos fuentes XLSX** (ambas leídas con `exceljs`; ver `design.md`):
(a) el **mapa oficial completo** de Costa Rica (7 provincias, 84 cantones, 489
distritos, con correcciones de nombre) como fuente de la GEOGRAFÍA; y (b) el Excel
ORIGINAL `public/mapa-geografico-costa-rica.xlsx` (hoja "Jerarquía (revisar)") como
fuente de las ASIGNACIONES de zona.

- **R34** — El sistema DEBE proveer un script de seed idempotente (patrón
  `scripts/seed-*.ts` con `exceljs`) que puebla el **catálogo geográfico global**
  (`provincia`, `canton`, `distrito`) desde el **mapa oficial completo** de Costa
  Rica (archivo en `public/`, nombre a confirmar, p. ej.
  `public/geografia-cr-completa.xlsx`), con upsert por nombre dentro de su padre,
  sin duplicar en corridas repetidas.

- **R35** — El seed DEBE **pre-crear las zonas** deducidas de la columna `Zona` del
  Excel ORIGINAL (`public/mapa-geografico-costa-rica.xlsx`), **normalizando y
  deduplicando** los valores sucios (p. ej. `GAM`+`Gam` → una sola zona "GAM";
  `LIMÓN ABAJO`+`LIMON ABAJO` → una; `ZONA SUR`+`Zona Sur` → una), creándolas con
  `pago_entrega = pago_rechazo = 0` y `es_gam = false`.

- **R36** — El seed DEBE asignar `distrito.zona_id` cruzando ambas fuentes por
  nombre normalizado provincia + cantón + distrito: a cada distrito del catálogo
  completo le asigna la zona que el Excel original indique para esa terna. Los
  distritos que no aparezcan en el Excel original, o cuya celda `Zona` esté vacía,
  DEBEN quedar con `zona_id = NULL` para que el maestro los asigne después por la UI.

- **R37** — El seed NUNCA DEBE marcar `es_gam`: todas las zonas pre-creadas quedan
  con `es_gam = false`. La designación de la zona central/GAM es EXCLUSIVAMENTE un
  toggle de UI del maestro (R31), sujeto a la invariante de zona única de R23.

- **R38** — El seed DEBE manejar los huecos de datos con gracia: reportar y omitir
  (sin fallar) filas incompletas o ternas del Excel original que no casen con el
  catálogo completo, y al terminar emitir un resumen (distritos poblados desde el
  mapa completo, distritos con zona asignada, distritos sin zona, zonas creadas,
  ternas de zona sin correspondencia, filas omitidas).

- **R39** — CUANDO el seed se ejecute más de una vez sobre la misma base, el
  sistema DEBE no duplicar provincias, cantones, distritos ni zonas (idempotencia:
  upsert por nombre dentro del padre; zona por nombre normalizado), conservando
  los `id` existentes y sin sobrescribir montos/`es_gam` ya editados por el maestro.

- **R40** — La ejecución del seed contra la base real es un **gate de despliegue**
  (requiere DB real, credenciales de service role y ambos archivos XLSX en
  `public/`); NO bloquea el arranque de la implementación del backend/UI, que se
  desarrolla y testea con fixtures XLSX sintéticos.

---

## Trazabilidad
El mapa R→test propuesto vive en `design.md` (sección "Trazabilidad R→test"). El
implementer lo confirma en `progress/impl_24-gestion-zonas.md`.

---

## Preguntas abiertas (para la puerta de aprobación humana F1.4)

Cada una lleva mi **propuesta firme**; el humano confirma o corrige.

1. **Cardinalidad zona ↔ distrito.**
   Propuesta: `distrito.zona_id` FK **nullable** (un distrito pertenece a lo sumo a
   UNA zona; la zona agrega N distritos). Confirmar: **sí**.

2. **Normalización de nombres de zona sucios (clave de dedup y forma canónica).**
   Propuesta: la **clave de dedup** = `trim` → colapsar espacios internos a uno →
   quitar acentos/diacríticos (NFD + strip de marcas combinantes) → `lowercase`
   (p. ej. `GAM`, `Gam` → `gam`; `LIMÓN ABAJO`, `LIMON ABAJO` → `limon abajo`). El
   **nombre canónico mostrado** = `trim` + colapso de espacios + **Title Case**,
   con excepción de acrónimos reconocidos que se conservan en mayúsculas (`GAM`).
   La unicidad de `nombre` en DB (R2) se compara por la clave normalizada. Confirmar
   la forma canónica exacta (¿"Zona Sur" vs "ZONA SUR"? propongo Title Case
   "Zona Sur").

3. **Distritos sin zona (~76).**
   Propuesta: quedan `zona_id = NULL`, asignables luego por el maestro desde la UI.
   Confirmar: **sí**.

4. **Pagos por zona.** El Excel no trae columnas de pago.
   Propuesta: el seed crea todas las zonas con `pago_entrega = pago_rechazo = 0`; el
   maestro define los montos después por la UI. Confirmar: **sí**.

5. **`es_gam` en el seed.** RESUELTA (humano 2026-07-10): el seed **NO** marca
   `es_gam`; todas las zonas nacen `es_gam = false`. `es_gam` es un **toggle de UI**
   que el maestro marca a mano al crear/editar una zona ("marcar como zona
   central/GAM"), con la invariante de zona única aplicada en el service (R23/R31).
   El campo `zona.es_gam` se conserva en el schema porque la feature 30 lo necesita.

6. **Fuente de la geografía y huecos.** RESUELTA (humano 2026-07-10): la geografía
   se siembra desde un **mapa oficial completo** de Costa Rica (7 provincias, 84
   cantones, 489 distritos, con correcciones de nombre tipo "León Cortés Castro",
   Sarchí ex-"Valverde Vega") generado aparte y depositado en `public/` (nombre a
   confirmar, p. ej. `public/geografia-cr-completa.xlsx`). Las asignaciones de zona
   se toman de la columna `Zona` del Excel ORIGINAL, cruzando por nombre normalizado
   provincia + cantón + distrito. Los huecos del Excel original quedan cubiertos por
   el mapa completo; los distritos nuevos sin zona quedan `zona_id = NULL` para que
   el maestro los asigne por UI.

7. **¿`provincia`/`canton` necesitan una pista de zona para UX de selección masiva?**
   Propuesta: **no**. La asignación es solo a nivel de distrito; la UI agrega la
   selección y el listado muestra el número de distritos por zona. Confirmar.

## Decisiones F1.4 (APROBADAS por el humano 2026-07-10, con dos ajustes)

> El spec previo estaba aprobado con un modelo INCORRECTO (geografía hija de la
> zona, tecleo inline, Excel plano de una hoja). Este reescrito lo corrige y el
> humano lo **aprobó** con los ajustes de las preguntas 5 y 6. Decisiones firmes:

- **D1** — Catálogo geográfico **global** precargado (`provincia → cantón →
  distrito`); NO hijo de la zona; nada quemado en código. Geografía sembrada desde
  el **mapa oficial completo** de Costa Rica (ajuste pregunta 6).
- **D2** — Escritura de zonas SOLO rol `maestro`; lectura del catálogo geográfico y
  del listado ligero de zonas `maestro` + `admin`.
- **D3** — Zona compuesta por **selección** de distritos del catálogo global vía
  `distrito.zona_id`. Se elimina `provincia.zona_id`.
- **D4** — `nombre` de zona **único** (normalizado); un distrito pertenece a lo sumo
  a una zona.
- **D5** — Un solo `es_gam = true` (al marcar una nueva se desmarca la anterior),
  impuesto además con índice único parcial en DB. **`es_gam` NO se siembra**: es un
  toggle de UI del maestro; el campo se conserva en el schema para la feature 30
  (ajuste pregunta 5).
- **D6** — Sin borrado de zona en esta feature (solo crear/listar/editar); FK
  `ON DELETE RESTRICT`.
- **D7** — `usuario.zona_id` **nullable** en DB; obligatoriedad para
  mensajero/adminSatelite como regla de negocio en el servicio de usuarios, no en el
  schema.
- **D8** — El seed **pre-crea las zonas** (deducidas y deduplicadas del Excel
  original) con pagos 0 y `es_gam=false`, y asigna `distrito.zona_id`; el maestro
  puede crear zonas nuevas y ajustar/renombrar las sembradas por UI (ajuste
  preguntas 5+6, combinación opción 1 + opción 3).

### GATES de implementación (F2)
1. **Coordinación con la feature 27** (fullstack, tocó `db/schema.prisma` y
   `usuario`). La impl de la 24 se sincroniza con `dev` una vez la 27 esté mergeada,
   para no chocar en `usuario`/migraciones.
2. **Seed contra los Excel reales** (mapa oficial completo pendiente en `public/` +
   `public/mapa-geografico-costa-rica.xlsx` ya presente): su ejecución requiere DB
   real → **gate de despliegue**. El backend, la UI y los parsers del seed se
   implementan y testean sin DB real usando fixtures XLSX sintéticos.
