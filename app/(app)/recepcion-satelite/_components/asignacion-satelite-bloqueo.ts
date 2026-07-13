// Feature 41 (R22) — textos i18n-ready y compositor del mensaje accionable de bodega
// satelite BLOQUEADA. Regla estricta R17 (F1.4-Q4): el bloqueo puede provenir de dos
// causas simultaneas o por separado; el mensaje DIFERENCIA cada una:
//   (i)  `porMensajeros`     -> hay cierres de sus mensajeros sin resolver.
//   (ii) `porCierreBodega`   -> su propio cierre de bodega hacia la central sigue
//        pendiente de aprobacion.
// Se reutiliza tanto en el aviso proactivo (RecepcionSateliteModule) como en el toast
// reactivo cuando la Server Action devuelve `bodega_bloqueada` (AsignarSateliteModal).

export type BodegaBloqueoCausa = {
  porMensajeros: boolean;
  porCierreBodega: boolean;
};

/** Encabezado comun del aviso (por que no se puede asignar). */
export const BODEGA_BLOQUEADA_TITULO =
  "No puedes asignar órdenes: tu bodega tiene cierres pendientes de resolver.";

/** Causa (i): cierres de los mensajeros de la zona sin resolver. */
export const BODEGA_BLOQUEADA_POR_MENSAJEROS =
  "Resuelve los cierres pendientes de tus mensajeros.";

/** Causa (ii): el propio cierre de bodega hacia la central sin aprobar. */
export const BODEGA_BLOQUEADA_POR_CIERRE_BODEGA =
  "Tu cierre de bodega hacia la central está pendiente de aprobación.";

/**
 * Compone las lineas accionables segun la(s) causa(s) activa(s). Devuelve un arreglo
 * (no un string) para que la UI las liste; vacio si no hay causa (defensivo).
 */
export function bodegaBloqueadaLineas(causa: BodegaBloqueoCausa): string[] {
  const lineas: string[] = [];
  if (causa.porMensajeros) lineas.push(BODEGA_BLOQUEADA_POR_MENSAJEROS);
  if (causa.porCierreBodega) lineas.push(BODEGA_BLOQUEADA_POR_CIERRE_BODEGA);
  return lineas;
}

/** Mensaje de una linea (titulo + causas) para el toast reactivo. */
export function bodegaBloqueadaMensaje(causa: BodegaBloqueoCausa): string {
  const lineas = bodegaBloqueadaLineas(causa);
  return lineas.length > 0
    ? `${BODEGA_BLOQUEADA_TITULO} ${lineas.join(" ")}`
    : BODEGA_BLOQUEADA_TITULO;
}
