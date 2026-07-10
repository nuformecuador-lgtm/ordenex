import { z } from "zod";

// Politica de contrasena fuerte reutilizable (Feature 20, R8). Modulo propio
// para que otras features (25 gestion de usuarios, 21 postulacion) puedan
// reutilizar exactamente la misma politica al definir/actualizar contrasenas.
//
// Aplica SOLO a contrasenas NUEVAS (p. ej. el reset). No re-valida las
// contrasenas existentes; no hay rehash masivo.

/** Longitud minima exigida (R8). */
export const PASSWORD_MIN_LENGTH = 8;
/** Limite bcrypt: ignora bytes mas alla de 72 (R8). */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Schema zod de contrasena fuerte: longitud 8..72 y al menos una mayuscula,
 * una minuscula, un digito y un simbolo. Cada regla lleva su propio mensaje
 * para que el borde (formulario) pueda mostrar el motivo exacto del rechazo.
 */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(PASSWORD_MAX_LENGTH, `Debe tener como maximo ${PASSWORD_MAX_LENGTH} caracteres`)
  .regex(/[A-Z]/, "Debe incluir al menos una letra mayuscula")
  .regex(/[a-z]/, "Debe incluir al menos una letra minuscula")
  .regex(/[0-9]/, "Debe incluir al menos un digito")
  .regex(/[^A-Za-z0-9]/, "Debe incluir al menos un simbolo");

export type StrongPassword = z.infer<typeof strongPasswordSchema>;
