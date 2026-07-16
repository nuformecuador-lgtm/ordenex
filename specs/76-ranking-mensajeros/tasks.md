# Feature 76 — Tasks (ranking DIARIO)

> Checklist de pasos discretos y verificables. `[P]` = paralelizable. Cada task indica ZONA
> (backend/frontend), archivos esperados, dependencias y criterio de "hecho". Requisitos de
> `requirements.md`. Gate F1.4 (a-f) CERRADA y **DS1 RESUELTA** (columna `orden.asignado_at`).
> NO quedan sub-decisiones abiertas.

---

## Bloque 0 — Instrumentación de `orden.asignado_at` (fuente del denominador, R23/R24)

- [x] **T0a — Migración `orden.asignado_at`.** ZONA: backend. Requisitos: R24.
  - Archivos: `db/schema.prisma` (`model Orden`: `asignadoAt DateTime? @map("asignado_at")`
    + `@@index([mensajeroAsignadoId, asignadoAt])`);
    `db/migrations/<ts>_orden_asignado_at/migration.sql` (ADD COLUMN nullable + CREATE INDEX);
    `db/migrations/<ts>_orden_asignado_at/down.sql` (DROP INDEX + DROP COLUMN).
  - Depende de: —.
  - Hecho: `db:migrate` aplica; `db:rollback` revierte; órdenes existentes quedan `asignado_at` NULL.

- [x] **T0b — Estampar `asignado_at = now` en los 4 writers de asignación (choke-point).**
  ZONA: backend. Requisitos: R23.
  - Archivos (uno por writer, design §4.1):
    - W1 `lib/repositories/OrdenRepository.ts:899-901` (`generarGuiaLote`) — estampar solo si
      `mensajeroAsignadoId` no nulo.
    - W2 `lib/repositories/OrdenRepository.ts:941-943` (`asignarBodegaLote`) — estampar siempre.
    - W3 `lib/repositories/OrdenRepository.ts:1251-1253` (`asignarSateliteLote`, raw SQL) —
      añadir `"asignado_at" = NOW()` al `SET`.
    - W4 `lib/repositories/CierreDiaRepository.ts:481-483` (deshacer-gestión repone) — estampar.
  - Depende de: T0a.
  - Hecho: un test por writer verifica que tras asignar/reasignar, `asignado_at` queda seteado
    a HOY (R23). Ningún path de asignación queda sin instrumentar.

- [x] **T0c [P] — Limpiar `asignado_at = NULL` en paths de limpieza (LC1, defensivo).**
  ZONA: backend. Requisitos: R23 (nota LC1).
  - Archivos (design §4.2): C1 `GestionOrdenRepository.ts:284` (`limpiaMensajero`),
    C2 `OrdenRepository.ts:989` (`rutearBodegaSateliteLote`),
    C3 `LiberacionReprogramadaRepository.ts:87`.
  - Depende de: T0a.
  - Hecho: al limpiar `mensajeroAsignadoId`, `asignado_at` queda NULL (test de al menos C1).

---

## Bloque 1 — Backend (config, datos, repo, service, action)

- [x] **T1 [P] — Config de umbral de muestra.** ZONA: backend. Requisitos: R7, R22.
  - Archivos: `lib/config/ranking.ts` (`readPositiveInt("RANKING_MIN_ASIGNADAS", 1)`,
    espejo de `lib/config/reintentos.ts`).
  - Depende de: —.
  - Hecho: test unit: env vacío/ inválido → default 1; env válido → override.

- [x] **T2 [P] — Migración `premio_ranking` + config.** ZONA: backend. Requisitos: R8, R21, R25.
  - Archivos: `db/schema.prisma` (model `PremioRanking`: `monto Decimal(12,2)?` +
    `descripcion String?` (`TEXT`), ambos NULLABLE);
    `db/migrations/<ts>_premio_ranking/migration.sql` (CREATE + CHECK posicion 1-3 +
    UNIQUE(posicion) + columnas `monto`/`descripcion` NULLABLE + INSERT 3 seed
    (`monto NULL`, `descripcion NULL`) + ENABLE RLS + políticas);
    `db/migrations/<ts>_premio_ranking/down.sql` (DROP TABLE).
  - Depende de: —.
  - Hecho: `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte; 3 filas seed; RLS activo.

- [x] **T3 — `RankingRepository` (agregación diaria).** ZONA: backend. Requisitos: R1, R2.
  - Archivos: `lib/repositories/RankingRepository.ts`
    (`contarEntregadasPorMensajero(desde,hasta)` = `gestionOrden.groupBy` `entregada`+`anuladaAt:null`+`createdAt` en rango;
    `contarAsignadasPorMensajero(desde,hasta)` = `orden.groupBy({ by:["mensajeroAsignadoId"], where:{ mensajeroAsignadoId:{not:null}, asignadoAt:{gte:desde,lt:hasta} } })`).
    Índice `@@index([mensajeroAsignadoId, asignadoAt])` ya creado en T0a; confirmar con `EXPLAIN`.
  - Depende de: T0a (columna `asignado_at`).
  - Hecho: test unit (mock Prisma) verifica R1: entregadas excluyen anuladas y respetan rango
    HOY(CR); asignadas filtran por `asignadoAt ∈ HOY(CR)` y `mensajeroAsignadoId`.

- [x] **T4 [P] — Interfaces repo/servicio.** ZONA: backend. Requisitos: R1, R2, R10.
  - Archivos: `lib/interfaces/repositories/IRankingRepository.ts`,
    `lib/interfaces/repositories/IPremioRankingRepository.ts`,
    `lib/interfaces/services/IRankingService.ts`.
  - Depende de: —.
  - Hecho: compilan (`typecheck`) con las firmas del design §8.

- [x] **T5 [P] — `PremioRankingRepository`.** ZONA: backend. Requisitos: R8, R9, R10, R25.
  - Archivos: `lib/repositories/PremioRankingRepository.ts` (`listar()` → `{posicion, monto, descripcion}`,
    `upsertPremio(posicion, { monto: Decimal|null, descripcion: string|null })`).
  - Depende de: T2, T4.
  - Hecho: test unit: listar (3 filas con monto+descripcion), upsert (set/null de monto y de descripcion).

- [x] **T6 — `RankingService`.** ZONA: backend.
  Requisitos: R2, R3, R4, R5, R6, R7, R9, R12, R16, R17, R18, R19, R22.
  - Archivos: `lib/services/RankingService.ts` (rango CR con `startOfDayCR`/`UN_DIA_MS`,
    pct redondeado a 1 decimal en servidor, umbral de podio desde `lib/config/ranking.ts`,
    orden+desempate, autz por rol, asociación premio↔podio, serialización a string).
    Recibe `now` inyectable para testeo.
  - Depende de: T1, T3, T4, T5.
  - Hecho: tests unit cubren R2 (pct diario), R3 (asignadas=0 → indefinido, fuera podio),
    R4/R5 (orden/desempate determinista), R6 (conteo crudo), R7 (< umbral fuera de podio;
    default 1), R9 (null≠0), R12 (montos/pct string), R16/R17/R18 (autz por rol), R22 (CR por
    helper, umbral por config), y LC1 (orden con asignación limpiada ese día no cuenta en
    denominador ni numerador — comportamiento esperado documentado en design §2.3).

- [x] **T7 — Server Actions `ranking`.** ZONA: backend. Requisitos: R10, R11, R12, R19, R25.
  - Archivos: `lib/actions/ranking.ts` (`obtenerRankingAction`, `editarPremioAction` con zod:
    `posicion 1|2|3`, `monto string|null`, `descripcion string|null` (trim + max ~200),
    vacío→null en ambos; `revalidatePath("/ranking")`).
  - Depende de: T6.
  - Hecho: tests verifican R11 (monto negativo/ >2 dec/ no numérico → `invalid`), R10/R25 (guardar
    y vaciar monto Y descripción persisten), R19 (mensajero editando → forbidden, sin persistir).

---

## Bloque 2 — Frontend (página, módulo, menú)

- [x] **T8 — Página `/ranking` role-aware.** ZONA: frontend. Requisitos: R12, R13, R16, R17, R18.
  - Archivos: `app/(app)/ranking/page.tsx` (reemplaza stub `:1-9`; `resolveActorFromSession`,
    permite `maestro` y `mensajero`, resto → `notFound`; prefetch `obtenerRankingAction`,
    `notFound` si `status!=="ok"`; datos serializados + `esEditable` por props).
  - Depende de: T7.
  - Hecho: tests verifican R18 (otro rol/sin sesión → notFound sin datos) y paso de datos string.

- [x] **T9 — `RankingModule` + fila de premios.** ZONA: frontend.
  Requisitos: R9, R13, R14, R15, R16, R17, R25.
  - Archivos: `app/(app)/ranking/_components/RankingModule.tsx`
    (+ `_components/PremioInputRow.tsx` si se separa). Tabla ranking (posición, nombre, %,
    conteo crudo `entregadas/asignadas`) + por posición DOS inputs abiertos: monto (vacío =
    sin premio) y descripción (texto libre, vacío = sin descripción); inputs editables solo
    si `esEditable`; llama `editarPremioAction` con monto + descripción.
  - Depende de: T7, T8.
  - Hecho: tests de componente cubren R13 (render ordenado con columnas), R14 (premio junto al
    ocupante), R15 (posición sin ocupante no se inventa), R9 (monto vacío = sin premio, no 0),
    R25 (descripción se muestra/edita; vacía = sin descripción), R16/R17 (maestro edita /
    mensajero solo-lectura).

- [x] **T10 [P] — Coherencia de menú.** ZONA: frontend. Requisitos: R20.
  - Archivos: `lib/auth/menu-visibility.ts:89-95` (conservar `["maestro","mensajero"]`;
    corregir el comentario "hoy solo para maestro" → intencional maestro+mensajero).
  - Depende de: —.
  - Hecho: test/asserción de visibilidad coherente con la autz de la página.

---

## Bloque 3 — Trazabilidad y cierre

- [x] **T11 — Mapa de trazabilidad R→test.** ZONA: n/a. Requisitos: todos.
  - Archivos: `progress/impl_76-ranking-mensajeros.md` (tabla `R<n> -> test` + registro de DS1
    resuelta vía `orden.asignado_at` y de LC1).
  - Depende de: T0b, T3-T10.
  - Hecho: cada R1-R24 mapeado a un test existente que pasa.

- [x] **T12 — Verificación final.** ZONA: n/a. Requisitos: CHECKPOINTS.md.
  - Depende de: T11.
  - Hecho: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` verdes; `./init.sh` verde;
    `pnpm run db:rollback` funciona; entrada añadida a `progress/history.md`.

---

## Resumen de zonas (separación del arnés)

- **Backend:** T0a, T0b, T0c, T1, T2, T3, T4, T5, T6, T7.
- **Frontend:** T8, T9, T10.
- **Transversal/cierre:** T11, T12.

## Dependencias (resumen)

```
T0a ─┬─ T0b ──────────────┐  (choke-point R23)
     ├─ T0c               │
     └─ T3 ───────────────┤
T1 ──────────────────────┬┼─ T6 ─ T7 ─┬─ T8 ─ T9
T4 ─┬─ T5 ───────────────┘│           │
    │  (T2 ─ T5)          │            │
T2 ─┘                     │            │
T10 ──────────────────────┘────────────┘
                             T11 ─ T12
```
Writers instrumentados (R23): **4** (W1-W4, todas en T0b) + 3 paths de limpieza (T0c).
