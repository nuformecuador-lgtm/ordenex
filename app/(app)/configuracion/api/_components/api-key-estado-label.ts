import type { EstadoApiKey } from "@prisma/client";

/**
 * Etiquetas legibles del estado propio de una API key. Fuente ÚNICA compartida por la
 * insignia de la tabla (`api-keys-columns.tsx`) y por las columnas de export
 * (`api-keys-descarga-columnas.ts`).
 *
 * Feature 170 (T B.3): PROMOVIDA aquí sin cambiar ni un texto desde `api-keys-columns.tsx`,
 * donde era una constante privada. El módulo de columnas de export debe ser PURO (design §3)
 * y aquél importa `Badge` y dos celdas de acción. Que ambos lean de aquí es lo que hace
 * cierto R8: la etiqueta del `xlsx` no puede divergir de la de pantalla.
 */
export const ESTADO_API_KEY_LABEL: Record<EstadoApiKey, string> = {
  activa: "Activa",
  inactiva: "Inactiva",
};
