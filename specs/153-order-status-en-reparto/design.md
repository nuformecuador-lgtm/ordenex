# Feature 153 — `order_status`: `en_ruta` → `en_reparto` · design

> Requisitos: `requirements.md` (R1–R21). Regla de oro: **se renombra un `value` de catálogo
> y su etiqueta; el grafo, los servicios, los `id`, las FKs, los endpoints y los payloads no
> se tocan.** Precedente a copiar literalmente:
> `db/migrations/20260724120000_order_status_rename_nomenclatura/` (feature 135).

## 0. Premisa verificada (y el matiz que la ficha no dice)

`order_status` **no es un enum**: `order_status_value` fue dropeado en
`20260714123909_reconcile_fks_drop_order_status_value`. Hoy es tabla de catálogo
(`db/schema.prisma:353-366`), `value String @unique`, y todo lo demás la referencia por
`id`. Por tanto el rename es un `UPDATE` de una fila.

El matiz importante: **esta feature revierte, para un solo value, el rename que hizo la 135
hace cuatro días** (`migration.sql:7`: `SET value='en_ruta' WHERE value='en_reparto'`). Eso
tiene tres consecuencias de diseño que dominan el resto del documento:

1. En una base **fresca**, la secuencia neta será: `seed_order_status_completo` inserta
   `en_reparto` → la 135 lo pasa a `en_ruta` → la 153 lo devuelve a `en_reparto`. Ida y
   vuelta sobre la MISMA fila, mismo `id`. Es feo en el log de migraciones y es correcto.
2. El guard de censo de la 135 (`tests/unit/guards/censo-order-status-rename.test.ts`)
   **prohíbe hoy la palabra `en_reparto`**. Si no se intercambia esa entrada por `en_ruta`,
   la suite se pone roja en el primer archivo que se toque. El guard se EXTIENDE (swap),
   nunca se duplica (R15).
3. Los identificadores TS (`ESTATUS_EN_REPARTO`, `ESTADO_EN_REPARTO`, `enRepartoEstatusId`)
   **nunca se renombraron** en la 135: siguen diciendo "reparto". Esta feature no renombra
   ni un símbolo; solo literales string, y de paso vuelve a alinear nombre ↔ valor.

## 1. Modelo de datos y migración

### 1.1 Migración nueva (UP + DOWN)

Carpeta: `db/migrations/20260728120000_order_status_en_reparto/`
(timestamp posterior al último existente, `20260727120000_notificacion`).

`migration.sql` (UP):

```sql
-- Feature 153 (R2): rename in-place del VALUE de catalogo order_status: en_ruta -> en_reparto.
-- UPDATE conserva el id de la fila y por tanto las FKs orden.estatus_id / historial.*_id (R4).
-- No hay enum Postgres (order_status_value fue dropeado en 20260714123909): sin ALTER TYPE.
-- Idempotente (0 filas si el value antiguo no existe). El WHERE por igualdad EXACTA no toca
-- en_ruta_bodega_central ni en_ruta_bodega_satelite (R5). Revierte, solo para este value, el
-- rename de 20260724120000 (feature 135).
UPDATE "order_status" SET "value" = 'en_reparto' WHERE "value" = 'en_ruta';
```

`down.sql` (DOWN):

```sql
-- DOWN (R3): inverso exacto del UP. Restituye el value de la 135 sobre la MISMA fila (mismo
-- id, mismo conteo). Este archivo contiene el value viejo por diseno: es la reversion del
-- rename (excluido del guard de censo R16 junto con db/migrations/**).
UPDATE "order_status" SET "value" = 'en_ruta' WHERE "value" = 'en_reparto';
```

Como no hay diff de schema, `prisma migrate dev --create-only` generaría una migración
vacía: la carpeta y los dos `.sql` se escriben **a mano** (igual que hizo la 135) y luego se
aplica con `pnpm run db:migrate`.

### 1.2 Análisis de colisión con `value UNIQUE` (por qué el UPDATE pelado es seguro)

`value` es `@unique`, así que un `UPDATE` a `'en_reparto'` explotaría si ya existiera una
fila con ese value. **No puede existir:**

- La 135 renombró la única fila `en_reparto` a `en_ruta` (UPDATE, no INSERT+DELETE).
- Nada vuelve a insertar `en_reparto`: `scripts/seed-catalogos.ts:seedOrderStatus` itera
  `ORDER_STATUS_SEED` (que hoy dice `en_ruta`) con `upsert` por `value`, y las migraciones
  que insertaban `en_reparto` (`20260711150000`, `20260714150000`) ya corrieron y Prisma no
  las reejecuta.
- En una base que por lo que sea **no** tuviera aplicada la 135, la fila seguiría llamándose
  `en_reparto`: el UP matchea 0 filas y el estado final ya es el deseado. Idempotente en
  ambos sentidos.

Por eso se conserva el `UPDATE` desnudo del precedente en vez de blindarlo con
`ON CONFLICT`/`DELETE` defensivo: sería código muerto que además ocultaría un drift real de
catálogo si alguna vez ocurriera (preferimos que reviente ruidosamente).

### 1.3 Atomicidad con el deploy (crítico, heredado de la 135)

La lógica resuelve `value → id` en runtime (`findEstatusIdByValue`) desde constantes
`const ESTADO_* = "<value>"`. Si la fila queda renombrada en DB pero el código desplegado
todavía busca `en_ruta` (o al revés), la resolución devuelve `null` y revientan la guardia de
transiciones, el cierre de día y el corte diario. **La migración y el código van en el mismo
PR y en el mismo deploy.** No hay ventana de convivencia sana, y por la misma razón un
`db:rollback` de esta migración exige revertir también el código.

Recordatorio operativo del repo: preview y producción ya tienen bases Supabase separadas y
el build migra donde debe; tras mergear, en local hay que correr `prisma migrate deploy` /
`pnpm run db:migrate`.

### 1.4 RLS, índices, columnas

No aplica: no se crean ni alteran tablas, columnas, índices ni policies. El `UPDATE` toca
una fila de metadato de catálogo (18 filas en total) y no reescribe `orden` ni
`orden_historial_estado` (R4/R19).

## 2. Orden de aplicación

1. `lib/types/order-status.ts`: `"en_ruta"` → `"en_reparto"` en el índice 10 (+ los 2
   comentarios que lo citan). Al ser la fuente única, `OrderStatusValue` cambia y el
   compilador empieza a exigir el resto: **red de seguridad parcial**.
2. Migración nueva (UP + DOWN) — §1.1.
3. `lib/types/order-status-transiciones.ts`: renombrar la clave `en_ruta:` y los 7 destinos
   `{ to: "en_ruta" }`. El `satisfies Record<OrderStatusValue, …>` y el
   `_EnsureExhaustive` rompen el build si falta alguno (R6).
4. `app/(app)/ordenes/_components/EstatusBadge.tsx`: mover la clave en los TRES mapas
   (`ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT`, `ORDER_STATUS_CLASS`) y cambiar el texto
   a "En reparto". **Ojo con `ORDER_STATUS_CLASS`**: `en_ruta` tiene refuerzo de acento de
   marca (`bg-brand-soft text-brand-dark dark:bg-brand/15 dark:text-brand-light`), la misma
   cadena que `en_fulfillment`. Es un `Partial<Record<…>>`: el compilador **no** avisa si se
   pierde la entrada. Se preserva byte a byte (R10).
5. Lógica: constantes/sets/uniones de services, repositories, actions e interfaces (§A.d).
6. Contrato externo: `lib/api/openapi-spec.ts`, `docs/api/api-key-openapi.yaml` (4 sitios),
   `lib/types/webhook-eventos.ts` (§A.b).
7. Comentario de `db/schema.prisma:356-358`.
8. Tests, fixtures y e2e (§A.e).
9. Guard de censo: swap `en_reparto` → `en_ruta` + allowlist + caso de etiqueta (§3).
10. `pnpm run db:migrate` en local; regenerar cliente Prisma si el type-check da un falso
    negativo por cliente stale.

## 3. Enforcement (cómo garantizamos que no queda nada suelto)

- **Compilador (parcial).** `OrderStatusValue` deriva de la tupla; los
  `Record<OrderStatusValue, …>` completos (LABELS, VARIANT, mapa `TRANSICIONES` vía
  `satisfies`) fallan a compilar si una clave no se actualiza. **No cubren**:
  `ORDER_STATUS_CLASS` (es `Partial`), los strings sueltos, los `Set<string>` y los datos de
  test.
- **Guard de censo (la red real, R15/R16).** En
  `tests/unit/guards/censo-order-status-rename.test.ts`:
  - `OLD_VALUES`: **quitar** `{ label: "en_reparto", re: /\ben_reparto\b/ }` y **agregar**
    `{ label: "en_ruta", re: /\ben_ruta\b/ }`. Siguen siendo 6 entradas.
  - La frontera de palabra ya resuelve el riesgo del lote: `\ben_ruta\b` **no** matchea
    `en_ruta_bodega_central` ni `en_ruta_bodega_satelite`, porque `_` es carácter de palabra
    y no hay frontera tras `en_ruta`. Se agrega un caso de test explícito que lo afirma
    (espejo del que ya existe para `en_bodega`).
  - `ALLOWLIST`: se mantiene la actual y se **agrega** el basename del test de la migración
    nueva (`order-status-en-reparto-migration.test.ts`).
    `order-status-rename-nomenclatura-migration.test.ts` ya está allowlisteado y sigue
    haciendo falta: ahora contiene el literal prohibido `en_ruta` (traza el UP de la 135).
- **Censo de etiqueta (R17).** Caso adicional en el mismo guard que busca el literal exacto
  `"En ruta"` (con comillas dobles) en `app/`, `lib/`, `components/`, `tests/`, `e2e/`. Es
  precisamente lo que atrapa `tests/components/OrdenesPage.test.tsx:122`
  (`estatusValue: "En ruta"`), que el censo de values NO ve. El literal con comillas no
  matchea `"En ruta a bodega central"` ni `"En ruta a bodega satélite"`; el test lo afirma.
- **Invariante de grafo (R6).** En
  `tests/unit/domain/order-status-transiciones.guardia.test.ts` ya se cuentan aristas y
  pares; basta con que los números NO cambien tras el rename. El inventario
  `tests/fixtures/inventario-transiciones-140.ts` mantiene la numeración `#11`–`#16` /
  `#31`–`#36` intacta (R7).

## 4. Contratos I/O y capas afectadas

- **Endpoints, Server Actions y forma de payloads: sin cambios** (R19). Lo único que viaja
  distinto es el valor textual del estado.
- **API por API key.** `lib/api/openapi-spec.ts:12-27` (`ORDER_STATUS_ENUM`) y su espejo
  textual `docs/api/api-key-openapi.yaml` (líneas 168, 365, 575, 631). Es un **cambio
  breaking** para integradores que comparen contra `"en_ruta"` — mismo precedente y misma
  política que la 135/R9, con la pregunta abierta nº 1 de `requirements.md` sobre versionado
  y aviso.
- **Webhook de cambio de estado.** `lib/types/webhook-eventos.ts:15` (`EVENTOS_PUBLICOS`,
  9 elementos). El job `webhook_estado` persiste `{ ordenId, estatusDestinoId, ocurridoAt }`
  — un **id**, no el value — y `WebhookEstadoService` resuelve `datos.estado` al entregar
  (`:70`, `:92`). Consecuencia (R14): un job encolado antes del deploy se entrega DESPUÉS
  con `en_reparto`. No hay filas persistidas con el string `en_ruta` que haya que
  retro-corregir.
- **Presentación.** Cambia el texto del chip ("En ruta" → "En reparto") y, en consecuencia,
  la opción del filtro de estatus del listado (`OrdenesListado.tsx:121` lee
  `ORDER_STATUS_LABELS`) y la línea de tiempo del historial (`estatus-label.ts`). El
  apartado del mensajero ("En reparto / por gestionar") y la card POS ("En reparto") ya
  usaban ese vocabulario: **el rename los alcanza, no los contradice.**
- **Lógica.** Constantes y sets de `MisAsignacionesService`, `CierreDiaService`,
  `CorteDiarioService`, `OrdenRepository`, `CorteDiarioRepository`, `CierreDiaRepository`
  (§A.d). `findEstatusIdByValue` es agnóstico al nombre; solo importa que constante y fila
  coincidan.

## 5. Frontera explícita: qué NO se toca

- `en_ruta_bodega_satelite` y `en_ruta_bodega_central` (value **y** label). Decisión humana
  del 2026-07-28: "En ruta a bodega satélite" NO pasa a "Por recibir en satélite".
- Los participios femeninos: Entregada / Devuelta / Reprogramada / Rechazada / Sin gestionar.
- El grafo: ninguna arista se agrega, quita ni cambia de familia (R6/R7). Los cambios
  semánticos del lote son de la 154/155.
- `orden.estatus_id`, `orden_historial_estado.estatus_origen_id|estatus_destino_id`.
- Migraciones históricas y sus `down.sql`, incluida la de la 135 (R18).
- `tests/integration/db/order-status-rename-nomenclatura-migration.test.ts`: traza la 135 con
  sus literales históricos; se queda como está (solo entra a la allowlist, donde ya está).
- Nombres de símbolos TS (`ESTATUS_EN_REPARTO`, `enRepartoEstatusId`…): ya dicen "reparto".
- `scripts/seed-catalogos.ts`: itera la tupla, no tiene literal propio (0 coincidencias).
- `specs/**`, `progress/**`, `feature_list.json`: registro histórico.

## 6. Alternativas descartadas

### 6.1 Corregir la migración de la 135 en vez de crear una nueva (DESCARTADA)

Tentador: la 135 hizo `en_reparto → en_ruta` hace cuatro días; bastaría con borrar esa línea
de `20260724120000_order_status_rename_nomenclatura/migration.sql` (y su inversa del
`down.sql`) para que el value nunca hubiera cambiado, y el árbol quedaría limpio, sin el
ridículo ida-y-vuelta del §0.

**Por qué se descarta:**

- **Prisma guarda el checksum de cada migración aplicada** en `_prisma_migrations`. Editar
  una migración ya aplicada hace que `prisma migrate deploy` falle en producción y preview
  con un error de checksum, que es exactamente el tipo de rotura que un rename cosmético no
  debe poder causar. El build de Vercel migra en producción y en preview: rompería ambos.
- La 135 **ya está desplegada**: los datos reales ya se renombraron. Reescribir su SQL no
  deshace nada en las bases existentes; solo desincroniza el repo con el estado real.
- Se pierde la trazabilidad que el arnés exige: el historial de migraciones es un log de
  hechos, no un borrador editable.
- El "árbol limpio" es una ilusión: bases frescas y bases existentes divergirían.

### 6.2 Dejar el `value` en `en_ruta` y cambiar SOLO la etiqueta a "En reparto" (DESCARTADA)

Cero riesgo de datos, cero migración, un archivo tocado (`EstatusBadge.tsx`) en vez de ~82.

**Por qué se descarta:**

- **Reintroduce exactamente la divergencia que la 135 eliminó** (su R8: "la etiqueta es la
  versión legible directa del value"). Volveríamos a tener dos nombres para un estado, que
  es el bug de origen que costó 180 archivos hace cuatro días.
- El **contrato externo seguiría diciendo `en_ruta`** mientras la UI dice "En reparto":
  soporte, logs y tickets vuelven a necesitar traducción mental.
- La **154 depende de esta feature** y va a reescribir el grafo alrededor de este nodo. Si
  el value queda desalineado, la 154 hereda el ruido justo cuando más precisión hace falta.
- No ahorra tanto como parece: la mitad de las ~366 ocurrencias son comentarios y nombres de
  test que, con la etiqueta cambiada, quedarían mintiendo igual.

### 6.3 Columna `label`/`display` en `order_status` y traducción en presentación (DESCARTADA)

Ya se descartó en el design de la 135 (§4) y sigue valiendo: añade una indirección
permanente para resolver un problema de nombres, mantiene dos identificadores vivos y exige
migración + seed + backfill. Peor relación coste/beneficio que un `UPDATE` de una fila.

### 6.4 Rollback de la 135 y nueva migración con el mapeo correcto (DESCARTADA)

`pnpm run db:rollback` es LIFO y sobre la 135 hay dos migraciones posteriores que insertan
values (`20260724140000_order_status_devolucion_rechazadas`) y un enum de historial. Revertir
la 135 desharía los **otros cinco** renames (que nadie pidió deshacer) y abriría una ventana
en la que el código desplegado no resuelve ningún estado. Coste y riesgo desproporcionados
frente a un `UPDATE` aditivo.

## 7. Verificación

- Test NUEVO `tests/integration/db/order-status-en-reparto-migration.test.ts`, clonado de
  `order-status-rename-nomenclatura-migration.test.ts`: parsea el UP y el DOWN por regex,
  afirma el único UPDATE (R2/R3), aplica el SQL parseado a un catálogo en memoria con filas
  de `orden`/historial por `id` (R4) y verifica el round-trip UP→DOWN.
- `tests/unit/types/order-status.test.ts`: set de 18, `[10] === "en_reparto"`, ausencia de
  `en_ruta`, `seedOrderStatus` idempotente (R1).
- `tests/unit/domain/order-status-transiciones.guardia.test.ts`: conteos de aristas/pares y
  conjuntos `ESTADOS_*` invariantes (R6/R8). El caso
  `esOrderStatusValue("EN_RUTA")` pasa a `"EN_REPARTO"` (sigue probando case-sensitivity).
- `tests/components/EstatusLabel.test.ts` + tests de badge/columnas: "En reparto", variante
  `secondary` y clases de acento intactas (R9/R10/R11).
- Guard de censo extendido (R15/R16/R17), incluido el caso de exactitud frente a
  `en_ruta_bodega_*`.
- Suite completa (`npm test`), `npm run typecheck`, `npm run lint`, `./init.sh`, y
  `pnpm run db:migrate` + `pnpm run db:rollback` contra la base local (R21).

---

## Apéndice A — Censo real clasificado

Búsqueda case-sensitive `\ben_ruta\b` sobre todo el repo: **366 ocurrencias en 98 archivos**.
Descontando `specs/` (6), `progress/` (7) y `feature_list.json` (1) → **84 archivos**. De
esos, **3 no se tocan** (§5) → **81 a editar**, más el guard de censo (que hoy cita
`en_reparto`, no `en_ruta`) = **82 archivos editados** + **3 creados** (UP, DOWN, test de
migración). La ficha decía ~76: el número real es 84/81.

> `\ben_ruta\b` **no** produce falsos positivos con `en_ruta_bodega_central` /
> `en_ruta_bodega_satelite`; verificado en el censo y afirmado por el guard (R5).

### (a) Catálogo / migraciones — 3 archivos
| Archivo | Ocurr. | Acción |
|---|---|---|
| `db/migrations/20260724120000_order_status_rename_nomenclatura/migration.sql` | 1 | **NO TOCAR** (histórica, R18) |
| `db/migrations/20260724120000_order_status_rename_nomenclatura/down.sql` | 1 | **NO TOCAR** (histórica, R18) |
| `db/schema.prisma` (`:356-358`, comentario del catálogo) | 2 | comentario |
| `db/migrations/20260728120000_order_status_en_reparto/{migration,down}.sql` | — | **CREAR** |

### (b) Tipos, catálogo TS y contrato externo — 5 archivos
| Archivo | Ocurr. | Nota |
|---|---|---|
| `lib/types/order-status.ts` | 3 | `ORDER_STATUS_SEED[10]` + 2 comentarios (R1) |
| `lib/types/order-status-transiciones.ts` | 8 | clave `en_ruta:` + 7 destinos `to` (R6/R7) |
| `lib/types/orden-historial.ts` | 2 | comentarios de `corte_sin_gestionar` |
| `lib/types/webhook-eventos.ts` | 1 | `EVENTOS_PUBLICOS` (R13) |
| `lib/api/openapi-spec.ts` | 1 | `ORDER_STATUS_ENUM` (R13) |
| `docs/api/api-key-openapi.yaml` | 4 | espejo publicado, líneas 168/365/575/631 (R13) |

### (c) Presentación — 3 archivos
| Archivo | Ocurr. | Nota |
|---|---|---|
| `app/(app)/ordenes/_components/EstatusBadge.tsx` | 4 | LABELS `:24` (texto → "En reparto"), VARIANT `:52`, CLASS `:76-77` (**acento de marca**) |
| `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` | 2 | comentarios del apartado |
| `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts` | 1 | comentario |

Efecto indirecto sin cambio de código: `OrdenesListado.tsx:121` y
`app/(app)/ordenes/_components/estatus-label.ts` leen `ORDER_STATUS_LABELS`, así que el
filtro y la timeline heredan "En reparto".

### (d) Lógica (services / repositories / actions / interfaces) — 14 archivos
`lib/repositories/OrdenRepository.ts` (1, `ESTATUS_EN_REPARTO:48`) ·
`lib/repositories/CorteDiarioRepository.ts` (3, `ESTADO_EN_REPARTO:16`) ·
`lib/repositories/CierreDiaRepository.ts` (4) ·
`lib/repositories/GestionOrdenRepository.ts` (3) ·
`lib/repositories/LiberacionReprogramadaRepository.ts` (1) ·
`lib/services/MisAsignacionesService.ts` (5, `ESTADO_EN_REPARTO:37` y `ORIGEN_GESTION:39`) ·
`lib/services/CierreDiaService.ts` (3, `ESTADOS_PENDIENTES:41` y `ESTADO_EN_REPARTO:65`) ·
`lib/services/CorteDiarioService.ts` (5, `ESTADO_EN_REPARTO:20`) ·
`lib/actions/cierre-dia.ts` (1) · `lib/actions/mis-asignaciones.ts` (1) ·
`lib/interfaces/repositories/ICierreDiaRepository.ts` (4) ·
`lib/interfaces/repositories/IGestionOrdenRepository.ts` (1) ·
`lib/interfaces/repositories/IOrdenRepository.ts` (1) ·
`lib/interfaces/services/ICierreDiaService.ts` (2) ·
`lib/interfaces/services/IMisAsignacionesService.ts` (4).

Solo 6 de esas ocurrencias son literales de runtime; el resto son comentarios/docstrings.

### (e) Tests y fixtures — 52 archivos (1 de ellos NO se toca)
**Fixtures compartidos (van primero, arrastran al resto):**
`tests/fixtures/catalogo-estados.ts` (1) · `tests/fixtures/inventario-transiciones-140.ts` (12).

**Alto volumen (≥8):** `registrar-cambio-estado.guardia.test.ts` (21) ·
`mis-asignaciones-service.test.ts` (22) · `gestion-orden-repository.test.ts` (20) ·
`cierre-dia-repository.test.ts` (19) · `mis-asignaciones-orden-ruta.test.ts` (14) ·
`corte-diario-service.test.ts` (11) · `optimizacion-ruta-enqueue.test.ts` (10) ·
`cierre-dia-service.test.ts` (9) · `corte-diario-repository.test.ts` (8).

**Resto (1–7):** `mis-asignaciones-nota-privada` · `mis-asignaciones-marcar-luego` ·
`mis-asignaciones-evidencias` · `mis-asignaciones-causa-devolucion` ·
`mis-asignaciones-buscador` · `order-status.test.ts` (aserción posicional `[10]`) ·
`orden-historial-types` · `orden-historial-repository` · `orden-historial-cobertura` ·
`orden-historial-atomicidad` · `orden-historial-service` · `order-status-transiciones.guardia`
(incluye `esOrderStatusValue("EN_RUTA")`) · `recepcion-bodega-central-action` ·
`recepcion-bodega-central-service` · `recepcion-satelite-service` · `recepcion-origen-service` ·
`reprogramacion-tienda-service` · `devolucion-origen-service` · `orden-mensajero-meta-service` ·
`orden-mensajero-meta.int` · `orden-webhook-enqueue` · `webhook-estado-service` ·
`webhook-estado-encolado` · `notificacion-orden-rechazada` · `gestion-orden-evidencia` ·
`orden-repository.recepcion-satelite` · `orden-repository.cancelar-api` ·
`filtro-canton-distrito` · y los de componentes `EstatusLabel` · `EscanerRecepcionOrigen` ·
`EscanerRecepcionBodegaCentral` · `OrdenesApartado` · `OrdenesRevisionMaestro` ·
`NotaPrivadaMensajero` · `MisAsignacionesPage` · `MarcarLuegoToggle` · `ChatWhatsappPanel` ·
`HistorialOrdenTimeline` · `HistorialOrdenSheet` · `GestionarOrdenPanelEvidencias`.

**NO TOCAR:** `tests/integration/db/order-status-rename-nomenclatura-migration.test.ts` (4) —
traza la migración de la 135 (allowlist).

**Sin `en_ruta` pero afectado por la etiqueta:** `tests/components/OrdenesPage.test.tsx:122`
(`estatusValue: "En ruta"`, R17 / pregunta abierta nº 4).

### (f) E2E — 5 archivos, TODO son comentarios
`e2e/reintentos-escalado.spec.ts` (4) · `e2e/cierre-dia.spec.ts` (5) ·
`e2e/mis-asignaciones.spec.ts` (2) · `e2e/historial-orden.spec.ts` (1) ·
`e2e/asignacion-satelite.spec.ts` (1). Ningún selector depende del value; los que dependen de
texto ya buscan "En reparto / por gestionar".

### (g) Guard — 1 archivo
`tests/unit/guards/censo-order-status-rename.test.ts`: swap de `OLD_VALUES`, allowlist y
casos nuevos (§3).

---

## Apéndice B — Aristas afectadas (solo cambia el nombre del nodo)

| # | Antes | Después | `via` | rol |
|---|---|---|---|---|
| 11 | `por_recoger → en_ruta` | `por_recoger → en_reparto` | `recoleccion` | mensajero |
| 12 | `en_ruta → entregada` | `en_reparto → entregada` | `gestion` | mensajero |
| 13 | `en_ruta → reprogramada` | `en_reparto → reprogramada` | `gestion` | mensajero |
| 14 | `en_ruta → devuelta` | `en_reparto → devuelta` | `gestion` | mensajero |
| 15 | `en_ruta → rechazada` | `en_reparto → rechazada` | `gestion` | mensajero |
| 16 | `en_ruta → sin_gestionar` | `en_reparto → sin_gestionar` | `corte_sin_gestionar` | sistema/cron |
| 31 | `entregada → en_ruta` | `entregada → en_reparto` | `deshacer_gestion` | mensajero |
| 32 | `reprogramada → en_ruta` | `reprogramada → en_reparto` | `deshacer_gestion` | mensajero |
| 33 | `rechazada → en_ruta` | `rechazada → en_reparto` | `deshacer_gestion` | mensajero |
| 34 | `en_bodega_central → en_ruta` | `en_bodega_central → en_reparto` | `deshacer_gestion` | mensajero |
| 35 | `en_bodega_satelite → en_ruta` | `en_bodega_satelite → en_reparto` | `deshacer_gestion` | mensajero |
| 36 | `devuelta → en_ruta` | `devuelta → en_reparto` | `deshacer_gestion` | mensajero |

12 aristas tocan el nodo; el mapa completo conserva su cardinalidad total (R6).
