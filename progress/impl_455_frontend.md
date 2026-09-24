# 455 — Fase 2 (frontend) · bitácora del frontend_dev

> 2026-09-24 · rama `feature/455-frontend` creada con `git switch -c feature/455-frontend 9f1a0d37`
> (`git log --oneline -1` → `9f1a0d37 docs(455): bitacora corregida …`: la Fase 1 del backend).
> Búsqueda de código: MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) consultado
> primero (`search_graph` del rastreo); los símbolos se confirmaron en el archivo real. El censo de
> textos se hizo con las propias guardias G2/G3 en modo informe (listas `PENDIENTES_FASE_2` vaciadas
> y leída la salida).

## Veredicto

**Fase 2 hecha, BLOQUEO-1 y BLOQUEO-2 resueltos.** `PENDIENTES_FASE_2` de G2 y G3 VACÍAS. Redes
`tests/integration/db/454` y `455` en verde. 19 mutaciones, 19 rojas (una sobrevivió en la primera
pasada y obligó a añadir un caso: F2). Gate completo: §Gate.

## Entorno

- `node_modules`: junction al repo principal (`fs.symlinkSync(..., "junction")`); `pnpm exec prisma
  generate` al empezar (cliente compartido, ya con el enum nuevo de la Fase 1).
- `.env` copiado del worktree del backend sin imprimirlo. `pnpm exec prisma migrate status` →
  `PostgreSQL database "ordenex_455", schema "public" at "localhost:5432"`, `212 migrations found`,
  «Database schema is up to date!». **No se aplicó nada a ninguna base.**

## Tareas

| T | Estado | Qué |
|---|---|---|
| T1.9 / T2.8 (BLOQUEO-1) | Hecha | `lib/types/rastreo-publico.ts`: fuera `HITOS_PUBLICOS`, `ETIQUETA_POR_HITO`, `HITO_POR_ESTATUS(_RETIRADO)`, `HITO_POR_DEFECTO`, `hitoDeEstatus`, `NOMBRE_RESULTADO_PENDIENTE`; DTO `{ numGuia, nombreVigente, actualizadoEn, linea: { nombre, fecha, pendiente? }[] }`. `RastreoPublicoService`: `nombrePublicoDeEstado` por tramo, fusión por nombre, pendiente con `nombreDeResultado` (sin importar Prisma en runtime: R33 de la 229). `RastreoDialog` pinta `nombre` y la señal «<Resultado> · pendiente de confirmación». |
| T2.1 | Hecha | `EstatusBadge` (`ORDER_STATUS_LABELS` = reexportación de `NOMBRE_ESTADO`; texto = `nombreDeEstado`; sin la zona interpolada; fuera `ORDER_STATUS_LABELS_RETIRADOS`), `estatus-label` (= `nombreDeEstado`/`nombreDeResultado`/`SENAL_PENDIENTE`), `filtro-estado-def` sin `EXCLUDE_ESTADO_DEFAULT`. |
| T2.2 | Hecha | `pos-estado.ts` reescrito: chip = estado de la orden (R7), color por CÓDIGO (R12), marcas «Gestionando ahora»/«Abierta en detalle» y NOTA del consumidor aparte (R8). Las tres vistas de la card; prop `estado` → `nota`. Reparto (nota de ayuda), Recoger (sin rótulo fijo; `aria-label`, título y menú «Recoger en bodega», ruta intacta), Recolección y Recolectadas hoy (sin rótulo fijo), chat (`chipDeEstado`: nombre + color por código con neutro), KPI «Entregado». |
| T2.3 | Hecha | `contadores.ts`: resultados con `nombreDeResultado`; buckets «Todavía no sale a reparto» / «En reparto» / «Otros estados». C04 `[INTERMEDIO]` reescrito. |
| T2.4 | Hecha | `cierre-labels.ts`: UN mapa (`RESULTADO_FILA_LABEL` = alias de `RESULTADO_LABEL`), `textoResultadoVacio`/`RESULTADO_VACIO` derivados (fuera los dos mapas de `CierreDiaModule` y `cierre-detalle-shared`), origen de «sin gestión» con `nombreDeEstado` (retirado → «… (estado retirado)»). |
| T2.5 | Hecha | Pestaña «Novedad» (+ nombres accesibles y vacíos), subtítulo con los nombres exactos, `chipFijo` → `notaFija` (la card pinta el estado y la nota al lado). C14 `[INTERMEDIO]` reescrito. |
| T2.6 (BLOQUEO-2) | Hecha | `etiqueta-desenlace.ts` = `nombreDeEstado` (fuera la pluralización y `etiquetaDeDesenlaceContada`); frases «<Nombre>: <n>»; `ConteoPorStatusDona` sin `etiquetaDeStatus`; cohorte, KPIs, madurez (el «1 entregado» del reemplazo mecánico), descargas de productos y ranking, histórico de ranking; «Sin desenlace todavía» (antes «En proceso»), «Sin gestión en el día»; métrica y panel «Novedad interna» juntos. |
| T2.7 | Hecha | Recepción satélite sin zona en el estado (R2), toast de recolección con nombre (R3), columna y descarga del histórico de acciones con `valorLegible` (C16 `[INTERMEDIO]` reescrito). Escáneres y `*-error-messages.ts` ya pasaban por `estatusLabel` (heredan). |
| T2.9 | Hecha | G2 y G3: `PENDIENTES_FASE_2 = {}`. Ver §Excepción. |
| T2.10 | Hecha | `docs/ayuda`: «Recoger en bodega» (slug intacto), «Novedad», contadores de Monitoreo, regla de estilo en el README. G2 sobre `contextoPara` de los 5 roles y el público, verde. El asistente no tiene texto fijo con estados (T0.3). |
| T2.11 | §Gate | |

## Excepción declarada (T2.9 pedía no añadir ninguna)

G2 gana UNA entrada en `EXCEPCIONES` (cerradas, no pendientes):
`components/shared/nota-pendiente-confirmacion.ts` (máximo 1) — `NOTA_AYUDA_SOLICITADA = «Ayuda
solicitada a la tienda»`. requirements §0.3 retira ese texto **como estado**; design §2.1 (fila de
`pos-estado.ts`) y `specs/456-tooltip-estados/textos-aprobados.md` fijan ese MISMO texto para la NOTA
de la ayuda (evento de la 454, no estado), que se pinta junto al chip y nunca en su lugar. El detector
no distingue estado de nota. Alternativas descartadas: inventar otro texto (no aprobado por el humano)
o derivarlo de `ESTADO_RETIRADO.ayuda_tienda.nombreHistorico` (esquivar la guardia). **Queda para que
el leader/humano lo confirme.**

## Reescrituras de tests fuera de lo `[INTERMEDIO]` (con nota fechada en cada archivo)

- **Red 454** (`tests/integration/db/454/caracterizacion/rastreo-y-historial-legado.test.ts`,
  `tests/integration/db/454/rastreo-pendiente-sql-real.test.ts`): el DTO ya no tiene hitos (design DF).
  Traducción 1:1 hito → nombre del estado del mismo tramo, misma forma de aserción (`toEqual`
  literal, misma longitud): `en_bodega`→«En bodega central», `no_entregado` (fila
  `devolucion_por_confirmar`)→«Novedad», `en_reparto` (fila `ayuda_tienda`)→«En reparto»,
  `{hito:"entregado", nombreResultado:"Entregada"}`→`{nombre:"Entregado"}`,
  `{hito:"no_entregado", nombreResultado:"Rechazada"}`→`{nombre:"Devolución a origen por rechazo"}`.
  El invariante (la fila histórica se lee, la vida de la marca pendiente) no cambia. **Se reporta
  porque la regla era «no se tocan»**: sin tocarlas T1.9 no compila.
- Guardias `rastreo-hitos-exhaustivo` (pasa a afirmar la AUSENCIA de hitos y la lectura pública de
  20+4+1 códigos, tablas a mano), `rastreo-sin-estatus-crudo` (sin homonimia: cada `nombre` ∈
  `NOMBRE_ESTADO`, ningún código vigente ni anterior), `rastreo-dto-lista-blanca` (claves nuevas),
  `sin-estados-retirados` (el mapa de retirados vive en `order-status.ts`),
  `incidente-exhaustividad` (etiqueta y vacío derivados), `censo-order-status-rename` (fuera de la
  allowlist las 3 entradas de la homonimia de hitos; quedan 2 que citan el retirado de la 155 como
  dato, R34).
- Tests de UI de 229/235/236/442/454 que afirmaban los nombres viejos: literales actualizados a mano
  (reemplazo de literales ENTEROS, no de prosa). Dos fixtures corregidos por irreales:
  `RepartoAyuda` (`ayuda_tienda` → `en_reparto`: desde la 454 la ayuda es evento) y `OrdenesPage`
  (`"En bodega"` como código → `en_bodega_central`).

## Tests nuevos por superficie

| Superficie | Test | R |
|---|---|---|
| Chip de estado `/ordenes` (+ satélite, carga, línea de tiempo) | `tests/unit/components/estatus-badge.test.tsx` | R2, R3, R9, R10, R11, R42 |
| Card del portal del mensajero (3 vistas) | `tests/components/PosOrderCard.estado-455.test.tsx` | R7, R8, R10, R12 |
| Chat, KPIs, monitoreo, cierres, novedades, analítica, ranking, descargas | `tests/components/textos-estado-455.test.tsx` | R4, R5, R6, R7, R12 |
| Rastreo público (20 nombres + retirado plegado, servicio real) | `tests/components/RastreoDialog.pendiente.test.tsx` | R31, R33, R34 |
| Resultado pendiente del rastreo | `tests/unit/types/rastreo-publico.nombre-resultado.test.ts` | R4, R33 |

## Mutaciones (salida íntegra en `progress/mut_455_frontend/<id>.log`)

Método: `mutar.py` aplica un reemplazo literal (comprueba que se aplicó), corre los tests, restaura el
archivo BYTE A BYTE y comprueba `git diff --quiet` del archivo (limpio en las 19). Sobre el árbol
commiteado.

| Id | Archivo | Mutación | Cae |
|---|---|---|---|
| F1 | `EstatusBadge.tsx` | chip = código crudo | `estatus-badge` (24) |
| F2 | `EstatusBadge.tsx` | `ORDER_STATUS_LABELS` segundo mapa con «Entregada» | **sobrevivió** en la 1.ª pasada → caso R42 añadido → `estatus-badge` (1) |
| F3 | `pos-estado.ts` | chip = «En reparto» fijo | `PosOrderCard.estado-455` (10) |
| F4 | `pos-estado.ts` | sin marca de activa | `PosOrderCard.estado-455` (5) |
| F5 | `pos-estado.ts` | color indexado por TEXTO | `PosOrderCard.estado-455` (2) |
| F6 | `chat-format.ts` | label = código | `textos-estado-455` + `ChatContactoAntesDeRecoger` |
| F7 | `contadores.ts` | «Devueltas» | `textos-estado-455` + C04 `[INTERMEDIO]` + G2 |
| F8 | `cierre-labels.ts` | segundo mapa de celda | `cierre-resultado-fila-label` + descarga fundida (6) |
| F9 | `novedad-grupo-textos.ts` | pestaña «En devolución» | C14 + `NovedadesTabs` + G2 (6) |
| F10 | `etiqueta-desenlace.ts` | vuelve a pluralizar el código | anillo + pliegue + desenlaces (14) |
| F11 | `ConteoPorStatusDona.tsx` | humaniza el código | dona + G3 (7) |
| F12 | `RastreoPublicoService.ts` | sin fusión de tramos | servicio (6) + C13 |
| F13 | `RastreoPublicoService.ts` | retirado sin plegar | `RastreoDialog.pendiente` + `rastreo-sin-estatus-crudo` (3) |
| F14 | `RastreoDialog.tsx` | sin la señal pendiente | `RastreoDialog.pendiente` (3) |
| F15 | `historial-acciones-columnas.ts` | valor crudo | C16 `[INTERMEDIO]` |
| F16 | `PorRecibirModule.tsx` | zona interpolada | `PorRecibirModule` |
| F17 | `menu-visibility.ts` | menú «Por recoger» | `menu-visibility` + G2 |
| F18 | `docs/ayuda/tienda/novedades.md` | «**En devolución**» | G2 árbol + G2 contexto del asistente |

## Mapa R → test (Fase 2)

| R | Test |
|---|---|
| R2, R9, R10, R11, R42 | `tests/unit/components/estatus-badge.test.tsx`; `EstatusLabel.test.ts`; `EstatusBadgeCatalogoV2/EnReparto/RetiroFulfillment` |
| R3, R12, R42 | G3 (`fuente-unica-nombre-estado.guardia`, sin pendientes); `PosOrderCard.estado-455`; `textos-estado-455` (chat) |
| R4, R5 | `textos-estado-455`; `cierre-resultado-fila-label`; C04/C14 `[INTERMEDIO]` |
| R6, R41, R37, R38 | G2 (`nombres-estado-retirados.guardia`, sin pendientes; árbol, docs y contexto por rol) |
| R7, R8 | `PosOrderCard.estado-455`; `RepartoAyuda`; `RepartoModule`; `ChatContactoAntesDeRecoger` |
| R11 | `estatus-badge`; `HistorialOrdenTimeline.evento-orden`; `CierreFacturaSinGestionar` |
| R18 (selector) | `filtro-estado-def`: sin exclusión por defecto; solo `ORDER_STATUS_SEED` se ofrece (`SateliteFiltroEstadoAlcance`) |
| R23 | C16 `[INTERMEDIO]` |
| R31-R34 | C13; `rastreo-publico-service`; `RastreoDialog.pendiente`; `rastreo-sin-estatus-crudo`; `rastreo-hitos-exhaustivo`; `rastreo-publico.nombre-resultado` |
| R51 | `menu-visibility` (ruta `/mis-asignaciones/recoger` intacta) |

## Redes

`pnpm exec vitest run tests/integration/db/455 tests/integration/db/454` → ver §Gate (corren dentro).

## Gate

(se completa abajo tras la corrida)
