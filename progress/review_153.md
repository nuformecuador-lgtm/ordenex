# Feature 153 — `order_status`: `en_ruta` → `en_reparto` · REVIEW

> Rol: REVIEWER · Rama `feature/153-order-status-en-reparto` (3 commits sobre `origin/dev`) ·
> Worktree `R:\job\singularis\projects\ordenex-wt-153` · Fecha: 2026-07-28.
> Spec: `specs/153-order-status-en-reparto/` (R1–R21) · Bitácora: `progress/impl_153.md`.
> **Todo lo que sigue está medido por mí en este worktree.** Ninguna cifra viene de la bitácora.

## Veredicto

**APROBADO-CON-NOTAS** — el código está bien y es mergeable; la feature **NO puede pasar a
`done`** hasta cerrar el bloqueante B1 (que no es un defecto de código y no vuelve al
implementer: lo cierra quien tenga la base local).

- **BLOQUEANTES: 1** (de cierre / verificación, no de código)
- **menores: 6**

---

## 1. Números reales medidos

### Baseline propia de `origin/dev`

Exportada con `git archive origin/dev` a un árbol limpio, con el MISMO `node_modules` del
worktree (junction) y el mismo `vitest 4.1.10`:

```
vitest run           Test Files  1 failed | 542 passed (543)
                          Tests  1 failed | 5680 passed (5681)     157.01s
eslint               10 problems (0 errors, 10 warnings)   exit 0
tsc --noEmit         0 errores                             exit 0
```

El único fallo de `dev` es `tests/unit/guards/no-embalaje.test.ts`, con estos 4 hallazgos:
`specs/155-creacion-bifurcada-fulfillment/design.md:288`,
`specs/159-quitar-sugerencia-mensajeros/design.md:369`, `:393` y
`specs/159-quitar-sugerencia-mensajeros/tasks.md:231`.

### Rama de la feature

```
pnpm run typecheck              0 errores                                 exit 0
pnpm run lint                   10 problems (0 errors, 10 warnings)       exit 0
pnpm test                       Test Files  546 passed (546)
                                     Tests  5712 passed (5712)   144.27s  exit 0
vitest run tests/integration/db Test Files   65 passed (65)
                                     Tests   584 passed (584)      5.81s  exit 0
./init.sh                       == init OK ==                             exit 0
                                (546/5712 en 142.11s dentro de init.sh)
```

### Delta contra la baseline

| Métrica | dev | feature | delta |
|---|---|---|---|
| Test files | 543 (1 rojo) | 546 (0 rojos) | +3 |
| Tests | 5681 (1 rojo) | 5712 (0 rojos) | +31 |
| Errores de typecheck | 0 | 0 | 0 |
| Errores de lint | 0 (10 warnings) | 0 (10 warnings) | 0 |
| Suites rotas | 1 | 0 | **-1** |

**Delta de tests rotos: -1.** No hay regresión y se cierra el fallo heredado.

### Superficie del diff

`git diff --name-status origin/dev` da **93 archivos: 6 `A` + 87 `M`**.
De los archivos tocados que existían en `dev`, **75 son byte a byte idénticos** al de `dev`
tras normalizar `en_reparto -> en_ruta` (con frontera de palabra) y `"En reparto" -> "En ruta"`.
Los 11 restantes los inspeccioné uno a uno: comentario de feature en `order-status.ts`, texto
del label en `EstatusBadge.tsx`/`EstatusLabel.test.ts`, comentario de `schema.prisma`, fixture
de `OrdenesPage.test.tsx`, exclusión de la carpeta nueva en los dos invariantes de "soy la
última migración", el swap del guard de censo, `esOrderStatusValue("EN_REPARTO")` en la
guardia, y la whitelist de `no-embalaje.test.ts` (commit aparte).
**Ningún cambio semántico escondido.**

---

## 2. Checklist de CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con EARS numerados R1–R21.
- [x] `design.md` con alternativas descartadas (§6.1–§6.4, cuatro, con su porqué).
- [ ] `tasks.md` con **todas** las tasks `[x]` -> **NO**: `T6.2` y `T6.3` siguen `[ ]` (ver B1).

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto (verificado leyendo aserciones, no nombres).
- [x] `progress/impl_153.md` contiene el mapa `R<n> -> test`, y el mapa es fiel.

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (10 warnings, **las mismas 10 que `dev`**).
- [x] `pnpm test` verde (546/5712).
- [~] E2E en flujos críticos: los specs existen (`e2e/mis-asignaciones`, `cierre-dia`,
      `reintentos-escalado`) y su diff es **solo comentarios**, pero **no se ejecutaron** (B1).

### Datos y seguridad
- [x] Sin tablas nuevas -> **RLS no aplica**. `db/schema.prisma` solo cambia un comentario;
      `git diff origin/dev -- db/migrations` no toca ninguna migración histórica.
- [x] La migración nueva tiene `down.sql`; `./init.sh` valida "todas las migraciones tienen down.sql".
- [ ] `pnpm run db:rollback` **funciona** -> no demostrado en ejecución (B1). Revisado
      estáticamente: `scripts/db-rollback.ts` toma la ÚLTIMA carpeta por orden alfabético
      (el test nuevo afirma que `20260728120000_order_status_en_reparto` lo es), exige
      `down.sql` (existe), valida el nombre contra el patrón alfanumérico (pasa) y borra la
      fila de `_prisma_migrations`. Mecánicamente no tiene por dónde fallar, pero **no está
      ejecutado**.
- [x] Sin secretos hardcodeados (el diff son literales de estado y comentarios).
- [x] Webhooks: no se crea ninguno; solo cambia el `value` que emite `WebhookEstadoService`, que
      lo resuelve desde `estatusDestinoId` (un id) contra el catálogo. Firma e idempotencia intactas.

### Patrón de capas / permisos / multi-país
- [x] Sin cambios de capa: no se crea ni renombra nada en `app/api/**` ni `lib/actions/**`
      (verificado con `git diff --name-status`), ni rutas, ni Server Actions, ni payloads.
- [x] Sin hardcode de país, moneda ni contexto.

### Verificación final
- [x] `./init.sh` termina en verde.
- [x] `progress/review_153.md` (este archivo).
- [ ] Entrada en `progress/history.md` -> pendiente del leader al cerrar.

---

## 3. Trazabilidad R<n> -> test (verificada con aserciones, no con nombres)

| R | Test | Estado |
|---|---|---|
| R1 | `tests/unit/types/order-status.test.ts`: set exacto de 18, `[10] === "en_reparto"`, sin duplicados | OK (M1, M28 muertas) |
| R2 | `tests/integration/db/order-status-en-reparto-migration.test.ts`: 1 UPDATE parseado, sin `ALTER TYPE`/`CREATE`/`DROP`/`"id"`, idempotente | OK (M9, M11 muertas) |
| R3 | mismo archivo: DOWN inverso + round-trip UP->DOWN sobre catálogo en memoria | OK (M10 muerta) |
| R4 | mismo archivo: `orden`/historial por `id` inalterados, conteos estables, unicidad de `value` | OK (M11 muerta) |
| R5 | mismo archivo (sin `LIKE`, vecinos no mencionados) + guard (frontera de palabra) | OK (M9, M11, M27 muertas) |
| R6 | `order-status-transiciones.guardia.test.ts`: "el mapa declara exactamente las aristas del inventario, ni una más" + **prueba estructural mía**: `lib/types/order-status-transiciones.ts` es byte a byte idéntico a `dev` tras normalizar el nombre del nodo | OK (M6, M7, M8 muertas) |
| R7 | `tests/fixtures/inventario-transiciones-140.ts` (byte-idéntico a `dev` tras normalizar; 43 aristas / 39 pares) consumido por la guardia y por `registrar-cambio-estado.guardia.test.ts` | OK |
| R8 | `order-status-transiciones.connectividad.test.ts`: `ESTADOS_CREACION` asertado por igualdad, `ESTADOS_VESTIGIALES` vacío, terminales con entrada; + diff byte-idéntico | OK |
| R9 | `EstatusLabel.test.ts` + `EstatusBadgeEnReparto.test.tsx` (label exacto, ningún label vale "En ruta", compuestas intactas) | OK (M4, M5 muertas) |
| R10 | `EstatusBadgeEnReparto.test.tsx`: los 4 tokens de marca + `enReparto === enFulfillment` sobre el DOM | OK (M2, M3 muertas) — **cobertura NUEVA, no existía en `dev`** |
| R11 | mismo archivo (render del texto) + el filtro de `OrdenesListado` es un lookup directo de `ORDER_STATUS_LABELS` (`labelDe`, `:121`), ya blindado | OK (transitivo, aceptable) |
| R12 | `mis-asignaciones-service`, `cierre-dia-service`, `corte-diario-service`, `corte-diario-repository`, `mis-asignaciones-orden-ruta` | **PARCIAL** (M17/M18/M19/M21/M22 muertas, **M23 SOBREVIVE**) -> menor 1 |
| R13 | `tests/unit/api/openapi-contrato-en-reparto.test.ts`: 4 enums TS, `.yaml` espejo exacto, `EVENTOS_PUBLICOS` = 9 | OK (M12, M13 muertas) — **cobertura NUEVA** |
| R14 | `webhook-estado-encolado.test.ts` (`s-en-reparto -> en_reparto`, solo lo público encola) + `webhook-estado-service.test.ts` (body con `estado: "en_reparto"` resuelto desde el id) | OK |
| R15 | `censo-order-status-rename.test.ts`: `OLD_VALUES` = 6, contiene `en_ruta`, NO contiene `en_reparto`, orden asertado por igualdad | OK (M25 muerta) |
| R16 | mismo archivo: 0 ofensores. **Censo independiente mío**: fuera de `specs/`, `progress/`, `feature_list.json`, `db/migrations/**` y los 3 tests allowlisteados, el value antiguo tiene **0 coincidencias** | **PARCIAL** (M16 SOBREVIVE) -> menor 2 |
| R17 | mismo archivo, describe `153/R17`: literal `"En ruta"` en cero + no marca las compuestas | OK (M15, M26 muertas) |
| R18 | migración nueva ordena después de la 135; la 135 conserva sus 6 UPDATE; `git diff origin/dev -- db/migrations` = solo la carpeta nueva | OK (M24 muerta) |
| R19 | 18 values, sin `CREATE/DROP TABLE` ni `ALTER TYPE`, sin archivos nuevos en `app/api/**` ni `lib/actions/**` (verificado por mí) | OK |
| R20 | suite completa verde + los 3 tests nuevos | OK |
| R21 | typecheck/lint/test/`init.sh` verdes (medidos por mí) | **INCOMPLETO**: `db:migrate`/`db:rollback` y Playwright no ejecutados -> **B1** |

---

## 4. Prueba por mutación

27 mutaciones distintas, aplicadas y revertidas sobre el árbol (arnés validado antes con una
mutación de control que efectivamente SOBREVIVE; el árbol quedó limpio tras cada una).
**25 muertas, 2 supervivientes.**

| # | Mutación | Resultado |
|---|---|---|
| M1 | `en_reparto` se mueve del índice 10 al 11 | muerta (aserción posicional) |
| M2 | se borra la entrada de `ORDER_STATUS_CLASS` (es `Partial`: no rompe build) | muerta |
| M3 | variante `secondary` -> neutra | muerta |
| M4 | label "En reparto" -> "En Reparto" | muerta (3 tests) |
| M5 | se renombra el label del vecino `en_ruta_bodega_satelite` | muerta |
| M6 | se QUITA la arista #16 (`en_reparto -> sin_gestionar`) | muerta |
| M7 | se cambia la `via` de #12 (`gestion` -> `ajuste_estado`) | muerta |
| M8 | se AGREGA una arista `en_reparto -> por_recoger` | muerta |
| M9 | el UP usa `LIKE` en vez de igualdad (se llevaría a los vecinos) | muerta (5 tests) |
| M10 | el `down.sql` deja de ser inverso | muerta (3 tests) |
| M11 | el UP añade un 2.º UPDATE que renombra un vecino | muerta (5 tests) |
| M12 | `EVENTOS_PUBLICOS` pierde `en_reparto` (queda en 8) | muerta |
| M13 | el enum TS se desincroniza del `.yaml` | muerta |
| M14 | reaparece el value antiguo en un comentario de `lib/services` | muerta (censo) |
| M15 | reaparece la etiqueta `"En ruta"` en un fixture | muerta (censo de etiqueta) |
| **M16** | **se infla la `ALLOWLIST` del guard con `CierreDiaService.ts`/`MisAsignacionesService.ts`** | **SOBREVIVE (6/6 verdes)** |
| M17 | `MisAsignacionesService.ESTADO_EN_REPARTO` desalineado del catálogo | muerta (12 tests) |
| M18 | `CierreDiaService.ESTADOS_PENDIENTES` pierde `en_reparto` | muerta |
| M19 | `CorteDiarioService.ESTADO_EN_REPARTO` desalineado | muerta |
| M21 | `CorteDiarioRepository.ESTADO_EN_REPARTO` desalineado | muerta |
| M22 | `MisAsignacionesService.ORIGEN_GESTION` desalineado | muerta (43 tests) |
| **M23** | **`OrdenRepository.ESTATUS_EN_REPARTO` desalineado** | **SOBREVIVE (546 files / 5712 tests VERDES)** |
| M24 | se reescribe la migración HISTÓRICA de la 135 | muerta (5 tests) |
| M25 | se DESHACE el swap del guard (vuelve a prohibir `en_reparto`) | muerta (3 tests) |
| M26 | se rompe el regex del censo de etiqueta | muerta |
| M27 | se quita la frontera de palabra del censo del value antiguo | muerta (2 tests) |
| M28 | el seed pierde `en_reparto` (queda en 17 values) | muerta (93 tests) |

---

## 5. Hallazgos

### BLOQUEANTE 1 — R21/T6.2 sin ejecutar: la migración nunca se aplicó ni se revirtió contra Postgres

`tasks.md` deja `T6.2` y `T6.3` en `[ ]`. R21 exige literalmente que "la migración DEBE haberse
aplicado y revertido con éxito en un entorno de prueba (`db:migrate` + `db:rollback`)", y
`CHECKPOINTS.md` exige que **todas** las tasks estén `[x]` y que "el script `pnpm run
db:rollback` funciona". `docs/verification.md` lo repite: "Verifica migraciones aplicando y
revirtiendo en un entorno de prueba".

Lo que SÍ está cubierto: `tests/integration/db/order-status-en-reparto-migration.test.ts` parsea
el SQL **real** de los dos archivos, afirma el único UPDATE, prohíbe `ALTER TYPE`/`CREATE
TABLE`/`DROP TABLE`/`LIKE`/`"id"`, comprueba que no menciona los vecinos, aplica los UPDATE
parseados a un catálogo en memoria con FKs por `id` y verifica el round-trip UP->DOWN. Es una
simulación honesta y las mutaciones M9/M10/M11 la validan.

Lo que NO está cubierto: que Postgres acepte la sentencia y que `db:rollback` complete el ciclo
(incluido el `DELETE FROM "_prisma_migrations"`). Riesgo residual bajo pero no nulo.

**Naturaleza y ruteo:** NO es un defecto de código y **no vuelve al implementer** — el worktree
aislado no tiene `.env` ni `DATABASE_URL`, así que era imposible ahí. Lo cierra quien tenga la
base local, antes de mergear:

```
pnpm run db:migrate    # aplica 20260728120000_order_status_en_reparto
                       # verificar: SELECT id, value FROM order_status WHERE value='en_reparto'
                       #   -> 1 fila, MISMO id que antes tenía el value antiguo; COUNT(*) = 18
pnpm run db:rollback   # verificar la vuelta con el MISMO id y COUNT(*) = 18
pnpm run db:migrate    # dejar la base al día
```

Además, `T6.3`: correr al menos `e2e/mis-asignaciones.spec.ts` y `e2e/cierre-dia.spec.ts` una vez
con servidor y base sembrada. Atenuante real: **en `e2e/` el diff es exclusivamente de
comentarios** (lo verifiqué línea a línea, 13 líneas, todas dentro de bloques `*` o `//`) y
ningún selector depende del `value`.

**Mientras B1 no se cierre, la 153 no puede marcarse `done`.**

---

### menor 1 — Mutante superviviente: `OrdenRepository.ESTATUS_EN_REPARTO` no lo verifica nadie

`lib/repositories/OrdenRepository.ts:48` — mutar `const ESTATUS_EN_REPARTO = "en_reparto"` a un
value inexistente deja la **suite completa en verde** (546 files / 5712 tests). Su único
consumidor de runtime es `findParadasEnReparto` (feature 92: paradas de la ruta del mensajero),
y en los tests ese método **siempre está mockeado** (`optimizacion-ruta-*`, `orden-service`,
`bulk-orden-service`, `asignacion-mensajero-service`, `rol-admin-satelite-authz`): nadie asserta
el `where.estatus.value` del query Prisma.

R12 nombra `ESTATUS_EN_REPARTO` de forma explícita, así que su cobertura queda coja. Si el
literal estuviera mal, `findParadasEnReparto` devolvería siempre `[]` y el orden de la ruta del
mensajero se degradaría **en silencio**.

Atenuantes: (a) el hueco es **idéntico en `dev`** (allí sobrevive la misma mutación sobre el
value antiguo), no es una regresión de la 153; (b) el valor entregado es correcto de forma
demostrable, porque `OrdenRepository.ts` es byte a byte idéntico al de `dev` tras normalizar el
rename. Sugerencia para el lote 154/155: un test que afirme que todo literal de estado usado en
`lib/repositories`/`lib/services` pertenece a `ORDER_STATUS_SEED`.

### menor 2 — Mutante superviviente: la `ALLOWLIST` del guard de censo no está aserta

Añadir basenames de producción a `ALLOWLIST` (probado con `CierreDiaService.ts` y
`MisAsignacionesService.ts`) deja el guard en **6/6 verdes**. R16 exige que "la allowlist DEBE
limitarse a los archivos que por diseño trazan literales históricos": nada lo verifica, y como
el match es por **basename** (no por ruta), cualquier archivo con ese nombre queda exento en
todo el árbol. Es la vía barata para silenciar el guard.

Heredado de la 135, no introducido por la 153. Fix de una línea:
`expect([...ALLOWLIST].sort()).toEqual([...los 8 esperados...])`.

### menor 3 — El spec dice 7 basenames de allowlist; el guard entregado tiene 8

R16 y `tasks.md` T5.1 hablan de "allowlist de 7 basenames (los 6 actuales + el de T4.6)". La
allowlist de `dev` ya tenía **7**, así que lo correcto es 8, y 8 es lo entregado. **El código
está bien; el número del spec estaba mal** y no se corrigió ni en `requirements.md` ni en
`tasks.md`. Combinado con el menor 2, nada detecta la divergencia.

### menor 4 — La salida de `./init.sh` pegada en la bitácora no salió de este árbol

`progress/impl_153.md` §5 pega `regla max-2-por-zona respetada (in_progress=4)`. En este
worktree `feature_list.json` (idéntico a `origin/dev`, no aparece en el diff) da
**`in_progress=2`** (141 y 153, ambas backend). Los números de tests sí coinciden
**exactamente** con mi medición (546/5712, `init OK`), así que el fondo es correcto, pero esa
línea de estado del arnés no proviene de este árbol. Pegar salidas debe ser copiar-y-pegar de
la corrida real.

### menor 5 — Deuda de comentario declarada y no cerrada en `db/schema.prisma`

`db/schema.prisma:352` sigue diciendo "por `value` (8 valores, ORDER_STATUS_SEED)" dos líneas
encima del `18` que sí se corrigió en `:356`. El implementer lo declara en su §7.2 y se abstuvo
por alcance; es coherente, pero deja el mismo comentario mintiendo con otro número.

### menor 6 — El antipatrón corregido en `OrdenesPage.test.tsx:124` sigue vivo en `:112`

Se corrigió `estatusValue: "En ruta"` -> `"en_reparto"` (bien: era una ETIQUETA donde va un
`value`), pero la fila de arriba conserva `estatusValue: "En bodega"` (`:112`) y **esa sí se
asserta** (`:188`). Fuera del alcance estricto de la 153 (R17 solo censa `"En ruta"`), pero el
fixture queda inconsistente consigo mismo.

---

## 6. Verificaciones específicas pedidas

1. **¿El rename es mecánico de verdad?** Sí, y está **probado estructuralmente**, no leído por
   encima: `lib/types/order-status-transiciones.ts` y `tests/fixtures/inventario-transiciones-140.ts`
   son **byte a byte idénticos** a los de `origin/dev` tras normalizar el nombre del nodo.
   Ninguna arista agregada, quitada ni cambiada de familia. Las mutaciones M6/M7/M8 confirman que
   el invariante "el mapa declara exactamente las aristas del inventario, ni una más" muerde en
   los tres sentidos (quitar, agregar y reetiquetar `via`).

2. **¿Se tocaron `en_ruta_bodega_central` / `en_ruta_bodega_satelite`?** No. Verifiqué archivo por
   archivo que **ningún archivo modificado perdió ocurrencias** de `en_ruta_bodega_central`,
   `en_ruta_bodega_satelite`, `"En ruta a bodega central"` ni `"En ruta a bodega satélite"`.
   La frontera de palabra está asertada explícitamente en el guard (M27 la mata) y el UP de la
   migración no los menciona (M9/M11 lo matan). También sobreviven en el contrato OpenAPI, con
   aserción propia en el test nuevo.

3. **Swap del guard de censo.** Correcto: `OLD_VALUES` tiene 6 entradas, entra `en_ruta`, sale
   `en_reparto`, los otros 5 intactos, con el orden asertado por igualdad (M25 muerta). La
   allowlist conserva los 7 de `dev` y suma el test de la migración nueva; sigue protegiendo la
   migración de la 135 y sus tests históricos. Salvedad: su integridad no está aserta (menor 2).

4. **La migración.** `migration.sql` = 1 sentencia
   `UPDATE "order_status" SET "value" = 'en_reparto' WHERE "value" = 'en_ruta';`.
   `down.sql` = el inverso EXACTO, mismo estilo y mismos comentarios que el precedente
   `20260724120000_order_status_rename_nomenclatura` (feature 135). Round-trip real sobre
   catálogo en memoria con FKs por `id`. Timestamp posterior a todo lo existente y asertado como
   "la última carpeta". Los dos invariantes "soy la última migración" (`zonas-migration`,
   `notificacion-migration`) se actualizaron con el mismo patrón que ya usaban las features
   118–146.
   *Nota menor:* el test aplica al DOWN menos prohibiciones que al UP (no comprueba `LIKE` ni
   `"id"` en `down.sql`). Cosmético; el DOWN es una sola línea y M10 lo mata.

5. **El fallo de `no-embalaje` del commit `c449215`: la afirmación es CIERTA.** Lo reproduje en
   una baseline limpia de `origin/dev`: `tests/unit/guards/no-embalaje.test.ts` ya falla ahí, con
   4 hallazgos, todos en `specs/155-*` y `specs/159-*`, y todos por citar el **nombre de archivo**
   `tests/unit/guards/no-embalaje.test.ts`, no el value prohibido. El arreglo son 3 entradas en
   `WHITELIST_FILES`, va en su propio commit, es reversible sin tocar el rename y es **más
   estrecho** que el precedente (whitelistea 3 archivos concretos, no la carpeta entera del spec,
   como sí se hizo con `specs/27/` y `specs/137/`). No esconde nada: el diff son 8 líneas
   añadidas, 0 eliminadas, y el resto del guard no cambia.

6. **RLS / seguridad / capas.** No hay tablas, columnas, índices ni policies nuevas -> RLS no
   aplica. No hay endpoints, Server Actions ni payloads nuevos. Ningún secreto. Ningún hardcode
   de contexto. Las capas no se mezclan: el diff en `lib/repositories` y `lib/services` es
   literal de estado y comentarios.

7. **Deuda operativa a recordar al mergear** (design §1.3, ya anotada por el implementer):
   migración y código van en el **mismo** PR y el **mismo** deploy. Un deploy parcial deja
   `findEstatusIdByValue` devolviendo `null` y rompe cierre de día, corte diario y la guardia de
   transiciones. Y el contrato externo (`docs/api/api-key-openapi.yaml`) cambia **sin** bumpear
   `info.version` — decisión del gate, misma política que la 135, pero sigue siendo breaking
   para integradores que comparen contra el value antiguo.

---

## 7. Qué falta para cerrar

1. **B1** — correr `pnpm run db:migrate` -> verificar la fila (mismo `id`, `COUNT(*) = 18`) ->
   `pnpm run db:rollback` -> verificar la vuelta -> `pnpm run db:migrate`. Marcar `T6.2` `[x]`
   en `tasks.md` y pegar la salida real en `progress/impl_153.md`.
2. **T6.3** — al menos un pase de `e2e/mis-asignaciones.spec.ts` y `e2e/cierre-dia.spec.ts`.
   Marcar `[x]`.
3. Opcional (recomendado para el lote 154/155, no bloquea): cerrar los menores 1 y 2, que son
   los dos únicos huecos que una mutación deliberada logró atravesar.

Con B1 y T6.3 cerrados y `tasks.md` completo, esta feature pasa a **OK**.
