import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS,
  COLUMNAS_DESCARGA_DIA_ENTREGADAS,
  COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
  COLUMNAS_DESCARGA_DIA_DEVUELTAS,
  COLUMNAS_DESCARGA_DIA_RECHAZADAS,
  COLUMNAS_DESCARGA_DIA_INCIDENTES,
  filaDescargaDiaEntregada,
} from "@/app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";

// Feature 189 — ORDEN y CENSO de las columnas de los archivos descargables del «Cierre del
// día» del MENSAJERO (feature 170, T E.4 / R5).
//
// Alcance: la 189 fijó SOLO `COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS` y dejó censadas las cinco
// secciones por resultado. Esa deuda se cierra aquí: las seis declaraciones del módulo tienen
// ya su caso, y cada uno se vio fallar bajo su propia mutación antes de darlo por bueno.
//
// ⚠️ OJO AL HOMÓNIMO. Las cinco secciones por resultado tienen una gemela de nombre casi
// idéntico en `tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`:
//
//     _DIA_ENTREGADAS  (mensajero, aquí)  ≠  _GESTIONES_ENTREGADAS  (admin, allí)
//
// …y lo mismo con reprogramadas, devueltas, rechazadas e incidentes. Esta pantalla enseña
// MENOS a propósito: el mensajero no ve el ingreso de Ordenex (flete, comisión, IVA, «Total
// Ordenex») ni la indemnización de un incidente, porque ese dinero no es suyo (R24). Copiar
// un esperado del archivo del admin da un listado plausible y falso.
//
// «Total» y no «Total general», y «Ganancia» y no «Pago mensajero»: esta pantalla es la del
// MENSAJERO y usa sus palabras. El esperado se escribe a mano con el texto que de verdad
// llega al archivo, no leyendo la constante.

describe("orden de las columnas de descarga del cierre del día (mensajero)", () => {
  it("el histórico de CIERRES PASADOS declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS.map((c) => c.clave)).toEqual([
      "estado",
      "destino",
      "efectivo",
      "simpe",
      "transferencia",
      "general",
      "ganancia",
      "fecha",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS.map((c) => c.encabezado)).toEqual([
      "Estado",
      "Destino",
      "Efectivo",
      "SINPE",
      "Transferencia",
      "Total",
      "Ganancia",
      "Fecha",
    ]);
  });

  it("la sección ENTREGADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // «Monto» (no «Recibido», que es la palabra del admin) y «Ganancia» cerrando: las tres
    // columnas de ingreso de Ordenex que el admin sí ve no existen en esta pantalla.
    expect(COLUMNAS_DESCARGA_DIA_ENTREGADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "monto",
      "metodo",
      "ganancia",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_ENTREGADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Monto",
      "Método",
      "Ganancia",
    ]);
  });

  it("la sección REPROGRAMADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_DIA_REPROGRAMADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "nuevaFecha",
      "motivo",
      "ganancia",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_REPROGRAMADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Nueva fecha",
      "Motivo",
      "Ganancia",
    ]);
  });

  it("la sección DEVUELTAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // La más corta de las cinco: nueve columnas, sin flete de devolución ni su IVA —eso es
    // ingreso de Ordenex y esta pantalla no lo enseña (R24)—.
    expect(COLUMNAS_DESCARGA_DIA_DEVUELTAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "motivo",
      "ganancia",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_DEVUELTAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Motivo",
      "Ganancia",
    ]);
  });

  it("la sección RECHAZADAS declara sus columnas en el orden de la pantalla (R5)", () => {
    // Sin la columna «Origen» del admin, y con «Tiene evidencia» —Sí/No— en vez de la URL
    // firmada (R22). Se diferencia de DEVUELTAS solo en esa columna, así que un esperado
    // copiado de la hermana de al lado se detecta aquí y en ningún otro sitio.
    expect(COLUMNAS_DESCARGA_DIA_RECHAZADAS.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "motivo",
      "tieneEvidencia",
      "ganancia",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_RECHAZADAS.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Motivo",
      "Tiene evidencia",
      "Ganancia",
    ]);
  });

  it("la sección INCIDENTES declara sus columnas en el orden de la pantalla (R5)", () => {
    // La ÚNICA de las cinco sin columna de dinero: un incidente no se le paga al mensajero y
    // la indemnización se le paga a la tienda (158/R17/R18). Que aquí no aparezca «Ganancia»
    // ni «Indemnización» es la afirmación que este caso sujeta.
    expect(COLUMNAS_DESCARGA_DIA_INCIDENTES.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "direccion",
      "ubicacion",
      "producto",
      "tienda",
      "causa",
      "motivo",
      "tieneEvidencia",
    ]);
    expect(COLUMNAS_DESCARGA_DIA_INCIDENTES.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Dirección",
      "Ubicación",
      "Producto",
      "Tienda",
      "Causa",
      "Motivo",
      "Tiene evidencia",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Feature 213 [D4] — el DESGLOSE del recaudo en la celda escalar «Método»
// ---------------------------------------------------------------------------
//
// Los seis casos de arriba (censo y ORDEN de columnas) NO se tocan: son justamente lo que
// hace cumplir R26 —ni una columna nueva, ni un cambio de orden— y siguen verdes tal cual.
// Lo que se amplía aquí es la PROYECCIÓN de la sección entregadas: qué acaba dentro de esa
// única celda cuando la entrega se cobró con dos métodos.

/**
 * Gestión `entregada` mínima. Los campos que no intervienen en la celda «Método» se dejan
 * en su valor neutro; lo que cada caso mueve es SOLO `pagos` (y `metodoPago`, para que se
 * vea que la celda ya no depende de él).
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
  };
}

describe("celda «Método» de la sección ENTREGADAS del cierre del día (mensajero)", () => {
  it("una gestión con pago MIXTO produce UNA sola fila, no un array (R27)", () => {
    const fila = filaDescargaDiaEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    );

    // El archivo no se multiplica: dos líneas de pago siguen siendo una fila con las mismas
    // claves de siempre. Multiplicarla duplicaría «Monto» y «Ganancia», y quien sumara la
    // columna de ganancia pagaría dos veces al mensajero.
    expect(Array.isArray(fila)).toBe(false);
    expect(Object.keys(fila)).toEqual(
      COLUMNAS_DESCARGA_DIA_ENTREGADAS.map((c) => c.clave),
    );
    expect(fila.monto).toBe("8000.00");
    expect(fila.ganancia).toBe("1500.00");
  });

  it("dos líneas se concatenan en la celda `metodo` con un ÚNICO separador (R28)", () => {
    const fila = filaDescargaDiaEntregada(
      gestionEntregada([
        { metodo: "efectivo", monto: "5000.00" },
        { metodo: "transferencia", monto: "3000.00" },
      ]),
    );

    // Cadena EXACTA: etiqueta legible + monto crudo, un solo « + » entre las dos ([Q1]).
    expect(fila.metodo).toBe("Efectivo 5000.00 + Transferencia 3000.00");
    expect(String(fila.metodo).split(" + ")).toHaveLength(2);
  });

  it("respeta el ORDEN del DTO aunque difiera del alfabético (R28)", () => {
    // El DTO llega en orden de declaración del enum (`efectivo`, `SINPE`, `transferencia`).
    // Aquí se le da un orden cuyo alfabético sería el contrario —«Efectivo» < «SINPE»—: si
    // la proyección ordenara por su cuenta, esta cadena saldría al revés.
    const fila = filaDescargaDiaEntregada(
      gestionEntregada([
        { metodo: "SINPE", monto: "2000.00" },
        { metodo: "efectivo", monto: "6000.00" },
      ]),
    );

    expect(fila.metodo).toBe("SINPE 2000.00 + Efectivo 6000.00");
  });

  it("una sola línea da SOLO la etiqueta, exactamente igual que hoy (R29)", () => {
    // El importe ya viaja en la columna contigua «Monto», así que el archivo del 99 % de
    // las filas no cambia con esta feature ([Q2]).
    const fila = filaDescargaDiaEntregada(
      gestionEntregada([{ metodo: "efectivo", monto: "8000.00" }]),
    );

    expect(fila.metodo).toBe("Efectivo");
  });

  it("sin líneas de pago la celda `metodo` queda VACÍA: `null`, ni «—» ni «» (R30)", () => {
    // `null` es celda vacía en el archivo; el «—» es un marcador de PANTALLA y no debe
    // filtrarse a una hoja de cálculo. Se pasa `metodoPago: "efectivo"` a propósito: la
    // celda ya no lo lee (R23), así que sigue vacía aunque el escalar exista.
    const fila = filaDescargaDiaEntregada(gestionEntregada([], "efectivo"));

    expect(fila.metodo).toBeNull();
  });

  it("los montos son el STRING money-safe del servidor TAL CUAL (R31)", () => {
    // Ni `toFixed`, ni separador de miles, ni símbolo de colón: el archivo lo consume una
    // hoja de cálculo. Un monto de siete cifras es donde un formateo colado se vería.
    const fila = filaDescargaDiaEntregada(
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
