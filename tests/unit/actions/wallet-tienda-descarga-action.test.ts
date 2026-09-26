import { describe, it, expect, vi } from "vitest";
import { verMiEstadoCuentaCompletoAction } from "@/lib/actions/estado-cuenta";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import { estado } from "@/tests/fixtures/estado-cuenta";

// Feature 170 / T C.2 (R14/R16/R18 + refuerzo R9/R17/R27) — borde del ledger completo de la
// tienda. El caso que manda aquí es R18 con la clave `tiendaId`: es la PRIMERA de las dos
// barreras contra la fuga (la segunda vive en el servicio: la cuenta la pone `leerMiTiendaCompleto`
// con el actor, medido contra Postgres en `tests/integration/db/estado-cuenta-servidor-458d.test.ts`).
//
// FICHA 458-D (cierre) — la descarga de `/mi-wallet` es hoy la del ESTADO DE CUENTA
// (`verMiEstadoCuentaCompletoAction`); `listarMisMovimientosCompletoAction` se retiró sin llamadores
// fuera de los tests. Esta red se MUEVE a la action nueva con los mismos seis casos y las mismas R.

const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-00000000000a", rol: "adminTienda" };
const TIENDA_AJENA = "99999999-9999-4999-8999-999999999999";

function fakeService(resultado: unknown) {
  const leerMiTiendaCompleto = vi.fn().mockResolvedValue(resultado);
  const service = {
    leer: vi.fn(),
    leerCompleto: vi.fn(),
    leerMiTienda: vi.fn(),
    leerMiTiendaCompleto,
  } as unknown as IEstadoCuentaService;
  return { service, leerMiTiendaCompleto };
}

describe("verMiEstadoCuentaCompletoAction (borde de la descarga de /mi-wallet, 170)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, leerMiTiendaCompleto } = fakeService({ status: "ok", estado: estado() });

    const r = await verMiEstadoCuentaCompletoAction({}, { service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(r).not.toHaveProperty("estado");
    expect(leerMiTiendaCompleto).not.toHaveBeenCalled();
  });

  it("un tiendaId inyectado es validation_error y NO llega al servicio (R14/R18)", async () => {
    const { service, leerMiTiendaCompleto } = fakeService({ status: "ok", estado: estado() });

    const r = await verMiEstadoCuentaCompletoAction({ tiendaId: TIENDA_AJENA }, { service, getActor: async () => TIENDA });

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("estado");
    expect(leerMiTiendaCompleto).not.toHaveBeenCalled();
  });

  it("rechaza tambien page/pageSize: el modo completo NO pagina (R18)", async () => {
    for (const input of [{ page: 1, pageSize: 20 }, { pageSize: 20 }]) {
      const { service, leerMiTiendaCompleto } = fakeService({ status: "ok", estado: estado() });

      const r = await verMiEstadoCuentaCompletoAction(input, { service, getActor: async () => TIENDA });

      expect(r.status).toBe("validation_error");
      expect(leerMiTiendaCompleto).not.toHaveBeenCalled();
    }
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 6120, limite: 5000 });

    const r = await verMiEstadoCuentaCompletoAction({}, { service, getActor: async () => TIENDA });

    expect(r).toEqual({ status: "limite_excedido", total: 6120, limite: 5000 });
    expect(r).not.toHaveProperty("estado");
  });

  it("propaga forbidden sin filas (R17)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await verMiEstadoCuentaCompletoAction(
      {},
      { service, getActor: async () => ({ usuarioId: "m1", rol: "maestro" }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("estado");
  });

  it("entrega el estado del servicio, con el input parseado y SIN paginacion ni cuenta (R9)", async () => {
    const e = estado();
    const { service, leerMiTiendaCompleto } = fakeService({ status: "ok", estado: e });

    const r = await verMiEstadoCuentaCompletoAction({ chip: "cobros" }, { service, getActor: async () => TIENDA });

    expect(r).toEqual({ status: "ok", estado: e });
    const [data, actor] = leerMiTiendaCompleto.mock.calls[0];
    expect(actor).toEqual(TIENDA);
    expect(data).toEqual({ chip: "cobros" });
    expect(data).not.toHaveProperty("tiendaId");
    expect(data).not.toHaveProperty("cuenta");
    expect(data).not.toHaveProperty("page");
  });
});
