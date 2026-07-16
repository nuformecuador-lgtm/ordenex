# Implementación 76 — Ranking DIARIO de mensajeros + tabla de premios (BACKEND)

> Zona: backend (controllers/services/repositories/migraciones/RLS/Server Actions/tests).
> Frontend (T8-T10: página, RankingModule, menu-visibility) queda para el frontend_dev.
> **Cambio de alcance (2026-07-16):** la tabla de premios lleva además un campo
> `descripcion` (texto libre opcional por posición, INDEPENDIENTE del monto). Incorporado.

## Baseline medido (antes de tocar nada, en el worktree `feature/76`, dev @ a014515)

- `typecheck`: **0 errores**.
- `lint`: **0 errores**, 139 warnings preexistentes.
- `test`: **2921 passed, 1 failed** — la falla es `tests/unit/guards/no-embalaje.test.ts`
  (timeout 5000ms de un walk del filesystem), flaky documentado bajo carga; NO es regresión.

## Estado final

- `typecheck`: **0 errores**.
- `lint`: **0 errores**, 139 warnings (mismos que baseline; no introduje warnings nuevos).
- `test` (corrida final completa): **312 files, 2963 passed, 0 failed**.
  - Durante la iteración vi timeouts flaky esporádicos en tests de componente
    (`HomePage.test.tsx`, `OrdenesModuleReuse.test.tsx`) bajo carga: pasan en aislamiento y
    NO los toqué (son frontend). La corrida final los dio verdes.

## Migraciones — validadas ESTÁTICAMENTE (no aplicadas: no hay Postgres en el entorno)

No hay `DATABASE_URL`/Postgres local, así que NO afirmo "migración aplicada". Verificación:

- `prisma validate` → schema válido.
- `prisma migrate diff --from-empty --to-schema db/schema.prisma --script` confirma que el DDL
  que Prisma espera coincide EXACTO con mis `migration.sql`:
  - `"asignado_at" TIMESTAMP(3)` en `orden`.
  - índice `orden_mensajero_asignado_id_asignado_at_idx ON "orden"("mensajero_asignado_id","asignado_at")`.
  - tabla `premio_ranking(id TEXT, posicion INTEGER, monto DECIMAL(12,2), descripcion TEXT,
    created_at, updated_at, PK premio_ranking_pkey)` + índice único `premio_ranking_posicion_key`.
  - Mis migraciones añaden encima (Prisma no lo expresa, patrón del repo): `CHECK (posicion
    BETWEEN 1 AND 3)`, INSERT de 3 filas seed (monto/descripcion NULL), `ENABLE ROW LEVEL SECURITY`.
- Round-trip up/down: cada carpeta tiene `down.sql` que revierte exactamente
  (`DROP INDEX`+`DROP COLUMN` / `DROP TABLE`).
- Guard de orden de migraciones (`tests/integration/db/zonas-migration.test.ts`) actualizado con
  las 2 nuevas carpetas en la whitelist "apendidas después" (patrón de mantenimiento).

## Archivos creados

- `db/migrations/20260716120000_orden_asignado_at/{migration.sql,down.sql}` (T0a, R24)
- `db/migrations/20260716130000_premio_ranking/{migration.sql,down.sql}` (T2, R8/R21; incl. `descripcion`)
- `lib/config/ranking.ts` (T1, R7/R22)
- `lib/types/ranking.ts` (DTOs; incl. `descripcion`)
- `lib/interfaces/repositories/IRankingRepository.ts` (T4)
- `lib/interfaces/repositories/IPremioRankingRepository.ts` (T4; `upsertPremio` + `UpsertPremioInput`)
- `lib/interfaces/services/IRankingService.ts` (T4)
- `lib/repositories/RankingRepository.ts` (T3, R1)
- `lib/repositories/PremioRankingRepository.ts` (T5, R8/R9/R10; monto+descripcion)
- `lib/services/RankingService.ts` (T6)
- `lib/actions/ranking.ts` (T7, R10/R11/R12/R18/R19; zod con `descripcion`)
- Tests: `tests/unit/config/ranking.test.ts`, `tests/unit/repositories/ranking-repository.test.ts`,
  `tests/unit/repositories/premio-ranking-repository.test.ts`,
  `tests/unit/services/ranking-service.test.ts`, `tests/unit/actions/ranking-actions.test.ts`

## Archivos modificados

- `db/schema.prisma`: `Orden.asignadoAt DateTime? @map("asignado_at")` + `@@index([mensajeroAsignadoId, asignadoAt])`;
  nuevo `model PremioRanking` (monto + descripcion, ambos nullable).
- Writers/limpieza (choke-point R23 / LC1) — ver lista abajo.
- Tests ajenos cuyas aserciones de forma EXACTA cambiaron por el estampado (no aflojados,
  reflejan la nueva conducta R23/LC1): `orden-repository.guia.test.ts`,
  `orden-repository.asignacion-satelite.test.ts`, `cierre-dia-repository.test.ts`,
  `gestion-orden-repository.test.ts`, `liberacion-reprogramada-repository.test.ts`,
  `zonas-migration.test.ts` (whitelist).

## CONFIRMACIÓN — enumeración exhaustiva de writers de `mensajero_asignado_id` (R23)

Grep `mensajeroAsignadoId|mensajero_asignado_id` en TODO el repo (no solo design). Los ÚNICOS
puntos que ESCRIBEN la columna en un `data:`/SQL `SET` (los demás son reads/where/relaciones):

Writers NO-NULO (estampan `asignado_at = now`) — **4/4 instrumentados**:
- **W1** `lib/repositories/OrdenRepository.ts:835` `generarGuiaLote` — condicional: estampa solo
  si `mensajeroAsignadoId != null` (el ruteo sin mensajero deja NULL). [design decía :899-901]
- **W2** `lib/repositories/OrdenRepository.ts:877` `asignarBodegaLote` — siempre. [design :941-943]
- **W3** `lib/repositories/OrdenRepository.ts:~1124` `asignarSateliteLote` (raw SQL) — añadí
  `"asignado_at" = NOW()` al SET. [design :1251-1253]
- **W4** `lib/repositories/CierreDiaRepository.ts:483` deshacer-gestión repone — siempre. [design :481-483]

Paths de limpieza (ponen `asignado_at = NULL`, defensivo LC1) — **3/3**:
- **C1** `lib/repositories/GestionOrdenRepository.ts:271` (`limpiaMensajero`). [design :284]
- **C2** `lib/repositories/OrdenRepository.ts:923` `rutearBodegaSateliteLote`. [design :989]
- **C3** `lib/repositories/LiberacionReprogramadaRepository.ts:87` handoff a bodega. [design :87]

Descartados como writers: `CierreDiaRepository.ts:207` (es un `count` where), `GuiaAsignacionService`
(solo construye el `GenerarGuiaDecisionData` que consume W1; no toca la DB). NINGÚN writer quedó
sin instrumentar. `OrdenService`/carga-masiva NO setean `mensajero_asignado_id` en el create.

## Mapa R → test (backend: R1-R12, R16, R19, R21-R24)

| R   | Test |
| --- | ---- |
| R1  | `ranking-repository.test.ts` — contar entregadas (entregada+vigente+rango) y asignadas (asignadoAt∈rango, no-null) |
| R2  | `ranking-service.test.ts` "pct = entregadas/asignadas *100 a 1 decimal STRING" |
| R3  | `ranking-service.test.ts` "0/0 -> pct null y al final; sin posicion de podio" |
| R4  | `ranking-service.test.ts` "ordena desc por pct" |
| R5  | `ranking-service.test.ts` "desempata por # entregas desc" y "por nombre asc (estable)" |
| R6  | `ranking-service.test.ts` (toMatchObject entregadasHoy/asignadasHoy en las filas) |
| R7  | `ranking-service.test.ts` "asignadas < umbral -> fuera del podio"; `config/ranking.test.ts` default 1 |
| R8  | `premio-ranking-repository.test.ts` "lista las 3 posiciones"; migración UNIQUE(posicion)+CHECK |
| R9  | `ranking-service.test.ts` "premio null, no '0'"; `premio-ranking-repository.test.ts` (monto null preservado) |
| R10 | `ranking-actions.test.ts` "maestro guarda/vacía"; `premio-ranking-repository.test.ts` upsertPremio |
| R11 | `ranking-service.test.ts` (monto/posición inválidos → invalid) + `ranking-actions.test.ts` (zod en el borde) |
| R12 | `ranking-service.test.ts` (premios/pct STRING) + `ranking-actions.test.ts` (resultado serializado) |
| R16 | `ranking-service.test.ts` "maestro -> esEditable true" |
| R17 | `ranking-service.test.ts` "mensajero -> esEditable false (solo-lectura)" |
| R18 | `ranking-service.test.ts` "otro rol -> forbidden sin datos" + `ranking-actions.test.ts` "sin sesión -> unauthenticated" |
| R19 | `ranking-service.test.ts` "mensajero editando -> forbidden sin persistir" + `ranking-actions.test.ts` |
| R21 | migración `premio_ranking` (RLS + down.sql) — validada estáticamente; guard de orden verde |
| R22 | `ranking-service.test.ts` "rango del día por helper CR"; `config/ranking.test.ts` (umbral por env) |
| R23 | W1/W2 `orden-repository.guia.test.ts`; W3 `orden-repository.asignacion-satelite.test.ts`; W4 `cierre-dia-repository.test.ts` |
| R24 | migración `orden_asignado_at` (columna nullable + down.sql) — `prisma migrate diff` confirma; guard verde |
| LC1 | `ranking-service.test.ts` "devolución intradía no cuenta en num ni denom"; C1 `gestion-orden-repository.test.ts`, C2 `orden-repository.guia.test.ts`, C3 `liberacion-reprogramada-repository.test.ts` |

Nota: R13-R15, R17(UI), R20 son frontend (T8-T10). El campo `descripcion` (cambio de alcance)
está en schema/migración/repo/interfaz/service/action y cubierto por tests de repo/service/action;
el contrato I/O de `premios` ahora es `{ posicion, monto: string|null, descripcion: string|null }`.

## Veredicto

Backend de la 76 completo (T0a-T7 + `descripcion`): typecheck 0, lint 0 errores, 2963 tests
verdes; migraciones validadas estáticamente (no aplicadas por falta de DB) con up/down; 4/4
writers de asignación instrumentados (R23) + 3/3 limpiezas (LC1); ninguno sin estampar.

---

# Implementación 76 — FRONTEND (T8-T10)

> Zona: frontend (página, módulo cliente, menú). Consume el backend commiteado en `0388bde`
> SIN tocarlo. Contrato verificado leyendo `lib/actions/ranking.ts`,
> `lib/interfaces/services/IRankingService.ts` y `lib/types/ranking.ts` (no supuesto).

## Estado de partida (drift respecto al design §1)

El design §1 asumía un stub `app/(app)/ranking/page.tsx` y un ítem `/ranking` con
`iconKey:trophy` ya presentes en `menu-visibility.ts:89-95`. En este worktree NINGUNO existía
(la rama salió de un dev anterior). Por eso: la página se CREA (no reemplaza) y el ítem de menú
se AÑADE (no solo "conserva"), respetando `roles:["maestro","mensajero"]` y el comentario
corregido (R20). Añadí también el `iconKey:"trophy"` al tipo `IconKey` y su mapeo en el Sidebar.

## Archivos creados

- `app/(app)/ranking/page.tsx` (T8, R12/R16/R17/R18) — Server Component role-aware; permite
  maestro+mensajero, resto/sin sesión → `notFound`; prefetch `obtenerRankingAction()`,
  `status!=="ok"` → `notFound` (defensa en profundidad).
- `app/(app)/ranking/_components/RankingModule.tsx` (T9, R13/R6/R14/R15) — tabla del ranking
  (posición, nombre, % del día, conteo crudo entregadas/asignadas; orden del servidor
  respetado) + tabla de premios asociando premio↔ocupante elegible del podio (sin inventar
  ocupante).
- `app/(app)/ranking/_components/PremioInputRow.tsx` (T9, R9/R16/R17/R25) — fila por posición
  con DOS inputs abiertos (monto + descripción) si `esEditable`; on-save →
  `editarPremioAction` (Server Action, no fetch a /api); vaciar → null; feedback de error por
  toast (`invalid`/`forbidden`/`unauthenticated`). Mensajero: solo-lectura.
- `app/(app)/ranking/_components/ranking-labels.ts` — etiquetas i18n-ready + helpers `money`/
  `porcentaje`/`conteoCrudo` (money-safe: STRING tal cual, sin parseFloat/Number).
- `tests/components/RankingModule.test.tsx`, `tests/components/RankingPage.test.tsx`.

## Archivos modificados

- `lib/auth/menu-visibility.ts` (T10, R20) — `IconKey` += `"trophy"`; nuevo ítem `/ranking`
  `roles:["maestro","mensajero"]` con comentario que documenta que la visibilidad
  maestro+mensajero es INTENCIONAL (maestro edita, mensajero solo-lectura).
- `app/(app)/_components/Sidebar.tsx` — import `Trophy` de lucide + mapeo `trophy: Trophy`
  en `ICON_BY_KEY` (necesario para que el nuevo `iconKey` renderice).
- `tests/unit/auth/menu-visibility.test.ts` — actualizado (no aflojado) para reflejar el ítem
  "Ranking" intencional: `puedeVer` maestro/mensajero true y admin/adminTienda/adminSatelite
  false; listas `itemsVisibles` de maestro y mensajero incluyen "Ranking".

## Mapa R → test (frontend)

| R   | Test |
| --- | ---- |
| R9  | `RankingModule.test.tsx` "monto vacío → 'Sin premio asignado', nunca cero" + "vaciar → null" |
| R13 | `RankingModule.test.tsx` "tabla ordenada con posición/nombre/%/conteo crudo" |
| R14 | `RankingModule.test.tsx` "premio (monto+descripción) asociado al ocupante elegible" |
| R15 | `RankingModule.test.tsx` "posición sin ocupante NO inventa mensajero" |
| R16 | `RankingModule.test.tsx` "esEditable → inputs monto/descripción + guardar"; `RankingPage.test.tsx` "maestro ve inputs" |
| R17 | `RankingModule.test.tsx` "sin esEditable no hay inputs"; `RankingPage.test.tsx` "mensajero solo-lectura" |
| R18 | `RankingPage.test.tsx` "otros roles / sin sesión → notFound sin consultar datos" + "action no-ok → notFound" |
| R20 | `menu-visibility.test.ts` (maestro+mensajero ven "Ranking"; otros no; listas por rol) |
| R25 | `RankingModule.test.tsx` "descripción vacía → 'Sin descripción'; con texto tal cual" + "guardar envía descripción" |
| R10 | `RankingModule.test.tsx` "guardar envía monto+descripción a editarPremioAction y refresca" |
| R11 | `RankingModule.test.tsx` "action `invalid` → toast de error, sin refrescar" |

## Verificación (tras el cambio frontend)

- `typecheck`: **0 errores**.
- `lint`: **0 errores**, **139 warnings** (mismos del baseline; ninguno nuevo en mis archivos).
- `test` (suite completa): **314 files, 2978 passed, 1 failed**. La única falla es
  `tests/components/LoginForm.test.tsx` por **timeout 5000ms bajo carga** (ajeno, misma clase
  que el flaky `no-embalaje`): pasa **26/26 en aislamiento** → NO es regresión. Tests nuevos
  del frontend: 11 (`RankingModule`) + 5 (`RankingPage`) = 16 verdes.

## Veredicto frontend

Frontend de la 76 (T8-T10) completo: página role-aware + módulo (tabla ranking + inputs
monto/descripción por posición) + ítem de menú maestro+mensajero. typecheck 0, lint 0 errores,
2978/2979 (la falla es un timeout flaky ajeno de LoginForm, verde en aislamiento). Backend NO
tocado; contrato consumido tal cual.

## Merge con dev (PR #80)

### Qué trajo dev
El merge de `origin/dev` (PR #80 = merge de `flow`, commit `349fbab` "reglas de cierre en
asignación") es el SUPERSET de `OrdenRepository.ts`: reescribió partes del repo para meter las
reglas de cierre en la asignación satélite (guardia anti-TOCTOU `NOT EXISTS` sobre `cierre_dia`
en estado `solicitado`/`vencido` dentro del mismo UPDATE de `asignarSateliteLote`, y el helper
`existeBodegaSateliteBloqueada` con bloqueo duro sólo si TODOS los mensajeros de la zona tienen
cierre abierto). Esas reglas de cierre son GUARDIAS, no writers nuevos de `mensajero_asignado_id`.

### Estrategia de resolución (base = dev, re-aplicar delta 76)
`OrdenRepository.ts` estaba en conflicto de archivo completo. Se tomó la versión de `dev` íntegra
(`git checkout --theirs`) para conservar las reglas de cierre, y sobre ella se re-aplicó SÓLO el
delta de instrumentación de `asignado_at` de la feature 76 (choke-point R23). Los otros 4 archivos
en conflicto (frontend) los resolvió el leader y no se tocaron.

### Lista FINAL de writers de asignación instrumentados (post-merge)
Se hizo `grep mensajeroAsignadoId/mensajero_asignado_id` sobre el archivo ya resuelto. Sitios que
ESCRIBEN el mensajero (los demás hits son mappers de lectura o filtros `where`):

- W1 `generarGuiaLote` (`tx.orden.update`): estampa `asignadoAt: new Date()` SÓLO si
  `d.mensajeroAsignadoId != null` (condicional; la decisión puede no llevar mensajero). ✔ instrumentado
- W2 `asignarBodegaLote` (`tx.orden.updateMany`, valor no nulo): `asignadoAt: new Date()`. ✔ instrumentado
- W3 `asignarSateliteLote` (raw `$queryRaw` UPDATE, valor no nulo): `"asignado_at" = NOW()` en el SET. ✔ instrumentado
- C2 `rutearBodegaSateliteLote` (limpieza, `mensajeroAsignadoId: null`): `asignadoAt: null`. ✔ instrumentado (invariante asignado_at<->mensajero)

Confirmación del choke-point: dev NO introdujo ningún writer de asignación nuevo en este archivo
(sus reglas de cierre son guardias, no asignan mensajero). Ningún writer de asignación quedó sin
estampar `asignado_at`; ningún writer de limpieza quedó sin poner `asignado_at = null`.

### Verificación medida
- `pnpm run typecheck`: 0 errores.
- `pnpm run lint`: 0 errores (140 warnings preexistentes).
- Scope backend (repositories + services de asignación): 44 files / 494 tests, todos verdes.
- Suite completa: 15 fallos / 3056 verdes. Los 15 fallos son regresiones REALES de INTEGRACIÓN
  de FRONTEND traídas por el merge de dev, NINGUNA en OrdenRepository ni en ranking (ninguno de los
  test files fallidos importa OrdenRepository; reproducen en aislado, no son flaky):
  - `tests/unit/auth/menu-visibility.test.ts` (x2) y componentes que dependen del menú/estatus:
    dev añadió el ítem de menú "Novedades" y un estatus de seed nuevo; la resolución frontend del
    leader dejó "Novedades" comentado en `lib/auth/menu-visibility.ts` (líneas 81-84) y "Ranking"
    visible para `mensajero`, mientras que los tests (versión dev) esperan "Novedades". Es un
    conflicto SEMÁNTICO (falta la unión Ranking+Novedades / mapa de estatus), en los 4 archivos
    frontend que el leader resolvió (fuera del scope de este agente backend).
  - `EstatusLabel`, `HomePage/HomePageRol`, `AppLayout`, `CierreDiaModule`,
    `HistorialOrdenTimeline`, `MisAsignacionesModule`, `OrdenesEstatusLabelAdminTienda`,
    `RecepcionSateliteModule`: mismo origen (menú/estatus/"Devolver a la tienda" de dev no
    integrados en el source resuelto).

### Estado del merge
OrdenRepository resuelto y staged (0 marcadores de conflicto, 0 archivos unmerged). El merge NO se
cerró con `git commit`: la suite no está verde por las 15 regresiones de integración de FRONTEND,
que están fuera del scope backend y en los archivos que el leader resolvió. Requiere que el owner
de frontend integre la unión menú (Ranking+Novedades) + mapa de estatus + feature "Devolver a la
tienda" antes de cerrar el merge commit.

## Cierre del merge (frontend) — origin/dev (PR #80) @ d4b6e48

Merge de `origin/dev` en `feature/76`. Backend (`OrdenRepository.ts`) y 4 archivos
frontend ya resueltos por el leader. Tras el merge la suite completa tenía fallos
REALES de integración frontend (reproducen en aislado). Diagnóstico y arreglo:

### Fallos y causa raíz (todos integrados SIN aflojar tests)

1. **`estatus-label.ts` + `EstatusBadge.tsx` — `devuelta_origen`** (rompía
   `EstatusLabel.test`, `OrdenesEstatusLabelAdminTienda.test`, `HistorialOrdenTimeline.test`).
   Causa: dev renombró el label `devuelta_origen` de "Devuelta a origen" → "En ruta a
   origen" en el CÓDIGO, pero NINGÚN test (ni de dev) lo acompañó; base/ours/todos los
   tests exigen "Devuelta a origen". El auto-merge tomó el cambio de dev (único lado que
   tocó la línea). Integración: revertí ambos mapas a "Devuelta a origen" (coherente con
   la semántica `origen`=tienda y con todos los tests).

2. **Menú (`menu-visibility.ts`) — Novedades vs Ranking** (rompía 2 tests de
   `menu-visibility.test`). Causa: la resolución dejó "Novedades" (item de dev) COMENTADO
   y conservó "Ranking" (nuestro, R20). El test resuelto es la unión y esperaba AMBOS.
   Integración: descomenté "Novedades" (roles adminTienda+mensajero) conservando "Ranking"
   (roles maestro+mensajero, R20). Actualicé el test del mensajero para reflejar la unión
   REAL (Entregas, Novedades, **Ranking**, Cierre del día, QR, Perfil) — ampliar, no aflojar.

3. **`AppLayout.test` — adminSatelite** (1 test). Causa: dev renombró deliberadamente el
   portal del adminSatelite "Asignaciones" → "Órdenes" (actualizó `menu-visibility.test` y
   `Sidebar.test`, que ya documentan los DOS ítems "Órdenes" por href), pero dejó stale el
   assert de `AppLayout.test` (`queryByRole link "Órdenes" → null`). Integración: actualicé
   ese assert para chequear por `href` (adminSatelite NO ve `/ordenes` pero SÍ su portal
   `/recepcion-satelite`) — conserva el intento del test (filtrado por rol), no lo afloja.

4. **`RecepcionSateliteModule.tsx` — "Devolver a la tienda"** (4 tests). Causa: dev
   renombró en el módulo la sección/botón "Por devolver a tienda"/"Devolver a la tienda" →
   "…bodega central", sin tocar los tests (todos los tests de UI —RecepcionSateliteModule,
   OrdenesRevisionMaestro, ordenes-module, DevolverATiendaModal— exigen "…tienda"; los
   "bodega central" en tests son solo comentarios de dominio). Integración: revertí el
   heading, el `aria-label` y el texto del botón a "…tienda".

5. **`GestionarOrdenPanel.tsx` — evidencia DUPLICADA** (2 tests de `MisAsignacionesModule`).
   Causa: la rama `resultado === "devuelta"` de dev tenía el campo "Foto de evidencia de la
   devolución" DUPLICADO (ours estaba limpio). Integración: eliminé el bloque repetido; la
   rama queda CausaField → evidencia → MotivoField (como ours).

6. **`CierreDiaModule.tsx` — columna `ingresoBodegaRechazos` del histórico** (1 test de
   `CierreDiaModule`, feature 56/R12). Causa: `COLUMNAS_PASADOS` de dev perdió la columna
   que ours tenía. Integración: restauré la columna (`INGRESO_BODEGA_RECHAZOS_COL` ya
   existía en el módulo).

No toqué `OrdenRepository.ts` ni `app/(app)/ranking/page.tsx` ni migraciones/db.

### Números finales (medidos en este worktree)
- `typecheck`: **0 errores**.
- `lint`: **0 errores** (140 warnings preexistentes).
- `pnpm test`: **3069 passed / 2 failed** en la corrida completa; los 2 (`HomePage`,
  `zona-form`) PASAN en aislado → flaky por timeout bajo carga (documentado). Los 12
  archivos que arreglé PASAN en aislado (108+ asserts verdes).

Ningún fallo resultó ser una regresión que no supiera integrar.
