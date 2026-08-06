import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS } from "@/app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas del archivo descargable del HISTÓRICO de
// cierres solicitados del mensajero (feature 170, T E.4 / R5).
//
// Alcance deliberado: este archivo fija SOLO `COLUMNAS_DESCARGA_DIA_CIERRES_PASADOS`. Las
// otras cinco declaraciones del módulo (las secciones por resultado: entregadas,
// reprogramadas, devueltas, rechazadas, incidentes) siguen SIN aserción de orden y están
// censadas como tales en `progress/impl_189.md`; añadirlas aquí sin haber visto fallar su
// mutación sería justo el test que no mide nada.
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
});
