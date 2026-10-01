// Ficha 465 (design §3.2) — contrato del repositorio del Excel de cobertura por distrito.
//
// DE SOLO LECTURA (R21): no hay ni un metodo de escritura, y el test del servicio comprueba que
// el doble del repositorio solo expone estos dos.

/** Un distrito del catalogo con su cadena y TODAS sus zonas, SIN colapsar. */
export interface DistritoCoberturaRow {
  provincia: { nombre: string; activo: boolean };
  canton: { nombre: string; activo: boolean };
  distrito: { nombre: string; activo: boolean; zonaEspecial: boolean | null };
  /** Disponibilidad efectiva (`disponibleDesdeCadena`), calculada en el repositorio. */
  disponible: boolean;
  /**
   * TODAS las zonas de `zona_distrito`. Sin colapsar a proposito: `GeoRepository.listArbol` ya
   * colapsa >1 a `null` y asi no se distingue «sin zona» de «varias zonas» (R9, R11). El colapso
   * 1/0/>1 se aplica en la regla pura, con `zonaUnicaDeDistrito`.
   */
  zonas: { id: string; nombre: string; esCentral: boolean }[];
}

export interface ICoberturaRepository {
  /** Todos los distritos del catalogo, ACTIVOS E INACTIVOS (R4). Sin orden garantizado. */
  listDistritos(): Promise<DistritoCoberturaRow[]>;

  /**
   * Los `zona_id` que tienen tarifa GENERAL: `tienda_id IS NULL AND zona_id IS NOT NULL` (nivel 3
   * de la cascada). La fila (NULL, NULL) NO cuenta (R14). Sin duplicados.
   */
  listZonaIdsConTarifaGeneral(): Promise<string[]>;
}
