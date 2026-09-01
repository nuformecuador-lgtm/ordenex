import { describe, it, expect, vi } from "vitest";
import { DetalleMovimientoService } from "@/lib/services/DetalleMovimientoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenAporteRow } from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { descargaConfig } from "@/lib/config/descarga";

/**
 * Ficha 344 (T4.2) — el detalle de una fila de la CAJA PRINCIPAL. Cubre **R32, R34, R38, R39,
 * R44 y R48**.
 *
 * Aqui se mide lo que un doble SI puede medir: el ORDEN de los pasos (que el guard corra antes
 * de la base), la forma del contrato y el reparto de responsabilidades. Lo que un doble NO puede
 * medir —que el `WHERE` acote de verdad— se mide contra Postgres en
 * `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts`.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

const CIERRE = "c-1";
const MOVIMIENTO = "11111111-2222-4333-8444-555555555555";

function movimiento(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: MOVIMIENTO,
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "28800.00",
    origenTipo: "cierre_dia",
    origenId: CIERRE,
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-08-20T18:30:00.000Z",
    dueno: "propio",
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
  mov?: WalletMovimientoDTO | null;
  filas?: OrdenAporteRow[];
  total?: number;
  ordenesDelCierre?: number;
  cabecera?: { fecha: string; mensajeroNombre: string } | null;
}) {
  const obtenerPorId = vi.fn(async (_id: string) => (opciones.mov === undefined ? movimiento() : opciones.mov));
  const obtenerPorIdDeTienda = vi.fn(async (_id: string, _tiendaId: string) => null);
  const listarOrdenesQueAportan = vi.fn(async (_f: { tiendaId?: string; criterio: { resultados: readonly string[] }; rango: { skip: number; take: number } }) => ({
    items: opciones.filas ?? [fila()],
    total: opciones.total ?? 14,
  }));
  const contarOrdenesDelCierre = vi.fn(async (_f: { cierreId: string; tiendaId?: string }) => opciones.ordenesDelCierre ?? 23);
  const obtenerCabeceraDeCierre = vi.fn(async (_cierreId: string) =>
    opciones.cabecera === undefined
      ? { fecha: "2026-08-20T18:30:00.000Z", mensajeroNombre: "Kendall Hernandez" }
      : opciones.cabecera,
  );
  const service = new DetalleMovimientoService(
    { obtenerPorId },
    { obtenerPorIdDeTienda },
    { listarOrdenesQueAportan, contarOrdenesDelCierre, obtenerCabeceraDeCierre },
  );
  return {
    service,
    obtenerPorId,
    listarOrdenesQueAportan,
    contarOrdenesDelCierre,
    obtenerCabeceraDeCierre,
  };
}

const PAGINA = { movimientoId: MOVIMIENTO, page: 1, pageSize: 25 };

describe("ficha 344 — el detalle de un movimiento de la caja (R32/R34/R38/R39/R44/R48)", () => {
  it("un rol sin acceso total recibe forbidden sin ordenes", async () => {
    for (const actor of [MENSAJERO, TIENDA]) {
      const m = montar({});
      const r = await m.service.verDetalleDeMovimiento(PAGINA, actor);
      expect(r, actor.rol).toEqual({ status: "forbidden" });
      expect("data" in r, "el forbidden viajo con datos").toBe(false);
    }
  });

  it("R39: el forbidden no llega a llamar al repositorio", async () => {
    const m = montar({});
    await m.service.verDetalleDeMovimiento(PAGINA, MENSAJERO);
    // Cero invocaciones: un guard evaluado DESPUES del SELECT ya habria leido el dinero para
    // tirarlo. Se afirma sobre las CUATRO lecturas, no solo sobre una.
    expect(m.obtenerPorId).not.toHaveBeenCalled();
    expect(m.obtenerCabeceraDeCierre).not.toHaveBeenCalled();
    expect(m.listarOrdenesQueAportan).not.toHaveBeenCalled();
    expect(m.contarOrdenesDelCierre).not.toHaveBeenCalled();
  });

  it("devuelve la pagina con el «N de M» y el aporte derivado de cada orden", async () => {
    const m = montar({});
    const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
    if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);

    expect(r.data.monto).toBe("28800.00");
    expect(r.data.cierre).toEqual({
      fecha: "2026-08-20T18:30:00.000Z",
      mensajeroNombre: "Kendall Hernandez",
    });
    expect(r.data.total).toBe(14); // N, de la base
    expect(r.data.ordenesDelCierre).toBe(23); // M, de la base
    expect(r.data.page).toBe(1);
    expect(r.data.pageSize).toBe(25);
    expect(r.data.ordenes).toEqual([
      {
        ordenId: "o-1",
        guia: "501",
        destinatario: "Ana",
        tiendaNombre: "Tienda A",
        resultados: ["entregada"],
        aporte: "1000.00", // el flete congelado, re-derivado
      },
    ]);
    // El `total` NO es el largo de la pagina: aqui hay 1 fila y 14 aportantes.
    expect(r.data.total).not.toBe(r.data.ordenes.length);
    // Y la caja no se acota por tienda: la clave no viaja al repositorio.
    expect(m.listarOrdenesQueAportan.mock.calls[0][0].tiendaId).toBeUndefined();
    expect(m.contarOrdenesDelCierre.mock.calls[0][0]).toEqual({ cierreId: CIERRE });
  });

  it("R44: todo importe cruza la frontera como texto", async () => {
    const m = montar({});
    const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(typeof r.data.monto).toBe("string");
    for (const orden of r.data.ordenes) {
      expect(typeof orden.aporte, `${orden.ordenId} no vino como texto`).toBe("string");
      expect(orden.aporte).toMatch(/^\d+\.\d{2}$/); // escala 2 FIJA
    }
  });

  it("una orden sin guia congelada se identifica por su remision", async () => {
    const m = montar({ filas: [fila({ numGuia: null })] });
    const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.data.ordenes[0].guia).toBe("REM-1");
  });

  it("una orden con dos gestiones sale UNA vez, con sus dos resultados y el aporte sumado", async () => {
    const m = montar({
      filas: [
        fila({
          gestiones: [
            { resultado: "entregada", montoRecibido: "3000.00" },
            { resultado: "entregada", montoRecibido: "4000.00" },
          ],
        }),
      ],
    });
    const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
    if (r.status !== "ok") throw new Error("esperado ok");
    expect(r.data.ordenes).toHaveLength(1);
    expect(r.data.ordenes[0].resultados).toEqual(["entregada", "entregada"]);
    expect(r.data.ordenes[0].aporte).toBe("2000.00"); // 1000.00 x 2
  });

  it("R48: un concepto que no se reparte abre su detalle y dice de donde sale, sin tocar ordenes", async () => {
    for (const [categoria, motivo] of [
      ["egreso_pago_mensajero", "snapshot_del_cierre"],
      ["ingreso_cod_recaudado", "suma_del_libro_por_tienda"],
      ["egreso_indemnizacion", "otro_productor"],
    ] as const) {
      const m = montar({ mov: movimiento({ categoria, tipo: "egreso" }) });
      const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
      expect(r, categoria).toEqual({ status: "sin_reparto", motivo });
      // Ni cabecera ni ordenes: el hueco de alcance no cuesta una consulta.
      expect(m.obtenerCabeceraDeCierre, categoria).not.toHaveBeenCalled();
      expect(m.listarOrdenesQueAportan, categoria).not.toHaveBeenCalled();
    }
  });

  it("R6/R48: un movimiento que no nace de un cierre tampoco lista ordenes", async () => {
    for (const mov of [
      movimiento({ categoria: "ingreso_ajuste", origenTipo: "manual", origenId: null }),
      // Y el caso raro pero posible: la categoria SI se reparte, pero el origen no es un cierre.
      movimiento({ origenTipo: "manual", origenId: null }),
      movimiento({ origenTipo: "cierre_dia", origenId: null }),
    ]) {
      const m = montar({ mov });
      const r = await m.service.verDetalleDeMovimiento(PAGINA, MAESTRO);
      expect(r).toEqual({ status: "sin_reparto", motivo: "no_nace_de_un_cierre" });
      expect(m.listarOrdenesQueAportan).not.toHaveBeenCalled();
    }
  });

  it("un movimiento que no existe responde not_found, y un cierre ausente tambien", async () => {
    const sinMovimiento = montar({ mov: null });
    expect(await sinMovimiento.service.verDetalleDeMovimiento(PAGINA, MAESTRO)).toEqual({
      status: "not_found",
    });
    expect(sinMovimiento.listarOrdenesQueAportan).not.toHaveBeenCalled();

    const sinCierre = montar({ cabecera: null });
    expect(await sinCierre.service.verDetalleDeMovimiento(PAGINA, MAESTRO)).toEqual({
      status: "not_found",
    });
    expect(sinCierre.listarOrdenesQueAportan).not.toHaveBeenCalled();
  });

  it("R32: el modo completo devuelve el conjunto sin recorte por pagina", async () => {
    const m = montar({ total: 40 });
    const r = await m.service.verDetalleDeMovimientoCompleto({ movimientoId: MOVIMIENTO }, MAESTRO);
    if (r.status !== "ok") throw new Error(`esperado ok, llego ${r.status}`);
    expect(r.total).toBe(40);
    expect(r.items).toHaveLength(1);
    // La ventana pedida es `skip 0, take tope + 1`: acota la memoria sin truncar nunca en
    // silencio, y NO es el tamano de una pagina de pantalla.
    expect(m.listarOrdenesQueAportan.mock.calls[0][0].rango).toEqual({
      skip: 0,
      take: descargaConfig.MAX_FILAS + 1,
    });
  });

  it("R34: por encima del tope devuelve solo conteos y ninguna fila", async () => {
    const m = montar({ total: descargaConfig.MAX_FILAS + 1 });
    const r = await m.service.verDetalleDeMovimientoCompleto({ movimientoId: MOVIMIENTO }, MAESTRO);
    expect(r).toEqual({
      status: "limite_excedido",
      total: descargaConfig.MAX_FILAS + 1,
      limite: descargaConfig.MAX_FILAS,
    });
    expect("items" in r, "el limite_excedido viajo con filas").toBe(false);
  });

  it("el modo completo hereda el guard y las dos ramas propias del detalle", async () => {
    const forbidden = montar({});
    expect(
      await forbidden.service.verDetalleDeMovimientoCompleto({ movimientoId: MOVIMIENTO }, MENSAJERO),
    ).toEqual({ status: "forbidden" });
    expect(forbidden.obtenerPorId).not.toHaveBeenCalled();

    const sinReparto = montar({ mov: movimiento({ categoria: "egreso_pago_mensajero" }) });
    expect(
      await sinReparto.service.verDetalleDeMovimientoCompleto({ movimientoId: MOVIMIENTO }, MAESTRO),
    ).toEqual({ status: "sin_reparto", motivo: "snapshot_del_cierre" });

    const noExiste = montar({ mov: null });
    expect(
      await noExiste.service.verDetalleDeMovimientoCompleto({ movimientoId: MOVIMIENTO }, MAESTRO),
    ).toEqual({ status: "not_found" });
  });
});
