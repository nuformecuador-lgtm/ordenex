import { describe, it, expect } from "vitest";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import { derivarIngresoBodega } from "@/lib/utils/cierre-totales";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";
import { conPagos } from "@/tests/fixtures/cierre-pagos";

// Feature 99 (T15) [💰] — cierra el CIRCULO del dinero de la Option A SIN codigo monetario nuevo.
// La gestion sintetica `rechazada` (cierre_id null) que crea `DevolucionSlaRepository.escalarDevueltaSla`
// es exactamente la que `CierreDiaService.crearCierre` recorre via `derivarIngresoBodega` para
// snapshotear `ingreso_bodega_rechazo`. Este test usa las funciones REALES del snapshot (56) sobre
// una gestion construida IGUAL que la sintetica: prueba que el ingreso se cobra una vez, con la
// misma aritmetica money-safe (Prisma.Decimal, salida STRING escala 2), y que una `devuelta` no
// escalada sigue en 0.00. R20/R22/R23.

const TARIFA: PagoTarifa = { cobroEntregado: "1500.00", cobroRechazado: "800.00" };

// Fila de gestion como la lee `findGestionesPendientes` (cierre_id null -> entra al proximo cierre).
function gestion(overrides: Partial<CierreGestionPendienteRow>): CierreGestionPendienteRow {
  // Feature 212/T9: el desglose es OBLIGATORIO en la fila. Por defecto se deriva del par
  // escalar (UNA linea, igual que el backfill), asi que los casos previos no cambian; un
  // caso que quiera un cobro MIXTO pasa sus propias lineas en `overrides.pagos`.
  const { pagos, ...resto } = overrides;
  const fila: Omit<CierreGestionPendienteRow, "pagos"> = {
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
    resultado: "rechazada",
    montoRecibido: null,
    metodoPago: null,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false, // feature 102
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    // Feature 158/R9/R19: campos POR RAMA del incidente. `null` por defecto en el resto
    // de resultados; los casos del incidente los sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...resto,
  };
  return conPagos(fila, pagos);
}

describe("Feature 99 [💰] · el snapshot de la 56 cobra la gestion sintetica del escalado SLA (R20/R22/R23)", () => {
  it("la gestion sintetica `rechazada` (escalado SLA) snapshotea cobroRechazado; la `devuelta` sigue en 0.00", () => {
    // Escenario del mensajero atribuido: una devolucion previa (intento) + la gestion sintetica
    // del escalado, ambas con cierre_id null, listas para el proximo cierre.
    const gestiones: CierreGestionPendienteRow[] = [
      gestion({ gestionId: "g-devuelta", resultado: "devuelta", motivo: "ausente" }),
      gestion({ gestionId: "g-sla", resultado: "rechazada", motivo: "escalado SLA not_found" }),
    ];

    const { ingresoByGestionId, total } = derivarIngresoBodega(gestiones, TARIFA);

    // R20: el escalado por SLA cobra el ingreso de bodega por rechazo, IDENTICO a un rechazo directo.
    expect(ingresoByGestionId["g-sla"]).toBe("800.00");
    // La devolucion previa (intento) NO genera ingreso: sigue en 0.00 (solo `rechazada` cobra).
    expect(ingresoByGestionId["g-devuelta"]).toBe("0.00");
    // R23: total money-safe, STRING escala 2, exactamente el cobroRechazado una sola vez.
    expect(total).toBe("800.00");
  });

  it("R20: la sintetica del escalado produce EXACTAMENTE el mismo ingreso que un rechazo directo", () => {
    const directo = ingresoBodegaPorResultado("rechazada", TARIFA);
    const sintetica = ingresoBodegaPorResultado("rechazada", TARIFA); // misma funcion, mismo resultado
    expect(sintetica).toBe(directo);
    expect(sintetica).toBe("800.00");
    // La `devuelta` que anclo la ventana NO cobra (por eso la 47 dejaba 0.00 en el escalado).
    expect(ingresoBodegaPorResultado("devuelta", TARIFA)).toBe("0.00");
  });

  it("R21: dos gestiones sinteticas (p. ej. si el cron corriera dos veces MAL) cobrarian dos veces —", () => {
    // Este test documenta POR QUE la idempotencia vive en el repo (updateMany guardado por estado):
    // el snapshot cobra CADA `rechazada` que ve. Si el repo creara dos gestiones sinteticas, el
    // snapshot cobraria doble. La guarda por `estatus_id = devuelta` garantiza UNA sola gestion
    // (verificado en devolucion-sla-repository.test.ts), por eso el circulo cobra exactamente una vez.
    const dos: CierreGestionPendienteRow[] = [
      gestion({ gestionId: "g-sla-1", resultado: "rechazada" }),
      gestion({ gestionId: "g-sla-2", resultado: "rechazada" }),
    ];
    const { total } = derivarIngresoBodega(dos, TARIFA);
    expect(total).toBe("1600.00"); // 2 x 800 — el snapshot no deduplica; la idempotencia es del repo
  });

  it("R23: sin tarifa (gap de datos) el ingreso es 0.00 sin lanzar (money-safe)", () => {
    const { ingresoByGestionId, total } = derivarIngresoBodega(
      [gestion({ gestionId: "g-sla", resultado: "rechazada" })],
      null,
    );
    expect(ingresoByGestionId["g-sla"]).toBe("0.00");
    expect(total).toBe("0.00");
  });
});
