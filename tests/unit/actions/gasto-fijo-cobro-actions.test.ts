import { describe, it, expect, vi } from "vitest";
import {
  aprobarCobroGastoFijoAction,
  contarCobrosPendientesDePlantillaAction,
  listarCobrosPendientesAction,
  rechazarCobroGastoFijoAction,
} from "@/lib/actions/gasto-fijo-cobro";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGastoFijoCobroService } from "@/lib/interfaces/services/IGastoFijoCobroService";

// FICHA 333 (F2) — el BORDE de los cobros de gasto fijo.
//
// Cubre R26 (sin sesion, las acciones responden `unauthenticated` SIN tocar el servicio) y la
// traduccion de `validation_error` en las cuatro. El resto —`ok`, `forbidden`, `not_found`,
// `ya_decidido`— lo decide el SERVICIO y este archivo solo comprueba que viaja intacto.
//
// ⚠️ EL ORDEN IMPORTA Y ES LO QUE SE MIDE: primero la sesion, DESPUES el `parse`. Un borde que
// validara antes contestaria `validation_error` a un anonimo con el payload mal escrito, y eso es
// informacion sobre la forma de la API que un anonimo no tiene por que recibir.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin", zonaId: null };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite", zonaId: null };

const UUID = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-08-29T18:00:00.000Z");

function fakeService(overrides: Partial<IGastoFijoCobroService> = {}): IGastoFijoCobroService {
  return {
    listarPendientes: vi.fn(async () => ({ status: "ok" as const, items: [], total: 0 })),
    aprobar: vi.fn(async () => ({ status: "ok" as const, yaEstabaEnElLibro: false })),
    rechazar: vi.fn(async () => ({ status: "ok" as const })),
    cancelarPorPlantilla: vi.fn(async () => 0),
    contarPendientesDePlantilla: vi.fn(async () => ({ status: "ok" as const, pendientes: 0 })),
    ...overrides,
  };
}

const SIN_SESION = async () => null;

describe("333/R26 — sin sesion, las cuatro acciones responden `unauthenticated` sin tocar el servicio", () => {
  it("listarCobrosPendientesAction", async () => {
    const service = fakeService();
    const r = await listarCobrosPendientesAction({}, { service, getActor: SIN_SESION });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarPendientes).not.toHaveBeenCalled();
  });

  it("aprobarCobroGastoFijoAction", async () => {
    const service = fakeService();
    const r = await aprobarCobroGastoFijoAction({ id: UUID }, { service, getActor: SIN_SESION });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("rechazarCobroGastoFijoAction", async () => {
    const service = fakeService();
    const r = await rechazarCobroGastoFijoAction({ id: UUID }, { service, getActor: SIN_SESION });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it("contarCobrosPendientesDePlantillaAction", async () => {
    const service = fakeService();
    const r = await contarCobrosPendientesDePlantillaAction(
      { plantillaId: UUID },
      { service, getActor: SIN_SESION },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.contarPendientesDePlantilla).not.toHaveBeenCalled();
  });

  it("⭑ la sesion se comprueba ANTES del `parse`: un anonimo con payload invalido sigue leyendo `unauthenticated`", async () => {
    const service = fakeService();
    const r = await aprobarCobroGastoFijoAction(
      { id: "no-es-un-uuid", monto: "1.00" },
      { service, getActor: SIN_SESION },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.aprobar).not.toHaveBeenCalled();
  });
});

describe("333/F2 — `validation_error` en el borde, con los campos nombrados", () => {
  it("aprobar: un `id` que no es uuid muere aqui, sin llegar al servicio", async () => {
    const service = fakeService();
    const r = await aprobarCobroGastoFijoAction(
      { id: "p-1" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(Object.keys(r.fieldErrors)).toContain("id");
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("⭑ aprobar: un `monto` colado en el payload muere en el borde — el cliente NO pone importes (R16)", async () => {
    // `.strict()` no es adorno: sin el, esta clave se ignoraria EN SILENCIO y quien la mandara
    // creeria haber pedido algo que nadie iba a leer. En una operacion de dinero, eso es peor que
    // un error.
    const service = fakeService();
    const r = await aprobarCobroGastoFijoAction(
      { id: UUID, monto: "999999.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.aprobar).not.toHaveBeenCalled();
  });

  it("⭑ rechazar: idem — tampoco acepta monto", async () => {
    const service = fakeService();
    const r = await rechazarCobroGastoFijoAction(
      { id: UUID, monto: "1.00" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.rechazar).not.toHaveBeenCalled();
  });

  it("⭑ listar: la lista blanca tiene CERO claves — `page`, `pageSize` o un `estado` mueren aqui", async () => {
    const service = fakeService();
    for (const payload of [{ page: 2 }, { pageSize: 500 }, { estado: "aprobado" }]) {
      const r = await listarCobrosPendientesAction(payload, {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, JSON.stringify(payload)).toBe("validation_error");
    }
    expect(service.listarPendientes).not.toHaveBeenCalled();
  });

  it("contar: un `plantillaId` que no es uuid muere en el borde", async () => {
    const service = fakeService();
    const r = await contarCobrosPendientesDePlantillaAction(
      { plantillaId: "p-1" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    expect(service.contarPendientesDePlantilla).not.toHaveBeenCalled();
  });
});

describe("333/F1 — con sesion, el borde transporta y no decide", () => {
  it("listar: `{}` es valido y el servicio recibe el actor", async () => {
    const service = fakeService({
      listarPendientes: vi.fn(async () => ({
        status: "ok" as const,
        items: [
          {
            id: "c-1",
            concepto: "Alquiler",
            monto: "80000.00",
            periodo: "2026-08",
            generadoEl: "2026-08-29",
            estado: "pendiente" as const,
          },
        ],
        total: 3,
      })),
    });

    const r = await listarCobrosPendientesAction({}, { service, getActor: async () => ADMIN });

    expect(r).toEqual({
      status: "ok",
      items: [
        {
          id: "c-1",
          concepto: "Alquiler",
          monto: "80000.00",
          periodo: "2026-08",
          generadoEl: "2026-08-29",
          estado: "pendiente",
        },
      ],
      total: 3,
    });
    expect(service.listarPendientes).toHaveBeenCalledWith(ADMIN);
  });

  it("⭑ R43: el monto cruza la frontera como STRING, sin tocarse", async () => {
    const service = fakeService({
      listarPendientes: vi.fn(async () => ({
        status: "ok" as const,
        items: [
          {
            id: "c-1",
            concepto: "Alquiler",
            monto: "12345.67",
            periodo: "2026-08",
            generadoEl: "2026-08-29",
            estado: "pendiente" as const,
          },
        ],
        total: 1,
      })),
    });

    const r = await listarCobrosPendientesAction({}, { service, getActor: async () => MAESTRO });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.items[0].monto).toBe("12345.67");
    expect(typeof r.items[0].monto).toBe("string");
  });

  it("R24: el `forbidden` del admin lo decide el SERVICIO; el borde solo lo transporta", async () => {
    const service = fakeService({
      aprobar: vi.fn(async () => ({ status: "forbidden" as const })),
    });

    const r = await aprobarCobroGastoFijoAction(
      { id: UUID },
      { service, getActor: async () => ADMIN, now: () => AHORA },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(service.aprobar).toHaveBeenCalledWith({ id: UUID }, ADMIN, AHORA);
  });

  it("⭑ el reloj se INYECTA hasta el servicio: la decision no se fecha con un `new Date()` escondido", async () => {
    const service = fakeService();
    await rechazarCobroGastoFijoAction(
      { id: UUID },
      { service, getActor: async () => MAESTRO, now: () => AHORA },
    );
    expect(service.rechazar).toHaveBeenCalledWith({ id: UUID }, MAESTRO, AHORA);
  });

  it.each([
    ["ya_decidido"],
    ["not_found"],
  ] as const)("`%s` del servicio llega intacto al llamador", async (status) => {
    const service = fakeService({ aprobar: vi.fn(async () => ({ status })) });
    const r = await aprobarCobroGastoFijoAction(
      { id: UUID },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status });
  });

  it("`yaEstabaEnElLibro` viaja tal cual: el mensaje al usuario tiene que poder decir la verdad (R19)", async () => {
    const service = fakeService({
      aprobar: vi.fn(async () => ({ status: "ok" as const, yaEstabaEnElLibro: true })),
    });
    const r = await aprobarCobroGastoFijoAction(
      { id: UUID },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "ok", yaEstabaEnElLibro: true });
  });

  it("contar: `forbidden` de un rol sin acceso total lo decide el servicio", async () => {
    const service = fakeService({
      contarPendientesDePlantilla: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await contarCobrosPendientesDePlantillaAction(
      { plantillaId: UUID },
      { service, getActor: async () => OTRO },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(service.contarPendientesDePlantilla).toHaveBeenCalledWith({ plantillaId: UUID }, OTRO);
  });
});
