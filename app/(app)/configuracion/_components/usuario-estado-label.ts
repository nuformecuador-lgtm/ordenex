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
/**
 * Pedido humano (2026-08-26): lo que se pinta cuando el usuario NO tiene zona. Vive AQUÍ y no en
 * `usuarios-columns.tsx` por la misma razón que `ESTADO_LABELS`: lo comparte el módulo de export,
 * que tiene que ser PURO, y `usuarios-columns.tsx` importa React.
 *
 * Es un guion y no una celda vacía a propósito: la mayoría de los usuarios no tiene zona (sólo
 * `mensajero` y `adminSatelite` la conservan, feature 24/R27), así que el vacío se leería como
 * «este dato no se cargó» tanto en pantalla como en la hoja de cálculo.
 */
export const SIN_ZONA = "-";

export const ESTADO_LABELS: Record<EstadoUsuario, string> = {
  pendiente: "Pendiente",
  activo: "Activo",
  inactivo: "Inactivo",
  bloqueado: "Bloqueado",
};
