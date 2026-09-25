import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import * as accionesPagoPorCuenta from "@/lib/actions/pago-por-cuenta-tienda";
import * as accionesAporte from "@/lib/actions/aporte-capital";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPagoPorCuentaTiendaService } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { IAporteCapitalService } from "@/lib/interfaces/services/IAporteCapitalService";

/**
 * FICHA 459 / T B.12 — el BORDE de las dos actions nuevas, con el servicio doble: la sesion va
 * ANTES de mirar la entrada (R38/R76), zod `.strict()` rechaza lo no previsto (R37/R69), el
 * `File` del `FormData` llega como bytes al servicio, un campo de archivo VACIO es «sin
 * comprobante», y no existe ninguna action de editar ni de deshacer una anulacion (R52).
 * El camino hasta Postgres lo prueban `tests/integration/db/pago-por-cuenta-tienda.test.ts` y
 * `aporte-capital.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA = "7f1c2d3e-0000-4000-8000-00000000000a";

function fd(campos: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

const PAGO = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: TIENDA,
  beneficiario: "Facebook",
  monto: "10000.00",
  metodo: "SINPE",
  referencia: "123",
  motivo: "Publicidad",
};

function servicioPago(): IPagoPorCuentaTiendaService {
  return {
    registrar: vi.fn(async () => ({ status: "forbidden" as const })),
    anular: vi.fn(async () => ({ status: "ya_anulado" as const })),
    obtenerComprobante: vi.fn(async () => ({ status: "sin_comprobante" as const })),
  };
}

function servicioAporte(): IAporteCapitalService {
  return {
    registrar: vi.fn(async () => ({ status: "ya_hay_saldo_inicial" as const })),
    anular: vi.fn(async () => ({ status: "ya_anulado" as const })),
    obtenerComprobante: vi.fn(async () => ({ status: "sin_comprobante" as const })),
  };
}

describe("459/T B.12 — las exportaciones (R52: ni editar ni deshacer)", () => {
  it("pago por cuenta: lista EXACTA", () => {
    expect(Object.keys(accionesPagoPorCuenta).sort()).toEqual([
      "anularPagoPorCuentaTiendaAction",
      "obtenerComprobantePagoPorCuentaAction",
      "registrarPagoPorCuentaTiendaAction",
    ]);
  });
  it("saldo inicial o aporte: lista EXACTA", () => {
    expect(Object.keys(accionesAporte).sort()).toEqual([
      "anularAporteCapitalAction",
      "obtenerComprobanteAporteCapitalAction",
      "registrarAporteCapitalAction",
    ]);
  });
});

describe("459/T B.12 — registrarPagoPorCuentaTiendaAction", () => {
  it("R38: sin sesion -> unauthenticated, ANTES de validar (una entrada invalida no cambia la respuesta)", async () => {
    const service = servicioPago();
    const r = await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(fd({ basura: "x" }), {
      service,
      getActor: async () => null,
    });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R37: una clave no prevista -> validation_error, sin llamar al servicio", async () => {
    const service = servicioPago();
    const r = await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(
      fd({ ...PAGO, categoria: "ajuste_debito" }),
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("R31: el error se devuelve bajo el campo", async () => {
    const service = servicioPago();
    const r = await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(
      fd({ ...PAGO, beneficiario: "   " }),
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("imposible");
    expect(Object.keys(r.fieldErrors)).toEqual(["beneficiario"]);
  });

  it("el File del FormData llega al servicio como bytes con su tipo; el resto sin el comprobante", async () => {
    const service = servicioPago();
    const archivo = new File([new Uint8Array([1, 2, 3])], "c.pdf", { type: "application/pdf" });
    await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(fd({ ...PAGO, comprobante: archivo }), {
      service,
      getActor: async () => MAESTRO,
    });
    const [input, recibido, actor] = vi.mocked(service.registrar).mock.calls[0];
    expect(input).not.toHaveProperty("comprobante");
    expect(input).toMatchObject({ beneficiario: "Facebook", monto: "10000.00", tiendaId: TIENDA });
    expect(recibido?.contentType).toBe("application/pdf");
    expect([...(recibido?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(actor).toBe(MAESTRO);
  });

  it("un campo de archivo VACIO (0 bytes) es «sin comprobante», no un comprobante invalido", async () => {
    const service = servicioPago();
    const vacio = new File([], "", { type: "application/octet-stream" });
    await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(fd({ ...PAGO, comprobante: vacio }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(vi.mocked(service.registrar).mock.calls[0][1]).toBeNull();
  });

  it("devuelve lo que responde el servicio (forbidden incluido, R38)", async () => {
    const r = await accionesPagoPorCuenta.registrarPagoPorCuentaTiendaAction(fd(PAGO), {
      service: servicioPago(),
      getActor: async () => ({ usuarioId: "m", rol: "mensajero" }),
    });
    expect(r).toEqual({ status: "forbidden" });
  });
});

describe("459/T B.12 — anular y comprobante del pago por cuenta", () => {
  it("R37: un monto en la anulacion -> validation_error sin llamar al servicio", async () => {
    const service = servicioPago();
    const r = await accionesPagoPorCuenta.anularPagoPorCuentaTiendaAction(
      { pagoId: TIENDA, motivo: "Error", monto: "1.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.anular).not.toHaveBeenCalled();
  });

  it("R38: sin sesion -> unauthenticated", async () => {
    const service = servicioPago();
    expect(
      await accionesPagoPorCuenta.anularPagoPorCuentaTiendaAction(
        { pagoId: TIENDA, motivo: "Error" },
        { service, getActor: async () => null },
      ),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await accionesPagoPorCuenta.obtenerComprobantePagoPorCuentaAction(
        { pagoId: TIENDA },
        { service, getActor: async () => null },
      ),
    ).toEqual({ status: "unauthenticated" });
    expect(service.anular).not.toHaveBeenCalled();
    expect(service.obtenerComprobante).not.toHaveBeenCalled();
  });

  it("entrada valida -> el servicio decide", async () => {
    const service = servicioPago();
    expect(
      await accionesPagoPorCuenta.anularPagoPorCuentaTiendaAction(
        { pagoId: TIENDA, motivo: "Error" },
        { service, getActor: async () => MAESTRO },
      ),
    ).toEqual({ status: "ya_anulado" });
  });
});

describe("459/T B.12 — saldo inicial o aporte", () => {
  const APORTE = {
    claveIdempotencia: "22222222-2222-4222-8222-222222222222",
    clase: "saldo_inicial",
    monto: "1000000.00",
    fecha: "2026-08-01",
    motivo: "Saldo del banco",
  };

  it("R76: sin sesion -> unauthenticated antes de validar", async () => {
    const service = servicioAporte();
    expect(
      await accionesAporte.registrarAporteCapitalAction(fd({ x: "y" }), { service, getActor: async () => null }),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await accionesAporte.anularAporteCapitalAction({ aporteId: TIENDA, motivo: "x" }, { service, getActor: async () => null }),
    ).toEqual({ status: "unauthenticated" });
    expect(service.registrar).not.toHaveBeenCalled();
    expect(service.anular).not.toHaveBeenCalled();
  });

  it("R69/R27: una clave no prevista (un importe «sugerido») -> validation_error sin llamar al servicio", async () => {
    const service = servicioAporte();
    const r = await accionesAporte.registrarAporteCapitalAction(fd({ ...APORTE, sugerido: "1.00" }), {
      service,
      getActor: async () => MAESTRO,
    });
    expect(r.status).toBe("validation_error");
    expect(service.registrar).not.toHaveBeenCalled();
  });

  it("entrada valida sin archivo -> el servicio recibe `null` y decide", async () => {
    const service = servicioAporte();
    const r = await accionesAporte.registrarAporteCapitalAction(fd(APORTE), { service, getActor: async () => MAESTRO });
    expect(r).toEqual({ status: "ya_hay_saldo_inicial" });
    expect(vi.mocked(service.registrar).mock.calls[0][1]).toBeNull();
  });

  it("R74: un monto en la anulacion -> validation_error", async () => {
    const service = servicioAporte();
    const r = await accionesAporte.anularAporteCapitalAction(
      { aporteId: TIENDA, motivo: "x", monto: "5" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.anular).not.toHaveBeenCalled();
  });
});

describe("459/T B.12 — guardia: no queda ningun `TODO(459-B)` en el codigo", () => {
  it("lib/ y app/ no contienen la marca del lector provisional de T A.4", () => {
    const raiz = process.cwd();
    const hallados: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx)$/.test(nombre) && readFileSync(ruta, "utf8").includes("TODO(459-B)")) {
          hallados.push(ruta.slice(raiz.length + 1));
        }
      }
    };
    recorrer(join(raiz, "lib"));
    recorrer(join(raiz, "app"));
    expect(hallados).toEqual([]);
  });
});
