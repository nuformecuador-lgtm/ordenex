// FICHA 469 (T11, design §4.3/§5; R21, R22, R25, R26, R35) — los textos de la BÚSQUEDA POR GUÍA del libro,
// COMPARTIDOS por la caja (`/wallet`), los estados de cuenta de la oficina (tienda y mensajero) y
// `/mi-wallet`. Escritos UNA vez: la caja y el estado de cuenta dicen el mismo aviso con la misma frase.
// (El design los colocaba en `libro-caja-labels.ts` y en `estado-cuenta-labels.ts`; dos copias de un
// literal que es contrato serían dos definiciones que pueden divergir.)
//
// Sin siglas y sin jerga (R35). Los placeholders del buscador NO viven aquí: cada superficie busca en
// campos distintos y su placeholder va junto a ella (R24; la satélite no nombra la guía, R36).

export const BUSQUEDA_POR_GUIA_TEXTO = {
  /** R21 — el aviso junto a la barra, SOLO con la lectura pintada en modo guía (R23). */
  aviso: (termino: string) =>
    `Guía o remisión «${termino}»: solo se muestran los movimientos en los que esa orden aporta dinero.`,
  /** R22 — búsqueda por guía sin ningún movimiento. */
  vacio: "Esa guía o remisión no aporta dinero a ningún movimiento de este libro con los filtros elegidos.",
  /** R25/R26 — el rótulo del bloque destacado y el texto (no solo color) de la fila resaltada. */
  guiaBuscada: "Guía buscada",
  /** R25 — nombre accesible del bloque destacado del detalle de UNA fila. */
  bloque: (concepto: string, fecha: string) => `Guía buscada en ${concepto} del ${fecha}`,
} as const;
