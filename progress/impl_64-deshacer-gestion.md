# impl_64-deshacer-gestion — BACKEND + FRONTEND

> Alcance de esta bitácora: la feature COMPLETA. Nació como bitácora de la tanda de **backend**
> (R1–R34: datos, negocio, Server Action y tests) y se cerró con la de **frontend** (R35–R38:
> acción por fila en las 4 tablas de `CierreDiaModule`), orquestadas por separado por el leader
> (`backend_dev` → `frontend_dev`), no por el `implementer` monolítico (bug opus-4.8[1m]).
> Gate F1.4 aprobada con las 9 recomendadas, sin overrides.

## Contrato del backend para el frontend (T17/T18) — YA CONSUMIDO

```ts
import { deshacerGestion } from "@/lib/actions/cierre-dia";
const r = await deshacerGestion({ gestionId }); // OBJETO, no string (zod: { gestionId: uuid })
// r: { status:"ok"; ordenId }                 -> toast.success + router.refresh()  (R37)
//  | { status:"conflict"; motivo }            -> toast.error(motivo) ya accionable  (R38)
//  | { status:"forbidden" }                   -> sin motivo (no revela datos ajenos)
//  | { status:"validation_error"; fieldErrors }
//  | { status:"unauthenticated" }
```
El DTO de fila (`CierreDetalleGestion`) ya expone `gestionId`; `mensajeError` del módulo ya
sirve `conflict`/`validation_error`. No hace falta tocar el backend para el frontend.

## Archivos

**Migraciones (nuevas, con `down.sql` OBLIGATORIO ambas):**
- `db/migrations/20260714160000_gestion_orden_anulacion/{migration.sql,down.sql}` — `anulada_at`
  + `anulada_por` + FK (SET NULL) + índice FK + índice **parcial**
  `(mensajero_id) WHERE cierre_id IS NULL AND anulada_at IS NULL` + 12.º valor de enum
  `deshacer_gestion`. Aditiva; NO toca RLS (sin tabla nueva: `gestion_orden` ya tiene RLS
  habilitada sin policies y sigue igual).
- `db/migrations/20260714170000_orden_historial_gestion_fk_restrict/{migration.sql,down.sql}` —
  **F1.4-i**: FK `orden_historial_estado.gestion_orden_id` → `ON DELETE RESTRICT`. Separada de
  T1 a propósito (decisión independiente, reversible por separado).

**Modificados:** `db/schema.prisma` (GestionOrden.anuladaAt/anuladaPor + relación
`GestionAnuladaPor` + contra-relación en Usuario; enum += `deshacer_gestion`;
`OrdenHistorialEstado.gestion` **+ `onDelete: Restrict`**) · `lib/types/orden-historial.ts`
(SEED 12 + `ORIGEN_TIPOS_CON_GESTION`) · `lib/types/cierre.ts` (`deshacerGestionSchema` zod +
`DeshacerGestionResult`) · `lib/interfaces/repositories/ICierreDiaRepository.ts`
(`GestionDeshacerRow`, `AnularGestionInput` + 3 métodos) ·
`lib/interfaces/repositories/IOrdenHistorialRepository.ts` (`contarPorDestino` →
`contarPorDestinoVigentes`) · `lib/interfaces/services/ICierreDiaService.ts`
(`DeshacerGestionServiceResult` + `deshacerGestion`) · `lib/repositories/CierreDiaRepository.ts`
· `lib/repositories/CorteDiarioRepository.ts` · `lib/repositories/OrdenHistorialRepository.ts` ·
`lib/repositories/LiberacionReprogramadaRepository.ts` (defensa, design §3-#6) ·
`lib/services/CierreDiaService.ts` · `lib/services/OrdenHistorialService.ts` ·
`lib/actions/cierre-dia.ts`.

**La exclusión son 3 WHERE (verificados contra el código, no asumidos):**
1. `CierreDiaRepository.findGestionesPendientes` → `{ mensajeroId, cierreId: null, anuladaAt: null }` (R13/R14/R15).
2. `CierreDiaRepository.crearCierre` (~L173, el `updateMany` que **VINCULA**) → **money-critical** (R16).
3. `CorteDiarioRepository.findMensajerosConActividadSinCierre` → `{ cierreId: null, anuladaAt: null }` (R17).

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | `cierre-dia-service.test.ts` → "gestion vigente ... -> ok" |
| R2 | idem → "gestion YA vinculada a un cierre -> conflict" (+ guardia en el WHERE de la tx, `cierre-dia-repository.test.ts` R11) |
| R3 | idem → "gestion YA anulada -> conflict, sin efectos" |
| R4 | idem → "existe una gestion posterior NO anulada -> conflict"; `cierre-dia-repository.test.ts` → `findUltimaGestionNoAnuladaId` |
| R5 | `cierre-dia-service.test.ts` → describe "guardia de estado" (6 casos ok + 5 conflict, uno por resultado) |
| R6 | `cierre-dia-service.test.ts` → "orden borrada -> conflict"; `cierre-dia-repository.test.ts` → propaga `deletedAt` |
| R7 | `cierre-dia-action.test.ts` → "sin sesion -> unauthenticated" (x2: incl. antes de zod) |
| R8 | `cierre-dia-action.test.ts` → "rol != mensajero -> forbidden"; `cierre-dia-service.test.ts` → "sin tocar el repo" |
| R9 | `cierre-dia-service.test.ts` → "gestion de OTRO mensajero -> forbidden" + "INEXISTENTE -> forbidden" |
| R10 | `cierre-dia-action.test.ts` → describe "R10: zod en el borde" (3 tests) |
| R11 | `cierre-dia-repository.test.ts` → "anula con RASTRO"; `gestion-orden-anulacion-migration.test.ts` → columnas + FK |
| R12 | `cierre-dia-repository.test.ts` → "el update NO toca resultado/monto/.../createdAt" |
| R13 | `cierre-dia-service.test.ts` → describe "gestion anulada ausente de la vista"; `cierre-dia-repository.test.ts` → WHERE |
| R14 | `cierre-dia-service.test.ts` → "totales sin la anulada" + "dia vacio" |
| R15 | idem → `totalPagoMensajero`/`totalIngresoBodegaRechazos` sin la anulada + snapshot |
| R16 | **`cierre-dia-repository.test.ts` → describe "R16 — crearCierre NO vincula gestiones anuladas (MONEY-CRITICAL)"** (2 tests) |
| R17 | `corte-diario-repository.test.ts` → WHERE + "mensajero con solo anuladas fuera del corte" |
| R18 | `cierre-dia-repository.test.ts` → `estatusId = en_reparto`; service → `findEstatusIdByValue("en_reparto")` |
| R19 | `cierre-dia-repository.test.ts` → "REPONE la asignacion al mensajero autor" (caso reintento que la limpió) |
| R20 | `cierre-dia-repository.test.ts` → "appendCambioEstado con origen real, destino, actor, enlace y `deshacer_gestion`" |
| R21 | `orden-historial-cobertura.test.ts` → call-site **#12** enumerado (12 puntos, conjunto cerrado) |
| R22 | `cierre-dia-repository.test.ts` → "los 3 pasos en la MISMA $transaction" + 2 tests de `count 0` → `false` sin efectos |
| R23 | `orden-historial-service.test.ts` → "findHistorialByOrden devuelve TODAS las filas"; repo → append-only (solo `createMany`) |
| R24 | `orden-historial-repository.test.ts` → "NO cuenta la de gestion ANULADA"; `orden-historial-service.test.ts` → consume `contarPorDestinoVigentes` |
| R25 | `orden-historial-repository.test.ts` → "la transicion SIN gestion de un ajuste administrativo SI cuenta" |
| R26 | idem → "NO cuenta la HUERFANA" (+ variante `deshacer_gestion`) — la dirección segura del "si no se sabe" |
| R27 | `mis-asignaciones-service.test.ts` → "con 2 devueltas de las cuales 1 ANULADA, la siguiente es REINTENTO" (+ no-regresión del escalado) |
| R28 | `orden-historial-service.test.ts` → "`intentos` de la linea de tiempo es el conteo VIGENTE" |
| R29 | `cierre-dia-repository.test.ts` → "NO toca el puntero `usuario.orden_en_gestion_id`" |
| R30 | `cierre-dia-service.test.ts` → "el mensajero con OTRA orden activa PUEDE deshacer igual" |
| R31 | `mis-asignaciones-service.test.ts` → "una orden devuelta a `en_reparto` por un deshacer es escogible" |
| R32 | `cierre-dia-service.test.ts` → "NUNCA borra la evidencia"; `cierre-dia-repository.test.ts` → `evidenciaStoragePath` intacto |
| R33 | `cierre-dia-service.test.ts` (suite 37 existente, sin regresión) → evidencia solo por URL firmada |
| R34 | `cierre-dia-service.test.ts` → "deshacer una `entregada` no produce movimiento"; `cierre-dia-repository.test.ts` → la tx solo toca 3 modelos |
| R35 | `CierreDiaModule.test.tsx` → `it.each` de las 4 tablas: un botón por fila con `aria-label` que nombra SU orden; tabla vacía sin acción |
| R36 | `CierreDiaModule.test.tsx` → sin confirmar y al cancelar NO se invoca la action; la confirmación nombra la orden y avisa del rastro |
| R37 | `CierreDiaModule.test.tsx` → llama `deshacerGestion({ gestionId })` con el id de ESA fila + toast de éxito + `router.refresh()` |
| R38 | `CierreDiaModule.test.tsx` → `conflict` muestra el `motivo` del server tal cual, fila y totales intactos, `refresh` NO invocado; + `forbidden` / `validation_error` / `unauthenticated` |

## Verificación ejecutable (datos reales, no promesas)

**Round-trip REAL de la migración contra Postgres local (`localhost:5432/ordenex`):**
`migrate deploy` → leer → `down.sql` de ambas → leer → `migrate deploy` otra vez. Lo leído:

| Sonda | ANTES | tras UP | tras DOWN | tras re-UP |
| --- | --- | --- | --- | --- |
| columnas `anulada_at`/`anulada_por` | `[]` | ambas, `is_nullable=YES` | `[]` | ambas |
| enum `orden_historial_origen_tipo` | 11 valores | **12** (`…,ajuste_estado,deshacer_gestion`) | 11 | 12 |
| índice parcial | `[]` | `… (mensajero_id) WHERE ((cierre_id IS NULL) AND (anulada_at IS NULL))` | `[]` | presente |
| FK `gestion_orden_anulada_por_fkey` | `[]` | `confdeltype='n'` (SET NULL) | `[]` | `'n'` |
| FK `…gestion_orden_id_fkey` (F1.4-i) | `confdeltype='n'` | **`'r'` (RESTRICT)** | `'n'` | `'r'` |
| RLS `gestion_orden` | `relrowsecurity=true, policies=0` | igual | igual | igual |

El estado tras el DOWN es **idéntico al ANTES** en las 6 sondas. `prisma migrate status` →
"Database schema is up to date" (47 migraciones).
*Nota:* `pnpm run db:rollback` solo revierte la carpeta **última por nombre**, así que el
`down.sql` de `_gestion_orden_anulacion` se aplicó con `prisma db execute` (mismo SQL que
correría el script). Es una limitación conocida de `scripts/db-rollback.ts`, no de la migración.

**Comportamiento vivo contra Postgres** (fixtures reales dentro de una tx con `ROLLBACK`;
residuo verificado 0/0/0):
- **F1.4-i funciona:** `DELETE` de una gestión enlazada al historial → **BLOQUEADO** por
  `orden_historial_estado_gestion_orden_id_fkey (23001)`. Antes vaciaba el enlace en silencio.
- `origen_tipo='deshacer_gestion'` se escribe y queda enlazado (`enlazada=true`).
- Predicado del contador sobre datos reales: intentos vigentes **antes=2 → después=0** al
  poner `anulada_at`, **sin tocar una sola fila del historial** (`filas_historial=2` antes y después).
- Rastro conservado: `{resultado:"devuelta", motivo:"ausente", anulada:true, la_deshizo_el_actor:true}`.

**Suite:**
- `npx prisma validate --schema db/schema.prisma` → **"The schema at db\schema.prisma is valid 🚀"**
- `pnpm typecheck 2>&1 | grep -c "error TS"` → **2** = baseline exacto. Son
  `TarifaVigentePorZonaRepository.ts(22,16)` y `scripts/seed-zonas.ts(257,71)`, bugs REALES
  preexistentes de la feature 65 **aparcados a propósito por el humano**: no se tocaron.
  **0 errores nuevos.**
- `pnpm lint` → **0 errores**, 138 warnings (todos preexistentes, ninguno en archivos de esta feature).
- `pnpm test` → **296 archivos / 2748 tests, 0 fallos** (baseline 2652 → **+96 tests nuevos**).

**3 tests ajenos rompieron y era la señal esperada, no daño colateral:**
`orden-historial-types.test.ts` (11→12 valores del enum: el chequeo de exhaustividad
funcionando, T4) · `orden-historial-cobertura.test.ts` (11→12 call-sites, T20) ·
`zonas-migration.test.ts` (lista las migraciones apendidas después: se añadieron las 2 nuevas).

## Veredicto

Backend completo y verde: la gestión anulada queda fuera de los **3** WHERE (incluido el
`updateMany` de `crearCierre`, que era el punto donde la wallet la habría cobrado), el deshacer
pasa por `appendCambioEstado` en su misma tx, el contador de intentos excluye anulados y
huérfanas por lectura sin tocar el historial, y F1.4-i quedó blindada en modelo + SQL.
Falta solo el frontend (T17/T18/T21 → R35–R38) sobre el contrato de arriba.

---

## Tanda 2 — FRONTEND (R35–R38, T17/T18/T21)

**Archivos:** `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` (columna "Acciones" en las 4
tablas + Modal de confirmación + `deshacerGestion({ gestionId })` + `router.refresh()`;
`mensajeError` ganó un `fallback` por operación) · `tests/components/CierreDiaModule.test.tsx`
(16 → **32** tests) · `e2e/cierre-dia.spec.ts` (T21: `describe` del deshacer).

**Decisión de UI — no existe "fila no deshacible", y no se inventó una.** `findGestionesPendientes`
ya filtra `cierre_id IS NULL AND anulada_at IS NULL`, y `/cierre-dia` es exclusivo del mensajero
dueño (`page.tsx` → `notFound()`): **toda fila renderizada está dentro de la ventana y es suya**.
Al salir de la ventana la fila **desaparece**, en vez de quedarse deshabilitada prometiendo algo que
el server rechazaría. Una carrera la corta el server con `conflict` + su `motivo`, que la UI muestra
tal cual (no hay copy propio para ese caso). El `disabled` es solo transitorio (`deshaciendo`),
acotado a SU fila, entre el `ok` y el refresh.

**Corrección de rumbo del frontend (registrada, no tapada):** el brief del leader afirmaba que el
DTO exponía `anuladaAt`. **Es falso**: `CierreDetalleGestion` no lo lleva (sí `GestionDeshacerRow`,
del repo). No hizo falta: las anuladas se filtran server-side (R13) → **no se cambió el contrato**.
El leader repitió esa afirmación del backend sin verificarla; el frontend la cazó en vez de tragársela.

**`tasks.md` apuntaba a `tests/unit/components/cierre-dia-module.test.tsx`, que NO existe** → se
extendió la suite real `tests/components/CierreDiaModule.test.tsx` en lugar de crear un duplicado, y
se corrigieron las filas R35–R38 de la tabla de trazabilidad. El reviewer lo validó.

**T21 (E2E): ESCRITO, NO EJECUTADO.** Deuda estándar del repo: los E2E exigen dev server + DB
sembrada + harness de login por rol, que no existe. No es algo que esta feature pueda cerrar sola.

## Verificación FINAL de la feature completa (medida por el leader y re-medida por el reviewer)

| Check | Resultado |
|---|---|
| `pnpm test` | **296 archivos / 2764 tests / 0 fallos** (con `--testTimeout=20000`) |
| `pnpm typecheck` | **2 errores = baseline EXACTO**, 0 nuevos |
| `pnpm lint` | **0 errores** (138 warnings preexistentes, ninguno en archivos de la 64) |
| `prisma migrate status` | 47 migraciones OK · `migrate diff` → **"No difference detected"** (sin drift) |
| Round-trip de las 2 migraciones | REAL contra Postgres vivo. El reviewer lo repitió por su cuenta en una tx con `ROLLBACK`: ambos `down.sql` corren limpio y devuelven el esquema exacto (enum 11, 0 columnas, 0 índice, FK `'n'`). Estado vivo: enum **12**, FK `confdeltype='r'` (**RESTRICT**), RLS `gestion_orden` true / 0 policies |

**Los 2 errores de typecheck NO son de esta feature**: son `TarifaVigentePorZonaRepository.ts:22` y
`scripts/seed-zonas.ts:257`, bugs REALES preexistentes registrados como **feature 65** y aparcados a
propósito por el humano. Por ellos `./init.sh` corta en rojo en typecheck (el gate se volvió honesto
hoy, PR #67) sin llegar a los tests → la verificación de la 64 se hizo con `pnpm test`/`typecheck`
directos, y así se reporta, sin apoyarse en un gate que hoy no llega.

**Flake ambiental ajeno:** `tests/components/HomePage.test.tsx` tarda ~5043ms contra el límite
default de 5000ms → cae o pasa según la carga. Verificado por el leader: pasa con
`--testTimeout=20000`, y ni la home ni sus dependencias fueron tocadas por la 64. Es deuda del repo
(un test parado justo en el borde del timeout va a flakear para siempre), no un fallo de la feature.
