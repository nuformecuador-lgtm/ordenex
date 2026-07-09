# Requisitos — ordenes (CRUD backend)

> Alcance: catálogo `order_status` (tabla + seed), tablas de geografía jerárquica
> (`zona` → `provincia` → `canton` → `distrito`), modelo `orden`, sus migraciones
> reversibles con RLS, y el CRUD (crear, listar/leer, actualizar, borrar lógico)
> expuesto como Server Actions con validación zod, manejo de errores y
> **autorización por rol**. NO incluye UI: el listado en pantalla es la feature
> separada `ordenes - list` (id 7); aquí solo se especifica el backend y el
> contrato que esa UI consumirá.
>
> Diseño FIRME: las preguntas de producto quedaron resueltas por el humano. Solo
> restan pendientes menores (no bloqueantes) listados al final como "Notas".
> Complejidad de la feature: `high` (feature_list.json id 6).
>
> **Dependencia operativa conocida (ver R14b):** `zona_id`/`provincia_id`/
> `canton_id` son NOT NULL y la geografía se crea vacía; no se puede crear ninguna
> orden hasta poblar al menos una zona, provincia y cantón. Los tests de creación
> deben sembrar geografía en su setup (fixtures).

## Catálogo de estatus (`order_status`)

- **R1 (ubicuo):** El sistema DEBE persistir los estatus de orden en una **tabla
  catálogo** `order_status` (no un enum Postgres), con campos `id` (uuid TEXT) y
  `value` único.
- **R2 (ubicuo):** El sistema DEBE poder sembrar `order_status` de forma
  idempotente con exactamente estos 7 valores: `entregada`, `devuelta`,
  `devuelta_origen`, `reprogramada`, `embalaje`, `en_ruta_bodega_principal`,
  `en_bodega`.
- **R3 (por evento):** CUANDO el seed de `order_status` se ejecuta más de una vez,
  el sistema DEBE conservar las filas y sus `id` existentes sin duplicar
  registros (upsert por `value`), replicando el patrón de `seedRoles`/`ROLES_SEED`
  (fuente única de verdad en TypeScript).

## Geografía jerárquica

- **R4 (ubicuo):** El sistema DEBE crear cuatro tablas jerárquicas, inicialmente
  **vacías** (sin seed): `zona`, `provincia`, `canton`, `distrito`; cada una con
  `id` (uuid TEXT) y `nombre`.
- **R5 (ubicuo):** El sistema DEBE relacionar `provincia.zona_id` → `zona.id`,
  `canton.provincia_id` → `provincia.id` y `distrito.canton_id` → `canton.id`
  mediante claves foráneas.
- **R6 (ubicuo):** El sistema DEBE crear las cuatro tablas de geografía en un orden
  que respete las dependencias de FK (padre antes que hijo) y revertirlas en orden
  inverso en su `down.sql`.

## Modelo `orden`

- **R7 (ubicuo):** El sistema DEBE persistir cada orden con: `id` (uuid TEXT),
  `num_guia`, `num_remision`, `estatus_id` (FK → `order_status`), `destinatario`,
  `telefono_dest`, `tienda_id` (FK → `usuario`), `zona_id`, `provincia_id`,
  `canton_id`, `distrito_id`, `producto`, `peso`, `notas`, `deleted_at`,
  `created_at`, `updated_at`.
- **R8 (ubicuo):** El sistema DEBE generar `num_guia` automáticamente como un
  **entero autoincremental** con unicidad garantizada; `num_guia` NUNCA lo provee
  el usuario.
- **R9 (ubicuo):** El sistema DEBE exigir `num_remision` como valor **provisto por
  el usuario**, obligatorio y único entre todas las órdenes.
- **R10 (ubicuo):** El sistema DEBE almacenar `estatus_id` como FK NOT NULL a
  `order_status`, con valor inicial por defecto `en_bodega` al crear (ver Nota N1).
- **R11 (ubicuo):** El sistema DEBE exigir `tienda_id` como FK NOT NULL a
  `usuario` (la "tienda" es un usuario, típicamente rol `adminTienda`).
- **R12 (ubicuo):** El sistema DEBE definir `zona_id`, `provincia_id` y
  `canton_id` como FK **NOT NULL** (cada una a su tabla de geografía respectiva) y
  `distrito_id` como FK **nullable**. Entre los campos de negocio de `orden`, los
  únicos nullable son `distrito_id` y `notas`; todos los demás son NOT NULL.
  (`deleted_at` es un marcador de sistema de soft delete, nullable por naturaleza,
  y no cuenta como campo de negocio.)
- **R13 (ubicuo):** El sistema DEBE almacenar `peso` como tipo numérico de
  precisión fija (decimal), nunca punto flotante ni texto.
- **R14 (ubicuo):** El sistema DEBE garantizar unicidad de `num_guia` y de
  `num_remision` a nivel de base de datos (índices únicos).
- **R14a (ubicuo):** El sistema DEBE almacenar `notas` como texto **nullable**.
- **R14b (condicional):** SI no existe al menos una `zona`, una `provincia` y un
  `canton` referenciables, ENTONCES el sistema NO puede crear ninguna orden (las
  FKs `zona_id`/`provincia_id`/`canton_id` son NOT NULL y la geografía se crea
  vacía). Es una **dependencia operativa conocida**: la geografía DEBE poblarse
  antes de crear órdenes. `distrito_id` es nullable, por lo que no bloquea.

## Migración y seguridad de datos (RLS)

- **R15 (ubicuo):** El sistema DEBE crear `order_status`, las 4 tablas de
  geografía y `orden` mediante migraciones Prisma versionadas, cada una con
  `migration.sql` (UP) y `down.sql` (DOWN) que la revierta exactamente en orden
  inverso de dependencia.
- **R16 (ubicuo):** El sistema DEBE habilitar Row Level Security (`ENABLE ROW
  LEVEL SECURITY`) sobre `order_status`, `zona`, `provincia`, `canton`, `distrito`
  y `orden`, sin policies para `anon`/`authenticated` (acceso solo por service
  role del servidor; defensa en profundidad, patrón del repo).
- **R17 (por evento):** CUANDO se ejecuta el rollback (`down.sql`), el sistema DEBE
  eliminar solo las tablas creadas por esa migración, sin afectar tablas
  preexistentes (`usuario`, etc.).

## Autenticación y autorización por rol

- **R18 (condicional):** SI una Server Action de CRUD se invoca sin sesión válida
  (cookie `session` ausente o expirada), ENTONCES el sistema DEBE rechazar con un
  error de no autenticado, sin tocar la base de datos.
- **R19 (ubicuo):** El sistema DEBE resolver el rol del actor desde su usuario de
  sesión y autorizar cada operación según la **matriz rol→operación** siguiente.
- **R20 (condicional):** SI el actor tiene rol `maestro` o `admin`, ENTONCES el
  sistema DEBE permitirle crear, leer, listar, actualizar y borrar **cualquier**
  orden.
- **R21 (condicional):** SI el actor tiene rol `adminTienda`, ENTONCES el sistema
  DEBE permitirle crear órdenes (forzando `tienda_id` = su propio `id`) y
  leer/listar/actualizar/borrar **únicamente** las órdenes cuyo `tienda_id`
  coincide con su `id`.
- **R22 (condicional):** SI el actor con rol `adminTienda` intenta crear una orden
  con `tienda_id` distinto de su propio `id`, ENTONCES el sistema DEBE rechazar la
  operación con error de autorización (ver Nota N4).
- **R23 (condicional):** SI el actor tiene rol `mensajero`, ENTONCES el sistema
  DEBE permitirle leer y listar órdenes y actualizar **únicamente el `estatus_id`**
  de una orden, y DEBE rechazar crear, borrar o modificar cualquier otro campo.
- **R24 (condicional):** SI el actor no está autorizado para la operación o la
  orden objetivo (según la matriz), ENTONCES el sistema DEBE rechazar con un error
  de autorización (`forbidden`), sin modificar datos.

### Matriz rol → operación

| Rol          | crear                    | leer/listar         | actualizar          | borrar              |
| ------------ | ------------------------ | ------------------- | ------------------- | ------------------- |
| `maestro`    | Sí (todas)               | Sí (todas)          | Sí (todas)          | Sí (todas)          |
| `admin`      | Sí (todas)               | Sí (todas)          | Sí (todas)          | Sí (todas)          |
| `adminTienda`| Sí (solo `tienda_id`=él) | Sí (solo las suyas) | Sí (solo las suyas) | Sí (solo las suyas) |
| `mensajero`  | No                       | Sí (todas)          | Solo `estatus_id`   | No                  |

## Crear orden

- **R25 (por evento):** CUANDO se recibe una solicitud de creación, el sistema DEBE
  validar la entrada con un schema zod en el borde antes de llamar a la capa de
  servicio.
- **R26 (condicional):** SI la entrada de creación no cumple el schema
  (`num_remision` ausente, `destinatario`/`telefono_dest`/`producto` ausentes,
  `peso` no numérico o negativo, `zona_id`/`provincia_id`/`canton_id` ausentes o
  inexistentes, `estatus_id` inexistente en catálogo, `distrito_id` inexistente
  cuando se provee), ENTONCES el sistema DEBE rechazar con error de validación por
  campo, sin crear la orden. `zona_id`, `provincia_id` y `canton_id` son
  obligatorios (R12); `distrito_id` y `notas` son opcionales.
- **R27 (por evento):** CUANDO la entrada es válida y el actor está autorizado, el
  sistema DEBE crear la orden asignando `num_guia` automáticamente (R8), fijando
  `estatus_id` por defecto `en_bodega` si no se especifica (R10), y persistiendo
  `created_at`/`updated_at`.
- **R28 (condicional):** SI el `num_remision` provisto ya existe en otra orden,
  ENTONCES el sistema DEBE fallar la creación con un error de conflicto, sin crear
  un duplicado.

## Leer / listar

- **R29 (por evento):** CUANDO se solicita una orden por `id`, el sistema DEBE
  devolverla si existe, no está borrada y el actor está autorizado (R19–R24); en
  caso contrario DEBE responder con error de "no encontrada" (`not_found`).
- **R30 (por evento):** CUANDO se solicita el listado, el sistema DEBE devolver las
  órdenes visibles para el actor (según la matriz) en una estructura paginada que
  incluya como mínimo la página de resultados y el total de elementos, de modo que
  la feature 7 pueda renderizar una tabla con paginación.
- **R31 (por evento):** CUANDO el listado recibe filtro por `estatus_id` y/o orden
  por un campo de lista blanca (`created_at`, `num_guia`, `num_remision`) con
  dirección `asc`/`desc`, el sistema DEBE aplicarlos.
- **R32 (condicional):** SI los parámetros de paginación/orden/filtro son
  inválidos (página o tamaño no positivos, campo de orden fuera de la lista
  blanca, `estatus_id` inexistente), ENTONCES el sistema DEBE rechazar con error de
  validación, sin ejecutar la consulta.
- **R33 (ubicuo):** El sistema DEBE aplicar un límite máximo configurable al tamaño
  de página, para evitar consultas sin cota.
- **R34 (ubicuo):** El sistema NUNCA DEBE incluir órdenes borradas lógicamente
  (`deleted_at IS NOT NULL`) en lecturas ni listados por defecto.

## Actualizar

- **R35 (por evento):** CUANDO se recibe una actualización por `id`, el sistema
  DEBE validar la entrada con zod y verificar autorización (R19–R24) antes de
  modificar datos.
- **R36 (condicional):** SI la orden objetivo no existe o está borrada, ENTONCES el
  sistema DEBE responder `not_found`.
- **R37 (por evento):** CUANDO la actualización es válida y autorizada, el sistema
  DEBE aplicar solo los campos permitidos para el rol del actor (mensajero: solo
  `estatus_id`; maestro/admin/adminTienda: campos de negocio editables), rechazar
  cambios a campos inmutables (`id`, `num_guia`, `created_at`), actualizar
  `updated_at` y persistir.
- **R38 (condicional):** SI la actualización cambia `estatus_id` a un valor que no
  existe en `order_status`, ENTONCES el sistema DEBE rechazar con error de
  validación.

## Borrar (lógico)

- **R39 (por evento):** CUANDO se recibe un borrado por `id` de un actor autorizado
  a borrar (maestro/admin, o adminTienda sobre las suyas), el sistema DEBE marcar
  la orden como borrada de forma **lógica** (fijar `deleted_at`) y excluirla de
  lecturas/listados por defecto (R34).
- **R40 (condicional):** SI la orden objetivo no existe o ya está borrada, ENTONCES
  el sistema DEBE responder `not_found`.
- **R41 (condicional):** SI el actor tiene rol `mensajero`, ENTONCES el sistema DEBE
  rechazar cualquier solicitud de borrado con `forbidden` (R23).

## Manejo de errores (transversal)

- **R42 (ubicuo):** El sistema DEBE devolver desde cada Server Action un resultado
  tipado y discriminado por estado (éxito con datos, error de validación con
  errores por campo, `unauthenticated`, `forbidden`, `not_found`, `conflict`), sin
  lanzar excepciones sin envolver y sin filtrar detalles internos ni PII en el
  mensaje.

## Criterios de aceptación verificables

Cada requisito se considera cumplido solo si existe un test que lo ejercita
(unitario de service/validación/seed o de integración de la Server Action), según
el mapa de `tasks.md`. Un requisito sin test es un fallo de la feature
(docs/verification.md).

## Notas (pendientes menores, no bloqueantes)

- **N1 — Estatus inicial por defecto:** se fija `en_bodega` como estatus inicial
  al crear cuando el input no especifica `estatus_id`. Ajustable por
  configuración.
- **N2 — Paginación/orden del listado:** offset-based (`page`/`pageSize`) con
  conteo total; orden por defecto `created_at desc`. Formato exacto en `design.md`.
- **N3 — Exposición de `num_guia`:** se expone **crudo** (entero) en el DTO; el
  formateo con ceros a la izquierda, si se requiere, es responsabilidad de la UI
  (feature 7).
- **N4 — `adminTienda` con `tienda_id` ajeno (R22):** se opta por **rechazo**
  explícito (`forbidden`) en vez de override silencioso, para que el
  comportamiento sea observable y testeable.
