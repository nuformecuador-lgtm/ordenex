import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_GESTIONES_ENTREGADAS,
  COLUMNAS_DESCARGA_GESTIONES_REPROGRAMADAS,
  COLUMNAS_DESCARGA_GESTIONES_DEVUELTAS,
  COLUMNAS_DESCARGA_GESTIONES_RECHAZADAS,
  COLUMNAS_DESCARGA_GESTIONES_INCIDENTES,
} from "@/app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas";

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
