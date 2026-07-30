import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WITH_DETALLE, toPendienteRow } from "@/lib/repositories/CierreDiaRepository";
import {
  GESTION_ADMIN_SELECT,
  toPendienteRowDesdeSnapshot,
} from "@/lib/repositories/CierresAdminRepository";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";

// Feature 158 (R34/R9/R19) — la CAUSA del incidente y el MONTO de la indemnización recorren la
// cadena completa hasta el DTO que ve el cliente: proyección del repo → fila de dominio →
// `toDetalleDTO`.
//
// Por qué este archivo existe: R34 exige que la pantalla de aprobación muestre, por incidente,
// la orden **y su causa**. Sin estos dos campos el admin decide el monto de una indemnización
// sin saber si el paquete se rompió o se lo robaron. Los tests de componente no pueden
// protegerlo: comprueban lo que se pinta con el dato que les pasan, no que el dato LLEGUE.
//
// LA ASIMETRÍA DELIBERADA que se fija aquí (design §7.2, R17): el detalle de ADMIN lleva el
// monto; la vista EN VIVO del MENSAJERO **no**, y no por casualidad de que allí las gestiones
// tengan `cierre_id IS NULL`, sino porque la columna **no se selecciona** en su consulta. La
// indemnización es plata que Ordenex paga por el paquete, no del mensajero, y un número grande
// junto a su gestión se leería como una deuda suya.

// --- Dobles de las dos proyecciones -------------------------------------------------------

/** Fila tal como la lee `WITH_DETALLE` (vista EN VIVO del mensajero). */
function filaEnVivo(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "incidente" as const,
    montoRecibido: null,
    metodoPago: null,
    motivo: "la caja llegó aplastada",
    fechaReprogramacion: null,
    evidenciaStoragePath: "o1/incidente-1-0.jpg",
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    causaIncidente: "danado" as const,
    orden: {
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tienda: { nombre: "Tienda X" },
      zona: { nombre: "Cartago" },
      provincia: { nombre: "Cartago" },
      canton: { nombre: "Central" },
      distrito: { nombre: "Oriental" },
    },
    ...over,
  };
}

/** Fila de gestión tal como la lee `GESTION_ADMIN_SELECT` (detalles de ADMIN, 38/40). */
function filaAdmin(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "incidente" as const,
    montoRecibido: null,
    metodoPago: null,
    motivo: "la caja llegó aplastada",
    fechaReprogramacion: null,
    evidenciaStoragePath: "o1/incidente-1-0.jpg",
    pagoMensajero: new Prisma.Decimal("0.00"),
    ingresoBodegaRechazo: new Prisma.Decimal("0.00"),
    causaIncidente: "danado" as const,
    indemnizacion: new Prisma.Decimal("12500.75"),
    historialEstados: [],
    ...over,
  };
}

/** Fila CONGELADA de `cierre_detail` (lo que aporta la orden). Sin tarifa: gap R9 de la 69. */
function filaSnapshot(over: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    montoCobrar: null,
    cobraComision: false,
    esCentral: false,
    tarifaId: null,
    tarifaValorFlete: null,
    tarifaValorFleteGam: null,
    tarifaValorFleteDevuelto: null,
    tarifaValorFleteDevueltoGam: null,
    tarifaComisionCod: null,
    tarifaIvaFlete: null,
    tarifaIvaComisionCod: null,
    ...over,
  };
}

const mapAdmin = (g = filaAdmin(), d = filaSnapshot()): CierreGestionPendienteRow =>
  toPendienteRowDesdeSnapshot(
    g as unknown as Parameters<typeof toPendienteRowDesdeSnapshot>[0],
    d as unknown as Parameters<typeof toPendienteRowDesdeSnapshot>[1],
  );

const mapEnVivo = (row = filaEnVivo()): CierreGestionPendienteRow =>
  toPendienteRow(row as unknown as Parameters<typeof toPendienteRow>[0]);

// --- Proyecciones ------------------------------------------------------------------------

describe("R34 — el detalle de ADMIN PIDE la causa y el monto", () => {
  it("`GESTION_ADMIN_SELECT` selecciona las dos columnas", () => {
    expect(GESTION_ADMIN_SELECT.causaIncidente).toBe(true);
    expect(GESTION_ADMIN_SELECT.indemnizacion).toBe(true);
  });
});

describe("R17 / design §7.2 — la vista del MENSAJERO pide la causa pero NO el monto", () => {
  it("`WITH_DETALLE` selecciona la causa", () => {
    expect(WITH_DETALLE.select.causaIncidente).toBe(true);
  });

  it("`WITH_DETALLE` NO selecciona `indemnizacion` (la decisión vive en la CONSULTA)", () => {
    // Dejarla fuera del `select` es más fuerte que ocultarla en la pantalla: no hay dato que
    // filtrar aguas abajo, así que un cambio de UI no la puede exponer sin que alguien venga
    // aquí a añadirla a propósito.
    expect(WITH_DETALLE.select).not.toHaveProperty("indemnizacion");
  });
});

// --- Mappers -----------------------------------------------------------------------------

describe("R9/R19 — el mapper del ADMIN propaga causa y monto", () => {
  it("la causa viaja tal cual y el monto como STRING escala 2 (money-safe)", () => {
    const row = mapAdmin();
    expect(row.causaIncidente).toBe("danado");
    expect(row.indemnizacion).toBe("12500.75");
    expect(typeof row.indemnizacion).toBe("string");
  });

  it("R24: el monto NUNCA cruza como number", () => {
    const row = mapAdmin(filaAdmin({ indemnizacion: new Prisma.Decimal("0.10") }));
    expect(row.indemnizacion).toBe("0.10"); // 0.1 en float sería 0.1, aquí es escala 2 fija
    expect(typeof row.indemnizacion).not.toBe("number");
  });

  it("un `incidente` cuyo cierre AÚN NO se aprobó llega con monto `null`, no con 0.00", () => {
    // `null` = «todavía no hay monto»; "0.00" sería «se indemnizó con cero», que es otra cosa.
    const row = mapAdmin(filaAdmin({ indemnizacion: null }));
    expect(row.indemnizacion).toBeNull();
    expect(row.causaIncidente).toBe("danado"); // la causa SÍ existe desde el reporte
  });
});

describe("R17 — el mapper de la vista EN VIVO propaga la causa y anula el monto", () => {
  it("la causa llega (es el hecho que el propio mensajero reportó)", () => {
    expect(mapEnVivo().causaIncidente).toBe("danado");
  });

  it("el monto es SIEMPRE `null` en la vista del mensajero", () => {
    expect(mapEnVivo().indemnizacion).toBeNull();
  });

  it("aunque la fila trajera un monto, el mapper del mensajero NO lo propaga", () => {
    // Blindaje contra el futuro: si alguien añadiera `indemnizacion` al `select` sin pensar,
    // este caso sigue exigiendo que no llegue a la vista del mensajero.
    const row = mapEnVivo(filaEnVivo({ indemnizacion: new Prisma.Decimal("99999.99") }));
    expect(row.indemnizacion).toBeNull();
  });
});

// --- Hasta el DTO ------------------------------------------------------------------------

describe("R34 — `toDetalleDTO` (reusado por CierresAdminService, 38) los deja en el DTO", () => {
  it("el DTO del admin lleva causa y monto", () => {
    const dto = toDetalleDTO(mapAdmin(), {});
    expect(dto.causaIncidente).toBe("danado");
    expect(dto.indemnizacion).toBe("12500.75");
  });

  it("el DTO de la vista en vivo lleva causa y monto `null`", () => {
    const dto = toDetalleDTO(mapEnVivo(), {}, "0.00", "0.00");
    expect(dto.causaIncidente).toBe("danado");
    expect(dto.indemnizacion).toBeNull();
  });

  it("el mapper NO inventa ni normaliza: pasa lo que el repo le dio", () => {
    const dto = toDetalleDTO(
      mapAdmin(filaAdmin({ causaIncidente: "robado", indemnizacion: new Prisma.Decimal("1.5") })),
      {},
    );
    expect(dto.causaIncidente).toBe("robado");
    expect(dto.indemnizacion).toBe("1.50"); // escala 2 fija, la pone el repo
  });
});

// --- No regresión (R35/R36) --------------------------------------------------------------

describe("R35 — los CUATRO resultados previos no cambian: causa y monto en `null`", () => {
  it.each(["entregada", "reprogramada", "devuelta", "rechazada"] as const)(
    "una gestión `%s` del detalle de admin llega con los dos campos en null",
    (resultado) => {
      const row = mapAdmin(filaAdmin({ resultado, causaIncidente: null, indemnizacion: null }));
      expect(row.causaIncidente).toBeNull();
      expect(row.indemnizacion).toBeNull();
      // Y lo suyo sigue intacto.
      expect(row.resultado).toBe(resultado);
      expect(row.pagoMensajero).toBe("0.00");
      expect(row.ingresoBodegaRechazo).toBe("0.00");
    },
  );

  it.each(["entregada", "reprogramada", "devuelta", "rechazada"] as const)(
    "una gestión `%s` de la vista en vivo llega con los dos campos en null",
    (resultado) => {
      const row = mapEnVivo(filaEnVivo({ resultado, causaIncidente: null }));
      expect(row.causaIncidente).toBeNull();
      expect(row.indemnizacion).toBeNull();
      expect(row.resultado).toBe(resultado);
    },
  );

  it("R35: el resto del DTO de una entrega es EXACTAMENTE el de antes de la 158", () => {
    const dto = toDetalleDTO(
      mapAdmin(
        filaAdmin({
          resultado: "entregada",
          montoRecibido: new Prisma.Decimal("12.50"),
          metodoPago: "efectivo",
          motivo: null,
          causaIncidente: null,
          indemnizacion: null,
          pagoMensajero: new Prisma.Decimal("5.00"),
        }),
      ),
      {},
    );
    expect(dto).toMatchObject({
      resultado: "entregada",
      montoRecibido: "12.50",
      metodoPago: "efectivo",
      motivo: null,
      pagoMensajero: "5.00",
      ingresoBodegaRechazo: "0.00",
      esRechazoSla: false,
      causaIncidente: null,
      indemnizacion: null,
    });
  });
});
