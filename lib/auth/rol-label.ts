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
};
