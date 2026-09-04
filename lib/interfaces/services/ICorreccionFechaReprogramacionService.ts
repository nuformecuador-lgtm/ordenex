import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 371 — CONTRATO del servicio de «corregir la fecha de una reprogramación ya registrada».
//
// Lógica de negocio pura: no conoce HTTP (ni `Request`, ni `Response`, ni `cookies`) ni Prisma. El
// reloj entra por parámetro para que las reglas de fecha sean deterministas en los tests.

/** Lo que la corrección necesita. UNA orden por llamada: esto no es una operación de lote. */
export interface CorregirFechaReprogramacionInput {
  ordenId: string;
  /** Fecha CALENDARIO de Costa Rica `YYYY-MM-DD`. Hoy en adelante (ver `esFechaCorreccionValida`). */
  fecha: string;
  /**
   * Obligatorio. Decisión del humano (2026-09-03): «el motivo sí tiene que ir, básicamente es la
   * misma gestión que reprogramar». Se valida con `motivoSchema`, EL MISMO que valida el motivo al
   * reprogramar — no una regla nueva, y en particular NO el mínimo de 10 caracteres de la 262.
   */
  motivo: string;
}

/**
 * ⭑ EL DISCRIMINANTE QUE LA PANTALLA PINTA, y la mitad del valor de esta ficha.
 *
 * Corregir a HOY dispara la liberación en el acto, pero la puerta de la 276 puede retenerla: una
 * gestión que nace de una visita real no vuelve a bodega hasta que su cierre esté `aprobado`
 * —liberarla antes devolvería la orden con el contador de intentos atrasado, el 4.º intento que la
 * 276 cerró—. Medido sobre las 31 que esperan hoy: 24 saldrían al instante y 7 seguirían esperando.
 *
 * Si el coordinador corrige a hoy y la orden sigue bloqueada SIN EXPLICACIÓN, habríamos cambiado
 * una confusión por otra — que es justo lo que esta ficha viene a quitar. Por eso el resultado dice
 * cuál de los tres desenlaces ocurrió:
 *
 *   · `liberada`     — volvió a bodega en el acto; ya es reasignable.
 *   · `espera_cierre`— la fecha ya venció, pero su cierre no está aprobado. Sale cuando se apruebe
 *                      (la aprobación la libera, ficha 315) o, como red, en la corrida de las 00:00.
 *   · `espera_fecha` — se corrigió a un día futuro y espera al calendario. Es lo correcto: la fecha
 *                      de reprogramación es un compromiso con el destinatario.
 */
export type DesenlaceLiberacion = "liberada" | "espera_cierre" | "espera_fecha";

/**
 * El desenlace de la corrección. Los cuatro estados son EXPLÍCITOS y ninguno es un error genérico.
 *
 * Las dos fechas viajan como `YYYY-MM-DD` (fechas calendario, no instantes): son las mismas dos que
 * quedan escritas en el rastro, y la pantalla las pinta sin volver a convertir nada.
 */
export type CorregirFechaReprogramacionServiceResult =
  | {
      status: "ok";
      ordenId: string;
      /** La gestión corregida: la `reprogramada` vigente, la misma que el cron mira. */
      gestionId: string;
      fechaAnterior: string;
      fechaNueva: string;
      liberacion: DesenlaceLiberacion;
    }
  | { status: "forbidden" }
  /** `motivo` es una de las constantes de `mensajes-correccion-fecha-reprogramacion.ts`. */
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export interface ICorreccionFechaReprogramacionService {
  corregir(
    input: CorregirFechaReprogramacionInput,
    actor: Actor,
    now?: Date,
  ): Promise<CorregirFechaReprogramacionServiceResult>;
}
