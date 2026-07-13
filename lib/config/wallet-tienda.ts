// Feature 43 (design §2.1, R28) — ÚNICA fuente de verdad del interruptor Q3
// `TIENDA_DEBITA_FLETE_DEVOLUCION`. Patron lib/config/cierre.ts (interface +
// loadXConfig() que lee env con fallback + singleton exportado). NO es columna de DB (el
// repo no tiene patron de settings en tabla; es config de modulo como el resto), de modo
// que cambiar la regla es un cambio local y auditable en git, sin migracion (R29).
//
// DEFAULT `true` (opcion 1 aprobada F1.4-Q3: la tienda debe el flete de devolucion + su IVA).
// Con `false`, el feed NO genera los debitos `flete_devolucion`/`iva_flete_devolucion` en el
// ledger de la tienda (la devolucion no afecta su saldo; el ingreso de la 42 no cambia).
// Se lee en UN SOLO punto (WalletTiendaFeedService); NINGUN otro archivo decide la regla.

// Parseo booleano money-safe: solo "false"/"0" (trim, case-insensitive) -> false; ausente,
// vacio o cualquier otro valor -> true (default seguro: la tienda debe el flete de devolucion).
function readBooleanDefaultTrue(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

export interface WalletTiendaConfig {
  /**
   * R28/F1.4-Q3: si `true` (default), el ledger de la tienda registra los debitos
   * `flete_devolucion` e `iva_flete_devolucion` en gestiones devuelta/rechazada (saldo
   * negativo). Si `false`, esos dos debitos NO se generan en la tienda (los absorbe Ordenex).
   */
  TIENDA_DEBITA_FLETE_DEVOLUCION: boolean;
}

export function loadWalletTiendaConfig(): WalletTiendaConfig {
  return {
    TIENDA_DEBITA_FLETE_DEVOLUCION: readBooleanDefaultTrue(
      "WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION",
    ),
  };
}

export const walletTiendaConfig: WalletTiendaConfig = loadWalletTiendaConfig();
