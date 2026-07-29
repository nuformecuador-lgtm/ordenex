# Tasks — Feature 154 · Catálogo de estados v2

> `[P]` = paralelizable con las tareas de su mismo bloque. Cada task tiene criterio de **hecho**
> verificable. Zona `backend`; la fase de implementación debe correr **`tests/integration/db`**
> completo (peaje conocido del repo al tocar enums).
>
> **T0 es una PUERTA: nada de T1 en adelante se ejecuta hasta que Q1, Q2 y Q3 estén respondidas.**

---

## Bloque 0 — Puerta y preparación

- [ ] **T0.1 — Cerrar Q1, Q2 y Q3** con el humano (ver "Preguntas abiertas" de `requirements.md`).
  **Hecho:** las tres respuestas quedan escritas en este archivo o en `progress/current.md`, y
  §3.2/§3.3/§3.5 de `design.md` se ajustan si la respuesta difiere de la propuesta.
  *Bloquea todo lo demás.*

- [ ] **T0.2 — Confirmar Q4, Q5 y Q6.** **Hecho:** decisión escrita; si Q5 cambia labels/variantes,
  se actualiza la tabla de §4 de `design.md`.
  *Depende de: nada. `[P]` con T0.1.*

- [ ] **T0.3 — Verificar que la 153 está mergeada en la rama base.**
  **Hecho:** `rg -n "\ben_ruta\b" lib/ app/ tests/` no devuelve el value antiguo (salvo el guard de
  censo de la 153), y `ORDER_STATUS_SEED` contiene `en_reparto`.
  *Depende de: nada.*

---

## Bloque 1 — Base de datos (se merge antes que el dominio)

- [ ] **T1.1 — Migración A: alta de los dos values en el catálogo `order_status`.**
  Carpeta `db/migrations/<ts1>_order_status_v2_por_recolectar_incidente/migration.sql`, con `<ts1>`
  estrictamente posterior a la última carpeta existente (hoy `20260727120000_notificacion`, más la
  que aporte la 153). Dos `INSERT ... SELECT ... WHERE NOT EXISTS`, patrón exacto de
  `20260724140000_order_status_devolucion_rechazadas`.
  **Hecho:** el `.sql` existe, no contiene `DROP`/`ALTER COLUMN`/`CREATE TABLE`/`CREATE POLICY`, y
  aplicarlo dos veces seguidas deja 20 filas en `order_status`.
  *Depende de: T0.1.*

- [ ] **T1.2 — `down.sql` de la migración A.** `DELETE` guardado por ausencia de referencias en
  `orden.estatus_id` y `orden_historial_estado.estatus_origen_id/estatus_destino_id`.
  **Hecho:** el archivo existe; `pnpm run db:rollback` sobre una DB limpia deja el catálogo en 18
  values; con una orden apuntando a `incidente`, el rollback NO borra y NO falla.
  *Depende de: T1.1.*

- [ ] **T1.3 — Migración B: `ALTER TYPE ADD VALUE` ×2 en `orden_historial_origen_tipo`.**
  Carpeta separada `<ts2>_orden_historial_origen_recoleccion_tienda_incidente`, `<ts2> > <ts1>`.
  Solo los dos `ADD VALUE IF NOT EXISTS`, sin ningún uso de los values en la misma migración.
  **Hecho:** el `.sql` existe y contiene exactamente las dos sentencias; `prisma migrate deploy`
  local pasa sin 55P04.
  *Depende de: T1.1 (orden de carpetas).*

- [ ] **T1.4 — `down.sql` de la migración B.** Recrear el tipo con los **22** values previos +
  `ALTER COLUMN ... USING (...::text::...)` + `DROP TYPE ..._old`, con el comentario de precondición
  (0 filas con los orígenes nuevos). Patrón exacto de
  `20260724150000_orden_historial_origen_devolucion_rechazada/down.sql`.
  **Hecho:** el archivo existe; round-trip `deploy → rollback → deploy` local en verde.
  *Depende de: T1.3.*

- [ ] **T1.5 — `db/schema.prisma`: `enum OrdenHistorialOrigenTipo` gana los dos values** con
  comentario `// feature 154`.
  **Hecho:** `pnpm exec prisma generate` sin error y `pnpm exec prisma migrate status` sin drift.
  *Depende de: T1.3.*

- [ ] **T1.6 — NO tocar los 8 `down.sql` previos que recrean el enum.**
  Es una task de verificación explícita, no de edición (ver `design.md` §2.3: son fotos históricas y
  el rollback es secuencial).
  **Hecho:** `git diff --stat db/migrations/` no muestra ninguna de las 8 carpetas listadas en §2.3.
  *Depende de: T1.4.*

---

## Bloque 2 — Tipos de dominio

- [ ] **T2.1 — `lib/types/order-status.ts`: `ORDER_STATUS_SEED` gana `por_recolectar_en_tienda` e
  `incidente`** como valores 19 y 20 (APÉNDICE, sin alterar posiciones previas), cada uno con su
  comentario de feature.
  **Hecho:** `ORDER_STATUS_SEED.length === 20` y `tsc` en verde salvo los errores esperados de
  exhaustividad de T2.3/T3.1 (que confirman que la red de seguridad funciona).
  *Depende de: T1.5.*

- [ ] **T2.2 — `lib/types/orden-historial.ts`: `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` gana
  `recoleccion_tienda` e `incidente`,** con el comentario que justifica por qué NO entran en
  `ORIGEN_TIPOS_CON_GESTION` (patrón 138/139).
  **Hecho:** `_EnsureExhaustive` compila (sin drift contra el enum Prisma) y
  `ORIGEN_TIPOS_CON_GESTION` sigue siendo `["gestion", "deshacer_gestion"]`.
  *Depende de: T1.5. `[P]` con T2.1.*

- [ ] **T2.3 — `lib/types/order-status-transiciones.ts`: reescritura del mapa al grafo v2.**
  1. ALTAS: `por_recolectar_en_tienda: [{ to: "en_ruta_bodega_central", via: "recoleccion_tienda", rol: "mensajero" }] // #43`;
     `incidente: []` (terminal); `en_reparto` gana `{ to: "incidente", via: "gestion", rol: "mensajero" } // #44`.
  2. BAJAS: borrar #4, #6, #7c de `en_preparacion` y #1, #3, #7b de `en_fulfillment` (según T0.1).
  3. `ESTADOS_CREACION` gana `por_recolectar_en_tienda` (3 → 4).
  4. `ESTADOS_TERMINALES` gana `incidente` (2 → 3).
  5. Comentario de cabecera actualizado con los recuentos nuevos (39 flujo / 37 pares / 4 creación)
     y con la nota de por qué las aristas retiradas NO se reintroducen (igual que la nota del #27).
  **Hecho:** el módulo compila con el `satisfies Record<OrderStatusValue, …>` INTACTO (no se relaja
  ni se añade `Partial`), y `Object.keys(TRANSICIONES).length === 20`.
  *Depende de: T2.1, T2.2.*

---

## Bloque 3 — Presentación

- [ ] **T3.1 — `app/(app)/ordenes/_components/EstatusBadge.tsx`:** entradas nuevas en
  `ORDER_STATUS_LABELS` y `ORDER_STATUS_VARIANT` según la tabla de `design.md` §4 (confirmada en
  T0.2). Sin tocar `ORDER_STATUS_CLASS`.
  **Hecho:** `tsc` en verde (los dos `Record<OrderStatusValue, …>` dejan de romper) y el chip
  renderiza "Por recolectar en tienda" e "Incidente".
  *Depende de: T2.1.*

---

## Bloque 4 — Tests (el grueso del trabajo)

- [ ] **T4.1 — Test de la migración A** (`tests/integration/db/order-status-v2-migration.test.ts`),
  modelado sobre `order-status-en-bodega-satelite-migration.test.ts`: UP idempotente y aditivo, DOWN
  guardado, carpeta con `migration.sql` + `down.sql` y timestamp posterior.
  **Hecho:** cubre R1–R6, en verde.
  *Depende de: T1.2. `[P]` con T4.2.*

- [ ] **T4.2 — Test de la migración B**
  (`tests/integration/db/orden-historial-origen-recoleccion-tienda-incidente-migration.test.ts`),
  copia estructural de `orden-historial-origen-recepcion-bodega-central-migration.test.ts`: SEED,
  exclusión de `ORIGEN_TIPOS_CON_GESTION`, UP aditivo, DOWN recreando el enum con **22** values,
  precondición documentada, `schema.prisma` sin drift.
  **Hecho:** cubre R7–R12, en verde.
  *Depende de: T1.5. `[P]` con T4.1.*

- [ ] **T4.3 — Actualizar los 5 tests de migraciones de enum previas** añadiendo
  `recoleccion_tienda` e `incidente` a cada conjunto `AÑADIDOS_EN_O_DESPUES_DEL_*` (67, 99, 100, 106,
  138 — rutas en `design.md` §2.3). **Antes**, barrer `rg -l "ORDEN_HISTORIAL_ORIGEN_TIPO_SEED" tests/`
  por si hay más consumidores.
  **Hecho:** `pnpm vitest run tests/integration/db` completo en verde.
  *Depende de: T2.2.*

- [ ] **T4.4 — `tests/fixtures/inventario-transiciones-140.ts`:** añadir #43 y #44 a
  `INVENTARIO_FLUJO`, añadir `por_recolectar_en_tienda` a `INVENTARIO_CREACION`, **borrar** las filas
  #1, #3, #4, #6, #7b, #7c dejando el hueco documentado (igual que el #27), y actualizar
  `RECUENTO_INVENTARIO` a `{ aristasFlujo: 39, paresUnicos: 37, aristasCreacion: 4 }`.
  **Hecho:** el fixture sigue transcrito A MANO (no derivado de `TRANSICIONES`) y los tests que lo
  recorren pasan. Cubre R27.
  *Depende de: T2.3.*

- [ ] **T4.5 — `tests/unit/domain/order-status-transiciones.connectividad.test.ts`:** actualizar el
  recuento del catálogo (18 → 20), la lista esperada de `ESTADOS_CREACION` (4 elementos), los
  terminales (`incidente` con ≥1 entrada y 0 salidas) y la aserción de exhaustividad.
  **Hecho:** cubre R16, R17, R25, R26; el test nombra los ofensores si falla.
  *Depende de: T2.3, T4.4.*

- [ ] **T4.6 — `tests/unit/domain/order-status-transiciones.guardia.test.ts`:** casos POSITIVOS para
  #43, #44 y la creación `null → por_recolectar_en_tienda` (R13–R15); casos NEGATIVOS, uno por
  arista retirada (R18–R21); y un caso que verifique que `en_preparacion → en_bodega_central` y las
  tres asignaciones desde bodega SIGUEN siendo legales (R22, R23); más el test de que el mensaje del
  error solo cita los dos `value` (R24).
  **Hecho:** en verde, con un `it` por requisito nombrando el comportamiento, no la función.
  *Depende de: T2.3.*

- [ ] **T4.7 — Actualizar los tests de catálogo que fijan el recuento 18:**
  `tests/unit/types/order-status.test.ts` (líneas ~12, ~86, ~135, ~139) y
  `tests/unit/scripts/seed-order-status.test.ts`. Barrer también
  `tests/fixtures/catalogo-estados.ts`, `tests/unit/repositories/orden-repository.test.ts`,
  `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` y
  `tests/integration/repositories/orden-webhook-enqueue.test.ts`.
  **Hecho:** `rg -n "\b18\b" tests/unit/types/order-status.test.ts` no deja recuentos obsoletos;
  suite unitaria en verde.
  *Depende de: T2.1. `[P]` con T4.6.*

- [ ] **T4.8 — `tests/components/EstatusLabel.test.ts`:** casos para los dos labels y las dos
  variantes nuevas + el caso de value desconocido (chip neutro, valor crudo).
  **Hecho:** cubre R29–R31, en verde.
  *Depende de: T3.1. `[P]` con T4.6.*

- [ ] **T4.9 — Guard de censo de "declarado y sin uso" (R28).** Test nuevo modelado sobre
  `tests/unit/guards/censo-order-status-rename.test.ts`: los literales
  `por_recolectar_en_tienda`, `incidente`, `recoleccion_tienda` NO aparecen fuera de la allowlist
  (`lib/types/order-status.ts`, `lib/types/orden-historial.ts`,
  `lib/types/order-status-transiciones.ts`, `EstatusBadge.tsx`, `db/`, `tests/`, `specs/`).
  **Hecho:** el guard falla si un service, action o repository empieza a usarlos antes de la 155–158.
  *Depende de: T2.3, T3.1.*

- [ ] **T4.10 — Regresión del fallo cerrado (R32, R33).** Verificar en
  `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` que un `value` de DB desconocido
  para el build sigue produciendo `TransicionNoValidableError` con motivo `estatus_desconocido`, y
  que las transiciones preexistentes siguen validando con los dos values nuevos ya en el SEED.
  **Hecho:** ambos casos en verde sin relajar ninguna aserción existente.
  *Depende de: T2.3. `[P]` con T4.9.*

---

## Bloque 5 — Verificación y cierre

- [ ] **T5.1 — `./init.sh` en verde.** **Hecho:** salida sin errores.
  *Depende de: todo el bloque 4.*

- [ ] **T5.2 — Suite completa: `pnpm vitest run`** (unit + integration, incluyendo
  `tests/integration/db`). **Hecho:** 0 fallos, 0 tests marcados como skip nuevos.
  *Depende de: T5.1.*

- [ ] **T5.3 — Round-trip de migraciones contra DB local:**
  `prisma migrate deploy` → `pnpm run db:rollback` (×2, para revertir B y luego A) →
  `prisma migrate deploy`. **Hecho:** los tres pasos sin error y el catálogo vuelve a 20 values /
  el enum a 24 al final.
  *Depende de: T5.2.*

- [ ] **T5.4 — `progress/impl_154-catalogo-estados-v2.md`** con el mapa R→test (los 33 requisitos) y
  la nota de qué respuestas se dieron a Q1–Q6.
  **Hecho:** todo `R<n>` tiene al menos un test citado por archivo y nombre; ninguno sin cubrir.
  *Depende de: T5.3.*

- [ ] **T5.5 — Commits por task lógica** (`feat(154): …`, `test(154): …`, `chore(154): …`), no un
  mega-commit. **Hecho:** el historial de la rama permite revertir la migración sin arrastrar los
  tests, y viceversa.
  *Transversal.*

- [ ] **T5.6 — Nota de release para el leader:** si Q3 se cerró como "tren 154+155+156", dejarlo
  escrito en `progress/current.md` como bloqueo explícito de merge a `prod`.
  **Hecho:** la nota existe y cita las tres features.
  *Depende de: T0.1.*
