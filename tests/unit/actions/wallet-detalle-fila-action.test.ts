import { describe, it, expect, vi } from "vitest";

import { listarMovimientosDeFilaAction } from "@/lib/actions/wallet";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { composicionDetalleConfig } from "@/lib/config/composicion-detalle";

/**
 * Ficha 339 (T3.4, design §4.5) — el BORDE del detalle de una fila. Cubre **R32 y R34**.
 *
 * Lo que se mide aqui es la frontera y nada mas: quien no tiene sesion no llega al servicio,
 * una entrada invalida se rechaza SIN devolver filas, y los importes cruzan como TEXTO. El
 * alcance por rol lo decide el dominio (`wallet-service.test.ts`) y el `WHERE` se mide contra
 * Postgres (`tests/integration/db/composicion-detalle-postgres.test.ts`).
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTRO: Actor = { usuarioId: "u-otro", rol: "adminSatelite" };

function mov(overrides: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: "w-1",
    tipo: "egreso",
    categoria: "egreso_pago_mensajero",
    monto: "227300.00",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    descripcion: null, // los pagos a mensajeros llegan SIN descripcion (medido en produccion)
    registradoPor: null,
    fechaMovimiento: "2026-08-25T06:00:00.000Z",
    dueno: "propio",
    ...overrides,
  };
}

function fakeService(overrides: Partial<IWalletService> = {}): IWalletService {
  return {
    listarMovimientos: vi.fn(),
    listarMovimientosCompleto: vi.fn(),
    verResumenCaja: vi.fn(),
    registrarMovimientoManual: vi.fn(),
    listarMovimientosDeFila: vi.fn(async () => ({
      status: "ok" as const,
      data: { movimientos: [mov()], total: 9, page: 1, pageSize: 10 },
    })),
    ...overrides,
  } as IWalletService;
}

describe("listarMovimientosDeFilaAction — el borde (R32/R34)", () => {
  it("sin sesion -> unauthenticated, sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarMovimientosDeFilaAction(
      { fila: "egreso_pago_mensajero" },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarMovimientosDeFila).not.toHaveBeenCalled();
  });

  it("rol no autorizado -> forbidden, y esa rama NO viaja con movimientos", async () => {
    const service = fakeService({
      listarMovimientosDeFila: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await listarMovimientosDeFilaAction(
      { fila: "egreso_pago_mensajero" },
      { service, getActor: async () => OTRO },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(Object.keys(r)).toEqual(["status"]);
  });

  it("R32: un `pageSize` por encima del tope es `validation_error` y NO devuelve filas", async () => {
    const service = fakeService();
    const r = await listarMovimientosDeFilaAction(
      {
        fila: "egreso_pago_mensajero",
        pageSize: composicionDetalleConfig.MAX_PAGE_SIZE + 1,
      },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("esperado validation_error");
    expect(r.fieldErrors.pageSize?.length ?? 0).toBeGreaterThan(0);
    expect(r).not.toHaveProperty("data");
    // Y sobre todo: el servicio NO llego a consultar nada. Un rechazo que hubiera leido el
    // libro para tirarlo no seria un rechazo del borde.
    expect(service.listarMovimientosDeFila).not.toHaveBeenCalled();

    // Control de no-vacuidad: JUSTO en el tope, la misma entrada pasa.
    const enElTope = await listarMovimientosDeFilaAction(
      { fila: "egreso_pago_mensajero", pageSize: composicionDetalleConfig.MAX_PAGE_SIZE },
      { service, getActor: async () => MAESTRO },
    );
    expect(enElTope.status).toBe("ok");
  });

  it("R32: una `fila` que no esta en el catalogo es `validation_error`, no una consulta vacia", async () => {
    const service = fakeService();

    for (const fila of ["egreso_pago_tienda", "otros", "", "otros_egresos_x"]) {
      const r = await listarMovimientosDeFilaAction(
        { fila },
        { service, getActor: async () => MAESTRO },
      );
      expect(r.status, `fila=${fila}`).toBe("validation_error");
    }
    // `egreso_pago_tienda` es una categoria REAL del enum y aun asi se rechaza: no es una fila
    // de esta tarjeta (es dinero de terceros). El catalogo de filas no es el de categorias.
    expect(service.listarMovimientosDeFila).not.toHaveBeenCalled();

    // Control de no-vacuidad: el token del complemento SI es una fila valida.
    const r = await listarMovimientosDeFilaAction(
      { fila: "otros_egresos" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
  });

  it("R32: `page`/`pageSize` fuera de rango se rechazan; ausentes, caen en la config", async () => {
    const service = fakeService();
    for (const entrada of [
      { fila: "egreso_ajuste", page: 0 },
      { fila: "egreso_ajuste", page: -1 },
      { fila: "egreso_ajuste", pageSize: 0 },
      { fila: "egreso_ajuste", pageSize: 2.5 },
    ]) {
      const r = await listarMovimientosDeFilaAction(entrada, {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, JSON.stringify(entrada)).toBe("validation_error");
    }

    await listarMovimientosDeFilaAction(
      { fila: "egreso_ajuste" },
      { service, getActor: async () => MAESTRO },
    );
    const entrada = (service.listarMovimientosDeFila as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entrada.page).toBe(1);
    expect(entrada.pageSize).toBe(composicionDetalleConfig.DEFAULT_PAGE_SIZE);
  });

  it("R20: los filtros vigentes de la wallet cruzan tal cual hasta el servicio", async () => {
    const service = fakeService();
    await listarMovimientosDeFilaAction(
      {
        fila: "otros_egresos",
        page: "2",
        pageSize: "5",
        tipo: "egreso",
        categoria: "egreso_gasto",
        desde: "2026-08-01",
        hasta: "2026-08-31",
      },
      { service, getActor: async () => MAESTRO },
    );

    const entrada = (service.listarMovimientosDeFila as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entrada.fila).toBe("otros_egresos");
    // `page`/`pageSize` llegan COERCIONADOS a numero (vienen de la URL/el cliente como texto).
    expect(entrada.page).toBe(2);
    expect(entrada.pageSize).toBe(5);
    expect(entrada.tipo).toBe("egreso");
    expect(entrada.categoria).toBe("egreso_gasto");
    expect(entrada.desde).toEqual(new Date("2026-08-01"));
    expect(entrada.hasta).toEqual(new Date("2026-08-31"));
  });

  it("R34: todo importe cruza la frontera como TEXTO, nunca como numero", async () => {
    const service = fakeService({
      listarMovimientosDeFila: vi.fn(async () => ({
        status: "ok" as const,
        data: {
          movimientos: [
            mov({ id: "w-1", monto: "227300.00" }),
            mov({ id: "w-2", monto: "0.01", categoria: "egreso_ajuste", descripcion: "ajuste" }),
          ],
          total: 9,
          page: 1,
          pageSize: 10,
        },
      })),
    });

    const r = await listarMovimientosDeFilaAction(
      { fila: "egreso_pago_mensajero" },
      { service, getActor: async () => MAESTRO },
    );
    if (r.status !== "ok") throw new Error("esperado ok");

    expect(r.data.movimientos).toHaveLength(2);
    for (const m of r.data.movimientos) {
      expect(typeof m.monto).toBe("string");
      expect(m.monto).toMatch(/^-?\d+\.\d{2}$/); // escala 2 SIEMPRE, tambien en el centimo
    }
    // El importe grande sobrevive intacto: 227 300,00 no pasa por ningun `number`.
    expect(r.data.movimientos[0].monto).toBe("227300.00");
    // `total` SI es un numero — es un CONTEO, no dinero — y lo da el servidor, no la pagina.
    expect(typeof r.data.total).toBe("number");
    expect(r.data.total).toBe(9);
    expect(r.data.total).not.toBe(r.data.movimientos.length);
  });
});
