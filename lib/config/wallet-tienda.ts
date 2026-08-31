// Feature 43 (design §2.1, R28) — ÚNICA fuente de verdad del interruptor Q3
// `TIENDA_DEBITA_FLETE_DEVOLUCION`. Patron lib/config/cierre.ts (interface +
// loadXConfig() que lee env con fallback + singleton exportado). NO es columna de DB (el
// repo no tiene patron de settings en tabla; es config de modulo como el resto), de modo
// que cambiar la regla es un cambio local y auditable en git, sin migracion (R29).
//
// DEFAULT `true` (opcion 1 aprobada F1.4-Q3: la tienda debe el flete de devolucion + su IVA).
// Con `false`, el feed NO genera los debitos `flete_devolucion`/`iva_flete_devolucion` en el
// ledger de la tienda (el retorno no afecta su saldo; el ingreso de la 42 no cambia).
// Se lee en UN SOLO punto (WalletTiendaFeedService); NINGUN otro archivo decide la regla.
//
// FICHA 301 (2026-08-28) — ESTE INTERRUPTOR YA NO ALCANZA A LAS `devuelta`. Es un filtro
// sobre lo que `derivarIngresoOrden` emite, y desde esa fecha una `devuelta` no emite nada:
// los dos debitos que este flag puede descartar nacen SOLO de una gestion `rechazada`.
// El flag no cambia de semantica ni de default; cambia el conjunto sobre el que actua.

// Parseo booleano money-safe: solo "false"/"0" (trim, case-insensitive) -> false; ausente,
// vacio o cualquier otro valor -> true (default seguro: la tienda debe el flete de devolucion).
function readBooleanDefaultTrue(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

// Feature 170 (T H.1) — mismo `readPositiveInt` que lib/config/usuarios.ts y hermanos.
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface WalletTiendaConfig {
  /**
   * R28/F1.4-Q3: si `true` (default), el ledger de la tienda registra los debitos
   * `flete_devolucion` e `iva_flete_devolucion` en gestiones `rechazada` (saldo negativo).
   * Si `false`, esos dos debitos NO se generan en la tienda (los absorbe Ordenex).
   *
   * Ficha 301 (2026-08-28): antes decia «devuelta/rechazada». Una `devuelta` ya no genera
   * ninguno de los dos conceptos, asi que no hay nada que este flag pueda descartar en ella.
   */
  TIENDA_DEBITA_FLETE_DEVOLUCION: boolean;
  /**
   * Feature 170 (T H.1, R40) — tamano de pagina por defecto del listado de SALDOS DE TIENDAS
   * (`WalletTiendaService`), del Anexo III. No afecta al desglose de movimientos de UNA
   * tienda, que ya pagina desde la feature 171.
   */
  DEFAULT_PAGE_SIZE: number;
  /** Cota maxima del tamano de pagina, evita consultas sin limite (R40). */
  MAX_PAGE_SIZE: number;
  /**
   * FICHA 335 (R8) — tope de opciones del selector de cierre de `/mi-wallet`.
   *
   * NO es un tamano de pagina: el selector no pagina, se recorta. Por eso vive aparte de
   * `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE` y no entra en el censo de `paginacion-dominios`.
   *
   * El 200 es una COTA DE SEGURIDAD, no una medida: produccion esta vacia desde el arranque
   * comercial del 2026-08-25, asi que no hay un percentil real que ofrecer y esta bitacora no
   * va a inventar un numero con cara de dato. Por eso es configurable por entorno: el dia que
   * haya volumen medido, el numero se cambia sin tocar codigo.
   */
  MAX_CIERRES_FILTRO: number;
}

export function loadWalletTiendaConfig(): WalletTiendaConfig {
  return {
    TIENDA_DEBITA_FLETE_DEVOLUCION: readBooleanDefaultTrue(
      "WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION",
    ),
    DEFAULT_PAGE_SIZE: readPositiveInt("WALLET_TIENDA_DEFAULT_PAGE_SIZE", 25),
    MAX_PAGE_SIZE: readPositiveInt("WALLET_TIENDA_MAX_PAGE_SIZE", 100),
    MAX_CIERRES_FILTRO: readPositiveInt("WALLET_TIENDA_MAX_CIERRES_FILTRO", 200),
  };
}

export const walletTiendaConfig: WalletTiendaConfig = loadWalletTiendaConfig();
