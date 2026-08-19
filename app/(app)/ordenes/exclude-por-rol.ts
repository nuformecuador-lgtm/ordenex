import { RolValue } from "@prisma/client";

// Feature 63/C3 (R13) + Feature 139 (T3.4, R19/R20): `exclude` por rol, por `value` del
// estado. `OrdenesListado` deriva las OPCIONES DEL FILTRO por estado del catálogo
// `order_status` MENOS esta lista, así que un estado NO listado aquí AUTO-APARECE como
// opción. Default `["pendiente"]` (borrador transitorio recién sembrado); un rol sin
// override cae a ese default.
//
// Feature 139/R19: maestro/admin excluyen SOLO "pendiente", de modo que los CUATRO estados
// del flujo de devolución de rechazadas (`por_devolver`, `devolviendo_a_bodega_central`,
// `por_devolver_a_tienda`, `devuelta_a_tienda`) auto-aparecen como opción sin cambio de config.
//
// Feature 139/R20 (gate F1.4-Q4): el adminTienda ve TODOS los estados del retorno de SUS
// órdenes, INCLUIDOS los internos de bodega (`por_devolver`, `devolviendo_a_bodega_central`),
// no solo el tramo tienda. Por eso NINGÚN estado del flujo de devolución figura en su lista
// de exclusión. Lo que sí se excluye —`devuelta`, `en_bodega_central`, `en_bodega_satelite`,
// `en_ruta_bodega_satelite`— NO pertenece a ese flujo (son estados que el adminTienda no
// opera). El backend acota las órdenes a las de su tienda; el filtro solo agrupa por estado.
export const EXCLUDE_POR_ROL: Record<string, string[]> = {
  [RolValue.maestro]: ["pendiente"],
  [RolValue.admin]: ["pendiente"],
  [RolValue.adminTienda]: [
    "pendiente",
    "devuelta",
    "en_bodega_central",
    "en_bodega_satelite",
    "en_ruta_bodega_satelite",
    // Feature 239/R26 (T1.7): el PRE-ESTADO de la devolución se excluye para el adminTienda,
    // junto a `devuelta`. Este mapa es PARCIAL y NO rompe el build: un estado que no se liste
    // aquí AUTO-APARECE como opción del desplegable de ese rol, así que olvidarlo pondría en la
    // pantalla de la tienda justo el estado que la 239 decide que no debe ver todavía (P3: en el
    // limbo la tienda no ve nada). Maestro/admin SÍ lo ven: solo excluyen "pendiente".
    "devolucion_por_confirmar",
  ],
};

// Estados del flujo de devolución de RECHAZADAS (feature 139). Ninguno debe quedar excluido
// para maestro/admin (R19) ni para adminTienda (R20). Exportado para blindar esa regla en test.
export const ESTADOS_FLUJO_DEVOLUCION = [
  "por_devolver",
  "devolviendo_a_bodega_central",
  "por_devolver_a_tienda",
  "devolviendo_a_tienda",
  "devuelta_a_tienda",
] as const;
