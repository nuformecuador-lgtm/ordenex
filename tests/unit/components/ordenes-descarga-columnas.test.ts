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
    // FICHA 314 — `telefonoDest`, `notas` y `peso` SALEN de esta lista, y solo esas tres. No
    // son identificadores internos ni banderas de borrado: son datos de la orden que el humano
    // decidió publicar el 2026-08-28 (requirements R11). Lo que esta lista protege de verdad
    // —los ids de fila y de relación, `deletedAt`, `updatedAt` y el objeto `relaciones` en
    // crudo— se queda entero, y la guardia
    // `tests/unit/descarga/columnas-sensibles.guardia.test.ts` lo comprueba además sola, con
    // su sonda, sobre TODOS los módulos de columnas del árbol.
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
      "updatedAt",
      "relaciones",
    ];

    for (const clave of prohibidas) {
      expect(CLAVES).not.toContain(clave);
      expect(fila).not.toHaveProperty(clave);
    }

    // Los 22 encabezados, en su orden y escritos a mano: son CONTRATO. Es lo que el usuario
    // recibe por correo y lo que lee quien procesa la hoja.
    expect(COLUMNAS_DESCARGA_ORDENES.map((c) => c.encabezado)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Destinatario",
      "Teléfono del destinatario",
      "Producto",
      "Peso (kg)",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
      "Flete + IVA",
      "Comisión + IVA",
      "Mensajero",
      "Intentos",
      "Fecha de creación",
      "Día de reparto",
      "Fecha de reprogramación",
      "Notas de la tienda",
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
      "telefonoDest",
      "producto",
      "peso",
      "direccion",
      "tienda",
      "zona",
      "provincia",
      "canton",
      "distrito",
      "montoCobrar",
      "fleteConIva",
      "comisionConIva",
      "mensajero",
      "intentos",
      "fechaCreacion",
      "fechaReparto",
      "fechaReprogramacion",
      "notas",
    ]);
  });

  // -------------------------------------------------------------------------
  // Ficha 314 — las siete columnas nuevas
  // -------------------------------------------------------------------------

  it("R17 — las quince columnas de hoy conservan su orden RELATIVO entre sí", () => {
    // Las siete altas se intercalan por afinidad (el teléfono junto al destinatario, el peso
    // junto al producto, los importes junto al monto, las fechas junto a la de creación), así
    // que las posiciones ABSOLUTAS se desplazan — eso está ratificado. Lo que no puede moverse
    // es el orden entre las que ya existían: quien lea la hoja de izquierda a derecha tiene
    // que reconocerla. Se afirma como SUBSECUENCIA, que es exactamente lo que R17 dice.
    const DE_HOY = [
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
    ];

    const posiciones = DE_HOY.map((clave) => CLAVES.indexOf(clave));
    // Ninguna de las quince desapareció…
    expect(posiciones.filter((p) => p < 0)).toEqual([]);
    // …y sus posiciones son estrictamente crecientes: siguen en el mismo orden entre sí.
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
  });

  it("R12 — los dos importes salen como el MISMO string que trae el servidor", () => {
    // Feature 204: llegan derivados en el servidor con `Prisma.Decimal`, serializados como
    // string de escala 2. Aquí solo se copian. Un `Number("1129.50")` daría `1129.5` y perdería
    // el céntimo de escala; peor aún, derivarlos en el navegador ya costó 14 de 66 órdenes
    // desviadas un céntimo del cierre. La celda es TEXTO y Excel no la autosuma: consecuencia
    // aceptada por el humano el 2026-08-28, igual que en el resto de descargas de dinero.
    const fila = filaDescargaOrden(
      makeOrden({ fleteConIva: "1129.50", comisionConIva: "0.00" }),
    );

    expect(fila.fleteConIva).toBe("1129.50");
    expect(typeof fila.fleteConIva).toBe("string");
    expect(fila.fleteConIva).not.toBe(1129.5);
    expect(fila.comisionConIva).toBe("0.00");
    expect(typeof fila.comisionConIva).toBe("string");
    // El "0.00" es un importe CONOCIDO (sin tarifa vigente el importe es cero), no un dato
    // ausente: no se puede confundir con celda vacía.
    expect(fila.comisionConIva).not.toBeNull();
  });

  it("R13 — el día de reparto y la fecha de reprogramación salen idénticos, sin construir fecha alguna", () => {
    // El repositorio ya las serializa como `YYYY-MM-DD`. Construir aquí una fecha con un
    // `@db.Date` —medianoche UTC— y formatearla con la hora local devuelve el día ANTERIOR en
    // media América. Se afirma la IDENTIDAD del string, que es lo que mata esa mutación.
    const fila = filaDescargaOrden(
      makeOrden({
        fechaRepartoISO: "2026-01-01",
        fechaReprogramacion: "2026-01-01",
      }),
    );

    expect(fila.fechaReparto).toBe("2026-01-01");
    expect(fila.fechaReprogramacion).toBe("2026-01-01");
    // Y no se coló un `Date` disfrazado: la celda es string, no objeto.
    expect(typeof fila.fechaReparto).toBe("string");
    expect(typeof fila.fechaReprogramacion).toBe("string");

    // Otro día del mismo mes, para que la aserción no pase por casualidad con una constante.
    const otra = filaDescargaOrden(makeOrden({ fechaRepartoISO: "2026-08-31" }));
    expect(otra.fechaReparto).toBe("2026-08-31");
  });

  it("R14 — las siete columnas nuevas sin dato emiten celda vacía, nunca el guion de pantalla", () => {
    const NUEVAS = [
      "telefonoDest",
      "peso",
      "fleteConIva",
      "comisionConIva",
      "fechaReparto",
      "fechaReprogramacion",
      "notas",
    ];

    const vacia = filaDescargaOrden(
      makeOrden({
        telefonoDest: undefined as unknown as string,
        peso: null,
        notas: null,
        fleteConIva: undefined,
        comisionConIva: undefined,
        fechaRepartoISO: null,
        fechaReprogramacion: null,
      }),
    );

    for (const clave of NUEVAS) {
      // Premisa: la columna existe. Si alguien la retira, este caso no debe pasar por omisión.
      expect(CLAVES, `${clave} no está declarada`).toContain(clave);
      expect(vacia[clave], clave).toBeNull();
      expect(vacia[clave], clave).not.toBe("—");
      expect(vacia[clave], clave).not.toBeUndefined();
    }
  });

  it("R11 — las siete columnas nuevas viajan con el dato de la orden, no con un id", () => {
    // Contraste positivo del caso anterior: con dato, la celda ES el dato del DTO.
    const orden = makeOrden({
      telefonoDest: "0988887777",
      peso: 2.75,
      notas: "Entregar después de las 3",
      fleteConIva: "560.75",
      comisionConIva: "89.10",
      fechaRepartoISO: "2026-08-30",
      fechaReprogramacion: "2026-09-02",
    });
    const fila = filaDescargaOrden(orden);

    expect(fila.telefonoDest).toBe("0988887777");
    expect(fila.peso).toBe(2.75);
    expect(typeof fila.peso).toBe("number"); // la unidad va en el encabezado, no en la celda
    expect(fila.notas).toBe("Entregar después de las 3");
    expect(fila.fleteConIva).toBe("560.75");
    expect(fila.comisionConIva).toBe("89.10");
    expect(fila.fechaReparto).toBe("2026-08-30");
    expect(fila.fechaReprogramacion).toBe("2026-09-02");
  });
});
