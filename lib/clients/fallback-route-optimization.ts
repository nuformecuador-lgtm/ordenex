// Feature 92 (design §9.A) — cliente COMPUESTO: intenta el proveedor principal (Google Cloud
// Route Optimization) y, SOLO si falta la credencial, cae a un ordenado local aproximado
// (`HaversineRouteOptimizationClient`). Asi un despliegue sin credencial de Route
// Optimization NO deja la ruta del mensajero sin ordenar.
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
const defaultLogger: FallbackLogger = { warn: () => {} };

export class FallbackRouteOptimizationClient implements IRouteOptimizationClient {
  constructor(
    private readonly primary: IRouteOptimizationClient,
    private readonly fallback: IRouteOptimizationClient,
    private readonly logger: FallbackLogger = defaultLogger,
  ) {}

  async optimizar(input: OptimizarInput): Promise<OptimizarOutcome> {
    try {
      return await this.primary.optimizar(input);
    } catch (error) {
      if (error instanceof RutaNoConfiguradoError) {
        // ESTA linea es la que explica el sintoma mas confuso de la feature: "la ruta se
        // ordena pero Google nunca se llama". Sin ella, el fallback es invisible.
        optlog("fallback — SIN credencial: se ordena en local con Haversine", {
          motivo: error.message,
        });
        // Aviso agregado, sin PII: util para que un operador note que se esta ordenando en
        // local por falta de credencial, en vez de creer que Google esta activo.
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
