import { describe, expect, it, vi } from "vitest";

import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Ficha 458-A (TA.6, R4, C4.2 de design §1.1) — el texto del reverso de un egreso NO cae al id
// interno cuando el egreso no tiene descripcion: cae al NOMBRE del concepto.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ID = "5b1f0c2e-7a3d-4c8e-9f10-2a3b4c5d6e7f";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function original(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: ID,
    tipo: "egreso",
    categoria: "egreso_sueldo",
    monto: "1000.00",
    origenTipo: "gasto",
    origenId: null,
    descripcion: null,
    registradoPor: "u-maestro",
    fechaMovimiento: "2026-09-12T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

async function descripcionDelReverso(o: WalletMovimientoDTO): Promise<string | null | undefined> {
  const crearMovimientoRegistrado = vi.fn(async () => 1);
  const repo = {
    obtenerPorId: vi.fn(async () => o),
    crearMovimientoRegistrado,
  } as unknown as IWalletMovimientoRepository;
  const svc = new WalletEgresoService(repo, {} as WalletTxClient);
  const r = await svc.reversarEgreso({ movimientoId: ID }, MAESTRO);
  expect(r).toEqual({ status: "ok" });
  const [mov] = crearMovimientoRegistrado.mock.calls[0] as unknown as [CrearMovimientoInput];
  return mov.descripcion;
}

describe("458-A R4 — el reverso de un egreso sin descripción se lee por su concepto", () => {
  it("sueldo sin descripción → «Reverso de: Sueldo», nunca el id", async () => {
    const d = await descripcionDelReverso(original({ categoria: "egreso_sueldo" }));
    expect(d).toBe("Reverso de: Sueldo");
    expect(d).not.toMatch(UUID);
  });

  it("gasto de Ordenex sin descripción → «Reverso de: Gasto de Ordenex»", async () => {
    expect(await descripcionDelReverso(original({ categoria: "egreso_gasto_variable" }))).toBe(
      "Reverso de: Gasto de Ordenex",
    );
  });

  it("con descripción, se conserva tal cual (sin cambio de comportamiento)", async () => {
    expect(await descripcionDelReverso(original({ descripcion: "Internet oficina" }))).toBe(
      "Reverso de: Internet oficina",
    );
  });
});
