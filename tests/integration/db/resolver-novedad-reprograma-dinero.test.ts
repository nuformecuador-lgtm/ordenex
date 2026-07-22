import { describe, it, expect } from "vitest";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import { derivarPagos, derivarIngresoBodega, computeTotales } from "@/lib/utils/cierre-totales";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import {
  agregarIngresosPorConcepto,
  derivarIngresoOrden,
} from "@/lib/utils/ingreso-ordenex";

// Feature 100 (T5.3) [💰] — money-critical: la gestion sintetica `reprogramada` que crea la
// reprogramacion de la tienda (`GestionOrdenRepository.reprogramarDesdeDevuelta`, `cierre_id null`,
// R10) es MONEY-NEUTRAL: aporta $0.00 al cierre y NO genera movimiento de wallet. La prueba usa las
// funciones REALES del snapshot del cierre (37/39/56 = pago mensajero, ingreso bodega, COD) y del
// feed de wallet (42/69 = `derivarIngresoOrden`/`agregarIngresosPorConcepto`) sobre una gestion
// construida IGUAL que la sintetica, y verifica que "cerrar un dia" con esa gestion deja TODOS los
// totales identicos a cerrarlo sin ella. Mismo patron que `devolucion-sla-dinero.test.ts` (99).
// NO requiere Postgres (funciones puras money-safe: Prisma.Decimal, salida STRING escala 2).

// Tarifas realistas: si algun concepto de la reprogramada NO fuera 0.00, estos numeros lo delatarian.
const TARIFA_MENSAJERO: PagoTarifa = { cobroEntregado: "1500.00", cobroRechazado: "800.00" };
const TARIFA_ORDENEX: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

// Fila de gestion como la lee `findGestionesPendientes` (cierre_id null -> entra al proximo cierre).
function gestion(overrides: Partial<CierreGestionPendienteRow>): CierreGestionPendienteRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1,
    numRemision: "R-1",
    destinatario: "Ana",
    direccion: "calle",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    producto: "caja",
    tiendaNombre: "T",
    resultado: "entregada",
    montoRecibido: null,
    metodoPago: null,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false, // feature 102
    ...overrides,
  };
}

// La gestion sintetica de reprogramacion EXACTAMENTE como la persiste el repo (T1.2):
// resultado=reprogramada, con fecha, SIN montoRecibido/metodoPago (no hubo recaudo).
const GESTION_REPROGRAMADA_SINTETICA = gestion({
  gestionId: "g-reprogramada",
  resultado: "reprogramada",
  fechaReprogramacion: "2026-07-25", // ISO date (YYYY-MM-DD), como lo lee el snapshot del cierre
  motivo: "cliente pidio otra fecha",
});

describe("Feature 100 [💰] T5.3 — la gestion sintetica `reprogramada` aporta $0.00 por concepto (R10)", () => {
  it("pago al mensajero: reprogramada -> 0.00 (solo `entregada` paga)", () => {
    expect(pagoPorResultado("reprogramada", TARIFA_MENSAJERO)).toBe("0.00");
  });

  it("ingreso de bodega por rechazo: reprogramada -> 0.00 (solo `rechazada` cobra)", () => {
    // El hint literal de la tarea: ingresoBodegaPorResultado("reprogramada", ...) -> "0.00".
    expect(ingresoBodegaPorResultado("reprogramada", TARIFA_MENSAJERO)).toBe("0.00");
  });

  it("ingreso de Ordenex (feed de wallet 42/69): reprogramada NO aporta a ningun concepto -> 0 movimientos", () => {
    // derivarIngresoOrden devuelve {} para reprogramada (u otro en transito): ningun concepto.
    const derivado = derivarIngresoOrden(
      { resultado: "reprogramada", esCentral: false, montoCobrar: "10000.00", cobraComision: true },
      TARIFA_ORDENEX,
    );
    expect(derivado).toEqual({});
    // Y el agregado que emite los movimientos de wallet OMITE los conceptos 0.00 (R10): 0 movimientos.
    const movimientos = agregarIngresosPorConcepto([
      { input: { resultado: "reprogramada", esCentral: false, montoCobrar: "10000.00", cobraComision: true }, tarifa: TARIFA_ORDENEX },
    ]);
    expect(movimientos).toEqual([]);
  });

  it("COD recaudado: una reprogramada (montoRecibido null) no suma efectivo/SIMPE/transferencia", () => {
    const totales = computeTotales([GESTION_REPROGRAMADA_SINTETICA]);
    expect(totales).toEqual({
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    });
  });
});

describe("Feature 100 [💰] T5.3 — cerrar un dia CON la reprogramada da los MISMOS totales que sin ella (money-neutral)", () => {
  // Un dia real del mensajero atribuido: 1 entregada (con COD) + 1 rechazada + la reprogramada
  // sintetica. La reprogramada NO debe mover ninguno de los totales del cierre.
  const diaSinReprogramada: CierreGestionPendienteRow[] = [
    gestion({
      gestionId: "g-entregada",
      resultado: "entregada",
      montoRecibido: "10000.00",
      metodoPago: "efectivo",
    }),
    gestion({ gestionId: "g-rechazada", resultado: "rechazada", motivo: "rechazo" }),
  ];
  const diaConReprogramada: CierreGestionPendienteRow[] = [
    ...diaSinReprogramada,
    GESTION_REPROGRAMADA_SINTETICA,
  ];

  it("pago total al mensajero no cambia", () => {
    const sin = derivarPagos(diaSinReprogramada, TARIFA_MENSAJERO);
    const con = derivarPagos(diaConReprogramada, TARIFA_MENSAJERO);
    expect(con.total).toBe(sin.total);
    expect(con.total).toBe("1500.00"); // solo la entregada paga
    // La linea de la reprogramada existe en el desglose pero en 0.00 (no aporta al total).
    expect(con.pagoByGestionId["g-reprogramada"]).toBe("0.00");
  });

  it("ingreso total de bodega por rechazo no cambia", () => {
    const sin = derivarIngresoBodega(diaSinReprogramada, TARIFA_MENSAJERO);
    const con = derivarIngresoBodega(diaConReprogramada, TARIFA_MENSAJERO);
    expect(con.total).toBe(sin.total);
    expect(con.total).toBe("800.00"); // solo la rechazada cobra
    expect(con.ingresoByGestionId["g-reprogramada"]).toBe("0.00");
  });

  it("COD recaudado (efectivo/SIMPE/transferencia/general) no cambia", () => {
    const sin = computeTotales(diaSinReprogramada);
    const con = computeTotales(diaConReprogramada);
    expect(con).toEqual(sin);
    expect(con.general).toBe("10000.00"); // solo la entregada aporta COD
  });

  it("los movimientos de wallet de INGRESO del cierre no cambian (la reprogramada no emite ninguno)", () => {
    const toInput = (g: CierreGestionPendienteRow) => ({
      input: {
        resultado: g.resultado,
        esCentral: false,
        montoCobrar: "10000.00",
        cobraComision: true,
      },
      tarifa: TARIFA_ORDENEX,
    });
    const sin = agregarIngresosPorConcepto(diaSinReprogramada.map(toInput));
    const con = agregarIngresosPorConcepto(diaConReprogramada.map(toInput));
    // Mismos conceptos y montos: la reprogramada no agrega ni altera ninguna categoria.
    expect(con).toEqual(sin);
  });
});
