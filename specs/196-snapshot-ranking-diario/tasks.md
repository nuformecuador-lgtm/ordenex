# Feature 196 — Tareas

Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas del mismo
bloque. Cada tarea declara **archivos exactos**, **requisitos** que cubre y **criterio de
hecho**. Gate por tanda: `./init.sh --rapido`; gate final y antes del PR: `./init.sh`
(`docs/verification.md`).

---

## Tanda 0 — Criterio único (refactor sin cambio de comportamiento)

### [x] T0.1 — Módulo puro del criterio de orden
- **Crea**: `lib/ranking/orden-ranking.ts`
- **Exporta**: `ordenarAgregados`, `asignarPodio`, `formatearPct` (design §3).
- **Cubre**: R3, R4, R9, R10.
- **Hecho**: módulo sin imports de Prisma, `next/*` ni `new Date()`; el comparador incluye
  el desempate final por `mensajeroId` asc.
- **Depende de**: —

### [x] T0.2 — Tests del módulo puro `[P con T0.3]`
- **Crea**: `tests/unit/ranking/orden-ranking.test.ts`
- **Cubre**: R4, R9, R10.
- **Hecho**: empate total (pct, entregadas, nombre) resuelto por id y estable entre dos
  llamadas; bajo umbral se lista sin posición; `formatearPct(0,0) === null`,
  `formatearPct(5,5) === "100.0"`.
- **Depende de**: T0.1

### [x] T0.3 — Fecha objetivo y ventana del día `[P con T0.2]`
- **Crea**: `lib/ranking/snapshot-dia.ts` + `tests/unit/ranking/snapshot-dia.test.ts`
- **Cubre**: R2.
- **Hecho**: `now` obligatorio (sin default); con `now = 2026-08-11T08:00:00Z` la fecha
  objetivo es `2026-08-10`; la ventana es `[…T06:00:00.000Z, +24h)`; no importa
  `startOfDayCR` ni `lib/analytics/`.
- **Depende de**: —

### [x] T0.4 — `RankingService` consume el módulo puro
- **Edita**: `lib/services/RankingService.ts`
- **Cubre**: R36.
- **Hecho**: `pnpm exec vitest run tests/unit/services/ranking-service.test.ts` verde **sin
  tocar un solo assert** del archivo de test; el diff del service solo sustituye el bloque
  de orden/podio/pct por llamadas al módulo puro.
- **Depende de**: T0.1

---

## Tanda 1 — Persistencia

### [x] T1.1 — Modelos Prisma
- **Edita**: `db/schema.prisma` (modelos `RankingSnapshotDia`, `RankingSnapshotFila`,
  relación con `Usuario`).
- **Cubre**: R1, R6, R13, R17.
- **Hecho**: `pnpm db:generate` limpio; nombres de tabla/columna en `snake_case` vía
  `@map`; `@@unique` de `(snapshotId, mensajeroId)`, `(snapshotId, puesto)` y `fecha`.
- **Depende de**: —

### [x] T1.2 — Migración UP
- **Crea**: `db/migrations/20260811120000_ranking_snapshot/migration.sql`
- **Cubre**: R1, R6, R8, R13, R17, R18, R38.
- **Hecho**: generada con `pnpm run db:migrate:create` (no a mano); contiene las dos tablas,
  los CHECK de design §2.2, las FK (CASCADE al padre / RESTRICT a `usuario`), los tres
  índices únicos —incluido el parcial de `posicion`—, los `COMMENT ON` de semántica y las
  dos sentencias `ENABLE ROW LEVEL SECURITY`. **Ninguna** sentencia toca objetos
  preexistentes.
- **Depende de**: T1.1

### [x] T1.3 — Migración DOWN
- **Crea**: `db/migrations/20260811120000_ranking_snapshot/down.sql`
- **Cubre**: R37.
- **Hecho**: dos `DROP TABLE IF EXISTS` (detalle antes que cabecera), sin `DROP TYPE`;
  `pnpm run db:migrate` seguido de `pnpm run db:rollback` deja el esquema idéntico al
  previo.
- **Depende de**: T1.2

### [x] T1.4 — Tests de migración/esquema
- **Crea**: `tests/integration/db/ranking-snapshot-migration.test.ts`
  (patrón `tests/integration/db/gestion-orden-ubicacion-migration.test.ts`).
- **Cubre**: R1, R8, R13, R17, R18, R37, R38.
- **Hecho**: verifica columnas y tipos; cada UNIQUE rechaza su duplicado; el CHECK de
  premio-sin-posición rechaza; borrar el usuario con filas falla; `pg_class.relrowsecurity`
  es `true` en ambas tablas; el test **no** se salta en silencio si la tabla está vacía
  (crea sus propios datos).
- **Depende de**: T1.3

---

## Tanda 2 — Repositorio y servicio

### [x] T2.1 — Interfaz + repositorio del snapshot
- **Crea**: `lib/interfaces/repositories/IRankingSnapshotRepository.ts`,
  `lib/repositories/RankingSnapshotRepository.ts`
- **Cubre**: R12, R13, R14, R25.
- **Hecho**: `crearSnapshot` en `prisma.$transaction` (cabecera + `createMany`); colisión
  P2002 de `fecha` → `{ creado: false }` sin propagar; `obtenerPorFecha` devuelve las filas
  `ORDER BY puesto ASC`; cliente Prisma acotado con `Pick<PrismaClient, …>`; cero lógica de
  negocio.
- **Depende de**: T1.1

### [x] T2.2 — Tests del repositorio `[P con T2.4]`
- **Crea**: `tests/unit/repositories/ranking-snapshot-repository.test.ts`
- **Cubre**: R12, R14, R25.
- **Hecho**: mock de Prisma; fallo en `createMany` no deja cabecera (una sola transacción);
  P2002 → `creado: false`; el `orderBy` es `puesto asc`.
- **Depende de**: T2.1

### [x] T2.3 — Interfaz + servicio del snapshot
- **Crea**: `lib/interfaces/services/IRankingSnapshotService.ts`,
  `lib/services/RankingSnapshotService.ts`, `lib/types/ranking-snapshot.ts`
- **Cubre**: R2, R3, R5, R6, R7, R8, R9, R10, R11, R12, R15, R16, R25, R26, R27, R28, R31.
- **Hecho**: `congelar(now)` **sin** parámetro de fecha; reusa `RankingRepository`,
  `UserRepository`, `PremioRankingRepository` y el módulo puro T0.1; filtra las filas sin
  actividad; congela nombre, conteos y premio; `obtenerPorFecha` autoriza como el vivo
  (acceso total + `mensajero`, resto `forbidden`) y serializa montos/pct a STRING.
- **Depende de**: T0.1, T0.3, T2.1

### [x] T2.4 — Tests del servicio `[P con T2.2]`
- **Crea**: `tests/unit/services/ranking-snapshot-service.test.ts`
- **Cubre**: R2, R3, R5, R6, R7, R8, R11, R12, R16, R25, R27, R28.
- **Hecho**: con los mismos datos, el orden congelado coincide fila a fila con el de
  `RankingService.obtenerRanking`; mensajero 0/0 no genera fila; sin actividad ⇒ cabecera
  con `filas = 0`; segunda corrida ⇒ `omitido` sin escrituras; renombrado posterior ⇒
  nombre congelado; rol ajeno ⇒ `forbidden`; `mensajero` ⇒ todas las filas.
- **Depende de**: T2.3

---

## Tanda 3 — Cron

### [x] T3.1 — Route handler del cron
- **Crea**: `app/api/cron/snapshot-ranking/route.ts`
- **Cubre**: R19, R20, R21, R22.
- **Hecho**: clon del patrón `generar-gastos-fijos`: auth Bearer **antes** de construir el
  service; deps inyectables (`getSecret`, `service`, `now`); 200 con
  `{fecha, estado, filas}`; errores por `withErrorHandler`/`appErrorToResponse`; cero lógica
  de negocio y cero queries en el archivo.
- **Depende de**: T2.3

### [x] T3.2 — Programación
- **Edita**: `vercel.json`
- **Cubre**: R23.
- **Hecho**: entrada `/api/cron/snapshot-ranking` con `"0 8 * * *"` (02:00 CR), distinta de
  la del corte diario; el JSON sigue validando contra su `$schema`.
- **Depende de**: T3.1

### [x] T3.3 — Tests del endpoint
- **Crea**: `tests/integration/actions/snapshot-ranking-route.test.ts`
  (patrón `tests/integration/actions/corte-diario-route.test.ts`).
- **Cubre**: R19, R20, R21, R22.
- **Hecho**: sin header, header mal formado, token distinto y secreto no configurado ⇒ 401
  y el service **nunca** se construye ni se invoca; 200 con las tres claves y sin nombres ni
  ids; service que lanza ⇒ respuesta de error + `logError` invocado; ni el cuerpo ni las
  llamadas al logger contienen el secreto.
- **Depende de**: T3.1

### [x] T3.4 — Guardia del cron y del alcance
- **Crea**: `tests/unit/guards/ranking-snapshot-cron.guardia.test.ts`
- **Cubre**: R15, R23, R29.
- **Hecho**: `vercel.json` declara la ruta y su schedule difiere del de `corte-diario`; la
  firma de `congelar` no admite fecha; ningún archivo bajo `lib/actions/` ni `app/` invoca
  `create`/`update`/`delete` sobre los modelos del snapshot fuera de
  `RankingSnapshotRepository`. El nombre del archivo casa con el patrón `guard` que
  `test:guardias` selecciona.
- **Depende de**: T3.2

---

## Tanda 4 — Lectura y UI

### [x] T4.1 — Server Action del histórico
- **Crea**: `lib/actions/ranking-historico.ts`
- **Cubre**: R27, R30, R31.
- **Hecho**: `'use server'`; zod en el borde con `esFechaCalendarioValida`; fecha inválida ⇒
  rechazo **sin** llamar al service; sin sesión ⇒ `unauthenticated`; deps inyectables
  (`service`, `getActor`) como en `lib/actions/ranking.ts`.
- **Depende de**: T2.3

### [x] T4.2 — Tests de la acción `[P con T4.4]`
- **Crea**: `tests/unit/actions/ranking-historico-actions.test.ts`
- **Cubre**: R30, R31.
- **Hecho**: `"2026-02-31"`, `"ayer"` y `""` ⇒ rechazo sin invocar al service; en el
  resultado `ok`, `pct` y `premioMonto` son `string | null`, nunca `number` ni `Decimal`.
- **Depende de**: T4.1

### [x] T4.3 — Página del histórico
- **Crea**: `app/(app)/ranking/historico/page.tsx`
- **Cubre**: R24, R26, R27, R28.
- **Hecho**: Server Component; rol resuelto server-side (acceso total + `mensajero`, resto
  `notFound`); `?fecha` con default D−1 CR; pre-fetch y paso por props; los tres estados
  (filas / sin actividad / sin snapshot) se distinguen.
- **Depende de**: T4.1

### [x] T4.4 — Módulo cliente `[P con T4.2]`
- **Crea**: `app/(app)/ranking/historico/_components/RankingHistoricoModule.tsx`,
  `.../ranking-historico-labels.ts`
- **Cubre**: R24, R25, R31.
- **Hecho**: `DataTable` con las columnas de design §7; el orden de props se respeta tal
  cual; muestra fecha consultada y «generado el <instante>»; el cliente no recibe ni un
  `Decimal`; selector de fecha que navega por URL.
- **Depende de**: T4.3

### [x] T4.5 — Enlace en el menú y en `/ranking`
- **Edita**: `lib/auth/menu-visibility.ts`, `app/(app)/ranking/page.tsx`
- **Cubre**: R28, R36.
- **Hecho**: subitem «Histórico» bajo «Ranking» con roles
  `["maestro","admin","mensajero"]`; el único cambio en `page.tsx` es el enlace —ni una
  línea de `obtenerRanking`/`editarPremio` se toca—; los tests existentes de menú y de
  `/ranking` siguen verdes.
- **Depende de**: T4.3

### [x] T4.6 — Tests de página y módulo
- **Crea**: `tests/components/RankingHistoricoPage.test.tsx`,
  `tests/components/RankingHistoricoModule.test.tsx`
- **Cubre**: R24, R25, R26, R27, R28.
- **Hecho**: rol ajeno / sin sesión ⇒ `notFound` sin pintar datos; `mensajero` ve todas las
  filas; «sin snapshot» y «sin actividad» son mensajes distintos y verificables por texto;
  el instante de generación aparece; el orden pintado es el de `puesto`.
- **Depende de**: T4.4

---

## Tanda 5 — Descarga

### [x] T5.1 — Columnas de descarga
- **Crea**: `app/(app)/ranking/historico/_components/ranking-historico-descarga-columnas.ts`
- **Cubre**: R32, R34, R35.
- **Hecho**: módulo puro (sin React ni DOM); columnas de design §7 en el orden de pantalla;
  no proyecta `mensajeroId`; encabezados compartidos con los rótulos de la tabla.
- **Depende de**: T4.4

### [x] T5.2 — Cableado del control
- **Edita**: `app/(app)/ranking/historico/_components/RankingHistoricoModule.tsx`
- **Cubre**: R32, R33, R35.
- **Hecho**: `descarga={{ titulo: "Ranking del día <fecha>", columnas, obtenerFilas: () =>
  filasLocales(filas, filaDescargaRankingHistorico) }}`; **cero** generador nuevo de xlsx.
- **Depende de**: T5.1

### [x] T5.3 — Tests de descarga `[P con T5.4]`
- **Crea**: `tests/components/descarga/RankingHistoricoDescarga.test.tsx`
  (patrón `tests/components/descarga/RankingDescarga.test.tsx`).
- **Cubre**: R32, R33.
- **Hecho**: el archivo lleva exactamente las filas de la tabla y en su orden; por encima
  del tope no hay archivo y el mensaje incluye total y tope.
- **Depende de**: T5.2

### [x] T5.4 — Tests de columnas `[P con T5.3]`
- **Crea**: `tests/unit/descarga/ranking-historico-descarga-columnas.test.ts`
- **Cubre**: R34, R35.
- **Hecho**: la proyección no contiene `mensajeroId`; `posicion`/`pct` nulos dejan celda
  vacía (no «—»); el nombre de archivo derivado del título incluye la fecha consultada.
- **Depende de**: T5.1

---

## Tanda 6 — Cierre

### [x] T6.1 — Mapa de trazabilidad y evidencia
- **Crea**: `progress/impl_196-snapshot-ranking-diario.md`
- **Cubre**: los 38 requisitos.
- **Hecho**: tabla `R<n> → test` completa (design §8) con la salida real de los tests
  pegada; ningún `R` sin test.
- **Depende de**: todas.

### T6.2 — Gate completo
- **Cubre**: —
- **Hecho**: `./init.sh` completo en verde (typecheck + lint + suite + guardias) medido
  **en esta rama**, y comparado contra el baseline de `dev` medido el mismo día
  (`docs/verification.md`: el estado del PR no corre tests).
- **Depende de**: T6.1

### T6.3 — Bookkeeping
- **Edita**: `feature_list.json` (id 196 → `done`, `branch`), `progress/current.md`
- **Hecho**: solo se modifican los campos de la feature 196; el diff no arrastra altas
  ajenas; archivo escrito en LF.
- **Depende de**: T6.2
