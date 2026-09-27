import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_SALDOS_SATELITES,
  filaDescargaSaldoSatelite,
} from "@/app/(app)/wallet/satelites/_components/saldos-satelites-descarga-columnas";
import {
  COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE,
  filaDescargaConsolidacionSatelite,
} from "@/app/(app)/wallet/satelites/_components/consolidaciones-satelite-descarga-columnas";
import type {
  ConsolidacionSateliteDTO,
  SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";

// ⭑ FICHA 431 (T23, R29) — ORDEN y CENSO de las columnas de los DOS archivos descargables de
// `/wallet/satelites`. Las exige `columnas-asercion-de-orden.guardia`: el listado que un usuario
// descarga —qué columnas salen y en qué orden— es contrato, y una permuta silenciosa rompe la
// hoja de quien la reenvía sin que nada se ponga rojo.
//
// Los esperados se escriben A MANO, nunca derivados de la constante: comparar una lista consigo
// misma está siempre verde.
//
// Es un archivo de DINERO, así que además del orden se afirman tres cosas que el orden no dice:
// que los importes viajan como el STRING del servidor (sin símbolo y sin coma flotante), que un
// ausente sale VACÍO y no en cero, y que `faltaPorRecibir` LLEGA derivado en vez de restarse
// aquí.

/** Una bodega con saldo pendiente y con una última recibida INCOMPLETA. */
const SALDO: SaldoSateliteDTO = {
  zonaId: "11111111-1111-4111-8111-111111111111",
  zonaNombre: "FGAM Puntarenas",
  saldoSinConciliar: "115000.00",
  totalEfectivo: "1090000.00",
  totalConsolidado: "1250000.50",
  totalRecibido: "975000.00",
  consolidacionesSinConciliar: 1,
  diasDeLaMasAntigua: 3,
  fechaDeLaMasAntigua: "2026-09-13T10:00:00.000Z",
  ultimaRecibida: {
    fecha: "2026-09-15T17:40:00.000Z",
    monto: "485000.00",
    declarado: "500000.00",
    faltaPorRecibir: "15000.00",
  },
};

/** Una consolidación RECIBIDA POR MENOS: el caso entero de la ficha. */
const CONSOLIDACION: ConsolidacionSateliteDTO = {
  cierreBodegaId: "cb-1",
  solicitadoAt: "2026-09-15T10:00:00.000Z",
  totales: {
    efectivo: "500000.00",
    simpe: "120000.25",
    transferencia: "0.00",
    general: "620000.25",
  },
  montoRecibido: "485000.00",
  faltaPorRecibir: "15000.00",
  conciliado: true,
  conciliadoAt: "2026-09-15T17:40:00.000Z",
  conciliadoPorNombre: "Ana Rojas",
  nota: "faltaron ₡15.000, entran el lunes",
  cantidadCierres: 3,
};

describe("orden de las columnas de descarga de los saldos de bodegas satélite", () => {
  it("declara sus columnas en el orden de la pantalla (R29)", () => {
    expect(COLUMNAS_DESCARGA_SALDOS_SATELITES.map((c) => c.clave)).toEqual([
      "bodega",
      "pendiente",
      "efectivoConsolidado",
      "totalConsolidado",
      "recibido",
      "sinConciliar",
      "masAntigua",
      "ultimaRecibidaEl",
      "ultimaRecibidaMonto",
    ]);
    expect(COLUMNAS_DESCARGA_SALDOS_SATELITES.map((c) => c.encabezado)).toEqual([
      "Bodega",
      "Pendiente",
      "Efectivo consolidado",
      "Total consolidado",
      "Recibido",
      "Consolidaciones sin conciliar",
      "Más antigua sin conciliar",
      "Última recibida",
      "Monto de la última recibida",
    ]);
  });

  it("⭑ la ÚLTIMA recibida es UNA fila, y no el acumulado de la bodega", () => {
    // Es la confusión que esta columna existe para no cometer: `recibido` es la SUMA histórica
    // (₡975.000) y `ultimaRecibidaMonto` es lo que traía el ÚLTIMO bulto (₡485.000). Los dos
    // valores del doble son distintos A PROPÓSITO: si alguien cableara el acumulado en la
    // columna de la última, este caso lo dice.
    const fila = filaDescargaSaldoSatelite(SALDO);
    expect(fila.ultimaRecibidaMonto).toBe("485000.00");
    expect(fila.recibido).toBe("975000.00");
    expect(fila.ultimaRecibidaMonto).not.toBe(fila.recibido);
    // Y la fecha va como día ISO, no como el instante entero: es lo que una hoja sabe ordenar.
    expect(fila.ultimaRecibidaEl).toBe("2026-09-15");
  });

  it("una bodega sin ninguna recibida saca las dos celdas VACÍAS, no un cero (R10 de la 170)", () => {
    // El guion «—» es un marcador de PANTALLA; dentro del Excel sería un dato inventado, y un
    // "0.00" sería peor todavía: se suma.
    const nunca: SaldoSateliteDTO = { ...SALDO, ultimaRecibida: null };
    const fila = filaDescargaSaldoSatelite(nunca);
    expect(fila.ultimaRecibidaEl).toBe("");
    expect(fila.ultimaRecibidaMonto).toBe("");
    expect(fila.ultimaRecibidaMonto).not.toBe("0.00");
    expect(String(fila.ultimaRecibidaEl)).not.toContain("—");
  });

  it("los importes viajan como el STRING del servidor: sin símbolo y sin coma flotante", () => {
    const fila = filaDescargaSaldoSatelite(SALDO);
    for (const clave of [
      "pendiente",
      "efectivoConsolidado",
      "totalConsolidado",
      "recibido",
      "ultimaRecibidaMonto",
    ]) {
      expect(String(fila[clave]), clave).not.toContain("₡");
      expect(String(fila[clave]), clave).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("los DÍAS no salen al archivo; la FECHA sí, y es la que no caduca", () => {
    // «hace 3 días» es un derivado del momento en que se miró la pantalla: dentro de un archivo
    // que alguien abrirá la semana que viene es sencillamente falso.
    expect(COLUMNAS_DESCARGA_SALDOS_SATELITES.map((c) => c.clave)).not.toContain("dias");
    const fila = filaDescargaSaldoSatelite(SALDO);
    expect(fila).not.toHaveProperty("diasDeLaMasAntigua");
    expect(fila.masAntigua).toBe("2026-09-13");
  });

  it("el uuid interno de la zona no baja al archivo (R23 de la 170)", () => {
    expect(COLUMNAS_DESCARGA_SALDOS_SATELITES.map((c) => c.clave)).not.toContain("zonaId");
    expect(Object.values(filaDescargaSaldoSatelite(SALDO))).not.toContain(SALDO.zonaId);
  });

  it("cada fila trae una celda por columna declarada, y ninguna de más", () => {
    // Autocomprobación del par (columnas, proyección): una columna sin celda sale vacía en la
    // hoja sin que nada se ponga rojo, y una celda sin columna es dinero que se calcula y se tira.
    expect(Object.keys(filaDescargaSaldoSatelite(SALDO)).sort()).toEqual(
      COLUMNAS_DESCARGA_SALDOS_SATELITES.map((c) => c.clave).sort(),
    );
  });
});

describe("orden de las columnas de descarga del desglose de una bodega satélite", () => {
  it("declara sus columnas en el orden de la pantalla (R29)", () => {
    expect(COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE.map((c) => c.clave)).toEqual([
      "consolidada",
      "declarado",
      "recibido",
      "faltaPorRecibir",
      "estado",
      "conciliadoPor",
      "conciliadoEl",
      "totalGeneral",
      "simpe",
      "transferencia",
      "cierres",
    ]);
    expect(COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE.map((c) => c.encabezado)).toEqual([
      "Consolidada",
      "Declarado",
      "Recibido",
      "Falta por recibir",
      "Estado",
      "Conciliado por",
      "Conciliado el",
      "Total consolidado",
      "SINPE",
      "Transferencia",
      "Cierres del día consolidados",
    ]);
  });

  it("⭑ «Declarado» es el EFECTIVO y no el general (decisión Q2, medida)", () => {
    // El SINPE —26,3 % del consolidado en producción— entra directo a una cuenta y NO viaja en
    // el bulto. Si «Declarado» fuera el general, la columna de al lado («Recibido») se leería
    // como un faltante que nadie va a entregar en mano jamás. El general va más a la derecha,
    // como contexto, y el doble tiene los dos valores distintos a propósito.
    const fila = filaDescargaConsolidacionSatelite(CONSOLIDACION);
    expect(fila.declarado).toBe("500000.00");
    expect(fila.totalGeneral).toBe("620000.25");
    expect(fila.declarado).not.toBe(fila.totalGeneral);
  });

  it("el ESTADO sale como su etiqueta legible, nunca como el valor del enum (R28)", () => {
    expect(filaDescargaConsolidacionSatelite(CONSOLIDACION).estado).toBe("Recibido incompleto");
    const completa: ConsolidacionSateliteDTO = {
      ...CONSOLIDACION,
      montoRecibido: "500000.00",
      faltaPorRecibir: "0.00",
    };
    expect(filaDescargaConsolidacionSatelite(completa).estado).toBe("Recibido");
    const pendiente: ConsolidacionSateliteDTO = {
      ...CONSOLIDACION,
      conciliado: false,
      montoRecibido: null,
      conciliadoAt: null,
      conciliadoPorNombre: null,
      faltaPorRecibir: "500000.00",
    };
    expect(filaDescargaConsolidacionSatelite(pendiente).estado).toBe("Pendiente de conciliar");
    // Y ninguno es el del enum.
    for (const del of ["aprobado", "solicitado", "rechazado", "Aprobado", "Rechazado"]) {
      expect(filaDescargaConsolidacionSatelite(CONSOLIDACION).estado).not.toBe(del);
    }
  });

  it("`faltaPorRecibir` LLEGA del servidor y no se resta aquí (R20)", () => {
    // El canario: un faltante que NO es `declarado − recibido`. Si la proyección lo calculara,
    // saldría "15000.00" en vez de "9999.99".
    const canario: ConsolidacionSateliteDTO = { ...CONSOLIDACION, faltaPorRecibir: "9999.99" };
    expect(filaDescargaConsolidacionSatelite(canario).faltaPorRecibir).toBe("9999.99");
    expect(filaDescargaConsolidacionSatelite(canario).faltaPorRecibir).not.toBe("15000.00");
  });

  it("sin marcar, «Recibido» y «Conciliado el» van VACÍOS y no en cero", () => {
    const pendiente: ConsolidacionSateliteDTO = {
      ...CONSOLIDACION,
      conciliado: false,
      montoRecibido: null,
      conciliadoAt: null,
      conciliadoPorNombre: null,
      faltaPorRecibir: "500000.00",
    };
    const fila = filaDescargaConsolidacionSatelite(pendiente);
    expect(fila.recibido).toBe("");
    expect(fila.recibido).not.toBe("0.00");
    expect(fila.conciliadoPor).toBe("");
    expect(fila.conciliadoEl).toBe("");
  });

  it("la NOTA y el uuid NO bajan al archivo, y sí se ven en pantalla", () => {
    // La nota es texto libre tecleado por una persona (criterio de la 362); el id es interno
    // (R23 de la 170). La fila se identifica por su FECHA de consolidación.
    expect(COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE.map((c) => c.clave)).not.toContain("nota");
    const fila = filaDescargaConsolidacionSatelite(CONSOLIDACION);
    expect(fila).not.toHaveProperty("nota");
    expect(Object.values(fila)).not.toContain(CONSOLIDACION.nota);
    expect(Object.values(fila)).not.toContain(CONSOLIDACION.cierreBodegaId);
  });

  it("cada fila trae una celda por columna declarada, y ninguna de más", () => {
    expect(Object.keys(filaDescargaConsolidacionSatelite(CONSOLIDACION)).sort()).toEqual(
      COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE.map((c) => c.clave).sort(),
    );
  });
});
