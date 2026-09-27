/**
 * ⭑ FICHA 431 (R7) — LA CONSOLIDACION QUE ENLAZARIA MENOS CIERRES DE LOS QUE SUMO.
 *
 * Modulo PURO (`lib/utils/`): sin Prisma, sin React, sin Next. Lo lanza
 * `CierreBodegaRepository.crearCierreBodega` dentro de su `$transaction` y lo traduce
 * `CierreBodegaService.solicitarCierreBodega`. Vive aparte para que el repositorio y el servicio lo
 * compartan sin que ninguno importe al otro — mismo motivo y mismo sitio que
 * `CierreDetalleFaltanteError` (`lib/utils/cierre-detalle.ts`).
 *
 * POR QUE ES UN ERROR DURO Y NO UN RESULTADO. Los totales snapshot de la consolidacion
 * (`total_general`, `total_pago_mensajero`, `total_ingreso_bodega_rechazos`) se calculan sobre el
 * conjunto ENTERO antes de escribir. Si el `updateMany` que vincula los `cierre_dia` afecta menos
 * filas de las pedidas —porque otra consolidacion simultanea se llevo parte de la cola—, la fila
 * que quedaria DECLARA MAS DINERO DEL QUE LLEVA. Lanzar aborta la transaccion y no deja ni la fila
 * ni los enlaces; el servicio responde `conflict` y quien lo intento vuelve a pedirlo con la cola
 * que quede.
 *
 * ⚠️ ESTE ES EL SUSTITUTO DEL INDICE UNICO PARCIAL `cierre_bodega_zona_solicitado_uq`, que la ficha
 * BORRA. Aquel impedia la carrera impidiendo la segunda consolidacion ENTERA —y con la aprobacion
 * convertida en marca de conciliacion habria sido el mismo bloqueo mudado de sitio—. Esto impide
 * exactamente lo que habia que impedir: que dos consolidaciones se repartan el mismo conjunto.
 *
 * El patron es el de `OrdenRepository.asignarRecoleccionLote` (`result.count !== ids.length` ->
 * throw), que ya vive en este repositorio.
 */
export class ConsolidacionParcialError extends Error {
  constructor(
    readonly vinculados: number,
    readonly esperados: number,
  ) {
    super(
      `crearCierreBodega: se vincularon ${vinculados} de ${esperados} cierres del dia. ` +
        `La consolidacion se aborta: sus totales snapshot se calcularon sobre el conjunto entero, ` +
        `asi que una consolidacion parcial declararia mas dinero del que lleva (ficha 431/R7).`,
    );
    this.name = "ConsolidacionParcialError";
  }
}
