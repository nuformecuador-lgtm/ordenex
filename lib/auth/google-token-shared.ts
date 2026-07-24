// Feature 92 — piezas COMPARTIDAS por los dos proveedores de token de Route Optimization:
// el JWT-bearer firmado a mano (`google-sa-token.ts`) y el keyless por Workload Identity
// Federation (`google-wif-token.ts`).
//
// POR QUE EXISTE ESTE ARCHIVO: `construirTokenProvider` (en `google-sa-token.ts`) elige
// entre ambos proveedores, asi que importa `google-wif-token.ts`; y este ultimo necesita
// las clases de error, el scope y el contrato del proveedor. Ponerlos aqui evita un ciclo
// de imports entre los dos modulos.
//
// INVARIANTE DE SEGURIDAD (R14): ninguna de las clases de error de aqui admite el valor de
// una credencial. Solo la operacion y el estado (nombre de variable que falta, status HTTP).

/** Scope minimo que exige `optimizeTours`. Lo comparten los dos proveedores. */
export const SCOPE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

/** Nombre de la operacion citado en los errores. Sin credencial, sin token, sin URL. */
export const OPERACION_TOKEN = "token de service account";

/**
 * Contrato UNICO que consume el handler: da igual si por debajo hay JWT-bearer o WIF.
 * `construirTokenProvider` devuelve siempre algo que cumple esto.
 */
export interface TokenProvider {
  /** Devuelve un `access_token` valido para las APIs de Google Cloud. */
  obtener(): Promise<string>;
}

/**
 * R12: falta alguna pieza de la credencial de Route Optimization. Se lanza ANTES de
 * cualquier llamada de red. `JobQueueService.drenar` captura job a job, asi que el resto de
 * la cola — `liberar_reprogramadas` y `geocodificacion`, que comparten el cron — sigue
 * drenando sin verse afectado.
 */
export class RutaNoConfiguradoError extends Error {
  constructor(pieza: string) {
    // Se cita QUE FALTA (el NOMBRE de la variable), nunca su valor.
    super(`optimizacion de ruta: credencial incompleta (falta ${pieza})`);
    this.name = "RutaNoConfiguradoError";
  }
}

/** El proveedor de identidad rechazo la credencial o no respondio. */
export class RutaTokenError extends Error {
  constructor(detalle: string) {
    super(`${OPERACION_TOKEN}: ${detalle}`);
    this.name = "RutaTokenError";
  }
}
