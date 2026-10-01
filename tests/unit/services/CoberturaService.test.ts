import { describe, it, expect, vi } from "vitest";

import type { ICoberturaRepository } from "@/lib/interfaces/repositories/ICoberturaRepository";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import { CoberturaService } from "@/lib/services/CoberturaService";

import { fila } from "../utils/_cobertura-fixtures";

// Ficha 465 (T5) — la puerta de rol (R2), la orquestacion (R4, R6) y el solo-lectura (R21).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function repoDoble(): ICoberturaRepository & {
  listDistritos: ReturnType<typeof vi.fn>;
  listZonaIdsConTarifaGeneral: ReturnType<typeof vi.fn>;
} {
  return {
    listDistritos: vi.fn(async () => [
      fila({ provincia: "San José", canton: "Escazú", distrito: "San Rafael", zonas: [{ id: "z1", nombre: "GAM", esCentral: true }] }),
      fila({ provincia: "Alajuela", canton: "Grecia", distrito: "Tacares", zonas: [] }),
      fila({ provincia: "Alajuela", canton: "Atenas", distrito: "Jesús", zonas: [{ id: "z2", nombre: "Occidente" }] }),
    ]),
    listZonaIdsConTarifaGeneral: vi.fn(async () => ["z1"]),
  };
}

describe("465/R2 — solo maestro, y la puerta va ANTES de leer", () => {
  it.each(["adminTienda", "mensajero", "adminSatelite", "apiKey"] as const)(
    "rol %s -> forbidden con 0 llamadas al repositorio",
    async (rol) => {
      const repo = repoDoble();
      const r = await new CoberturaService(repo).listar({ usuarioId: "u", rol } as Actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(repo.listDistritos).not.toHaveBeenCalled();
      expect(repo.listZonaIdsConTarifaGeneral).not.toHaveBeenCalled();
    },
  );
});

describe("465/R4, R6, R14 — maestro: filas clasificadas y ordenadas", () => {
  it("una fila por distrito, en orden provincia/canton/distrito, con la tarifa general cruzada", async () => {
    const repo = repoDoble();
    const r = await new CoberturaService(repo).listar(MAESTRO);
    if (r.status !== "ok") throw new Error(`se esperaba ok y llego ${r.status}`);
    expect(r.total).toBe(3);
    expect(r.items.map((d) => d.distrito)).toEqual(["Jesús", "Tacares", "San Rafael"]);
    const [jesus, tacares, sanRafael] = r.items;
    expect(jesus.zonaUnica).toEqual({ nombre: "Occidente", esCentral: false, tieneTarifaGeneral: false });
    expect(tacares).toMatchObject({ cobertura: false, motivo: "sin_zona", zonaUnica: null });
    expect(sanRafael.zonaUnica).toEqual({ nombre: "GAM", esCentral: true, tieneTarifaGeneral: true });
  });

  it("lee en CADA llamada (R4): dos listados -> dos lecturas", async () => {
    const repo = repoDoble();
    const service = new CoberturaService(repo);
    await service.listar(MAESTRO);
    await service.listar(MAESTRO);
    expect(repo.listDistritos).toHaveBeenCalledTimes(2);
    expect(repo.listZonaIdsConTarifaGeneral).toHaveBeenCalledTimes(2);
  });
});

describe("465 — el tope unico de filas", () => {
  it("mas filas que el tope -> limite_excedido SIN items", async () => {
    const r = await new CoberturaService(repoDoble(), 2).listar(MAESTRO);
    expect(r).toEqual({ status: "limite_excedido", total: 3, limite: 2 });
  });

  it("exactamente el tope -> ok", async () => {
    const r = await new CoberturaService(repoDoble(), 3).listar(MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("465/R21 — la descarga no escribe", () => {
  it("el servicio funciona con un repositorio que SOLO expone las dos lecturas", async () => {
    // Un Proxy que revienta ante cualquier otra propiedad: si el servicio intentara llamar a un
    // metodo de escritura (o a cualquier otro), el test caeria aqui.
    const base = repoDoble();
    const accedidas = new Set<string>();
    const estricto = new Proxy(base, {
      get(objetivo, prop) {
        accedidas.add(String(prop));
        if (prop !== "listDistritos" && prop !== "listZonaIdsConTarifaGeneral" && prop !== "then") {
          throw new Error(`acceso inesperado al repositorio: ${String(prop)}`);
        }
        return Reflect.get(objetivo, prop);
      },
    });
    const r = await new CoberturaService(estricto).listar(MAESTRO);
    expect(r.status).toBe("ok");
    expect([...accedidas].filter((p) => p !== "then").sort()).toEqual([
      "listDistritos",
      "listZonaIdsConTarifaGeneral",
    ]);
  });
});
