import { describe, it, expect, vi, beforeEach } from "vitest";

// Revision 476, m1 — las deps de PRODUCCION del informe de transito: el repo se construye en cada
// `generar` sobre el cliente de ESE momento (sin memoizar) y nada se abre al importar el modulo.

const h = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
  clientesDelRepo: [] as unknown[],
}));

vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: h.getPrismaClient }));
vi.mock("@/lib/repositories/InformeTransitoRepository", () => ({
  InformeTransitoRepository: class {
    constructor(private readonly prisma: unknown) {
      h.clientesDelRepo.push(prisma);
    }
    async zonas() {
      return [];
    }
    async filasEnAlerta() {
      return [];
    }
    async contarSinHito() {
      return 0;
    }
  },
}));

import { crearInformeTransito } from "@/lib/whatsapp-envios/informes/transito/informe";
import { PARAMETROS_POR_DEFECTO } from "@/lib/whatsapp-envios/informes/transito/parametros";

const ctx = { parametros: PARAMETROS_POR_DEFECTO, ahora: new Date("2026-10-05T11:00:00.000Z"), conDocumento: false };

describe("476/m1 — deps de produccion del transito sin memoizar", () => {
  beforeEach(() => {
    h.getPrismaClient.mockReset();
    h.clientesDelRepo.length = 0;
  });

  it("crear el informe no abre conexion; cada generar construye el repo con el cliente de ESE momento", async () => {
    const informe = crearInformeTransito();
    expect(h.getPrismaClient).not.toHaveBeenCalled();

    const primero = { nombre: "cliente-1" };
    const segundo = { nombre: "cliente-2" };
    h.getPrismaClient.mockReturnValueOnce(primero).mockReturnValueOnce(segundo);
    await informe.generar(ctx);
    await informe.generar(ctx);

    expect(h.getPrismaClient).toHaveBeenCalledTimes(2);
    expect(h.clientesDelRepo).toEqual([primero, segundo]);
  });
});
