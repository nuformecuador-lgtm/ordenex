import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS,
  COLUMNAS_DESCARGA_DIA_ENTREGADAS,
  COLUMNAS_DESCARGA_DIA_REPROGRAMADAS,
  COLUMNAS_DESCARGA_DIA_DEVUELTAS,
  COLUMNAS_DESCARGA_DIA_RECHAZADAS,
  COLUMNAS_DESCARGA_DIA_INCIDENTES,
} from "@/app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas";

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
