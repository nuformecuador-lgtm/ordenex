import { describe, it, expect } from "vitest";

import { marcaRecibida, marcaSinConciliar } from "@/tests/fixtures/marca-conciliacion";
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
      // ⭑ FICHA 431/R24: las DOS de la marca, detras de «Para la central» y sin mover ninguna.
      "montoRecibido",
      "faltaPorRecibir",
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
      "Monto recibido",
      "Falta por recibir",
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
      "montoRecibido", // ⭑ ficha 431/R24
      "faltaPorRecibir",
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
      "Monto recibido",
      "Falta por recibir",
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
      // ⭑ FICHA 431/R24/R26: la satélite descarga lo MISMO que ve. Sin estas dos, su archivo no
      // llevaría la diferencia que su pantalla sí enseña.
      "montoRecibido",
      "faltaPorRecibir",
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
      "Monto recibido",
      "Falta por recibir",
    ]);
  });
});

/**
 * ⭑ FICHA 431 (T17, R24/R26/R28) — LA MARCA EN EL ARCHIVO.
 *
 * Dos afirmaciones, y las dos son de dinero:
 *
 *  1. El ESTADO sale con el vocabulario de la CONCILIACIÓN y no con el del enum. Es lo que
 *     hace que la hoja y la pantalla digan lo mismo, y es donde se ve que «Rechazado» dejó de
 *     escribirse (R16).
 *  2. `faltaPorRecibir` LLEGA DEL DTO y no se recalcula aquí. Es el mismo criterio que la 393
 *     impuso para «Para la central», y por el mismo motivo: una segunda fórmula acaba diciendo
 *     algo distinto de la tarjeta.
 */
describe("⭑ ficha 431 — la marca de conciliación en el archivo de los cierres de bodega", () => {
  /** Una consolidación RECIBIDA POR MENOS: el caso entero de la ficha, con céntimos. */
  const INCOMPLETA: CierreBodegaResumen = {
    cierreBodegaId: "cb-2",
    zonaId: "z-1",
    zonaNombre: "Puntarenas",
    solicitadoPorId: "u-sat",
    solicitadoPorNombre: "Sara Satélite",
    estado: "aprobado",
    totales: {
      efectivo: "500000.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "500000.00",
    },
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    cantidadCierres: 3,
    solicitadoAt: "2026-09-15T10:00:00.000Z",
    resueltoAt: "2026-09-15T17:40:00.000Z",
    motivoRechazo: null,
    paraLaCentral: "500000.00",
    efectivoCubreDescuentos: true,
    // Llegaron ₡485.000 de ₡500.000: faltan ₡15.000. El faltante se escribe A MANO —no lo
    // calcula el fixture— porque es justo la cifra que este bloque afirma.
    ...marcaRecibida("485000.00", "15000.00"),
  };

  it("el ESTADO sale con el vocabulario de la CONCILIACIÓN, no con el del enum (R28)", () => {
    // `estado` en la base es `aprobado`; en el archivo se lee «Recibido incompleto», porque
    // falta dinero por llegar. Los dos listados que llevan la columna, no uno.
    expect(filaDescargaBodegaResuelto(INCOMPLETA).estado).toBe("Recibido incompleto");
    expect(filaDescargaBodegaSolicitado(INCOMPLETA).estado).toBe("Recibido incompleto");
    // Y NO el del enum, que es lo que salía antes de esta ficha.
    expect(filaDescargaBodegaResuelto(INCOMPLETA).estado).not.toBe("Aprobado");
  });

  it("una consolidación SIN MARCAR se lee «Pendiente de conciliar» y no «Solicitado»", () => {
    const pendiente: CierreBodegaResumen = {
      ...INCOMPLETA,
      estado: "solicitado",
      resueltoAt: null,
      ...marcaSinConciliar("500000.00"),
    };
    expect(filaDescargaBodegaSolicitado(pendiente).estado).toBe("Pendiente de conciliar");
    expect(filaDescargaBodegaSolicitado(pendiente).estado).not.toBe("Solicitado");
  });

  it("⭑ «Rechazado» ya no se escribe en el archivo, y la fila SIGUE bajando (R16)", () => {
    // La mitad que importa: la consolidación rechazada NO desaparece del archivo —eso sería
    // perder una fila de dinero— pero deja de anunciarse con el rótulo retirado. Sin marca, se
    // lee por lo que es hoy: pendiente de que alguien diga si el efectivo llegó.
    const rechazada: CierreBodegaResumen = {
      ...INCOMPLETA,
      estado: "rechazado",
      motivoRechazo: "Faltaba el detalle",
      ...marcaSinConciliar("500000.00"),
    };
    const fila = filaDescargaBodegaResuelto(rechazada);
    expect(fila.estado).not.toBe("Rechazado");
    expect(fila.estado).toBe("Pendiente de conciliar");
    // La fila existe y conserva su dinero y su motivo: no se retira el dato, se retira el rótulo.
    expect(fila.general).toBe("500000.00");
    expect(fila.motivo).toBe("Faltaba el detalle");
  });

  it("`faltaPorRecibir` viaja DEL DTO, sin recalcularlo, en los TRES listados (R20/R24)", () => {
    // El canario: un `faltaPorRecibir` que NO es la resta de los totales de la propia fila. Si
    // alguna de las tres proyecciones lo recalculara, saldría "15000.00" ≠ "9999.99" aquí.
    const canario: CierreBodegaResumen = {
      ...INCOMPLETA,
      ...marcaRecibida("485000.00", "9999.99"),
    };
    const filas = [
      ["cola de pendientes", filaDescargaBodegaPendiente(canario)],
      ["histórico de resueltos", filaDescargaBodegaResuelto(canario)],
      ["solicitados de la satélite", filaDescargaBodegaSolicitado(canario)],
    ] as const;
    expect(filas).toHaveLength(3);
    for (const [donde, fila] of filas) {
      expect(fila.faltaPorRecibir, `${donde}: se recalculó en vez de leer el DTO`).toBe("9999.99");
      expect(fila.montoRecibido).toBe("485000.00");
      // Money-safe: STRING del servidor, sin símbolo y sin coma flotante.
      expect(String(fila.faltaPorRecibir)).not.toContain("₡");
      expect(fila.faltaPorRecibir).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("sin marca, `montoRecibido` va VACÍO y jamás «0.00» (R7)", () => {
    // Cero recibido significa que alguien contó y no había nada; sin marca nadie ha contado. En
    // una hoja de cálculo la diferencia es que el cero SE SUMA y el vacío no.
    const sinMarca: CierreBodegaResumen = { ...INCOMPLETA, ...marcaSinConciliar("500000.00") };
    const fila = filaDescargaBodegaResuelto(sinMarca);
    expect(fila.montoRecibido).toBeNull();
    expect(fila.montoRecibido).not.toBe("0.00");
    // Y lo que falta por llegar es el efectivo ÍNTEGRO, que sí es cierto y sí es el número que
    // hay que perseguir.
    expect(fila.faltaPorRecibir).toBe("500000.00");
  });

  it("la NOTA de la conciliación NO baja al archivo (texto libre, criterio de la 362)", () => {
    const conNota: CierreBodegaResumen = {
      ...INCOMPLETA,
      ...marcaRecibida("485000.00", "15000.00", { conciliadoNota: "faltaron ₡15.000" }),
    };
    for (const columnas of [
      COLUMNAS_DESCARGA_BODEGA_PENDIENTES,
      COLUMNAS_DESCARGA_BODEGA_RESUELTOS,
      COLUMNAS_DESCARGA_BODEGA_SOLICITADOS,
    ]) {
      expect(columnas.map((c) => c.clave)).not.toContain("conciliadoNota");
    }
    for (const fila of [
      filaDescargaBodegaPendiente(conNota),
      filaDescargaBodegaResuelto(conNota),
      filaDescargaBodegaSolicitado(conNota),
    ]) {
      expect(fila).not.toHaveProperty("conciliadoNota");
      expect(Object.values(fila)).not.toContain("faltaron ₡15.000");
    }
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
    // FICHA 431: la marca de conciliacion, CUADRADA con el efectivo de este doble.
    ...marcaSinConciliar("100000.55"),
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

  it("un «Para la central» NEGATIVO llega al archivo con su signo en LAS TRES (R36)", () => {
    // Medido contra produccion el 2026-09-08: 1 de 14 cierres de bodega. Recortarlo a cero en
    // la hoja diria «no hay que entregar nada» y omitiria que la central pone la diferencia.
    //
    // LAS TRES, y no solo la de los solicitados: son TRES asignaciones independientes en el
    // archivo de columnas, no una compartida. Medido el 2026-09-08 por el reviewer (MR6):
    // recortar el negativo a "0.00" en `filaDescargaBodegaPendiente` dejaba 487 tests de
    // descarga y 2914 de guardias en verde, porque este caso solo ejercitaba una de las tres.
    const negativo: CierreBodegaResumen = { ...CIERRE, paraLaCentral: "-1000.05" };
    const proyecciones = [
      ["cola de pendientes del maestro", filaDescargaBodegaPendiente(negativo)],
      ["historico de resueltos", filaDescargaBodegaResuelto(negativo)],
      ["solicitados de la satelite", filaDescargaBodegaSolicitado(negativo)],
    ] as const;
    expect(proyecciones).toHaveLength(3);
    for (const [donde, fila] of proyecciones) {
      expect(fila.paraLaCentral, `${donde}: el negativo llego recortado a la hoja`).toBe(
        "-1000.05",
      );
    }
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
