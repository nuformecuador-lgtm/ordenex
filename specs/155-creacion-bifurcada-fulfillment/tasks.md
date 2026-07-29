# Feature 155 — Tasks

> `[P]` = paralelizable con las tareas marcadas igual dentro del mismo bloque.
> Cada task cierra con su **Hecho cuando** verificable. Un commit por task
> (`feat(155): …` / `test(155): …` / `chore(155): …`).
> Verificación global al final: `npm run typecheck`, `npm run lint`, `npm test`, `./init.sh`.

---

## Bloque 0 — Puerta (BLOQUEA TODO)

- [x] **T0.1 — Cerrar las preguntas abiertas con el humano.** *(cerrada 2026-07-29)*
      Dep: ninguna. Entrada: `design.md §8` (manifiesto: A/B/C) y `requirements.md > Preguntas
      abiertas` (2 eventos públicos, 3 integradores con bodega propia, 4 arista de la 154, 5 etiqueta
      en el acto, 6 zona de la feature).
      **Hecho cuando:** las 6 respuestas están escritas en `design.md §11` con fecha, y R24/R43
      quedan redactados en su forma final en `requirements.md`.
      **Hecho:** las 6 respuestas están en `design.md §11` (tabla con fecha) y R24/R43 quedan en
      forma final en `requirements.md`. Resumen: (1) manifiesto → **opción C**; (2) evento público →
      **sí**; (3) `apiKey` siempre en la rama (b), R21 se escribe igual como rama defensiva; (4) `#5`
      sobrevive; (5) etiqueta en el acto → 157; (6) zona → backend → frontend, sin `.tsx`.

- [x] **T0.2 — Confirmar que 153 y 154 están en `dev`.** *(verificado 2026-07-29)*
      Dep: ninguna. `por_recolectar_en_tienda` presente en `ORDER_STATUS_SEED`, en `TRANSICIONES`, en
      `ESTADOS_CREACION` y en `ORDER_STATUS_LABELS/VARIANT`; migración de la 154 aplicada en local
      (`prisma migrate deploy`).
      **Hecho cuando:** `npm test` pasa en verde en la rama base **antes** de tocar nada, y una
      consulta al catálogo local devuelve el value nuevo.
      **Hecho:** la rama base (`feature/155-creacion-bifurcada`, salida de `origin/dev` con 153, 154,
      156 y 160) da `pnpm run typecheck` sin errores y `pnpm test` en **569 archivos / 6218 tests, 0
      fallos**, ANTES de tocar nada. `por_recolectar_en_tienda` está en `ORDER_STATUS_SEED` (índice
      18), en `TRANSICIONES` (#43), en `ESTADOS_CREACION` y en los mapas de badge/label.
      **NO verificado:** la consulta al catálogo de una base local (no hay Postgres en este entorno;
      los tests de `tests/integration/db` son estáticos sobre el SQL). Queda declarado como deuda.

---

## Bloque 1 — Dominio (el punto único de decisión)

- [ ] **T1.1 — Crear `lib/services/destino-creacion.ts`.**
      Dep: T0.1, T0.2. Función pura `resolverDestinoCreacion(fulfillment: boolean): DestinoCreacion`
      con `estatus` / `conGuia` / `emiteManifiesto` (design §2). Sin Prisma, sin HTTP, sin
      `process.env`. Cubre R1–R3, R6.
      **Hecho cuando:** el módulo compila con `strict` y no importa nada de `lib/repositories/`,
      `lib/db/` ni `next/*`.

- [ ] **T1.2 — `tests/unit/services/destino-creacion.test.ts`.** `[P]` con T1.1 (TDD).
      Dep: T1.1. Casos: rama `true`, rama `false`, y el invariante **"los dos `estatus` que devuelve
      pertenecen a `ESTADOS_CREACION`"** (red de seguridad contra la 154). Cubre R1–R3, R6, R31.
      **Hecho cuando:** los 3 tests pasan y el tercero **falla** si se altera a mano un value.

---

## Bloque 2 — Catálogo, grafo y configuración (retiro en código)

> Estas cuatro tareas rompen el build entre sí a propósito (el `satisfies Record<OrderStatusValue,…>`
> es la red). Se hacen en **un solo commit** o en commits consecutivos sin push intermedio.

- [ ] **T2.1 — Retirar el value de `lib/types/order-status.ts`.**
      Dep: T1.2. Quitar `"en_fulfillment"` de `ORDER_STATUS_SEED`; actualizar el comentario de
      cabecera con la referencia a esta feature. Cubre R27.
      **Hecho cuando:** `ORDER_STATUS_SEED` ya no lo contiene y el build de TS señala exactamente los
      sitios que faltan por limpiar.

- [ ] **T2.2 — Retirar la clave del grafo y ajustar `ESTADOS_CREACION`.**
      Dep: T2.1. En `lib/types/order-status-transiciones.ts`: borrar la clave `en_fulfillment`; dejar
      `ESTADOS_CREACION = ["en_preparacion","por_recolectar_en_tienda"]`; reescribir el comentario
      `:151-158` para que cite `resolverDestinoCreacion` en vez de las tres constantes de config.
      **No relajar** `satisfies` ni `_EnsureExhaustive`. Cubre R22, R28, R31.
      **Hecho cuando:** `npm run typecheck` pasa y un experimento local (añadir un value falso al
      seed) rompe el build.

- [ ] **T2.3 — Limpiar `lib/config/ordenes.ts`.** `[P]` con T2.4.
      Dep: T2.1. Retirar `FULFILLMENT_ESTATUS_VALUE` y `DEFAULT_ESTATUS_VALUE` con sus dos variables
      de entorno; `OrdenesConfig` queda con las dos cotas de paginación. Actualizar
      `tests/unit/config/ordenes-config.test.ts`. Cubre R30.
      **Hecho cuando:** `grep -r "ORDENES_.*_ESTATUS_VALUE"` no devuelve nada fuera de `specs/` y
      `progress/`, y el test de config pasa.

- [ ] **T2.4 — Retirar el value de los orígenes de guía/ruteo.** `[P]` con T2.3.
      Dep: T2.1. `GuiaAsignacionService.ts:31,35` (`ORIGEN_GENERAR_GUIA`, `ORIGEN_RUTEO_SATELITE`) y
      el JSDoc de `IGuiaAsignacionService.ts:76,91`. Cubre R29.
      **Hecho cuando:** `tests/unit/services/guia-asignacion-service.test.ts` pasa con los casos de
      origen `en_fulfillment` **reemplazados** (no borrados) por casos de origen no permitido.

- [ ] **T2.5 — Actualizar el inventario de aristas.**
      Dep: T2.2. `tests/fixtures/inventario-transiciones-140.ts`: retirar `#1`,`#2`,`#3`,`#7b` y las
      entradas de creación `en_fulfillment` y `en_ruta_bodega_central`; verificar que la de creación
      `por_recolectar_en_tienda` esté (la pone la 154).
      **Hecho cuando:** `tests/unit/domain/order-status-transiciones.*.test.ts` pasan sin `skip`.

---

## Bloque 3 — Repositorio

- [ ] **T3.1 — `create` con guía opcional.**
      Dep: T1.1. `IOrdenRepository.create(data, historial, opciones?: { conGuia?: boolean })`, default
      `false`. Cuando es `true`, dentro de la **misma** tx: `UPDATE … SET num_guia = siguiente_num_guia()
      WHERE id = $1 AND num_guia IS NULL` (constante `NUM_GUIA_GENERATOR`) + relectura defensiva.
      Cubre R3, R8, R12.
      **Hecho cuando:** hay un test que crea con `conGuia: true` y otro con `false`, y un tercero que
      demuestra que una segunda pasada **no** consume un segundo número.

- [ ] **T3.2 — Cerrar el hueco de geocodificación en `createManyOrdenesConGuia`.**
      Dep: ninguna (independiente de T3.1) `[P]`. Encolar geocodificación por orden efectivamente
      insertada, dentro de la tx del chunk, con el mismo criterio de `createManyOrdenes:931-936`.
      Cubre R11.
      **Hecho cuando:** un test verifica un encolado por orden nueva y **cero** por orden duplicada,
      en las **dos** rutas de lote y en `create`.

---

## Bloque 4 — Servicios (las tres vías)

- [ ] **T4.1 — Alta manual (`OrdenService.crear`).**
      Dep: T1.1, T2.3, T3.1. Resolver el flag por `tiendaId`; usar `resolverDestinoCreacion`; borrar
      la rama de `estatusId` explícito y el campo del `crearOrdenSchema`; guarda de catálogo con el
      value nombrado. Cubre R5, R7, R13–R15.
      **Hecho cuando:** `tests/unit/services/orden-service.test.ts` cubre: maestro creando para
      tienda con flag `true` y con flag `false`, adminTienda creando para sí, `estatusId` arbitrario
      ignorado, catálogo incompleto → `validation_error`, duplicado → `conflict`.

- [ ] **T4.2 — Carga masiva por UI (`BulkOrdenService.cargarMasiva`).** `[P]` con T4.3.
      Dep: T1.1, T2.3, T3.2. Sustituir la ternaria `:272-275`; elegir repositorio por
      `destino.conGuia`; `precargar` con el value resuelto. Cubre R4, R16–R18.
      **Hecho cuando:** `bulk-orden-service.test.ts` cubre: lote con flag `true` (sin guía, en
      `en_preparacion`), lote con flag `false` (con guía, en `por_recolectar_en_tienda`), `dryRun`
      sin consumir guías, duplicada sin guía ni historial, y **una sola** llamada a
      `findUsuarioFulfillment` por lote.

- [ ] **T4.3 — Carga por API key (`BulkOrdenService.cargarViaApi`).** `[P]` con T4.2.
      Dep: T1.1, T3.2. Borrar `ESTATUS_INICIAL_API`; usar `resolverDestinoCreacion` sobre el dueño de
      la key; `CargaViaApiOrden.numGuia` pasa a `number | null`. Cubre R19–R23.
      **Hecho cuando:** `bulk-orden-service.carga-api.test.ts` pasa con los dos casos (incluido el
      defensivo de flag `true` → `numGuia: null`), y las aserciones actuales de
      `findUsuarioFulfillment).not.toHaveBeenCalled()` quedan **invertidas**, no borradas.

- [ ] **T4.4 — Manifiesto de la rama (b).**
      Dep: T0.1 (opción elegida), T4.1–T4.3. Según A/B/C de `design.md §8`. Cubre R24–R26.
      **Hecho cuando:** existe un test que arma el manifiesto de un lote recién nacido en
      `por_recolectar_en_tienda` con `origen` = tienda y `destino` = bodega central, y otro que
      demuestra que un fallo del manifiesto **no** revierte la creación.

---

## Bloque 5 — Migración y datos

- [ ] **T5.1 — Crear la migración.**
      Dep: T2.1. `pnpm run db:migrate:create` → `db/migrations/<ts>_order_status_retiro_en_fulfillment/`.
      Escribir `migration.sql` con los 3 pasos de `design.md §4.1` (rastro → backfill → `DELETE`
      condicional). Cubre R34–R37, R40.
      **Hecho cuando:** el SQL corre dos veces seguidas contra una base local **con** órdenes en ese
      estado y la segunda pasada afecta 0 filas.

- [ ] **T5.2 — Escribir `down.sql` a mano.**
      Dep: T5.1. Los 3 pasos de `design.md §4.2`. Cubre R38.
      **Hecho cuando:** `pnpm run db:rollback` deja la base **exactamente** como estaba antes de
      T5.1 (mismo conteo por estado y mismo conteo de filas de historial), verificado con consulta.

- [ ] **T5.3 — Tests de integración de la migración.**
      Dep: T5.1, T5.2. En `tests/integration/db/`: UP mueve las órdenes (incluidas las borradas
      lógicamente) sin tocar `num_guia`/mensajero; UP deja el rastro con `origen_tipo = ajuste_estado`
      y sin actor; UP **no** reescribe historial previo; `DELETE` condicional respeta las referencias;
      censo de datos = 0; DOWN restaura. Cubre R34–R39.
      **Hecho cuando:** `npm test -- tests/integration/db` pasa en verde con la base de test migrada.

- [ ] **T5.4 — Verificar que el backfill no dispara efectos.**
      Dep: T5.1. Cubre R40.
      **Hecho cuando:** un test comprueba que tras el UP no hay filas nuevas en la cola de jobs
      (`webhook_estado`, geocodificación) ni notificaciones para las órdenes migradas.

---

## Bloque 6 — UI mínima forzada por el retiro

- [ ] **T6.1 — `EstatusBadge.tsx`.** `[P]` con T6.2.
      Dep: T2.1. Retirar la entrada de `ORDER_STATUS_LABELS`, de `ORDER_STATUS_VARIANT` y el
      **refuerzo de acento propio** de `ORDER_STATUS_CLASS:74-75`. Cubre R28, R41.
      **Hecho cuando:** `tests/components/EstatusLabel.test.ts` pasa y hay un caso que verifica que un
      value desconocido cae al chip neutro con el texto crudo (R41).

- [ ] **T6.2 — Listado y revisión del maestro.** `[P]` con T6.1.
      Dep: T2.1. `OrdenesRevisionMaestro.tsx:163-176` (apartado "En fulfillment"),
      `OrdenesListado.tsx:71,106,282` (`ESTADOS_MENSAJERO_SUGERIDO`, `ESTADOS_ASIGNACION`,
      `accionesDe`), comentario de `ordenes-columns.tsx:192`. Cubre R32.
      **Hecho cuando:** `OrdenesRevisionMaestro.test.tsx`, `OrdenesListadoBloqueoCierre.test.tsx`,
      `OrdenesListadoEtiquetasChain.test.tsx` y `GenerarGuiaModal.test.tsx` pasan sin el value.

---

## Bloque 7 — Contrato público

- [ ] **T7.1 — OpenAPI + espejo documental.**
      Dep: T2.1, T4.3. `lib/api/openapi-spec.ts:12-27` y `docs/api/api-key-openapi.yaml` en el
      **mismo commit**; añadir a la descripción del endpoint de carga la nota del cambio
      incompatible de estado inicial. Cubre R42.
      **Hecho cuando:** un test compara el enum del objeto contra `ORDER_STATUS_SEED` y contra el
      `.yaml`, y falla si divergen.

- [ ] **T7.2 — Política de eventos públicos.**
      Dep: T0.1 (respuesta a la pregunta 2). Añadir `por_recolectar_en_tienda` a `EVENTOS_PUBLICOS`
      si el humano lo confirma. Cubre R43.
      **Hecho cuando:** `tests/unit/services/webhook-estado-encolado.test.ts` demuestra que la
      creación por API key de una tienda con suscripción activa **sigue** encolando un evento.

---

## Bloque 8 — Censo y cierre

- [ ] **T8.1 — Extender el guard de censo.**
      Dep: T2.*, T4.*, T6.*, T7.*. Añadir `en_fulfillment` a `OLD_VALUES` de
      `tests/unit/guards/censo-order-status-rename.test.ts` (extender, **no** duplicar el archivo) y
      justificar una a una las entradas nuevas de la allowlist. Cubre R33.
      **Hecho cuando:** el guard pasa en verde y la allowlist tiene un comentario por archivo
      explicando por qué ese archivo conserva el literal.

- [ ] **T8.2 — Limpiar el resto de tests y el E2E.**
      Dep: T8.1. `orden-repository.guia.test.ts`, `guia-asignacion-service.test.ts` (28
      ocurrencias), `guia-asignacion-gate-coordenadas.test.ts`, `recepcion-satelite-service.test.ts`,
      `webhook-estado-encolado.test.ts`, `EscanerRecepcion.test.tsx`, `ManifiestoFlujos.test.tsx`,
      `order-status.test.ts` (conteo e índices), `e2e/reprogramacion-liberacion.spec.ts`.
      **Hecho cuando:** `npm test` en verde y el guard de T8.1 sin ofensores.

- [ ] **T8.3 — Mapa `R<n> → test` en `progress/impl_155.md`.**
      Dep: todo lo anterior. Una fila por requisito R1–R43 con el test concreto que lo cubre, más la
      salida real de `npm test` y de `./init.sh`.
      **Hecho cuando:** no queda ningún requisito sin test y `./init.sh` termina en verde.

---

## Orden sugerido

```
T0.1 ─┬─ T0.2
      │
      └─► T1.1 ─► T1.2 ─┬─► T2.1 ─┬─► T2.2 ─► T2.5
                        │         ├─► T2.3 [P]
                        │         ├─► T2.4 [P]
                        │         ├─► T5.1 ─► T5.2 ─► T5.3 / T5.4
                        │         ├─► T6.1 [P] / T6.2 [P]
                        │         └─► T7.1
                        ├─► T3.1
                        └─► T3.2 [P]
                                  └─► T4.1 ─┬─ T4.2 [P]
                                            ├─ T4.3 [P]
                                            └─► T4.4
T0.1 ─────────────────────────────────────────► T7.2
todo ──────────────────────────────────────────► T8.1 ─► T8.2 ─► T8.3
```
