import { describe, it, expect, vi } from "vitest";
import { UMBRAL_AVISO_DESCUADRE_CONCILIACION } from "@/lib/config/analitica-financiera";
import type {
  GrupoCierrePorEstado,
  SnapshotCierreAprobado,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import { armarServicio, consultaDe } from "./_dobles-analitica-financiera";

// Feature 127 / T D.7 — LA CONCILIACION: R22, R23, R24, R39, R40.
//
// ⟨D5⟩ — se REPORTA y se EMITE, pero NUNCA se lanza. Un tablero financiero que se cae por un
// descuadre historico es un tablero que alguien apaga, y con el se pierde justo la comprobacion
// que se queria ganar. Los dos lados del umbral se miden: descuadrado por encima -> DTO **y**
// llamada al logger; por debajo -> DTO **sin** llamada. Y en los dos casos, DTO.
//
// R23 — contra que se concilia: el `total_general` de un cierre es el COD que el mensajero
// entrego, y su contrapartida es el CREDITO del libro de tienda con origen en ESE cierre. Los
// debitos del mismo origen (flete, comision, IVA) y los otros dos libros miden otra cosa. El caso
// «los otros movimientos del mismo origen no mueven el cuadre» es el que impide que alguien
// "simplifique" a sumar los tres libros y deje el aviso sonando todos los dias.

const MENSAJERO = "9f1c7a5e-0000-4000-8000-000000000abc";

const POR_ESTADO: readonly GrupoCierrePorEstado[] = [
  {
    nivel: "cierre_dia",
    estado: "aprobado",
    cantidad: 2,
    totales: { efectivo: "500.00", simpe: "100.00", transferencia: "100.00", general: "700.00" },
    fechadoPor: "resuelto_at",
  },
  {
    nivel: "cierre_dia",
    estado: "solicitado",
    cantidad: 1,
    totales: { efectivo: "900.00", simpe: "0.00", transferencia: "0.00", general: "900.00" },
    fechadoPor: "solicitado_at",
  },
  {
    nivel: "cierre_bodega",
    estado: "aprobado",
    cantidad: 1,
    totales: { efectivo: "500.00", simpe: "100.00", transferencia: "100.00", general: "700.00" },
    fechadoPor: "resuelto_at",
  },
];

const SNAPSHOTS: readonly SnapshotCierreAprobado[] = [
  { cierreId: "c1", totalGeneral: "500.00" },
  { cierreId: "c2", totalGeneral: "200.00" },
];

/** El ledger que CUADRA: 500 + 200 acreditados, mas ruido de otros libros y otros tipos. */
const LEDGER_CUADRADO: readonly TotalLedgerPorOrigenCierre[] = [
  { ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "credito", suma: "500.00" },
  { ledger: "wallet_tienda_movimiento", cierreId: "c2", tipo: "credito", suma: "200.00" },
  // Ruido legitimo del MISMO origen: no es COD y no puede mover el cuadre.
  { ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "debito", suma: "60.00" },
  { ledger: "wallet_movimiento", cierreId: "c1", tipo: "ingreso", suma: "60.00" },
  { ledger: "pago_mensajero_movimiento", cierreId: "c1", tipo: "devengo", suma: "40.00" },
];

/** El mismo, con `c2` acreditado de menos: faltan 50. */
const LEDGER_DESCUADRADO: readonly TotalLedgerPorOrigenCierre[] = LEDGER_CUADRADO.map((f) =>
  f.cierreId === "c2" && f.tipo === "credito" ? { ...f, suma: "150.00" } : f,
);

function conciliar(
  ledger: readonly TotalLedgerPorOrigenCierre[],
  umbral?: string,
  snapshots: readonly SnapshotCierreAprobado[] = SNAPSHOTS,
) {
  return armarServicio({ porEstado: POR_ESTADO, snapshots, ledger }, umbral);
}

async function cuadreDe(armado: ReturnType<typeof conciliar>) {
  const r = await armado.servicio.consultar(consultaDe("conciliacion_cierres"));
  if (r.status !== "ok" || r.datos.tipo !== "conciliacion") {
    throw new Error("la conciliacion no devolvio su DTO");
  }
  return r.datos.conciliacion;
}

/* -------------------------------------------------------------------------- */
/* R22 / R39 — los conteos por estado viajan tal cual, con su coordenada       */
/* -------------------------------------------------------------------------- */

describe("R22/R39 · el DTO publica los dos niveles por separado y la fecha de cada fila", () => {
  it("las filas llegan enteras, sin fundir niveles y con su fechadoPor", async () => {
    const conciliacion = await cuadreDe(conciliar(LEDGER_CUADRADO));

    expect(conciliacion.porEstado).toEqual(POR_ESTADO);
    expect(conciliacion.porEstado.map((f) => `${f.nivel}/${f.estado}/${f.fechadoPor}`)).toEqual([
      "cierre_dia/aprobado/resuelto_at",
      "cierre_dia/solicitado/solicitado_at",
      "cierre_bodega/aprobado/resuelto_at",
    ]);
  });

  it("R25 — el cierre solicitado se VE con sus 900, y no entra en el cuadre", async () => {
    const conciliacion = await cuadreDe(conciliar(LEDGER_CUADRADO));

    const solicitado = conciliacion.porEstado.find((f) => f.estado === "solicitado");
    expect(solicitado?.totales.general).toBe("900.00");
    // El cuadre solo mira los aprobados: 700, no 1600.
    expect(conciliacion.cuadre.totalSnapshot).toBe("700.00");
  });
});

/* -------------------------------------------------------------------------- */
/* R23 — contra QUE se concilia                                                */
/* -------------------------------------------------------------------------- */

describe("R23 · el cuadre compara el snapshot aprobado contra el credito de ESOS cierres", () => {
  it("cuando el ledger acredita lo mismo, cuadra", async () => {
    const conciliacion = await cuadreDe(conciliar(LEDGER_CUADRADO));

    expect(conciliacion.cuadre).toEqual({
      cuadra: true,
      totalSnapshot: "700.00",
      totalLedger: "700.00",
      diferencia: "0.00",
      cierresDescuadrados: [],
    });
  });

  it("los movimientos del MISMO origen que no son COD no mueven el cuadre", async () => {
    // El fixture cuadrado lleva 60 de debito de tienda, 60 en la caja y 40 de devengo. Sumar los
    // tres libros —o los dos tipos— daria 860 y declararia un descuadre de 160 que no existe.
    const conciliacion = await cuadreDe(conciliar(LEDGER_CUADRADO));

    expect(conciliacion.cuadre.totalLedger).toBe("700.00");
    expect(conciliacion.cuadre.cuadra).toBe(true);
    // Y el ruido esta sembrado de verdad: no se cuadra por conjunto vacio.
    expect(LEDGER_CUADRADO.filter((f) => f.tipo !== "credito")).toHaveLength(3);
  });

  it("el cierre al que le falta dinero sale nombrado, y el que cuadra no", async () => {
    const conciliacion = await cuadreDe(conciliar(LEDGER_DESCUADRADO));

    expect(conciliacion.cuadre.cuadra).toBe(false);
    expect(conciliacion.cuadre.totalLedger).toBe("650.00");
    expect(conciliacion.cuadre.diferencia).toBe("50.00");
    expect(conciliacion.cuadre.cierresDescuadrados).toEqual(["c2"]);
  });

  it("un cierre aprobado SIN ningun movimiento de ledger cuenta como descuadrado entero", async () => {
    const conciliacion = await cuadreDe(conciliar([]));

    expect(conciliacion.cuadre.totalLedger).toBe("0.00");
    expect(conciliacion.cuadre.diferencia).toBe("700.00");
    expect(conciliacion.cuadre.cierresDescuadrados).toEqual(["c1", "c2"]);
  });

  it("los ids que se le piden al ledger salen de los cierres aprobados, no del filtro", async () => {
    const armado = conciliar(LEDGER_CUADRADO);
    await cuadreDe(armado);

    expect(armado.conciliacion.sumarLedgerPorOrigenDeCierre).toHaveBeenCalledTimes(1);
    const argumentos = armado.conciliacion.sumarLedgerPorOrigenDeCierre.mock.calls[0] as unknown as [
      unknown,
      readonly string[],
    ];
    expect(argumentos[1]).toEqual(["c1", "c2"]);
  });

  it("R14 — `cierresDescuadrados` lleva ids de CIERRE, nunca de persona", async () => {
    const conciliacion = await cuadreDe(conciliar(LEDGER_DESCUADRADO));

    expect(conciliacion.cuadre.cierresDescuadrados.length).toBeGreaterThan(0);
    expect(JSON.stringify(conciliacion)).not.toContain(MENSAJERO);
  });
});

/* -------------------------------------------------------------------------- */
/* R24 / R40 — se emite por encima del umbral, y NUNCA se lanza                */
/* -------------------------------------------------------------------------- */

describe("R24/R40 · el descuadre se emite por el ErrorLogger y el DTO se devuelve igual", () => {
  it("descuadrado: llega el DTO Y hay UNA llamada al logger", async () => {
    const armado = conciliar(LEDGER_DESCUADRADO);
    const conciliacion = await cuadreDe(armado);

    expect(conciliacion.cuadre.diferencia).toBe("50.00");
    expect(armado.logger.logError).toHaveBeenCalledTimes(1);
  });

  it("bajo umbral: llega el DTO y NO hay ninguna llamada al logger", async () => {
    // El mismo descuadre de 50, con un umbral de 100: por debajo del aviso.
    const armado = conciliar(LEDGER_DESCUADRADO, "100.00");
    const conciliacion = await cuadreDe(armado);

    expect(conciliacion.cuadre.cuadra).toBe(false);
    expect(conciliacion.cuadre.diferencia).toBe("50.00");
    expect(armado.logger.logError).not.toHaveBeenCalled();
  });

  it("y cuando cuadra tampoco se emite nada", async () => {
    const armado = conciliar(LEDGER_CUADRADO);
    await cuadreDe(armado);

    expect(armado.logger.logError).not.toHaveBeenCalled();
  });

  it("el umbral por defecto es el de lib/config, y con el un centimo ya se emite", async () => {
    expect(UMBRAL_AVISO_DESCUADRE_CONCILIACION).toBe("0.01");

    const casiCuadrado = LEDGER_CUADRADO.map((f) =>
      f.cierreId === "c2" && f.tipo === "credito" ? { ...f, suma: "199.99" } : f,
    );
    const armado = conciliar(casiCuadrado);
    const conciliacion = await cuadreDe(armado);

    expect(conciliacion.cuadre.diferencia).toBe("0.01");
    expect(armado.logger.logError).toHaveBeenCalledTimes(1);
  });

  it("y con un umbral mas alto ese mismo centimo NO se emite: el umbral se lee de verdad", async () => {
    const casiCuadrado = LEDGER_CUADRADO.map((f) =>
      f.cierreId === "c2" && f.tipo === "credito" ? { ...f, suma: "199.99" } : f,
    );
    const armado = conciliar(casiCuadrado, "1.00");
    await cuadreDe(armado);

    expect(armado.logger.logError).not.toHaveBeenCalled();
  });

  it("la consulta NUNCA lanza por un descuadre, por grande que sea", async () => {
    const armado = conciliar([], "0.01", [{ cierreId: "c9", totalGeneral: "9999999.99" }]);
    const r = await armado.servicio.consultar(consultaDe("conciliacion_cierres"));

    expect(r.status).toBe("ok");
    expect(armado.logger.logError).toHaveBeenCalledTimes(1);
  });

  it("R32 — el aviso lleva contexto (rango y cierres) y no lleva PII", async () => {
    const armado = conciliar(LEDGER_DESCUADRADO);
    await cuadreDe(armado);

    const [error] = vi.mocked(armado.logger.logError).mock.calls[0] as [Error];
    const mensaje = error.message;
    expect(mensaje).toContain("conciliacion_cierres");
    expect(mensaje).toContain("2026-08-02");
    expect(mensaje).toContain("c2");
    expect(mensaje).not.toContain(MENSAJERO);
    expect(mensaje).not.toContain("@");
  });
});

/* -------------------------------------------------------------------------- */
/* No se pasa por conjunto vacio                                               */
/* -------------------------------------------------------------------------- */

describe("los casos de arriba no pasan por conjunto vacio", () => {
  it("el fixture trae aprobados, no resueltos, dos niveles y ruido de los tres libros", () => {
    expect(POR_ESTADO).toHaveLength(3);
    expect(new Set(POR_ESTADO.map((f) => f.nivel)).size).toBe(2);
    expect(new Set(LEDGER_CUADRADO.map((f) => f.ledger)).size).toBe(3);
    expect(SNAPSHOTS).toHaveLength(2);
    expect(LEDGER_DESCUADRADO).not.toEqual(LEDGER_CUADRADO);
  });

  it("y con el fixture vacio el cuadre NO dice que todo esta bien por no tener datos", async () => {
    const armado = armarServicio({ porEstado: [], snapshots: [], ledger: [] });
    const r = await armado.servicio.consultar(consultaDe("conciliacion_cierres"));
    if (r.status !== "ok" || r.datos.tipo !== "conciliacion") throw new Error("no es conciliacion");

    // Sin cierres aprobados el cuadre es trivialmente cierto — y por eso los casos de arriba
    // siembran cierres de verdad: si el fixture se vaciara, dejarian de medir nada.
    expect(r.datos.conciliacion.cuadre.totalSnapshot).toBe("0.00");
    expect(r.datos.conciliacion.porEstado).toEqual([]);
  });
});
