import { describe, it, expect, vi } from "vitest";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import type {
  GestionEditableDelCierre,
  ICierresAdminRepository,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Pedido humano (2026-08-19) — las GUARDIAS de la corrección del desglose de pago de una
// gestión desde el detalle de un cierre abierto. Dobles del repo (sin DB): lo que se afirma es
// qué NO llega a escribirse y con qué llega lo que sí.
//
// Por qué cada caso está aquí y no es ruido: los cuatro rechazos de abajo son las cuatro formas
// que tiene esta pantalla de mover plata que no debería. El reparto por método es la `E` del
// `min(P, E)` con el que se le paga al mensajero (feature 44), así que colar una corrección de
// un cierre ya aprobado, de una bodega ajena, de una gestión que no cobró o con una suma
// distinta a la declarada no produce un número feo: le paga de más o de menos a una persona.

const MAESTRO: Actor = { usuarioId: "adm", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "adm-2", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "adm-sat", rol: "adminSatelite" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const GESTION = "g-1";

/** La gestión editable por defecto: entrega de 10.000 cobrada entera en efectivo. */
function editable(
  overrides: Partial<GestionEditableDelCierre> = {},
): GestionEditableDelCierre {
  return {
    gestionId: GESTION,
    cierreId: "c-1",
    cierreEstado: "solicitado",
    resultado: "entregada",
    montoRecibido: "10000.00",
    pagos: [{ metodo: "efectivo", monto: "10000.00" }],
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<ICierresAdminRepository> = {}): ICierresAdminRepository {
  return {
    findCierresByAlcance: vi.fn(async () => []),
    findHistoricoPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findColaPaginada: vi.fn(async () => ({ items: [], total: 0 })),
    findHistoricoCompleto: vi.fn(async () => []),
    findColaCompleta: vi.fn(async () => []),
    findCierreByIdEnAlcance: vi.fn(async () => null),
    resolverCierre: vi.fn(async () => "updated" as const),
    forzarSolicitudVencido: vi.fn(async () => "updated" as const),
    findGestionesIncidenteDelCierre: vi.fn(async () => []),
    // Merge 238 <- dev (2026-08-19): la confirmacion fisica al aprobar amplio el contrato del
    // repositorio. Esta suite no toca esa ruta; stub neutro (ningun retornable que confirmar).
    findGestionesRetornablesDelCierre: vi.fn(async () => []),
    findGestionesPorAlcanceCompleto: vi.fn(async () => []),
    findCatalogoFiltros: vi.fn(async () => ({ zonas: [], mensajeros: [] })),
    findGestionEditableEnCierre: vi.fn(async () => editable()),
    actualizarPagosGestion: vi.fn(async () => ({
      status: "updated" as const,
      totales: {
        efectivo: "0.00",
        simpe: "10000.00",
        transferencia: "0.00",
        general: "10000.00",
      },
    })),
    ...overrides,
  };
}

function newService(repo: ICierresAdminRepository) {
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => "z-central"),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z-sat"),
    findEstatusIdByValue: vi.fn(async () => "os-x"),
  } as unknown as IOrdenRepository;
  const signedUrls = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  return new CierresAdminService(repo, zonaRepo, ordenRepo, signedUrls, {
    sumarVigentesPorCierre: vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "0.00"])),
    ),
    obtenerCierreParaPago: vi.fn(async () => null),
  });
}

/** El desglose «bueno» del caso base: 10.000 repartidos entre dos métodos. */
const LINEAS_OK = [
  { metodo: "efectivo" as const, monto: "6000" },
  { metodo: "SINPE" as const, monto: "4000" },
];

describe("CierresAdminService.actualizarPagosGestion — quién puede corregir", () => {
  it("maestro y admin corrigen; el desglose llega al repo TAL CUAL", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const repo = fakeRepo();
      const r = await newService(repo).actualizarPagosGestion(
        { gestionId: GESTION, lineas: LINEAS_OK },
        actor,
      );

      expect(r.status, `rol ${actor.rol}`).toBe("ok");
      const escritura = vi.mocked(repo.actualizarPagosGestion).mock.calls[0]![0];
      expect(escritura.lineas).toEqual(LINEAS_OK);
      // El rastro es el ACTOR de la sesión, nunca algo que venga en la petición.
      expect(escritura.editadoPor).toBe(actor.usuarioId);
    }
  });

  it("el adminSatelite NO corrige, aunque VEA (y apruebe) los cierres de su zona", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      ADMIN_SATELITE,
    );

    expect(r.status).toBe("forbidden");
    // Ni siquiera se LEE la gestión: el guard de rol va delante de todo.
    expect(repo.findGestionEditableEnCierre).not.toHaveBeenCalled();
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });

  it("un mensajero tampoco: la corrección no es su camino", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      MENSAJERO,
    );
    expect(r.status).toBe("forbidden");
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });
});

describe("CierresAdminService.actualizarPagosGestion — qué se puede corregir", () => {
  it("solo mientras el cierre está ABIERTO: aprobado y rechazado dan conflict", async () => {
    for (const estado of ["aprobado", "rechazado"] as const) {
      const repo = fakeRepo({
        findGestionEditableEnCierre: vi.fn(async () => editable({ cierreEstado: estado })),
      });
      const r = await newService(repo).actualizarPagosGestion(
        { gestionId: GESTION, lineas: LINEAS_OK },
        MAESTRO,
      );

      expect(r.status, estado).toBe("conflict");
      expect(repo.actualizarPagosGestion, estado).not.toHaveBeenCalled();
    }
  });

  it("un cierre `vencido` SÍ se corrige: sigue abierto, solo que nadie lo solicitó", async () => {
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () => editable({ cierreEstado: "vencido" })),
    });
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(repo.actualizarPagosGestion).toHaveBeenCalledTimes(1);
  });

  it("fuera de alcance / inexistente -> no_encontrada, sin distinguir", async () => {
    const repo = fakeRepo({ findGestionEditableEnCierre: vi.fn(async () => null) });
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      MAESTRO,
    );
    expect(r.status).toBe("no_encontrada");
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });

  it("un resultado que no es `entregada` no tiene desglose que corregir", async () => {
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () =>
        editable({ resultado: "devuelta", montoRecibido: null, pagos: [] }),
      ),
    });
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: [{ metodo: "efectivo", monto: "1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });

  it("una entrega SIN cobro no reparte cero colones entre métodos", async () => {
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () =>
        editable({ montoRecibido: "0.00", pagos: [] }),
      ),
    });
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: [{ metodo: "efectivo", monto: "1" }] },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });
});

describe("CierresAdminService.actualizarPagosGestion — el total NO se mueve", () => {
  it("la suma tiene que ser EXACTAMENTE lo que declaró el mensajero", async () => {
    // 6.000 + 3.999 = 9.999, un céntimo menos de lo declarado: el reparto no puede colar una
    // rebaja del recaudo disfrazada de corrección de método.
    const repo = fakeRepo();
    const r = await newService(repo).actualizarPagosGestion(
      {
        gestionId: GESTION,
        lineas: [
          { metodo: "efectivo", monto: "6000" },
          { metodo: "SINPE", monto: "3999" },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      // El mensaje dice contra QUÉ tiene que cuadrar: sin el total, el admin no sabe qué
      // corregir sin cerrar el diálogo.
      expect(r.fieldErrors.lineas?.[0]).toContain("10000.00");
    }
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });

  it("pasarse tampoco vale: la suma se compara, no se acota", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).actualizarPagosGestion(
      {
        gestionId: GESTION,
        lineas: [
          { metodo: "efectivo", monto: "6000" },
          { metodo: "SINPE", monto: "5000" },
        ],
      },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    expect(repo.actualizarPagosGestion).not.toHaveBeenCalled();
  });

  it("la suma se hace en Decimal: tres décimos que en coma flotante no darían", async () => {
    // 0.1 + 0.2 !== 0.3 en coma flotante. Con `Prisma.Decimal` sí, y esta corrección pasa.
    const repo = fakeRepo({
      findGestionEditableEnCierre: vi.fn(async () =>
        editable({ montoRecibido: "0.30", pagos: [{ metodo: "efectivo", monto: "0.30" }] }),
      ),
    });
    const r = await newService(repo).actualizarPagosGestion(
      {
        gestionId: GESTION,
        lineas: [
          { metodo: "efectivo", monto: "0.10" },
          { metodo: "SINPE", monto: "0.20" },
        ],
      },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
  });

  it("el conflicto del repositorio (carrera) se propaga como conflict", async () => {
    const repo = fakeRepo({
      actualizarPagosGestion: vi.fn(async () => ({ status: "conflict" as const })),
    });
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      MAESTRO,
    );
    expect(r.status).toBe("conflict");
  });

  it("devuelve los totales YA recalculados por el servidor, no los que tenía la pantalla", async () => {
    const repo = fakeRepo();
    const r = await newService(repo).actualizarPagosGestion(
      { gestionId: GESTION, lineas: LINEAS_OK },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.totales.simpe).toBe("10000.00");
      expect(r.totales.general).toBe("10000.00");
    }
  });
});
