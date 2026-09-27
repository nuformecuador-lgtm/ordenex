// FICHA 458-D (T D.5; R34, R10, R78) — los textos de `/mi-wallet` como estado de cuenta de la propia
// tienda. Módulo PURO. Segunda persona, como el resto de la pantalla; sin siglas ni ids.

export const MI_ESTADO_CUENTA_PAGINA = {
  titulo: "Mi wallet",
  descripcion:
    "Tu estado de cuenta con Ordenex: cada movimiento con su saldo corrido, lo cobrado a tus clientes, lo que Ordenex te cobró y lo que te pagó",
} as const;

export const MI_ESTADO_CUENTA_TEXTO = {
  /** R10 (335) — el selector de cierre, con sus avisos de siempre. */
  cierre: "Cierre",
  filtrarPorCierre: "Filtrar por cierre",
  todosLosCierres: "Todos los cierres",
  cierresNoDisponibles: "No pudimos cargar tus cierres. Probá recargando la página.",
  sinCierres: "Todavía no hay cierres en tu wallet.",
  cierresRecientes: "Mostramos los cierres más recientes.",
  /** R78 — la columna de la única acción por fila: ver el comprobante que subió Ordenex. */
  comprobante: "Comprobante",
} as const;

/**
 * FICHA 458-D (revisión m3, R25 en `/mi-wallet`; decisión del leader, 2026-09-26) — la leyenda de un
 * movimiento anulado, dicha a la tienda: QUIÉN es Ordenex (nunca el nombre de la persona, que el
 * servidor tampoco manda), el día y la hora de Costa Rica, y el motivo (o «motivo no registrado»).
 */
export function textoAnuladoMiWallet(a: { motivo: string | null; fecha: string | null; hora: string | null }): string {
  const cuando = a.fecha === null ? "" : a.hora === null || a.hora === "" ? ` el ${a.fecha}` : ` el ${a.fecha} a las ${a.hora}`;
  return `Anulado por Ordenex${cuando} · ${a.motivo ?? "motivo no registrado"}`;
}
