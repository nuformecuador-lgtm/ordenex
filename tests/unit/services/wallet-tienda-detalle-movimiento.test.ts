import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { OrdenAporteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { descargaConfig } from "@/lib/config/descarga";

/**
 * Ficha 344 (T4.3) — el detalle de una fila del libro de la TIENDA. Cubre **R15, R40, R41 y
 * R43**.
 *
 * Lo que este archivo NO prueba, y hay que decirlo: que el `WHERE` acote de verdad. Un doble
 * devuelve lo que se le programo, y en este repo esta medido cuatro veces que una mutacion del
 * `WHERE` pasa en verde por delante de uno. Aqui se afirma que el `tiendaId` del ACTOR llega
 * hasta las DOS lecturas; que acotar funcione se mide contra Postgres en
 * `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts`, con su mutacion.
 */

const TIENDA_A: Actor = { usuarioId: "t-A", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const CIERRE = "c-1";
const MOVIMIENTO = "11111111-2222-4333-8444-555555555555";

function movimientoDeTienda(
  over: Partial<WalletTiendaMovimientoDTO> = {},
): WalletTiendaMovimientoDTO {
  return {
    id: MOVIMIENTO,
    tiendaId: "t-A",
    tipo: "debito",
    categoria: "flete",
    monto: "9000.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    fechaMovimiento: "2026-08-20T18:30:00.000Z",
    ...over,
  };
}

function fila(over: Partial<OrdenAporteRow> = {}): OrdenAporteRow {
  return {
    ordenId: "o-1",
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Ana",
    tiendaNombre: "Tienda A",
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "14900.00",
      cobraComision: true,
      tarifa: {
        valorFlete: "1000.00",
        valorFleteGam: "1500.00",
        valorFleteDevuelto: "400.00",
        valorFleteDevueltoGam: "600.00",
        comisionCod: "3.50",
        ivaFlete: "13.00",
        ivaComisionCod: "13.00",
        tarifaEspecial: null,
        tarifaEspecialDevuelta: null,
      },
    },
    gestiones: [{ resultado: "entregada", montoRecibido: "14900.00" }],
    ...over,
  };
}

function montar(opciones: {
  mov?: WalletTiendaMovimientoDTO | null;
  filas?: OrdenAporteRow[];
  total?: number;
} = {}) {
  const obtenerPorId = vi.fn(async (_id: string) => null);
  const obtenerPorIdDeTienda = vi.fn(async (_id: string, _tiendaId: string) =>
    opciones.mov === undefined ? movimientoDeTienda() : opciones.mov,
  );
  const listarOrdenesQueAportan = vi.fn(async (_f: { tiendaId?: string; criterio: { resultados: readonly string[] }; rango: { skip: number; take: number } }) => ({
    items: opciones.filas ?? [fila()],
    total: opciones.total ?? 3,
  }));
  const contarOrdenesDelCierre = vi.fn(async (_f: { cierreId: string; tiendaId?: string }) => 8);
  const obtenerCabeceraDeCierre = vi.fn(async (_cierreId: string) => ({
    fecha: "2026-08-20T18:30:00.000Z",
    mensajeroNombre: "Kendall Hernandez",
  }));
  const service = new DetalleMovimientoService(
    { obtenerPorId },
    { obtenerPorIdDeTienda },
    { listarOrdenesQueAportan, contarOrdenesDelCierre, obtenerCabeceraDeCierre },
  );
  return {
    service,
    obtenerPorId,
    obtenerPorIdDeTienda,
    listarOrdenesQueAportan,
    contarOrdenesDelCierre,
  };
}

const PAGINA = { movimientoId: MOVIMIENTO, page: 1, pageSize: 25 };

describe("ficha 344 — el detalle de un movimiento de la tienda (R15/R40/R41/R43)", () => {
  it("el detalle de la tienda no lleva el nombre del mensajero", async () => {
    const m = montar();
    const r = await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
    if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
    // R15 (decision de la ficha 335): a la tienda no se le revela quien movio su dinero.
    expect(r.data.cierre.mensajeroNombre).toBeNull();
    // Y no se cuela por ninguna otra parte del payload.
    expect(JSON.stringify(r.data)).not.toContain("Kendall");
    // No-vacuidad: el repositorio SI devolvio un nombre; lo que lo quita es el servicio.
    expect(r.data.cierre.fecha).toBe("2026-08-20T18:30:00.000Z");
  });

  it("R40: el tiendaId del ACTOR llega a las DOS lecturas y a los dos conteos", async () => {
    const m = montar();
    await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
    // (a) la lectura del MOVIMIENTO, por id + tienda
    expect(m.obtenerPorIdDeTienda).toHaveBeenCalledWith(MOVIMIENTO, "t-A");
    // (b) la de las ORDENES del cierre, que mezcla varias tiendas
    expect(m.listarOrdenesQueAportan.mock.calls[0][0].tiendaId).toBe("t-A");
    // (c) y el «de M», que si no contaria ordenes ajenas
    expect(m.contarOrdenesDelCierre.mock.calls[0][0]).toEqual({ cierreId: CIERRE, tiendaId: "t-A" });
    // El libro de la CAJA no se toca en este camino.
    expect(m.obtenerPorId).not.toHaveBeenCalled();
  });

  it("R41: un movimiento que no esta en SU libro responde not_found, sin ordenes", async () => {
    const m = montar({ mov: null });
    const r = await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
    // Ni `ok` con filas ni `forbidden`: un `forbidden` confirmaria que el movimiento existe.
    expect(r).toEqual({ status: "not_found" });
    expect(m.listarOrdenesQueAportan).not.toHaveBeenCalled();
  });

  it("R42: el alcance sale del actor, no de la entrada — no hay clave que mandar", async () => {
    const m = montar();
    // Se llama con una entrada que trae SOLO las claves del schema. Aunque alguien construyera
    // el input a mano con un `tiendaId`, el servicio no lo lee: lee `actor.usuarioId`.
    await m.service.verDetalleDeMiMovimiento(
      { ...PAGINA, tiendaId: "t-B" } as never,
      TIENDA_A,
    );
    expect(m.obtenerPorIdDeTienda).toHaveBeenCalledWith(MOVIMIENTO, "t-A");
    expect(m.listarOrdenesQueAportan.mock.calls[0][0].tiendaId).toBe("t-A");
  });

  it("R43: usa el mismo predicado de rol que el listado de /mi-wallet", async () => {
    // No se compara contra una lista escrita a mano: se compara contra el SERVICIO que ya sirve
    // esa pantalla. Si manana el listado abriera la puerta a otro rol y el detalle no (o al
    // reves), este caso lo dice.
    const repoTienda = {
      listarPorTienda: vi.fn(async () => ({ movimientos: [], total: 0 })),
      agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "0.00", debitos: "0.00" })),
      agregarDesglosePorTienda: vi.fn(async () => []),
    } as unknown as IWalletTiendaMovimientoRepository;
    const listado = new WalletTiendaService(repoTienda);

    for (const rol of Object.values(RolValue)) {
      const actor: Actor = { usuarioId: "u-x", rol };
      const delListado = await listado.listarMisMovimientos(
        { page: 1, pageSize: 20 },
        actor,
      );
      const m = montar();
      const delDetalle = await m.service.verDetalleDeMiMovimiento(PAGINA, actor);
      expect(
        delDetalle.status === "forbidden",
        `el rol ${rol} no recibe el mismo trato en el listado (${delListado.status}) y en el detalle (${delDetalle.status})`,
      ).toBe(delListado.status === "forbidden");
    }
  });

  it("el acceso total NO entra por esta puerta: su superficie es la caja", async () => {
    const m = montar();
    expect(await m.service.verDetalleDeMiMovimiento(PAGINA, MAESTRO)).toEqual({
      status: "forbidden",
    });
    expect(m.obtenerPorIdDeTienda).not.toHaveBeenCalled();
  });

  it("el debito de la tienda se reparte con el MISMO concepto que la caja", async () => {
    const m = montar();
    const r = await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
    if (r.status !== "ok") throw new Error("esperado ok");
    // `flete` (tienda) resuelve a `ingreso_flete` (caja): mismo criterio, mismo importe.
    expect(m.listarOrdenesQueAportan.mock.calls[0][0].criterio.resultados).toEqual(["entregada"]);
    expect(r.data.ordenes[0].aporte).toBe("1000.00");
    expect(r.data.monto).toBe("9000.00");
    expect(r.data.total).toBe(3);
    expect(r.data.ordenesDelCierre).toBe(8);
  });

  it("el credito `cod_recaudado` se reparte por el recaudo de cada gestion", async () => {
    const m = montar({
      mov: movimientoDeTienda({ tipo: "credito", categoria: "cod_recaudado", monto: "30000.00" }),
      filas: [
        fila({
          gestiones: [
            { resultado: "entregada", montoRecibido: "10000.00" },
            { resultado: "devuelta", montoRecibido: null },
          ],
        }),
      ],
    });
    const r = await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.data.ordenes[0].aporte).toBe("10000.00");
    expect(r.data.ordenes[0].resultados).toEqual(["entregada", "devuelta"]);
  });

  it("R48: los conceptos del libro de tienda que no nacen de un cierre lo declaran", async () => {
    for (const categoria of ["pago_tienda", "ajuste_credito", "ajuste_debito"] as const) {
      const m = montar({ mov: movimientoDeTienda({ categoria }) });
      const r = await m.service.verDetalleDeMiMovimiento(PAGINA, TIENDA_A);
      expect(r, categoria).toEqual({ status: "sin_reparto", motivo: "no_nace_de_un_cierre" });
      expect(m.listarOrdenesQueAportan, categoria).not.toHaveBeenCalled();
    }
  });

  it("el modo completo de la tienda hereda el guard, el acotamiento y el tope", async () => {
    const forbidden = montar();
    expect(
      await forbidden.service.verDetalleDeMiMovimientoCompleto({ movimientoId: MOVIMIENTO }, MAESTRO),
    ).toEqual({ status: "forbidden" });
    expect(forbidden.obtenerPorIdDeTienda).not.toHaveBeenCalled();

    const ok = montar({ total: 3 });
    const r = await ok.service.verDetalleDeMiMovimientoCompleto(
      { movimientoId: MOVIMIENTO },
      TIENDA_A,
    );
    if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
    expect(r.total).toBe(3);
    expect(ok.listarOrdenesQueAportan.mock.calls[0][0].tiendaId).toBe("t-A");
    expect(ok.listarOrdenesQueAportan.mock.calls[0][0].rango).toEqual({
      skip: 0,
      take: descargaConfig.MAX_FILAS + 1,
    });

    const excedido = montar({ total: descargaConfig.MAX_FILAS + 1 });
    const limite = await excedido.service.verDetalleDeMiMovimientoCompleto(
      { movimientoId: MOVIMIENTO },
      TIENDA_A,
    );
    expect(limite).toEqual({
      status: "limite_excedido",
      total: descargaConfig.MAX_FILAS + 1,
      limite: descargaConfig.MAX_FILAS,
    });
    expect("items" in limite).toBe(false);
  });
});
