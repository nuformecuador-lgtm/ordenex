import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
  COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
  COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
  COLUMNAS_DESCARGA_CONSOLIDABLES,
  filaDescargaBodegaPendiente,
  filaDescargaBodegaResuelto,
  filaDescargaBodegaSolicitado,
  filaDescargaConsolidable,
} from "@/app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
} from "@/lib/interfaces/services/ICierreBodegaService";

// Feature 189 — ORDEN y CENSO de las columnas de los archivos descargables de las CUATRO
// tablas de cierre de bodega (feature 170, T E.2 y T E.3 / R5).
//
// Las cuatro se prueban una por una y NO con un `describe.each` compartido: precisamente lo
// que se fija es que sus juegos de columnas son DISTINTOS (la cola no tiene estado ni motivo,
// el histórico del maestro sí, y el del adminSatelite enseña la fecha de SOLICITUD). Un
// esperado común las volvería intercambiables, que es el error que este archivo caza.
//
// Los valores esperados se escriben A MANO, nunca derivados de la constante.
//
// Feature 393 (C3/C4, R21/R22, D7) — los TRES listados de cierre de bodega ganan «Para la
// central» AL FINAL, sin mover ninguna columna existente: quien lea el archivo por posicion no
// se rompe. El cuarto —los `cierre_dia` CONSOLIDABLES— NO la gana, y esa ausencia se afirma:
// ahi no hay cierre de bodega todavia y el numero no tiene sujeto.
//
// La ampliacion de estas aserciones de orden es una de las ediciones DECLARADAS de la ficha, y
// se hace anadiendo el elemento al esperado —no relajando el `toEqual` a un `toMatchObject`—:
// el listado que un usuario descarga es contrato, y aflojar la asercion para que pase seria
// exactamente el poliZon que este archivo existe para cazar.

describe("orden de las columnas de descarga de los cierres de bodega", () => {
  it("la COLA de pendientes del maestro declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_PENDIENTES.map((c) => c.clave)).toEqual([
      "zona",
      "solicito",
      "fecha",
      "cierresDelDia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "paraLaCentral", // feature 393/R22: la ultima
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_PENDIENTES.map((c) => c.encabezado)).toEqual([
      "Zona",
      "Solicitó",
      "Fecha",
      "Cierres del día",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Para la central",
    ]);
  });

  it("el HISTÓRICO de resueltos declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_RESUELTOS.map((c) => c.clave)).toEqual([
      "estado",
      "zona",
      "solicito",
      "fechaResuelta",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "motivo",
      "paraLaCentral", // feature 393/R22: la ultima
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_RESUELTOS.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Zona",
      "Solicitó",
      "Fecha resuelta",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Motivo",
      "Para la central",
    ]);
  });

  it("los cierres del día A CONSOLIDAR declaran sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_CONSOLIDABLES.map((c) => c.clave)).toEqual([
      "mensajero",
      "efectivo",
      "simpe",
      "transferencia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
    ]);
    expect(COLUMNAS_DESCARGA_CONSOLIDABLES.map((c) => c.encabezado)).toEqual([
      "Mensajero",
      "Efectivo",
      "SINPE",
      "Transferencia",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
    ]);
  });

  it("los cierres de bodega YA SOLICITADOS declaran sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_BODEGA_SOLICITADOS.map((c) => c.clave)).toEqual([
      "estado",
      "fechaSolicitud",
      "cierresDelDia",
      "general",
      "pagoMensajero",
      "ingresoBodega",
      "motivo",
      "paraLaCentral", // feature 393/R22: la ultima
    ]);
    expect(COLUMNAS_DESCARGA_BODEGA_SOLICITADOS.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Fecha solicitud",
      "Cierres del día",
      "Total general",
      "Pago mensajero",
      "Ingreso bodega",
      "Motivo",
      "Para la central",
    ]);
  });
});

/**
 * Feature 393 (C4, R21/R22) — «Para la central» en el ARCHIVO: el mismo valor que la tarjeta,
 * LEIDO DEL DTO y sin recalcular.
 *
 * El motivo de que vaya al archivo es de uso, no de completitud: la persona usa ese numero
 * para CUADRAR CON LA CENTRAL, y cuadrar se hace en una hoja. Y el motivo de que la proyeccion
 * LEA el campo en vez de restarlo es que una segunda formula acaba diciendo algo distinto de
 * la pantalla — que es justo el defecto que la ficha 393 vino a arreglar.
 */
describe("feature 393 — «Para la central» en el archivo de los cierres de bodega", () => {
  // Un cierre con CENTIMOS y con `paraLaCentral` deliberadamente DISTINTO de la resta de sus
  // propios totales: si la proyeccion recalculara en vez de leer el DTO, se notaria aqui.
  const CIERRE: CierreBodegaResumen = {
    cierreBodegaId: "cb-1",
    zonaId: "z-1",
    zonaNombre: "Cartago",
    solicitadoPorId: "u-sat",
    solicitadoPorNombre: "Sara Satélite",
    estado: "aprobado",
    totales: {
      efectivo: "100000.55",
      simpe: "5000.10",
      transferencia: "1088.52",
      general: "106089.17",
    },
    totalPagoMensajero: "14001.00",
    totalIngresoBodegaRechazos: "1250.45",
    cantidadCierres: 2,
    solicitadoAt: "2026-09-01T10:00:00.000Z",
    resueltoAt: "2026-09-02T10:00:00.000Z",
    motivoRechazo: null,
    // El valor que el SERVIDOR derivo. Se pone un canario que NO es la resta de los tres de
    // arriba a proposito: la fila del archivo tiene que traer ESTE, no uno recalculado.
    paraLaCentral: "77777.77",
    efectivoCubreDescuentos: false,
  };

  const CONSOLIDABLE: CierreBodegaResumenLite = {
    cierreDiaId: "cd-1",
    mensajeroId: "m-1",
    mensajeroNombre: "Ana Mensajera",
    totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
    totalPagoMensajero: "1.00",
    totalIngresoBodegaRechazos: "0.00",
  };

  it("los TRES listados de cierre de bodega llevan el valor del DTO, sin recalcularlo (R22)", () => {
    for (const fila of [
      filaDescargaBodegaPendiente(CIERRE),
      filaDescargaBodegaResuelto(CIERRE),
      filaDescargaBodegaSolicitado(CIERRE),
    ]) {
      expect(fila.paraLaCentral).toBe("77777.77");
      // Y no la resta de los totales de la propia fila, que es lo que saldria de recalcular.
      expect(fila.paraLaCentral).not.toBe("90837.72");
    }
  });

  it("el valor viaja como el STRING del DTO, sin simbolo de colon y sin coma flotante (R12/R14)", () => {
    const fila = filaDescargaBodegaResuelto(CIERRE);
    expect(typeof fila.paraLaCentral).toBe("string");
    expect(fila.paraLaCentral).toMatch(/^-?\d+\.\d{2}$/);
    expect(String(fila.paraLaCentral)).not.toContain("₡");
  });

  it("un «Para la central» NEGATIVO llega al archivo con su signo (R36)", () => {
    // Medido contra produccion el 2026-09-08: 1 de 14 cierres de bodega. Recortarlo a cero en
    // la hoja diria «no hay que entregar nada» y omitiria que la central pone la diferencia.
    const fila = filaDescargaBodegaSolicitado({ ...CIERRE, paraLaCentral: "-1000.05" });
    expect(fila.paraLaCentral).toBe("-1000.05");
  });

  it("`efectivoCubreDescuentos` NO va al archivo: es un aviso, no una cifra", () => {
    // Una columna booleana en una hoja de dinero se acaba sumando.
    for (const columnas of [
      COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
      COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
      COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
    ]) {
      expect(columnas.map((c) => c.clave)).not.toContain("efectivoCubreDescuentos");
    }
    for (const fila of [
      filaDescargaBodegaPendiente(CIERRE),
      filaDescargaBodegaResuelto(CIERRE),
      filaDescargaBodegaSolicitado(CIERRE),
    ]) {
      expect(fila).not.toHaveProperty("efectivoCubreDescuentos");
    }
  });

  it("el listado de CONSOLIDABLES no gana la columna ni el dato (R21)", () => {
    // Ahi no hay cierre de bodega todavia: el numero no tiene sujeto, y `CierreBodegaResumenLite`
    // ni siquiera lo lleva.
    expect(COLUMNAS_DESCARGA_CONSOLIDABLES.map((c) => c.clave)).not.toContain("paraLaCentral");
    expect(filaDescargaConsolidable(CONSOLIDABLE)).not.toHaveProperty("paraLaCentral");
  });

  it("cada fila trae una celda por cada columna declarada, y ninguna de mas", () => {
    // Autocomprobacion del par (columnas, proyeccion): una columna sin celda sale vacia en la
    // hoja sin que nada se ponga rojo, y una celda sin columna es dinero que se calcula y se
    // tira. Aqui las dos mitades se comparan entre si.
    const pares = [
      [COLUMNAS_DESCARGA_BODEGA_PENDIENTES, filaDescargaBodegaPendiente(CIERRE)],
      [COLUMNAS_DESCARGA_BODEGA_RESUELTOS, filaDescargaBodegaResuelto(CIERRE)],
      [COLUMNAS_DESCARGA_BODEGA_SOLICITADOS, filaDescargaBodegaSolicitado(CIERRE)],
      [COLUMNAS_DESCARGA_CONSOLIDABLES, filaDescargaConsolidable(CONSOLIDABLE)],
    ] as const;
    expect(pares).toHaveLength(4);
    for (const [columnas, fila] of pares) {
      expect(Object.keys(fila).sort()).toEqual(columnas.map((c) => c.clave).sort());
    }
  });
});
