# Feature 17 — Órdenes: revisión maestro / generar guía / asignación de mensajero · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 27, 28 (ambas `done`) · branch: `feature/17-revision-maestro-generar-guia`

> Estado: `spec_ready`. La puerta de aprobación **F1.4 está CERRADA/APROBADA por el
> humano (2026-07-10)**. Las 5 decisiones firmes y el alcance (el botón "Generar guía"
> aplica a AMBOS estados de revisión) quedan registrados como APROBADOS en
> "Decisiones aprobadas (humano, 2026-07-10)". **No quedan preguntas abiertas.**

Notación EARS. Cada requisito es testeable y mapeable a un test concreto (ver "Tabla
de trazabilidad"). El "actor" se resuelve vía `resolveActorFromSession` →
`{ usuarioId, rol }` (patrón features 6/15/25/27). "Rol autorizado para escribir" en
este módulo es **exclusivamente `maestro`** (Decisión 3); `admin` es solo-lectura.

Contexto de código real (anclas, no inventar):
- Modelo `Orden` en `db/schema.prisma`: hoy `numGuia Int @unique @default(autoincrement())`
  (SERIAL, secuencia Postgres `orden_num_guia_seq`, asignado al INSERT por la feature 6);
  `mensajeroSugeridoId String?` (FK → `usuario`, feature 15); `estatusId` FK → `order_status`.
- Catálogo de estados: `lib/types/order-status.ts` (`ORDER_STATUS_SEED`, 8 valores; ya
  existen `en_fulfillment`, `en_preparacion`, `en_bodega`, `en_ruta_bodega_principal`,
  `entregada`, `devuelta`, `devuelta_origen`, `reprogramada`). Seed idempotente:
  `scripts/seed-catalogos.ts` (`seedOrderStatus`, upsert por `value`). Enum Postgres
  standalone `order_status_value` en la migración `..._order_status_value_enum`.
- Carga masiva: `lib/services/BulkOrdenService.ts` (`cargarMasiva` → `createManyOrdenes`);
  hoy NO setea `num_guia` (lo asigna el DEFAULT del SERIAL al insertar).
- CRUD/listado de órdenes: Server Actions discriminadas por resultado en
  `lib/actions/ordenes.ts`, service `lib/services/OrdenService.ts`, repo
  `lib/repositories/OrdenRepository.ts` (`IOrdenRepository`). DataTable (feature 7),
  Paginación (feature 8), Modal async (feature 13), Toast (feature 11), manejador
  global de errores (feature 10).

---

## Bloque 0 — Puerta de aprobación (F1.4)

- **R0** — La puerta F1.4 DEBE constar como CERRADA/APROBADA por el humano (2026-07-10).
  Las 5 decisiones firmes y el alcance de ambos estados de revisión están registrados
  como APROBADOS; ningún supuesto queda abierto. (Verificación documental, no de código.)

## Modelo de datos: `num_guia` diferido vía SEQUENCE

- **R1** — El campo `num_guia` de `orden` DEBE ser NULLABLE (dejar de ser NOT NULL) y
  DEBE dejar de tener un `DEFAULT` que asigne valor al INSERT. La restricción UNIQUE
  sobre `num_guia` DEBE conservarse (UNIQUE permite múltiples `NULL` en Postgres).
- **R2** — CUANDO se inserta una orden nueva (por CRUD feature 6 o por carga masiva
  feature 15), el sistema DEBE persistirla con `num_guia = NULL` (la guía no se asigna
  en la creación). La carga masiva (`createManyOrdenes`) NO DEBE fijar `num_guia`.
- **R3** — El sistema DEBE asignar `num_guia` mediante una SEQUENCE dedicada de Postgres,
  reutilizando `orden_num_guia_seq` (la secuencia creada por el SERIAL de la feature 6),
  desligada del `DEFAULT` de la columna (`ALTER SEQUENCE ... OWNED BY NONE`), de modo que
  siga viva y monotónica tras quitar el default. Cada asignación DEBE consumir un valor
  con `nextval('orden_num_guia_seq')`.
- **R4** — CUANDO se asigna `num_guia` a una orden, el valor DEBE ser un entero
  incremental y ÚNICO entre todas las órdenes; dos órdenes distintas NUNCA DEBEN
  compartir `num_guia`.
- **R5** — SI una orden YA tiene `num_guia` asignado (no NULL), ENTONCES "Generar guía"
  NO DEBE reasignarlo (idempotencia): la asignación se aplica solo a filas con
  `num_guia IS NULL` (`UPDATE ... WHERE num_guia IS NULL`), sin consumir la secuencia
  para filas ya numeradas.
- **R6** — El sistema DEBE introducir el cambio de `num_guia` (nullable + sin default +
  secuencia desligada) mediante una migración Prisma versionada que incluya
  OBLIGATORIAMENTE su `down.sql`. El `down.sql` DEBE documentar que revertir `num_guia`
  a NOT NULL FALLA explícitamente si existen órdenes con `num_guia = NULL` (no corrompe
  datos en silencio; el operador resuelve esos datos antes de reintentar). La RLS de
  `orden` DEBE permanecer coherente (tabla con RLS habilitada, sin nuevas policies;
  acceso solo por service role, patrón feature 6).

## Modelo de datos: `mensajero_asignado_id`

- **R7** — El sistema DEBE disponer de un nuevo campo `mensajero_asignado_id` en `orden`
  (columna `mensajero_asignado_id`, FK → `usuario`, NULLABLE, `ON DELETE SET NULL`),
  distinto de `mensajero_sugerido_id`, para trazar por separado el mensajero SUGERIDO
  (carga masiva) y el mensajero ASIGNADO (esta feature). DEBE existir índice sobre la
  columna. La feature 36 consumirá `mensajero_asignado_id`.
- **R8** — CUANDO se crea una orden, el sistema DEBE persistir `mensajero_asignado_id = NULL`
  (la asignación es un acto posterior de "Generar guía"/asignación, no de creación).

## Catálogo: nuevo estado `en_espera_aceptacion`

- **R9** — El sistema DEBE incorporar el valor de estado `en_espera_aceptacion`
  ("en espera de aceptación del mensajero") como 9.º valor de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`) y sembrarlo de forma idempotente vía `seedOrderStatus`
  (upsert por `value`), sin duplicar ni alterar los 8 valores existentes.
- **R10** — El sistema DEBE insertar la fila de catálogo `en_espera_aceptacion` en
  `order_status` mediante la migración de esta feature (patrón feature 15/28:
  `INSERT ... ON CONFLICT (value) DO NOTHING`) y DEBE añadir `en_espera_aceptacion` al
  enum Postgres standalone `order_status_value`. El `down.sql` DEBE eliminar la fila de
  catálogo solo si ninguna orden la referencia.

## Autorización (Decisión 3)

- **R11** — MIENTRAS el actor tenga rol `maestro`, el sistema DEBE permitirle las
  operaciones de escritura de este módulo (generar guía, asignar mensajero, transiciones
  de estado).
- **R12** — CUANDO un actor con rol `admin` accede a este módulo, el sistema DEBE
  ofrecerle acceso de SOLO-LECTURA: puede ver los listados por estado pero el sistema
  DEBE rechazar (`forbidden`) cualquier intento suyo de generar guía o asignar mensajero.
- **R13** — CUANDO un actor con cualquier otro rol (`adminTienda`, `mensajero`, u otro)
  intenta una operación de escritura de este módulo, el sistema DEBE responder
  `forbidden`, sin efectos en datos.
- **R14** — CUANDO no hay actor autenticado, el sistema DEBE responder `unauthenticated`
  antes de tocar el service o los datos (patrón feature 6/15).

## Listado por estado (revisión y apartados)

- **R15** — El módulo de órdenes del maestro DEBE mostrar de forma SEPARADA las órdenes
  en `en_fulfillment` y las órdenes en `en_preparacion` (ambos estados de revisión), como
  agrupaciones/apartados distintos.
- **R16** — El módulo DEBE mostrar un apartado propio para las órdenes en
  `en_espera_aceptacion` ("En espera de aceptación del mensajero") y otro para las
  órdenes en `en_bodega`.
- **R17** — El sistema DEBE permitir seleccionar, vía checkbox, una o varias órdenes de un
  mismo apartado para procesarlas por lote.

## "Generar guía" desde estados de revisión (Decisiones 1, 2, 4, 5 y alcance)

- **R18** — El botón "Generar guía" DEBE aplicar a órdenes seleccionadas que estén en
  `en_fulfillment` O en `en_preparacion` (AMBOS estados de revisión; las tiendas sin
  fulfillment que nacen `en_preparacion` también requieren guía y asignación).
- **R19** — CUANDO el maestro pulsa "Generar guía" sobre un lote seleccionado, el sistema
  DEBE asignar `num_guia` a TODAS las órdenes del lote que aún no lo tengan (incluidas las
  que terminarán en `en_bodega`): la guía existe con independencia de la aceptación del
  mensajero (Decisión 2).
- **R20** — CUANDO el maestro pulsa "Generar guía", el sistema DEBE agrupar la selección
  en (a) órdenes CON `mensajero_sugerido_id` y (b) órdenes SIN `mensajero_sugerido_id`, y
  presentar (Modal async, feature 13) la decisión por lote con override por orden
  (Decisión 5).
- **R21** — SI el maestro confirma asignar una orden a su `mensajero_sugerido_id`,
  ENTONCES el sistema DEBE fijar `mensajero_asignado_id = mensajero_sugerido_id` y pasar
  esa orden a `en_espera_aceptacion`.
- **R22** — SI el maestro decide, para una orden, asignar OTRO mensajero (override),
  ENTONCES el sistema DEBE fijar `mensajero_asignado_id` = el mensajero elegido y pasar
  esa orden a `en_espera_aceptacion`.
- **R23** — SI el maestro decide, para una orden, NO asignar mensajero (dejar sin),
  ENTONCES el sistema DEBE dejar `mensajero_asignado_id = NULL` y pasar esa orden a
  `en_bodega` (habiéndole asignado igualmente `num_guia`, R19).
- **R24** — El sistema DEBE resolver un caso mixto (algunas a mensajero, otras a
  `en_bodega`) en UNA SOLA llamada a la acción, que recibe la decisión FINAL por orden:
  `{ ordenId, mensajeroId }` con `mensajeroId: string | null` (`null` = a `en_bodega`)
  (Decisión 5).
- **R25** — La operación de "Generar guía" sobre el lote DEBE ser transaccional: o se
  aplican `num_guia` + estado + `mensajero_asignado_id` de todas las órdenes elegibles del
  lote, o no se aplica ninguna (sin lotes a medio numerar ante un fallo).

## Asignación desde `en_bodega`

- **R26** — CUANDO el maestro selecciona una o varias órdenes en `en_bodega` y les asigna
  un mensajero, el sistema DEBE fijar `mensajero_asignado_id` = el mensajero elegido y
  pasar esas órdenes a `en_espera_aceptacion`. (Estas órdenes ya poseen `num_guia` desde
  su paso previo por "Generar guía"; no se reasigna, R5.)

## Guardias por estado de origen y validez del mensajero

- **R27** — El sistema DEBE validar el estado de ORIGEN permitido en cada transición y
  rechazar (`validation_error`/`conflict`, sin efectos) transiciones inválidas:
  a `en_espera_aceptacion`/`en_bodega` vía "Generar guía" solo desde `en_fulfillment` o
  `en_preparacion`; a `en_espera_aceptacion` vía asignación de bodega solo desde
  `en_bodega`.
- **R28** — CUANDO se asigna un mensajero (sugerido confirmado, override o desde bodega),
  el `mensajeroId` recibido DEBE corresponder a un usuario existente con rol `mensajero`;
  SI no lo es, ENTONCES el sistema DEBE responder `validation_error` sin aplicar la
  transición de esa orden. En esta feature la lista de mensajeros seleccionables es la de
  TODOS los usuarios con rol `mensajero`, SIN filtro por zona (el filtrado por zona/GAM es
  la feature 30; ver "Límites").
- **R29** — SI el lote enviado incluye una orden que no existe, está borrada
  (`deleted_at`), o no está en un estado de origen permitido, ENTONCES el sistema DEBE
  reportar el fallo de esa orden sin dejar la transacción a medias (R25) y sin afectar
  las órdenes válidas fuera de la transacción abortada.

## No-regresión y trazabilidad

- **R30** — El cambio de `num_guia` a NULLABLE NO DEBE romper la lectura/serialización de
  órdenes en el CRUD/listado (features 6/7): los consumidores del tipo `numGuia` DEBEN
  tratarlo como `number | null` (barrido de tipos), y una orden aún sin guía DEBE poder
  listarse mostrando la guía como vacía/pendiente.
- **R31** — El resto del flujo de carga masiva (feature 15/16/27: dedup intra-archivo y
  contra DB, resolución geográfica, mensajero sugerido, batching, estado inicial
  condicional `en_fulfillment`/`en_preparacion`) DEBE conservarse idéntico salvo por dejar
  de asignar `num_guia` (R2).
- **R32** — Cada requisito (`R1`–`R31`) DEBE quedar mapeado a al menos un test concreto
  (tabla de trazabilidad; el `implementer` la completa con rutas en
  `progress/impl_17-revision-maestro-generar-guia.md`).

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R0  | revisión documental: puerta F1.4 marcada APROBADA (reviewer) |
| R1  | integration/db: `orden.num_guia` es nullable, sin default, UNIQUE intacto |
| R2  | unit repo + integration: crear orden (CRUD y `createManyOrdenes`) persiste `num_guia = NULL` |
| R3  | integration/db: `orden_num_guia_seq` existe, `OWNED BY NONE`; `nextval` avanza |
| R4  | integration: dos "Generar guía" consecutivas producen `num_guia` únicos e incrementales |
| R5  | unit service: orden con `num_guia` existente no se reasigna; secuencia no avanza para ella |
| R6  | script/CI: aplicar migración up y `down.sql` (db:rollback); down falla si hay guías NULL |
| R7  | integration/db: columna `mensajero_asignado_id` FK nullable, `ON DELETE SET NULL`, índice |
| R8  | unit repo: crear orden persiste `mensajero_asignado_id = NULL` |
| R9  | unit: `ORDER_STATUS_SEED` incluye `en_espera_aceptacion`; `seedOrderStatus` idempotente |
| R10 | integration/db: migración inserta fila `en_espera_aceptacion`; enum contiene el valor; down condicional |
| R11 | unit service: `maestro` puede generar guía/asignar |
| R12 | unit service: `admin` en escritura → `forbidden`; lectura permitida |
| R13 | unit service: `adminTienda`/`mensajero`/otro en escritura → `forbidden` |
| R14 | unit action: sin actor → `unauthenticated` antes del service |
| R15 | component: apartados separados `en_fulfillment` y `en_preparacion` |
| R16 | component: apartados `en_espera_aceptacion` y `en_bodega` presentes |
| R17 | component: selección múltiple por checkbox dentro de un apartado |
| R18 | unit service: "Generar guía" acepta origen `en_fulfillment` Y `en_preparacion` |
| R19 | unit service: todas las órdenes del lote (incl. destino `en_bodega`) reciben `num_guia` |
| R20 | component/unit: agrupación (a) con sugerido / (b) sin sugerido en el modal |
| R21 | unit service: confirmar sugerido → `mensajero_asignado_id`=sugerido, estado `en_espera_aceptacion` |
| R22 | unit service: override otro mensajero → `mensajero_asignado_id`=elegido, `en_espera_aceptacion` |
| R23 | unit service: sin mensajero → `mensajero_asignado_id`=NULL, `en_bodega`, con `num_guia` |
| R24 | unit service: una sola llamada resuelve lote mixto por `{ordenId, mensajeroId\|null}` |
| R25 | integration: fallo a mitad del lote → rollback total (ninguna orden numerada) |
| R26 | unit service: `en_bodega` + mensajero → `en_espera_aceptacion`, sin reasignar guía |
| R27 | unit service: transición desde estado no permitido → rechazo sin efectos |
| R28 | unit service: `mensajeroId` sin rol `mensajero` → `validation_error`; lista sin filtro de zona |
| R29 | integration: orden inexistente/borrada/estado inválido en el lote → fallo aislado, sin transacción a medias |
| R30 | unit/type: `numGuia` tratado como `number \| null`; listado con guía pendiente |
| R31 | unit/integration: tests de carga masiva (15/16/27) verdes salvo `num_guia` NULL |
| R32 | revisión: todos los R con test asociado (reviewer) |

---

## Decisiones aprobadas (humano, 2026-07-10)

Cerradas en la puerta F1.4. No quedan preguntas abiertas.

1. **[APROBADO] `num_guia` diferido vía SEQUENCE de Postgres dedicada.** Se reutiliza
   `orden_num_guia_seq` (SERIAL de la feature 6), desligada del `DEFAULT` con
   `ALTER SEQUENCE ... OWNED BY NONE`; `nextval()` por fila en la transacción de
   "Generar guía". `num_guia` pasa a NULLABLE; la carga masiva deja de asignarlo.
   Idempotente (`UPDATE ... WHERE num_guia IS NULL`). Migración up + `down.sql`
   (el down falla si hay guías NULL) + RLS coherente. → R1–R6, R19, R25.
2. **[APROBADO] "Generar guía" asigna `num_guia` a TODAS las seleccionadas**, incluidas
   las que van a `en_bodega`: la guía existe con independencia de la aceptación. → R19, R23.
3. **[APROBADO] Escritura solo `maestro`; `admin` solo-lectura** en este módulo; guardia
   por estado de origen permitido en cada transición. → R11–R14, R27.
4. **[APROBADO] Nuevo campo `orden.mensajero_asignado_id`** (FK → usuario, nullable,
   `ON DELETE SET NULL`), distinto de `mensajero_sugerido_id` (trazabilidad sugerido vs
   asignado); lo consumirá la feature 36. → R7, R8.
5. **[APROBADO] UX del Modal (feature 13) por lote**: agrupa la selección en (a) con
   sugerido y (b) sin sugerido; resuelve por lote con override por orden (cambiar
   mensajero o dejar sin → `en_bodega`); caso mixto en una sola llamada a la acción que
   recibe la decisión final por orden (`mensajeroId` o `null`). → R20, R24.

**Alcance APROBADO:** el botón "Generar guía" aplica a AMBOS estados de revisión
(`en_fulfillment` Y `en_preparacion`). → R18.

**Estado nuevo APROBADO:** `en_espera_aceptacion` se agrega a `ORDER_STATUS_SEED` + fila
de catálogo por migración (patrón feature 28). → R9, R10.

## Límites (fuera de alcance de esta feature)

- **Filtro por ZONA/GAM y ruteo a bodega satélite → feature 30.** Aquí la asignación es
  SIN filtro de zona: la lista de mensajeros seleccionables es la de todos los usuarios con
  rol `mensajero`. La feature 30 luego restringe esa lista SIN reescribir el contrato de
  la acción (R28).
- **Rechazo/aceptación posterior del mensajero → feature 36.** Aquí solo se DEPOSITA la
  orden en `en_espera_aceptacion`; no se modela la respuesta del mensajero.
- **Feature 24 (`provincia.zona_id` eliminado; `orden.zona_id` derivado del distrito)** no
  es foco de esta feature y NO es dependencia; se tiene en cuenta pero no se toca.
