# Feature 455 — Corrección de la revisión (RECHAZADA) y del recorrido T3.2

> frontend_dev · 2026-09-24 · rama `feature/455-fix` = `fd5b64de` + `origin/review/455` + `origin/feature/455-recorrido`.
> Base: clon `ordenex_455` (`prisma migrate status` → `ordenex_455` en `localhost:5432`, 212 migraciones, al día);
> `.env` copiado sin imprimir; `node_modules` por junction; `prisma generate` hecho.
> Búsqueda: el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) se usó para localizar el lector
> del rastreo (su índice aún listaba `hitoDeEstatus`, ya retirado: se confirmó todo en el archivo real). Los textos
> se localizaron con la propia guardia G2 reforzada, que es la red de este arreglo.

## Criterio de redacción (del leader, con el mandato del humano)

(a) Si un texto nombra un estado: su nombre EXACTO de `NOMBRE_ESTADO`, leído de la fuente (`nombreDeEstado`) donde se
puede. (b) Si un rótulo usa un participio que es o parece un estado viejo: el nombre nuevo o una forma neutra, en
masculino (se habla del paquete), con el voseo/tuteo de la pantalla y con tildes.

## Lo hecho, punto por punto

| Punto | Antes | Ahora | Archivo |
|---|---|---|---|
| M1 | «Alguna orden ya no está en estado “Por devolver”.» | «… “${nombreDeEstado(por_devolver_a_bodega_central)}”» = «Por devolver a bodega central» | `app/(app)/ordenes/_components/envio-devolucion-central-error-messages.ts` |
| F1 | columna «Reprogramada para» | «Reprogramado para» | `ordenes-columns.tsx` (+ comentarios de `OrdenesListado`, `CorregirFechaReprogramacionModal`) |
| F2 | contador «Asignadas» (totales y tarjeta; nombre accesible «N asignadas para hoy») | «Asignados» / «N asignados para hoy» | `monitoreo/_components/TableroDiaTotales.tsx`, `MensajeroCard.tsx` |
| F3 | «Órdenes sin gestionar» (título, lista, aviso de cierre antiguo) | «Pasaron a Novedad interna», «Lista de órdenes que pasaron a Novedad interna», «Este cierre es anterior al registro de las órdenes que pasan a Novedad interna: …» (nombre leído de la fuente) | `cierres-admin/_components/cierre-factura.tsx` |
| F3 | «Tenes ordenes sin gestionar; gestionalas antes de cerrar.» | «Tenés paquetes en reparto que todavía no gestionaste; gestionalos antes de cerrar.» | `lib/services/CierreDiaService.ts` |
| F3 | panel de analítica «Órdenes sin gestionar» y su nota; descripción de la métrica | «Órdenes en Novedad interna»; «Cuenta las órdenes en Novedad interna de cada día, …»; «ORDENES en Novedad interna HOY, …» | `analitica/_components/operativo/catalogo-paneles.ts`, `textos.ts`, `lib/analytics/metrics.ts` |
| F3 | motivo de la devolución automática al aprobar: «rechazada al aprobar el cierre: sin gestionar y …» | «Devolución a origen por rechazo al aprobar el cierre: estaba en Novedad interna y sin intentos de entrega disponibles» (filas NUEVAS; las escritas no se tocan) | `lib/repositories/CierresAdminRepository.ts` |
| F4 | pestaña «Rechazadas por plazo vencido» | «Devolución a origen por plazo vencido» | `novedades/_components/NovedadesTabs.tsx` |
| F4 | lista y vacío «órdenes rechazadas por plazo vencido»; «Cuando una de tus órdenes en devolución llegue a rechazo …» | «Órdenes con devolución a origen por plazo vencido»; «Cuando una de tus órdenes en Novedad pase a Devolución a origen por rechazo por vencerse el plazo, aparecerá acá.» | `RechazosSlaModule.tsx` |
| F4 | modal «… y la orden se cierra como rechazada.»; éxito «Orden rechazada. …»; carrera «ya no estaba en devolución» | «… y la orden pasa a Devolución a origen por rechazo.»; «La orden pasó a Devolución a origen por rechazo. …»; «Esta orden ya no estaba en Novedad, …» | `RechazarNovedadModal.tsx` |
| F5 | «(entregadas y rechazadas de N órdenes)», «terminaron entregadas», «Detalle de las ordenes», «Detalle - Movimiento de las ordenes», aviso del desglose y pista del flete con «entregadas, rechazadas … en proceso» / «las rechazadas» | «(Entregado y Devolución a origen por rechazo de N órdenes)», «terminaron en Entregado», «Detalle de las órdenes», «Detalle - Movimiento de las órdenes», «… un solo grupo: Entregado, Devolución a origen por rechazo, los demás resultados y Sin desenlace todavía …», «… IVA de las órdenes en Devolución a origen por rechazo …» | `KpisEfectividad.tsx`, `madurez-textos.ts`, `ConteoPorStatusDona.tsx`, `analitica/page.tsx`, `ProductosTabla.tsx`, `DineroProductoDetalle.tsx` |
| F6 | «Entregadas / asignadas», «Efectividad · entregadas / asignadas · hoy», «(entregadas / asignadas)», columna «Asignadas» (descarga e histórico), premios «N / M entregadas», «Entregadas de asignadas ese día» | «Entregados / asignados», «Efectividad · entregados / asignados · hoy», «(entregados / asignados)», «Asignados», «N / M entregados», «Entregados de asignados ese día» | `ranking-labels.ts`, `RankingModule.tsx`, `ranking-descarga-columnas.ts`, `ranking-historico-labels.ts`, `wallet-mensajeros-labels.ts` |
| F7 | «4 asignadas» / «1 asignada» | «4 asignados» / «1 asignado» | `mis-asignaciones/_components/chat/chat-contactos.ts` |
| F8 | «Recolectadas hoy», «Recolectada a las», «N órdenes recolectadas hoy.», aria «Órdenes recolectadas hoy» | «Recogidos en tienda hoy», «Recogido a las», «N paquetes recogidos en tienda hoy.», «Paquetes recogidos en tienda hoy» | `recoleccion/_components/RecolectadasHoyLista.tsx` |
| G2 nuevo | «por recoger» (retirado «Por recoger») en Recoger en bodega; «N órdenes nuevas asignadas»; «La orden ya no está por recoger.» | «para recoger» (como sus pestañas «Para recoger hoy»), «N órdenes nuevas para recoger», «La orden ya no está en «Mensajero recogiendo en la bodega».» (de la fuente) | `recoger-grupos.ts`, `RecogerModule.tsx`, `useRecogerPorGuia.ts` |
| G2 nuevo | «… sobre órdenes ya asignadas.», «… que estén asignadas desde tu bodega.» | «… sobre órdenes que ya tienen mensajero.», «… que se hayan asignado desde tu bodega.» | `corregir-dia-reparto-error-messages.ts`, `deshacer-asignacion-error-messages.ts` |
| F11 | ayuda del mensajero y de la tienda con las etiquetas viejas | alineada con todo lo anterior (cierre del día, recoger en bodega, ranking, recolección, reparto, novedades); `docs/api/manual-metricas-por-mensajero.md` «una orden sin gestionar» → «una orden que todavía no tiene gestiones». El asistente arma su contexto de esos docs (G2 lo barre rol por rol: verde) y no tiene texto fijo propio con nombres retirados | `docs/ayuda/mensajero/{cierre-del-dia,por-recoger,ranking,recoleccion,reparto}.md`, `docs/ayuda/tienda/novedades.md` |
| F9 | rastreo: la fila retirada `devolucion_por_confirmar` plegada a «Novedad» y la gestión pendiente del MISMO instante salían dos veces, fuera de orden (la fila de la migración 454 en medio) y con clave React duplicada | mientras la gestión siga pendiente, la fila retirada del mismo instante no se publica (la pendiente la sustituye) y la racha de «En reparto» se funde: línea cronológica, sin duplicados; la clave de `<li>` lleva posición y marca | `lib/services/RastreoPublicoService.ts`, `app/_landing/RastreoDialog.tsx` |
| F10 | «Motivo: migracion 454: retiro de devolucion_por_confirmar» | «Motivo: Migración: retiro de Devolución por confirmar (estado retirado)» (formato de R11, de la fuente); transformación SOLO de presentación, sin tocar migraciones ni filas | `app/(app)/ordenes/_components/motivo-historial.ts` (nuevo), `HistorialOrdenTimeline.tsx` |
| M3 | G2: igualdad exacta o cita entre `«»`/`""` | + comillas `“”`; + brazo «contiene» (palabra completa, tras borrar los nombres vigentes y el formato de R11), + plurales femeninos en minúscula, + frases retiradas en cualquier caja; la excepción `NOTA_AYUDA_SOLICITADA` (y la de `order-status.ts`) se acota por TEXTO | `tests/unit/guards/nombres-estado-retirados.guardia.test.ts` |
| M4 | `tasks.md` sin marcar T1.9, T1.13, T2.1-T2.11; tabla R→test con 11 archivos inexistentes | marcadas (con nota fechada en T1.9 y T1.13); tabla reescrita con archivos reales (comprobados en disco por script) | `specs/455-un-nombre-por-estado/tasks.md` |

### Límite declarado de la G2 reforzada

El singular femenino en minúscula («la orden fue entregada», «Guía 123 recolectada») es prosa y NO se marca; el plural
en minúscula junto a un sustantivo («órdenes asignadas para hoy», «guías asignadas») es adjetivo de prosa y tampoco.
Lo demás (mayúscula de rótulo, plural suelto, frases retiradas) sí. Los casos «sano» del propio archivo fijan este
límite.

## Tests por texto cambiado

- `tests/unit/components/textos-455-recorrido.test.ts` (nuevo): M1, F4, F5, F6, F7 y el motivo de F3, con literales
  escritos a mano.
- `tests/components/RechazarNovedad.test.tsx` › «455/F4 — la ventana nombra el estado al que pasa la orden» (nuevo).
- `tests/components/RechazosSlaModule.test.tsx` (vacío con su detalle nuevo), `ConteoPorStatusDona.test.tsx` (título
  con tilde), `HistorialOrdenTimeline.motivo-migracion.test.tsx` (nuevo, F10), `RastreoDialog.pendiente.test.tsx`
  › «455/F9 …» (nuevo), `tests/integration/db/455/rastreo-retirado-y-pendiente-sql-real.test.ts` (nuevo, F9).
- Actualizados al texto nuevo (literal que ERA el contrato del texto viejo): `ordenes-columns`, `ordenes-listado`,
  `TableroDiaTarjetas`, `PremiosRankingPanel`, `ranking-descarga-columnas`, `ranking-historico-descarga-columnas`,
  `chat-contactos`, `ChatContactoAntesDeRecoger`, `RecoleccionModule`, `RecoleccionPage`, `CierreFacturaSinGestionar`,
  `CierreRechazosDeTienda`, `CierreDiaModule`, `cierre-dia-service` (+ `toBe` exacto), `TableroOperativo`,
  `etiquetas-visibles.guardia`, `NovedadesTabs`, `RechazarNovedad`, `RechazosSlaModule`, `AnaliticaPage`,
  `EfectividadHeroe`, `FilaKpisVocabulario`, `KpisEfectividad`, `RecogerModule`, `recoger-grupos`.
- Redes `tests/integration/db/454` y `455`: ninguna aserción tocada; el único archivo nuevo en `455/` es el de F9.

## Mutaciones (secuenciales, nunca con el gate; restauración comprobada)

Harness `mutar.py` (scratchpad, de un solo uso, no versionado): reemplazo comprobado (exactamente 1 aparición),
vitest sobre los archivos indicados, restauración byte a byte comprobada por sha256 en cada una (`restaurado=si` en las
14). Árbol limpio al terminar.

| Id | Pieza | Mutación | Resultado |
|---|---|---|---|
| V1 | G2, comillas `“”` | quitar `“”` de `CITADO_EN_CODIGO` | VERDE — **superviviente EQUIVALENTE**: el brazo «contiene» también ve «“Por devolver”». Contraprueba: con V2 (brazo «contiene» apagado) el caso M1 sigue verde porque lo caza la cita; cada brazo ve M1 solo |
| V2 | G2, brazo «contiene» | `contenidoRetirado` devuelve siempre `null` | ROJO: «MUTACION (M2 y F1-F8)» |
| V3 | G2, excepción por texto | ignorar `textos` de la excepción | ROJO: «MUTACION (m1)» |
| V4 | M1 | el error vuelve a «“Por devolver”» | ROJO: G2 árbol + `textos-455-recorrido` (M1) |
| V5 | F2 | `ETIQUETA_ASIGNADAS = "Asignadas"` | ROJO: G2 árbol + `TableroDiaTarjetas` (2) |
| V6 | F11 | `recoleccion.md` vuelve a «## Recolectadas hoy» | ROJO: G2 árbol + G2 contexto del asistente |
| V7 | F3 | el aviso vuelve a «Tenés órdenes sin gestionar; …» | ROJO: G2 árbol + `cierre-dia-service` (toBe exacto) |
| V8 | F4 | la pestaña vuelve a «Rechazadas por plazo vencido» | ROJO: G2 árbol + `NovedadesTabs` |
| V9 | F9 lector | la fila retirada ya no se descarta (`fecha === "__MUT__"`) | ROJO: `455/rastreo-retirado-y-pendiente-sql-real` (2: una vez y cronológico) |
| V10 | F9 página | la clave vuelve a `nombre-fecha` | ROJO: `RastreoDialog.pendiente` «455/F9» (React avisa de clave duplicada) |
| V11 | F10 | `motivoVisible` devuelve el motivo crudo | ROJO: `HistorialOrdenTimeline.motivo-migracion` (2) + `EstatusBadgeRetiroFulfillment` |
| V12 | revisión V9 (m1) | `NOTA_AYUDA_SOLICITADA = "Sin gestionar"` | ROJO: G2 árbol + «cada excepción … con su texto» (antes sobrevivía en G2) |

## Redes

- `tests/integration/db/454` + `455` (con el archivo nuevo de F9): **69 archivos / 344 tests, 0 skipped, exit 0**.
- `tests/unit` + `tests/components` completos tras los cambios: 5 rojos, todos por textos/guardias de este arreglo y
  corregidos (censo 155 en un comentario y un test nuevos, `sin_gestionar` en un caso de G2, literal de estatus en
  `RechazarNovedadModal` → `NOMBRE_ESTADO.*`, la guardia `catalogo-universo` que pegaba «sin gestionar» a HOY, y el
  motivo de la 155 en `EstatusBadgeRetiroFulfillment`); reejecutados en verde.

## Deuda anotada

- F10: la transformación cubre SOLO los motivos de las migraciones de retiro (`migracion <n>: retiro de <retirado>`);
  si otra migración futura escribe un motivo técnico distinto, se pintaría tal cual.
- Las filas YA escritas con «rechazada al aprobar el cierre: sin gestionar …» (motivo sintético de la 276) siguen
  diciendo eso: es texto guardado, igual que las notificaciones ya emitidas (O2 del recorrido).
