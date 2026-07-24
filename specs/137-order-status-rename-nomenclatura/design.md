# Feature 135 — Rename de nomenclatura de `order_status` (design)

> Requisitos: ver `requirements.md` (R1–R13). Este documento fija el CÓMO técnico y el
> inventario real clasificado (Apéndice A). Regla de oro: **se renombra el `value` (el
> identificador único que comparten backend, frontend y contrato externo) y se ALINEA la
> etiqueta UI a ese value legible (R8); el orden del seed, `orden.estatus_id` y las
> migraciones históricas NO se tocan.**

## 0. Corrección de premisa (por el censo)
La descripción habla de `ALTER TYPE order_status_value RENAME VALUE`. **No aplica**: el
enum Postgres `order_status_value` fue DROPPEADO en
`db/migrations/20260714123909_reconcile_fks_drop_order_status_value/migration.sql:17`
(`DROP TYPE IF EXISTS "order_status_value";`). Hoy `order_status` es una **tabla de
catálogo** (`db/schema.prisma:346-359`):

```prisma
model OrderStatus {
  id      String @id @default(uuid())
  value   String @unique
  ordenes Orden[]
  historialComoOrigen  OrdenHistorialEstado[] @relation("HistorialOrigen")
  historialComoDestino OrdenHistorialEstado[] @relation("HistorialDestino")
  @@map("order_status")
}
```

`orden.estatus_id` es FK por `id` (`db/schema.prisma:445` `@map("estatus_id")`, `:479`
`@relation(fields:[estatusId], references:[id])`), y el historial referencia
`order_status.id` en `estatus_origen_id`/`estatus_destino_id`. **Renombrar `value` no
toca ningún `id`, por lo que ninguna FK se rompe.** La migración correcta es un
`UPDATE` de filas, no un `ALTER TYPE`.

## 1. Modelo de datos y migración

### 1.1 Estrategia elegida: `UPDATE "order_status"` (fila-a-valor)
Migración NUEVA (timestamp posterior al último existente; patrón del repo
`db/migrations/<timestamp>_<nombre>/` con `migration.sql` UP + `down.sql` DOWN
obligatorio, `docs/architecture.md §Migraciones`). Precedente idéntico:
`db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/`.

`db/migrations/<ts>_order_status_rename_nomenclatura/migration.sql` (UP):
```sql
-- Feature 135 (R2): rename in-place del VALUE de catalogo order_status. UPDATE conserva
-- el id de cada fila y por tanto las FKs orden.estatus_id / historial.*_id (R4). No hay
-- enum Postgres (order_status_value fue dropeado en 20260714123909): sin ALTER TYPE.
-- Idempotente (0 filas si el value antiguo no existe). Orden-independiente: ningun value
-- nuevo colisiona con un value antiguo aun presente (value es UNIQUE).
UPDATE "order_status" SET "value" = 'en_ruta'                WHERE "value" = 'en_reparto';
UPDATE "order_status" SET "value" = 'por_recoger'            WHERE "value" = 'en_espera_aceptacion';
UPDATE "order_status" SET "value" = 'en_bodega_central'      WHERE "value" = 'en_bodega';
UPDATE "order_status" SET "value" = 'en_ruta_bodega_central' WHERE "value" = 'en_ruta_bodega_principal';
UPDATE "order_status" SET "value" = 'devolviendo_a_tienda'   WHERE "value" = 'devuelta_origen';
UPDATE "order_status" SET "value" = 'devuelta_a_tienda'      WHERE "value" = 'recibido_origen';
```

`down.sql` (DOWN):
```sql
-- DOWN (R3): inverso exacto del UP. Restituye los value historicos sobre las mismas filas.
UPDATE "order_status" SET "value" = 'en_reparto'               WHERE "value" = 'en_ruta';
UPDATE "order_status" SET "value" = 'en_espera_aceptacion'     WHERE "value" = 'por_recoger';
UPDATE "order_status" SET "value" = 'en_bodega'                WHERE "value" = 'en_bodega_central';
UPDATE "order_status" SET "value" = 'en_ruta_bodega_principal' WHERE "value" = 'en_ruta_bodega_central';
UPDATE "order_status" SET "value" = 'devuelta_origen'          WHERE "value" = 'devolviendo_a_tienda';
UPDATE "order_status" SET "value" = 'recibido_origen'          WHERE "value" = 'devuelta_a_tienda';
```

**Por qué el `WHERE` por igualdad exacta es seguro:** `WHERE "value" = 'en_bodega'` NO
matchea `en_bodega_satelite` (igualdad exacta, no `LIKE`), y `en_ruta_bodega_principal`
es un value distinto de `en_ruta_bodega_satelite`. No existe `en_bodega_principal`
(0 coincidencias en el repo). Riesgo de datos: muy bajo — es un UPDATE de metadato de
catálogo (≤15 filas), no reescribe `orden` ni el historial ni invalida índices/FKs.

### 1.2 Orden de aplicación (importante)
1. Editar `lib/types/order-status.ts`: renombrar los 6 literales en `ORDER_STATUS_SEED`
   **conservando su posición** (índices 8/10/13 mantienen su lugar; el resto se edita
   in situ). Al ser la fuente única, `OrderStatusValue` cambia y el compilador empieza a
   exigir el resto (red de seguridad parcial).
2. Crear la migración nueva (UP + DOWN) con los 6 `UPDATE`.
3. Actualizar mapas `Record<OrderStatusValue,…>` (EstatusBadge) — el compilador los
   FUERZA por exhaustividad (clave faltante/sobrante = error).
4. Actualizar constantes/sets/uniones-literal de la lógica (§Apéndice A.d) y los
   contratos externos (§A.b, R9, aprobado por el gate).
5. Actualizar tests y seeds de QA (§A.e/A.f).
6. `pnpm run db:migrate` en local (memoria del repo: migrar tras merge). Regenerar
   cliente Prisma si el type-check da falso negativo (memoria del repo).

> **Atomicidad con el deploy (crítico).** La lógica resuelve `value → id` en runtime
> (`findEstatusIdByValue`) a partir de decenas de constantes `const ESTADO_* = "<value>"`.
> Si una fila queda renombrada en DB pero una constante conserva el value antiguo, esa
> resolución devuelve `null` → rotura en runtime (guardas de transición, cierres, corte
> diario). Por eso el UPDATE de la migración y el código que espera los nuevos values
> DEBEN desplegarse juntos (mismo PR/deploy). No hay ventana de convivencia sana.

### 1.3 Enforcement (cómo garantizamos que no queda nada suelto)
- **Compilador (parcial):** `OrderStatusValue = (typeof ORDER_STATUS_SEED)[number]`; los
  mapas `Record<OrderStatusValue,…>` (LABELS/VARIANT/CLASS) y las uniones que asignan
  desde `OrderStatusValue` fallan a compilar si una clave no se actualiza.
- **Etiquetas (R8, no compilables):** el compilador fuerza las CLAVES pero NO el TEXTO de
  los labels (son strings arbitrarios). El alineamiento value↔label se verifica con los
  tests de UI (`tests/components/EstatusLabel.test.ts` y los tests de badge/columnas), no
  con el guard de censo.
- **Guard de censo (R13, la red real):** las constantes string sueltas, los `Set`/arrays,
  las uniones tipadas por literal crudo (`estado: "recibido_origen"`) y los datos de test
  son **strings** que el compilador NO valida. Un test guard hace un grep case-sensitive
  de los 6 values antiguos sobre `app/ lib/ components/ hooks/ scripts/ tests/ e2e/` y
  falla si hay coincidencias (excluyendo `db/migrations/**` y el `down.sql` de esta
  feature). Es la garantía de completitud del rename.

## 2. Contratos I/O y capas afectadas
- **Sin cambios de forma de payload ni de endpoints** (no se agregan/renombran rutas ni
  Server Actions). Lo único que viaja distinto es el **valor textual** del estado.
- **Fuente única de tipos** (`lib/types/order-status.ts`): `ORDER_STATUS_SEED` (patrón
  `ROLES_SEED`). El seed idempotente (`scripts/seed-catalogos.ts:seedOrderStatus`) itera
  la tupla por `upsert` sobre `value`: al cambiar los literales sembrará los nuevos values
  sin lista duplicada (NO requiere edición de `seed-catalogos.ts`).
- **Presentación** (`EstatusBadge.tsx`): cambian las CLAVES de los 3 mapas Y el TEXTO de
  las etiquetas, que pasan a ser la versión legible directa del `value` (R8); la variante y
  la clase se conservan. Cambian de texto 5 labels: `en_bodega_central`
  ("En bodega central"), `en_ruta_bodega_central` ("En ruta a bodega central"),
  `devuelta_a_tienda` ("Devuelta a tienda") — renombrados — y `en_ruta_bodega_satelite`
  ("En ruta a bodega satélite"), `en_bodega_satelite` ("En bodega satélite") — NO
  renombrados, pero su etiqueta divergía del value. El case especial de línea ~96
  (`value === "en_ruta_bodega_satelite"`, label dinámico con `zonaNombre`) NO cambia su
  lógica y queda coherente con la nueva etiqueta estática.
- **Lógica** (services/repositories/actions): decenas de constantes/sets pasan al nuevo
  value (§Apéndice A.d). El resolver de transiciones (`findEstatusIdByValue`) es agnóstico
  al nombre; solo importa que la constante y la fila DB coincidan.
- **Contrato externo** (API/webhook): renombrado en TODAS las capas (R9, aprobado; breaking).
- **RLS:** no aplica — no se crean tablas ni policies; el rename no cambia RLS de `orden`
  ni de `order_status`.

## 3. Qué NO se toca (frontera explícita)
- `orden.estatus_id` y las FK `orden_historial_estado.estatus_*_id` (por `id`, R4/R11).
- Los 9 values no listados; en particular `en_bodega_satelite` y
  `en_ruta_bodega_satelite` (vecinos que el `WHERE` exacto NO alcanza, R11).
- Defaults de creación `en_preparacion` / `en_fulfillment` (`lib/config/ordenes.ts`, R11).
- Migraciones históricas y sus `down.sql` (R10). El value viejo sobrevive ahí y en el
  `down.sql` de esta feature por diseño.
- `feature_list.json`, `progress/**`, `specs/**` de otras features: registro histórico.
- `scripts/seed-catalogos.ts` (itera la tupla; sin literal propio).

## 4. Alternativa descartada

**Alternativa: conservar los `value` actuales y unificar solo en la capa de presentación
(o vía un mapa de traducción `value ↔ ui_key`).**
En lugar de renombrar el identificador, se dejaría el `value` como está y se centralizaría
la traducción a la etiqueta en un único lugar (ya existe parcialmente en
`ORDER_STATUS_LABELS`), o se añadiría una columna `ui_key`/`display` al catálogo.

**Por qué se descarta frente al rename del `value`:**
- **No unifica backend↔frontend** — que es el objetivo explícito (opción A). Perpetúa dos
  identificadores para el mismo estado (uno de DB/lógica, otro de UI/API), justo el
  problema que la feature quiere eliminar. El mapeo mental sigue vivo en ~180 archivos.
- **Superficie de bug intacta:** la divergencia value/label es la raíz de errores al
  escribir constantes de estado; una capa de traducción la esconde pero no la borra.
- **El contrato externo seguiría divergiendo** (la API expondría `en_reparto` mientras la
  UI dice "En ruta"), contradiciendo la unificación buscada.
- **Coste/beneficio:** el rename es un `UPDATE` de ≤15 filas + un barrido mecánico
  guardado por el censo (R13). Es más simple y definitivo que introducir y mantener una
  indirección nueva (columna o mapa) para siempre.

**Nota sobre una segunda alternativa (histórica):** si el enum Postgres `order_status_value`
aún existiera, la vía sería `ALTER TYPE … RENAME VALUE`. Queda descartada por inaplicable:
ese enum fue dropeado en `20260714123909`; con tabla de catálogo, `UPDATE` es la
herramienta exacta y más simple.

## 5. Verificación
- Test de lectura de `migration.sql`/`down.sql` nuevos (patrón
  `tests/integration/db/order-status-enum-migration.test.ts`) para R2/R3.
- Test de integración DB para R4 (fila antigua → nueva, `id` estable, conteos estables).
- Desacople de los tests que leen SQL histórico (R10):
  `tests/integration/db/order-status-enum-migration.test.ts` DEBE afirmar los 8 literales
  HISTÓRICOS (`{entregada, devuelta, devuelta_origen, reprogramada, en_fulfillment,
  en_ruta_bodega_principal, en_bodega, en_preparacion}`), desacoplado de `ORDER_STATUS_SEED`.
- Suites unit/component/integration actualizadas (R5–R9, R12) + guard de censo (R13).
- `./init.sh` y la suite completa en verde (`docs/verification.md`).

---

## Apéndice A — Censo real clasificado (case-sensitive, `archivo:línea`)

> `en_bodega` se censó por igualdad exacta (regex `en_bodega\b`), sin falsos positivos de
> `en_bodega_satelite`/`en_ruta_bodega_satelite`. Total afectado ≈ **180 archivos**
> (~78 producción + 91 tests + 7 e2e + 4 nuevos), sin contar `specs/`/`progress/`/
> `feature_list.json` (~100 archivos de registro histórico) ni las ~13 migraciones
> históricas inmutables. La lista de archivos completa está en `tasks.md`.

Clasificación: **(a)** catálogo/tabla · **(b)** tipos TS/constantes + contrato externo ·
**(c)** labels UI · **(d)** lógica (constantes/sets/uniones) · **(e)** tests · **(f)** seeds.

### (a) Catálogo / tabla `order_status` → la MIGRACIÓN NUEVA hace UPDATE
- `db/schema.prisma:350-351` — comentario que enumera los 8 valores (incl. `en_bodega`,
  `en_ruta_bodega_principal`, `devuelta_origen`). **CAMBIA (comentario) por exactitud.**
- Migraciones históricas que crean/insertan estos values (`20260710150000_order_status_value_enum`,
  `20260711130000_..._espera_aceptacion`, `20260714150000_seed_order_status_completo`,
  `20260715120000_order_status_recibido_origen`, `20260714123909_.../down.sql`, etc.).
  **NO CAMBIAN (históricas, R10).**
- Migración NUEVA `<ts>_order_status_rename_nomenclatura/migration.sql` (6 UPDATE) +
  `down.sql` (6 UPDATE inversos). **SE CREAN** (el `down.sql` contiene los values viejos por diseño).

### (b) Tipos TS / constantes fuente + contrato externo → CAMBIA
- `lib/types/order-status.ts:22,25,26,28,30,33` — literales de `ORDER_STATUS_SEED` (+ comentarios
  12/13/14/33/34). **CAMBIA (conserva orden posicional).** Origina el flip de `OrderStatusValue`.
- `lib/types/webhook-eventos.ts:13,14,15,20,21` — array de eventos de webhook (contrato externo, R9).
- `lib/api/openapi-spec.ts:15,18,19,21,23,26` (+ doc strings 74/140/148/211/307-308/319/322-323/537)
  — enum de estado y ejemplos del contrato de API key (R9).
- `docs/api/api-key-openapi.yaml:166,363,573,629,…` — enums del OpenAPI publicado (R9).
- `lib/types/api-orden.ts:51`, `lib/types/recepcion-origen.ts:20`,
  `lib/types/recepcion-satelite.ts:87`, `lib/types/orden.ts:134`,
  `lib/types/orden-historial.ts:25,28-31,47,61,66-67`, `lib/types/orden-guia.ts:7` —
  uniones/comentarios tipados por literal. **CAMBIA (literales; comentarios cosméticos).**

### (c) Labels UI → CAMBIA la CLAVE (6) y el TEXTO de 5 etiquetas (R8)
- `app/(app)/ordenes/_components/EstatusBadge.tsx:16,17,20,22,24,27` — claves de
  `ORDER_STATUS_LABELS`; `:41,42,45,47,49,54` — claves de `ORDER_STATUS_VARIANT`;
  `:67,69` — claves de `ORDER_STATUS_CLASS`. **CAMBIA la clave (6 renombrados); la variante
  y la clase se conservan.** ADEMÁS el TEXTO de 5 labels se alinea al value (R8):
  `en_bodega_central`="En bodega central", `en_ruta_bodega_central`="En ruta a bodega
  central", `devuelta_a_tienda`="Devuelta a tienda", y —sin renombrar el value—
  `en_ruta_bodega_satelite`="En ruta a bodega satélite" (:23) y `en_bodega_satelite`="En
  bodega satélite" (:26). El case especial `en_ruta_bodega_satelite` (~:96) mantiene su
  lógica (label dinámico con `zonaNombre`).
- `components/shared/PrioridadResalte.tsx`, `components/private/BodegaLiberadasHoy.tsx`
  y ~18 componentes bajo `app/(app)/**` (ver counts en tasks §Archivos). **CAMBIA** claves/
  comparaciones/comentarios según cada archivo (p. ej. `estatusValue="en_bodega"` en
  `OrdenesRevisionMaestro.tsx:211-212`, `page.tsx:33` array de estados por rol).

### (d) Lógica (constantes / sets / uniones-literal) → CAMBIA (crítico para R7)
Constantes de estado (resolver value→id): **CAMBIA cada literal.**
- `lib/repositories/OrdenRepository.ts:47` `ESTATUS_EN_REPARTO`, `:51`
  `ESTADOS_CANCELABLES_API=["en_bodega","en_ruta_bodega_principal"]`, `:136`
  `ORIGEN_RECEPCION_ORIGEN="devuelta_origen"`, `:1240` etc.
- `lib/repositories/CorteDiarioRepository.ts:16` `ESTADO_EN_REPARTO`.
- `lib/services/MisAsignacionesService.ts:36` `ORIGEN_RECOGER="en_espera_aceptacion"`,
  `:37` `ESTADO_EN_REPARTO`, `:39` `ORIGEN_GESTION="en_reparto"`.
- `lib/services/GuiaAsignacionService.ts:33` `ORIGEN_BODEGA="en_bodega"`, `:35`
  `ORIGEN_RUTEO_SATELITE=new Set([...,"en_bodega"])`, `:40` `ESTATUS_EN_ESPERA_ACEPTACION`,
  `:41` `ESTATUS_EN_BODEGA`.
- `lib/services/CierreDiaService.ts:36` `ESTADOS_PENDIENTES=["en_espera_aceptacion","en_reparto"]`,
  `:60` `ESTADO_EN_REPARTO`, `:77` mapa `devuelta:["en_bodega","en_bodega_satelite",...]`.
- `lib/services/CorteDiarioService.ts:20`, `lib/services/CierresAdminService.ts:40`
  `ESTADO_EN_BODEGA`, `lib/services/DevolucionSlaService.ts:19`,
  `lib/services/RecuperacionBodegaService.ts:15`, `lib/services/LiberacionReprogramadaService.ts:12`
  `ESTATUS_EN_BODEGA`.
- `lib/services/DevolucionOrigenService.ts:15` `ESTADO_DESTINO="devuelta_origen"`,
  `lib/services/ApiOrdenCancelacionService.ts:11` `ESTADO_DESTINO_CANCELACION`,
  `lib/services/RecepcionOrigenService.ts:11` `ORIGEN_RECEPCION="devuelta_origen"`, `:12`
  `ESTADO_RECIBIDA="recibido_origen"`.
- `lib/services/AsignacionSateliteService.ts:16` `ESTADO_ASIGNADA="en_espera_aceptacion"`,
  `:204` cast `as "en_espera_aceptacion"`.
- `lib/services/BulkOrdenService.ts:32` `ESTATUS_INICIAL_API="en_ruta_bodega_principal"`.
- `lib/actions/liberacion-reprogramada.ts:30` `ESTATUS_BODEGA_CENTRAL="en_bodega"`.
- `app/(app)/ordenes/_components/OrdenesTabs.tsx:97,110,291,295` `ESTADO_EN_BODEGA`, arrays
  y `case "en_espera_aceptacion"`/`case "en_bodega"`.
- `app/(app)/ordenes/_components/GenerarGuiaModal.tsx:169,172` comparaciones
  `r.estado === "en_espera_aceptacion"` / `=== "en_bodega"`.
- `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx:202-203,211-212,256-257`
  props `estatusValue`/`estatusIdPorValue.get("<value>")`.
- Repos/servicios/interfaces adicionales con literales o comentarios (lista completa por el
  guard R13): `GestionOrdenRepository`, `LiberacionReprogramadaRepository`,
  `RecuperacionBodegaRepository`, `CierreDiaRepository`, `OrdenService`, y sus interfaces
  `I*` (comentarios y, donde apliquen, literales de union).

### (e) Tests → CAMBIA a los nuevos values (91 archivos)
Alto volumen. Se actualizan datos de entrada, seeds de fixtures y aserciones. Dos casos
especiales:
- `tests/unit/types/order-status.test.ts` — aserción de set (:12-30) a los nuevos values y
  aserciones POSICIONALES (`[8]`→`por_recoger`, `[10]`→`en_ruta`, `[13]`→`devuelta_a_tienda`),
  conservando el índice; el segundo `describe` (`seedOrderStatus`, :100-121) a los nuevos
  `rows.has(...)`.
- `tests/components/EstatusLabel.test.ts` (:15,16,19,22,23) y demás tests de badge/columnas
  que afirman TEXTO de etiqueta — actualizar a los nuevos labels (R8): "En bodega central",
  "En ruta a bodega central", "Devuelta a tienda", "En ruta a bodega satélite", "En bodega
  satélite" (antes "En B. Central"/"Enviando a B. Central"/"En tienda"/"Por recibir en
  satélite"/"En satélite").
- `tests/integration/db/order-status-enum-migration.test.ts` — **desacoplar** de
  `ORDER_STATUS_SEED` y afirmar los 8 literales HISTÓRICOS del enum (R10), ya que 3 de los
  6 renombrados (`en_bodega`, `en_ruta_bodega_principal`, `devuelta_origen`) están entre
  esos 8 originales y romperían la comparación por set.
- Test NUEVO de la migración rename (UP/DOWN + fila R4). **SE CREA.**
- Guard de censo R13. **SE CREA.**
- Resto (89 archivos): ver lista completa en `tasks.md §Archivos esperados`.

### (f) Seeds → cubierto por (b) salvo el seed de QA
- `scripts/seed-catalogos.ts` — itera `ORDER_STATUS_SEED` por `upsert(value)`; **NO
  requiere edición** (los nuevos values entran vía la tupla de (b)).
- `scripts/seed-ordenes-qa.ts:225,229,244,268,297,319,342,364,387,410,420,432,657,661,664`
  — literales `estatusValue`/`origenValue`/`destinoValue`/`in:[...]`. **CAMBIA.**
