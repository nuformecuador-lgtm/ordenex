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

// ── FICHA 335 (A1, R8) — tope de opciones del selector de cierre de `/mi-wallet` ──
//
// El numero no es una medida (produccion vacia desde el 2026-08-25): es una cota de seguridad,
// y por eso lo que se prueba aqui es que sea CONFIGURABLE y que un valor basura no la tumbe.

const KEY_CIERRES = "WALLET_TIENDA_MAX_CIERRES_FILTRO";

function withEnvCierres<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env[KEY_CIERRES];
  if (value === undefined) delete process.env[KEY_CIERRES];
  else process.env[KEY_CIERRES] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY_CIERRES];
    else process.env[KEY_CIERRES] = saved;
  }
}

describe("loadWalletTiendaConfig.MAX_CIERRES_FILTRO (ficha 335, R8)", () => {
  it("DEFAULT: ausente -> 200 (cota de seguridad, no una medida de produccion)", () => {
    withEnvCierres(undefined, () => {
      expect(loadWalletTiendaConfig().MAX_CIERRES_FILTRO).toBe(200);
    });
  });

  it("override '50' -> 50 (el tope se cambia por entorno, sin tocar codigo)", () => {
    withEnvCierres("50", () => {
      expect(loadWalletTiendaConfig().MAX_CIERRES_FILTRO).toBe(50);
    });
  });

  it("'0' / 'abc' / negativo / vacio -> cae al default de 200", () => {
    // Un `0` colado dejaria el selector SIEMPRE vacio y con el aviso de tope encendido: una
    // pantalla que dice «hay mas» y no ofrece ninguno. `readPositiveInt` lo descarta.
    for (const basura of ["0", "abc", "-5", ""]) {
      withEnvCierres(basura, () => {
        expect(loadWalletTiendaConfig().MAX_CIERRES_FILTRO, basura).toBe(200);
      });
    }
  });

  it("el tope del selector es INDEPENDIENTE del tamano de pagina del dominio", () => {
    // Si compartieran variable, subir la pagina de «Saldos de tiendas» movería el selector de
    // `/mi-wallet` sin que nadie lo pidiera.
    const base = withEnvCierres(undefined, loadWalletTiendaConfig);
    withEnvCierres("7", () => {
      const cfg = loadWalletTiendaConfig();
      expect(cfg.MAX_CIERRES_FILTRO).toBe(7);
      expect(cfg.MAX_CIERRES_FILTRO).not.toBe(base.MAX_CIERRES_FILTRO);
      expect(cfg.DEFAULT_PAGE_SIZE).toBe(base.DEFAULT_PAGE_SIZE);
      expect(cfg.MAX_PAGE_SIZE).toBe(base.MAX_PAGE_SIZE);
    });
  });
});
