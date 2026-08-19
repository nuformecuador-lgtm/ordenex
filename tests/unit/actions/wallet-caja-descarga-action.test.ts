import { describe, it, expect, vi } from "vitest";
import { listarMovimientosCompletoAction } from "@/lib/actions/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 170 / T C.2 (R16/R18 + refuerzo R9/R17/R27) — borde del libro de caja completo.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ITEM: WalletMovimientoDTO = {
  id: "w1",
  tipo: "ingreso",
  categoria: "ingreso_flete",
  monto: "1000.00",
  origenTipo: "cierre_dia",
  origenId: "c1",
  descripcion: null,
  registradoPor: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio", // feature 231 (R31): el flete es dinero de Ordenex
};

function fakeService(resultado: unknown) {
  const listarMovimientosCompleto = vi.fn().mockResolvedValue(resultado);
  return {
    service: { listarMovimientosCompleto } as unknown as IWalletService,
    listarMovimientosCompleto,
  };
}

describe("listarMovimientosCompletoAction (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, listarMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosCompletoAction({}, { service, getActor: async () => null });

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("devuelve validation_error y ninguna fila cuando llega una clave fuera de la lista blanca (R18)", async () => {
    const { service, listarMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosCompletoAction(
      { tipo: "ingreso", tiendaId: "otra-tienda" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("rechaza tambien page/pageSize: el modo completo NO pagina (R18)", async () => {
    const { service, listarMovimientosCompleto } = fakeService({ status: "ok", items: [], total: 0 });

    const r = await listarMovimientosCompletoAction(
      { page: 1, pageSize: 20 },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarMovimientosCompleto).not.toHaveBeenCalled();
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 18_902, limite: 5000 });

    const r = await listarMovimientosCompletoAction(
      { tipo: "egreso" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 18_902, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga forbidden sin filas (R17)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarMovimientosCompletoAction(
      {},
      { service, getActor: async () => ({ usuarioId: "g1", rol: "mensajero" }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio, con el input parseado y SIN paginacion (R9)", async () => {
    const { service, listarMovimientosCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarMovimientosCompletoAction(
      { tipo: "ingreso", categoria: "ingreso_flete" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    const [data, actor] = listarMovimientosCompleto.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toEqual({ tipo: "ingreso", categoria: "ingreso_flete" });
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
