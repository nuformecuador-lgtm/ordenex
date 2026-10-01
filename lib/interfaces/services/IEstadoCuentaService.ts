import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EstadoCuentaCompletoInput,
  EstadoCuentaInput,
  MiEstadoCuentaCompletoInput,
  MiEstadoCuentaInput,
  VerEstadoCuentaCompletoResult,
  VerEstadoCuentaResult,
} from "@/lib/types/estado-cuenta";

/**
 * FICHA 458-B (design §3.2, R16–R25, R81) — contrato del servicio del ESTADO DE CUENTA de una tienda,
 * un mensajero o una bodega satelite. Resultados de DOMINIO: `unauthenticated` y `validation_error` de
 * forma los decide el borde; el servicio devuelve `validation_error` solo cuando el chip (o, desde la
 * 458-D, el cierre) no es de ese tipo de cuenta.
 */
export type VerEstadoCuentaServiceResult = Exclude<VerEstadoCuentaResult, { status: "unauthenticated" }>;

/** FICHA 458-D (servidor, TD.6/R32) — el periodo entero, o `limite_excedido` con solo los conteos. */
export type VerEstadoCuentaCompletoServiceResult = Exclude<VerEstadoCuentaCompletoResult, { status: "unauthenticated" }>;

export interface IEstadoCuentaService {
  /**
   * R81 — rol (acceso total) ANTES de leer. La cuenta tiene que existir con ESE papel (una tienda es un
   * `adminTienda`, un mensajero un `mensajero`, una bodega una zona satelite): si no, `no_encontrado`
   * sin distinguir. Devuelve el extracto paginado en el orden pedido (FICHA 463: `sortDir`, por defecto
   * lo mas nuevo primero; antes siempre ascendente, D4) con el saldo corrido de la
   * cuenta ENTERA (R21), el saldo inicial (R20), los totales netos del periodo (D3) y el saldo actual;
   * afirma R22 (`inicial ± abonos/cargos = final` y, sin `hasta`, `final = actual`) y LANZA si no se
   * cumple: un extracto que no cuadra no se enseña.
   *
   * FICHA 458-D (servidor): filtra por cierre (R10/R12), y cada fila baja con su origen con entidad y
   * enlace (R6–R8) y con el metodo y la referencia de su documento de pago.
   */
  leer(input: EstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult>;

  /** FICHA 458-D (servidor, TD.6/R32) — el mismo extracto con el periodo ENTERO, tope en el servidor. */
  leerCompleto(input: EstadoCuentaCompletoInput, actor: Actor): Promise<VerEstadoCuentaCompletoServiceResult>;

  /**
   * FICHA 458-D (servidor, R34–R36) — el estado de cuenta de `/mi-wallet`: SOLO `adminTienda`, y la
   * cuenta es la tienda de la SESION (`actor.usuarioId`), nunca una de la entrada. La MISMA lectura
   * que la oficina (mismo corrido, mismo R22), vista desde la tienda: sin nombres de la gente de
   * Ordenex, sin «Anular…» y con los enlaces que la tienda puede abrir.
   */
  leerMiTienda(input: MiEstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult>;

  /** FICHA 458-D (servidor) — el de `/mi-wallet` con el periodo ENTERO, tope en el servidor. */
  leerMiTiendaCompleto(input: MiEstadoCuentaCompletoInput, actor: Actor): Promise<VerEstadoCuentaCompletoServiceResult>;
}
