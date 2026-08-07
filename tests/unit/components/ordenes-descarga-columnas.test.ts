// Feature 151 (T10, R35) — el export del listado de órdenes lleva valores CRUDOS.
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_ORDENES,
  filaDescargaOrden,
} from "@/app/(app)/ordenes/_components/ordenes-descarga-columnas";
import type { OrdenListItemDTO } from "@/lib/types/orden";

function makeOrden(overrides: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return {
    id: "orden-uuid",
    numGuia: 1234,
    numRemision: "REM-001",
    estatusId: "est-uuid",
    estatusValue: "entregada",
    destinatario: "Ana Solís",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-uuid",
    provinciaId: "prov-uuid",
    cantonId: "canton-uuid",
    distritoId: "distrito-uuid",
    producto: "Camiseta",
    peso: 1.5,
    notas: null,
    direccion: "Calle 1, casa 2",
    montoCobrar: 15000,
    intentosEntrega: 2,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
    relaciones: {
      estatus: { id: "est-uuid", value: "entregada" },
      tienda: {
        id: "tienda-uuid",
        nombre: "Tienda Relación",
        email: "tienda@x.com",
        telefono: "022222222",
        tarifa: null,
      },
      zona: { id: "zona-uuid", nombre: "Zona Norte", esCentral: false },
      provincia: { id: "prov-uuid", nombre: "San José" },
      canton: { id: "canton-uuid", nombre: "Escazú" },
      distrito: { id: "distrito-uuid", nombre: "San Rafael" },
      mensajeroAsignado: { id: "mens-uuid", nombre: "Luis Mora" },
    },
    ...overrides,
  };
}

const CLAVES = COLUMNAS_DESCARGA_ORDENES.map((c) => c.clave);

describe("columnas de descarga del listado de órdenes", () => {
  it("proyecta cada orden a valores crudos: texto, número o celda vacía", () => {
    const fila = filaDescargaOrden(makeOrden());

    expect(typeof fila.numGuia).toBe("number");
    expect(fila.numGuia).toBe(1234);
    expect(typeof fila.numRemision).toBe("string");
    expect(typeof fila.montoCobrar).toBe("number");
    expect(fila.montoCobrar).toBe(15000);
    expect(typeof fila.intentos).toBe("number");
    expect(fila.intentos).toBe(2);
    // Fecha CALENDARIO de CR: 20:00 UTC del 15 son las 14:00 CR del MISMO día.
    expect(fila.fechaCreacion).toBe("2026-07-15");

    // Sin guía, sin dirección, sin monto y sin mensajero → celda vacía (`null`), nunca
    // el placeholder "—" ni `undefined`, que no son valores de hoja de cálculo.
    const vacia = filaDescargaOrden(
      makeOrden({
        numGuia: null,
        direccion: null,
        montoCobrar: undefined,
        intentosEntrega: undefined,
        relaciones: undefined,
        estatusValue: undefined,
      }),
    );
    expect(vacia.numGuia).toBeNull();
    expect(vacia.direccion).toBeNull();
    expect(vacia.montoCobrar).toBeNull();
    expect(vacia.mensajero).toBeNull();
    expect(vacia.estatus).toBeNull();
    // El 0 de intentos es un valor CONOCIDO, no un dato ausente.
    expect(vacia.intentos).toBe(0);
    for (const clave of CLAVES) {
      expect(vacia[clave]).not.toBe("—");
      expect(vacia[clave]).not.toBeUndefined();
    }
  });

  it("no emite ningún ReactNode ni objeto en las celdas", () => {
    const filas = [
      filaDescargaOrden(makeOrden()),
      filaDescargaOrden(makeOrden({ relaciones: undefined, numGuia: null })),
    ];

    for (const fila of filas) {
      // Cada columna declarada tiene celda, y ninguna celda es objeto/array/función.
      expect(Object.keys(fila).sort()).toEqual([...CLAVES].sort());
      for (const clave of CLAVES) {
        const celda = fila[clave];
        if (celda !== null) {
          expect(["string", "number"]).toContain(typeof celda);
        }
        expect(typeof celda).not.toBe("function");
        expect(Array.isArray(celda)).toBe(false);
        // Un ReactElement es un objeto con `$$typeof`; una Date también es objeto.
        expect(celda === null || typeof celda !== "object").toBe(true);
      }
    }
  });

  it("resuelve zona, tienda, geografía y estado a su nombre legible, no a su id", () => {
    const fila = filaDescargaOrden(makeOrden());

    expect(fila.tienda).toBe("Tienda Relación");
    expect(fila.zona).toBe("Zona Norte");
    expect(fila.provincia).toBe("San José");
    expect(fila.canton).toBe("Escazú");
    expect(fila.distrito).toBe("San Rafael");
    expect(fila.mensajero).toBe("Luis Mora");
    // Etiqueta legible del estatus, no el `value` máquina ni el uuid.
    expect(fila.estatus).toBe("Entregada");

    // Sin relaciones resueltas cae a los escalares legibles, nunca a un id.
    const escalares = filaDescargaOrden(
      makeOrden({ relaciones: undefined, zonaNombre: "Zona Sur" }),
    );
    expect(escalares.tienda).toBe("Tienda X");
    expect(escalares.zona).toBe("Zona Sur");
    expect(escalares.estatus).toBe("Entregada");

    const orden = makeOrden();
    const ids = [
      orden.id,
      orden.tiendaId,
      orden.zonaId,
      orden.provinciaId,
      orden.cantonId,
      orden.distritoId,
      orden.estatusId,
      "mens-uuid",
    ];
    for (const celda of Object.values(fila)) {
      expect(ids).not.toContain(celda);
    }
  });

  it("no expone identificadores internos ni banderas de borrado", () => {
    const fila = filaDescargaOrden(makeOrden());
    const prohibidas = [
      "id",
      "tiendaId",
      "zonaId",
      "provinciaId",
      "cantonId",
      "distritoId",
      "estatusId",
      "mensajeroAsignadoId",
      "deletedAt",
      "telefonoDest",
      "notas",
      "peso",
      "updatedAt",
      "relaciones",
    ];

    for (const clave of prohibidas) {
      expect(CLAVES).not.toContain(clave);
      expect(fila).not.toHaveProperty(clave);
    }

    expect(COLUMNAS_DESCARGA_ORDENES.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Destinatario",
      "Producto",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
      "Mensajero",
      "Intentos",
      "Fecha de creación",
    ]);
  });

  it("declara sus CLAVES en el mismo orden que sus encabezados (R5/R35)", () => {
    // El agujero que este caso tapa, censado por la 189: el test de arriba fija los quince
    // ENCABEZADOS en orden, pero de las claves solo se dice qué NO están (`CLAVES` solo se usa
    // con `not.toContain`). Una permuta se detecta por el encabezado, sí; pero renombrar la
    // `clave` de una columna sin tocar su encabezado no lo veía nadie —y la clave es lo que
    // indexa la fila que devuelve `filaDescargaOrden`, así que ese cambio vacía la columna en
    // silencio: el archivo sale con su cabecera puesta y las celdas en blanco—.
    //
    // Esperado escrito a mano, nunca derivado de la constante. La lista va en el MISMO orden
    // que los encabezados de arriba, y eso es parte de lo que se afirma: `estatus` es la
    // tercera clave y «Estado» el tercer encabezado.
    expect(COLUMNAS_DESCARGA_ORDENES.map((c) => c.clave)).toEqual([
      "numGuia",
      "numRemision",
      "estatus",
      "destinatario",
      "producto",
      "direccion",
      "tienda",
      "zona",
      "provincia",
      "canton",
      "distrito",
      "montoCobrar",
      "mensajero",
      "intentos",
      "fechaCreacion",
    ]);
  });
});
