# Feature 135 — Unificar nomenclatura de `order_status` (rename de values) · requirements

> Zona: fullstack (chore) · Complexity: high · Rama: `feature/135-order-status-rename-nomenclatura` · depends_on: null
> Fundacional del lote 135–138.

## Alcance en una frase
Renombrar el **`value`** de 6 estatus de orden cuyo identificador diverge de su etiqueta
UI y **alinear las etiquetas** para que sean la versión legible directa del `value`, de
modo que backend, frontend y contrato externo compartan un único nombre canónico
(**opción A**), de forma **reversible**, **sin tocar `orden.estatus_id`** (la FK es por
`id`) y **sin cambiar el orden** de `ORDER_STATUS_SEED`.

## Mapeo (CONFIRMADO en el gate)
El rename unifica el identificador y, además, la etiqueta UI pasa a ser la versión legible
DIRECTA del `value` (sin abreviaturas), de modo que código y pantalla usen el mismo nombre
(ver R8):

| # | `value` actual | `value` nuevo | Label UI nuevo (= value legible) |
|---|----------------|---------------|----------------------------------|
| 1 | `en_reparto` | `en_ruta` | "En ruta" |
| 2 | `en_espera_aceptacion` | `por_recoger` | "Por recoger" |
| 3 | `en_bodega` | `en_bodega_central` | "En bodega central" |
| 4 | `en_ruta_bodega_principal` | `en_ruta_bodega_central` | "En ruta a bodega central" |
| 5 | `devuelta_origen` | `devolviendo_a_tienda` | "Devolviendo a tienda" |
| 6 | `recibido_origen` | `devuelta_a_tienda` | "Devuelta a tienda" |

Los otros 9 valores NO se renombran, pero SÍ se alinea su etiqueta si diverge del value
(R8): `en_ruta_bodega_satelite` → "En ruta a bodega satélite" (antes "Por recibir en
satélite") y `en_bodega_satelite` → "En bodega satélite" (antes "En satélite"). Los 7
restantes ya tienen etiqueta legible alineada y no cambian: `entregada`, `devuelta`,
`reprogramada`, `en_fulfillment`, `en_preparacion`, `rechazada`, `sin_gestionar`.

**Cuidado case-sensitive (confirmado en el censo):** el rename de `en_bodega` es por
igualdad EXACTA; NO debe tocar `en_bodega_satelite` ni `en_ruta_bodega_satelite`. No
existe ningún literal `en_bodega_principal` en el repo (0 coincidencias).

## Hecho de inventario que corrige la premisa de la descripción
La descripción menciona `ALTER TYPE order_status_value RENAME VALUE`. El censo
demuestra que **ese enum ya NO existe**: `order_status_value` fue **DROPPEADO** en
`db/migrations/20260714123909_reconcile_fks_drop_order_status_value/migration.sql:17`.
Hoy `order_status` es una **tabla de catálogo** con `value String @unique`
(`db/schema.prisma:348-359`) y `orden.estatus_id` es FK por `id`
(`db/schema.prisma:445,479`). Por tanto la migración es **UPDATE de filas**, NO
`ALTER TYPE`. Precedente exacto: `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/`.

---

## Requisitos (EARS)

- **R1 (Ubicuo — mapeo canónico).** El sistema DEBE aplicar exactamente el mapeo de la
  tabla anterior sobre los 6 valores. Tras la feature, los 6 `value` ANTIGUOS
  (`en_reparto`, `en_espera_aceptacion`, `en_bodega`, `en_ruta_bodega_principal`,
  `devuelta_origen`, `recibido_origen`) NO DEBEN existir como valor vigente en la tabla
  `order_status` ni en `ORDER_STATUS_SEED`; los 9 valores restantes DEBEN permanecer
  idénticos y el conteo total DEBE seguir siendo 15.

- **R2 (Por evento — migración UP).** CUANDO se aplique la migración UP de esta feature,
  el sistema DEBE renombrar cada `value` con una sentencia
  `UPDATE "order_status" SET "value" = '<nuevo>' WHERE "value" = '<antiguo>'` (6 en
  total), sin `ALTER TYPE` (no hay enum Postgres vigente), sin recrear la tabla y sin
  modificar la columna `order_status.id`. Cada UPDATE DEBE ser idempotente (0 filas si el
  valor antiguo ya no existe) y el conjunto DEBE ser orden-independiente (ningún `value`
  nuevo colisiona con un `value` antiguo aún presente).

- **R3 (Por evento — migración DOWN reversible).** CUANDO se aplique el `down.sql` de esta
  feature, el sistema DEBE revertir cada UPDATE (`'<nuevo>'` → `'<antiguo>'`), dejando la
  tabla `order_status` idéntica al estado previo al UP (mismos `id`, mismos `value`
  históricos, mismo conteo).

- **R4 (De estado — integridad de FKs, sin reescritura).** MIENTRAS existan filas en
  `orden` y en `orden_historial_estado` que referencian estos estatus por
  `estatus_id` / `estatus_origen_id` / `estatus_destino_id` (todas FK por `order_status.id`),
  tras el UP esas filas DEBEN conservar su `estatus_id` sin cambio y quedar "leyéndose"
  con el nuevo `value`, sin reescritura de `orden` ni de `orden_historial_estado` y sin
  variación de sus conteos.

- **R5 (Ubicuo — fuente única de tipos TS).** El sistema DEBE reflejar los 6 nuevos
  `value` en la fuente única de verdad `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`), **conservando el orden posicional** (15 elementos). El
  tipo `OrderStatusValue = (typeof ORDER_STATUS_SEED)[number]` DEBE quedar con los nuevos
  literales y el chequeo de tipos del build DEBE quedar verde.

- **R6 (Ubicuo — mapas por `value`).** El sistema DEBE actualizar las CLAVES de todos los
  mapas `Record<OrderStatusValue, …>` a los nuevos `value`: `ORDER_STATUS_LABELS`,
  `ORDER_STATUS_VARIANT` y `ORDER_STATUS_CLASS`
  (`app/(app)/ordenes/_components/EstatusBadge.tsx`), preservando **sin cambio** la
  semántica de variante/clase asociada a cada estado (el texto de las etiquetas se rige por
  R8). El case especial de `en_ruta_bodega_satelite` en `EstatusBadge` (label dinámico con
  `zonaNombre`) DEBE mantenerse funcional y coherente con la nueva etiqueta estática.

- **R7 (Por evento — resolución/comparación por `value` en la lógica).** CUANDO la lógica
  de negocio resuelva o compare un estatus por `value` (constantes `ESTADO_*`/`ORIGEN_*`/
  `ESTATUS_*`, `Set`/arrays de estados como `ESTADOS_CANCELABLES_API`, `ESTADOS_PENDIENTES`,
  `ORIGEN_RUTEO_SATELITE`, el mapa de destinos de cierre, y las uniones discriminadas
  tipadas por literal como `estado: "recibido_origen"`), el sistema DEBE usar el nuevo
  `value`, de modo que `findEstatusIdByValue` y las guardas de transición sigan
  resolviendo al `id` correcto y ninguna resolución `value → id` devuelva `null`.

- **R8 (Ubicuo — etiqueta UI = value legible).** El sistema DEBE presentar como etiqueta de
  cada estatus la versión legible DIRECTA de su `value`, sin abreviaturas, de modo que
  código y pantalla se llamen igual. `ORDER_STATUS_LABELS`
  (`app/(app)/ordenes/_components/EstatusBadge.tsx`) DEBE quedar alineado con los `value`
  según la tabla del mapeo. Cambian de texto: `en_bodega_central` → "En bodega central",
  `en_ruta_bodega_central` → "En ruta a bodega central", `devuelta_a_tienda` → "Devuelta a
  tienda", y —aunque NO se renombran— `en_ruta_bodega_satelite` → "En ruta a bodega
  satélite" y `en_bodega_satelite` → "En bodega satélite". Los demás labels ya están
  alineados y no cambian su texto. Los tests de UI que afirmaban las etiquetas abreviadas
  antiguas ("En B. Central", "Enviando a B. Central", "Por recibir en satélite", "En
  satélite", "En tienda") DEBEN actualizarse a las nuevas.

- **R9 (Ubicuo — contrato externo API/webhook, APROBADO por el gate).** El sistema DEBE
  exponer los nuevos `value` en TODAS las capas externas (cambio breaking aceptado): el
  enum de estado de la API (`lib/api/openapi-spec.ts`), su documento OpenAPI publicado
  (`docs/api/api-key-openapi.yaml`), la lista de eventos de webhook
  (`lib/types/webhook-eventos.ts`) y las respuestas de `app/api/ordenes/api-key/**`. NO se
  mantiene ninguna capa de traducción a nombres antiguos.

- **R10 (NEGATIVO — migraciones históricas inmutables).** El sistema NO DEBE modificar
  migraciones ya versionadas/aplicadas (la creación del enum
  `20260710150000_order_status_value_enum`, el seed
  `20260714150000_seed_order_status_completo`, los `ADD VALUE`/`INSERT` de features 17/30/
  33/36/109/PR#75, ni el `down.sql` de `20260714123909`). El cambio DEBE introducirse en
  una migración NUEVA con `migration.sql` (UP) + `down.sql` (DOWN). Los tests que leen SQL
  histórico DEBEN desacoplarse de `ORDER_STATUS_SEED` y afirmar los literales HISTÓRICOS.

- **R11 (NEGATIVO — no tocar vecinos ni `estatus_id`).** El sistema NO DEBE renombrar
  `en_bodega_satelite`, `en_ruta_bodega_satelite` ni ningún otro de los 9 valores no
  listados; NO DEBE alterar `orden.estatus_id` ni las columnas FK del historial; y NO DEBE
  cambiar los defaults de creación (`en_preparacion` / `en_fulfillment`,
  `lib/config/ordenes.ts`), que no están entre los renombrados.

- **R12 (Ubicuo — tests coherentes con el `value` vigente).** Todos los tests que usen un
  `value` renombrado como dato de entrada o aserción (seeds de QA, datos de repos/
  servicios, `getByText`, aserciones de set) DEBEN usar el nuevo `value`. En
  `tests/unit/types/order-status.test.ts` las aserciones POSICIONALES
  (`ORDER_STATUS_SEED[8]`, `[10]`, `[13]`) DEBEN conservar su índice y cambiar el literal;
  la aserción de conjunto DEBE listar los nuevos valores. ADEMÁS DEBE existir un test de la
  migración NUEVA que verifique los 6 UPDATE en UP y sus inversos en DOWN (traza R2/R3) y,
  con DB de test, que una fila con `value` antiguo pase al nuevo conservando su `id` (R4).

- **R13 (Ubicuo — invariante de censo / guard).** SI se ejecuta un censo case-sensitive de
  los 6 `value` ANTIGUOS sobre `app/`, `lib/`, `components/`, `hooks/`, `scripts/`,
  `tests/` y `e2e/` (excluyendo `db/migrations/` históricas, el `down.sql` de esta feature,
  y `feature_list.json`/`progress/`/`specs/`), ENTONCES NO DEBE haber ninguna coincidencia
  (contemplando `en_bodega` por igualdad exacta, sin falsos positivos de
  `en_bodega_satelite`). El literal antiguo solo puede sobrevivir en migraciones históricas
  y en el `down.sql` inverso de esta feature.

## Trazabilidad requisito → prueba (resumen; el mapa fino lo cierra el implementer)

| R | Verificación |
|---|--------------|
| R1 | `tests/unit/types/order-status.test.ts`: set == 15 valores nuevos; ausencia de los 6 antiguos. |
| R2 | Test lee `migration.sql` nuevo y afirma los 6 `UPDATE ... SET value='<nuevo>' WHERE value='<antiguo>'`. |
| R3 | Test lee `down.sql` nuevo y afirma los 6 UPDATE inversos. |
| R4 | Test integración DB: fila antigua → nueva conservando `id`; conteos de `orden`/historial estables. |
| R5 | `order-status.test.ts` + build type-check verde (`OrderStatusValue` deriva de la tupla). |
| R6 | `tests/components/EstatusLabel.test.ts`, `OrdenesEstatusLabelAdminTienda.test.tsx`: label por nueva key. |
| R7 | Suites de services/repositories que ejercen guardas de transición y sets de estado (ver design §Apéndice). |
| R8 | `tests/components/EstatusLabel.test.ts` + tests de badge: labels = value legible (textos nuevos). |
| R9 | Tests de API/webhook (`ordenes-api-key-*`, `webhook-estado-*`) exponen los nuevos valores. |
| R10 | `tests/integration/db/order-status-enum-migration.test.ts` desacoplado: afirma los 8 literales históricos. |
| R11 | Guard R13 no marca `en_bodega_satelite`/`en_ruta_bodega_satelite`; `orden-repository`/config tests verdes. |
| R12 | Todas las suites de la tabla en verde + test NUEVO de la migración rename. |
| R13 | Test/guard de censo case-sensitive de los 6 valores antiguos (excepciones de R10/R3). |

## Decisiones del gate (resueltas) y preguntas restantes

- **Q1 — Mapeo: RESUELTO.** Confirmado el mapeo de la tabla, con el ajuste del 6.º:
  `recibido_origen` → `devuelta_a_tienda` (NO `en_tienda`).
- **Q2 — Contrato externo: RESUELTO.** Se renombra en TODAS las capas (breaking aceptado);
  gobierna R9. Sin capa de traducción a nombres antiguos.
- **Q3 — Etiquetas: RESUELTO.** Las etiquetas se unifican con los `value` (versión legible
  directa, sin abreviaturas); gobierna R8. Aplica también a los 2 estatus satélite no
  renombrados cuya etiqueta divergía (`en_ruta_bodega_satelite`, `en_bodega_satelite`).

Preguntas restantes (default asumido; confirmar solo si se desea otra cosa):

1. **Guard de censo en CI.** El repo no tiene GitHub Actions (CI = build de Vercel). Se
   implementa el guard R13 como test de la suite (Vitest). (Asumido: sí.)
2. **Barrido de comentarios.** Cientos de comentarios y nombres de test citan los valores
   antiguos (p. ej. `// origen = en_reparto`). Se actualizan por consistencia aunque no
   sean literales de runtime (mismo criterio que la feature 118); el guard R13 lo exige
   salvo que se acote su alcance a solo literales de código. (Asumido: sí.)
