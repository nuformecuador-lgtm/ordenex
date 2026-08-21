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
      "fulfillment",
      "recibido",
      "pago_efectivo",
      "pago_SINPE",
      "pago_transferencia",
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
      "Fulfillment",
      "Recibido",
      "Efectivo",
      "SINPE",
      "Transferencia",
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
      "fulfillment",
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
      "Fulfillment",
      "Nueva fecha",
      "Motivo",
      "Pago mensajero",
    ]);
  });

  it("la sección DEVUELTAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // El flete de devolución va AGRUPADO con su IVA (2026-08-19), igual que en RECHAZADAS:
    // el par partido (base e IVA en dos columnas) se retiró de las dos pantallas y de sus
    // archivos. El split sigue existiendo en el DTO, para la fila desplegable del desglose.
    expect(COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "montoCobrar",
      "fulfillment",
      "motivo",
      "fleteDevolucionConIva",
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
      "Fulfillment",
      "Motivo",
      "Flete devolución + IVA",
      "Total Ordenex",
      "Pago mensajero",
    ]);
  });

  it("la sección RECHAZADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // La más larga de las cinco (16 columnas) y la única con «Origen» delante de «A cobrar» y
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
      "fulfillment",
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
      "Fulfillment",
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
      "fulfillment",
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
      "Fulfillment",
      "Causa",
      "Motivo",
      "Tiene evidencia",
      "Indemnización",
    ]);
  });
});

// ---------------------------------------------------------------------------
// El recaudo, con UNA COLUMNA POR MEDIO DE PAGO (2026-08-19)
// ---------------------------------------------------------------------------
//
// Sustituye al bloque de la celda escalar «Método» de la feature 213, que probaba la
// CONCATENACIÓN («Efectivo 5000.00 + Transferencia 3000.00») en una sola celda. R26 —«sin
// columna nueva»— se revierte a propósito: una hoja de cálculo no puede sumar un texto, y
// sumar por medio de pago es justo lo que se hace con este archivo.
//
// Esto prueba la PROYECCIÓN de la sección entregadas del archivo del ADMIN, que es OTRA
// declaración que la del mensajero aunque el DTO sea el mismo: aquí la columna vecina se
// llama «Recibido» y hay siete columnas más de dinero que allí no existen. El cierre del día
// del mensajero SIGUE con la celda concatenada, y su test sigue probándola.

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
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
    ingresoOrdenex: null,
  };
}

describe("columnas por MEDIO DE PAGO de la sección ENTREGADAS del detalle (admin)", () => {
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

  it("un pago MIXTO reparte cada monto en SU columna, sin concatenar nada", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    );

    expect(fila.pago_efectivo).toBe("5000.00");
    expect(fila.pago_transferencia).toBe("3000.00");
    // El medio por el que no entró dinero queda VACÍO, que NO es un cero: un 0.00 diría que
    // se cobró cero por SINPE, y lo que pasó es que no se cobró por SINPE.
    expect(fila.pago_SINPE).toBeNull();
    // Ninguna celda lleva ya la etiqueta del medio: el medio es el ENCABEZADO de la columna.
    expect(String(fila.pago_efectivo)).not.toMatch(/Efectivo|\+/);
  });

  it("las tres columnas salen SIEMPRE y en el orden del enum, sea cual sea el pago", () => {
    // Es lo que permite pegar dos hojas o sumar una columna entera: la posición no depende
    // de por dónde cobró esta gestión.
    const claves = COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS.map((c) => c.clave);
    expect(claves.filter((c) => c.startsWith("pago_"))).toEqual([
      "pago_efectivo",
      "pago_SINPE",
      "pago_transferencia",
    ]);

    const soloSinpe = filaDescargaGestionEntregada(
      gestionEntregada([{ metodo: "SINPE", monto: "8000.00" }]),
    );
    expect(soloSinpe.pago_efectivo).toBeNull();
    expect(soloSinpe.pago_SINPE).toBe("8000.00");
    expect(soloSinpe.pago_transferencia).toBeNull();
  });

  it("el ORDEN del DTO no altera en qué columna cae cada monto", () => {
    // La celda concatenada respetaba el orden recibido porque era una lista; una columna por
    // medio no tiene ese problema: la clave manda, venga el DTO como venga.
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "SINPE", monto: "2000.00" },
        { metodo: "efectivo", monto: "6000.00" },
      ]),
    );

    expect(fila.pago_SINPE).toBe("2000.00");
    expect(fila.pago_efectivo).toBe("6000.00");
  });

  it("sin líneas de pago las TRES columnas quedan VACÍAS: `null`, ni «—» ni «» (R30)", () => {
    // Con `metodoPago` escalar puesto: las celdas no lo leen, así que siguen vacías.
    const fila = filaDescargaGestionEntregada(gestionEntregada([], "efectivo"));

    expect(fila.pago_efectivo).toBeNull();
    expect(fila.pago_SINPE).toBeNull();
    expect(fila.pago_transferencia).toBeNull();
  });

  it("los montos son el STRING money-safe del snapshot TAL CUAL (R31)", () => {
    const fila = filaDescargaGestionEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "1234567.89" },
        { metodo: "SINPE", monto: "0.10" },
      ]),
    );

    expect(fila.pago_efectivo).toBe("1234567.89");
    expect(fila.pago_SINPE).toBe("0.10");
    expect(String(fila.pago_efectivo)).not.toMatch(/[₡$]/);
    expect(String(fila.pago_efectivo)).not.toMatch(/1[.,]234[.,]567/);
  });
});
