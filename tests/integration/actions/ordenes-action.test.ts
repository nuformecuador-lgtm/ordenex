import { describe, it, expect, vi } from "vitest";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";

const ACTOR: Actor = { usuarioId: "store1", rol: "adminTienda" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const noActor = async (): Promise<Actor | null> => null;

function dto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "ord-1",
    numGuia: 42,
    numRemision: "REM-1",
    estatusId: "os-bodega",
    estatusValue: "en_bodega_central",
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// El doble implementa `IOrdenService` ENTERO aunque este archivo solo ejercite `listar`:
// `crear`/`obtener`/`actualizar`/`borrar` siguen declarados en la interfaz (los usa
// `OrdenService`, probado en tests/unit/services/), asi que el literal tiene que
// satisfacerlos para type-checkear. Sus Server Actions de borde se borraron el 2026-08-07.
function fakeService(overrides: Partial<IOrdenService> = {}): IOrdenService {
  return {
    crear: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    obtener: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    listar: vi.fn().mockResolvedValue({
      status: "ok",
      items: [{ ...dto(), tiendaNombre: "Tienda Uno" }], // R25/R26: listado con nombre tienda
      page: 1,
      pageSize: 20,
      total: 1,
    }),
    actualizar: vi.fn().mockResolvedValue({ status: "ok", orden: dto() }),
    borrar: vi.fn().mockResolvedValue({ status: "ok" }),
    // Feature 151: modo sin paginacion (descarga). El doble lo satisface para cumplir
    // el contrato de IOrdenService; su comportamiento se prueba en
    // tests/unit/actions/ordenes-descarga-action.test.ts.
    listarCompleto: vi.fn().mockResolvedValue({
      status: "ok",
      items: [{ ...dto(), tiendaNombre: "Tienda Uno" }],
      total: 1,
    }),
    ...overrides,
  };
}

describe("R18: sin sesion valida -> unauthenticated sin tocar el service", () => {
  it("listarOrdenes rechaza sin sesion", async () => {
    const service = fakeService();
    const r = await listarOrdenes({}, { ordenService: service, getActor: noActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("R32: validation_error sin llamar al service", () => {
  it("listar con sortBy fuera de lista blanca (R32)", async () => {
    const service = fakeService();
    const r = await listarOrdenes({ sortBy: "peso" }, { ordenService: service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("R19-R24: autorizacion propagada desde el service", () => {
  // REAPUNTADO 2026-08-07: esta afirmacion se ejercitaba via `crearOrden`, borrada por el
  // chore de `@sin-superficie`. Lo que prueba NO es de crear, sino del borde: el resultado
  // de dominio del service viaja intacto y sin envolver. `listarOrdenes` tiene exactamente
  // el mismo `isAppErrorShape(r) ? toActionError(r) : r`, y ademas esta VIVA.
  it("forbidden se propaga tal cual (R22/R24)", async () => {
    const service = fakeService({ listar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await listarOrdenes({}, { ordenService: service, getActor });
    expect(r.status).toBe("forbidden");
  });
});

describe("R30/R31/R33/R34: listar", () => {
  it("devuelve items/page/pageSize/total y acota pageSize (R33)", async () => {
    const service = fakeService();
    const r = await listarOrdenes(
      { page: 1, pageSize: 100000, estatusId: "os-bodega", sortBy: "num_guia", sortDir: "asc" },
      { ordenService: service, getActor },
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(1);
    }
    // el schema acota pageSize antes de llamar al service (R33)
    const arg = (service.listar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.pageSize).toBeLessThanOrEqual(100);
    expect(arg.sortBy).toBe("num_guia");
  });
});

// Los dos casos que siguen estaban escritos sobre `crearOrden` y se REAPUNTARON a
// `listarOrdenes` el 2026-08-07 en vez de borrarse. Ninguno afirma nada sobre crear: los dos
// prueban la cadena de errores del BORDE (`withErrorHandler` -> `isAppErrorShape` ->
// `toActionError`), que es identica en las dos acciones vivas de este archivo. Es el unico
// sitio donde esa cadena se prueba end-to-end desde una Server Action; `normalize.test.ts` y
// `with-error-handler.test.ts` prueban las piezas por separado, no el borde entero.
describe("R11: error de dominio por nombre -> conflict via handler", () => {
  it("service que rechaza con NumRemisionDuplicadoError -> conflict (no lanza, no 500)", async () => {
    class NumRemisionDuplicadoError extends Error {
      constructor() {
        super("dup");
        this.name = "NumRemisionDuplicadoError";
      }
    }
    const service = fakeService({
      listar: vi.fn().mockRejectedValue(new NumRemisionDuplicadoError()),
    });
    const r = await listarOrdenes({}, { ordenService: service, getActor });
    expect(r.status).toBe("conflict");
  });
});

describe("INTERNAL: throw inesperado se re-lanza", () => {
  it("service con error desconocido -> la accion rechaza (preserva 500)", async () => {
    const service = fakeService({
      listar: vi.fn().mockImplementation(() => {
        throw new Error("boom");
      }),
    });
    await expect(listarOrdenes({}, { ordenService: service, getActor })).rejects.toThrow();
  });
});
