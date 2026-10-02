import { describe, it, expect, vi } from "vitest";

import { DetalleEnLoteService } from "@/lib/services/DetalleEnLoteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CabeceraDeCierre,
  FiltroAportesEnLote,
  OrdenAporteEnLoteRow,
} from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { MovimientoDeCajaParaDetalle } from "@/lib/interfaces/services/IDetalleEnLoteService";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { descargaConfig } from "@/lib/config/descarga";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import { CRITERIO_COD_RECAUDADO, CRITERIO_DE_APORTE } from "@/lib/utils/aporte-por-orden";

/**
 * Ficha 464 (T5) — `DetalleEnLoteService` con DOBLES. Cubre R5, R20, R22, R23, R32, R33, R37, R39 y
 * R40 en su parte de servicio.
 *
 * Lo que este archivo NO prueba: que el `WHERE` del lote seleccione bien. Eso se mide contra Postgres
 * en `tests/integration/db/detalle-en-lote-464.test.ts`, con sus mutaciones.
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t-A", rol: "adminTienda" };

const TARIFA = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
  tarifaEspecial: null,
  tarifaEspecialDevuelta: null,
};

/** Una orden entregada con su flete: aporta `valorFlete` al flete y su 13 % al IVA del flete. */
function orden(cierreId: string, n: number, valorFlete = "1000.00"): OrdenAporteEnLoteRow {
  return {
    cierreId,
    ordenId: `o-${cierreId}-${n}`,
    numGuia: n,
    numRemision: `REM-${n}`,
    destinatario: `Dest ${n}`,
    tiendaNombre: "Tienda A",
    orden: {
      esCentral: false,
      esZonaEspecial: false,
      montoCobrar: "5000.00",
      cobraComision: false,
      tarifa: { ...TARIFA, valorFlete },
    },
    gestiones: [{ resultado: "entregado", montoRecibido: "5000.00" }],
  };
}

function movCaja(over: Partial<MovimientoDeCajaParaDetalle> & { id: string }): MovimientoDeCajaParaDetalle {
  return {
    categoria: "ingreso_flete",
    monto: "1000.00",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    ...over,
  };
}

function movTienda(over: Partial<WalletTiendaMovimientoDTO> & { id: string }): WalletTiendaMovimientoDTO {
  return {
    tiendaId: "t-A",
    tipo: "credito",
    categoria: "cod_recaudado",
    monto: "5000.00",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    descripcion: null,
    fechaMovimiento: "2026-09-01T18:00:00.000Z",
    ...over,
  };
}

function montar(opciones: {
  filas?: OrdenAporteEnLoteRow[];
  conteos?: (f: FiltroAportesEnLote) => Map<string, number>;
  cabeceras?: Record<string, CabeceraDeCierre>;
  movimientosDeTienda?: WalletTiendaMovimientoDTO[];
} = {}) {
  const filas = opciones.filas ?? [];
  const contarAportesPorCierre = vi.fn(async (f: FiltroAportesEnLote) => {
    if (opciones.conteos) return opciones.conteos(f);
    const m = new Map<string, number>();
    for (const fila of filas) if (f.cierreIds.includes(fila.cierreId)) m.set(fila.cierreId, (m.get(fila.cierreId) ?? 0) + 1);
    return m;
  });
  const listarAportesDeCierres = vi.fn(async (f: FiltroAportesEnLote) =>
    filas.filter((fila) => f.cierreIds.includes(fila.cierreId)),
  );
  const cabeceraPorDefecto = (id: string): CabeceraDeCierre => ({
    fecha: `2026-09-01T18:00:00.000Z`,
    mensajeroNombre: `Mensajero de ${id}`,
  });
  const cabecerasDeCierres = vi.fn(async (ids: readonly string[]) => {
    const m = new Map<string, CabeceraDeCierre>();
    for (const id of ids) {
      if (opciones.cabeceras === undefined) m.set(id, cabeceraPorDefecto(id));
      else if (opciones.cabeceras[id] !== undefined) m.set(id, opciones.cabeceras[id]);
    }
    return m;
  });
  const listarPorIdsDeTienda = vi.fn<(ids: readonly string[], tiendaId: string) => Promise<WalletTiendaMovimientoDTO[]>>(async (ids) =>
    (opciones.movimientosDeTienda ?? []).filter((m) => ids.includes(m.id)),
  );
  const servicio = new DetalleEnLoteService(
    { contarAportesPorCierre, listarAportesDeCierres, cabecerasDeCierres },
    { listarPorIdsDeTienda },
  );
  return { servicio, contarAportesPorCierre, listarAportesDeCierres, cabecerasDeCierres, listarPorIdsDeTienda };
}

function llamadasALaBase(m: ReturnType<typeof montar>): number {
  return (
    m.contarAportesPorCierre.mock.calls.length +
    m.listarAportesDeCierres.mock.calls.length +
    m.cabecerasDeCierres.mock.calls.length +
    m.listarPorIdsDeTienda.mock.calls.length
  );
}

describe("464 — R32/R33: el rol se mira ANTES de leer nada", () => {
  it("R32: la caja sin acceso total -> forbidden y cero llamadas a la base", async () => {
    for (const actor of [MENSAJERO, TIENDA]) {
      const m = montar({ filas: [orden("c-1", 1)] });
      const r = await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m1" })] }, actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(llamadasALaBase(m)).toBe(0);
    }
  });

  it("R32: la tienda en la oficina sin acceso total -> forbidden y cero llamadas", async () => {
    for (const actor of [MENSAJERO, TIENDA]) {
      const m = montar({ movimientosDeTienda: [movTienda({ id: "m1" })] });
      const r = await m.servicio.detallar(
        { superficie: "tienda_oficina", tiendaId: "t-A", movimientoIds: ["m1"] },
        actor,
      );
      expect(r).toEqual({ status: "forbidden" });
      expect(llamadasALaBase(m)).toBe(0);
    }
  });

  it("R33: /mi-wallet sin el rol de tienda -> forbidden y cero llamadas (tambien el maestro)", async () => {
    for (const actor of [MAESTRO, MENSAJERO]) {
      const m = montar({ movimientosDeTienda: [movTienda({ id: "m1" })] });
      const r = await m.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m1"] }, actor);
      expect(r).toEqual({ status: "forbidden" });
      expect(llamadasALaBase(m)).toBe(0);
    }
  });

  it("control: con el rol correcto SI lee (el guard no lo bloquea todo)", async () => {
    const m = montar({ filas: [orden("c-1", 1)], movimientosDeTienda: [movTienda({ id: "m1" })] });
    expect((await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m1" })] }, MAESTRO)).status).toBe("ok");
    expect((await m.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m1"] }, TIENDA)).status).toBe("ok");
    expect(llamadasALaBase(m)).toBeGreaterThan(0);
  });
});

describe("464 — R34/R35: en /mi-wallet la tienda sale del ACTOR, en la oficina de la cuenta leida", () => {
  it("/mi-wallet: el `tiendaId` de las tres lecturas es el `usuarioId` del actor", async () => {
    const m = montar({ movimientosDeTienda: [movTienda({ id: "m1" })], filas: [orden("c-1", 1)] });
    await m.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m1"] }, TIENDA);
    expect(m.listarPorIdsDeTienda).toHaveBeenCalledWith(["m1"], "t-A");
    expect(m.contarAportesPorCierre.mock.calls.every(([f]) => f.tiendaId === "t-A")).toBe(true);
    expect(m.listarAportesDeCierres.mock.calls.every(([f]) => f.tiendaId === "t-A")).toBe(true);
    expect(m.listarAportesDeCierres).toHaveBeenCalled();
  });

  it("oficina: el `tiendaId` es el de la cuenta; la caja no se acota", async () => {
    const m = montar({ movimientosDeTienda: [movTienda({ id: "m1" })], filas: [orden("c-1", 1)] });
    await m.servicio.detallar({ superficie: "tienda_oficina", tiendaId: "t-A", movimientoIds: ["m1"] }, MAESTRO);
    expect(m.listarPorIdsDeTienda).toHaveBeenCalledWith(["m1"], "t-A");
    expect(m.contarAportesPorCierre.mock.calls[0][0].tiendaId).toBe("t-A");

    const c = montar({ filas: [orden("c-1", 1)] });
    await c.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m1" })] }, MAESTRO);
    expect(c.contarAportesPorCierre.mock.calls[0][0].tiendaId).toBeUndefined();
    expect(c.listarPorIdsDeTienda).not.toHaveBeenCalled();
  });

  it("un id que no vuelve del libro de esa tienda no se convierte en un detalle vacio: falla", async () => {
    const m = montar({ movimientosDeTienda: [] });
    await expect(
      m.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["ajeno"] }, TIENDA),
    ).rejects.toThrow(/no pertenece al libro de la tienda/);
  });
});

describe("464 — R39/R40: se cuenta antes de leer; por encima del tope, solo conteos", () => {
  it("total > tope -> limite_excedido con el total y el tope, y CERO lecturas de ordenes o cabeceras", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const mitad = Math.floor(limite / 2) + 1; // dos movimientos que juntos se pasan
    const m = montar({
      conteos: (f) => new Map(f.cierreIds.map((id) => [id, mitad])),
    });
    const r = await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: [
          movCaja({ id: "m1", origenId: "c-1" }),
          movCaja({ id: "m2", origenId: "c-2" }),
        ],
      },
      MAESTRO,
    );
    expect(r).toEqual({ status: "limite_excedido", total: mitad * 2, limite });
    expect(m.contarAportesPorCierre).toHaveBeenCalled();
    expect(m.listarAportesDeCierres).not.toHaveBeenCalled();
    expect(m.cabecerasDeCierres).not.toHaveBeenCalled();
  });

  it("frontera: total == tope SI produce el detalle", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const m = montar({ conteos: (f) => new Map(f.cierreIds.map((id) => [id, limite])) });
    const r = await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m1" })] }, MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("el conteo suma por MOVIMIENTO: dos movimientos del mismo (concepto, cierre) cuentan dos veces", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const m = montar({ conteos: (f) => new Map(f.cierreIds.map((id) => [id, Math.floor(limite / 2) + 1])) });
    const r = await m.servicio.detallar(
      { superficie: "caja", movimientos: [movCaja({ id: "m1" }), movCaja({ id: "m2" })] },
      MAESTRO,
    );
    expect(r.status).toBe("limite_excedido");
  });
});

describe("464 — R37: las consultas no crecen con el numero de movimientos", () => {
  const conceptos = ["ingreso_flete", "ingreso_iva_flete"] as const;
  const cierres = ["c-1", "c-2", "c-3"];
  const filas = cierres.flatMap((c) => [orden(c, 1), orden(c, 2)]);

  async function llamadas(movimientos: MovimientoDeCajaParaDetalle[]) {
    const m = montar({ filas });
    const r = await m.servicio.detallar({ superficie: "caja", movimientos }, MAESTRO);
    expect(r.status).toBe("ok");
    return {
      contar: m.contarAportesPorCierre.mock.calls.length,
      listar: m.listarAportesDeCierres.mock.calls.length,
      cabeceras: m.cabecerasDeCierres.mock.calls.length,
    };
  }

  it("con 6 y con 40 movimientos de los mismos conceptos y cierres, las MISMAS llamadas", async () => {
    const pocos = conceptos.flatMap((categoria) =>
      cierres.map((origenId) => movCaja({ id: `${categoria}-${origenId}`, categoria, origenId })),
    );
    const muchos: MovimientoDeCajaParaDetalle[] = [];
    for (let i = 0; i < 40; i += 1) {
      muchos.push(
        movCaja({
          id: `m-${i}`,
          categoria: conceptos[i % 2],
          origenId: cierres[i % 3],
        }),
      );
    }
    // y movimientos sin reparto mezclados, que no consultan nada
    muchos.push(movCaja({ id: "gasto", categoria: "egreso_gasto", origenTipo: "gasto", origenId: "g-1" }));
    const a = await llamadas(pocos);
    const b = await llamadas(muchos);
    expect(b).toEqual(a);
    // conceptos (2) x tramos (1) para contar y para listar; un tramo de cabeceras.
    expect(a).toEqual({ contar: 2, listar: 2, cabeceras: 1 });
  });

  it("los cierres se parten en tramos de TRAMO_CIERRES_LOTE: un tramo mas, una consulta mas por concepto", async () => {
    const tramo = detalleMovimientoConfig.TRAMO_CIERRES_LOTE;
    const muchosCierres = Array.from({ length: tramo + 1 }, (_, i) => `c-${String(i).padStart(4, "0")}`);
    const m = montar({ filas: muchosCierres.map((c) => orden(c, 1)) });
    const r = await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: muchosCierres.map((origenId, i) => movCaja({ id: `m-${i}`, origenId })),
      },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(m.contarAportesPorCierre).toHaveBeenCalledTimes(2);
    expect(m.listarAportesDeCierres).toHaveBeenCalledTimes(2);
    expect(m.cabecerasDeCierres).toHaveBeenCalledTimes(2);
    for (const [f] of m.contarAportesPorCierre.mock.calls) expect(f.cierreIds.length).toBeLessThanOrEqual(tramo);
  });

  it("cada concepto consulta con SU criterio (el de la 344), no con uno comun", async () => {
    const m = montar({ filas: [orden("c-1", 1)] });
    await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: [movCaja({ id: "a", categoria: "ingreso_comision_cod" })],
      },
      MAESTRO,
    );
    expect(m.contarAportesPorCierre.mock.calls[0][0].criterio).toBe(CRITERIO_DE_APORTE.ingreso_comision_cod);
    const t = montar({ filas: [orden("c-1", 1)], movimientosDeTienda: [movTienda({ id: "m1" })] });
    await t.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m1"] }, TIENDA);
    expect(t.contarAportesPorCierre.mock.calls[0][0].criterio).toBe(CRITERIO_COD_RECAUDADO);
  });
});

describe("464 — R18/R20/R24: forma y orden de la salida", () => {
  it("un detalle por movimiento, en el orden recibido; las ordenes en el orden del repositorio", async () => {
    const filas = [orden("c-1", 7), orden("c-1", 3), orden("c-2", 9)];
    const m = montar({ filas });
    const r = await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: [
          movCaja({ id: "z", origenId: "c-2", monto: "1000.00" }),
          movCaja({ id: "gasto", categoria: "egreso_gasto", origenTipo: "gasto", origenId: "x" }),
          movCaja({ id: "a", origenId: "c-1", monto: "2000.00" }),
          movCaja({ id: "pago", categoria: "egreso_pago_mensajero", origenId: "c-1" }),
          movCaja({ id: "manual", origenTipo: "manual", origenId: null }),
        ],
      },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.detalle.map((d) => d.movimientoId)).toEqual(["z", "gasto", "a", "pago", "manual"]);
    expect(r.detalle.map((d) => d.modo)).toEqual(["ordenes", "sin_reparto", "ordenes", "sin_reparto", "sin_reparto"]);
    const a = r.detalle[2];
    expect(a.modo === "ordenes" && a.ordenes.map((o) => o.remision)).toEqual(["REM-7", "REM-3"]);
    expect(r.detalle[1]).toEqual({ movimientoId: "gasto", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" });
    expect(r.detalle[3]).toEqual({ movimientoId: "pago", modo: "sin_reparto", motivo: "snapshot_del_cierre" });
    expect(r.detalle[4]).toEqual({ movimientoId: "manual", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" });
  });

  it("R24 (servidor): si nada tiene reparto, cero consultas y un detalle solo de motivos", async () => {
    const m = montar({});
    const r = await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: [
          movCaja({ id: "g", categoria: "egreso_gasto", origenTipo: "gasto" }),
          movCaja({ id: "cod", categoria: "ingreso_cod_recaudado" }),
        ],
      },
      MAESTRO,
    );
    expect(r).toEqual({
      status: "ok",
      detalle: [
        { movimientoId: "g", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
        { movimientoId: "cod", modo: "sin_reparto", motivo: "suma_del_libro_por_tienda" },
      ],
    });
    expect(llamadasALaBase(m)).toBe(0);
  });

  it("la orden sin guia congelada sale con guia null y su remision; ningun id interno en la DTO", async () => {
    const sinGuia = { ...orden("c-1", 1), numGuia: null };
    const m = montar({ filas: [sinGuia] });
    const r = await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m" })] }, MAESTRO);
    if (r.status !== "ok" || r.detalle[0].modo !== "ordenes") throw new Error("se esperaba ok con ordenes");
    expect(r.detalle[0].ordenes[0]).toEqual({
      guia: null,
      remision: "REM-1",
      destinatario: "Dest 1",
      tiendaNombre: "Tienda A",
      resultados: ["entregado"],
      aporte: "1000.00",
    });
    expect(JSON.stringify(r.detalle[0].ordenes)).not.toContain("o-c-1-1");
  });
});

describe("464 — R21/R22/R23: aporte derivado y cuadre con Decimal en el servidor", () => {
  it("R22: la suma de los aportes es el monto -> cuadra; el IVA del flete se deriva (13 %)", async () => {
    const m = montar({ filas: [orden("c-1", 1, "1000.00"), orden("c-1", 2, "333.33")] });
    const r = await m.servicio.detallar(
      {
        superficie: "caja",
        movimientos: [
          movCaja({ id: "flete", monto: "1333.33" }),
          // 130.00 + 43.33 (333.33 * 13 % = 43.3329 -> 43.33)
          movCaja({ id: "iva", categoria: "ingreso_iva_flete", monto: "173.33" }),
        ],
      },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("se esperaba ok");
    const [flete, iva] = r.detalle;
    if (flete.modo !== "ordenes" || iva.modo !== "ordenes") throw new Error("se esperaban ordenes");
    expect(flete.ordenes.map((o) => o.aporte)).toEqual(["1000.00", "333.33"]);
    expect(flete).toMatchObject({ suma: "1333.33", cuadra: true });
    expect(iva.ordenes.map((o) => o.aporte)).toEqual(["130.00", "43.33"]);
    expect(iva).toMatchObject({ suma: "173.33", cuadra: true });
  });

  it("R23: si la suma no es el monto, cuadra=false y la suma viaja (el archivo se genera igual)", async () => {
    const m = montar({ filas: [orden("c-1", 1, "1000.00")] });
    const r = await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m", monto: "1000.01" })] }, MAESTRO);
    if (r.status !== "ok" || r.detalle[0].modo !== "ordenes") throw new Error("se esperaban ordenes");
    expect(r.detalle[0]).toMatchObject({ suma: "1000.00", cuadra: false });
  });

  it("un movimiento de cierre sin ordenes que aporten: lista vacia, suma 0.00 y no cuadra", async () => {
    const m = montar({ filas: [] });
    const r = await m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m" })] }, MAESTRO);
    if (r.status !== "ok" || r.detalle[0].modo !== "ordenes") throw new Error("se esperaban ordenes");
    expect(r.detalle[0]).toMatchObject({ ordenes: [], suma: "0.00", cuadra: false });
  });

  it("tienda: el COD recaudado es la suma de lo recibido en sus gestiones", async () => {
    const dos = {
      ...orden("c-1", 1),
      gestiones: [
        { resultado: "entregado" as const, montoRecibido: "3000.00" },
        { resultado: "entregado" as const, montoRecibido: "2000.50" },
      ],
    };
    const m = montar({ filas: [dos], movimientosDeTienda: [movTienda({ id: "m1", monto: "5000.50" })] });
    const r = await m.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m1"] }, TIENDA);
    if (r.status !== "ok" || r.detalle[0].modo !== "ordenes") throw new Error("se esperaban ordenes");
    expect(r.detalle[0].ordenes[0]).toMatchObject({ aporte: "5000.50", resultados: ["entregado", "entregado"] });
    expect(r.detalle[0]).toMatchObject({ suma: "5000.50", cuadra: true });
  });

  it("el cierre de origen que no existe falla ruidoso (sin archivo), no inventa cabecera", async () => {
    const m = montar({ filas: [orden("c-1", 1)], cabeceras: {} });
    await expect(
      m.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m" })] }, MAESTRO),
    ).rejects.toThrow(/no existe/);
  });
});

describe("464 — R5: lo que se nombra en cada superficie", () => {
  it("caja: tienda y mensajero; oficina-tienda: mensajero sin tienda; /mi-wallet: ninguno", async () => {
    const filas = [orden("c-1", 1)];
    const caja = montar({ filas });
    const rc = await caja.servicio.detallar({ superficie: "caja", movimientos: [movCaja({ id: "m" })] }, MAESTRO);
    const oficina = montar({ filas, movimientosDeTienda: [movTienda({ id: "m", categoria: "flete", tipo: "debito", monto: "1000.00" })] });
    const ro = await oficina.servicio.detallar(
      { superficie: "tienda_oficina", tiendaId: "t-A", movimientoIds: ["m"] },
      MAESTRO,
    );
    const mi = montar({ filas, movimientosDeTienda: [movTienda({ id: "m", categoria: "flete", tipo: "debito", monto: "1000.00" })] });
    const rm = await mi.servicio.detallar({ superficie: "mi_wallet", movimientoIds: ["m"] }, TIENDA);

    const primero = (r: typeof rc) => {
      if (r.status !== "ok" || r.detalle[0].modo !== "ordenes") throw new Error("se esperaban ordenes");
      return r.detalle[0];
    };
    expect(primero(rc).cierre.mensajeroNombre).toBe("Mensajero de c-1");
    expect(primero(rc).ordenes[0].tiendaNombre).toBe("Tienda A");
    expect(primero(ro).cierre.mensajeroNombre).toBe("Mensajero de c-1");
    expect(primero(ro).ordenes[0].tiendaNombre).toBeNull();
    expect(primero(rm).cierre.mensajeroNombre).toBeNull();
    expect(primero(rm).ordenes[0].tiendaNombre).toBeNull();
    expect(JSON.stringify(rm)).not.toContain("Mensajero de");
    // y las tres cuadran con el mismo dinero
    expect(primero(rc)).toMatchObject({ suma: "1000.00", cuadra: true });
    expect(primero(ro)).toMatchObject({ suma: "1000.00", cuadra: true });
    expect(primero(rm)).toMatchObject({ suma: "1000.00", cuadra: true });
  });
});
