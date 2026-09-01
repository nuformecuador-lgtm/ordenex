import { describe, it, expect, vi } from "vitest";

import {
  verDetalleDeMovimientoAction,
  verDetalleDeMovimientoCompletoAction,
} from "@/lib/actions/wallet";
import {
  verDetalleDeMiMovimientoAction,
  verDetalleDeMiMovimientoCompletoAction,
} from "@/lib/actions/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IDetalleMovimientoService } from "@/lib/interfaces/services/IDetalleMovimientoService";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";

/**
 * Ficha 344 (T4.4) — el BORDE de las cuatro Server Actions del detalle. Cubre **R29 y R42**.
 *
 * Lo que se mide aqui es la frontera y nada mas: sin sesion no se llega al servicio, una entrada
 * invalida se rechaza SIN devolver ordenes, y el cliente no puede declarar de que tienda habla.
 * El alcance por rol lo decide el dominio (`wallet-tienda-detalle-movimiento.test.ts`) y el
 * `WHERE` se mide contra Postgres.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "t-A", rol: "adminTienda" };

const MOVIMIENTO = "11111111-2222-4333-8444-555555555555";

const ORDEN: OrdenAporteDTO = {
  ordenId: "o-1",
  guia: "501",
  destinatario: "Ana",
  tiendaNombre: "Tienda A",
  resultados: ["entregada"],
  aporte: "1000.00",
};

function fakeService(overrides: Partial<IDetalleMovimientoService> = {}): IDetalleMovimientoService {
  const ok = async () => ({
    status: "ok" as const,
    data: {
      monto: "28800.00",
      cierre: { fecha: "2026-08-20T18:30:00.000Z", mensajeroNombre: null },
      ordenesDelCierre: 23,
      total: 14,
      page: 1,
      pageSize: 25,
      ordenes: [ORDEN],
    },
  });
  const okCompleto = async () => ({ status: "ok" as const, items: [ORDEN], total: 14 });
  return {
    verDetalleDeMovimiento: vi.fn(ok),
    verDetalleDeMovimientoCompleto: vi.fn(okCompleto),
    verDetalleDeMiMovimiento: vi.fn(ok),
    verDetalleDeMiMovimientoCompleto: vi.fn(okCompleto),
    ...overrides,
  } as IDetalleMovimientoService;
}

/** Las CUATRO acciones, con el actor que les corresponde. Se prueban todas, no una de muestra. */
const ACCIONES = [
  {
    nombre: "verDetalleDeMovimientoAction",
    llamar: verDetalleDeMovimientoAction,
    actor: MAESTRO,
    metodo: "verDetalleDeMovimiento" as const,
    pagina: true,
  },
  {
    nombre: "verDetalleDeMovimientoCompletoAction",
    llamar: verDetalleDeMovimientoCompletoAction,
    actor: MAESTRO,
    metodo: "verDetalleDeMovimientoCompleto" as const,
    pagina: false,
  },
  {
    nombre: "verDetalleDeMiMovimientoAction",
    llamar: verDetalleDeMiMovimientoAction,
    actor: TIENDA,
    metodo: "verDetalleDeMiMovimiento" as const,
    pagina: true,
  },
  {
    nombre: "verDetalleDeMiMovimientoCompletoAction",
    llamar: verDetalleDeMiMovimientoCompletoAction,
    actor: TIENDA,
    metodo: "verDetalleDeMiMovimientoCompleto" as const,
    pagina: false,
  },
];

describe("ficha 344 — el borde del detalle de un movimiento (R29/R42)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    for (const accion of ACCIONES) {
      const service = fakeService();
      const r = await accion.llamar(
        { movimientoId: MOVIMIENTO },
        { service, getActor: async () => null },
      );
      expect(r, accion.nombre).toEqual({ status: "unauthenticated" });
      expect(service[accion.metodo], accion.nombre).not.toHaveBeenCalled();
    }
  });

  it("una clave de tienda colada muere en el borde", async () => {
    // R42: el `.strict()` mata cualquier clave desconocida — y `tiendaId` es la unica que
    // convertiria el detalle de una tienda en el de otra. Muere SIN tocar la base.
    for (const accion of ACCIONES) {
      const service = fakeService();
      const r = await accion.llamar(
        { movimientoId: MOVIMIENTO, tiendaId: "t-B" },
        { service, getActor: async () => accion.actor },
      );
      expect(r.status, accion.nombre).toBe("validation_error");
      expect(service[accion.metodo], accion.nombre).not.toHaveBeenCalled();
      expect(r, accion.nombre).not.toHaveProperty("data");
      expect(r, accion.nombre).not.toHaveProperty("items");
    }
  });

  it("tampoco se admite declarar el cierre ni el concepto desde el cliente", async () => {
    for (const clave of ["cierreId", "categoria", "conceptos", "fila"]) {
      const service = fakeService();
      const r = await verDetalleDeMovimientoAction(
        { movimientoId: MOVIMIENTO, [clave]: "lo-que-sea" },
        { service, getActor: async () => MAESTRO },
      );
      expect(r.status, clave).toBe("validation_error");
      expect(service.verDetalleDeMovimiento, clave).not.toHaveBeenCalled();
    }
  });

  it("R29: un pageSize sobre el tope es validation_error y no devuelve ordenes", async () => {
    const service = fakeService();
    const r = await verDetalleDeMovimientoAction(
      { movimientoId: MOVIMIENTO, pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE + 1 },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(r.fieldErrors.pageSize?.length ?? 0).toBeGreaterThan(0);
    expect(r).not.toHaveProperty("data");
    // El rechazo es del BORDE: el servicio no llego a consultar nada.
    expect(service.verDetalleDeMovimiento).not.toHaveBeenCalled();

    // Control de no-vacuidad: JUSTO en el tope, la misma entrada pasa.
    const enElTope = await verDetalleDeMovimientoAction(
      { movimientoId: MOVIMIENTO, pageSize: detalleMovimientoConfig.MAX_PAGE_SIZE },
      { service, getActor: async () => MAESTRO },
    );
    expect(enElTope.status).toBe("ok");
  });

  it("el id tiene que ser un uuid, y `page`/`pageSize` enteros positivos", async () => {
    const service = fakeService();
    for (const entrada of [
      { movimientoId: "no-es-uuid" },
      { movimientoId: "" },
      { movimientoId: MOVIMIENTO, page: 0 },
      { movimientoId: MOVIMIENTO, page: -3 },
      { movimientoId: MOVIMIENTO, pageSize: 0 },
      { movimientoId: MOVIMIENTO, pageSize: 2.5 },
    ]) {
      const r = await verDetalleDeMovimientoAction(entrada, {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, JSON.stringify(entrada)).toBe("validation_error");
    }
    expect(service.verDetalleDeMovimiento).not.toHaveBeenCalled();
  });

  it("el modo completo NO admite `page` ni `pageSize`: ese modo no pagina", async () => {
    for (const accion of ACCIONES.filter((a) => !a.pagina)) {
      const service = fakeService();
      const r = await accion.llamar(
        { movimientoId: MOVIMIENTO, page: 2 },
        { service, getActor: async () => accion.actor },
      );
      expect(r.status, accion.nombre).toBe("validation_error");
      expect(service[accion.metodo], accion.nombre).not.toHaveBeenCalled();
    }
  });

  it("ausentes, `page` y `pageSize` caen en la configuracion y llegan coercionados", async () => {
    const service = fakeService();
    await verDetalleDeMovimientoAction(
      { movimientoId: MOVIMIENTO },
      { service, getActor: async () => MAESTRO },
    );
    const primera = (service.verDetalleDeMovimiento as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(primera.page).toBe(1);
    expect(primera.pageSize).toBe(detalleMovimientoConfig.DEFAULT_PAGE_SIZE);

    // Y desde el cliente pueden llegar como TEXTO (query string): se coercionan a numero.
    await verDetalleDeMovimientoAction(
      { movimientoId: MOVIMIENTO, page: "3", pageSize: "5" },
      { service, getActor: async () => MAESTRO },
    );
    const segunda = (service.verDetalleDeMovimiento as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(segunda.page).toBe(3);
    expect(segunda.pageSize).toBe(5);
    // Y el actor que llega al servicio es el de la sesion, no uno de la entrada.
    expect((service.verDetalleDeMovimiento as ReturnType<typeof vi.fn>).mock.calls[1][1]).toEqual(
      MAESTRO,
    );
  });

  it("las tres ramas de dominio cruzan el borde tal cual, sin ordenes", async () => {
    for (const rama of [
      { status: "forbidden" as const },
      { status: "not_found" as const },
      { status: "sin_reparto" as const, motivo: "snapshot_del_cierre" as const },
    ]) {
      const service = fakeService({ verDetalleDeMovimiento: vi.fn(async () => rama) });
      const r = await verDetalleDeMovimientoAction(
        { movimientoId: MOVIMIENTO },
        { service, getActor: async () => MAESTRO },
      );
      expect(r).toEqual(rama);
      expect(r).not.toHaveProperty("data");
    }
  });

  it("los importes cruzan la frontera como TEXTO, tambien en la descarga", async () => {
    const service = fakeService();
    const pagina = await verDetalleDeMovimientoAction(
      { movimientoId: MOVIMIENTO },
      { service, getActor: async () => MAESTRO },
    );
    if (pagina.status !== "ok") throw new Error("esperado ok");
    expect(typeof pagina.data.monto).toBe("string");
    expect(typeof pagina.data.ordenes[0].aporte).toBe("string");
    // `total` y `ordenesDelCierre` SI son numeros: son CONTEOS, no dinero.
    expect(typeof pagina.data.total).toBe("number");
    expect(typeof pagina.data.ordenesDelCierre).toBe("number");

    const completo = await verDetalleDeMovimientoCompletoAction(
      { movimientoId: MOVIMIENTO },
      { service, getActor: async () => MAESTRO },
    );
    if (completo.status !== "ok") throw new Error("esperado ok");
    expect(typeof completo.items[0].aporte).toBe("string");
    expect(completo.items[0].aporte).toMatch(/^\d+\.\d{2}$/);
  });
});
