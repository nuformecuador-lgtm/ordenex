import { describe, it, expect, vi } from "vitest";

import {
  verEstadoCuentaCompletoAction,
  verMiEstadoCuentaAction,
  verMiEstadoCuentaCompletoAction,
  verOrdenesDeFilaAction,
} from "@/lib/actions/estado-cuenta";
import type { IDetalleMovimientoService } from "@/lib/interfaces/services/IDetalleMovimientoService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 458-D (servidor) — el ORDEN del borde de las actions nuevas: sesion → zod `.strict()` →
// servicio. Una clave de mas (o que nombre una cuenta desde la tienda) muere en el borde SIN llamar al
// servicio; sin sesion, ni siquiera se mira la entrada. Lo que decide el dominio (rol, cuenta ajena) se
// mide contra Postgres en `tests/integration/db/estado-cuenta-servidor-458d.test.ts`.

const TIENDA: Actor = { usuarioId: "00000000-0000-4000-8000-00000000000a", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "00000000-0000-4000-8000-00000000000b", rol: "maestro" };
const UUID = "00000000-0000-4000-8000-0000000000cc";

function servicioEspia() {
  const service = {
    leer: vi.fn(),
    leerCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
    leerMiTienda: vi.fn(async () => ({ status: "forbidden" as const })),
    leerMiTiendaCompleto: vi.fn(async () => ({ status: "forbidden" as const })),
  } satisfies IEstadoCuentaService;
  return service;
}

function detalleEspia() {
  return {
    verDetalleDeMovimiento: vi.fn(),
    verDetalleDeMovimientoCompleto: vi.fn(),
    verDetalleDeMiMovimiento: vi.fn(),
    verDetalleDeMiMovimientoCompleto: vi.fn(),
    verDetalleDeFilaDeCuenta: vi.fn(async () => ({ status: "not_found" as const })),
  } satisfies IDetalleMovimientoService;
}

describe("458-D servidor — el borde de /mi-wallet (R36)", () => {
  it("una clave que nombre una cuenta es validation_error y el servicio NO se llama", async () => {
    for (const input of [{ cuenta: { tipo: "tienda", id: UUID } }, { tiendaId: UUID }, { page: 1, extra: true }]) {
      const service = servicioEspia();
      const r = await verMiEstadoCuentaAction(input, { service, getActor: async () => TIENDA });
      expect(r.status).toBe("validation_error");
      expect(service.leerMiTienda).not.toHaveBeenCalled();
    }
  });

  it("sin sesion: unauthenticated antes de mirar la entrada", async () => {
    const service = servicioEspia();
    expect(await verMiEstadoCuentaAction({ tiendaId: UUID }, { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(service.leerMiTienda).not.toHaveBeenCalled();
  });

  it("la entrada valida llega al servicio SIN cuenta: la cuenta la pone el servidor con la sesion", async () => {
    const service = servicioEspia();
    await verMiEstadoCuentaAction({ chip: "cobros", cierreId: UUID }, { service, getActor: async () => TIENDA });
    expect(service.leerMiTienda).toHaveBeenCalledWith(
      { chip: "cobros", cierreId: UUID, page: 1, pageSize: expect.any(Number) },
      TIENDA,
    );
  });

  it("el completo de /mi-wallet no pagina ni nombra una cuenta", async () => {
    for (const input of [{ page: 1 }, { cuenta: { tipo: "tienda", id: UUID } }]) {
      const service = servicioEspia();
      expect((await verMiEstadoCuentaCompletoAction(input, { service, getActor: async () => TIENDA })).status).toBe(
        "validation_error",
      );
      expect(service.leerMiTiendaCompleto).not.toHaveBeenCalled();
    }
  });
});

describe("458-D servidor — el completo de la oficina (R32)", () => {
  it("rechaza page/pageSize y un cierre sin forma de id sin llamar al servicio", async () => {
    for (const input of [
      { cuenta: { tipo: "tienda", id: UUID }, pageSize: 10 },
      { cuenta: { tipo: "tienda", id: UUID }, cierreId: "1 OR 1=1" },
    ]) {
      const service = servicioEspia();
      expect((await verEstadoCuentaCompletoAction(input, { service, getActor: async () => MAESTRO })).status).toBe(
        "validation_error",
      );
      expect(service.leerCompleto).not.toHaveBeenCalled();
    }
  });
});

describe("458-D servidor — las ordenes de una fila (R19)", () => {
  it("bodega, id sin forma o clave de mas → validation_error sin llamar al servicio", async () => {
    for (const input of [
      { cuenta: { tipo: "bodega", id: UUID }, movimientoId: UUID },
      { cuenta: { tipo: "tienda", id: UUID }, movimientoId: "abc" },
      { cuenta: { tipo: "tienda", id: UUID }, movimientoId: UUID, tiendaId: UUID },
    ]) {
      const service = detalleEspia();
      expect((await verOrdenesDeFilaAction(input, { service, getActor: async () => MAESTRO })).status).toBe(
        "validation_error",
      );
      expect(service.verDetalleDeFilaDeCuenta).not.toHaveBeenCalled();
    }
  });

  it("sin sesion: unauthenticated; con sesion, la entrada valida llega tal cual al servicio", async () => {
    const service = detalleEspia();
    const input = { cuenta: { tipo: "mensajero", id: UUID }, movimientoId: UUID };
    expect(await verOrdenesDeFilaAction(input, { service, getActor: async () => null })).toEqual({
      status: "unauthenticated",
    });
    expect(service.verDetalleDeFilaDeCuenta).not.toHaveBeenCalled();
    expect(await verOrdenesDeFilaAction(input, { service, getActor: async () => MAESTRO })).toEqual({
      status: "not_found",
    });
    expect(service.verDetalleDeFilaDeCuenta).toHaveBeenCalledWith(
      { ...input, page: 1, pageSize: expect.any(Number) },
      MAESTRO,
    );
  });
});
