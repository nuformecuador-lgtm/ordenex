# Feature 135 — Unificar nomenclatura de `order_status` (rename de values) · requirements

> Zona: fullstack (chore) · Complexity: high · Rama: `feature/135-order-status-rename-nomenclatura` · depends_on: null
> Fundacional del lote 135–138.

## Alcance en una frase
Renombrar el **`value`** de 6 estatus de orden cuyo identificador diverge de su
etiqueta UI, para que backend y frontend compartan un único identificador canónico
(**opción A**), de forma **reversible**, **sin tocar `orden.estatus_id`** (la FK es por
`id`), **sin cambiar el orden** de `ORDER_STATUS_SEED` y **sin cambiar ninguna etiqueta
visible** (el rename es del `value`, no del label).

## Mapeo propuesto (a CONFIRMAR en el gate)
Cada nuevo `value` ya coincide con la etiqueta que la UI muestra hoy
(`ORDER_STATUS_LABELS`, `app/(app)/ordenes/_components/EstatusBadge.tsx`):

| # | `value` actual | `value` nuevo | Label UI vigente (no cambia) |
|---|----------------|---------------|------------------------------|
| 1 | `en_reparto` | `en_ruta` | "En ruta" |
| 2 | `en_espera_aceptacion` | `por_recoger` | "Por recoger" |
| 3 | `en_bodega` | `en_bodega_central` | "En B. Central" |
| 4 | `en_ruta_bodega_principal` | `en_ruta_bodega_central` | "Enviando a B. Central" |
| 5 | `devuelta_origen` | `devolviendo_a_tienda` | "Devolviendo a tienda" |
| 6 | `recibido_origen` | `en_tienda` | "En tienda" |

Los otros 9 valores NO cambian: `entregada`, `devuelta`, `reprogramada`,
`en_fulfillment`, `en_preparacion`, `en_ruta_bodega_satelite`, `rechazada`,
`en_bodega_satelite`, `sin_gestionar`.

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
  (`app/(app)/ordenes/_components/EstatusBadge.tsx`), preservando **sin cambio** las
  etiquetas de texto y la semántica de variante/clase asociada a cada estado.

- **R7 (Por evento — resolución/comparación por `value` en la lógica).** CUANDO la lógica
  de negocio resuelva o compare un estatus por `value` (constantes `ESTADO_*`/`ORIGEN_*`/
  `ESTATUS_*`, `Set`/arrays de estados como `ESTADOS_CANCELABLES_API`, `ESTADOS_PENDIENTES`,
  `ORIGEN_RUTEO_SATELITE`, el mapa de destinos de cierre, y las uniones discriminadas
  tipadas por literal como `estado: "recibido_origen"`), el sistema DEBE usar el nuevo
  `value`, de modo que `findEstatusIdByValue` y las guardas de transición sigan
  resolviendo al `id` correcto y ninguna resolución `value → id` devuelva `null`.

- **R8 (Por evento — etiqueta visible intacta).** CUANDO la UI muestre un estado
  renombrado, el sistema DEBE presentar la MISMA etiqueta legible que hoy (p. ej. "Por
  recoger", "En ruta", "En B. Central", "Devolviendo a tienda", "En tienda"). Ninguna
  cadena de texto renderizada DEBE cambiar por efecto de esta feature.

- **R9 (Condicional — contrato externo API/webhook).** SI el gate aprueba unificar también
  el contrato externo, ENTONCES el sistema DEBE exponer los nuevos `value` en el enum de
  estado de la API (`lib/api/openapi-spec.ts`), en su documento OpenAPI
  (`docs/api/api-key-openapi.yaml`) y en la lista de eventos de webhook
  (`lib/types/webhook-eventos.ts`). Ver "Preguntas abiertas Q2": estos son valores
  visibles para integradores; el default propuesto es renombrarlos (opción A unifica en
  todas las capas).

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
| R8 | Tests de UI que afirman `getByText(<label>)` siguen verdes con el MISMO texto. |
| R9 | Tests de API/webhook (`ordenes-api-key-*`, `webhook-estado-*`) con nuevos valores (si gate aprueba). |
| R10 | `tests/integration/db/order-status-enum-migration.test.ts` desacoplado: afirma los 8 literales históricos. |
| R11 | Guard R13 no marca `en_bodega_satelite`/`en_ruta_bodega_satelite`; `orden-repository`/config tests verdes. |
| R12 | Todas las suites de la tabla en verde + test NUEVO de la migración rename. |
| R13 | Test/guard de censo case-sensitive de los 6 valores antiguos (excepciones de R10/R3). |

## Preguntas abiertas (resolver en el gate antes de implementar)

1. **Confirmación del mapeo (Q1).** ¿Se confirman los 6 nuevos `value` de la tabla?
   Cada uno se derivó para coincidir con la etiqueta UI vigente. Ambigüedades menores a
   validar: `en_bodega_central` vs. `en_bodega` (label "En B. Central") y
   `en_ruta_bodega_central` vs. `en_ruta_bodega_principal` (label "Enviando a B.
   Central") — se propone "central" por consistencia con la satélite (`en_bodega_satelite`).

2. **Alcance del contrato externo (Q2, gobierna R9).** Renombrar `value` cambia lo que ven
   los integradores de la API key y los suscriptores de webhooks (`lib/api/openapi-spec.ts`,
   `docs/api/api-key-openapi.yaml`, `lib/types/webhook-eventos.ts`, respuestas de
   `app/api/ordenes/api-key/**`). Es un cambio **breaking** del contrato externo.
   Propuesta por defecto: **renombrar también en el contrato externo** (opción A =
   identificador único en todas las capas). Alternativa si hay consumidores en producción:
   mantener nombres externos estables vía una capa de traducción en el borde de la API
   (contradice la unificación; solo si el gate lo exige).

3. **Guard de censo (Q3) en CI.** El repo no tiene GitHub Actions (CI = build de Vercel).
   ¿Se acepta el guard R13 como test de la suite (Vitest) en vez de un check de CI
   dedicado? Propuesta por defecto: sí, como test.

4. **Barrido de comentarios (Q4).** Cientos de comentarios y nombres de test citan los
   valores antiguos (p. ej. `// origen = en_reparto`). Se propone actualizarlos por
   consistencia aunque no sean literales de runtime (mismo criterio que la feature 118).
   Confirmar que se desea este barrido cosmético (asumido: sí; el guard R13 lo exige salvo
   que se acote su alcance a solo literales de código).
