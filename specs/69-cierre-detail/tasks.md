# Feature 69 — `cierre_detail`: desglose de tareas

> `[P]` = paralelizable con las tareas de su mismo bloque. Cada task lleva criterio de **Hecho**.
> Regla del arnés: **un commit por task lógica** (`docs/conventions.md` §Commits).
>
> **Gate F1.4 APROBADA por el humano el 2026-07-15** (`requirements.md` §7). **Nada bloquea T1.**
> Decisiones firmes que las tasks deben respetar sin re-abrir:
> (a) backfill sin fallback · (b) tarifa como columnas de ENTRADA · (c) conservar el gap ·
> (e) sin guarda al UPDATE · (f) confirmado punto único de escritura ·
> **(g) OVERRIDE: NO se filtra `tarifas.status`** — se conserva el resolver actual + `TODO:` (T2b).
>
> Rama `feature/69-cierre-detail`, desde `origin/dev` `14f6548` (con el PR #75). La 68 está
> `cancelled`, absorbida por esta feature.
>
> **Único punto sujeto a confirmación del humano:** el texto exacto del `TODO:` de T2b
> (`design.md` §6.1 — "migrarlo a snapshot" queda sin objeto; lo pendiente es la *selección* de la
> fila vigente). T2b no se cierra sin esa confirmación; **no bloquea ninguna otra task**.

---

## Bloque 0 — Desbloquear el árbol (absorbe la 68)

Se hace **primero**: mientras `pnpm typecheck` tenga 2 errores, ninguna verificación de esta feature
es interpretable (no se distingue "mi error" de "el baseline roto").

- [ ] **T1. Renombrar el contrato del resolver de tarifa.** (dep: —)
  `ITarifaVigentePorZonaRepository` → `ITarifaVigentePorTiendaRepository`; `TarifaVigentePorZona` →
  `TarifaVigente`; `resolveTarifaPorZona(zonaId)` → `resolveTarifaPorTienda(tiendaId)`; añadir
  `resolveTarifasPorTiendas(tx, tiendaIds): Promise<Map<string, TarifaVigente | null>>` (design §3.1).
  Actualizar importes en `WalletFeedService`, `WalletTiendaFeedService`, `lib/utils/ingreso-ordenex.ts`
  y `lib/actions/cierres-admin.ts:69,74`. Los 7 campos del tipo **no cambian**.
  **Hecho:** compila; no queda ninguna referencia a `PorZona` (`rg -i tarifavigenteporzona` = 0 hits
  fuera de `specs/` y `progress/`).

- [ ] **T2. Implementar `TarifaVigentePorTiendaRepository`.** (dep: T1)
  Renombrar el archivo; `where: { tiendaId, deletedAt: null }`, `orderBy: { createdAt: "desc" }`, mismo
  `select` de 7 columnas, mismo `toFixed(2)` (money-safe). Implementar el batch
  `resolveTarifasPorTiendas` con **una** query (`findMany` con `tienda_id IN (…)`) + selección del
  primero por tienda — sin N+1. (R20/R22)
  **(g) OVERRIDE — NO añadir `status: "activo"` al `where`.** Es decisión firme del humano, no un
  olvido: se conserva el comportamiento actual del resolver (`design.md` §6.1).
  **Hecho:** `pnpm typecheck` deja de reportar `TarifaVigentePorZonaRepository.ts:22`; el `where` NO
  menciona `status`.

- [ ] **T2b. `TODO:` de la deuda (g) en el resolver.** (dep: T2) — **R30**
  Comentario `TODO:` **real y localizable por grep** (empieza literalmente por `TODO:`, no un comentario
  suelto) en `lib/repositories/TarifaVigentePorTiendaRepository.ts` (el archivo que sustituye a
  `TarifaVigentePorZonaRepository.ts` tras T1/T2). Debe declarar, con estas cuatro piezas:
  1. `tarifas.status` existe desde el **PR #64** y **hoy NO se filtra** (sólo `deleted_at IS NULL`).
  2. En consecuencia, **una tarifa `inactivo` puede resolverse como vigente y liquidar dinero**
     (incluida la de una tienda que dejó de ser `adminTienda`).
  3. **Qué queda pendiente:** decidir si `status` entra en el `WHERE`, es decir la **regla de SELECCIÓN
     de la fila vigente** — y qué pasa con las tiendas que se queden sin candidata (⇒ `null` ⇒ gap (c)
     ⇒ conceptos 0.00). **NO** "migrarlo a snapshot": el snapshot lo cubre R8 desde esta misma feature
     (`design.md` §6.1). Congelar no corrige la selección; la vuelve permanente.
  4. Referencia: **feature 69**, decisión **(g)** (override del humano, 2026-07-15).
  **⚠ Sujeta a confirmación del humano:** el punto (3) reformula lo que él pidió literalmente
  ("la salida prevista es migrarlo a snapshot"), que queda sin objeto tras R8. **Reportado; no cerrar
  T2b sin su OK al texto.** No bloquea ninguna otra task.
  **Hecho:** `rg "TODO:" lib/repositories/TarifaVigentePorTiendaRepository.ts` lo encuentra; el test
  estructural de R30 (en T3) pasa.

- [ ] **T3. [P] Test REAL del resolver.** (dep: T2, T2b) — **R23/R22/R30, decisiones (d) y (g)**
  `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts`: instancia la **clase real**
  con un doble de `Pick<PrismaClient,"tarifa">` (patrón `cierre-dia-repository.test.ts:38-58`) y afirma
  los **argumentos exactos** de `findFirst`/`findMany`. Cubre: resuelve por `tiendaId`; excluye
  `deleted_at`; elige la más reciente; `null` si no hay (gap R9); el batch no hace N+1.
  **+ (g)/R22:** afirma que el `where` **NO contiene `status`** — testear la ausencia es deliberado: si
  alguien "arregla" el filtro sin gate, un cambio de dinero entraría de contrabando y el test lo delata.
  **+ R30:** test estructural — el fuente del resolver contiene un `TODO:` que menciona `status` y la
  feature 69 (falla si un refactor lo borra).
  **Hecho:** el test falla si se cambia `tiendaId` por cualquier otra columna. **Verificar a mano**
  invirtiendo la condición antes de dar por buena la task.

- [ ] **T4. [P] Arreglar `scripts/seed-zonas.ts:257`.** (dep: —) — **R28**
  `prisma.distrito.update({ data: { zonaId } })` → upsert idempotente sobre `zona_distrito`
  (`@@unique([zonaId, distritoId])`, feature 24). No cambiar la semántica de los contadores
  `asignados` / `ternasSinCorrespondencia` / `filasOmitidas`.
  **Hecho:** `pnpm typecheck` = **0 errores**; `tests/unit/scripts/seed-zonas.test.ts` verde.

- [ ] **T5. Checkpoint del bloque 0.** (dep: T1–T4)
  **Hecho:** `pnpm typecheck` = 0, `pnpm lint` verde, `pnpm test` verde (~2764/296), **`pnpm build`
  VERDE** y **`./init.sh` VERDE**. Se registra la evidencia en `progress/impl_69-cierre-detail.md`.
  *Este checkpoint es el que la 68 nunca alcanzó: no se avanza a T6 sin él.*

---

## Bloque 1 — El snapshot (esquema)

- [ ] **T6. Modelo Prisma `CierreDetail`.** (dep: T5) — **R1/R2/R6/R7/R8/R10/R11**
  `db/schema.prisma` (design §2.2) + lados inversos en `CierreDia`, `Orden`, `Zona`, `Usuario`,
  `Tarifa`. Sin `updated_at`/`deleted_at` (fila inmutable). Dinero `Decimal(12,2)`, porcentajes
  `Decimal(5,2)`, camelCase + `@map`, `@@unique([cierreId, ordenId])`, `@@index([ordenId])`,
  `@@map("cierre_detail")`.
  **Hecho:** `pnpm prisma validate` (o `db:migrate:create`) genera el SQL esperado; typecheck verde.

- [ ] **T7. Migración `20260715140000_cierre_detail/`.** (dep: T6) — **R24/R25/R26/R27**
  `migration.sql` + **`down.sql` obligatorio**. Cabecera de comentario con feature y `R<n>`.
  `CREATE TABLE` con `"id" TEXT NOT NULL` + `CONSTRAINT "cierre_detail_pkey" PRIMARY KEY ("id")`;
  UNIQUE e índice como sentencias aparte; las **5 FKs** como `ALTER TABLE` aparte
  (`ON DELETE RESTRICT ON UPDATE CASCADE`); `ENABLE ROW LEVEL SECURITY` **sin policies**;
  **backfill** `INSERT … SELECT` con `LEFT JOIN LATERAL` sobre `tarifas` + `ON CONFLICT DO NOTHING`
  (design §5). `down.sql` = `DROP TABLE IF EXISTS "cierre_detail";`.
  **(g):** el `LATERAL` **NO** lleva `AND ta.status = 'activo'` — debe coincidir **al carácter** con el
  `WHERE` del resolver (T2), o un cierre backfilleado y uno nuevo liquidarían distinto.
  **Antes de escribir:** verificar que `gen_random_uuid()` está disponible en la base (design §5).
  **Hecho:** `pnpm db:migrate` aplica; `pnpm db:rollback` revierte; `pnpm db:migrate` vuelve a aplicar
  (round-trip UP→DOWN→UP real, `docs/verification.md`).

- [ ] **T8. [P] Test estático de la migración.** (dep: T7) — **R1/R2/R24/R25/R26/R27**
  `tests/integration/db/cierre-detail-migration.test.ts`, patrón
  `tests/integration/db/gasto-fijo-plantilla-migration.test.ts` (regex sobre `migration.sql`/`down.sql`).
  Afirma: `CREATE TABLE`, pkey, `UNIQUE ("cierre_id", "orden_id")`, las 5 FKs, tipos `DECIMAL(12,2)` /
  `DECIMAL(5,2)`, `ENABLE ROW LEVEL SECURITY` + `not.toMatch(/CREATE POLICY/i)`, presencia del
  backfill, y `DROP TABLE IF EXISTS "cierre_detail"` en el DOWN.
  **Hecho:** verde.

- [ ] **T9. Apendar la migración a la denylist de `zonas-migration.test.ts`.** (dep: T7) — **frágil**
  `tests/integration/db/zonas-migration.test.ts:127-163`: añadir
  `!d.endsWith("_cierre_detail") && // feature 69: apendida despues`. **Ojo:** la última condición
  (`:163`) **no lleva `&&`** — hay que reescribirla al insertar. Verificar además si
  `_order_status_recibido_origen` (otra sesión) ya está o hay que añadirla.
  **Hecho:** `pnpm test tests/integration/db/zonas-migration.test.ts` verde.

---

## Bloque 2 — Escritura del snapshot

- [ ] **T10. `crearCierre` puebla `cierre_detail`.** (dep: T2, T6) — **R3/R4/R5/R6/R7/R8/R9/R11**
  `lib/repositories/CierreDiaRepository.ts`: inyectar `ITarifaVigentePorTiendaRepository` por
  constructor; dentro de la `$transaction` existente y **después** del `updateMany` que vincula
  (design §3): (5) `findMany({ where: { cierreId } })` con `SNAPSHOT_SELECT`, (6) dedupe por `ordenId`,
  (7) `resolveTarifasPorTiendas(tx, …)`, (8) `cierreDetail.createMany`. **No** extender
  `CrearCierreInput`: el service no cambia. Actualizar el composition root que instancia
  `CierreDiaRepository`.
  **Hecho:** typecheck verde; el snapshot se construye leyendo lo que la tx vinculó (no la lista del
  service).

- [ ] **T11. Tests de `crearCierre`.** (dep: T10) — **R3/R4/R5/R6/R7/R8/R9/R11/R16**
  `tests/unit/repositories/cierre-dia-repository.test.ts` (patrón existente:
  objeto literal con `vi.fn()` por método + inyección por constructor con cast, `:38-58`). Casos:
  puebla en la MISMA tx (R3); fallo del `createMany` ⇒ rollback sin efectos (R4); gestión anulada ⇒ sin
  fila (R5); payload money-critical (R6), descriptivos + 5 nombres (R7) y 7 valores de tarifa (R8);
  tienda sin tarifa ⇒ fila con `tarifa_id` NULL **y cierre creado** (R9); **2 gestiones de la misma
  orden ⇒ 1 sola fila** (R2, el grano); montos `Decimal`/string escala 2 (R11);
  `findGestionesPendientes` sigue en vivo (R16).
  **Hecho:** verdes; los describes existentes (37/39/56/67, incluido "R16 — crearCierre NO vincula
  gestiones anuladas") **siguen verdes sin editarse**.

- [ ] **T12. [P] Test de inmutabilidad.** (dep: T10) — **R10**
  `tests/unit/repositories/cierre-detail-inmutable.test.ts`: test estructural sobre `lib/` — ningún
  módulo emite `cierreDetail.update`/`updateMany`/`delete`/`deleteMany`/`upsert`. Es la red que impide
  que una feature futura convierta el snapshot en dato vivo.
  **Hecho:** verde; falla si se añade una escritura.

- [ ] **T13. [P] Corte diario cubierto por construcción.** (dep: T10) — **(f)**
  Verificado que `CorteDiarioService.ts:80` usa el MISMO `crearCierre` y que `CorteDiarioRepository`
  no crea cierres. Añadir a `tests/unit/services/corte-diario-service.test.ts` la aserción de que el
  cierre `vencido` pasa por el mismo repo (regresión: falla si aparece un tercer punto de escritura).
  **Hecho:** verde. **Sin cambio de producción esperado** — si hiciera falta uno, es una desviación del
  diseño y se reporta.

---

## Bloque 3 — Los lectores pasan al snapshot

- [ ] **T14. `WalletFeedService` lee `cierre_detail`.** (dep: T10) — **R12/R14/R21**
  design §4.1: `cierreDetail.findMany` + `gestionOrden.findMany({select:{ordenId,resultado}})`, join en
  memoria por `ordenId`; fila ausente ⇒ **throw** (sin fallback); `tarifa_id` NULL ⇒ `null` ⇒ conceptos
  0.00 (gap R9 preservado). **Elimina** `tarifaRepo` del constructor y la caché por zona
  (`WalletFeedService.ts:43-49`). `lib/utils/ingreso-ordenex.ts` **NO se toca**.
  **Hecho:** typecheck verde; el service ya no importa nada de tarifa.

- [ ] **T15. `WalletTiendaFeedService` lee `cierre_detail`.** (dep: T10) — **R13/R14**
  Ídem, con `tiendaId` **congelado** desde el snapshot y `montoRecibido` desde `gestion_orden`. El
  interruptor Q3 (43/R28) se sigue leyendo al aprobar: es política, no dato de la orden.
  **Hecho:** typecheck verde.

- [ ] **T16. Composition root.** (dep: T14, T15)
  `lib/actions/cierres-admin.ts:69,74`: los feeds ya no reciben el repo de tarifa; `CierreDiaRepository`
  sí. Revisar todo instanciador de `CierreDiaRepository` / `WalletFeedService` / `WalletTiendaFeedService`.
  **Hecho:** `pnpm build` verde; no queda ningún `new WalletFeedService(new Tarifa…)`.

- [ ] **T17. Tests de los feeds.** (dep: T14, T15) — **R12/R13/R14**
  `tests/unit/services/wallet-feed-service.test.ts` y `wallet-tienda-feed-service.test.ts`: deriva desde
  el snapshot; `orden`/`zona`/`tarifas` vivas **nunca** consultadas (aserción sobre el doble de `tx`);
  fila faltante ⇒ throw **y cero movimientos**; `tarifa_id` NULL ⇒ conceptos 0.00 no bloqueante; una
  orden con 2 gestiones (`entregada` + `reprogramada`) ⇒ 2 entradas con la misma fila congelada.
  **Hecho:** verdes; los tests de importes existentes (42/43) siguen verdes con los mismos números.

- [ ] **T18. Detalle del admin desde el snapshot.** (dep: T10) — **R15/R16/R19**
  `CierresAdminRepository.findCierreByIdEnAlcance` (`:130-134`) compone `cierre_detail` + gestión y
  devuelve el **mismo DTO** (`CierreGestionPendienteRow`) — la UI no cambia. `WITH_DETALLE` /
  `toPendienteRow` **siguen existiendo** para la vista EN VIVO de la 37 (R16).
  **Hecho:** typecheck verde; `tests/unit/repositories/cierres-admin-repository.test.ts` extendido:
  el detalle sale del snapshot (R15) y una orden con `deleted_at` sigue apareciendo (R19).

---

## Bloque 4 — La propiedad de negocio y el cierre

- [ ] **T19. Test de la propiedad (el corazón de la feature).** (dep: T14, T15, T18) — **R17/R18**
  `tests/integration/db/cierre-detail-congelado.test.ts`, patrón `wallet-idempotencia.test.ts` (tienda
  en memoria con la semántica del constraint; **no hay Postgres en la suite**, verificado). Dos casos,
  ambos money-critical:
  1. **R17:** solicitar cierre → mutar `monto_cobrar` (y `tienda_id`) de la orden → aprobar ⇒ los
     movimientos salen con los valores **congelados** y **cuadran con `total_*`** del cierre (37/R14).
     *Debe fallar contra el código de `dev` de hoy* — si pasa antes de T14, el test no prueba nada.
  2. **R18:** solicitar cierre → soft-delete de la tarifa + alta de otra distinta → aprobar ⇒
     movimientos con la tarifa **congelada**.
  **Hecho:** verdes; verificados a mano contra el código pre-T14 (deben salir rojos ahí).

- [ ] **T20. Mapa de trazabilidad.** (dep: T1–T19) — **`docs/specs.md` §Trazabilidad, `CHECKPOINTS.md`**
  `progress/impl_69-cierre-detail.md` con el mapa **`R1`–`R30` → test concreto** (la tabla de
  `requirements.md` es el destino previsto, no el resultado: se documenta lo que quedó), archivos
  tocados, decisiones F1.4 aplicadas y desviaciones.
  **Hecho:** ningún `R<n>` sin test. *Un requisito sin test es un fallo de la feature.*

- [ ] **T21. Verificación final.** (dep: T20) — **R28/R29, criterio de aceptación, NO deuda**
  **Hecho:** `pnpm test` verde y **sin regresión** del baseline (~2764 tests / 296 archivos / 0 fallos,
  + los nuevos); `pnpm typecheck` = **0 errores** (baseline 2 → 0); `pnpm lint` verde; **`pnpm build`
  VERDE**; **`./init.sh` VERDE**. Evidencia pegada en `progress/impl_69-cierre-detail.md`.
  *`./init.sh` entra ROJO a esta feature y DEBE salir VERDE: es la definición de "hecho" aquí.*

- [ ] **T22. Bookkeeping.** (dep: T21)
  `feature_list.json` id 69 → `done`; entrada en `progress/history.md`; `progress/current.md`
  actualizado; la feature **68** queda `cancelled` (absorbida) con la nota de que la 69 la cerró.
  **Hecho:** `./init.sh` valida el estado y `progress/review_69-cierre-detail.md` tiene veredicto OK.

---

## Grafo de dependencias

```
gate F1.4 APROBADA (2026-07-15) — nada bloquea T1
   │
   ├─ T1 ─ T2 ─┬─ T2b ─ T3 [P]      (T2b: texto del TODO sujeto a OK del humano)
   │           └──────────────┐
   ├─ T4 [P] ─────────────────┤
   │                          │
   └────────────────────── T5 (checkpoint: árbol VERDE) ← la 68 muere aquí
                              │
                        T6 ─ T7 ─┬─ T8 [P]
                              │   └─ T9  (denylist frágil)
                              │
                        T10 ─┬─ T11
                             ├─ T12 [P]
                             ├─ T13 [P]
                             ├─ T14 ─┐
                             ├─ T15 ─┼─ T16 ─ T17
                             └─ T18 ─┘        │
                                              └─ T19 ─ T20 ─ T21 ─ T22
```

**Ruta crítica:** T1 → T2 → T5 → T6 → T7 → T10 → T14/T15 → T19 → T21.
**Paralelizables reales:** (T2b→T3) ∥ T4 (bloque 0); T8 ∥ T9 (bloque 1); T12 ∥ T13 ∥ (T14→T15) ∥ T18
(bloque 2/3).
**Total: 23 tasks** (T1–T22 + T2b) para **R1–R30**.
