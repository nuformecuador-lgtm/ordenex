import { describe, it, expect, vi } from "vitest";
import { listarMisMovimientosCompletoAction } from "@/lib/actions/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

// Feature 170 / T C.2 (R14/R16/R18 + refuerzo R9/R17/R27) — borde del ledger completo de la
// tienda. El caso que manda aquí es R18 con la clave `tiendaId`: es la PRIMERA de las dos
// barreras contra la fuga (la segunda vive en el servicio, `wallet-tienda-descarga.test.ts`).

const TIENDA: Actor = { usuarioId: "tienda-A", rol: "adminTienda" };

const ITEM: WalletTiendaMovimientoDTO = {
  id: "t1",
  tiendaId: "tienda-A",
  tipo: "credito",
  categoria: "cod_recaudado",
  monto: "1000.00",
  origenTipo: "cierre_dia",
  origenId: "c1",
  descripcion: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

function fakeService(resultado: unknown) {
  const listarMisMovimientosCompleto = vi.fn().mockResolvedValue(resultado);
  return {
    service: { listarMisMovimientosCompleto } as unknown as IWalletTiendaService,
    listarMisMovimientosCompleto,
  };
}

describe("listarMisMovimientosCompletoAction (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, listarMisMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMisMovimientosCompletoAction(
      {},
      { service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarMisMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("un tiendaId inyectado es validation_error y NO llega al servicio (R14/R18)", async () => {
    const { service, listarMisMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMisMovimientosCompletoAction(
      { tiendaId: "tienda-B" },
      { service, getActor: async () => TIENDA },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarMisMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("rechaza tambien page/pageSize: el modo completo NO pagina (R18)", async () => {
    const { service, listarMisMovimientosCompleto } = fakeService({ status: "ok", items: [], total: 0 });

    const r = await listarMisMovimientosCompletoAction(
      { page: 1, pageSize: 20 },
      { service, getActor: async () => TIENDA },
    );

    expect(r.status).toBe("validation_error");
    expect(listarMisMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 6120, limite: 5000 });

    const r = await listarMisMovimientosCompletoAction(
      {},
      { service, getActor: async () => TIENDA },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 6120, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga forbidden sin filas (R17)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarMisMovimientosCompletoAction(
      {},
      { service, getActor: async () => ({ usuarioId: "m1", rol: "maestro" }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio, con el input parseado y SIN paginacion (R9)", async () => {
    const { service, listarMisMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMisMovimientosCompletoAction(
      { categoria: "cod_recaudado" },
      { service, getActor: async () => TIENDA },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    const [data, actor] = listarMisMovimientosCompleto.mock.calls[0];
    expect(actor).toEqual(TIENDA);
    expect(data).toEqual({ categoria: "cod_recaudado" });
    expect(data).not.toHaveProperty("tiendaId");
    expect(data).not.toHaveProperty("page");
  });
});
