/**
 * FICHA 458-B (design §4.2, R63/R65) — lo que la accion unica de anular necesita LEER para decidir
 * por que camino se anula un destino. SOLO lecturas, y solo de las columnas que deciden: tipo,
 * categoria, origen. Ningun importe: el monto lo lee despues el servicio del camino (R70 de la 172).
 */
export interface FilaDeLibroParaAnular {
  id: string;
  tipo: string;
  categoria: string;
  origenTipo: string;
  origenId: string | null;
}

export interface FilaDeMensajeroParaAnular extends FilaDeLibroParaAnular {
  mensajeroId: string;
  /** Dia del podio (`@db.Date`), solo en los premios del ranking y su reverso. */
  premioDia: Date | null;
}

export interface IWalletAnulacionDestinoRepository {
  filaDeCaja(id: string): Promise<FilaDeLibroParaAnular | null>;
  filaDeTienda(id: string): Promise<FilaDeLibroParaAnular | null>;
  filaDeMensajero(id: string): Promise<FilaDeMensajeroParaAnular | null>;
  /** El cobro por rechazo de una gestion (el `origen_id` de sus lineas), o `null`. */
  cobroRechazoDeGestion(gestionId: string): Promise<string | null>;
  /** La fila del podio de ese mensajero ese dia (la clave del premio, 293), o `null`. */
  filaDelPodio(mensajeroId: string, premioDia: Date): Promise<string | null>;
}
