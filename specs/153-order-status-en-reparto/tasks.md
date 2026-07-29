# Feature 153 — `order_status`: `en_ruta` → `en_reparto` · tasks

> Requisitos en `requirements.md` (R1–R21) · decisiones en `design.md`.
> Rama sugerida: `feature/153-order-status-en-reparto`. Zona: backend.
> **Todo va en un solo PR / un solo deploy** (design §1.3: migración y código no pueden
> desplegarse por separado).
> `[P]` = paralelizable con las tareas marcadas igual dentro de la misma fase.
> Durante las fases 1–4 la suite estará ROJA a propósito: el guard de censo (T1.3) es la
> lista de pendientes. No es señal de error hasta la fase 6.

## Fase 0 — Preparación

- [x] **T0.1 — Rama y base migrada.**
  Crear la rama desde `dev`; `pnpm run db:migrate` para dejar la base local al día
  (última aplicada: `20260727120000_notificacion`) y `pnpm run db:generate` si el cliente
  Prisma está stale.
  _Hecho:_ `npm run typecheck` verde ANTES de tocar nada (línea base limpia).

- [x] **T0.2 — Censo de partida congelado.**
  Guardar la salida de un grep case-sensitive `\ben_ruta\b` sobre el repo y de `"En ruta"`
  (literal entre comillas).
  _Hecho:_ el conteo coincide con `design.md §Apéndice A` (84 archivos fuera de
  `specs/`/`progress/`/`feature_list.json`); si no coincide, actualizar el apéndice ANTES de
  seguir. (R16/R17)

## Fase 1 — Fuente de verdad, migración y guard

- [x] **T1.1 — `ORDER_STATUS_SEED`.** (dep: T0.1)
  En `lib/types/order-status.ts` cambiar `"en_ruta"` → `"en_reparto"` **en el índice 10**
  (sin mover nada) y actualizar los 2 comentarios que lo citan (`:12`, `:44`), dejando nota
  de la feature 153.
  _Hecho:_ la tupla tiene 18 elementos, `[10] === "en_reparto"`, y `npm run typecheck`
  empieza a fallar SOLO en los mapas/aristas pendientes (red de seguridad activa). (R1)

- [x] **T1.2 — Migración nueva UP + DOWN.** (dep: T1.1)
  Crear a mano `db/migrations/20260728120000_order_status_en_reparto/` con `migration.sql`
  (un `UPDATE … SET "value"='en_reparto' WHERE "value"='en_ruta';`) y `down.sql` (el
  inverso), copiando comentarios y estilo de
  `20260724120000_order_status_rename_nomenclatura/`.
  _Hecho:_ existen ambos archivos; ninguno contiene `ALTER TYPE`, `CREATE TABLE`,
  `DROP TABLE`, `LIKE` ni `"id"`; `pnpm run db:migrate` aplica sin error y
  `SELECT value FROM order_status WHERE value='en_reparto'` devuelve 1 fila con el mismo
  `id` que antes tenía `en_ruta`. (R2/R3/R4/R18)

- [x] **T1.3 — Guard de censo: SWAP (hacerlo temprano, es la checklist).** (dep: T1.1)
  En `tests/unit/guards/censo-order-status-rename.test.ts`: en `OLD_VALUES` **quitar**
  `en_reparto` y **agregar** `{ label: "en_ruta", re: /\ben_ruta\b/ }` (siguen siendo 6);
  agregar a `ALLOWLIST` el basename del test de T4.6; actualizar el comentario de cabecera
  para explicar que la 153 revierte uno de los 6 renames de la 135.
  _Hecho:_ `npx vitest run tests/unit/guards/censo-order-status-rename.test.ts` lista como
  ofensores exactamente los archivos pendientes del barrido (arranca en ~81 y baja a 0 al
  cerrar la fase 4). (R15)

- [x] **T1.4 — Casos de exactitud del guard.** [P] (dep: T1.3)
  Agregar el caso espejo del de `en_bodega`: `\ben_ruta\b` NO matchea `en_ruta_bodega_central`
  ni `en_ruta_bodega_satelite`, y SÍ matchea `estatus = "en_ruta"`.
  _Hecho:_ ese `it` pasa aislado. (R5/R16)

- [x] **T1.5 — Censo de la etiqueta antigua.** [P] (dep: T1.3)
  Agregar al guard un caso que busque el literal exacto `"En ruta"` (comillas incluidas) en
  `app/`, `lib/`, `components/`, `tests/`, `e2e/`, con aserción explícita de que NO marca
  `"En ruta a bodega central"` ni `"En ruta a bodega satélite"`.
  _Hecho:_ el caso falla hoy señalando `EstatusBadge.tsx`, `EstatusLabel.test.ts` y
  `OrdenesPage.test.tsx:122`, y pasa al cerrar T2.2/T4.4. (R17)

## Fase 2 — Dominio y presentación

- [x] **T2.1 — Grafo de transiciones.** (dep: T1.1)
  En `lib/types/order-status-transiciones.ts` renombrar la clave `en_ruta:` y los 7 destinos
  `{ to: "en_ruta" }` (aristas #11–#16 y #31–#36), **sin tocar `via`, `rol`, numeración ni
  ninguna otra arista**, y actualizar los comentarios que citen el value.
  _Hecho:_ el `satisfies Record<OrderStatusValue,…>` y `_EnsureExhaustive` compilan; el
  número de aristas y el conjunto de pares `(origen,destino)` es idéntico al de `dev` salvo
  el renombre del nodo; `ESTADOS_CREACION`/`_TERMINALES`/`_VESTIGIALES` sin cambios. (R6/R7/R8)

- [x] **T2.2 — Badge: label, variante y clase.** (dep: T1.1)
  En `app/(app)/ordenes/_components/EstatusBadge.tsx` mover la clave en los TRES mapas:
  `ORDER_STATUS_LABELS` (`en_reparto: "En reparto"`), `ORDER_STATUS_VARIANT`
  (`"secondary"`, sin cambio) y `ORDER_STATUS_CLASS` (**conservar byte a byte**
  `"bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light"`; es un `Partial`,
  el compilador NO avisa si se pierde).
  _Hecho:_ `ORDER_STATUS_CLASS.en_reparto === ORDER_STATUS_CLASS.en_fulfillment`, ningún
  label vale exactamente "En ruta", y "En ruta a bodega central"/"…satélite" siguen intactos.
  (R9/R10/R11)

## Fase 3 — Lógica y contrato externo

- [x] **T3.1 — Constantes y sets de la lógica.** [P] (dep: T1.1)
  Barrer los literales de `lib/repositories/{OrdenRepository,CorteDiarioRepository,
  CierreDiaRepository,GestionOrdenRepository,LiberacionReprogramadaRepository}.ts`,
  `lib/services/{MisAsignacionesService,CierreDiaService,CorteDiarioService}.ts` y
  `lib/actions/{cierre-dia,mis-asignaciones}.ts` (14 archivos del §A.d, incluidos
  comentarios). **No renombrar símbolos** (`ESTATUS_EN_REPARTO`, `enRepartoEstatusId`… ya
  dicen "reparto").
  _Hecho:_ 0 coincidencias de `en_ruta` en `lib/repositories`, `lib/services` y
  `lib/actions`; `npm run typecheck` verde en esos módulos. (R12)

- [x] **T3.2 — Interfaces y tipos de dominio.** [P] (dep: T1.1)
  `lib/interfaces/repositories/{ICierreDiaRepository,IGestionOrdenRepository,IOrdenRepository}.ts`,
  `lib/interfaces/services/{ICierreDiaService,IMisAsignacionesService}.ts` y
  `lib/types/orden-historial.ts` (todo comentarios/docstrings).
  _Hecho:_ 0 coincidencias en `lib/interfaces` y `lib/types` salvo lo ya migrado. (R12)

- [x] **T3.3 — Contrato externo.** [P] (dep: T1.1)
  `lib/api/openapi-spec.ts` (`ORDER_STATUS_ENUM`), `docs/api/api-key-openapi.yaml`
  (4 apariciones: líneas ~168/365/575/631) y `lib/types/webhook-eventos.ts`
  (`EVENTOS_PUBLICOS`).
  _Hecho:_ los tres archivos dicen `en_reparto` y ninguno dice `en_ruta`; `EVENTOS_PUBLICOS`
  sigue con 9 elementos; el `.yaml` sigue siendo espejo textual del objeto TS. (R13)

- [x] **T3.4 — Comentarios de UI del mensajero y schema.** [P] (dep: T1.1)
  `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` (2, comentarios),
  `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts` (1, comentario) y
  `db/schema.prisma:356-358` (comentario del catálogo; ver pregunta abierta nº 5 sobre el
  conteo "15" desactualizado).
  _Hecho:_ 0 coincidencias en `app/(app)/mis-asignaciones` y en `db/schema.prisma`; el
  comentario menciona la 153. (R19: sin cambio de modelo → `prisma migrate diff` vacío)

## Fase 4 — Tests, fixtures y e2e

- [x] **T4.1 — Fixtures compartidos (primero: arrastran al resto).** (dep: T1.1)
  `tests/fixtures/catalogo-estados.ts` (comentario de uso) y
  `tests/fixtures/inventario-transiciones-140.ts` (12 filas: #11–#16 y #31–#36, conservando
  la numeración y las columnas `via`/`callSite`).
  _Hecho:_ el inventario mantiene el mismo número de filas y solo cambia el nombre del nodo.
  (R7/R20)

- [x] **T4.2 — Catálogo y grafo.** [P] (dep: T4.1)
  `tests/unit/types/order-status.test.ts` (set de 18, aserción POSICIONAL `[10]` conservando
  el índice, `rows.has(...)` del seed) y
  `tests/unit/domain/order-status-transiciones.guardia.test.ts` (incluido
  `esOrderStatusValue("EN_RUTA")` → `"EN_REPARTO"`).
  _Hecho:_ ambas suites verdes con `npx vitest run`. (R1/R6/R8/R20)

- [x] **T4.3 — Suites de servicios y repositorios.** [P] (dep: T4.1)
  Los 9 archivos de alto volumen (`registrar-cambio-estado.guardia`,
  `mis-asignaciones-service`, `gestion-orden-repository`, `cierre-dia-repository`,
  `mis-asignaciones-orden-ruta`, `corte-diario-service`, `optimizacion-ruta-enqueue`,
  `cierre-dia-service`, `corte-diario-repository`) más el resto de suites unit/integration
  del §A.e.
  _Hecho:_ `npx vitest run tests/unit tests/integration` verde; ningún cambio de aserción
  más allá del literal (si una aserción cambia de significado, PARAR: dejó de ser mecánico).
  (R12/R20)

- [x] **T4.4 — Suites de componentes.** [P] (dep: T4.1, T2.2)
  `tests/components/EstatusLabel.test.ts` (`en_reparto: "En reparto"`),
  `tests/components/OrdenesPage.test.tsx:122` (`estatusValue: "En ruta"` → resolver según
  pregunta abierta nº 4) y el resto de tests de componentes del §A.e.
  _Hecho:_ `npx vitest run tests/components tests/unit/components` verde y el censo de
  etiqueta (T1.5) en cero. (R9/R11/R17/R20)

- [x] **T4.5 — E2E (solo comentarios).** [P] (dep: T4.1)
  `e2e/{reintentos-escalado,cierre-dia,mis-asignaciones,historial-orden,asignacion-satelite}.spec.ts`.
  _Hecho:_ 0 coincidencias en `e2e/`; ningún selector modificado (los de texto ya usan
  "En reparto / por gestionar"). (R20)

- [x] **T4.6 — Test de la migración nueva.** (dep: T1.2)
  Crear `tests/integration/db/order-status-en-reparto-migration.test.ts` clonando
  `order-status-rename-nomenclatura-migration.test.ts`: parseo por regex del UP y el DOWN,
  aserción del único UPDATE, ausencia de `ALTER TYPE`/`CREATE TABLE`/`DROP TABLE`/`LIKE`/
  `"id"`, no-mención de los vecinos `en_ruta_bodega_*`, aplicación a un catálogo en memoria
  con filas de `orden`/historial por `id` (conteos e `id` estables) y round-trip UP→DOWN
  exacto. Añadir su basename a la `ALLOWLIST` del guard si T1.3 no lo hizo.
  _Hecho:_ la suite pasa y el guard de censo no la marca como ofensora. (R2/R3/R4/R5/R20)

## Fase 5 — Cierre del invariante

- [x] **T5.1 — Censo en cero.** (dep: fases 2–4)
  Re-ejecutar el guard completo.
  _Hecho:_ `offenders` vacío para los 6 values antiguos y para el literal `"En ruta"`;
  allowlist con exactamente 7 basenames (los 6 previos + el de T4.6); `en_reparto` YA NO
  figura en `OLD_VALUES`. (R15/R16/R17)

- [x] **T5.2 — Verificación de que nada del flujo cambió.** (dep: T5.1)
  Comparar contra `dev`: nº de values del catálogo (18 = 18), nº de aristas y conjunto de
  pares del grafo, `ESTADOS_CREACION`/`_TERMINALES`/`_VESTIGIALES`, y `git diff --stat` sin
  archivos nuevos bajo `app/api/**` ni `lib/actions/**`.
  _Hecho:_ el diff es exclusivamente de literales/comentarios + los 3 archivos creados;
  ninguna migración histórica aparece en el diff. (R6/R7/R8/R18/R19)

## Fase 6 — Verificación ejecutable

- [x] **T6.1 — Suite y estáticos.** (dep: fase 5)
  `npm run typecheck`, `npm run lint`, `npm test`.
  _Hecho:_ los tres en verde, salida pegada en `progress/impl_153.md`. (R21)

- [x] **T6.2 — Migración ida y vuelta.** [P] (dep: fase 5) — **EJECUTADA CONTRA POSTGRES**
  `pnpm run db:migrate` → verificar la fila; `pnpm run db:rollback` → verificar que vuelve al
  value previo; `pnpm run db:migrate` de nuevo para dejar la base al día. (R3/R4/R21)
  _Ejecutada por el leader el 2026-07-28_ copiando el `.env` del repo principal al worktree,
  tras verificar que `DATABASE_URL` apunta a **localhost** y no a producción. Round-trip real:

  | paso | `order_status` | filas |
  | --- | --- | --- |
  | `prisma migrate deploy` | `en_reparto` | 19 |
  | `pnpm db:rollback` | `en_ruta` | 19 |
  | `prisma migrate deploy` | `en_reparto` | 19 |

  Ambas direcciones sin error, sin pérdida de filas, `down.sql` revirtiendo de verdad.
  **El conteo es 19 y no 18, y NO lo causa esta feature:** son los 18 del seed más la fila
  huérfana `pendiente`, sembrada por `20260714140000_order_status_pendiente` y nunca añadida a
  `ORDER_STATUS_SEED` — ya documentada como inofensiva en `progress/current.md`. La simulación
  de `tests/integration/db/order-status-en-reparto-migration.test.ts` se conserva como red
  permanente en CI.

- [ ] **T6.3 — E2E de los flujos que tocan el estado.** [P] (dep: fase 5) — **NO EJECUTABLE HOY**
  `npm run test:e2e` (al menos `mis-asignaciones`, `cierre-dia`, `reintentos-escalado`).
  _Estado real:_ **no es una omisión de esta feature, es una deuda de arnés ya registrada** en
  `progress/current.md`: no existe harness de E2E (seed + login por rol) y los `e2e/*.spec.ts`
  usan emails placeholder, así que **no se ejecutan ni en `pnpm test` ni en `./init.sh`**. Es la
  misma deuda que dejó pasar 3 specs rotas en la feature 148.
  Mitigación verificada: en `e2e/` el cambio de esta feature fue **exclusivamente de
  COMENTARIOS** — ningún selector depende del value, y los que dependen de texto ya buscaban
  "En reparto / por gestionar". La casilla queda en `[ ]` a propósito: marcarla sería mentir.

- [x] **T6.4 — `./init.sh` y mapa de trazabilidad.** (dep: T6.1–T6.3)
  Correr `./init.sh` y escribir en `progress/impl_153.md` el mapa `R1..R21 → test` de
  `requirements.md §Trazabilidad`.
  _Hecho:_ `./init.sh` en verde y cada requisito con un test nombrado. (R21)

## Riesgos y trampas conocidas

1. **El guard de la 135 prohíbe hoy `en_reparto`.** Si no se hace T1.3 primero, cada archivo
   que se toque suma un ofensor y el ruido tapa el trabajo real.
2. **`ORDER_STATUS_CLASS` es `Partial`.** Perder la entrada del acento de marca no rompe el
   build: solo degrada el chip en silencio. T2.2 lo verifica explícitamente.
3. **`en_ruta_bodega_central` / `en_ruta_bodega_satelite` NO se tocan.** Un
   buscar-y-reemplazar sin frontera de palabra los destruye. Usar siempre `\ben_ruta\b`.
4. **Migración y código van juntos.** Un deploy parcial deja `findEstatusIdByValue`
   devolviendo `null` y rompe cierre de día, corte diario y la guardia de transiciones.
5. **Si alguna aserción de test necesita cambiar más allá del literal, PARAR**: significa que
   el cambio dejó de ser mecánico y hay que volver al gate (esta feature es rename puro).
