// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { DataTable } from "@/components/shared/DataTable";
import {
  ordenesColumns,
  ordenesColumnsReprogramada,
} from "@/app/(app)/ordenes/_components/ordenes-columns";
import { INTENTOS_COLUMN_ID } from "@/components/shared/intentos-entrega";
import type { OrdenListItemDTO, OrdenListItemRelaciones } from "@/lib/types/orden";

afterEach(() => {
  cleanup();
});

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    numRemision: "REM-000",
    estatusId: "est-id",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ordenesColumns — R30 (numGuia nullable en el listado)", () => {
  it("muestra 'Pendiente' cuando numGuia es null (orden aún sin guía)", () => {
    const orden = makeOrden({ id: "o1", numGuia: null, numRemision: "REM-001" });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-001/ });
    expect(within(fila).getByText("Pendiente")).toBeInTheDocument();
    expect(within(fila).queryByText("null")).toBeNull();
  });

  it("muestra el número de guía cuando ya fue asignado (no null)", () => {
    const orden = makeOrden({ id: "o1", numGuia: 4321, numRemision: "REM-002" });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-002/ });
    expect(within(fila).getByText("4321")).toBeInTheDocument();
    expect(within(fila).queryByText("Pendiente")).toBeNull();
  });
});

describe("ordenesColumns — feature 30 (R14: columna de zona)", () => {
  it("R14: renderiza el nombre de la zona (zonaNombre) en la fila", () => {
    const orden = makeOrden({
      id: "o1",
      numRemision: "REM-Z1",
      zonaNombre: "Limón",
    });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    // Encabezado de la columna presente.
    expect(
      screen.getByRole("columnheader", { name: "Zona" }),
    ).toBeInTheDocument();
    const fila = screen.getByRole("row", { name: /REM-Z1/ });
    expect(within(fila).getByText("Limón")).toBeInTheDocument();
  });
});

describe("ordenesColumns — feature 30 (R15: estado ruteado legible por zona)", () => {
  it("R15: una fila en_ruta_bodega_satelite se lee 'En ruta a bodega <zona>' con el nombre real", () => {
    const orden = makeOrden({
      id: "o1",
      numRemision: "REM-S1",
      estatusValue: "en_ruta_bodega_satelite",
      zonaNombre: "Guápiles",
    });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-S1/ });
    expect(
      within(fila).getByText("En ruta a bodega Guápiles"),
    ).toBeInTheDocument();
    // No debe caer al label estático genérico "satélite".
    expect(
      within(fila).queryByText("En ruta a bodega satélite"),
    ).toBeNull();
  });
});

// La tab `reprogramada` añade "Liberada el": el día para el que quedó reprogramada
// la orden (= cuando el cron de liberación la desbloquea, feature 46). El valor
// llega del repo ya como `YYYY-MM-DD`; se renderiza tal cual, sin reinterpretarlo
// como Date en el cliente (eso reintroduciría el off-by-one de zona horaria).
describe("ordenesColumnsReprogramada — columna 'Liberada el'", () => {
  it("añade la columna al final, sin perder ninguna de las base", () => {
    expect(ordenesColumnsReprogramada.length).toBe(ordenesColumns.length + 1);
    expect(ordenesColumnsReprogramada.at(-1)?.id).toBe("liberada");
    // Las base se conservan en su orden original.
    expect(ordenesColumnsReprogramada.slice(0, -1)).toEqual(ordenesColumns);
  });

  it("muestra la fecha de reprogramación tal cual la sirve el repo", () => {
    const orden = makeOrden({ id: "o1", fechaReprogramacion: "2026-07-20" });
    render(
      <DataTable
        columns={ordenesColumnsReprogramada}
        data={[orden]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );

    const fila = screen.getAllByRole("row")[1];
    expect(within(fila).getByText("2026-07-20")).toBeInTheDocument();
  });

  it("muestra el placeholder si la orden no tiene gestión de reprogramación vigente", () => {
    const orden = makeOrden({ id: "o1", fechaReprogramacion: null });
    render(
      <DataTable
        columns={ordenesColumnsReprogramada}
        data={[orden]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );

    // Por índice de celda: otras columnas también usan "—" como placeholder, así
    // que buscar el texto suelto no distingue cuál es. Es la última columna.
    const fila = screen.getAllByRole("row")[1];
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas.at(-1)).toHaveTextContent("—");
  });

  it("las columnas base NO incluyen 'Liberada el' (solo la tab reprogramada)", () => {
    expect(ordenesColumns.some((c) => c.id === "liberada")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------
// Feature 160 (T16) — el conteo de intentos de entrega como COLUMNA propia (D6/R17),
// insertada INMEDIATAMENTE despues de `estatus` (design §5.2) y no al final. Los tres
// asserts de "ordenesColumnsReprogramada — columna 'Liberada el'" de mas arriba
// (length + 1, ultima = `liberada`, `slice(0,-1)` = base) siguen verdes SIN tocarlos:
// insertar en el medio no cambia ninguna de esas tres verdades. Esa compatibilidad es
// una de las tres razones por las que la posicion es esa.
// ---------------------------------------------------------------------------------

/** Ids de las 18 columnas PREEXISTENTES, en su orden original (R21). */
const IDS_PREEXISTENTES = [
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
  "flete",
  "fulfillment",
  "comision",
  "mensajero",
  "fechaCreacion",
  "tiempo",
];

/** Encabezados de esas 18, en el mismo orden. */
const HEADERS_PREEXISTENTES = [
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
  "Flete + IVA",
  "Fulfillment",
  "Comisión + IVA",
  "Mensajero",
  "Fecha de creación",
  "Tiempo",
];

describe("ordenesColumns — feature 160 (R21: posicion e integridad de la columna)", () => {
  it("R21: la columna nueva va JUSTO DESPUES de `estatus`, no al final", () => {
    const idx = ordenesColumns.findIndex((c) => c.id === INTENTOS_COLUMN_ID);
    const idxEstatus = ordenesColumns.findIndex((c) => c.id === "estatus");
    expect(idx).toBe(idxEstatus + 1);
    // Posicion fija y determinista (4.a de 19), no "en algun sitio".
    expect(idx).toBe(3);
    // Y explicitamente NO al final: ahi quedaria fuera del viewport (design §7.7).
    expect(ordenesColumns.at(-1)?.id).toBe("tiempo");
  });

  it("R21: ids, encabezados y orden relativo de las 18 preexistentes, intactos", () => {
    const sinIntentos = ordenesColumns.filter((c) => c.id !== INTENTOS_COLUMN_ID);
    expect(sinIntentos.map((c) => c.id)).toEqual(IDS_PREEXISTENTES);
    expect(sinIntentos.map((c) => c.value)).toEqual(HEADERS_PREEXISTENTES);
    // Y la tabla queda con 19 columnas: las 18 de siempre + la nueva, ni una mas.
    expect(ordenesColumns).toHaveLength(IDS_PREEXISTENTES.length + 1);
  });

  // Este caso hablaba de TRES variantes derivadas. La del dashboard del adminTienda dejó de
  // existir el 2026-08-10 (pedido humano: esa pantalla se retiró y su archivo de columnas
  // con ella), así que ahora cubre las que quedan. Lo que afirma —que una variante derivada
  // hereda la columna sin tocar su archivo— no cambia; cambia cuántas hay.
  it("R22: las variantes derivadas heredan la columna sin tocar sus archivos", () => {
    // `reprogramada` deriva por spread.
    expect(
      ordenesColumnsReprogramada.some((c) => c.id === INTENTOS_COLUMN_ID),
    ).toBe(true);
    // Y sigue en la misma posicion relativa: justo tras `estatus`.
    expect(
      ordenesColumnsReprogramada.findIndex((c) => c.id === INTENTOS_COLUMN_ID),
    ).toBe(ordenesColumnsReprogramada.findIndex((c) => c.id === "estatus") + 1);
  });
});

describe("ordenesColumns — feature 160 (R17/R19: el numero, siempre, incluido el 0)", () => {
  /** Indice de celda de la columna de intentos (= su indice de columna). */
  const IDX_INTENTOS = 3;
  const IDX_ESTATUS = 2;

  it("R17: la tabla monta un columnheader 'Intentos'", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[makeOrden({ id: "o1", intentosEntrega: 2 })]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
  });

  it("R19: una fila con 2 intentos muestra 2 en SU celda", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[makeOrden({ id: "o1", numRemision: "REM-I2", intentosEntrega: 2 })]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celdas = within(
      screen.getByRole("row", { name: /REM-I2/ }),
    ).getAllByRole("cell");
    expect(celdas[IDX_INTENTOS]).toHaveTextContent(/^2$/);
  });

  it("R19: una fila con 0 intentos muestra 0 — ni celda vacia ni el placeholder '—'", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[makeOrden({ id: "o1", numRemision: "REM-I0", intentosEntrega: 0 })]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celda = within(
      screen.getByRole("row", { name: /REM-I0/ }),
    ).getAllByRole("cell")[IDX_INTENTOS];
    expect(celda).toHaveTextContent(/^0$/);
    expect(celda.textContent).not.toBe("");
    expect(celda.textContent).not.toContain("—");
  });

  it("R19: una fila SIN el campo (fixture viejo) tambien muestra 0", () => {
    // `makeOrden` no pone `intentosEntrega`: es exactamente el caso del DTO que
    // no trae el campo opcional.
    render(
      <DataTable
        columns={ordenesColumns}
        data={[makeOrden({ id: "o1", numRemision: "REM-IX" })]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celda = within(
      screen.getByRole("row", { name: /REM-IX/ }),
    ).getAllByRole("cell")[IDX_INTENTOS];
    expect(celda).toHaveTextContent(/^0$/);
  });

  it("R17: el numero NO se incrusta en la celda de estado (no es un chip)", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-IC",
            estatusValue: "devuelta",
            intentosEntrega: 3,
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celdas = within(
      screen.getByRole("row", { name: /REM-IC/ }),
    ).getAllByRole("cell");
    // La celda de estado sigue siendo solo el estado: ni un digito dentro.
    expect(celdas[IDX_ESTATUS].textContent ?? "").not.toMatch(/\d/);
    // El conteo vive en SU columna.
    expect(celdas[IDX_INTENTOS]).toHaveTextContent(/^3$/);
  });

  it("R20: la fila no muestra el umbral ('de N') en ninguna celda", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[makeOrden({ id: "o1", numRemision: "REM-IU", intentosEntrega: 2 })]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celda = within(
      screen.getByRole("row", { name: /REM-IU/ }),
    ).getAllByRole("cell")[IDX_INTENTOS];
    expect(celda.textContent).not.toMatch(/de\s*\d/);
  });

  it("R19: cada fila lleva SU numero (2, 0 y ausente conviven en la misma tabla)", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({ id: "o1", numRemision: "REM-M1", intentosEntrega: 2 }),
          makeOrden({ id: "o2", numRemision: "REM-M2", intentosEntrega: 0 }),
          makeOrden({ id: "o3", numRemision: "REM-M3" }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const celdaDe = (rem: string) =>
      within(screen.getByRole("row", { name: new RegExp(rem) })).getAllByRole(
        "cell",
      )[IDX_INTENTOS];
    expect(celdaDe("REM-M1")).toHaveTextContent(/^2$/);
    expect(celdaDe("REM-M2")).toHaveTextContent(/^0$/);
    expect(celdaDe("REM-M3")).toHaveTextContent(/^0$/);
  });
});

// Feature 159 (R16, R17) — la columna "Mensajero" muestra SIEMPRE el mensajero
// ASIGNADO. Antes caia al "sugerido" cuando no habia asignado, y el listado
// intercambiaba el juego de columnas segun el estado filtrado; ambas cosas se
// retiraron. Este test cubre las dos ramas de la columna.
describe("ordenesColumns — columna Mensajero (159/R16, R17)", () => {
  const IDX_MENSAJERO = ordenesColumns.findIndex((c) => c.id === "mensajero");

  /** `relaciones` completas (el DTO las exige todas) con el mensajero que se indique. */
  function relaciones(
    mensajeroAsignado: OrdenListItemRelaciones["mensajeroAsignado"],
  ): OrdenListItemRelaciones {
    return {
      estatus: null,
      tienda: null,
      zona: null,
      provincia: null,
      canton: null,
      distrito: null,
      mensajeroAsignado,
    };
  }

  const celdaMensajero = (rem: string) =>
    within(screen.getByRole("row", { name: new RegExp(rem) })).getAllByRole("cell")[
      IDX_MENSAJERO
    ];

  it("la columna existe una sola vez y no hay ninguna variante de 'sugerido'", () => {
    expect(IDX_MENSAJERO).toBeGreaterThan(-1);
    const deMensajero = ordenesColumns.filter((c) => /mensajero/i.test(c.value));
    expect(deMensajero).toHaveLength(1);
    expect(deMensajero[0].value).toBe("Mensajero");
  });

  it("R16: con mensajero asignado muestra su NOMBRE, no su id", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-MSG-1",
            mensajeroAsignadoId: "u-1",
            relaciones: relaciones({ id: "u-1", nombre: "Ana Mensajera" }),
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );

    expect(celdaMensajero("REM-MSG-1")).toHaveTextContent("Ana Mensajera");
    expect(celdaMensajero("REM-MSG-1")).not.toHaveTextContent("u-1");
  });

  it("R16: el otro juego de columnas (reprogramada) dice lo MISMO de 'Mensajero'", () => {
    // R16 exige el mensajero ASIGNADO "cualquiera que sea el estado". Solo queda un
    // juego alternativo de columnas (`reprogramada`, feature 46) y tambien muestra el
    // asignado: filtrar por un estado ya no cambia lo que dice esta columna.
    const enReprogramada = ordenesColumnsReprogramada.filter((c) => /mensajero/i.test(c.value));
    expect(enReprogramada).toHaveLength(1);
    expect(enReprogramada[0].value).toBe("Mensajero");

    const idxReprogramada = ordenesColumnsReprogramada.findIndex((c) => c.id === "mensajero");
    render(
      <DataTable
        columns={ordenesColumnsReprogramada}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-MSG-R",
            mensajeroAsignadoId: "u-1",
            relaciones: relaciones({ id: "u-1", nombre: "Ana Mensajera" }),
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );

    const fila = screen.getByRole("row", { name: /REM-MSG-R/ });
    expect(within(fila).getAllByRole("cell")[idxReprogramada]).toHaveTextContent(
      "Ana Mensajera",
    );
  });

  it("R17: sin mensajero asignado muestra el marcador de dato ausente", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({ id: "o1", numRemision: "REM-MSG-2", relaciones: relaciones(null) }),
          makeOrden({ id: "o2", numRemision: "REM-MSG-3" }), // sin `relaciones` siquiera
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );

    expect(celdaMensajero("REM-MSG-2")).toHaveTextContent(/^—$/);
    expect(celdaMensajero("REM-MSG-3")).toHaveTextContent(/^—$/);
  });
});

// ---------------------------------------------------------------------------------------
// Feature 204 — las dos columnas de dinero DERIVADO pintan el STRING del servidor y NO lo
// recalculan.
//
// El bug que cierra esta ficha no era teórico: sobre las 66 órdenes con tarifa activa de la
// base, 14 se veían un céntimo desviadas de lo que factura el cierre, porque estas dos
// celdas multiplicaban aquí los `number` de la tarifa. Por eso el bloque no se conforma con
// comprobar que se pinta el valor bueno: monta filas cuya TARIFA daría otro número si
// alguien volviera a calcular en el navegador, y afirma que la celda no se inmuta.
// ---------------------------------------------------------------------------------------
describe("ordenesColumns — feature 204 (el dinero derivado llega hecho del servidor)", () => {
  const IDX_FLETE = ordenesColumns.findIndex((c) => c.id === "flete");
  const IDX_COMISION = ordenesColumns.findIndex((c) => c.id === "comision");
  const IDX_MONTO = ordenesColumns.findIndex((c) => c.id === "montoCobrar");
  const IDX_FULFILLMENT = ordenesColumns.findIndex((c) => c.id === "fulfillment");

  /** La tarifa REAL de la base, tal y como la sirve el DTO (Decimal -> number). */
  function conTarifa(): OrdenListItemRelaciones {
    return {
      estatus: null,
      tienda: {
        id: "t1",
        nombre: "Tienda Uno",
        email: "t@ordenex.co",
        telefono: "0990000001",
        tarifa: {
          id: "tar-1",
          tiendaId: "t1",
          valorFlete: 3000,
          valorFleteDevuelto: 1500,
          valorFleteGam: 2000,
          valorFleteDevueltoGam: 1000,
          fulfillment: 250.5,
          comisionCod: 3.5,
          ivaFlete: 13,
          ivaComisionCod: 13,
          tarifaEspecial: null,
          tarifaEspecialDevuelta: null,
          zonaId: null,
          isDefault: false,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      },
      zona: { id: "z1", nombre: "Limón", esCentral: false },
      provincia: null,
      canton: null,
      distrito: null,
      mensajeroAsignado: null,
    };
  }

  const celdas = (rem: string) =>
    within(screen.getByRole("row", { name: new RegExp(rem) })).getAllByRole("cell");

  it("pinta el STRING derivado del servidor, con el formato de la app", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-204-A",
            montoCobrar: 14900,
            cobraComision: true,
            relaciones: conTarifa(),
            fleteConIva: "3390.00",
            comisionConIva: "589.30",
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const fila = celdas("REM-204-A");
    // FICHA 359: el flete llega redondo (`3390.00`) y se pinta pelado; la comisión
    // llega con cola (`589.30`) y la enseña. Es el reparto que la medición de
    // producción encontró: 0 de 577 fletes con céntimos, 577 de 577 comisiones.
    expect(fila[IDX_FLETE]).toHaveTextContent(/^₡3\.390$/);
    expect(fila[IDX_COMISION]).toHaveTextContent(/^₡589,30$/);
  });

  it("NO recalcula: con la MISMA tarifa, la celda sigue al servidor aunque el número cambie", () => {
    // Las dos filas comparten tarifa y monto. Solo cambia lo que dice el servidor. Si la
    // celda volviera a derivar en el navegador, las dos pintarían lo mismo y este test caería.
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-204-B1",
            montoCobrar: 16618.4,
            cobraComision: true,
            relaciones: conTarifa(),
            fleteConIva: "3390.00",
            comisionConIva: "657.25", // lo que factura el cierre
          }),
          makeOrden({
            id: "o2",
            numRemision: "REM-204-B2",
            montoCobrar: 16618.4,
            cobraComision: true,
            relaciones: conTarifa(),
            fleteConIva: "1.23",
            comisionConIva: "4.56",
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    // ✅ FICHA 359 — LA AFIRMACIÓN QUE LA 230 PERDIÓ, RECUPERADA. Esta línea decía
    // originalmente «₡657,25 y NO el 657,26 que salía de multiplicar en el
    // navegador»: el céntimo EXACTO era la huella del cálculo del cliente, y era
    // lo que la feature 204 vino a cerrar. La 230 la degradó a `₡657` —los dos
    // valores se pintaban igual y la huella desaparecía de la pantalla— y lo dejó
    // escrito aquí como pérdida consciente. Con la cola visible el caso vuelve a
    // ser el fuerte: `657.25` y `657.26` se distinguen a simple vista.
    expect(celdas("REM-204-B1")[IDX_COMISION]).toHaveTextContent(/^₡657,25$/);
    expect(celdas("REM-204-B1")[IDX_COMISION]).not.toHaveTextContent(/657,26/);
    // La otra mitad del caso, intacta: dos filas con la MISMA tarifa y el MISMO
    // monto pintan importes distintos porque el SERVIDOR dice cosas distintas.
    // El resto de la red de la 204 vive donde sí puede vivir:
    // `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`, que prohíbe
    // que estas tablas vuelvan a NOMBRAR los campos de la tarifa —sin nombrarlos no
    // se puede recalcular— y barre las conversiones sobre el fuente.
    expect(celdas("REM-204-B2")[IDX_FLETE]).toHaveTextContent(/^₡1,23$/);
    expect(celdas("REM-204-B2")[IDX_COMISION]).toHaveTextContent(/^₡4,56$/);
    expect(celdas("REM-204-B1")[IDX_COMISION].textContent).not.toBe(
      celdas("REM-204-B2")[IDX_COMISION].textContent,
    );
  });

  it("NO recalcula: destrozar la tarifa de la fila no mueve ninguna de las dos celdas", () => {
    // Misma fila, tarifa absurda. Antes de la 204 esto cambiaba los dos importes.
    const rota = conTarifa();
    rota.tienda!.tarifa = {
      ...rota.tienda!.tarifa!,
      valorFlete: 999999,
      comisionCod: 99,
      ivaFlete: 99,
      ivaComisionCod: 99,
    };
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-204-C",
            montoCobrar: 14900,
            cobraComision: true,
            relaciones: rota,
            fleteConIva: "3390.00",
            comisionConIva: "589.30",
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const fila = celdas("REM-204-C");
    expect(fila[IDX_FLETE]).toHaveTextContent(/^₡3\.390$/);
    expect(fila[IDX_COMISION]).toHaveTextContent(/^₡589,30$/);
  });

  it("un DTO viejo sin los campos cae a ₡0, no a un cálculo de emergencia", () => {
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-204-D",
            montoCobrar: 14900,
            cobraComision: true,
            relaciones: conTarifa(), // hay tarifa, pero el DTO no trae los derivados
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const fila = celdas("REM-204-D");
    expect(fila[IDX_FLETE]).toHaveTextContent(/^₡0$/);
    expect(fila[IDX_COMISION]).toHaveTextContent(/^₡0$/);
  });

  it("las otras dos columnas de dinero (monto y fulfillment) siguen intactas", () => {
    // R21 de la 204: la ficha toca las dos DERIVADAS. `montoCobrar` y `fulfillment` son
    // valores de la fila que solo se formatean, y se quedan como estaban.
    render(
      <DataTable
        columns={ordenesColumns}
        data={[
          makeOrden({
            id: "o1",
            numRemision: "REM-204-E",
            montoCobrar: 16618.4,
            relaciones: conTarifa(),
            fleteConIva: "3390.00",
            comisionConIva: "657.25",
          }),
        ]}
        rowKey="id"
        ariaLabel="Órdenes"
      />,
    );
    const fila = celdas("REM-204-E");
    expect(fila[IDX_MONTO]).toHaveTextContent(/^₡16\.618,40$/);
    expect(fila[IDX_FULFILLMENT]).toHaveTextContent(/^₡250,50$/);
  });
});

