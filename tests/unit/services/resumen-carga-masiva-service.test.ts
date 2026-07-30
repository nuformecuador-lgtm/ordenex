import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { ResumenCargaMasivaService } from "@/lib/services/ResumenCargaMasivaService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 16 / 159 R22(d) — autorizacion y acotado del resumen del lote.
//
// Procedencia: estos casos vivian en `asignacion-mensajero-service.test.ts`, que la
// feature 159 borro entero. De ese archivo se recupera SOLO lo del resumen; los
// `describe` de `listarMensajeros` y los 6 de la asignacion sugerida se descartan
// porque probaban metodos que ya no existen (design.md §7).

const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

/**
 * Doble del repositorio acotado a lo que ESTE servicio usa. El servicio inyecta
 * `IOrdenRepository` entero, pero solo llama a un metodo: tiparlo por ese metodo
 * evita arrastrar los ~55 stubs de la interfaz completa sin perder el contrato.
 */
type RepoDelResumen = Pick<IOrdenRepository, "findResumenByNumRemisiones">;

function buildOrdenRepo(overrides: Partial<RepoDelResumen> = {}): RepoDelResumen {
  return {
    findResumenByNumRemisiones: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function buildService(repo: RepoDelResumen): ResumenCargaMasivaService {
  return new ResumenCargaMasivaService(repo as IOrdenRepository);
}

describe("ResumenCargaMasivaService.resumenCargaMasiva (R11)", () => {
  it("adminTienda -> ok con el resumen de su tienda", async () => {
    const ordenRepo = buildOrdenRepo({
      findResumenByNumRemisiones: vi.fn().mockResolvedValue([
        {
          id: "ord-1",
          numGuia: 1,
          numRemision: "REM-1",
          destinatario: "Ana",
          telefonoDest: "099",
          producto: "Caja",
          montoCobrar: null,
          direccion: null,
          zonaId: "z1",
          zonaNombre: "Norte",
        },
      ]),
    });
    const service = buildService(ordenRepo);

    const r = await service.resumenCargaMasiva({ numRemisiones: ["REM-1"] }, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.ordenes).toHaveLength(1);
    // R22(d): el acotado NO es opcional — la tienda es SIEMPRE la del actor, nunca
    // una que venga del input.
    expect(ordenRepo.findResumenByNumRemisiones).toHaveBeenCalledWith(["REM-1"], "store1");
  });

  it.each([MAESTRO, ADMIN, MENSAJERO, DESCONOCIDO])(
    "rol %o distinto de adminTienda -> forbidden sin consultar el repo",
    async (actor) => {
      const ordenRepo = buildOrdenRepo();
      const service = buildService(ordenRepo);

      const r = await service.resumenCargaMasiva({ numRemisiones: ["REM-1"] }, actor);

      expect(r.status).toBe("forbidden");
      expect(ordenRepo.findResumenByNumRemisiones).not.toHaveBeenCalled();
    },
  );

  it("propaga el resultado del repo tal cual, sin filtrar ni enriquecer", async () => {
    const ordenes = [
      {
        id: "ord-1",
        numGuia: null,
        numRemision: "REM-1",
        destinatario: "Ana",
        telefonoDest: "099",
        producto: "Caja",
        montoCobrar: 12.5,
        direccion: "Av. Siempre Viva",
        estatusValue: "en_preparacion",
        zonaId: "z1",
        zonaNombre: "Norte",
      },
    ];
    const service = buildService(
      buildOrdenRepo({ findResumenByNumRemisiones: vi.fn().mockResolvedValue(ordenes) }),
    );

    const r = await service.resumenCargaMasiva({ numRemisiones: ["REM-1"] }, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.ordenes).toEqual(ordenes);
  });
});
