// Feature 92 (design §9.A) — cliente COMPUESTO: intenta el proveedor principal (Google Cloud
// Route Optimization) y, SOLO si falta la credencial, cae a un ordenado local aproximado
// (`HaversineRouteOptimizationClient`). Asi un despliegue sin credencial de Route
// Optimization NO deja la ruta del mensajero sin ordenar.
//
// ⏳ FEATURE 265 (2026-08-22): YA NO ES EXCLUSIVAMENTE PARA CREDENCIAL AUSENTE. Hay una
// SEGUNDA regla, y solo una: el desenlace `sin_solucion` —el proveedor contesto bien y no
// pudo servir todas las paradas— tambien cae a Haversine. La regla de abajo («cualquier OTRO
// error se re-lanza») NO se toca: una excepcion sigue siendo un fallo real del proveedor.
//
// EL FALLBACK ES EXCLUSIVAMENTE PARA CREDENCIAL AUSENTE (`RutaNoConfiguradoError`):
//
//  - `RutaNoConfiguradoError` (falta una pieza WIF o el PEM) NO es un fallo del proveedor:
//    es un despliegue sin credencial. Reintentar con Google no lo arregla, pero el orden
//    local si es util -> se delega en Haversine.
//  - CUALQUIER otro error (token rechazado, HTTP 400, respuesta con forma invalida,
//    transitorio) se RE-LANZA tal cual: son fallos REALES del proveedor configurado. Taparlos
//    con un orden aproximado ocultaria una credencial rota o un modelo mal formado, justo lo
//    que el dead-letter debe hacer VISIBLE (design §5, R27).
//
// NO cita PII ni credencial por log ni por error (R14): el warn es un aviso agregado.
import type {
  IRouteOptimizationClient,
  OptimizarInput,
  OptimizarOutcome,
} from "@/lib/interfaces/external/IRouteOptimizationClient";
import { RutaNoConfiguradoError } from "@/lib/auth/google-token-shared";
import { optlog, opterror } from "@/lib/logging/optimizer-log";

/** Logger inyectable, mismo contrato que `RutaLogger`. NUNCA recibe PII ni secretos. */
export interface FallbackLogger {
  warn(message: string): void;
}
/**
 * ⚠️ ESTE `warn` NO LLEGA A NADIE EN PRODUCCION, Y ESTA ASI A PROPOSITO.
 *
 * Es un no-op, y la construccion real (`buildOptimizacionRutaService`,
 * `lib/services/jobs/optimizacion-ruta-handler.ts`) NO le pasa logger, asi que los dos avisos
 * agregados de mas abajo (265/R12 y el de la credencial ausente) se escriben contra este
 * objeto vacio. LIMITE DECLARADO 5 de la ficha 265 (`design.md` §14.3), cerrado asi por la
 * puerta humana P8: quien se entera de que una ruta se ordeno en local es la operacion,
 * consultando `ruta_optimizada.secuencia_fuente` —dato persistido—, y el mensajero, por el
 * aviso de su pantalla. Su hermano vive en `OptimizacionRutaService.ts`, con la misma nota.
 *
 * ⚠️ No cuelgues nada de estos `warn`: escribirlos no es avisar. Menor **m11** de
 * `progress/review_265.md`. Si hicieran falta de verdad, se inyecta un logger real aqui.
 */
const defaultLogger: FallbackLogger = { warn: () => {} };

export class FallbackRouteOptimizationClient implements IRouteOptimizationClient {
  constructor(
    private readonly primary: IRouteOptimizationClient,
    private readonly fallback: IRouteOptimizationClient,
    private readonly logger: FallbackLogger = defaultLogger,
  ) {}

  async optimizar(input: OptimizarInput): Promise<OptimizarOutcome> {
    try {
      const outcome = await this.primary.optimizar(input);
      // ── Feature 265 (R9-R13, design §5.3): SEGUNDA regla de degradacion ────────────
      // El proveedor contesto BIEN y no pudo servirlas todas. No es un fallo suyo, asi que
      // no se propaga como tal: se ordenan TODAS en local. El criterio es la COBERTURA de la
      // secuencia, no la forma interna de `skippedShipments` (R3) — un campo con una forma
      // que el contrato no reconozca no puede dejar al mensajero sin ruta.
      //
      // ⚠️ LA SECUENCIA QUE SALE DE AQUI CUBRE TODAS LAS PARADAS DE ENTRADA (R10). Es la
      // propiedad que no se puede sacrificar: un orden subóptimo cuesta minutos, una parada
      // que se cae de la ruta cuesta una entrega —y es indistinguible de una parada sin
      // geocodificar, o sea un fallo mudo.
      if (outcome.status === "sin_solucion") {
        optlog("fallback — el proveedor NO las sirvio todas: se ordena en local con Haversine", {
          servidas: outcome.servidas,
          enviadas: outcome.enviadas,
        });
        // Aviso agregado (R12), sin PII: conteos, nunca ids ni coordenadas.
        this.logger.warn(
          `[optimizacion_ruta] el proveedor sirvio ${outcome.servidas} de ${outcome.enviadas} ` +
            "paradas; se usa orden local aproximado (Haversine)",
        );
        // La `fuente` la pone Haversine (`local`), no este compuesto: propaga, no supone.
        return this.fallback.optimizar(input);
      }
      return outcome;
    } catch (error) {
      if (error instanceof RutaNoConfiguradoError) {
        // ESTA linea es la que explica el sintoma mas confuso de la feature: "la ruta se
        // ordena pero Google nunca se llama". Sin ella, el fallback es invisible.
        optlog("fallback — SIN credencial: se ordena en local con Haversine", {
          motivo: error.message,
        });
        // Aviso agregado, sin PII. ⚠️ HOY NADIE LO LEE: el logger por defecto es un no-op y la
        // construccion real no inyecta otro (ver `defaultLogger`, limite declarado 5). Quien
        // hace visible este caso es `secuencia_fuente = 'local'` en la fila, no esta linea.
        this.logger.warn(
          "[optimizacion_ruta] sin credencial de proveedor; usando orden local aproximado (Haversine)",
        );
        return this.fallback.optimizar(input);
      }
      // Fallo REAL del proveedor configurado: se propaga para que la cola/UI lo traten.
      opterror("fallback — fallo REAL del proveedor; NO se cae a Haversine", error);
      throw error;
    }
  }
}
