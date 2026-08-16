import { describe, it, expect, vi } from "vitest";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import type {
  GestionOrdenData,
  IGestionOrdenRepository,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { LineaPago } from "@/lib/utils/pagos-recaudo";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 212 (T7 · R18/R19) — el SERVICE es la SEGUNDA barrera del desglose, independiente del
// borde zod y con aritmetica `Prisma.Decimal`. Dobles del repo/storage (nada de DB): lo que se
// afirma es el `GestionOrdenData` EMITIDO hacia `crearGestionYTransicionar`, y que una suma que
// no cuadra NO llega a persistirse.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  en_reparto: "os-reparto",
  entregada: "os-entregada",
};

function gestionRow(overrides: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "en_reparto",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 8000,
    zonaId: null,
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    ...overrides,
  };
}

function newService(repo: IGestionOrdenRepository) {
  const ordenRepo: Pick<IOrdenRepository, "findEstatusIdByValue" | "findMensajerosBloqueados"> = {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    findMensajerosBloqueados: vi.fn(async (): Promise<Set<string>> => new Set()),
  };
  const storage: IFileStorage = {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
  const signed: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
  const rutaRepo: Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> = {
    findByMensajero: vi.fn(async () => null),
    upsertOrigen: vi.fn(async () => {}),
  };
  const metaRepo = {
    findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
  };
  const service = new MisAsignacionesService(
    repo,
    ordenRepo,
    storage,
    signed,
    rutaRepo,
    metaRepo,
    fakeIntentosEnLote(),
  );
  return { service, storage };
}

function gestionEmitida(repo: IGestionOrdenRepository): GestionOrdenData {
  const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return call.gestion as GestionOrdenData;
}

function entrega(montoRecibido: number, pagos: LineaPago[]): GestionarInput {
  return {
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido,
    // Ya normalizado por el borde: el escalar solo sobrevive para la columna deprecada.
    metodoPago: null,
    pagos,
    evidencias: [{ contentType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }],
  };
}

describe("R18: revalidacion de la suma en `Prisma.Decimal` (segunda barrera)", () => {
  it("la suma NO iguala montoRecibido -> validation_error en `pagos`, sin subir ni persistir", async () => {
    const repo = fakeRepo();
    const { service, storage } = newService(repo);

    const r = await service.gestionar(
      entrega(8000, [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "transferencia", monto: 2000 },
      ]),
      MENSAJERO,
    );

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toEqual(["pagos"]);
    // La guarda esta ANTES de la subida y de la tx: sin efectos parciales.
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("un desglose INFLADO (suma de mas) tampoco pasa", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(
      entrega(8000, [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "SINPE", monto: 3000.01 },
      ]),
      MENSAJERO,
    );

    expect(r.status).toBe("validation_error");
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R30: una suma con decimales que en float NO cuadraria SI cuadra en Decimal", async () => {
    // 0.1 + 0.2 !== 0.3 en coma flotante; en Decimal es exacto. Si el service sumara con `+`,
    // este caso seria un rechazo espurio en produccion.
    const repo = fakeRepo({ findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 0.3 })]) });
    const { service } = newService(repo);

    const r = await service.gestionar(
      entrega(0.3, [
        { metodo: "efectivo", monto: 0.1 },
        { metodo: "SINPE", monto: 0.2 },
      ]),
      MENSAJERO,
    );

    expect(r.status).toBe("ok");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("R14: entrega SIN cobro (0 lineas, monto 0) cuadra y persiste sin lineas", async () => {
    const repo = fakeRepo({ findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: null })]) });
    const { service } = newService(repo);

    const r = await service.gestionar(entrega(0, []), MENSAJERO);

    expect(r.status).toBe("ok");
    expect(gestionEmitida(repo).pagos).toEqual([]);
  });
});

describe("R19: la columna DEPRECADA `metodo_pago` se deriva del desglose", () => {
  it("UNA linea -> `metodoPago` es esa (una entrega legacy escribe lo mismo que antes)", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(
      entrega(8000, [{ metodo: "transferencia", monto: 8000 }]),
      MENSAJERO,
    );

    expect(r.status).toBe("ok");
    const gestion = gestionEmitida(repo);
    expect(gestion.metodoPago).toBe("transferencia");
    expect(gestion.montoRecibido).toBe(8000);
  });

  it("DOS lineas -> `metodoPago` NULL (no existe «el» metodo de una entrega mixta)", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(
      entrega(8000, [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "transferencia", monto: 3000 },
      ]),
      MENSAJERO,
    );

    expect(r.status).toBe("ok");
    expect(gestionEmitida(repo).metodoPago).toBeNull();
  });

  it("CERO lineas (sin cobro) -> `metodoPago` NULL, no `efectivo`", async () => {
    const repo = fakeRepo({ findByIdsParaGestion: vi.fn(async () => [gestionRow({ montoCobrar: 0 })]) });
    const { service } = newService(repo);

    await service.gestionar(entrega(0, []), MENSAJERO);

    expect(gestionEmitida(repo).metodoPago).toBeNull();
  });

  it("ignora el escalar que mando el cliente y usa el desglose como fuente", async () => {
    // Escalar `efectivo` + desglose de UNA transferencia: el borde nunca deja pasar las dos
    // formas juntas (R13), pero si algo se colara, la columna deprecada debe seguir al DINERO.
    const repo = fakeRepo();
    const { service } = newService(repo);

    const input: GestionarInput = {
      ordenId: "o1",
      resultado: "entregada",
      montoRecibido: 8000,
      metodoPago: "efectivo",
      pagos: [{ metodo: "transferencia", monto: 8000 }],
      evidencias: [{ contentType: "image/jpeg", bytes: new Uint8Array([1]) }],
    };
    await service.gestionar(input, MENSAJERO);

    expect(gestionEmitida(repo).metodoPago).toBe("transferencia");
  });
});

describe("R17: el desglose viaja DENTRO de `GestionOrdenData` (misma tx, sin firma nueva)", () => {
  it("las lineas llegan al repo en el mismo objeto que la gestion y el estado destino", async () => {
    const repo = fakeRepo();
    const { service } = newService(repo);

    await service.gestionar(
      entrega(8000, [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "transferencia", monto: 3000 },
      ]),
      MENSAJERO,
    );

    const call = (repo.crearGestionYTransicionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.nuevoEstatusId).toBe("os-entregada");
    expect(call.gestion.pagos).toEqual([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "transferencia", monto: 3000 },
    ]);
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("la comprobacion previa monto == montoCobrar (R22 de la 36) sigue mandando", async () => {
    // El desglose cuadra consigo mismo pero el total no cuadra con el COD de la orden: se
    // rechaza por el campo de siempre, no por `pagos`.
    const repo = fakeRepo();
    const { service } = newService(repo);

    const r = await service.gestionar(
      entrega(5000, [{ metodo: "efectivo", monto: 5000 }]),
      MENSAJERO,
    );

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["montoRecibido"]);
    }
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });
});
