import { describe, it, expect } from "vitest";

import { MAESTRO, OTRA_TIENDA, TIENDA_ID, montar, registro } from "./_abono-tienda-montar";

/**
 * FICHA 457 / T4.3 — `AbonoTiendaService.obtenerComprobante` (R42–R44, DH3): acceso total ve cualquiera;
 * la tienda DUEÑA ve el suyo; una tienda ajena recibe lo MISMO que con un id inexistente; sin comprobante
 * no hay enlace; el TTL es el de la config.
 */

const CON = registro({ comprobantePath: "abonos-tienda/abc.pdf", comprobanteContentType: "application/pdf" });

describe("457/T4.3 — el comprobante", () => {
  it("R42: acceso total (maestro y admin) -> enlace temporal con el TTL de la config", async () => {
    const m = montar({ documento: CON });
    expect(await m.svc.obtenerComprobante("ab-1", MAESTRO)).toEqual({
      status: "ok",
      url: "https://firmada/abonos-tienda/abc.pdf?t=300",
    });
    expect(m.urls.createSignedUrl).toHaveBeenCalledWith("abonos-tienda/abc.pdf", 300);
    const a = montar({ documento: CON });
    expect((await a.svc.obtenerComprobante("ab-1", { usuarioId: "u-admin", rol: "admin" })).status).toBe("ok");
  });

  it("R42 (DH3): la tienda DUEÑA ve el suyo", async () => {
    const m = montar({ documento: CON });
    expect((await m.svc.obtenerComprobante("ab-1", { usuarioId: TIENDA_ID, rol: "adminTienda" })).status).toBe("ok");
  });

  it("R43: una tienda ajena y un id inexistente reciben la MISMA respuesta (no_encontrado), sin enlace", async () => {
    const ajena = montar({ documento: CON });
    expect(await ajena.svc.obtenerComprobante("ab-1", { usuarioId: OTRA_TIENDA, rol: "adminTienda" })).toEqual({
      status: "no_encontrado",
    });
    expect(ajena.urls.createSignedUrl).not.toHaveBeenCalled();
    const inexistente = montar({ documento: null });
    expect(await inexistente.svc.obtenerComprobante("ab-x", { usuarioId: OTRA_TIENDA, rol: "adminTienda" })).toEqual({
      status: "no_encontrado",
    });
    // Y para acceso total un id inexistente tambien es no_encontrado.
    expect(await montar({ documento: null }).svc.obtenerComprobante("ab-x", MAESTRO)).toEqual({ status: "no_encontrado" });
  });

  it("R44: sin comprobante -> sin_comprobante, sin generar ningun enlace", async () => {
    const m = montar(); // el registro por defecto no lleva comprobante
    expect(await m.svc.obtenerComprobante("ab-1", MAESTRO)).toEqual({ status: "sin_comprobante" });
    expect(m.urls.createSignedUrl).not.toHaveBeenCalled();
  });

  it("un mensajero o un admin de satelite -> forbidden, sin leer el documento", async () => {
    for (const rol of ["mensajero", "adminSatelite"] as const) {
      const m = montar({ documento: CON });
      expect(await m.svc.obtenerComprobante("ab-1", { usuarioId: "x", rol })).toEqual({ status: "forbidden" });
      expect(m.abonoRepo.obtenerPorId).not.toHaveBeenCalled();
    }
  });
});
