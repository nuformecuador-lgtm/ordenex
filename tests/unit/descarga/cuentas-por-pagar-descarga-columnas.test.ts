import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_CUENTAS_POR_PAGAR } from "@/app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas";

// ORDEN y CENSO de las columnas del archivo descargable de las CUENTAS POR PAGAR a mensajeros
// (`/wallet/mensajeros`, feature 170 T D.2 / R5). Continúa la 189, que la dejó censada.
//
// De las 35 constantes `COLUMNAS_DESCARGA_*` del árbol, ésta era la única que no aparecía NI
// UNA VEZ en `tests/`: no es que su aserción fuera floja, es que no había ninguna. Este
// archivo es el primer sitio donde el listado que un usuario descarga queda escrito.
//
// Los cinco encabezados salen en producción de `COLUMNAS_MAESTRO`, el mismo objeto que titula
// la tabla. Aquí se fijan por su TEXTO y no importando la constante: lo que llega a la hoja es
// el texto, y si alguien lo cambia el test tiene que enterarse. Importar `COLUMNAS_MAESTRO`
// haría que renombrar la cabecera moviera los dos lados a la vez, que es la tautología que
// este repo lleva cazando desde la 189.
//
// ⚠️ OJO AL HOMÓNIMO: `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` NO
// cubre esto. Aquél es el DESGLOSE de UN mensajero (fecha/tipo/concepto/monto/origen, una fila
// por movimiento); esto es el listado del maestro, una fila por PERSONA. Mismo módulo de
// etiquetas, dos tablas distintas.

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
      "Devengado",
      "Pagado",
      "Cuenta por pagar",
      "Estado",
    ]);
  });
});
