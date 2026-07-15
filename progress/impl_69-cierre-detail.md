# impl 69 — `cierre_detail` · bitácora del implementer

> Estado: **DETENIDO en el checkpoint T5** (gate duro). Bloque 0 (T1–T4) completo y commiteado.
> T5 **NO pasa** y **no es alcanzable dentro del alcance aprobado de la 69**: `dev` (`14f6548`)
> entra a esta feature con **17 tests en rojo que no son de la 69**. Ver §T5.
> Rama `feature/69-cierre-detail`, desde `origin/dev` `14f6548`.

## Tasks

| Task | Estado | Commit |
| --- | --- | --- |
| T1 — renombrar el contrato del resolver | ✅ | `a966999` |
| T2 — `TarifaVigentePorTiendaRepository` | ✅ | `a966999` |
| T2b — `TODO:` de la deuda (g) | ✅ (texto confirmado por el humano) | `a966999` |
| T3 — test REAL del resolver | ✅ | `6e0f702` |
| T4 — `scripts/seed-zonas.ts` | ✅ | `c2ae9c3` |
| **T5 — checkpoint del bloque 0** | ❌ **BLOQUEADO** (baseline rojo, no propio) | — |
| T6–T22 | ⏸ no iniciadas (el grafo exige T5) | — |

## Archivos tocados (bloque 0)

**Creados**
- `lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts`
- `lib/repositories/TarifaVigentePorTiendaRepository.ts`
- `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` (15 tests)

**Eliminados** (renombrados)
- `lib/interfaces/repositories/ITarifaVigentePorZonaRepository.ts`
- `lib/repositories/TarifaVigentePorZonaRepository.ts`

**Modificados**
- `lib/services/WalletFeedService.ts`, `lib/services/WalletTiendaFeedService.ts` (resuelven por
  tienda; T14/T15 los pasarán al snapshot)
- `lib/utils/ingreso-ordenex.ts` (solo el tipo/comentarios: **fórmula intacta**, R21)
- `lib/actions/cierres-admin.ts` (composition root)
- `scripts/seed-zonas.ts` (cruce → `zona_distrito`)
- Tests de 42/43 y `seed-zonas` adaptados al rename.

## Decisiones F1.4 aplicadas

- **(g) OVERRIDE — respetado al carácter.** El resolver filtra **solo** `deletedAt: null` +
  `orderBy createdAt desc`. `tarifas.status` **NO** entra en el `where` (ni en el singular ni en el
  batch). Fijado por test en ambos (`not.toContain("status")`).
- **(d)** El test del resolver ejercita la **clase real** contra un doble de
  `Pick<PrismaClient,"tarifa">` y afirma los argumentos exactos. Es la red que la 68 no tuvo.
- **R30** — `TODO:` en `TarifaVigentePorTiendaRepository.ts`, localizable por grep, con las 4 piezas
  confirmadas por el humano (incl. que lo pendiente es la **selección** de la fila, no "migrar a
  snapshot", y la referencia a la **feature 70**).

## Desviación (menor, reportada)

`design.md` §3.1 dibuja el batch como `Promise<Map<string, TarifaVigente | null>>`, pero `cierre_detail`
necesita **`tarifa_id`** (design §2.1: columna, FK, backfill `t.id`; es la contrapartida que hace la
deuda (g) auditable). Resuelto **sin tocar `TarifaVigente`** (los 7 campos siguen igual, T1): el batch
devuelve `TarifaVigenteResuelta = TarifaVigente & { tarifaId }`. Es una **extensión**, no un cambio.

---

## T5 — evidencia MEDIDA (no "debería")

| Gate | Baseline `14f6548` | Esta rama | Veredicto |
| --- | --- | --- | --- |
| `pnpm typecheck` | **2 errores** | **0 errores** | ✅ **arreglado** (R28) |
| `pnpm build` | **ROJO** | **VERDE** (`✓ Compiled successfully`) | ✅ **desbloqueado** |
| `pnpm lint` | 0 errores / 273 warnings | 0 errores / 273 warnings | ✅ sin regresión |
| `pnpm test` | **17 fallos / 9 archivos** (2754/2771) | **19 fallos / 10 archivos** (2767/2786) | ❌ ver abajo |
| `./init.sh` | ROJO | ROJO (cae en `pnpm test`) | ❌ ver abajo |

**El baseline NO es "~2764 / 296 / 0 fallos".** Medido en un **worktree limpio de `14f6548`**
(sin mis commits): `Test Files 9 failed | 288 passed (297)` · `Tests 17 failed | 2754 passed (2771)`.

### Los 9 archivos rojos del baseline (idénticos en mi rama, `comm` a nivel de archivo)

```
tests/components/AdminTiendaDashboard.test.tsx
tests/components/OrdenesModuleReuse.test.tsx
tests/components/OrdenesPage.test.tsx
tests/integration/db/order-status-enum-migration.test.ts
tests/integration/db/zonas-migration.test.ts
tests/unit/auth/menu-visibility.test.ts
tests/unit/components/ordenes-columns.test.tsx
tests/unit/scripts/seed-order-status.test.ts
tests/unit/types/order-status.test.ts
```

**Causa raíz (una sola):** el PR #75 aterrizó `recibido_origen` como **14.º** valor de
`ORDER_STATUS_SEED` (`lib/types/order-status.ts:33`) **sin actualizar sus tests**, que siguen
esperando 13:

```
AssertionError: expected [ Array(14) ] to deeply equal [ Array(13) ]
  ✗ contiene exactamente los 13 valores esperados
  ✗ no tiene valores duplicados
  ✗ agrega en_espera_aceptacion sin duplicar tras dos ejecuciones
```

Y `zonas-migration.test.ts:168` cae por el **orden de timestamps** de la migración
`20260715120000_order_status_recibido_origen` — es justo lo que **T9** manda revisar
(`_order_status_recibido_origen` NO está en la denylist), pero T9 depende de T7, que depende de T5.

**Ninguno es de la 69.** Delta de archivos rojos: **+1**, `tests/unit/guards/no-embalaje.test.ts`, y
**tampoco es código**: es **ambiental**. Ese guard escanea el filesystem y tropieza con
`.claude/worktrees/menu-config-submenu/` — un worktree **de otra sesión viva dentro del repo**
(untracked, `git worktree list`). No lo toco: es trabajo ajeno en curso.
Delta de tests (2771→2786 = **+15**) y de archivos (297→298 = **+1**) = **exactamente** mi test nuevo.

### Por qué me detengo

T5 es gate duro y su propósito es que no se confunda "mi error" con el baseline podrido — el
punto exacto donde murió la 68. Ese propósito lo cumplí **por medición** (baseline en worktree limpio +
diff a nivel de archivo): **no hay ninguna regresión mía**. Pero el gate literal (`pnpm test` verde,
`./init.sh` VERDE) **no se puede alcanzar sin arreglar tests de OTRA feature** (`recibido_origen`), y
eso es una **ampliación de alcance sin gate**. La 69 absorbió la 68 **porque el humano lo aprobó
explícitamente**; absorber la deuda de `recibido_origen` por mi cuenta sería repetir eso sin permiso.
Además no es mecánico: hay que decidir si el 14.º valor es **correcto y los tests están viejos**, o si
el merge está **mal** — criterio de producto, no de implementación.

**Decisión del leader/humano requerida.** Opciones:
1. Ampliar el alcance de la 69 para absorber la deuda de tests de `recibido_origen` (como absorbió la 68).
2. Feature aparte que devuelva `dev` a verde; la 69 la espera.
3. Redefinir el criterio de aceptación de T21 contra el baseline real (17 fallos), no contra 0.

Mientras tanto, T1–T4 quedan commiteados y aportan lo suyo: **`pnpm typecheck` 2 → 0** y
**`pnpm build` rojo → VERDE**, que es exactamente lo que la 68 nunca logró.

> Nota de proceso: durante la medición del baseline usé un worktree temporal con una junction a
> `node_modules`; al limpiarlo, un `rm -rf` siguió la junction y dañó `node_modules` del repo.
> **Reparado** con `pnpm install --force`; verificado después: `typecheck` 0 y la suite vuelve a los
> mismos números. Sin efecto sobre el árbol de git ni sobre los commits.
