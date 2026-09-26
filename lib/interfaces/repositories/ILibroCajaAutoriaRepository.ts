/**
 * FICHA 458-B (design §3.4, R56/R57) — las lecturas EN LOTE con las que se resuelve, para una pagina
 * del libro de la caja, «A quien» y «Registro». SOLO queries: una por tipo de origen PRESENTE en la
 * pagina (ninguna si no hay filas de ese tipo). Devuelven NOMBRES (con la funcion unica de nombre del
 * repo) y los ids de cuenta solo para el enlace, que viajan y no se pintan.
 */
export interface CuentaNombrada {
  tipo: "tienda" | "mensajero";
  id: string;
  nombre: string;
}

export interface MovimientoDeCajaParaAutoria {
  id: string;
  origenTipo: string;
  origenId: string | null;
  registradoPor: string | null;
}

export interface ILibroCajaAutoriaRepository {
  /** Las filas del libro de la caja por su id (solo las columnas que deciden autoria). */
  movimientos(ids: readonly string[]): Promise<MovimientoDeCajaParaAutoria[]>;
  /** Nombre de cada usuario que registro algo. */
  nombres(usuarioIds: readonly string[]): Promise<Map<string, string>>;
  /** Cierre del dia → su mensajero y quien lo aprobo. */
  cierres(ids: readonly string[]): Promise<Map<string, { mensajero: CuentaNombrada; aprobo: string | null }>>;
  /** Pago de la 172 → su beneficiario (tienda o mensajero). */
  pagos(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Gestion de un cobro por rechazo → la tienda cobrada y quien aprobo el cobro. */
  rechazos(gestionIds: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; aprobo: string | null }>>;
  /** Fila del podio → el mensajero premiado. */
  podios(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Incidente → la tienda de la orden y quien lo resolvio. */
  incidentes(ids: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; resolvio: string | null }>>;
  /** Pago de un gasto de una tienda (459) → la tienda y el beneficiario (texto libre). */
  pagosPorCuenta(ids: readonly string[]): Promise<Map<string, { tienda: CuentaNombrada; beneficiario: string }>>;
  /** Debito de la tienda de un cobro (461/381) → la tienda. */
  debitosDeTienda(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** Pago de una tienda a Ordenex (457) → la tienda. */
  abonos(ids: readonly string[]): Promise<Map<string, CuentaNombrada>>;
  /** R42/R56 — la anotacion «a quien» de un movimiento registrado a mano (sueldo, gasto, correccion). */
  anotaciones(movimientoIds: readonly string[]): Promise<Map<string, string | null>>;
}
