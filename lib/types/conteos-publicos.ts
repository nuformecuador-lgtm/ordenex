// Feature 198 — los tres conteos publicos, y nada mas.
//
// ⛔ ESTE CONTRATO NO TIENE ENTRADA, Y ESO ES UNA DECISION DE SEGURIDAD, no una simplificacion.
//
// La accion que lo sirve es PUBLICA por decision humana del 2026-08-10: no valida sesion ni
// rol. En este repo Prisma se conecta con SERVICE ROLE y la capa de aplicacion es la unica
// separacion entre inquilinos (no hay ni una policy RLS en db/migrations/). Un parametro de
// filtro —zona, tienda, mensajero, provincia— en una lectura sin sesion convertiria esta
// accion en un oraculo: cualquiera podria preguntar «cuantas ordenes sin gestionar tiene la
// zona X» y reconstruir el negocio de un inquilino consulta a consulta.
//
// Por eso el unico contrato seguro es este: agregados GLOBALES, sin argumentos. Hay una
// guardia que lo atornilla, porque un dia alguien va a querer «solo un filtrito».

/** Los tres numeros. Nada de listas, ids ni nombres: solo conteos (pedido humano). */
export interface ConteosPublicos {
  /**
   * Distritos con cobertura = distritos con AL MENOS UNA zona, es decir los `distrito_id`
   * DISTINTOS de la tabla puente `zona_distrito`.
   *
   * Se cuenta el distrito y no el par (zona, distrito): un distrito servido por dos zonas es
   * UN distrito cubierto, no dos. Por eso la cuenta va sobre `Distrito` con un `some` —que
   * produce un EXISTS y colapsa los duplicados por construccion— y no sobre las filas del
   * puente, que los contaria dos veces.
   *
   * El camino en el modelo no es directo y conviene no re-descubrirlo: `Distrito` NO tiene
   * `zonaId` —la columna escalar se elimino en la migracion `20260713000000` de la feature
   * 24—. La unica fuente de verdad es la tabla puente N:M `ZonaDistrito`.
   */
  distritosConCobertura: number;
  /**
   * Ordenes con al menos una gestion VIGENTE (no anulada), en todo el historico.
   *
   * Se cuentan ORDENES DISTINTAS, no gestiones: `gestion_orden` no tiene `@@unique(ordenId)`
   * —una orden reintentada acumula varias— y contar filas de gestion haria que los numeros
   * sumaran mas que el total de ordenes. Es la misma trampa que la feature 192 dejo
   * documentada en su ficha.
   */
  ordenesGestionadas: number;
  /** Ordenes sin ninguna gestion vigente. Complementario del anterior sobre el mismo universo. */
  ordenesSinGestionar: number;
}
