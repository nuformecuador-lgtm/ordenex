# Feature 153 — `order_status`: `en_ruta` → `en_reparto` · bitácora de implementación

> Rol: BACKEND_DEV · Rama: `feature/153-order-status-en-reparto` · Worktree aislado
> `R:\job\singularis\projects\ordenex-wt-153` · Fecha: 2026-07-28.
> Spec: `specs/153-order-status-en-reparto/` (R1–R21). Rename **mecánico**: cero cambio de
> flujo, mismas aristas, mismos `id`, mismas FKs.

## 1. Qué se hizo

Rename del `value` de catálogo `en_ruta` → `en_reparto` y de su etiqueta UI a **"En reparto"**,
con **frontera de palabra** en todo el barrido, de modo que `en_ruta_bodega_central` y
`en_ruta_bodega_satelite` (value **y** label) quedaron intactos.

El punto delicado, y la razón de que el gate lo marcara: **`en_reparto` es el nombre VIEJO**.
La feature 135 lo renombró *a* `en_ruta` el 2026-07-24 y dejó
`tests/unit/guards/censo-order-status-rename.test.ts` prohibiendo que reapareciera. Se hizo el
**SWAP** que pedía R15: sale `en_reparto` de `OLD_VALUES`, entra `en_ruta`; siguen siendo 6
entradas y sigue habiendo **un solo** guard.

### Decisiones del gate aplicadas (no reabiertas)

- Contrato externo roto **sin** bumpear `info.version` ni changelog (misma política que la 135).
- **No** se drena la cola de `webhook_estado`: el payload guarda `estatusDestinoId` (un id), el
  emisor resuelve el value al entregar, así que un job encolado antes del deploy sale con
  `en_reparto`. Es correcto y está cubierto por R14.
- Barrido **completo**: literales, comentarios y nombres de test.
- `tests/components/OrdenesPage.test.tsx:122` pasaba la ETIQUETA donde va un `value`
  (`estatusValue: "En ruta"`): corregido a un value real (`en_reparto`).
- `db/schema.prisma:356`: corregido el conteo desactualizado (decía 15, hoy son 18).

## 2. Archivos

### Creados (4)

| Archivo | Qué es |
|---|---|
| `db/migrations/20260728120000_order_status_en_reparto/migration.sql` | UP: **un** `UPDATE "order_status" SET "value" = 'en_reparto' WHERE "value" = 'en_ruta';` (R2) |
| `db/migrations/20260728120000_order_status_en_reparto/down.sql` | DOWN: el inverso exacto (R3) |
| `tests/integration/db/order-status-en-reparto-migration.test.ts` | Test de la migración nueva: parseo del SQL, round-trip UP→DOWN, FKs por id (R2/R3/R4/R5/R18) |
| `tests/components/EstatusBadgeEnReparto.test.tsx` | Cobertura que **faltaba** para R9/R10/R11 (variante + acento de marca del chip) |
| `tests/unit/api/openapi-contrato-en-reparto.test.ts` | Cobertura que **faltaba** para R13 (enum OpenAPI TS ↔ `.yaml` espejo + `EVENTOS_PUBLICOS`) |

(Cinco archivos: 2 SQL + 3 tests. Los dos últimos no estaban en el plan; se añadieron porque
R10 y R13 no tenían **ningún** test que los verificara.)

### Modificados (85)

- **77 archivos** cuyo diff contra `origin/dev` es **exclusivamente** el rename mecánico
  (verificado programáticamente: normalizando `en_reparto`→`en_ruta` el archivo queda idéntico
  byte a byte al de `dev`). Incluye los 14 de lógica (services/repositories/actions/interfaces),
  los 5 de e2e (solo comentarios), los fixtures y ~50 suites de test.
- **8 archivos con cambio adicional justificado:**

| Archivo | Cambio extra |
|---|---|
| `lib/types/order-status.ts` | `ORDER_STATUS_SEED[10]` + bloque de comentario de la feature 153 |
| `app/(app)/ordenes/_components/EstatusBadge.tsx` | label `"En reparto"`; `ORDER_STATUS_VARIANT` (`secondary`) y `ORDER_STATUS_CLASS` (4 tokens de marca) preservados byte a byte |
| `tests/components/EstatusLabel.test.ts` | label esperado `"En reparto"` |
| `tests/components/OrdenesPage.test.tsx` | fixture: la etiqueta pasa a ser un `value` real |
| `db/schema.prisma` | comentario del catálogo: 15 → **18** y mención de la 153 |
| `tests/unit/guards/censo-order-status-rename.test.ts` | SWAP de `OLD_VALUES`, allowlist (7 basenames), 3 casos nuevos |
| `tests/integration/db/zonas-migration.test.ts` | invariante "soy la última migración": excluye la carpeta nueva (patrón ya establecido por las features 118–146) |
| `tests/integration/db/notificacion-migration.test.ts` | ídem |

### NO tocados (por diseño, R18/§5)

`db/migrations/20260724120000_order_status_rename_nomenclatura/{migration,down}.sql` y
`tests/integration/db/order-status-rename-nomenclatura-migration.test.ts`.
`git diff origin/dev -- db/migrations` sale **vacío**: ninguna migración histórica se movió.
Tampoco se creó ni renombró nada bajo `app/api/**` ni `lib/actions/**` (R19).

## 3. Invariantes verificados

| Invariante | Resultado |
|---|---|
| Catálogo | 18 values antes y después, sin duplicados, `[10] === "en_reparto"`, `en_ruta` ausente |
| Vecinos | `en_ruta_bodega_central` y `en_ruta_bodega_satelite` presentes e intactos |
| Grafo | `lib/types/order-status-transiciones.ts` **idéntico** al de `origin/dev` tras normalizar el nombre del nodo → mismas aristas, mismos pares, mismas `via`/`rol`, `ESTADOS_CREACION`/`_TERMINALES`/`_VESTIGIALES` sin cambio |
| Censo `\ben_ruta\b` | **0** coincidencias fuera de `db/migrations/**`, `specs/**`, `progress/**`, `feature_list.json` y la allowlist de 3 tests |
| Censo `"En ruta"` | **0** coincidencias; no marca las etiquetas compuestas |
| Migración | 1 sola sentencia; sin `ALTER TYPE`, `CREATE TABLE`, `DROP TABLE`, `LIKE` ni `"id"` |

## 4. Mapa `R<n>` → test

| R | Test concreto |
|---|---|
| R1 | `tests/unit/types/order-status.test.ts` → "contiene exactamente los 18 valores esperados" + "R5/R12: en_reparto conserva el 11mo lugar (indice 10)…" |
| R2 | `tests/integration/db/order-status-en-reparto-migration.test.ts` → "R2: hace el UPDATE antiguo -> nuevo…", "R2: es exactamente 1 UPDATE, sin ALTER TYPE / recrear tabla / tocar id", "R2: es idempotente…" |
| R3 | mismo archivo → "R3: hace el UPDATE inverso nuevo -> antiguo", "R3: el DOWN es simetrico al UP…", "R3: UP seguido de DOWN es un round-trip exacto…" |
| R4 | mismo archivo → "tras el UP, la fila renombrada conserva su id y toma el nuevo value" + "las FKs orden.estatus_id / historial.*_id (por id) no cambian y sus conteos son estables" |
| R5 | mismo archivo → "R5: el WHERE por igualdad EXACTA no menciona los vecinos en_ruta_bodega_*"; y `tests/unit/guards/censo-order-status-rename.test.ts` → "el censo de en_ruta es por igualdad EXACTA (no marca en_ruta_bodega_central ni en_ruta_bodega_satelite)" |
| R6 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` (nº de aristas y set de pares invariante) |
| R7 | `tests/fixtures/inventario-transiciones-140.ts` consumido por `tests/unit/domain/order-status-transiciones.guardia.test.ts` y `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (#11–#16, #31–#36 con su `via`/`rol`) |
| R8 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` (`ESTADOS_CREACION`/`_TERMINALES`/`_VESTIGIALES`) |
| R9 | `tests/components/EstatusLabel.test.ts` → "traduce todos los estados del seed"; `tests/components/EstatusBadgeEnReparto.test.tsx` → "en_reparto se presenta como 'En reparto'", "ningun label vale exactamente la etiqueta antigua…", "las etiquetas COMPUESTAS de los vecinos siguen literales…" |
| R10 | `tests/components/EstatusBadgeEnReparto.test.tsx` → "conserva los 4 tokens de acento de marca (los MISMOS que en_fulfillment)" y "NO cae a la variante neutra sin clase…" |
| R11 | `tests/components/EstatusBadgeEnReparto.test.tsx` → "renderiza el texto 'En reparto' para el value en_reparto" + "el mapa cubre los 18 values del catalogo, sin sobrantes" (el filtro de `OrdenesListado` lee `ORDER_STATUS_LABELS`); `tests/unit/components/ordenes-listado.test.tsx` en verde |
| R12 | `tests/unit/services/mis-asignaciones-service.test.ts`, `cierre-dia-service.test.ts`, `corte-diario-service.test.ts`, `tests/unit/repositories/gestion-orden-repository.test.ts`, `cierre-dia-repository.test.ts`, `corte-diario-repository.test.ts`, `registrar-cambio-estado.guardia.test.ts`, `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` |
| R13 | `tests/unit/api/openapi-contrato-en-reparto.test.ts` → "cada enum contiene en_reparto y NINGUNO conserva el value antiguo", "el .yaml publicado sigue siendo espejo EXACTO del objeto TS (4 bloques identicos)", "el .yaml no menciona el value antiguo en ninguna linea", "EVENTOS_PUBLICOS sigue teniendo 9 elementos" |
| R14 | `tests/unit/services/webhook-estado-service.test.ts` (entrega con `estado: "en_reparto"` resuelto desde el id) + `tests/unit/services/webhook-estado-encolado.test.ts` (`"s-en-reparto" → "en_reparto"`, solo la transición pública encola); `tests/unit/api/openapi-contrato-en-reparto.test.ts` → "todo evento publico existe en el catalogo (no hay estado desconocido, R14)" |
| R15 | `tests/unit/guards/censo-order-status-rename.test.ts` → "OLD_VALUES sigue teniendo 6 entradas: incluye en_ruta y ya NO incluye en_reparto (swap de la 153)" |
| R16 | mismo archivo → "no hay coincidencias case-sensitive de los 6 values antiguos en app/, lib/, components/, hooks/, scripts/, tests/, e2e/" (allowlist de 7 basenames) |
| R17 | mismo archivo → describe "153/R17 …": "no hay ninguna aparicion del literal exacto…" + "el censo de la etiqueta NO marca las etiquetas compuestas, que siguen vigentes" |
| R18 | `tests/integration/db/order-status-en-reparto-migration.test.ts` → "contiene migration.sql y down.sql y su timestamp ordena DESPUES del rename de la 135" + "la migracion de la 135 sigue intacta: conserva sus 6 UPDATE originales"; confirmado con `git diff origin/dev -- db/migrations` (vacío) |
| R19 | `tests/unit/types/order-status.test.ts` (18 values, seed idempotente que no crece) + `tests/integration/db/order-status-en-reparto-migration.test.ts` (sin `CREATE/DROP TABLE`, sin `ALTER TYPE`); `git diff --name-status origin/dev -- app/api lib/actions` no lista ningún archivo nuevo |
| R20 | Suite completa en verde (§5) + el test nuevo de la migración |
| R21 | Salidas reales pegadas en §5. **Parcial:** `db:migrate`/`db:rollback` y Playwright NO se ejecutaron (ver §6) |

## 5. Salida real de la verificación

Baseline medida en el worktree **antes** de tocar nada (mismo comando, misma máquina):

```
$ pnpm test        # BASELINE, en limpio
 Test Files  1 failed | 542 passed (543)
      Tests  1 failed | 5680 passed (5681)
   Duration  168.50s
```

Después de la feature:

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)

$ pnpm test
 Test Files  1 failed | 545 passed (546)
      Tests  1 failed | 5711 passed (5712)
   Duration  142.98s

$ pnpm exec vitest run tests/integration/db      # exigido explícitamente
 Test Files  65 passed (65)
      Tests  584 passed (584)
```

**Delta de tests rotos: 0.** El único fallo, antes y después, es
`tests/unit/guards/no-embalaje.test.ts`, y **no lo causa esta feature**: lo dispara el commit
de specs `3e2b094` (lote 153-160), porque `specs/155-*/design.md` y `specs/159-*/{design,tasks}.md`
citan el nombre de archivo `tests/unit/guards/no-embalaje.test.ts` como precedente de modelado.
El guard busca `/embalaje/i` línea a línea y no distingue el nombre del guard del value
prohibido. Arreglado aparte, en su propio commit (§7), siguiendo el patrón de whitelist que
ya usan `specs/27-fulfillment-tienda/` y `specs/137-order-status-rename-nomenclatura/`.

Con ese arreglo, `pnpm test` queda en **546/546 archivos y 5712/5712 tests** y `./init.sh`
termina en verde.

## 6. Lo que NO se pudo verificar aquí (y por qué)

- **`pnpm run db:migrate` / `db:rollback` (T6.2, parte de R21).** El worktree aislado no tiene
  `.env` ni `DATABASE_URL`, así que no hay Postgres contra el que aplicar y revertir. Lo
  cubierto es la simulación: el test de la migración **parsea el SQL real** y verifica el
  round-trip UP→DOWN sobre un catálogo en memoria con filas de `orden`/historial por `id`.
  Queda pendiente ejecutarlo contra la base local antes de mergear.
- **`npm run test:e2e` (T6.3).** Playwright necesita servidor y base sembrada. En `e2e/` el
  cambio fue **solo de comentarios**: ningún selector depende del `value`, y los que dependen
  de texto ya buscaban "En reparto / por gestionar".
- **Recordatorio de deploy (design §1.3):** migración y código van en el **mismo** PR y el
  **mismo** deploy. Un deploy parcial deja `findEstatusIdByValue` devolviendo `null` y rompe
  cierre de día, corte diario y la guardia de transiciones. Un `db:rollback` de esta migración
  exige revertir también el código.

## 7. Observaciones para el leader

1. **Fallo pre-existente arreglado aparte.** El commit `fix(guards)` de esta rama solo añade a
   la whitelist de `no-embalaje.test.ts` los **3 archivos** de `specs/155-*` y `specs/159-*`
   que citan el guard por su nombre. Es ajeno a la 153; va separado justamente para que se
   pueda revertir sin tocar el rename.
2. **Deuda menor no tocada, a propósito.** `db/schema.prisma:353` sigue diciendo
   "8 valores" en el comentario de cabecera del catálogo, dos líneas encima del "18" que sí se
   corrigió. El gate autorizó solo la línea 356; no lo amplié por mi cuenta.
3. **Ida y vuelta fea en el log de migraciones.** En una base fresca la secuencia neta es
   `seed` inserta `en_reparto` → la 135 lo pasa a `en_ruta` → la 153 lo devuelve a
   `en_reparto`. Es feo y es correcto (design §0): editar la migración de la 135 rompería el
   checksum de `_prisma_migrations` en producción y preview.
