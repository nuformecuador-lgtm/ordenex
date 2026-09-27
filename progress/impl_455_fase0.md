# 455 — Fase 0 (medicion y caracterizacion) · bitacora del backend_dev

> 2026-09-24 · rama `feature/455-fase0` creada con `git switch -c feature/455-fase0 0bd66809`
> (`git log --oneline -1` → `0bd66809 chore(features): 454 hecha en dev (sin desplegar); 455 en curso`;
> contiene la 454, PR #819). **Cero cambios de produccion**: `git diff --stat -- lib app db` vacio.
> Busqueda de codigo: el MCP `codebase-memory` se consulto primero (`search_graph`) pero esta rancio para
> la 454 (no ve `NOMBRE_RESULTADO_PENDIENTE` ni `orden_evento`); todo se confirmo leyendo el archivo real.

## Veredicto

**Fase 0 cerrada en verde con una salvedad**: C01-C16 + humo T0.1 → 17 archivos, **64 tests, 0 skipped**,
cada C con su mutacion en ROJO (21 mutaciones, 0 sobrevivientes) y arbol limpio tras cada una. T0.2
queda **pendiente de produccion** (SQL de solo lectura listo en `progress/medicion_455.md` para el
MCP del leader). Ninguna reconciliacion cambia el alcance.

## T0.0 — Preparacion

- `node_modules`: junction al repo principal (`fs.symlinkSync(..., "junction")`); `.env` copiado sin
  imprimirlo; `pnpm exec prisma generate` OK.
- `pnpm exec prisma migrate status` → `PostgreSQL database "ordenex", schema "public" at "localhost:5432"`,
  `209 migrations found`, **«Database schema is up to date!»** (M1-M3 de la 454 aplicadas).
- Control con base real: `pnpm exec vitest run tests/integration/db/455/interruptor-codigos.test.ts
  tests/integration/db/454/caracterizacion/dinero-aprobacion.test.ts --reporter=verbose` →
  `Test Files 2 passed · Tests 6 passed`, 0 skipped.
- No se migro la base local (no hace falta en Fase 0): no se toco `progress/current.md`. El aviso de
  base compartida lo exige la Fase 1 antes de aplicar M1-M3 de la 455.

## T0.1 — Interruptor `tests/fixtures/codigos-455.ts`

`C` (20 claves semanticas en el orden del seed), `R` (5 resultados), `RETIRADO` (4), `CLAVE_DE_CODIGO`,
`claveDe()`. En T1.4 se cambian SOLO los 7 valores de `C` y los 4 de `R` marcados «cambia».
Humo: `tests/integration/db/455/interruptor-codigos.test.ts` (3 tests): `C` en orden = `ORDER_STATUS_SEED`,
`R` = etiquetas de `pg_enum gestion_resultado`, y una orden sembrada y releida en cada uno de los 20.
Dos ajustes forzados por guardias existentes (ver RECONCILIACION-8/9).

## T0.2 / T0.3

- T0.2 → `progress/medicion_455.md` (SQL para prod + resultados locales + hallazgos).
- T0.3 → `progress/inventario_455.md` (G1 contado; G2: 105 apariciones clasificadas, 0 sin clasificar;
  docs/ayuda; piezas pedidas).

## Tests de caracterizacion — carpeta `tests/integration/db/455/caracterizacion/`

Comando comun del verde: `pnpm exec vitest run tests/integration/db/455 --reporter=verbose` →
`progress/fase0_455_suite.log`: **`Test Files 17 passed (17)` · `Tests 64 passed (64)`, 0 skipped,
`INIT_EXIT=0`** (escrito dentro del log).
Rojo: `bash mutar.sh <id> <archivo> <expr.pl> <test>` (scratchpad): aplica la expresion perl, muestra el
diff, cuenta lineas cambiadas (≠0 o avisa «MUTACION NO APLICADA»), corre el test, `git checkout -- <archivo>`
y muestra `git diff --stat -- lib app db`. Salida integra de cada una en `progress/mut_455_fase0/<id>.log`.
La tabla es la **segunda pasada completa**, sobre los tests en su forma final.

| C | Archivo (tests) | Verde | Mutacion (archivo:linea) | Rojo | Reversion |
|---|---|---|---|---|---|
| C01 | `filtro-ordenes-por-estado` (3) | 3/3 | `lib/services/OrdenService.ts:196` `= input.filter.status_id` → `= { notIn: [...] }` | 2 failed | limpio |
| C02 | `filtro-satelite-por-codigo` (3) | 3/3 | `lib/utils/estados-bodega-satelite.ts:205` fuera `"por_devolver"` de la lista blanca | 2 failed | limpio |
| C03 | `sql-crudo-cron-devoluciones` (2) | 2/2 | `lib/repositories/DevolucionSlaRepository.ts:13` `ESTATUS_DEVUELTA` → `"rechazada"` | 2 failed | limpio |
| C04 | `sql-crudo-tablero-dia` (3) | 3/3 | `lib/repositories/TableroDiaRepository.ts:102` `devuelta:` → `rechazada:` (literal que va al `FILTER` del SQL) | 1 failed | limpio |
| C04b | idem | — | `lib/types/tablero-dia.ts:71` fuera `por_recoger: "sinRecoger"` | 1 failed | limpio |
| C05 | `sql-crudo-analitica` (5) | 5/5 | `lib/repositories/AnaliticaRollupRepository.ts:221` `'devuelta'` → `'rechazada'` en el `FILTER` de `devoluciones` | 2 failed (rollup + equivalencia intradia) | limpio |
| C05b | idem | — | `lib/repositories/RankingRepository.ts:51` `"entregada"` → `"incidente"` | 1 failed (ranking) | limpio |
| C05c | idem | — | `lib/types/order-status-transiciones.ts:464` fuera `"entregada"` de `ESTADOS_TERMINALES` | 2 failed (rollup + cohorte) | limpio |
| C06 | `sql-crudo-avisos-y-corte` (3) | 3/3 | `lib/repositories/AvisoAgregadoRepository.ts:41` `ESTATUS_REPRESADA` → `"devuelta"` | 1 failed | limpio |
| C06b | idem | — | `lib/services/CorteDiarioService.ts:28` `ESTADO_SIN_GESTIONAR` → valor inexistente | 1 failed (corte) | limpio |
| C07 | `sql-crudo-conteos` (4) | 4/4 | `lib/repositories/ConteoDevolucionesRepository.ts:53` `RESULTADO_DEVUELTA` → `"rechazada"` | 1 failed | limpio |
| C07b | idem | — | `lib/types/conteo-entregas.ts:29` fuera `"devuelta"` de `DESENLACES` | 1 failed | limpio |
| C08 | `dinero-aprobacion` (4) | 4/4 | `lib/utils/ingreso-ordenex.ts:182` flete de devolucion a `"devuelta"` en vez de `"rechazada"` | 1 failed (movimientos) | limpio |
| C09 | `intentos-y-tope` (3) | 3/3 | `lib/types/orden-historial.ts:262` fuera `"reprogramada"` de `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` | 2 failed | limpio |
| C10 | `transiciones` (4, puro) | 4/4 | `lib/types/order-status-transiciones.ts:270` borrada la arista #69 | 2 failed | limpio |
| C11 | `webhook-estado` (4) | 4/4 | `lib/types/webhook-eventos.ts:96` fuera `"entregada"` de `EVENTOS_PUBLICOS` | 4 failed | limpio |
| C12 | `api-lectura` (8) | 8/8 | `lib/services/ApiOrdenLecturaService.ts:155` `if (estado)` → `if (false && estado)` | 1 failed | limpio |
| C13 | `rastreo` (5) | 5/5 | `lib/types/rastreo-publico.ts:88` `entregada: "entregado"` → `"en_reparto"` | 3 failed | limpio |
| C14 | `novedades-y-ayuda` (4) | 4/4 | `lib/types/novedad-grupo.ts:77` grupo `devolucion` → `"rechazada"` | 1 failed | limpio |
| C15 | `plantilla-estatus` (3) | 3/3 | `lib/types/plantilla-datos.ts:495` `transform: () => ""` | 2 failed | limpio |
| C16 | `snapshot-correccion` (3) | 3/3 | `lib/repositories/CierresAdminRepository.ts:1786` `valorNuevo: ""` | 3 failed | limpio |

Autocomprobacion: ningun rojo se debe a un `beforeAll` caido (todos caen en una asercion con nombre); dos
casos que la primera pasada detecto asi se rehicieron: C05 (la mutacion de `entregas` tumbaba el servicio
por `PrimerIntentoIncoherenteError` → se cambio a la de `devoluciones`) y C11 (el `throw` si faltaba el job
→ el `null` se compara). Una mutacion SOBREVIVIO en la primera pasada y obligo a rehacer el test: **C05b**
(ranking) — el incidente lo gestionaba el mismo mensajero y contaba igual; ahora lo gestiona otro. Y
**C08** se diseño con DOS rechazos porque con uno la mutacion `rechazada→devuelta` daba el mismo importe.
Ningun test usa `if (!x) return;`: las precondiciones se afirman o lanzan con mensaje.

Cada fila separa `invariantes` (no se editan en Fase 1-2) de `[INTERMEDIO]` (lo que la 455 cambia):
C02 (URL), C04 (rotulos), C05 (label del rollup operativo = codigo), C11 (claves del `data`), C12 (claves
del item, de `gestiones[]` y de la carga), C13 (textos de hitos + «Rechazada» pendiente), C14 (pestañas),
C15 (texto = hito), C16 (la columna pinta el codigo crudo). C01, C03, C06-C10 no tienen `[INTERMEDIO]`.

## Gate de lo tocado

- `pnpm run typecheck` → `tsc --noEmit`, **EXIT=0** (`progress/fase0_455_typecheck.log`). Un primer rojo
  propio (`render` de columna tipado `string | fn`) se corrigio en C16.
- `pnpm run lint` → **0 errors**, 216 warnings preexistentes, **0 en archivos de la 455**, EXIT=0
  (`progress/fase0_455_lint.log`).
- Guardias: `pnpm exec vitest run tests/unit/guards guardia censo tests/integration/db/455` →
  **255 archivos, 3 437 tests, EXIT=0** (`progress/fase0_455_guardias.log`). Hubo dos rojos PROPIOS en la
  primera corrida, arreglados en los archivos nuevos (RECONCILIACION-8 y -9).
- `./init.sh` no se corrio: la rama solo añade tests/fixtures/progress; el gate de la ficha (completo)
  es de T1.13.

## RECONCILIACIONES (spec escrito antes de terminar la 454 → codigo real)

1. **Retirados ya declarados por la 454.** `lib/types/order-status.ts` ya exporta
   `ORDER_STATUS_RETIRADOS = ["devolucion_por_confirmar", "ayuda_tienda"]` y `esOrderStatusRetirado`. El
   `ESTADO_RETIRADO` de design §1.1 los tiene que ABSORBER (no convivir): T1.1.
2. **Tres copias de nombres que la fuente unica absorbe**, no una: `NOMBRE_RESULTADO_PENDIENTE`
   (`lib/types/rastreo-publico.ts:200`, con «Entregada/Reprogramada/Devuelta/Rechazada», nombres de §0.3),
   `components/shared/nota-pendiente-confirmacion.ts` (`COLETILLA_PENDIENTE_CONFIRMACION`,
   `NOTA_AYUDA_SOLICITADA = "Ayuda solicitada a la tienda"`, igual al nombre historico de `ayuda_tienda`
   → choca con R6) y `estatus-label.ts:36` (la señal pendiente). El formato «·» YA lo implanto la 454:
   la decision 8 de requirements («sustituye al — de 454/R31») esta cumplida de antemano.
3. **Rastreo**: la entrada pendiente de la 454 lleva `hito` + `pendiente: true` + `nombreResultado`. El
   DTO de design §4 debe conservar `pendiente` y reemplazar `nombreResultado` por el nombre de §0.2. C13
   fija solo numero de entradas, fechas y la marca pendiente (invariantes), no el texto.
4. **Novedades**: el grupo `ayuda` ya es un PREDICADO (`ayuda_abierta` sobre `en_reparto`), no un estado;
   C14 caracteriza eso. Coincide con design §2.1.
5. **Mutaciones del spec traducidas al codigo real**: C01 «en `listarOrdenes`» → el filtro vive en
   `OrdenService.construirWhere` (la action solo delega). C09 «lista de visita real» → la lista de
   RESULTADOS es `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`; «visita real» son FAMILIAS
   (`ORIGEN_TIPOS_VISITA_REAL`) mas la 2.ª via de la 454 (`whereTieneRegistroDeCalle`). C08 «feed de
   flete» → `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`).
6. **R26 / design §5.2**: la premisa «un filtro con codigo viejo hoy devolveria una pagina vacia en
   silencio» es FALSA por la ruta: `listadoQuerySchema` valida `z.enum(ORDER_STATUS_SEED)` y un codigo que
   no es del seed ya responde **422** (C12 lo fija como invariante). Tras T1.1 el codigo anterior dara 422
   generico automaticamente; el trabajo de R26 se reduce al MENSAJE explicativo. No cambia el alcance.
7. **El escenario de la 454 (`tests/integration/db/454/_escenario.ts`) tipa con codigos anteriores**
   (`ESTATUS_454`, `ResultadoGestion`, `entradaGestion` por `case "entregada"`…). Los tests de la 455 lo
   reutilizan con `as never`; T1.4 debe reemplazarlo junto con el resto de `tests/` o la Fase 0 dejara de
   compilar/correr.
8. **Censo de la 155 (`censo-order-status-rename.test.ts`) prohibe el literal `en_fulfillment` en TODO el
   arbol, comentarios incluidos.** El interruptor lo compone con `["en","fulfillment"].join("_")`
   (precedente en 4 tests). Afecta a T1.1: design §1.1 pone `en_fulfillment:` como CLAVE de
   `ESTADO_RETIRADO` en `lib/types/order-status.ts` → o se compone igual o se añade a la allowlist del
   censo con motivo.
9. **`buckets-estatus.guardia.test.ts` prohibe nombrar entre comillas un bucket del tablero
   (`"enReparto"`, `"sinRecoger"`) en un archivo que tambien tenga `"en_reparto"`/`"por_recoger"`/
   `"recolectando"`.** La clave semantica `enReparto` choca con el bucket homonimo: el interruptor deriva
   su lista de claves con `Object.keys(C)` y C13 usa `C.x` en vez de cadenas. T1.4/T1.10 deben contarlo.
10. **Rutas de evidencias con el codigo del resultado** (`MisAsignacionesService.ts:695`,
    `GestionDesdeAyudaService.ts:230`): no estaban en el diseño. Ver `medicion_455.md`.
11. **Supuestos medidos**: los literales crecieron (1 187 lineas/241 archivos en produccion, 4 342/559 en
    tests); y la FK a `order_status` son exactamente 5 columnas en 4 tablas (las que design §3.1 M3 lista).

## Alcance de algunos C, declarado

- C05 cubre rollup 124, intradia 126, cohorte y ranking; el ciclo de vida y los conteos van en C07.
  `AnaliticaOperativaRollupRepository` solo aporta el `[INTERMEDIO]` del label.
- C11 «ciclo completo»: entrega, rechazo y novedad aprobados (el rechazo de zona central sigue a
  `por_devolver_a_tienda`, que NO emite: queda afirmado). R28 se prueba renombrando la fila del catalogo
  a un centinela dentro de la tx (independiente del codigo, sirve tras T1.4).
- C12 carga: solo la rama `duplicada` (su `estatus` es el estado real de la orden que ocupa la remision);
  una fila creada devuelve el estado inicial, cuyo codigo no cambia.
- C13 depende de que la fusion por NOMBRE de la 455 conserve la fecha de la PRIMERA fila de cada racha
  (design §4: «la misma regla de rachas de hoy»).

## Archivos creados

- `tests/fixtures/codigos-455.ts`
- `tests/integration/db/455/interruptor-codigos.test.ts`
- `tests/integration/db/455/caracterizacion/{filtro-ordenes-por-estado, filtro-satelite-por-codigo,
  sql-crudo-cron-devoluciones, sql-crudo-tablero-dia, sql-crudo-analitica, sql-crudo-avisos-y-corte,
  sql-crudo-conteos, dinero-aprobacion, intentos-y-tope, transiciones, webhook-estado, api-lectura,
  rastreo, novedades-y-ayuda, plantilla-estatus, snapshot-correccion}.test.ts`
- `progress/impl_455_fase0.md`, `progress/medicion_455.md`, `progress/inventario_455.md`,
  `progress/mut_455_fase0/*.log`, `progress/fase0_455_{suite,typecheck,lint,guardias}.log`

## Mapa R → test de esta fase

R21 → C01 · R22 → C02 `[INTERMEDIO]` · R23 → C16 `[INTERMEDIO]` · R24/R26/R27 → C12 · R28 → C11 ·
R31/R34 → C13 · R35 → C15 · R45 → C01, C02 · R46 → C03-C07 · R47 → C08 · R48 → C10 · R49 → C09 ·
R50 → C11 · R52 → C04, C05 · R53 → C06, C14 (+ suite 454).
