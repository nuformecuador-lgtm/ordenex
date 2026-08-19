import { z } from "zod";

import { CUERPO_MAX, type NotaValidationError, type OrdenNotaDTO } from "@/lib/types/orden-nota";

// SOLICITUD DE AYUDA sobre una orden (pedido humano 2026-08-18) — validacion de borde (zod) y
// resultado discriminado, con el patron de `lib/types/orden-nota.ts`.
//
// QUE ES. El mensajero que tiene una orden abierta en el panel de gestion pide ayuda sobre ELLA:
// se marca la orden (`orden.ayuda`) y se PUBLICA EL MOTIVO como una nota mas del hilo de la
// feature 227. No es un canal nuevo ni un buzon aparte: la tienda ya lee ese hilo desde
// `/novedades`, asi que el motivo llega por donde la conversacion de la orden ya viaja.
//
// POR QUE EL MOTIVO REUSA `CUERPO_MAX` Y NO TIENE TOPE PROPIO. El motivo ES una nota: acaba
// literalmente en `orden_nota.cuerpo`, que la 227 acota a 200 caracteres. Un tope propio aqui
// seria una segunda fuente de verdad que el dia que divergiera dejaria pasar en el borde un texto
// que el service de notas rechazaria despues.
//
// EL MOTIVO ES OBLIGATORIO, y esto NO es lo mismo que el hilo. `publicarNotaSchema` acepta el
// texto vacio en el borde y deja que el service lo rechace tras recortar (R6 de la 227); aqui se
// exige `min(1)` desde zod porque una solicitud de ayuda SIN motivo no es una solicitud
// degradada, es una marca muda: la tienda veria la orden encendida en `/novedades` sin saber que
// le pasa. El recorte de los blancos lo sigue haciendo el service de notas — este `min(1)` no lo
// sustituye, solo evita el viaje.

/** Tope del motivo, en caracteres. Es EL MISMO de una nota del hilo, por construccion. */
export const MOTIVO_AYUDA_MAX = CUERPO_MAX;

/** Borde: la orden (uuid) y el motivo acotado. El actor NUNCA viaja: lo fija la sesion. */
export const solicitarAyudaSchema = z.object({
  ordenId: z.uuid(),
  motivo: z.string().min(1).max(MOTIVO_AYUDA_MAX),
});
export type SolicitarAyudaInput = z.infer<typeof solicitarAyudaSchema>;

/**
 * `ok` devuelve la nota recien publicada ya proyectada, para que la UI pueda refrescar el hilo
 * sin una segunda lectura.
 *
 * `forbidden` es OPACO y hereda el de la 227 tal cual: rol no autorizado, orden inexistente,
 * orden ajena o fuera de la ventana de escritura del mensajero (`en_reparto`) devuelven todos lo
 * mismo. Que la marca de ayuda no abra ni un resquicio de informacion que el hilo no abriera ya
 * es deliberado: comparten exactamente la misma puerta.
 */
export type SolicitarAyudaServiceResult =
  | { status: "ok"; nota: OrdenNotaDTO }
  | NotaValidationError
  | { status: "forbidden" };

export type SolicitarAyudaResult =
  | SolicitarAyudaServiceResult
  | { status: "unauthenticated" };

/** Borde de la RETIRADA: solo la orden. Quien la retira sale de la sesion. */
export const recuperarAyudaSchema = z.object({
  ordenId: z.uuid(),
});
export type RecuperarAyudaInput = z.infer<typeof recuperarAyudaSchema>;

/**
 * Retirar una solicitud de ayuda («Recuperar»): apaga `orden.ayuda` y con eso la orden vuelve a la
 * lista normal del mensajero y desaparece de `/novedades` si no tenia otra razon para estar ahi.
 *
 * NO borra nada del hilo: los motivos escritos siguen donde estan. Retirar la solicitud dice «ya
 * no necesito ayuda», no «esto nunca paso».
 *
 * `forbidden` es el mismo resultado opaco del hilo (rol, orden ajena, orden inexistente, fuera de
 * la ventana de escritura del rol).
 */
export type RecuperarAyudaServiceResult = { status: "ok" } | { status: "forbidden" };

export type RecuperarAyudaResult =
  | RecuperarAyudaServiceResult
  | NotaValidationError
  | { status: "unauthenticated" };

/** Borde del «+1 intento de contacto»: solo la orden. Quien lo registra sale de la sesion. */
export const intentoContactoSchema = z.object({
  ordenId: z.uuid(),
});
export type IntentoContactoInput = z.infer<typeof intentoContactoSchema>;

/**
 * `ok` devuelve el contador YA INCREMENTADO. Viaja de vuelta porque la pantalla lo pinta: sin el,
 * la UI tendria que llevar su propia cuenta y dos pestañas de la misma tienda acabarian mostrando
 * numeros distintos sobre la misma orden.
 *
 * `forbidden` es el mismo resultado opaco del hilo (rol, orden ajena, orden inexistente).
 */
export type IntentoContactoServiceResult =
  | { status: "ok"; intentosContacto: number }
  | { status: "forbidden" };

export type IntentoContactoResult =
  | IntentoContactoServiceResult
  | NotaValidationError
  | { status: "unauthenticated" };
