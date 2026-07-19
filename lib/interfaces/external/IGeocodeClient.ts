// Feature 91 (design §3) — contrato del proveedor de geocodificacion. Vive en
// `interfaces/external/` (docs/architecture.md §Interfaces) junto a IEmailProvider /
// IFileStorage / ISignedUrlProvider.
//
// El cliente TRADUCE los estados del proveedor a un vocabulario de DOMINIO y NO decide
// que hacer con ellos: la politica (completar el job vs lanzar para reintento) vive en
// `GeocodificacionService` (design §5). Asi la tabla de decision de R21-R25 es testeable
// sin red y sin credencial.

export type GeocodeOutcome =
  /** Resultado satisfactorio. `crudo` es la respuesta del proveedor tal cual (cache). */
  | { status: "ok"; latitud: number; longitud: number; precision: string; crudo: unknown }
  /** ZERO_RESULTS: la direccion no resuelve. Determinista: reintentar no la mejora. */
  | { status: "sin_resultados" }
  /** INVALID_REQUEST: consulta malformada. Determinista. */
  | { status: "consulta_invalida" }
  /** OVER_QUERY_LIMIT | UNKNOWN_ERROR | HTTP 5xx | fallo de red. Reintentable. */
  | { status: "transitorio"; detalle: string }
  /** REQUEST_DENIED: credencial o facturacion rota. Debe ser RUIDOSO, nunca silencioso. */
  | { status: "config_invalida"; detalle: string };

export interface IGeocodeClient {
  /**
   * Resuelve `query` contra el proveedor. NUNCA lanza por un estado de negocio: todos los
   * desenlaces se devuelven como `GeocodeOutcome`. Solo lanza si la respuesta no cumple el
   * contrato esperado (R19), y ese error NO contiene la credencial, la URL ni la direccion.
   */
  geocodificar(query: string): Promise<GeocodeOutcome>;
}
