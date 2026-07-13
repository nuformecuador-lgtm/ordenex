import { describe, it, expect } from "vitest";
import { loadWalletTiendaConfig } from "@/lib/config/wallet-tienda";

// Feature 43/T5b (R28) — el interruptor Q3 es una sola fuente de verdad, DEFAULT true,
// sobreescribible por env WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION.

const KEY = "WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

describe("loadWalletTiendaConfig (R28)", () => {
  it("DEFAULT: ausente -> TIENDA_DEBITA_FLETE_DEVOLUCION = true (opcion 1 aprobada)", () => {
    withEnv(undefined, () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(true);
    });
  });

  it("override 'false' -> false (opcion 2: la devolucion no afecta a la tienda)", () => {
    withEnv("false", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(false);
    });
  });

  it("override '0' -> false (parseo money-safe)", () => {
    withEnv("0", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(false);
    });
  });

  it("'FALSE'/' false ' (case/espacios) -> false", () => {
    withEnv(" FALSE ", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(false);
    });
  });

  it("'true' / vacio / cualquier otro -> true (default seguro)", () => {
    withEnv("true", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(true);
    });
    withEnv("", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(true);
    });
    withEnv("sí", () => {
      expect(loadWalletTiendaConfig().TIENDA_DEBITA_FLETE_DEVOLUCION).toBe(true);
    });
  });
});
