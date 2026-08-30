import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_GASTOS_FIJOS,
  filaDescargaGastoFijo,
} from "@/app/(app)/wallet/_components/gastos-fijos-descarga-columnas";
import {
  periodicidadLegible,
  proximoCobroTexto,
} from "@/app/(app)/wallet/_components/wallet-labels";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Feature 189 — ORDEN y CENSO de las columnas del archivo descargable de las PLANTILLAS DE
// GASTO FIJO del wallet (feature 170, T D.3 / R5).
//
// OJO al homónimo: `tests/unit/descarga/plantillas-descarga-columnas.test.ts` NO cubre esto.
// Aquélla es `COLUMNAS_DESCARGA_PLANTILLAS`, las plantillas de MENSAJE de
// `configuracion/plantillas`. Son otra pantalla y otro archivo.
//
// Con cinco columnas la tentación sigue siendo decir que un listado tan corto no necesita test
// de orden, y sigue siendo al revés: una permuta cabe entera en una revisión distraída, y
// «Monto», «Periodicidad» y «Estado» son celdas que un `toContain` de encabezados no distingue.
//
// Feature 85 (T F.5, R21/R24) — entran «Periodicidad» y «Próximo cobro», porque desde esta
// ficha la TABLA las enseña. El `toEqual` de claves y encabezados ES EL CONTRATO del archivo:
// se actualiza A MANO con los literales nuevos, y NO se sustituye por una derivación de la
// propia constante (`COLUMNAS.map(c => c.clave)` comparado consigo mismo dejaría de fijar
// nada, y en este repo cambiar un literal por su propia fuente ya dejó pasar un fallo real).

/** Instante del archivo: 2026-09-01 a las 12:00 de Costa Rica. Baja por props del servidor. */
const AHORA = new Date("2026-09-01T18:00:00.000Z");

/** Quincenal (`semanas`/`2`) anclada el 31 de agosto: el siguiente cobro cae el 14/09/2026. */
const QUINCENAL: GastoFijoPlantillaDTO = {
  id: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  concepto: "Alquiler de bodega",
  monto: "1234.50",
  activa: true,
  periodicidadUnidad: "semanas",
  periodicidadCantidad: 2,
  fechaCobro: "2026-08-31",
  requiereAprobacion: true, // ficha 333/R1
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/** La misma, desactivada y mensual: no tiene próximo cobro que anunciar. */
const INACTIVA: GastoFijoPlantillaDTO = {
  ...QUINCENAL,
  id: "9a8b7c6d-5e4f-4321-8abc-def012345678",
  concepto: "Internet",
  activa: false,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
};

describe("orden de las columnas de descarga de las plantillas de gasto fijo", () => {
  it("declara las cinco columnas en el orden de la pantalla (R5/R21)", () => {
    expect(COLUMNAS_DESCARGA_GASTOS_FIJOS.map((c) => c.clave)).toEqual([
      "concepto",
      "monto",
      "periodicidad",
      "proximoCobro",
      "estado",
    ]);
    expect(COLUMNAS_DESCARGA_GASTOS_FIJOS.map((c) => c.encabezado)).toEqual([
      "Concepto",
      "Monto",
      "Periodicidad",
      "Próximo cobro",
      "Estado",
    ]);
  });

  it("la fila lleva EXACTAMENTE las claves declaradas: ni una de más, ni una de menos", () => {
    // Sin esto, una columna declarada y no proyectada saldría como celda vacía en el Excel sin
    // que nada fallara, y un campo proyectado de más viajaría al archivo sin encabezado.
    expect(Object.keys(filaDescargaGastoFijo(QUINCENAL, AHORA))).toEqual(
      COLUMNAS_DESCARGA_GASTOS_FIJOS.map((c) => c.clave),
    );
  });
});

describe("valores de la fila del archivo (R21/R24)", () => {
  it("la fila lleva la misma periodicidad y el mismo próximo cobro que la tabla", () => {
    const fila = filaDescargaGastoFijo(QUINCENAL, AHORA);

    // La etiqueta de la periodicidad es la MISMA palabra que se lee en la tabla.
    expect(fila.periodicidad).toBe("Quincenal");
    expect(periodicidadLegible("semanas", 2)).toBe("Quincenal");

    // Y el próximo cobro es el MISMO DÍA que pinta la tabla, en la forma que ORDENA en una
    // hoja de cálculo: `YYYY-MM-DD` en el archivo, «14 de septiembre de 2026» en pantalla.
    expect(fila.proximoCobro).toBe("2026-09-14");
    expect(proximoCobroTexto(QUINCENAL, AHORA)).toBe("14 de septiembre de 2026");

    expect(fila.concepto).toBe("Alquiler de bodega");
    expect(fila.estado).toBe("Activa");
  });

  it("una plantilla inactiva dice «No se cobra» también en el archivo", () => {
    const fila = filaDescargaGastoFijo(INACTIVA, AHORA);

    expect(fila.proximoCobro).toBe("No se cobra");
    expect(fila.estado).toBe("Inactiva");
    // Su ciclo se sigue emitiendo: existe aunque esté apagada.
    expect(fila.periodicidad).toBe("Mensual");
  });

  it("el monto sale crudo, sin símbolo ni redondeo (R24)", () => {
    const fila = filaDescargaGastoFijo(QUINCENAL, AHORA);

    expect(fila.monto).toBe("1234.50"); // el STRING del servidor, TAL CUAL
    expect(typeof fila.monto).toBe("string");
    expect(String(fila.monto)).not.toContain("₡");
    expect(String(fila.monto)).not.toContain(","); // sin separador de miles: eso es pantalla
  });

  it("el archivo sigue el instante que recibe, no un reloj interno", () => {
    // Dos instantes distintos, dos fechas distintas para la MISMA plantilla. El mapper recibe
    // el `ahora` por parámetro justamente para que archivo y pantalla no puedan discrepar.
    expect(filaDescargaGastoFijo(QUINCENAL, AHORA).proximoCobro).toBe("2026-09-14");
    expect(
      filaDescargaGastoFijo(QUINCENAL, new Date("2026-09-20T18:00:00.000Z")).proximoCobro,
    ).toBe("2026-09-28");
  });
});
