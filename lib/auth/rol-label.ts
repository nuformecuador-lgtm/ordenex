import type { RolValue } from "@prisma/client";

/**
 * Etiquetas legibles de rol (es). Fuente ÚNICA de texto compartida por la tabla de
 * usuarios (configuración) y el footer del sidebar. Preparado para i18n futuro
 * (constantes, no cadenas incrustadas).
 */
export const ROL_LABELS: Record<RolValue, string> = {
  maestro: "Maestro",
  admin: "Administrador",
  mensajero: "Mensajero",
  adminTienda: "Admin de tienda",
  adminSatelite: "Admin satélite",
  // Feature 81 [D1]: cuenta dedicada a una API key (no es una persona). El Record es
  // exhaustivo sobre RolValue, asi que el valor nuevo del enum obliga a esta etiqueta.
  apiKey: "API key",
};
