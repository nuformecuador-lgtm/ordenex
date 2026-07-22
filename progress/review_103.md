# Review 103 — API: `costoEnvio` (flete + IVA) en la carga por API

> Rama de código revisada (read-only, sin checkout): `feature/98-api-carga-valor-pagar`
> (HEAD `ae651b7`). Spec fuente: `specs/103-api-carga-valor-pagar/` (working tree).
> Verificación ejecutada en worktree aislado (junction a `node_modules`, cliente
> Prisma regenerado desde `db/schema.prisma` de la rama).

## Checklist CHECKPOINTS

- [x] `requirements.md` EARS numerado R1..R10.
- [x] `design.md` con alternativa descartada (Alt. A N+1 / Alt. B snapshot) y su porqué.
- [x] Cada `R<n>` mapea a >=1 test concreto que lo verifica (no vacío) — ver tabla.
- [x] `progress/impl_98.md` contiene el mapa `R -> test`.
- [x] `pnpm typecheck` exit 0 (tras regenerar cliente Prisma; ver hallazgo menor #1).
- [x] `pnpm lint` 0 errores (143 warnings pre-existentes, ninguno en archivos de la feature).
- [x] `pnpm test` suite completa: 3935 tests, 2 archivos flaky ajenos que pasan aislados
      (ver hallazgo menor #2). Tests de la feature: 124/124 verde.
- [x] Sin migración / sin tabla nueva -> RLS no aplica (design §1: solo LEE tarifas + zona.es_central).
- [x] Sin webhooks nuevos, sin secretos hardcodeados.
- [x] Capas: `OrdenRepository` solo proyecta (`zona.esCentral`); `BulkOrdenService` resuelve
      la lógica; el route handler solo hace wiring (no cambia su lógica).
- [x] Sin hardcode de país/moneda; money-safe STRING escala 2 con `Prisma.Decimal`.
- [ ] `specs/103/tasks.md` con todas las tasks `[x]` -> **NO marcadas** (hallazgo menor #3).

## Trazabilidad R -> test -> resultado

| Req | Test(s) | Estado |
|-----|---------|--------|
| R1  | bulk-orden-service.carga-api › "R1/R2/R7 no-central"; "R3 resuelve por tienda dueña (key-user-1)" | OK |
| R2  | ingreso-ordenex › costoEnvioDeTarifa no-central/central; orden-repository.bulk › T4 esCentral true/false; carga-api › central | OK |
| R3  | carga-api › "R3: tarifa resuelta UNA vez (spy toHaveBeenCalledTimes(1)), sin N+1" | OK |
| R4  | carga-api › "R4/R6: duplicada/error NO llevan costoEnvio; solo la creada" | OK |
| R5  | carga-api › `ordenes[].costoEnvio`; ordenes-api-key-carga.route › "R5: cada creada lleva costoEnvio" | OK |
| R6  | carga-api › "R4/R6…"; route › "R6: error/duplicada conservan shape, sin costoEnvio" | OK |
| R7  | ingreso-ordenex › ivaFlete=0 / IVA 15% HALF_UP / STRING escala 2; carga-api › STRING escala 2 + COD≠costoEnvio | OK |
| R8  | ingreso-ordenex › "tarifa null -> 0.00"; carga-api › "R8/D1: sin tarifa -> todas 0.00, 0 a error" | OK |
| R9  | bulk-orden-service › "cargarMasiva sin resolución de flete: resolver nunca invocado, summary sin `ordenes`/costoEnvio" | OK |
| R10 | carga-api › "no-regresión contrato 88: estado fijo, num_guia inmediato, shape = 88 + costoEnvio" | OK |

## Verificación de las decisiones del gate F1.4

1. `costoEnvio` = flete + IVA (no flete neto): `costoEnvioDeTarifa` devuelve
   `round2(flete.plus(aplicarPorcentaje(flete, ivaFlete))).toFixed(2)`, reusando
   `aplicarPorcentaje` de `ingreso-ordenex.ts`. OK (D2/R7).
2. Sin tarifa vigente -> `"0.00"`, la orden se crea igual (guard `toCreate.length>0`,
   `costoEnvioDeTarifa(null,_) === "0.00"`, ninguna a `error`). OK (D1/R8).
3. Money-safe STRING escala 2, ROUND_HALF_UP, aritmética con `Prisma.Decimal`. OK.
4. Tarifa resuelta 1 vez por lote (`resolveTarifaPorTienda(tiendaId)`); columna
   `valorFleteGam` si `esCentral`, si no `valorFlete`, proyectando `zona.esCentral`
   en `findDistritosByCantonIds` (sin N+1). OK (R3/R2).
5. Filas `error`/`duplicada` intactas (exponen errores/estatus, sin costoEnvio). OK (R6).
6. `cargarMasiva` y su `BulkSummary` sin cambios (diff = 0 en el cuerpo; test R9). OK.

## Hallazgos

- **menor #1** — El typecheck falla en frío por cliente Prisma stale
  (`GastoFijoPlantillaRepository`, archivo ajeno a la feature); tras
  `pnpm db:generate` desde el schema limpio pasa a exit 0. Artefacto de entorno
  conocido, no defecto de la feature. Recordar regenerar antes de medir.
- **menor #2** — En la suite completa (paralela) fallan de forma intermitente
  `tests/components/HomePage.test.tsx` y `tests/unit/guards/no-embalaje.test.ts`
  (timeout del guard que recorre el FS + timing de render). Ambos pasan aislados
  (2/2) y son ajenos a la feature 98. No es regresión.
- **menor #3** — `specs/103-api-carga-valor-pagar/tasks.md` tiene todas las tasks en
  `[ ]` (sin marcar). CHECKPOINTS exige `[x]`. Bookkeeping: marcar T1..T13 antes de
  pasar la feature a `done`. No es defecto funcional.
- **menor #4** — Ligera duplicación de la selección de columna del flete
  (`esCentral ? valorFleteGam : valorFlete`) entre `costoEnvioDeTarifa` y
  `derivarIngresoOrden` (mismo archivo). El design (§3.2) lo sugería unificar como
  "puede"; ambas ramas están cubiertas por tests idénticos. Aceptable; anotado por
  riesgo de divergencia futura.

Cero hallazgos BLOQUEANTES.

## Veredicto

**APROBADO** — `costoEnvio` = flete + IVA por orden creada en la carga por API,
gap `"0.00"`, tarifa resuelta 1 vez sin N+1, `cargarMasiva` intacto; R1..R10 mapeados
a tests reales que pasan (124/124), typecheck/lint verdes. Pendiente de bookkeeping:
marcar `tasks.md` (menor #3) antes de `done`.
