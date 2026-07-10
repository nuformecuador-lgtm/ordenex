// Limitador de intentos de verificacion del reset de contrasena (Feature 20,
// R20). Ventana deslizante EN MEMORIA del proceso, con clave `email|ip` y reloj
// inyectable para test. Deliberadamente NO escribe en DB ni en `login_attempt`
// y NO bloquea la cuenta: es un endurecimiento best-effort por instancia. El
// respaldo durable es el TTL del OTP + el limite de solicitudes R19 (ver
// design.md seccion 5b).

/** Reloj inyectable: devuelve el instante actual en milisegundos. */
export type Clock = () => number;

/** Construye la clave del limitador a partir del email y la IP. */
export function buildResetRateKey(email: string, ip: string): string {
  return `${email.toLowerCase()}|${ip}`;
}

/**
 * Ventana deslizante en memoria. `registrar(key)` anota un intento con el
 * timestamp actual; `superaLimite(key, max, ventanaMs)` indica si en la ventana
 * mas reciente ya hay al menos `max` intentos. Los timestamps fuera de la
 * ventana se descartan de forma perezosa en cada consulta.
 */
export class ResetRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: Clock = () => Date.now()) {}

  registrar(key: string): void {
    const marcas = this.hits.get(key) ?? [];
    marcas.push(this.now());
    this.hits.set(key, marcas);
  }

  superaLimite(key: string, max: number, ventanaMs: number): boolean {
    const limite = this.now() - ventanaMs;
    const marcas = (this.hits.get(key) ?? []).filter((t) => t > limite);
    if (marcas.length === 0) {
      this.hits.delete(key);
      return false;
    }
    this.hits.set(key, marcas);
    return marcas.length >= max;
  }
}
