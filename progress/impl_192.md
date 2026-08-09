# Feature 192 — tablero del día por mensajero · informe de implementación

> **Nota de procedencia.** El subagente `implementer` fue **interrumpido** el 2026-08-08 a las
> 16:22, después de terminar el código y antes de escribir este informe. Lo que sigue NO es su
> parte: lo reconstruyó el leader midiendo el árbol de trabajo el 2026-08-09. Todo número de
> aquí abajo viene de una corrida real, no de un resumen heredado.

## Estado

Implementación **completa en disco**. Los 15 checkboxes que `tasks.md` tenía sin marcar eran
bookkeeping que se llevó el corte, no trabajo faltante: cada artefacto existe y su test pasa.
Única desviación de nombres: la tarjeta prevista como `TableroDiaTarjetas.tsx` acabó repartida
en `MensajeroCard.tsx` + `TableroDiaRejilla.tsx` (su test, `TableroDiaTarjetas.test.tsx`, sigue
verde y cubre ambos).

Quedan **dos** ítems abiertos a propósito:

- **F4.1** — los mocks ya no existen (`grep` de `mock|placeholder` en `app/(app)/monitoreo/`
  sale vacío) pero la comprobación **a mano** del flujo la debe hacer un humano. No la marco.
- **C3** — el `./init.sh` completo se corrió después de escribir esto; su resultado manda.

## Medición (worktree `C:/w192`, 2026-08-09)

| Gate | Resultado |
|---|---|
| `tsc --noEmit` | **limpio**, exit 0 |
| Unitarios (servicios, repos, actions, utils, guardias, auth) | **174 archivos / 2816 tests, 0 rojos** |
| Componentes + integración de la feature | **10 archivos / 94 tests, 0 rojos** |

Baseline de `dev` contra el que se compara: 986 archivos / 12.270 tests / cero rojos reales
(medido 2026-08-08). Cualquier rojo nuevo es de esta feature.

## `./init.sh` completo (2026-08-09) — rojo, y por qué NO es de esta feature

`1012 archivos / 12.550 tests / 16 rojos en 6 archivos`. Typecheck y lint pasaron. La suite NO
salió degradada (`grep -c "unhandled error"` = 0), así que el conteo es de fiar. Los 1012
archivos son los 986 del baseline + los **26** que aporta esta feature: cuadra exacto.

**4 rojos en 4 archivos — flakes por saturación.** `no-embalaje.guardia`, `FiltrosOperativos`,
`TableroOperativo`, `wallet-tiendas-desglose`. Reejecutados en aislado: **4 archivos / 97 tests,
0 rojos**. El de `no-embalaje` ni siquiera halló nada: expiró a los 20 s recorriendo el árbol, y
no hay ninguna referencia a "embalaje" en el código nuevo.

**12 rojos en 2 archivos — drift de la base local, preexistente.**
`busqueda-normalizacion-paridad` (11) y `busqueda-comportamiento` (1). Reproducibles en aislado,
así que son reales, pero no son nuestros:

- La feature toca 8 archivos y **ninguno** roza búsqueda, ni añade SQL ni migraciones.
- Postgres devuelve `"... ana rojas producto de prueba"`; Node, `"... ana rojas"`. La migración
  `db/migrations/20260731160000_orden_busqueda_trgm/migration.sql` define la columna generada
  `busqueda_texto` sobre CINCO campos y **no incluye producto**. La columna viva en la base local
  sí: se creó con una versión anterior de esa migración. `prisma migrate status` dice "up to
  date" y no lo ve.
- Por qué no salió el 2026-08-08: esos tests abren con `if (!fks) return;`. Con `orden` vacía
  retornan temprano y se reportan **passed**. El baseline "cero rojos" era verde vacuo en esa
  capa. Hoy la base tiene filas y comprueban de verdad.

**Se salda recreando la columna generada desde la migración, no tocando código** — y es trabajo
ajeno a la 192. Por eso **C3 queda SIN marcar**: el gate no está verde y no voy a declararlo
verde por conveniencia.

## Los tres guardias que se pidieron como innegociables

- **R37 — ninguna migración ni índice.** `git status db/ prisma/` sale vacío. El coste se paga
  con la caché de servidor, que fue la decisión explícita del humano frente al índice.
- **R59 — `asignado_at` no se escribe NUNCA.** La única aparición en código nuevo es
  `TableroDiaRepository.ts:330`, `asignadoAt: f.asignado_at.toISOString()`: **lectura** que mapea
  la fila al DTO. Hay guardia dedicada:
  `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`.
- **R67/R69 — la caché aísla por alcance resuelto.**
  `tests/unit/services/tablero-dia-cache-aislamiento.guardia.test.ts` asserta **los contenidos
  devueltos**, no aciertos de caché — contar llamadas demostraría que la caché funciona, no que
  aísla. Y comprueba que un actor denegado sigue denegado con una entrada caliente que cubriría
  su consulta: el denegado sale antes de que exista clave que consultar.

## Trazabilidad R→test — 73/73

**Cómo se construyó, y su límite:** el mapa sale de las etiquetas `R<n>` presentes en los
archivos de test. Demuestra que ningún requisito quedó **huérfano**; NO demuestra que la
aserción sea la correcta. Una mención en un comentario cuenta igual que una aserción. Validar
que el test realmente ejerce el requisito es trabajo del `reviewer`, no de este mapa.

Ningún requisito salió `SIN TEST`. Los tres que no llevan etiqueta en los archivos
`tablero-dia-*` (R35, R53, R54, sobre el ítem de sidebar y el aterrizaje post-login) viven en
`tests/unit/auth/menu-visibility.test.ts`, `tests/components/Sidebar.test.tsx` y
`tests/unit/auth/destino-post-login.test.ts`.

Concentraciones que al `reviewer` le conviene mirar primero:

- **R18, R22, R23, R26** — un solo archivo (`integration/tablero-dia-conteo.test.ts`). Son los
  requisitos de conteo; si esa integración se degrada, se caen cuatro requisitos a la vez.
- **R24, R27** — solo `unit/tablero-dia/resultados-exhaustivos.test.ts`.
- **R31, R50, R52** — un solo archivo cada uno.
- **R66, R70** — solo `unit/services/tablero-dia-cache.test.ts`.

## Archivos

**Backend/dominio:** `lib/types/tablero-dia.ts`, `lib/utils/ventana-dia-cr.ts`,
`lib/interfaces/{services/ITableroDiaService,repositories/ITableroDiaRepository,external/ITableroDiaCache}.ts`,
`lib/repositories/TableroDiaRepository.ts`, `lib/services/TableroDiaService.ts`,
`lib/actions/tablero-dia.ts`,
`lib/cache/{tablero-dia-cache-memoria,tablero-dia-cache-nula,next-tablero-dia-cache}.ts`,
`lib/config/tablero-dia-cache.ts`.

**UI:** `app/(app)/monitoreo/page.tsx` + `_components/` (`TableroDiaModule`, `TableroDiaRejilla`,
`MensajeroCard`, `DetalleMensajeroPanel`, `TableroDiaCabecera`, `TableroDiaEstados`,
`TableroDiaTotales`, `ContadoresTablero`, `contadores.ts`), `components/ui/table.tsx`.

**Tocados:** `app/(app)/_components/Sidebar.tsx`, `lib/auth/menu-visibility.ts` (ítem
"Monitoreo"), y sus tests + `tests/unit/analytics/cache-aislamiento.guardia.test.ts`.

## Lo que el leader NO hizo (y por qué)

No hay commit, merge ni PR: eso pasa después del `reviewer`, y lo hace el leader. El checkout
principal (`C:/Users/Cristian/Documents/trabajo/arc/ordenex`, rama `ux`) tiene trabajo del
humano SIN COMMITEAR y **no se tocó** en ningún momento.
