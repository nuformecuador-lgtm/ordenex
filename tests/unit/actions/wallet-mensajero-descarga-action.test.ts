import { describe, it, expect, vi } from "vitest";
import {
  listarPagosDeMensajeroCompletoAction,
} from "@/lib/actions/wallet-mensajero";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletMensajeroService } from "@/lib/interfaces/services/IWalletMensajeroService";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";

// Feature 170 / T C.2 (R14/R16/R18 + refuerzo R9/R17/R27) — borde del ledger del pago por
// mensajero que pide el acceso total (el desglose de UN mensajero).
//
// Ficha 336 (2026-08-30): eran DOS ledgers. El propio del mensajero (`listarMisPagosCompleto`)
// se retiro con `/mis-pagos`, su unica superficie, y con el su `describe`.

const MENSAJERO: Actor = { usuarioId: "msg-A", rol: "mensajero" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ITEM: PagoMensajeroMovimientoDTO = {
  id: "p1",
  mensajeroId: "msg-A",
  tipo: "devengo",
  categoria: "pago_devengado",
  monto: "1000.00",
  origenTipo: "cierre_dia",
  origenId: "c1",
  cierreId: "c1", // feature 205/R43: en un origen `cierre_dia`, el origen ES el cierre
  descripcion: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
};

function fakeService(resultado: unknown) {
  const listarPagosDeMensajeroCompleto = vi.fn().mockResolvedValue(resultado);
  return {
    service: {
      listarPagosDeMensajeroCompleto,
    } as unknown as IWalletMensajeroService,
    listarPagosDeMensajeroCompleto,
  };
}

describe("listarPagosDeMensajeroCompletoAction (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, listarPagosDeMensajeroCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarPagosDeMensajeroCompletoAction(
      { mensajeroId: "msg-A" },
      { service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarPagosDeMensajeroCompleto).not.toHaveBeenCalled();
  });

  it("sin mensajeroId es validation_error, sin tocar el servicio (R18)", async () => {
    const { service, listarPagosDeMensajeroCompleto } = fakeService({
      status: "ok",
      items: [],
      total: 0,
    });

    const r = await listarPagosDeMensajeroCompletoAction(
      {},
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarPagosDeMensajeroCompleto).not.toHaveBeenCalled();
  });

  it("devuelve validation_error con una clave fuera de la lista blanca (R18)", async () => {
    const { service, listarPagosDeMensajeroCompleto } = fakeService({
      status: "ok",
      items: [],
      total: 0,
    });

    const r = await listarPagosDeMensajeroCompletoAction(
      { mensajeroId: "msg-A", incluirOtrosMensajeros: true },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarPagosDeMensajeroCompleto).not.toHaveBeenCalled();
  });

  it("el mensajero NO puede pedir el desglose de otro por esta via (R14)", async () => {
    // El guard vive en el servicio (`esAccesoTotal`); el borde solo debe propagarlo SIN
    // filas. Aquí el doble devuelve lo que devolvería el servicio real con ese actor.
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarPagosDeMensajeroCompletoAction(
      { mensajeroId: "msg-B" },
      { service, getActor: async () => MENSAJERO },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 9001, limite: 5000 });

    const r = await listarPagosDeMensajeroCompletoAction(
      { mensajeroId: "msg-A" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 9001, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio, con el input parseado y SIN paginacion (R9)", async () => {
    const { service, listarPagosDeMensajeroCompleto } = fakeService({
      status: "ok",
      items: [ITEM],
      total: 1,
    });

    const r = await listarPagosDeMensajeroCompletoAction(
      { mensajeroId: "msg-A", cierreId: "c1" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    const [data, actor] = listarPagosDeMensajeroCompleto.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toEqual({ mensajeroId: "msg-A", cierreId: "c1" });
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
