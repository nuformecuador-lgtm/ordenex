// Ficha 464 (T7) — el adaptador que enlaza la hoja de movimientos con «Detalle por orden», los catálogos
// de detalle de las tres superficies, sus ámbitos y el aviso del tope del detalle.
//
// Los literales (encabezados, ámbitos, textos) se escriben A MANO: son el contrato del archivo y de la
// pantalla, y compararlos contra su propia fuente los dejaría siempre verdes.
import { describe, it, expect } from "vitest";

import { enlazarHojas } from "@/components/shared/descarga-con-detalle";
import { mensajeLimite, mensajeLimiteDetalle } from "@/components/shared/descarga-resultado";
import {
  COLUMNA_DETALLE_POR_ORDEN,
  COLUMNA_NUMERO_MOVIMIENTO,
  DETALLE_POR_ORDEN_COMUN,
  DETALLE_POR_ORDEN_TEXTO,
  textoDetallePorOrden,
} from "@/components/shared/wallet/detalle-por-orden-descarga";
import {
  COLUMNAS_DE_LA_HOJA_LEGEND,
  QUE_SE_DESCARGA_LEGEND,
  SELECTOR_DETALLE_DISPARADOR,
} from "@/components/shared/DescargarDatasetButton";
import {
  AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO,
  AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE,
  AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA,
  AMBITO_DESCARGA_MI_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  filaDescargaEstadoCuenta,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import {
  AMBITO_DESCARGA_WALLET_CAJA,
  AMBITO_DESCARGA_WALLET_CAJA_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_CAJA,
  COLUMNAS_DESCARGA_WALLET_CAJA,
  DETALLE_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
  filaDetallePorOrdenCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import {
  AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_TIENDA,
  DETALLE_DESCARGA_WALLET_TIENDA,
  filaDetallePorOrdenTienda,
} from "@/app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-descarga-columnas";
import {
  AMBITO_DESCARGA_MI_WALLET_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET,
  DETALLE_DESCARGA_MI_WALLET,
  filaDetallePorOrdenMiWallet,
} from "@/app/(app)/mi-wallet/_components/mi-estado-cuenta-descarga-columnas";
import { AMBITO_DESCARGA_SALDOS_TIENDAS } from "@/app/(app)/wallet/tiendas/_components/saldos-tiendas-descarga-columnas";
import { AMBITO_DESCARGA_CUENTAS_POR_PAGAR } from "@/app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas";
import { AMBITO_DESCARGA_SALDOS_SATELITES } from "@/app/(app)/wallet/satelites/_components/saldos-satelites-descarga-columnas";
import type { DescargaFila } from "@/lib/types/descarga";
import type { DetalleDeMovimientoLoteDTO, OrdenDelLoteDTO } from "@/lib/types/detalle-en-lote";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function mov(n: number, over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: `0000000${n}-0000-4000-8000-00000000000${n}`,
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: `${n}0.00`,
    origenTipo: "cierre_dia",
    origenId: `cccccccc-0000-4000-8000-00000000000${n}`,
    descripcion: null,
    registradoPor: "99999999-0000-4000-8000-000000000001",
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  } as WalletMovimientoDTO;
}

function orden(n: number, aporte: string, over: Partial<OrdenDelLoteDTO> = {}): OrdenDelLoteDTO {
  return {
    guia: `${1000 + n}`,
    remision: `REM-${n}`,
    destinatario: `Destinatario ${n}`,
    tiendaNombre: "Tienda Uno",
    resultados: ["entregada"],
    aporte,
    ...over,
  };
}

const CIERRE = { fecha: "2026-09-20T20:00:00.000Z", mensajeroNombre: "Mario Mensajero" };

function conOrdenes(id: string, ordenes: OrdenDelLoteDTO[], suma: string, cuadra = true): DetalleDeMovimientoLoteDTO {
  return { movimientoId: id, modo: "ordenes", cierre: CIERRE, ordenes, suma, cuadra };
}

/** El enlace de la caja, como lo arma `WalletModule`. */
function enlazarCaja(movs: WalletMovimientoDTO[], detalle: DetalleDeMovimientoLoteDTO[]) {
  return enlazarHojas({
    lineas: movs,
    numerada: () => true,
    idDe: (m) => m.id,
    filaDe: (m) => filaDescargaMovimientoCaja(m),
    detalle,
    filaDetalleDe: filaDetallePorOrdenCaja,
    textoEstado: (d) => textoDetallePorOrden(d, { no_nace_de_un_cierre: "NO NACE", snapshot_del_cierre: "SNAPSHOT", suma_del_libro_por_tienda: "SUMA", otro_productor: "OTRO" }),
    claveEnlace: COLUMNA_NUMERO_MOVIMIENTO.clave,
    claveEstado: COLUMNA_DETALLE_POR_ORDEN.clave,
  });
}

describe("464 R15/R19/R20 — numeración y enlace de las dos hojas", () => {
  it("«N.º» correlativo desde 1 en el orden recibido; cada orden lleva el número de SU movimiento, en su orden", () => {
    const a = mov(1);
    const b = mov(2, { categoria: "egreso_sueldo", origenTipo: "gasto", origenId: null });
    const c = mov(3);
    const { filas, filasDetalle } = enlazarCaja(
      [a, b, c],
      [
        conOrdenes(a.id, [orden(1, "4.00"), orden(2, "6.00")], "10.00"),
        { movimientoId: b.id, modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
        conOrdenes(c.id, [orden(3, "30.00")], "30.00"),
      ],
    );
    expect(filas.map((f) => f.numero)).toEqual([1, 2, 3]);
    expect(filasDetalle.map((f) => [f.numero, f.guia])).toEqual([
      [1, "1001"],
      [1, "1002"],
      [3, "1003"],
    ]);
  });

  it("R15: la línea del saldo inicial no lleva número ni detalle, y no corre la numeración", () => {
    type L = { inicial: true } | { inicial: false; n: number };
    const lineas: L[] = [{ inicial: true }, { inicial: false, n: 1 }, { inicial: false, n: 2 }];
    const { filas } = enlazarHojas<L>({
      lineas,
      numerada: (l) => !l.inicial,
      idDe: (l) => (l.inicial ? null : `m${l.n}`),
      filaDe: (l) => ({ movimiento: l.inicial ? "Saldo inicial" : `M${l.n}` }),
      detalle: [
        { movimientoId: "m1", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
        { movimientoId: "m2", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
      ],
      filaDetalleDe: () => ({}),
      textoEstado: () => "x",
      claveEnlace: "numero",
      claveEstado: "detallePorOrden",
    });
    expect(filas).toEqual([
      { numero: null, movimiento: "Saldo inicial", detallePorOrden: null },
      { numero: 1, movimiento: "M1", detallePorOrden: "x" },
      { numero: 2, movimiento: "M2", detallePorOrden: "x" },
    ]);
  });

  it("R36: un detalle de un movimiento ausente, o un movimiento sin su detalle, NO produce hojas", () => {
    const a = mov(1);
    expect(() => enlazarCaja([a], [])).toThrow();
    expect(() =>
      enlazarCaja([a], [
        conOrdenes(a.id, [], "0.00", false),
        { movimientoId: "otro", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
      ]),
    ).toThrow();
  });

  it("R24: si nada tiene reparto, la hoja de detalle sale sin filas (el control la escribe con encabezados)", () => {
    const a = mov(1, { origenTipo: "gasto", origenId: null });
    const { filas, filasDetalle } = enlazarCaja([a], [
      { movimientoId: a.id, modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
    ]);
    expect(filas).toHaveLength(1);
    expect(filasDetalle).toEqual([]);
  });

  it("R14: la hoja de movimientos lleva las MISMAS celdas que la de siempre, más «N.º» y «Detalle por orden»", () => {
    const a = mov(1);
    const { filas } = enlazarCaja([a], [conOrdenes(a.id, [orden(1, "10.00")], "10.00")]);
    expect(filas[0]).toEqual({ numero: 1, ...filaDescargaMovimientoCaja(a), detallePorOrden: "1 orden" });
  });
});

describe("464 R16/R23 — el texto de «Detalle por orden»", () => {
  const SIN = { no_nace_de_un_cierre: "a", snapshot_del_cierre: "b", suma_del_libro_por_tienda: "c", otro_productor: "d" };

  it("con reparto y cuadrando: cuántas órdenes (singular y plural)", () => {
    expect(textoDetallePorOrden(conOrdenes("m", [orden(1, "5.00")], "5.00"), SIN)).toBe("1 orden");
    expect(textoDetallePorOrden(conOrdenes("m", [orden(1, "5.00"), orden(2, "5.00")], "10.00"), SIN)).toBe(
      "2 órdenes",
    );
  });

  it("R23: si el servidor dice que no cuadra, la celda lo dice con la suma de las órdenes", () => {
    expect(textoDetallePorOrden(conOrdenes("m", [orden(1, "4.00")], "4.00", false), SIN)).toBe(
      "1 orden. La suma de las órdenes es 4.00 y no coincide con el monto del movimiento.",
    );
  });

  it("sin reparto: el motivo, sacado del diccionario de la superficie (el MISMO del panel)", () => {
    expect(textoDetallePorOrden({ movimientoId: "m", modo: "sin_reparto", motivo: "snapshot_del_cierre" }, SIN)).toBe("b");
    expect(DETALLE_DESCARGA_WALLET_TIENDA.sinReparto.snapshot_del_cierre).toContain("pagarle al mensajero");
    // `/mi-wallet` lo dice desde la tienda, con su propio texto (el de su panel).
    expect(DETALLE_DESCARGA_MI_WALLET.sinReparto.snapshot_del_cierre).toContain("tus órdenes");
  });
});

describe("464 R25/R26/R27 — catálogos de la hoja de detalle (contrato literal)", () => {
  it("R25: la caja", () => {
    expect(COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_CAJA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Cierre del",
      "Mensajero",
      "Guía",
      "Remisión",
      "Destinatario",
      "Tienda",
      "Resultado",
      "Monto",
    ]);
  });

  it("R26: el estado de cuenta de una tienda en la oficina", () => {
    expect(COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_TIENDA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Cierre del",
      "Mensajero",
      "Guía",
      "Remisión",
      "Destinatario",
      "Resultado",
      "Monto",
    ]);
  });

  it("R27: /mi-wallet", () => {
    expect(COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Cierre del",
      "Guía",
      "Remisión",
      "Destinatario",
      "Resultado",
      "Monto",
    ]);
  });

  it("R15/R16: las dos columnas fijas, y «N.º» delante de cada catálogo (no dentro)", () => {
    expect(COLUMNA_NUMERO_MOVIMIENTO).toEqual({ clave: "numero", encabezado: "N.º" });
    expect(COLUMNA_DETALLE_POR_ORDEN).toEqual({ clave: "detallePorOrden", encabezado: "Detalle por orden" });
    for (const cat of [
      COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_CAJA,
      COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_TIENDA,
      COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET,
    ]) {
      expect(cat.map((c) => c.clave)).not.toContain("numero");
    }
    expect(DETALLE_POR_ORDEN_COMUN).toEqual({
      titulo: "Detalle por orden",
      etiquetaOpcion: "Movimientos y detalle por orden · dos hojas",
      etiquetaSinDetalle: "Solo los movimientos · una hoja",
      columnaEnlace: { clave: "numero", encabezado: "N.º" },
      columnaEstado: { clave: "detallePorOrden", encabezado: "Detalle por orden" },
    });
  });

  it("R5: en /mi-wallet ningún catálogo (movimientos ni detalle) nombra a una persona de Ordenex", () => {
    const encabezados = [
      ...COLUMNAS_DESCARGA_MI_ESTADO_CUENTA.map((c) => c.encabezado),
      ...COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_MI_WALLET.map((c) => c.encabezado),
    ];
    expect(encabezados).not.toContain("Mensajero");
    expect(encabezados).not.toContain("Registró");
    const fila = filaDetallePorOrdenMiWallet({ fila: {}, cierre: CIERRE, orden: orden(1, "1.00") });
    expect(Object.values(fila)).not.toContain("Mario Mensajero");
  });
});

describe("464 R28–R31 — las proyecciones de una orden", () => {
  const principal: DescargaFila = { fecha: "2026-09-20", categoria: "Flete", movimiento: "Flete de la tienda" };

  it("R28: «Fecha» y «Movimiento» son las celdas de la fila de su movimiento; R29/R31 lo congelado y el monto del servidor", () => {
    const o = orden(7, "1234.50", { guia: null, resultados: ["entregada", "rechazada"] });
    expect(filaDetallePorOrdenCaja({ fila: principal, cierre: CIERRE, orden: o })).toEqual({
      fecha: "2026-09-20",
      movimiento: "Flete",
      cierre: "2026-09-20",
      mensajero: "Mario Mensajero",
      guia: null,
      remision: "REM-7",
      destinatario: "Destinatario 7",
      tienda: "Tienda Uno",
      resultado: expect.stringContaining(" · "),
      monto: "1234.50",
    });
    const t = filaDetallePorOrdenTienda({ fila: principal, cierre: CIERRE, orden: o });
    expect(t.fecha).toBe("2026-09-20");
    expect(t.movimiento).toBe("Flete de la tienda");
    expect(t.monto).toBe("1234.50");
    expect(t).not.toHaveProperty("tienda");
    const m = filaDetallePorOrdenMiWallet({ fila: principal, cierre: CIERRE, orden: o });
    expect(m.movimiento).toBe("Flete de la tienda");
    expect(m).not.toHaveProperty("mensajero");
  });

  it("«Cierre del» es el DÍA de Costa Rica del cierre (no el día UTC)", () => {
    // 2026-09-21T03:00Z son las 21:00 del 20 en Costa Rica.
    const fila = filaDetallePorOrdenCaja({ fila: principal, cierre: { ...CIERRE, fecha: "2026-09-21T03:00:00.000Z" }, orden: orden(1, "1.00") });
    expect(fila.cierre).toBe("2026-09-20");
  });

  it("R30: ninguna celda de ninguna hoja lleva un identificador interno (ni el enlace en memoria)", () => {
    const a = mov(1);
    const b = mov(2);
    const { filas, filasDetalle } = enlazarCaja(
      [a, b],
      [conOrdenes(a.id, [orden(1, "4.00")], "4.00"), { movimientoId: b.id, modo: "sin_reparto", motivo: "otro_productor" }],
    );
    for (const fila of [...filas, ...filasDetalle]) {
      for (const celda of Object.values(fila)) expect(String(celda)).not.toMatch(UUID);
    }
    // Y la de un estado de cuenta tampoco (la proyección de la hoja de movimientos no cambia).
    const linea = filaDescargaEstadoCuenta({
      fecha: "2026-09-20",
      movimiento: "Flete",
      motivo: null,
      origen: null,
      pago: null,
      registro: null,
      cargo: "1.00",
      abono: null,
      saldo: "1.00",
      estado: null,
    });
    for (const celda of Object.values(linea)) expect(String(celda)).not.toMatch(UUID);
  });
});

describe("464 R2 — un ámbito propio por hoja y por superficie (contrato literal)", () => {
  it("los ocho de la hoja de movimientos y los tres de detalle, todos distintos", () => {
    const ambitos = {
      caja: AMBITO_DESCARGA_WALLET_CAJA,
      cajaDetalle: AMBITO_DESCARGA_WALLET_CAJA_DETALLE,
      tienda: AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA,
      tiendaDetalle: AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
      mensajero: AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO,
      satelite: AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE,
      miWallet: AMBITO_DESCARGA_MI_ESTADO_CUENTA,
      miWalletDetalle: AMBITO_DESCARGA_MI_WALLET_DETALLE,
      saldosTiendas: AMBITO_DESCARGA_SALDOS_TIENDAS,
      cuentasMensajeros: AMBITO_DESCARGA_CUENTAS_POR_PAGAR,
      saldosSatelites: AMBITO_DESCARGA_SALDOS_SATELITES,
    };
    expect(ambitos).toEqual({
      caja: "wallet-caja-libro",
      cajaDetalle: "wallet-caja-detalle-orden",
      tienda: "wallet-tienda-estado-cuenta",
      tiendaDetalle: "wallet-tienda-detalle-orden",
      mensajero: "wallet-mensajero-estado-cuenta",
      satelite: "wallet-satelite-estado-cuenta",
      miWallet: "mi-wallet-estado-cuenta",
      miWalletDetalle: "mi-wallet-detalle-orden",
      saldosTiendas: "wallet-tiendas-saldos",
      cuentasMensajeros: "wallet-mensajeros-cuentas",
      saldosSatelites: "wallet-satelites-saldos",
    });
    expect(new Set(Object.values(ambitos)).size).toBe(Object.keys(ambitos).length);
    expect(DETALLE_DESCARGA_WALLET_CAJA.ambitoColumnas).toBe("wallet-caja-detalle-orden");
    expect(DETALLE_DESCARGA_WALLET_TIENDA.hoja.ambitoColumnas).toBe("wallet-tienda-detalle-orden");
    expect(DETALLE_DESCARGA_MI_WALLET.hoja.ambitoColumnas).toBe("mi-wallet-detalle-orden");
  });

  it("R4: el catálogo de la hoja de movimientos de la caja es el de antes de esta ficha", () => {
    expect(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Motivo y origen",
      "A quién",
      "Entra o sale",
      "Monto",
      "Dueño",
      "Registró",
    ]);
  });
});

describe("464 R44 — los textos nuevos, en español claro y sin «SLA»", () => {
  it("las opciones, los rótulos del selector, la hoja y los textos de estado", () => {
    const SIN = { no_nace_de_un_cierre: "a", snapshot_del_cierre: "b", suma_del_libro_por_tienda: "c", otro_productor: "d" };
    const textos = [
      SELECTOR_DETALLE_DISPARADOR,
      QUE_SE_DESCARGA_LEGEND,
      COLUMNAS_DE_LA_HOJA_LEGEND,
      ...Object.values(DETALLE_POR_ORDEN_TEXTO),
      COLUMNA_NUMERO_MOVIMIENTO.encabezado,
      COLUMNA_DETALLE_POR_ORDEN.encabezado,
      textoDetallePorOrden(conOrdenes("m", [orden(1, "4.00")], "4.00", false), SIN),
      mensajeLimiteDetalle(1, 1),
    ];
    expect(textos).toEqual([
      "Elegir qué se descarga y sus columnas",
      "Hojas del archivo",
      "Columnas de la hoja",
      "Detalle por orden",
      "Movimientos y detalle por orden · dos hojas",
      "Solo los movimientos · una hoja",
      "N.º",
      "Detalle por orden",
      expect.any(String),
      expect.any(String),
    ]);
    for (const t of textos) expect(t).not.toMatch(/\bSLA\b|acuerdo a nivel de servicio/i);
  });
});

describe("464 R39/R44 — el aviso del tope del detalle", () => {
  it("dice las filas del detalle, el tope y qué hacer, en español y sin siglas", () => {
    const m = mensajeLimiteDetalle(6200, 5000);
    expect(m).toBe(
      "El detalle por orden tendría 6200 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
    );
    expect(m).not.toBe(mensajeLimite(6200, 5000));
    expect(m).not.toMatch(/\bSLA\b/);
  });
});
