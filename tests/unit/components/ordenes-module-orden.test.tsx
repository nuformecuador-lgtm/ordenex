// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// FICHA 356 + FICHA 423 — EL ORDEN DENTRO DE `OrdenesModule`: caché, paginación y las dos
// notas de la tabla.
//
// Los dos primeros bloques cubren los dos fallos MUDOS de este cambio: el control puesto y las
// filas sin moverse (caché), y el control puesto sobre un tramo arbitrario del conjunto
// (página). Ninguno de los dos rompe nada por su cuenta — ni un error, ni un hueco, ni una
// excepción—, así que si no están aquí no están en ninguna parte. La 423 los repite para el
// CAMPO, que es una segunda dimensión de la misma clave (R11, R12), y añade las dos notas:
// la de prioridad nombrando el campo vigente (R14) y el aviso de series (R20).
//
// LOS TEXTOS ESPERADOS VAN ESCRITOS A MANO y no importados del módulo que los genera: derivarlos
// dejaría estos casos verdes por construcción (memoria del repo: «aserción contra su propia
// fuente»).

/** La nota de prioridad con cada uno de los dos campos, palabra por palabra. */
const NOTA_PRIORIDAD_FECHA =
  "Las órdenes prioritarias se muestran primero; el resto sigue el orden por fecha de creación.";
const NOTA_PRIORIDAD_REMISION =
  "Las órdenes prioritarias se muestran primero; el resto sigue el orden por número de remisión.";
/** El aviso de agrupación por serie (R20), palabra por palabra. */
const NOTA_SERIES =
  "Las remisiones se agrupan por serie: las que comparten prefijo van juntas, y dentro de cada serie manda el número, no el texto.";

/**
 * El texto del `<caption>` de la tabla. Las dos notas conviven ahí —dicen cosas distintas sobre
 * el mismo listado—, así que se lee el hueco entero y se comprueba qué contiene.
 */
function textoCaption(): string {
  return document.querySelector("caption")?.textContent ?? "";
}

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";

function makeOrden(
  id: string,
  numGuia: number,
  extra: Partial<OrdenListItemDTO> = {},
): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-1",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
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
    ...extra,
  } as OrdenListItemDTO;
}

/** La guía que sólo aparece pidiendo «Más recientes» (`desc`). */
const GUIA_RECIENTE = 9001;
/** La guía que sólo aparece pidiendo «Más antiguas» (`asc`). */
const GUIA_ANTIGUA = 1002;

/**
 * El doble del servidor RESPETA el orden pedido: devuelve un juego de filas distinto para
 * `asc` que para `desc`. Sin esto, "el control funciona" se podría afirmar con una caché
 * servida al revés, que es justo lo que se quiere descartar.
 */
function servidorQueOrdena(total = 60) {
  listarOrdenesMock.mockImplementation(
    async (input: { sortDir?: string; page?: number }) => ({
      status: "ok",
      items:
        input?.sortDir === "asc"
          ? [makeOrden("vieja", GUIA_ANTIGUA)]
          : [makeOrden("nueva", GUIA_RECIENTE)],
      page: input?.page ?? 1,
      pageSize: 25,
      total,
    }),
  );
}

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Re-renderiza dentro del MISMO proveedor de caché: cambiar de proveedor lo probaría todo. */
function rerenderModule(
  rerender: (ui: ReactElement) => void,
  ui: ReactElement,
) {
  rerender(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** La ÚLTIMA entrada con la que se llamó a `listarOrdenes`. */
function ultimaLlamada(): {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
  filter?: Record<string, unknown>;
} {
  return listarOrdenesMock.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  servidorQueOrdena();
});

afterEach(() => cleanup());

describe("OrdenesModule — el orden viaja al servidor", () => {
  it("manda `sortBy`/`sortDir` tal como se los dieron", async () => {
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      sortBy: "created_at",
      sortDir: "asc",
    });
  });

  it("SIN la prop `orden` no manda ninguna clave de ordenamiento (superficies intactas)", async () => {
    renderModule(<OrdenesModule />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("el orden convive con el filtro en la MISMA entrada", async () => {
    renderModule(
      <OrdenesModule
        filter={{ zona_id: ["z1"] }}
        orden={{ sortBy: "created_at", sortDir: "desc" }}
      />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      filter: { zona_id: ["z1"] },
      sortBy: "created_at",
      sortDir: "desc",
    });
  });
});

describe("OrdenesModule — el orden está en la KEY de caché", () => {
  /**
   * EL TEST QUE ATA LA CLAVE. Quitar `claveDeOrden` de la key de SWR deja este caso rojo por
   * las dos vías a la vez: no hay segunda consulta (misma key = respuesta cacheada) y la
   * tabla sigue enseñando la fila de «Más recientes» con el control puesto en «Más antiguas».
   * Es el fallo que haría parecer roto el control sin romper ningún otro test.
   */
  it("cambiar de dirección vuelve a consultar Y repinta las filas del nuevo orden", async () => {
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    expect(await screen.findByText(String(GUIA_RECIENTE))).toBeInTheDocument();
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );

    expect(await screen.findByText(String(GUIA_ANTIGUA))).toBeInTheDocument();
    expect(screen.queryByText(String(GUIA_RECIENTE))).not.toBeInTheDocument();
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2));
    expect(ultimaLlamada().sortDir).toBe("asc");
  });

  it("volver a la dirección anterior sirve SU respuesta, no la del otro orden", async () => {
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await screen.findByText(String(GUIA_RECIENTE));

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    await screen.findByText(String(GUIA_ANTIGUA));

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    expect(await screen.findByText(String(GUIA_RECIENTE))).toBeInTheDocument();
  });

  it("el MISMO orden no dispara una consulta nueva (la key es un escalar estable)", async () => {
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));

    // Otro objeto, mismo valor: la identidad no puede decidir si se vuelve a consultar.
    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);
  });
});

describe("OrdenesModule — cambiar el orden vuelve a la página 1", () => {
  it("desde la página 2, cambiar de dirección pide la 1", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(ultimaLlamada().page).toBe(1);
  });

  it("cambiar el orden NO desmarca las filas seleccionadas", async () => {
    // El conjunto es el mismo, sólo cambia el reparto entre páginas: la selección acumulada
    // sigue siendo válida. (Distinto del cambio de FILTRO, que sí la limpia.)
    const user = userEvent.setup();
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden("o1", 1001)],
      page: 1,
      pageSize: 25,
      total: 60,
    });
    const { rerender } = renderModule(
      <OrdenesModule
        orden={{ sortBy: "created_at", sortDir: "desc" }}
        selectable
        acciones={[]}
      />,
    );
    await screen.findByText("1001");
    await user.click(
      screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
    ).toBeChecked();

    rerenderModule(
      rerender,
      <OrdenesModule
        orden={{ sortBy: "created_at", sortDir: "asc" }}
        selectable
        acciones={[]}
      />,
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(
      screen.getByRole("checkbox", { name: /Seleccionar orden REM-o1/ }),
    ).toBeChecked();
  });
});

describe("OrdenesModule — el aviso de `prioridad` primero", () => {
  function servidorConPrioritaria(prioridad: boolean) {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden("p1", 7001, { prioridad }),
        makeOrden("p2", 7002, { prioridad: false }),
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    });
  }

  it("con una orden prioritaria en la página, la tabla EXPLICA por qué va primero", async () => {
    servidorConPrioritaria(true);
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    expect(await screen.findByText(NOTA_PRIORIDAD_FECHA)).toBeInTheDocument();
  });

  it("sin ninguna prioritaria en la página, no se anuncia una regla invisible", async () => {
    servidorConPrioritaria(false);
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    await screen.findByText("7001");
    expect(screen.queryByText(NOTA_PRIORIDAD_FECHA)).not.toBeInTheDocument();
  });

  it("sin control de orden en la superficie, tampoco se anuncia", async () => {
    servidorConPrioritaria(true);
    renderModule(<OrdenesModule />);
    await screen.findByText("7001");
    expect(screen.queryByText(NOTA_PRIORIDAD_FECHA)).not.toBeInTheDocument();
  });

  it("el nombre accesible de la tabla sigue siendo «Órdenes» con el aviso puesto", async () => {
    servidorConPrioritaria(true);
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    await screen.findByText(NOTA_PRIORIDAD_FECHA);
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });
});

describe("OrdenesModule — la nota de prioridad nombra el campo VIGENTE (R14)", () => {
  function servidorConPrioritaria() {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden("p1", 7001, { prioridad: true }),
        makeOrden("p2", 7002, { prioridad: false }),
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    });
  }

  it("con el orden por REMISIÓN la nota habla de la remisión, no de la fecha", async () => {
    // EL DEFECTO QUE R14 ARREGLA: la constante de la 356 nombraba la fecha fija, así que con
    // el orden por remisión puesto la tabla explicaba un listado que no era el que había
    // delante. Una explicación falsa es peor que ninguna.
    servidorConPrioritaria();
    renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await screen.findByText("7001");
    expect(textoCaption()).toContain(NOTA_PRIORIDAD_REMISION);
    expect(textoCaption()).not.toContain(NOTA_PRIORIDAD_FECHA);
  });

  it("y con el orden por FECHA sigue diciendo lo de siempre", async () => {
    servidorConPrioritaria();
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "asc" }} />,
    );
    await screen.findByText("7001");
    expect(textoCaption()).toContain(NOTA_PRIORIDAD_FECHA);
    expect(textoCaption()).not.toContain(NOTA_PRIORIDAD_REMISION);
  });
});

describe("OrdenesModule — cambiar de CAMPO es una petición nueva (R11, R12)", () => {
  /** Un juego de filas distinto por campo: la caché servida al revés se vería. */
  function servidorQueDistingueElCampo() {
    listarOrdenesMock.mockImplementation(
      async (input: { sortBy?: string; page?: number }) => ({
        status: "ok",
        items:
          input?.sortBy === "num_remision"
            ? [makeOrden("porRemision", 5001)]
            : [makeOrden("porFecha", 4001)],
        page: input?.page ?? 1,
        pageSize: 25,
        total: 60,
      }),
    );
  }

  it("R12 — elegir la remisión vuelve a consultar y NO enseña el resultado de la fecha", async () => {
    // Sin `sortBy` en la key de SWR, la respuesta del orden por fecha se serviría tal cual:
    // el control puesto en «Número de remisión» y las filas sin moverse. Fallo mudo.
    servidorQueDistingueElCampo();
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    expect(await screen.findByText("4001")).toBeInTheDocument();
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "desc" }} />,
    );

    expect(await screen.findByText("5001")).toBeInTheDocument();
    expect(screen.queryByText("4001")).not.toBeInTheDocument();
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2));
    expect(ultimaLlamada().sortBy).toBe("num_remision");
  });

  it("volver al campo anterior sirve SU respuesta, no la del otro campo", async () => {
    servidorQueDistingueElCampo();
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await screen.findByText("4001");

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "desc" }} />,
    );
    await screen.findByText("5001");

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    expect(await screen.findByText("4001")).toBeInTheDocument();
  });

  it("R11 — desde la página 3 por fecha, elegir la remisión pide la página 1", async () => {
    const user = userEvent.setup();
    servidorQueDistingueElCampo();
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(3));

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "desc" }} />,
    );

    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(ultimaLlamada().page).toBe(1);
  });

  it("el MISMO campo y dirección no disparan una consulta nueva", async () => {
    servidorQueDistingueElCampo();
    const { rerender } = renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));

    rerenderModule(
      rerender,
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(listarOrdenesMock).toHaveBeenCalledTimes(1);
  });
});

describe("OrdenesModule — el aviso de agrupación por serie (R20)", () => {
  /** Las series reales de producción, medidas el 2026-09-14. */
  function servidorConSeries(remisiones: string[], prioridad = false) {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: remisiones.map((numRemision, i) =>
        makeOrden(`s${i}`, 8000 + i, { numRemision, prioridad }),
      ),
      page: 1,
      pageSize: 25,
      total: remisiones.length,
    });
  }

  it("1) con el orden por remisión y VARIAS series en la página, se explica la agrupación", async () => {
    servidorConSeries(["NA-107", "72912", "BS-00001"]);
    renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await screen.findByText("8000");
    expect(textoCaption()).toContain(NOTA_SERIES);
  });

  it("2) con el orden por remisión y UNA sola serie, no se anuncia una regla invisible", async () => {
    // La mitad del requisito que un aviso permanente pasaría sin cumplir: sin dos series en
    // pantalla no hay agrupación que observar, y anunciarla obliga a preguntar qué es.
    servidorConSeries(["NA-107", "NA-1069", "NA-1863"]);
    renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await screen.findByText("8000");
    expect(textoCaption()).not.toContain(NOTA_SERIES);
  });

  it("3) con el orden por FECHA de creación, aunque haya varias series, no aparece", async () => {
    servidorConSeries(["NA-107", "72912", "BS-00001"]);
    renderModule(
      <OrdenesModule orden={{ sortBy: "created_at", sortDir: "desc" }} />,
    );
    await screen.findByText("8000");
    expect(textoCaption()).not.toContain(NOTA_SERIES);
  });

  it("sin control de orden en la superficie, tampoco se anuncia", async () => {
    servidorConSeries(["NA-107", "72912", "BS-00001"]);
    renderModule(<OrdenesModule />);
    await screen.findByText("8000");
    expect(textoCaption()).not.toContain(NOTA_SERIES);
  });

  it("convive con la nota de prioridad: las dos explican el mismo listado", async () => {
    servidorConSeries(["NA-107", "72912", "BS-00001"], true);
    renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await screen.findByText("8000");
    expect(textoCaption()).toContain(NOTA_PRIORIDAD_REMISION);
    expect(textoCaption()).toContain(NOTA_SERIES);
  });

  it("el nombre accesible de la tabla sigue siendo «Órdenes» con las dos notas puestas", async () => {
    servidorConSeries(["NA-107", "72912", "BS-00001"], true);
    renderModule(
      <OrdenesModule orden={{ sortBy: "num_remision", sortDir: "asc" }} />,
    );
    await screen.findByText("8000");
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });
});
