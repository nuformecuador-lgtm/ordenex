import type { EstadoUsuario } from "@prisma/client";

/**
 * Etiquetas legibles del estado de un usuario. Fuente ÚNICA compartida por la insignia de
 * la tabla (`usuarios-columns.tsx`) y por las columnas de export (`usuarios-descarga-columnas.ts`).
 *
 * Feature 170 (T B.3): se PROMUEVE aquí, sin cambiar ni un texto, desde
 * `usuarios-columns.tsx`. El motivo es estructural: el módulo de columnas de export tiene
 * que ser PURO (sin React ni DOM, design §3) y `usuarios-columns.tsx` importa `Badge` y
 * `Button`. Importarlo desde allí arrastraría media UI a un módulo de datos. Es la misma
 * operación que ya se hizo con `ROL_LABELS` (`lib/auth/rol-label.ts`).
 *
 * Que el archivo y la descarga lean de AQUÍ es también lo que hace cierto R8: la etiqueta
 * del `xlsx` no puede divergir de la que ve el usuario en pantalla, porque es la misma.
 */
export const ESTADO_LABELS: Record<EstadoUsuario, string> = {
  pendiente: "Pendiente",
  activo: "Activo",
  inactivo: "Inactivo",
  bloqueado: "Bloqueado",
};
