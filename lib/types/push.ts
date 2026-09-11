import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// FICHA 410 (design §11, T3.9) — FRONTERA CONTRACTUAL del canal de push: schemas de borde (zod) y
// resultados tipados de las tres Server Actions. El control del navegador (ficha 410, tanda 5)
// consume SOLO lo de este archivo.

/**
 * ⚠️ EL `usuarioId` NO ESTA AQUI Y NO PUEDE ESTAR (R50). El dueno de una suscripcion se fija SIEMPRE
 * desde la sesion del servidor. Si viajara en la entrada, cualquiera podria suscribir un dispositivo
 * a nombre de otra persona y recibir en su telefono los avisos de un rol que no tiene.
 *
 * `strict()` no es cosmetico: hace que un `usuarioId` inyectado en el cuerpo sea un
 * `validation_error` RUIDOSO en vez de un campo que se ignora en silencio.
 */
export const registrarSuscripcionSchema = z
  .object({
    // El endpoint es una URL del servicio de push del navegador. Se valida la FORMA, no el dominio:
    // hay uno por fabricante (Google, Mozilla, Apple, Microsoft) y una lista blanca de hosts
    // envejeceria sola y dejaria sin canal a un navegador nuevo, en silencio.
    endpoint: z.url().max(2000),
    // Claves base64url que emite el navegador. Longitud acotada para que una entrada absurda no
    // llegue nunca a la base.
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
    // "Chrome en Android", compuesta por el cliente. Opcional y corta: NO es el user-agent crudo.
    etiqueta: z.string().trim().max(60).optional(),
  })
  .strict();

export type RegistrarSuscripcionPushInput = z.infer<typeof registrarSuscripcionSchema>;

/** La baja solo necesita el endpoint: el usuario sale de la sesion (R50). */
export const eliminarSuscripcionSchema = z.object({ endpoint: z.url().max(2000) }).strict();

/** Resultado de registrar o eliminar una suscripcion. */
export type SuscripcionPushResult = { status: "ok" } | ActionError;

/**
 * La clave PUBLICA con la que el navegador se suscribe, resuelta en tiempo de EJECUCION (R32).
 * `clavePublica: null` significa «no hay canal de push configurado» y es una respuesta legitima,
 * no un error: el control de activacion simplemente no se ofrece (R13/R30).
 */
export type ClavePublicaPushResult = { status: "ok"; clavePublica: string | null } | ActionError;
