import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR } from "@/app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas";

// ORDEN y CENSO de las columnas del archivo descargable de las CUENTAS POR PAGAR a mensajeros
// (`/wallet/mensajeros`, feature 170 T D.2 / R5). Continúa la 189, que la dejó censada.
//
// De las 35 constantes `COLUMNAS_DESCARGA_*` del árbol, ésta era la única que no aparecía NI
// UNA VEZ en `tests/`: no es que su aserción fuera floja, es que no había ninguna. Este
// archivo es el primer sitio donde el listado que un usuario descarga queda escrito.
//
// Los cinco encabezados salen en producción de `ENCABEZADOS_DESCARGA_MAESTRO`, derivado del mismo
// objeto que titula la tabla. Aquí se fijan por su TEXTO y no importando la constante: lo que
// llega a la hoja es el texto, y si alguien lo cambia el test tiene que enterarse. Importar la
// constante haría que renombrar la cabecera moviera los dos lados a la vez, que es la
// tautología que este repo lleva cazando desde la 189.
//
// ⚠️ OJO AL HOMÓNIMO: `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` NO
// cubre esto. Aquél es el DESGLOSE de UN mensajero (fecha/tipo/concepto/monto/origen, una fila
// por movimiento); esto es el listado del maestro, una fila por PERSONA. Mismo módulo de
// etiquetas, dos tablas distintas.
//
// 2026-08-07 — DOS de los cinco encabezados dejaron de ser los de la pantalla (decisión
// humana). «Devengado» y «Pagado» incluyen los pagos anulados y su reverso; en pantalla eso lo
// explica el aviso de la feature 172, que va justo encima de la tabla, pero la hoja se reenvía
// sin él. Ahora la salvedad viaja EN la cabecera del archivo. El dato es el mismo de siempre.

describe("orden de las columnas de descarga de las cuentas por pagar a mensajeros", () => {
  it("declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR.map((c) => c.clave)).toEqual([
      "mensajero",
      "devengado",
      "pagado",
      "cuentaPorPagar",
      "estado",
    ]);
    expect(COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR.map((c) => c.encabezado)).toEqual([
      "Mensajero",
      "Devengado (incluye la devolución de los pagos anulados)",
      "Pagado (incluye los pagos anulados)",
      "Cuenta por pagar",
      "Estado",
    ]);
  });

  // Lo que la salvedad tiene que impedir: que la hoja prometa un importe exacto que no lo es.
  // Se afirma sobre los DOS importes brutos y, por contraste, sobre el que SÍ es exacto: si
  // mañana alguien "limpia" las cabeceras quitando el paréntesis, esto cae.
  it("advierte de los anulados en los dos importes brutos, y solo en ellos", () => {
    const porClave = new Map(
      COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR.map((c) => [c.clave, c.encabezado]),
    );

    expect(porClave.get("devengado")).toContain("anulados");
    expect(porClave.get("pagado")).toContain("anulados");
    // La resta sale exacta (feature 172): no lleva salvedad ni debe llevarla.
    expect(porClave.get("cuentaPorPagar")).toBe("Cuenta por pagar");
    expect(porClave.get("mensajero")).toBe("Mensajero");
    expect(porClave.get("estado")).toBe("Estado");
  });
});
