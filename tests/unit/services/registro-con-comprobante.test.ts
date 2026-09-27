import { describe, it, expect, vi } from "vitest";

import type { IWalletComprobanteService } from "@/lib/interfaces/services/IWalletComprobanteService";
import { lateralesDeCaja, registrarConComprobante } from "@/lib/services/registro-con-comprobante";

// FICHA 458-B / TB.11 (R42, R74–R76) — el molde del comprobante al registrar y los laterales de la caja.

const PNG = { contentType: "image/png", bytes: new Uint8Array([1]) };
const GUARDADO = { storagePath: "movimientos-caja/x.png", contentType: "image/png" };

function puerto(subida: Awaited<ReturnType<IWalletComprobanteService["subir"]>> = { status: "ok", guardado: GUARDADO }) {
  return {
    subir: vi.fn(async () => subida),
    registrarEnTx: vi.fn(),
    retirar: vi.fn(async () => undefined),
    adjuntar: vi.fn(),
    ver: vi.fn(),
  } satisfies IWalletComprobanteService;
}

describe("458-B/TB.11 — registrarConComprobante", () => {
  it("sin comprobante: escribe con `null` y NO toca el almacenamiento (ni hace falta el puerto)", async () => {
    const escribir = vi.fn(async () => ({ quedo: true, resultado: { status: "ok" } }));
    expect(await registrarConComprobante(undefined, "wallet_movimiento", null, escribir)).toEqual({ status: "ok" });
    expect(escribir).toHaveBeenCalledWith(null);
  });

  it("con comprobante y SIN puerto lanza: un composition root que no inyecta no descarta el archivo en silencio", async () => {
    const escribir = vi.fn(async () => ({ quedo: true, resultado: { status: "ok" } }));
    await expect(registrarConComprobante(undefined, "wallet_movimiento", PNG, escribir)).rejects.toThrow(/composition root/);
    expect(escribir).not.toHaveBeenCalled();
  });

  it("R75/R76: invalido → `validation_error` bajo `comprobante`; no guardado → `comprobante_no_guardado`; en ninguno se escribe", async () => {
    const escribir = vi.fn(async () => ({ quedo: true, resultado: { status: "ok" } }));
    expect(await registrarConComprobante(puerto({ status: "invalido", problema: "tipo" }), "wallet_movimiento", PNG, escribir)).toEqual({
      status: "validation_error",
      fieldErrors: { comprobante: ["tipo"] },
    });
    expect(await registrarConComprobante(puerto({ status: "no_guardado" }), "wallet_movimiento", PNG, escribir)).toEqual({
      status: "comprobante_no_guardado",
    });
    expect(escribir).not.toHaveBeenCalled();
  });

  it("R76: si quedo, el objeto se conserva; si no quedo o lanzo, se retira", async () => {
    const ok = puerto();
    await registrarConComprobante(ok, "wallet_movimiento", PNG, async () => ({ quedo: true, resultado: 1 }));
    expect(ok.retirar).not.toHaveBeenCalled();
    const noQuedo = puerto();
    await registrarConComprobante(noQuedo, "wallet_movimiento", PNG, async () => ({ quedo: false, resultado: 1 }));
    expect(noQuedo.retirar).toHaveBeenCalledWith(GUARDADO);
    const lanza = puerto();
    await expect(
      registrarConComprobante(lanza, "wallet_movimiento", PNG, async () => {
        throw new Error("base");
      }),
    ).rejects.toThrow("base");
    expect(lanza.retirar).toHaveBeenCalledWith(GUARDADO);
  });
});

describe("458-B/TB.11 — lateralesDeCaja (R42)", () => {
  it("nada nuevo → `undefined` (el repositorio recibe la llamada de antes)", () => {
    expect(lateralesDeCaja({}, null, "u")).toBeUndefined();
  });

  it("solo «a quien», solo referencia, solo comprobante, todo", () => {
    expect(lateralesDeCaja({ contraparteNombre: "Ana" }, null, "u")).toEqual({ anotacion: { contraparteNombre: "Ana", referencia: null } });
    expect(lateralesDeCaja({ referencia: "R1" }, null, "u")).toEqual({ anotacion: { contraparteNombre: null, referencia: "R1" } });
    expect(lateralesDeCaja({}, GUARDADO, "u")).toEqual({ comprobante: { ...GUARDADO, subidoPor: "u" } });
    expect(lateralesDeCaja({ contraparteNombre: "Ana", referencia: "R1" }, GUARDADO, "u")).toEqual({
      anotacion: { contraparteNombre: "Ana", referencia: "R1" },
      comprobante: { ...GUARDADO, subidoPor: "u" },
    });
  });
});
