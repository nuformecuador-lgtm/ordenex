# Review 118 — Correccion SIMPE -> SINPE (veredicto)

> Reviewer sobre `feature/118-sinpe-correccion` (rama de revision `review-118`).
> Verificacion ejecutada por el reviewer en worktree aislado; no se edito codigo.
> Diff evaluado: `git diff origin/dev...HEAD` (30 archivos, +763/-41).

## Veredicto: **APROBADO**

Sin hallazgos mayores (bloqueantes). Dos observaciones menores, ninguna bloquea.

---

## Checklist del arne (CHECKPOINTS.md)

### Especificacion
- [x] `requirements.md` con R1-R12 en EARS numerados.
- [x] `design.md` con alternativa descartada (ADD VALUE + backfill + RECREATE) y su porque.
- [x] `tasks.md` presente. Todas las tasks T1-T27 (+T26 opcional) ejecutadas segun la bitacora.
      MENOR: las casillas en `tasks.md` siguen escritas `[ ]` (no se re-marcaron a `[x]`), pero la
      evidencia de ejecucion esta completa en `impl_118-sinpe-correccion.md`. Cosmetico; no bloquea.

### Trazabilidad
- [x] Cada R1-R12 mapea a >=1 test real (tabla abajo). Ninguno vacio.
- [x] `impl_118-sinpe-correccion.md` contiene el mapa R<n> -> test.

### Calidad de codigo
- [x] `pnpm run typecheck` — sin errores (tras `db:generate` con el cliente refrescado a SINPE).
- [x] `pnpm run lint` — 0 errores (143 warnings pre-existentes, ninguno de esta feature).
- [x] `pnpm test` — 454 archivos, 4528 tests, 0 fallos (~118 s). Reproducido por el reviewer.
- [x] Flujo critico (recaudo/cierre): cobertura component + integracion; el e2e existente
      `e2e/cierre-dia.spec.ts` cubre el flujo (solo se ajusto un comentario).

### Datos y seguridad
- [x] No aplica RLS: no hay tabla nueva; el cambio es sobre el VALOR de un enum Postgres nativo.
- [x] Migracion nueva versionada y reversible: `migration.sql` (UP) + `down.sql` (DOWN) con
      RENAME VALUE en ambos sentidos. init.sh confirma "todas las migraciones tienen down.sql".
- [x] Sin secretos hardcodeados; sin cambios de contexto/pais/moneda/cuenta.
- [x] No hay webhooks nuevos.

### Patron de capas
- [x] Cambio respeta capas: tipos (`lib/types`), logica (`lib/utils/cierre-totales.ts`),
      presentacion (`app/.../_components`). No se mezclo DB en controllers ni HTTP en services.

### Verificacion final
- [x] init.sh -> "== init OK ==".
- [x] Este `review_118-sinpe-correccion.md` con veredicto OK.

---

## Tabla R -> test (verificada por el reviewer)

| R | Test | Evidencia |
| - | ---- | --------- |
| R1  | `tests/unit/types/metodo-pago.test.ts:10` + `tests/integration/db/metodo-pago-rename-simpe-sinpe-migration.test.ts:41` | seed = {efectivo, SINPE, transferencia} y 1:1 con enum Prisma; UP RENAME. |
| R2  | `.../metodo-pago-rename-simpe-sinpe-migration.test.ts:41-45` | asserta RENAME VALUE SIMPE -> SINPE. |
| R3  | `.../metodo-pago-rename-simpe-sinpe-migration.test.ts:58-62` | asserta RENAME VALUE SINPE -> SIMPE. |
| R4  | `.../metodo-pago-rename-simpe-sinpe-migration.test.ts:47-54` | UP sin UPDATE/ADD VALUE/CREATE/DROP TYPE (RENAME preserva OID; no reescribe filas). Aplicacion contra Postgres real = deuda estatica declarada, patron del repo. |
| R5  | `tests/unit/types/metodo-pago.test.ts` + typecheck verde (satisfies + _EnsureExhaustive). |
| R6  | `tests/components/CierreDiaModule.test.tsx:193` / `CierresAdminModule.test.tsx:492` | getByText(SINPE) en la region. |
| R7  | `tests/unit/utils/cierre-totales.test.ts:47` | input metodoPago SINPE acumula en el carril simpe. |
| R8  | `tests/components/CierreDiaModule.test.tsx:193` / `CierresAdminModule.test.tsx:492` + guard R12 | DOM muestra SINPE, nunca SIMPE. |
| R9  | `cierre-totales.test.ts` (DTO { efectivo, simpe, transferencia, general } intacto) + suite verde con total_simpe/totalSimpe. |
| R10 | `tests/integration/db/gestion-orden-migration.test.ts:51-56` | migracion historica sigue creando literal SIMPE, desacoplada de METODO_PAGO_SEED. |
| R11 | 12 tests actualizados en verde + test nuevo de migracion. |
| R12 | `tests/unit/guards/censo-simpe.test.ts` | censo case-sensitive de SIMPE sobre app/lib/tests/e2e con allowlist de 3 tests que afirman literales. |

---

## Verificacion de alcance / regla negativa (R9/R10)

- [x] NO se renombro la columna total_simpe ni el campo Prisma totalSimpe: persisten en
      `db/schema.prisma`, `db/migrations/20260712100000_cierre_dia`,
      `db/migrations/20260712120000_cierre_bodega` y los 4 repos de cierre. Grep de control confirmado.
- [x] NO se renombro la clave DTO interna simpe (minuscula): 4 usos intactos en
      `lib/utils/cierre-totales.ts`; en la UI el value del TotalItem/columna paso a SINPE pero
      id:simpe y totales.simpe se conservan.
- [x] Migracion historica `20260711150000_gestion_orden_estados_metodo_pago/` intacta:
      `git diff origin/dev...HEAD` no la toca.
- [x] Migracion nueva en carpeta propia con down.sql: UP RENAME VALUE SIMPE->SINPE,
      DOWN RENAME VALUE SINPE->SIMPE (inverso exacto, ambos sentidos).

## Guard de censo R12 (grep de control del reviewer)

Grep case-sensitive de SIMPE sobre app/ lib/ tests/ e2e/ db/. Ocurrencias, todas legitimas:
- Migracion historica `20260711150000/migration.sql` (R10, en db/ — no escaneado por el guard).
- down.sql de la migracion nueva (R3, en db/ — inverso por diseno).
- migration.sql de la migracion nueva (UP): contiene SIMPE de forma inevitable — el
  RENAME VALUE SIMPE->SINPE debe nombrar el valor viejo. Legitimo.
- 3 tests en la allowlist del guard: censo-simpe.test.ts, gestion-orden-migration.test.ts,
  metodo-pago-rename-simpe-sinpe-migration.test.ts (afirman los literales para trazar R10/R2/R3).

No hay ningun SIMPE case-sensitive en codigo de produccion (app/, lib/). El guard escanea
app/lib/tests/e2e (no db/), por lo que las migraciones quedan fuera de alcance por diseno; el
invariante sobre fuente/tests se cumple.

## Calidad (punto 5)

- [x] Sin console.log de datos sensibles introducido por la feature.
- [x] Sin any nuevo; los cambios son sustituciones literales de valor/etiqueta y un switch case.
- [x] Los dos archivos "fuera del censo original" estan justificados y son minimos:
  - `lib/services/CierreBodegaService.ts:79` — solo comentario SIMPE->SINPE. Era el unico SIMPE
    mayuscula restante en lib/; requerido para que el guard R12 pase. NO toca la clave DTO simpe.
    Justificacion correcta.
  - `tests/integration/db/zonas-migration.test.ts:199` — anade la exclusion
    `_metodo_pago_rename_simpe_to_sinpe` al invariante de orden de migraciones, mismo patron que las
    features 99-109 ya apendidas (lineas 191-198). La migracion nueva (ts 20260723120000) es posterior
    a zonas, asi que la exclusion es necesaria y consistente. Justificacion correcta.

---

## Hallazgos

**Mayores (bloqueantes):** ninguno.

**Menores:**
1. `tasks.md` conserva las casillas `[ ]` sin re-marcar a `[x]`, pese a que la bitacora evidencia
   T1-T27 ejecutadas. Cosmetico; CHECKPOINTS pide tasks marcadas, conviene marcarlas al cerrar.
2. R4 (no reescritura de filas contra Postgres real) queda como deuda estatica declarada: el test
   verifica el SQL por regex, no aplica la migracion contra una DB. Es coherente con el patron del repo
   (gestion-orden-migration.test.ts) y con RENAME VALUE (operacion de metadato); aceptable. La
   verificacion UP/DOWN contra DB real (T4) queda registrada como hecha a mano en la bitacora.

## Suite (reproducida por el reviewer)
init.sh -> "== init OK ==" · typecheck 0 errores · lint 0 errores (143 warnings pre-existentes) ·
454 archivos, 4528 tests, 0 fallos (~118 s).
