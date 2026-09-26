import { describe, expect, it, vi } from "vitest";

import { listarMisMovimientosAction, listarMovimientosDeTiendaAction } from "@/lib/actions/wallet-tienda";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import {
  listarMovimientosDeTiendaSchema,
  listarMovimientosTiendaCompletoSchema,
  listarMovimientosTiendaSchema,
} from "@/lib/types/wallet-tienda";
import { ORIGENES_FALSOS } from "@/tests/fixtures/origenes-falsos";

// Ficha 458-A (TA.6, R36, m1 de la auditoria) — `/mi-wallet` se acota a la tienda de la SESION y el
// listado PAGINADO rechaza, como el completo, cualquier clave que nombre una tienda: `validation_error`
// sin leer nada. Antes el paginado no era `.strict()` y la clave se descartaba en silencio.

const TIENDA_AJENA = "99999999-9999-4999-8999-999999999999";
const TIENDA = { usuarioId: "t-sesion", rol: "adminTienda" as const };

describe("458-A R36 — el listado de /mi-wallet no admite una clave que nombre una tienda", () => {
  it("el schema paginado rechaza `tiendaId` (y cualquier clave extra); sin ella, pasa", () => {
    expect(listarMovimientosTiendaSchema.safeParse({ tiendaId: TIENDA_AJENA }).success).toBe(false);
    expect(listarMovimientosTiendaSchema.safeParse({ page: 1, tienda: TIENDA_AJENA }).success).toBe(false);
    expect(listarMovimientosTiendaSchema.safeParse({ page: 1, pageSize: 20 }).success).toBe(true);
  });

  it("el completo sigue estricto (control: no se relajó al derivar)", () => {
    expect(listarMovimientosTiendaCompletoSchema.safeParse({ tiendaId: TIENDA_AJENA }).success).toBe(false);
  });

  it("el desglose del acceso total sigue aceptando SU `tiendaId` y rechaza cualquier otra clave", () => {
    expect(listarMovimientosDeTiendaSchema.safeParse({ tiendaId: TIENDA_AJENA }).success).toBe(true);
    expect(
      listarMovimientosDeTiendaSchema.safeParse({ tiendaId: TIENDA_AJENA, todasLasTiendas: true }).success,
    ).toBe(false);
  });

  it("por la action: `tiendaId` ajeno → validation_error y el servicio NO se llama", async () => {
    const listarMisMovimientos = vi.fn();
    const service = { listarMisMovimientos } as unknown as IWalletTiendaService;
    const r = await listarMisMovimientosAction(
      { page: 1, pageSize: 20, tiendaId: TIENDA_AJENA },
      { service, origenes: ORIGENES_FALSOS, getActor: async () => TIENDA },
    );
    expect(r.status).toBe("validation_error");
    expect(listarMisMovimientos).not.toHaveBeenCalled();
  });

  // Revision 458-A (m3): el comentario de `WalletTiendaService.listarMovimientosDeTienda` decia que
  // este borde «NO es `.strict()`» y descartaba la clave en silencio. Lo es por herencia (`.extend`
  // de un `.strict()`); esto fija lo que el comentario afirma ahora, por la action.
  it("por la action del desglose: una clave colada → validation_error y el servicio NO se llama", async () => {
    const listarMovimientosDeTienda = vi.fn();
    const service = { listarMovimientosDeTienda } as unknown as IWalletTiendaService;
    const r = await listarMovimientosDeTiendaAction(
      { tiendaId: TIENDA_AJENA, page: 1, pageSize: 20, todasLasTiendas: true },
      { service, origenes: ORIGENES_FALSOS, getActor: async () => ({ usuarioId: "m", rol: "maestro" }) },
    );
    expect(r.status).toBe("validation_error");
    expect(listarMovimientosDeTienda).not.toHaveBeenCalled();
  });
});
