# Feature 153 — `order_status`: `en_ruta` → `en_reparto` · requirements

> Zona: backend · Complexity: medium · depends_on: null · Bloquea a la 154 (`depends_on: 153`).
> Lote "flujo de estados v2". Esta feature es **puramente mecánica**: aísla ~80 archivos de
> cambio de nombre para que no se mezclen con los cambios semánticos de la 154/155.

## Alcance en una frase

Renombrar el `value` `en_ruta` del catálogo `order_status` a `en_reparto` y su etiqueta UI
de "En ruta" a "En reparto", **sin cambiar absolutamente nada del flujo**: mismas aristas,
mismos servicios, misma semántica, mismo número de estados, mismos `id` y mismas FKs.

## Mapeo (ÚNICO; decidido por el humano el 2026-07-28, no reabrir)

| `value` actual | `value` nuevo | Label UI actual | Label UI nuevo |
|----------------|---------------|-----------------|----------------|
| `en_ruta` | `en_reparto` | "En ruta" | "En reparto" |

**NO se renombra nada más en este lote.** En particular:

- `en_ruta_bodega_satelite` sigue llamándose así y su label sigue siendo "En ruta a bodega
  satélite" (**no** pasa a "Por recibir en satélite" pese a lo que dibuje el diagrama).
- `en_ruta_bodega_central` sigue igual ("En ruta a bodega central").
- Los participios femeninos se conservan: `entregada`/"Entregada", `devuelta`/"Devuelta",
  `reprogramada`/"Reprogramada", `rechazada`/"Rechazada", `sin_gestionar`/"Sin gestionar".

## Hechos de inventario verificados (no supuestos)

1. **`order_status` es una TABLA CATÁLOGO, no un enum.** El enum Postgres
   `order_status_value` fue dropeado en `20260714123909_reconcile_fks_drop_order_status_value`.
   Hoy es `model OrderStatus { id String @id; value String @unique }`
   (`db/schema.prisma:353-366`) y `orden.estatus_id` / `orden_historial_estado.estatus_*_id`
   son FKs por `id`. El rename es un `UPDATE` de una fila, no un `ALTER TYPE`.
2. **Esta feature REVIERTE uno de los 6 renames de la feature 135.** La migración
   `20260724120000_order_status_rename_nomenclatura/migration.sql:7` hizo
   `en_reparto → en_ruta`. Consecuencia directa: el guard
   `tests/unit/guards/censo-order-status-rename.test.ts` hoy censa `en_reparto` como value
   ANTIGUO prohibido; hay que **intercambiar** esa entrada por `en_ruta`, no duplicarla.
3. **La UI del mensajero ya dice "En reparto".** El apartado de `en_ruta` en
   `MisAsignacionesModule.tsx:405-417` se titula "En reparto / por gestionar" y
   `PosOrderCard.tsx:45` muestra el estado "En reparto". El rename **alinea** el value y el
   badge con el vocabulario que la pantalla ya usa; no introduce vocabulario nuevo.
4. **Los identificadores TS ya dicen "reparto".** `ESTATUS_EN_REPARTO`
   (`OrdenRepository.ts:48`), `ESTADO_EN_REPARTO` (`CorteDiarioRepository.ts:16`,
   `CierreDiaService.ts:65`, `CorteDiarioService.ts:20`, `MisAsignacionesService.ts:37`) y
   `enRepartoEstatusId` (`ICierreDiaRepository.ts:64`) quedaron con el nombre viejo tras la
   135. Esta feature cambia **literales string**, no nombres de símbolos.
5. **Censo real: 84 archivos** citan `\ben_ruta\b` fuera de `specs/`, `progress/` y
   `feature_list.json` (la ficha decía ~76). De esos, **3 no se tocan** (los 2 SQL de la
   migración de la 135 y el test que traza esa migración) → **81 a editar**, más el guard de
   censo. Desglose en `design.md §Apéndice A`.

---

## Requisitos (EARS)

- **R1 (Ubicuo — catálogo TS).** El sistema DEBE listar `en_reparto` en `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`) **en el índice 10**, conservando los otros 17 `value` y su
  orden; tras la feature `en_ruta` NO DEBE existir en la tupla y la longitud DEBE seguir
  siendo 18, sin duplicados.

- **R2 (Por evento — migración UP).** CUANDO se aplique la migración UP de esta feature, el
  sistema DEBE ejecutar exactamente **una** sentencia
  `UPDATE "order_status" SET "value" = 'en_reparto' WHERE "value" = 'en_ruta';`, sin
  `ALTER TYPE`, sin `CREATE TABLE`/`DROP TABLE`, sin `LIKE` y sin mencionar la columna
  `"id"`. La sentencia DEBE ser idempotente (0 filas si el `value` antiguo ya no existe).

- **R3 (Por evento — migración DOWN reversible).** CUANDO se aplique el `down.sql` de esta
  feature, el sistema DEBE ejecutar el inverso exacto
  (`SET "value" = 'en_ruta' WHERE "value" = 'en_reparto'`), dejando `order_status` idéntica
  al estado previo al UP (mismo `id`, mismo `value`, mismo conteo de filas).

- **R4 (De estado — integridad de FKs sin reescritura).** MIENTRAS existan filas de `orden`
  y de `orden_historial_estado` que referencian este estatus por `estatus_id`,
  `estatus_origen_id` o `estatus_destino_id`, tras el UP esas filas DEBEN conservar su
  identificador de estatus sin cambio, sin reescritura de `orden` ni del historial y sin
  variación de sus conteos, y DEBEN leerse con el nuevo `value` a través del catálogo.

- **R5 (NEGATIVO — vecinos intactos).** El sistema NO DEBE alterar `en_ruta_bodega_central`
  ni `en_ruta_bodega_satelite` (ni ningún otro de los 17 `value` restantes): el `WHERE` de
  la migración DEBE ser por igualdad EXACTA y el censo de `en_ruta` DEBE ser por igualdad
  exacta con frontera de palabra, sin marcar a esos dos vecinos.

- **R6 (Ubicuo — grafo idéntico salvo el nombre del nodo).** El sistema DEBE conservar en
  `TRANSICIONES` (`lib/types/order-status-transiciones.ts`) el **mismo número de aristas y
  el mismo conjunto de pares `(origen, destino)`** que antes de la feature, con el único
  cambio de que el nodo `en_ruta` pasa a llamarse `en_reparto`. NO DEBE agregarse, quitarse
  ni reetiquetarse ninguna arista, familia (`via`) ni rol.

- **R7 (Ubicuo — aristas nominadas).** El sistema DEBE conservar, con `en_reparto` en el
  lugar de `en_ruta`, las aristas del inventario: `#11` (`por_recoger → en_reparto`,
  `recoleccion`), `#12`–`#15` (`en_reparto → entregada|reprogramada|devuelta|rechazada`,
  `gestion`), `#16` (`en_reparto → sin_gestionar`, `corte_sin_gestionar`) y las seis de
  `deshacer_gestion` `#31`–`#36` (`entregada|reprogramada|rechazada|en_bodega_central|
  en_bodega_satelite|devuelta → en_reparto`), cada una con su misma `via` y su mismo `rol`.

- **R8 (Ubicuo — conjuntos de estados sin cambio).** El sistema DEBE dejar `ESTADOS_CREACION`
  (`en_preparacion`, `en_fulfillment`, `en_ruta_bodega_central`), `ESTADOS_TERMINALES`
  (`entregada`, `devuelta_a_tienda`) y `ESTADOS_VESTIGIALES` (vacío) **sin ningún cambio de
  contenido**: `en_reparto` no entra ni sale de ninguno de ellos.

- **R9 (Ubicuo — etiqueta UI).** El sistema DEBE presentar `en_reparto` con la etiqueta
  exacta **"En reparto"** en `ORDER_STATUS_LABELS`; ningún otro label DEBE cambiar de texto
  y ningún label DEBE quedar siendo exactamente "En ruta". Las etiquetas compuestas
  "En ruta a bodega central" y "En ruta a bodega satélite" DEBEN permanecer literales.

- **R10 (Ubicuo — presentación preservada).** El sistema DEBE conservar para `en_reparto`
  la MISMA variante de badge (`secondary`) y el MISMO refuerzo de acento de marca en
  `ORDER_STATUS_CLASS` (cadena de tokens idéntica, carácter a carácter, a la que hoy tiene
  `en_ruta` y que comparte con `en_fulfillment`). El rename NO DEBE degradar el chip a la
  variante neutra sin clase.

- **R11 (Por evento — render del badge).** CUANDO se renderice el chip de estatus de una
  orden cuyo `value` es `en_reparto`, el sistema DEBE mostrar el texto "En reparto" con la
  variante y las clases de R10; y CUANDO se construya el selector de filtro de estatus del
  listado de órdenes, la opción correspondiente DEBE leerse "En reparto".

- **R12 (Ubicuo — resolución `value → id` en la lógica).** El sistema DEBE usar
  `en_reparto` en todas las constantes, `Set`, arrays y uniones-literal que resuelven o
  comparan este estatus por `value` (entre otras: `ESTATUS_EN_REPARTO`, `ESTADO_EN_REPARTO`,
  `ORIGEN_GESTION`, `ESTADOS_PENDIENTES` de `CierreDiaService`), de modo que ninguna
  resolución `value → id` devuelva `null` y el comportamiento observable de mis-asignaciones,
  cierre de día, corte diario y gestión de orden sea **idéntico** al previo.

- **R13 (Ubicuo — contrato externo).** El sistema DEBE exponer `en_reparto` (y NO `en_ruta`)
  en el enum de estados de la API por API key (`lib/api/openapi-spec.ts`), en su espejo
  publicado (`docs/api/api-key-openapi.yaml`, las 4 apariciones del enum) y en la lista de
  eventos públicos de webhook (`lib/types/webhook-eventos.ts`), que DEBE seguir teniendo 9
  elementos. No DEBE existir capa de traducción al nombre antiguo.

- **R14 (De estado — trabajos en vuelo).** MIENTRAS existan trabajos `webhook_estado`
  encolados antes del despliegue (su payload guarda `estatusDestinoId`, un id, no el
  `value`), la entrega posterior al despliegue DEBE resolver el estado contra el catálogo
  ya migrado y emitir `en_reparto`, sin fallar ni emitir un estado desconocido.

- **R15 (Ubicuo — guard de censo EXTENDIDO, no duplicado).** El sistema DEBE mantener UN
  solo guard de censo (`tests/unit/guards/censo-order-status-rename.test.ts`) cuya lista de
  values prohibidos **quite `en_reparto`** (que pasa a ser el value vigente) y **agregue
  `en_ruta`**, conservando los otros cinco (`en_espera_aceptacion`,
  `en_ruta_bodega_principal`, `en_bodega`, `devuelta_origen`, `recibido_origen`). NO DEBE
  crearse un segundo archivo de guard.

- **R16 (Condicional — invariante de censo).** SI se ejecuta el censo case-sensitive sobre
  `app/`, `lib/`, `components/`, `hooks/`, `scripts/`, `tests/` y `e2e/`, ENTONCES NO DEBE
  haber ninguna coincidencia de `en_ruta` fuera de la allowlist, y la allowlist DEBE
  limitarse a los archivos que por diseño trazan literales históricos (el propio guard, el
  test de la migración de la 135 y el test de la migración de esta feature).

- **R17 (Ubicuo — censo de la etiqueta).** El sistema DEBE censar también la etiqueta
  antigua como literal exacto entre comillas (`"En ruta"`), de modo que quede en cero en
  `app/`, `lib/`, `components/`, `tests/` y `e2e/`, SIN marcar las etiquetas compuestas
  ("En ruta a bodega central", "En ruta a bodega satélite", "En ruta a bodega \<zona\>").

- **R18 (NEGATIVO — migraciones históricas inmutables).** El sistema NO DEBE modificar
  ninguna migración ya versionada, incluidas
  `20260711150000_gestion_orden_estados_metodo_pago`,
  `20260714150000_seed_order_status_completo` y
  `20260724120000_order_status_rename_nomenclatura` (ni su `down.sql`). El cambio DEBE
  introducirse en una migración NUEVA con `migration.sql` (UP) + `down.sql` (DOWN), con
  timestamp posterior a la última existente.

- **R19 (NEGATIVO — cero cambio de flujo ni de superficie).** El sistema NO DEBE agregar ni
  quitar estados del catálogo (18 antes, 18 después), NI crear/renombrar/eliminar rutas,
  Route Handlers o Server Actions, NI cambiar la forma de ningún payload, NI tocar tablas,
  columnas, índices o políticas RLS. Lo único que viaja distinto es el **valor textual** del
  estado.

- **R20 (Ubicuo — tests coherentes).** Todos los tests, fixtures y specs e2e que usen
  `en_ruta` como dato de entrada, id sintético de catálogo o aserción DEBEN pasar a
  `en_reparto`, incluidas la aserción posicional `ORDER_STATUS_SEED[10]`, el inventario
  `tests/fixtures/inventario-transiciones-140.ts` y el helper
  `tests/fixtures/catalogo-estados.ts`. ADEMÁS DEBE existir un test de la migración NUEVA
  que verifique el UPDATE del UP (R2), su inverso en el DOWN (R3) y que un round-trip
  UP→DOWN deja el catálogo exactamente como estaba (R3/R4).

- **R21 (Condicional — verificación ejecutable).** SI la feature se declara terminada,
  ENTONCES `npm run typecheck`, `npm run lint`, `npm test` y `./init.sh` DEBEN terminar en
  verde, y la migración DEBE haberse aplicado y revertido con éxito en un entorno de prueba
  (`db:migrate` + `db:rollback`).

## Trazabilidad requisito → prueba (resumen; el mapa fino lo cierra el implementer)

| R | Verificación |
|---|--------------|
| R1 | `tests/unit/types/order-status.test.ts`: set de 18 con `en_reparto`, sin `en_ruta`, `[10] === "en_reparto"`. |
| R2 | Test NUEVO de migración: lee `migration.sql`, afirma el único UPDATE y la ausencia de `ALTER TYPE`/`CREATE TABLE`/`DROP TABLE`/`"id"`/`LIKE`. |
| R3 | Test NUEVO de migración: `down.sql` inverso + round-trip UP→DOWN sobre catálogo en memoria. |
| R4 | Test NUEVO de migración: filas de `orden`/historial por id inalteradas y conteos estables tras aplicar el UP parseado. |
| R5 | Test NUEVO: el UP no menciona los vecinos; guard: `\ben_ruta\b` no matchea `en_ruta_bodega_central`/`_satelite`. |
| R6 | `tests/unit/domain/order-status-transiciones.guardia.test.ts`: nº de aristas y set de pares invariante. |
| R7 | `tests/fixtures/inventario-transiciones-140.ts` + guardia de transiciones: #11–#16 y #31–#36 presentes con su `via`/`rol`. |
| R8 | Guardia de transiciones: `ESTADOS_CREACION`/`ESTADOS_TERMINALES`/`ESTADOS_VESTIGIALES` sin cambio. |
| R9 | `tests/components/EstatusLabel.test.ts`: `en_reparto → "En reparto"`; ningún label === "En ruta". |
| R10 | Test de badge: variante `secondary` + clases de acento de marca idénticas a las de `en_fulfillment`. |
| R11 | Tests de `EstatusBadge`/`OrdenesListado` (opción de filtro) y de columnas del listado. |
| R12 | Suites de `MisAsignacionesService`, `CierreDiaService`, `CorteDiarioService`, `GestionOrdenRepository`, `CierreDiaRepository`, `CorteDiarioRepository` en verde con el nuevo value. |
| R13 | Test que lee `docs/api/api-key-openapi.yaml` y `lib/api/openapi-spec.ts` (contienen `en_reparto`, no `en_ruta`) + `webhook-eventos` con 9 elementos. |
| R14 | `tests/unit/services/webhook-estado-service.test.ts` + `webhook-estado-encolado.test.ts` con el value nuevo resuelto desde el id. |
| R15 | El propio guard: `OLD_VALUES` tiene 6 entradas, incluye `en_ruta`, excluye `en_reparto`. |
| R16 | Guard de censo en verde con allowlist de 7 basenames (los 6 actuales + el test de la migración nueva). |
| R17 | Caso nuevo del guard: censo del literal `"En ruta"` con aserción explícita de que no marca los compuestos. |
| R18 | Test NUEVO: la carpeta de migración es nueva y su nombre ordena después de `20260724120000_*`; los SQL históricos no cambian (diff vacío en `git`). |
| R19 | `ORDER_STATUS_SEED` sigue con 18; sin migración de schema (`prisma migrate diff` vacío); sin archivos nuevos en `app/api/**` ni `lib/actions/**`. |
| R20 | Suite completa en verde + test NUEVO de la migración. |
| R21 | Salida de `./init.sh` y de la suite pegada en `progress/impl_153.md`. |

---

## Preguntas abiertas

1. **Contrato externo breaking, otra vez.** Renombrar el estado en
   `docs/api/api-key-openapi.yaml` y en el payload de webhook rompe a cualquier integrador
   que compare contra `"en_ruta"`. La feature 135 ya lo rompió hace 4 días sin bumpear
   `info.version` (sigue en `1.0.0`) ni publicar changelog. ¿Se repite esa política, o esta
   vez toca bumpear versión / avisar a integradores? **No asumo ninguna de las dos.**
2. **Cola de webhooks en el momento del deploy.** Los jobs `webhook_estado` encolados antes
   de migrar se entregarán con el value NUEVO (el emisor resuelve `estatusDestinoId → value`
   al entregar, `WebhookEstadoService.ts:70,92`). ¿Se acepta ese comportamiento (R14) o se
   quiere drenar la cola antes de aplicar la migración?
3. **Alcance del barrido de comentarios.** Cerca de la mitad de las 366 ocurrencias son
   comentarios y nombres de test (`// en_ruta -> sin_gestionar`, docstrings de interfaces).
   El guard de censo (R16) obliga a tocarlos todos. ¿Se confirma ese alcance, o se prefiere
   acotar el guard solo a literales de código (opción que dejaría la documentación interna
   mintiendo)?
4. **`tests/components/OrdenesPage.test.tsx:122`** usa la ETIQUETA como si fuera un value
   (`estatusValue: "En ruta"`), cosa que el guard de values no detecta pero sí el censo de
   etiqueta (R17). ¿Se cambia el texto a "En reparto" (mínimo cambio) o se aprovecha para
   corregir el fixture y pasarle un `value` real (`en_reparto`)?
5. **Comentario desactualizado en `db/schema.prisma:356`**: dice `seed (15, ver
   ORDER_STATUS_SEED)` cuando hoy el catálogo tiene 18 values. Al tocar ese comentario para
   el rename, ¿se corrige de paso el conteo (fuera del alcance estricto) o se deja tal cual?
