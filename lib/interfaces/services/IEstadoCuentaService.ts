import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaInput, VerEstadoCuentaResult } from "@/lib/types/estado-cuenta";

/**
 * FICHA 458-B (design §3.2, R16–R25, R81) — contrato del servicio del ESTADO DE CUENTA de una tienda,
 * un mensajero o una bodega satelite. Resultados de DOMINIO: `unauthenticated` y `validation_error` de
 * forma los decide el borde; el servicio devuelve `validation_error` solo cuando el chip no es de ese
 * tipo de cuenta.
 */
export type VerEstadoCuentaServiceResult = Exclude<VerEstadoCuentaResult, { status: "unauthenticated" }>;

export interface IEstadoCuentaService {
  /**
   * R81 — rol (acceso total) ANTES de leer. La cuenta tiene que existir con ESE papel (una tienda es un
   * `adminTienda`, un mensajero un `mensajero`, una bodega una zona satelite): si no, `no_encontrado`
   * sin distinguir. Devuelve el extracto paginado en orden ascendente (D4) con el saldo corrido de la
   * cuenta ENTERA (R21), el saldo inicial (R20), los totales netos del periodo (D3) y el saldo actual;
   * afirma R22 (`inicial ± abonos/cargos = final` y, sin `hasta`, `final = actual`) y LANZA si no se
   * cumple: un extracto que no cuadra no se enseña.
   */
  leer(input: EstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult>;
}
