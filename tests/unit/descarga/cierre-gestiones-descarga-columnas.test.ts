import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
  COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
  COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
  COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
  filaDescargaGestionEntregada,
} from "@/app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";

// ORDEN y CENSO de las columnas de los cinco archivos descargables del DETALLE DE UN CIERRE
// que ve el ADMIN (`DetalleSecciones`, feature 170 T E.5 / R5). Continúa la 189, que fijó las
// otras doce y dejó éstas censadas.
//
// ⚠️ OJO AL HOMÓNIMO. Las cinco constantes de este archivo tienen una gemela de nombre casi
// idéntico en `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts`:
//
//     _GESTIONES_ENTREGADAS  (admin, aquí)  ≠  _DIA_ENTREGADAS  (mensajero, allí)
//
// …y lo mismo con reprogramadas, devueltas, rechazadas e incidentes. NO son la misma pantalla
// y NO llevan las mismas columnas: el mensajero no ve el ingreso de Ordenex (flete, comisión,
// IVA, total) ni la indemnización, porque ese dinero no es suyo. Copiar un esperado de un
// archivo al otro da un listado plausible y falso; el que hay aquí se leyó de ESTE módulo.
//
// Por qué las cinco viven juntas: salen del MISMO módulo de producción y comparten el bloque
// `COMUNES` de siete columnas. Ahí está justamente el riesgo que estos casos cubren: el 60-70 %
// de cada listado se ve idéntico en los cinco, así que una permuta dentro de `COMUNES` —o una
// columna de dinero que se cuela en la sección equivocada— pasa desapercibida leyendo el
// diff. Cinco esperados escritos a mano, uno por sección, es lo que hace que esa confusión
// tenga que romper cinco casos a la vez para pasar.
//
// El esperado se escribe LITERAL, nunca derivado de la constante ni de `COMUNES`: los
// encabezados que vienen de `cierre-labels` (`MONTO_COBRAR_COL`, `PAGO_MENSAJERO_COL`,
// `INGRESO_TOTAL_COL`, …) se fijan por su TEXTO, que es lo que acaba en la hoja del usuario.

describe("orden de las columnas de descarga del detalle de un cierre (admin)", () => {
  it("la sección ENTREGADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "montoCobrar",
      "recibido",
      "metodo",
      "fleteConIva",
      "comisionConIva",
      "ingresoTotal",
      "pagoMensajero",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "A cobrar",
      "Recibido",
      "Método",
      "Flete + IVA",
      "Comisión + IVA",
      "Total Ordenex",
      "Pago mensajero",
    ]);
  });

  it("la sección REPROGRAMADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // Una reprogramación no deriva conceptos de ingreso, así que aquí NO hay flete, comisión
    // ni «Total Ordenex»: solo la fecha nueva y el motivo entre «A cobrar» y el pago.
    expect(COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "montoCobrar",
      "nuevaFecha",
      "motivo",
      "pagoMensajero",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "A cobrar",
      "Nueva fecha",
      "Motivo",
      "Pago mensajero",
    ]);
  });

  it("la sección DEVUELTAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // El flete de devolución va PARTIDO en dos columnas (base e IVA), al revés que en
    // RECHAZADAS, que lo lleva agrupado. No es un descuido de este test: es lo que pinta
    // `cierre-detalle-shared.tsx:911-912`, y el archivo usa la palabra de la pantalla (R8).
    expect(COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "montoCobrar",
      "motivo",
      "fleteDevolucion",
      "ivaFleteDevolucion",
      "ingresoTotal",
      "pagoMensajero",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "A cobrar",
      "Motivo",
      "Flete devolución",
      "IVA flete dev.",
      "Total Ordenex",
      "Pago mensajero",
    ]);
  });

  it("la sección RECHAZADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // La más larga de las cinco (15 columnas) y la única con «Origen» delante de «A cobrar» y
    // con «Ingreso bodega» cerrando: dos columnas que ninguna de sus hermanas lleva.
    expect(COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "origenRechazo",
      "montoCobrar",
      "motivo",
      "tieneEvidencia",
      "fleteDevolucionConIva",
      "ingresoTotal",
      "pagoMensajero",
      "ingresoBodega",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Origen",
      "A cobrar",
      "Motivo",
      "Tiene evidencia",
      "Flete devolución + IVA",
      "Total Ordenex",
      "Pago mensajero",
      "Ingreso bodega",
    ]);
  });

  it("la sección INCIDENTES declara sus columnas en el orden de la pantalla (R5)", () => {
    // «Tiene evidencia» y NUNCA la URL firmada (R22), e «Indemnización» al final —la columna
    // que la pantalla del mensajero no tiene, porque ese dinero se le paga a la tienda—.
    expect(COLUMNAS_DESCARGA_GESTIONES_INCIDENTES.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "montoCobrar",
      "causa",
      "motivo",
      "tieneEvidencia",
      "indemnizacion",
    ]);
    expect(COLUMNAS_DESCARGA_GESTIONES_INCIDENTES.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "A cobrar",
      "Causa",
      "Motivo",
      "Tiene evidencia",
      "Indemnización",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Feature 213 [D4] — el DESGLOSE del recaudo en la celda escalar «Método»
// ---------------------------------------------------------------------------
//
// Los cinco casos de arriba (censo y ORDEN) NO se tocan: son los que hacen cumplir R26 —el
// desglose va en la celda que ya existía, sin columna nueva— y siguen verdes tal cual. Este
// bloque amplía la PROYECCIÓN de la sección entregadas del archivo del ADMIN, que es OTRA
// declaración que la del mensajero aunque el DTO sea el mismo: aquí la columna vecina se
// llama «Recibido» y hay siete columnas más de dinero que allí no existen.

/**
 * Gestión `entregada` mínima. `ingresoOrdenex: null` a propósito: las columnas de ingreso
 * de Ordenex no intervienen en la celda «Método» y así el fixture no finge un snapshot.
 */
function gestionEntregada(
  pagos: CierreDetalleGestion["pagos"],
  metodoPago: CierreDetalleGestion["metodoPago"] = null,
): CierreDetalleGestion {
  return {
    gestionId: "g-1",
    ordenId: "o-1",
    numGuia: 1234,
    numRemision: "REM-1234",
    destinatario: "Ana Rojas",
    direccion: "100 m sur",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
    tiendaNombre: "Tienda Uno",
    resultado: "entregada",
    montoRecibido: "8000.00",
    metodoPago,
    pagos,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "1500.00",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    ingresoOrdenex: null,
  };
}

describe("celda «Método» de la sección ENTREGADAS del detalle de un cierre (admin)", () => {
  it("una gestión con pago MIXTO produce UNA sola fila, no un array (R27)", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    );

    // Aquí multiplicar la fila sería peor que en el archivo del mensajero: se duplicarían
    // «Flete + IVA», «Comisión + IVA» y «Total Ordenex», y el archivo dejaría de sumar.
    expect(Array.isArray(fila)).toBe(false);
    expect(Object.keys(fila)).toEqual(
      COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS.map((c) => c.clave),
    );
    expect(fila.recibido).toBe("8000.00");
    expect(fila.pagoMensajero).toBe("1500.00");
  });

  it("dos líneas se concatenan en la celda `metodo` con un ÚNICO separador (R28)", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    );

    expect(fila.metodo).toBe("Efectivo 5000.00 + Transferencia 3000.00");
    expect(String(fila.metodo).split(" + ")).toHaveLength(2);
  });

  it("respeta el ORDEN del DTO aunque difiera del alfabético (R28)", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "SINPE", monto: "2000.00" },
        { metodo: "efectivo", monto: "6000.00" },
      ]),
    );

    expect(fila.metodo).toBe("SINPE 2000.00 + Efectivo 6000.00");
  });

  it("una sola línea da SOLO la etiqueta, exactamente igual que hoy (R29)", () => {
    // El importe ya viaja en la columna contigua «Recibido» ([Q2]).
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([{ metodo: "SINPE", monto: "8000.00" }]),
    );

    expect(fila.metodo).toBe("SINPE");
  });

  it("sin líneas de pago la celda `metodo` queda VACÍA: `null`, ni «—» ni «» (R30)", () => {
    // Con `metodoPago` escalar puesto: la celda ya no lo lee, así que sigue vacía.
    const fila = filaDescargaGestionEntregada(gestionEntregada([], "efectivo"));

    expect(fila.metodo).toBeNull();
  });

  it("los montos son el STRING money-safe del snapshot TAL CUAL (R31)", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "1234567.89" },
        { metodo: "SINPE", monto: "0.10" },
      ]),
    );

    expect(fila.metodo).toBe("Efectivo 1234567.89 + SINPE 0.10");
    expect(fila.metodo).not.toMatch(/[₡$]/);
    expect(fila.metodo).not.toMatch(/1[.,]234[.,]567/);
  });
});
