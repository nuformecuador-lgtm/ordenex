// Feature 170 (T L.1, R40) — configuracion del dominio "wallet-mensajero". Sobreescribible por
// variable de entorno para no hardcodear cotas de negocio (docs/architecture.md: "Sin hardcode
// de contexto"), patron de lib/config/wallet-tienda.ts.
//
// Es el SEPTIMO dominio de paginacion y cierra el hueco que T H.1 dejo abierto a proposito: sus
// seis dominios cubrian 12 de los 13 listados del Anexo III y el que faltaba era «Cuentas por
// pagar a mensajeros», la pantalla de riesgo ALTO que hoy busca por nombre en el navegador
// (design §11.3). Se crea el dominio en vez de colgar ese listado de `wallet-tienda` porque son
// dos ledgers distintos, con dos pantallas distintas y dos escalas distintas (uno crece con el
// numero de tiendas, otro con el de mensajeros): compartir la variable de entorno obligaria a
// mover las dos al tocar una.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface WalletMensajeroConfig {
  /** Tamano de pagina por defecto de las cuentas por pagar a mensajeros (R40). */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
}

export function loadWalletMensajeroConfig(): WalletMensajeroConfig {
  return {
    DEFAULT_PAGE_SIZE: readPositiveInt("WALLET_MENSAJERO_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("WALLET_MENSAJERO_MAX_PAGE_SIZE", 100),
  };
}

export const walletMensajeroConfig: WalletMensajeroConfig = loadWalletMensajeroConfig();
