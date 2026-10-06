// Ficha 474 (design §4.1/§4.2/§4.3) — claves de idempotencia de la COLA y el encolado de una
// ocurrencia a hora fija. Un solo sitio para que el service (guardar/encender/reprogramar), el
// handler programado (cadena) y el mantenimiento (re-siembra, R25) encolen EXACTAMENTE igual.
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { proximaOcurrencia, type Ocurrencia } from "@/lib/whatsapp-envios/proxima-ocurrencia";
import { MAX_INTENTOS_REINTENTO } from "@/lib/config/whatsapp-envios";

export const MAX_INTENTOS_PROGRAMADO = 3;
export const MAX_INTENTOS_EVENTO = 3;
export const MAX_INTENTOS_EJECUCION = 3;
export { MAX_INTENTOS_REINTENTO };

/**
 * La HORA va en la clave a proposito (design §4.1): con solo `envioId:fechaCr`, cambiar hoy de
 * 12:00 a 15:00 chocaria con el job de las 12:00 (`ON CONFLICT DO NOTHING`) y el de las 15:00 no
 * existiria nunca.
 */
export function dedupeKeyProgramado(envioId: string, fechaCr: string, hora: string): string {
  return `wa_envio:${envioId}:${fechaCr}:${hora}`;
}

/** UN trabajo por aviso puenteado: la ENTIDAD del aviso, no el id de la notificacion (§4.2). */
export function dedupeKeyEvento(evento: string, entidadId: string): string {
  return `wa_envio_evento:${evento}:${entidadId}`;
}

export function dedupeKeyEjecucion(ejecucionId: string): string {
  return `wa_envio_ejecucion:${ejecucionId}`;
}

export function dedupeKeyReintento(entregaId: string): string {
  return `wa_envio_reintento:${entregaId}`;
}

/** Payload del job programado. */
export interface PayloadProgramado {
  envioId: string;
  fechaCr: string;
  hora: string;
}

/**
 * Encola la PROXIMA ocurrencia estrictamente posterior a `desde` (R20: lo pasado no se recupera).
 * `null` si el envio no tiene dias validos. Idempotente por `dedupeKey`.
 */
export async function encolarProximaOcurrencia(
  cola: Pick<IJobRepository, "enqueue">,
  envio: { id: string; diasSemana: readonly number[]; hora: string },
  desde: Date,
): Promise<Ocurrencia | null> {
  const oc = proximaOcurrencia(envio.diasSemana, envio.hora, desde);
  if (oc === null) return null;
  const payload: PayloadProgramado = { envioId: envio.id, fechaCr: oc.fechaCr, hora: envio.hora };
  await cola.enqueue("whatsapp_envio_programado", { ...payload }, {
    runAfter: oc.instante,
    dedupeKey: dedupeKeyProgramado(envio.id, oc.fechaCr, envio.hora),
    maxIntentos: MAX_INTENTOS_PROGRAMADO,
  });
  return oc;
}
