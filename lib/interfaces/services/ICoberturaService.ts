import type { ConsultaCobertura, ResultadoCobertura } from "@/lib/types/cotizador";

// Feature 248 (design §1/§4.1) — contrato de la resolucion de COBERTURA.
//
// ⛔ SERVICE PROPIO Y SIN DINERO, Y ES EL PUNTO ARQUITECTONICO DE LA FEATURE: responde "¿que
// zona cubre este distrito?" y NADA MAS. No conoce tarifas, no conoce `ingreso-ordenex` y no
// puede devolver ni derivar un importe (R10). `CotizadorService` (canal por API key) lo COMPONE
// con la tarifa de la tienda; la superficie publica lo usa solo, y por eso su grafo de imports
// no llega al dinero.
//
// Devuelve el resultado de DOMINIO (`ResultadoCobertura`, con `zonaId`/`esCentral`), no el DTO
// publico: el cotizador necesita `esCentral` para elegir la columna del flete. La proyeccion
// estrecha que ve el navegador la hace `aCoberturaPublica` en el borde (R7).

export interface ICoberturaService {
  /**
   * Resuelve el trio (provincia, canton, distrito) por nombre y responde por los TRES estados
   * de la zona del distrito:
   *
   *  - exactamente una zona  -> `cubierto`       (R2)
   *  - ninguna fila en la N:M -> `sin_cobertura`  (R3)
   *  - mas de una             -> `no_determinado` (R4) — nunca se elige una zona arbitraria
   *
   * Entrada que no resuelve a un distrito unico -> `validation_error` por campo, **sin tocar
   * la tabla `tarifas`** (R5), que es imposible aqui por construccion.
   *
   * Nunca lanza por entrada mala: toda salida es un resultado discriminado.
   */
  consultar(entrada: ConsultaCobertura): Promise<ResultadoCobertura>;
}
