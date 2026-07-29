# Review — Feature 151 · Descarga del dataset completo desde el DataTable

- **Worktree:** ordenex-151 · rama `feature/151-descarga-datatable` (base `origin/dev` @ 613561b)
- **Fecha:** 2026-07-29 · **Rol:** reviewer (no se editó código; toda mutación de prueba fue revertida)
- **Veredicto: APROBADO CON NOTAS** — 0 bloqueantes, 6 menores.

## Checklist CHECKPOINTS.md

| Punto | Estado |
| --- | --- |
| requirements.md EARS numerado R1–R38 | OK (+ gate F1.4 aprobado al final) |
| design.md con alternativas descartadas y su porqué | OK (A1–A5) |
| tasks.md con todas las tasks [x] | OK (T1–T14) |
| Cada R mapea a un test concreto | OK (38/38, verificados uno a uno contra los archivos reales) |
| progress/impl_151.md con el mapa R -> test | OK |
| pnpm run typecheck | OK — 0 errores (medido por el reviewer) |
| pnpm run lint | OK — 0 errores / 10 warnings (los 10 preexistentes) |
| pnpm test | OK — 578 archivos / 6275 tests / 0 fallos |
| E2E en flujo crítico | N/A: lectura de un listado; no toca auth, pagos, recaudo, ingesta ni webhooks |
| RLS en tabla nueva | N/A: sin tabla nueva, sin migración, sin cambio de modelo |
| Migración con down.sql / rollback | N/A; init.sh valida el invariante global y pasa |
| Secretos hardcodeados | Ninguno; el tope va por DESCARGA_MAX_FILAS en lib/config/descarga.ts |
| Webhooks (firma / idempotencia) | N/A |
| Capas | OK: la action resuelve actor, parsea y delega; el service no toca HTTP; no se añadió ningún método al repositorio |
| Interfaces en lib/interfaces/ | OK (IOrdenService ampliada) |
| Server Actions, sin route handler nuevo | OK: no se abrió nada bajo app/api/ |
| Sin hardcode de país, moneda ni contexto | OK |
| ./init.sh verde | OK (== init OK ==) |
| progress/review_151.md con veredicto | este archivo |
| Entrada en progress/history.md | PENDIENTE (cierre del leader, ver menor 6) |

## Decisiones del gate (vinculantes)

- **P1 — N = 5000 configurable por DESCARGA_MAX_FILAS.** lib/config/descarga.ts:22 es el único literal; OrdenService.listarCompleto devuelve `limite_excedido {total, limite}` SIN items, y el consumidor redacta un mensaje con el total, el tope y la instrucción de acotar los filtros. Nunca truncado silencioso. **Cumple.**
- **P2 — DTO completo sin proyección server-side.** ListarOrdenesCompletoServiceResult.items es OrdenListItemDTO[]; la proyección a columnas ocurre en el cliente (filaDescargaOrden). **Cumple.**
- **P3 — Sin route handler; filas por Server Action y binario en el navegador.** Nada nuevo bajo app/api/; DescargarDatasetButton importa construirDescarga de forma dinámica y entrega con descargarBlob. **Cumple.**
- **P4 — Control encima de la tabla, dentro de DataTable.** components/shared/DataTable.tsx antepone el control al contenedor de scroll. **Cumple.**
- **P5 — Sin permiso nuevo.** listarCompleto comparte construirWhere con listar; no se añadió rol ni permiso. **Cumple.**

## Invariantes de diseño

1. **Generador ciego al dominio.** lib/utils/descarga-dataset.ts sólo importa lib/types/descarga, csv-template y xlsx-template. buildXlsxRows, XLSX_MIME y descargarBlob se reusan SIN modificarse (su git diff está vacío); csv-template.ts sólo recibe la función hermana buildCsvRows, con buildCsvTemplate intacto. OK.
2. **Acotamiento por rol (riesgo número uno).** listar y listarCompleto llaman AMBOS a this.construirWhere(input, actor); no existe otra construcción del where ni rama alternativa, y el acotamiento (tiendaId para adminTienda, mensajeroAsignadoId para mensajero) se escribe AL FINAL, pisando el filtro. El guard KNOWN_ROLES corre antes de tocar el repositorio. El test de R18 afirma además que el where es idéntico en ambos caminos. OK, y confirmado por mutación (M2).
3. **DataTable recibe una FUNCIÓN.** obtenerFilas es `() => Promise<DescargaFilasResult>`; no llegan url ni filtros, y datatable-descarga-contrato.test.ts custodia estáticamente los imports y los miembros exactos del contrato. OK.
4. **Columnas de export aparte, con valor crudo.** COLUMNAS_DESCARGA_ORDENES y filaDescargaOrden emiten string, number o null; el test comprueba que ninguna celda es objeto, array, función ni ReactElement, y que no salen ids ni banderas de borrado. OK.
5. **Alcance.** El único consumidor cableado es el listado de órdenes (`descarga=` aparece exclusivamente en OrdenesModule.tsx). El rollout de la 145 queda fuera. OK.

## Trazabilidad

R1–R38 revisados contra el test citado en tasks.md e impl_151.md. Todos verifican comportamiento, no compilación: los del servicio corren contra un repositorio en memoria que evalúa el where de verdad; los de construirDescarga releen el xlsx con exceljs (round-trip real); los de UI ejercitan clicks reales con userEvent. No se detectó ningún test vacío ni assert trivial.

Comprobación adicional de coherencia: el listado paginado y la descarga envían el MISMO objeto filter a sus respectivas actions (serializarFiltro sólo alimenta la key de SWR), así que R34 y R36 se sostienen también en producción, no sólo con la action mockeada.

## Mutaciones (todas revertidas)

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | tope por defecto 5000 -> 250 en lib/config/descarga.ts | muerta: 2 fallos en descarga-config.test.ts |
| M2 | listarCompleto construye el where con rol maestro (se salta el acotamiento) | muerta: 3 fallos (R12 adminTienda, R12 mensajero, R16) |
| M3 | guard de tope: total > limite pasa a total > limite * 100 | muerta: 3 fallos (R20, R21, R22) |
| M4 | despacho por tipo: la rama csv deja de tomarse | muerta: 5 fallos (unit + round-trip) |
| M5 | se anula el guard de reentrada enVueloRef | SUPERVIVIENTE (ver menor 2) |
| M6 | se quita disabled/loading del botón | muerta: 1 fallo (R26) |

Tras revertir, las 5 suites de la feature vuelven a verde (34/34) y git status coincide exactamente con el estado previo a la revisión.

## Hallazgos

1. **menor — superficies sin descarga.** El fallback de app/(app)/ordenes/page.tsx (adminSatélite y mensajero) monta OrdenesModule con permitirDescarga en su default false, así que ese listado no ofrece la descarga. Es exactamente lo que pide design §7, aprobado en el gate, pero una lectura estricta de R33 deja esa superficie fuera. Decisión de producto, no defecto de implementación.
2. **menor — guard de reentrada sin cobertura propia (M5 superviviente).** La no reentrada la garantizan dos mecanismos: disabled={generando} (cubierto: M6 muere) y enVueloRef (defensa en profundidad, sin test propio). R26 queda verificado por su vía observable; el ref es redundancia no cubierta.
3. **menor — nombre de hoja sin sanitizar.** El título va tal cual a buildXlsxRows; Excel limita el nombre de hoja a 31 caracteres y prohíbe varios símbolos. Con "Órdenes" no hay problema; el rollout de la 145 debe resolverlo.
4. **menor — zona horaria del nombre de archivo.** nombreArchivoDescarga usa los componentes LOCALES del navegador, mientras la columna "Fecha de creación" usa el calendario de Costa Rica. Un usuario fuera de CR puede ver un archivo fechado un día antes o después que sus datos. Cosmético.
5. **menor — ordenes-descarga-columnas.ts arrastra React transitivamente** vía estatus-label y EstatusBadge. No afecta a los tests (corren en node) ni al valor emitido; es un acoplamiento preexistente de ORDER_STATUS_LABELS.
6. **menor — bookkeeping pendiente (leader).** feature_list.json sigue en in_progress y no hay entrada en progress/history.md. Son pasos de cierre, no del implementer.

## Verificación medida por el reviewer

| Comando | Baseline 613561b | Medido ahora |
| --- | --- | --- |
| pnpm run typecheck | 0 errores | 0 errores |
| pnpm run test | 569 archivos / 6218 tests / 0 fallos | 578 archivos / 6275 tests / 0 fallos (+9 archivos, +57 tests) |
| pnpm run lint | 0 err / 10 warn | 0 err / 10 warn |
| ./init.sh | — | == init OK == |

El flake conocido de tests/unit/guards/no-embalaje.test.ts no se manifestó en ninguna de las dos corridas completas de la suite.

## Veredicto

**APROBADO CON NOTAS (OK).** Sin bloqueantes: las cinco decisiones del gate se respetan al pie de la letra, los cinco invariantes de diseño se sostienen en el código real, R1–R38 tienen un test que verifica comportamiento y cuatro de las cinco mutaciones críticas mueren. Los 6 hallazgos son menores y ninguno exige devolver la feature al implementer.
