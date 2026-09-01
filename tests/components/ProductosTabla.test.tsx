// @vitest-environment jsdom
//
// FICHA 345 (T7.4) — la TABLA DE PRODUCTOS de `/analitica`.
//
// Cubre R28, R32, R33 (mitad de cliente), R36, R40, R41, R43, R44, R45 y R46.
//
// Lo que estos casos protegen, dicho de una vez: que la pantalla no INVENTE nada. Ni un orden
// propio (el del servicio es contrato), ni un porcentaje propio (`calcularEfectividad` es la
// única definición del tablero), ni una tabla vacía donde hubo un problema de permisos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  ProductosTabla,
  PRODUCTOS_COLUMNAS,
  PRODUCTOS_TEXTOS,
  hayVariasTiendas,
} from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "@/app/(app)/analitica/_components/operativo/textos";
import {
  FiltroEntregasProvider,
  useFiltroEntregas,
} from "@/app/(app)/_components/filtro-entregas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import { ToastProvider } from "@/providers/ToastProvider";
import type { ConteoProductosDTO, FilaProductoDTO } from "@/lib/types/conteo-productos";

vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoProductos);

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

function fila(parcial: Partial<FilaProductoDTO> & { producto: string }): FilaProductoDTO {
  return {
    tiendaId: "t1",
    tienda: "Tienda Uno",
    unidades: 1,
    ordenes: 1,
    porStatus: [{ status: "entregada", conteo: 1 }],
    ...parcial,
  };
}

function datos(filas: FilaProductoDTO[], extra: Partial<ConteoProductosDTO> = {}): ConteoProductosDTO {
  return {
    filas,
    ordenes: filas.reduce((s, f) => s + f.ordenes, 0),
    ordenesSinProducto: 0,
    lastSync: "2026-09-01T18:30:00.000Z",
    ...extra,
  };
}

/** Un botón que cambia el filtro del proveedor: es la barra de arriba, sin montar la barra. */
function CambiarFiltro() {
  const { setFiltro } = useFiltroEntregas();
  return (
    <button type="button" onClick={() => setFiltro({ zona_id: ["z-9"] })}>
      cambiar filtro
    </button>
  );
}

function renderTabla() {
  // `DescargarDatasetButton` usa `useToast()`, así que el `ToastProvider` es obligatorio en
  // cuanto la tabla monta su control de descarga.
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltroEntregasProvider>
          <CambiarFiltro />
          <ProductosTabla />
        </FiltroEntregasProvider>
      </SWRConfig>
    </ToastProvider>,
  );
}

/** Los textos de las celdas de una fila de la tabla, en el orden en que están pintadas. */
function celdasDeFila(nombre: string | RegExp): string[] {
  const celda = screen.getByRole("cell", { name: nombre });
  const tr = celda.closest("tr");
  return [...(tr?.querySelectorAll("td") ?? [])].map((td) => td.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

/* ========================================================================== */
/* R40 / R41 — el filtro                                                      */
/* ========================================================================== */

describe("FICHA 345 · la tabla responde al filtro de la sección (R40/R41)", () => {
  it("consulta `consultarConteoProductos` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Dr Melaxin" })]) });
    renderTabla();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  it("la primera consulta va SIN filtro y SIN ninguna clave de más", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Dr Melaxin" })]) });
    renderTabla();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    // `.strict()` en el servidor: una clave desconocida —«rol», «alcance»— sería un
    // `validation_error`. El alcance NUNCA se manda desde el cliente (R8).
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });

  it("R41 — cambiar el filtro vuelve a consultar, con el filtro nuevo", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Dr Melaxin" })]) });
    renderTabla();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
    await usuario.click(screen.getByRole("button", { name: "cambiar filtro" }));

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(2));
    expect(consultarMock.mock.calls[1]?.[0]).toEqual({ zona_id: ["z-9"] });
  });
});

/* ========================================================================== */
/* R43 / R44 / R32 — los estados que no son «hay filas»                       */
/* ========================================================================== */

describe("FICHA 345 · los estados de la lectura (R43/R44/R32)", () => {
  it("R43 — mientras carga NO pinta ceros: el universo del recorte no aparece", async () => {
    // Una promesa que no resuelve: la tabla se queda en carga.
    consultarMock.mockImplementation(() => new Promise(() => {}));
    renderTabla();

    // El aviso de multiproducto SÍ está desde el primer render: no es un dato, es una
    // advertencia sobre cómo se lee la columna.
    expect(screen.getByText(PRODUCTOS_TEXTOS.aviso)).toBeInTheDocument();
    // Y el universo NO: sin respuesta, «0 órdenes en el rango» sería una cifra inventada.
    expect(screen.queryByText(/órdenes en el rango/)).toBeNull();
    // Tampoco el estado vacío: «no hubo productos» todavía no se sabe.
    expect(screen.queryByText(PRODUCTOS_TEXTOS.vacioTitulo)).toBeNull();
  });

  it.each([
    ["forbidden", TEXTO_PROHIBIDO],
    ["unauthenticated", TEXTO_SESION_NO_VALIDA],
  ] as const)("R44 — `%s` enseña su mensaje y NO una tabla vacía", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderTabla();

    expect(await screen.findByText(texto)).toBeInTheDocument();
    // La diferencia que este caso protege: un problema de permisos pintado como el estado
    // vacío afirmaría un hecho del negocio («no hubo productos») que nadie ha comprobado.
    expect(screen.queryByText(PRODUCTOS_TEXTOS.vacioTitulo)).toBeNull();
    expect(screen.queryByText(/órdenes en el rango/)).toBeNull();
  });

  it("R44 — un filtro inválido enseña su propio texto, distinto del de permisos", async () => {
    consultarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { zona_id: ["la lista no puede estar vacía"] },
    });
    renderTabla();

    expect(await screen.findByText(TITULO_FILTRO_INVALIDO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_PROHIBIDO)).toBeNull();
  });

  it("R44 — si la lectura revienta se dice, y con el texto SANEADO", async () => {
    consultarMock.mockRejectedValue(new Error("orden 8f2c-… del mensajero Juan"));
    renderTabla();

    expect(await screen.findByText(TEXTO_ERROR_PANEL)).toBeInTheDocument();
    // El mensaje de la excepción puede arrastrar ids y nombres: no se interpola nunca.
    expect(screen.queryByText(/Juan/)).toBeNull();
  });

  it("R32 — sin ninguna fila hay un estado vacío EXPLÍCITO, no una tabla de ceros", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderTabla();

    expect(await screen.findByText(PRODUCTOS_TEXTOS.vacioTitulo)).toBeInTheDocument();
    expect(screen.getByText(PRODUCTOS_TEXTOS.vacioDescripcion)).toBeInTheDocument();
    // Y el universo SÍ se pinta: «hubo 0 órdenes» es un hecho, y llega en la respuesta.
    expect(screen.getByText(/órdenes en el rango/)).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* R46 / R28 — las columnas y sus cifras                                      */
/* ========================================================================== */

describe("FICHA 345 · las columnas (R46)", () => {
  it("pinta producto, unidades, órdenes, entregadas, rechazadas, en proceso y los dos porcentajes", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Dr Melaxin", unidades: 19, ordenes: 16 })]),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    for (const encabezado of [
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.unidades,
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.entregadas,
      PRODUCTOS_COLUMNAS.rechazadas,
      PRODUCTOS_COLUMNAS.enProceso,
      PRODUCTOS_COLUMNAS.efectividad,
      PRODUCTOS_COLUMNAS.rechazo,
    ]) {
      expect(screen.getByRole("columnheader", { name: encabezado })).toBeInTheDocument();
    }
  });

  it("con UNA sola tienda en la respuesta la columna Tienda NO se pinta", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Dr Melaxin", tiendaId: "t1" }),
        fila({ producto: "BASE C", tiendaId: "t1" }),
      ]),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    expect(screen.queryByRole("columnheader", { name: PRODUCTOS_COLUMNAS.tienda })).toBeNull();
  });

  it("con DOS tiendas en la respuesta la columna Tienda aparece, con su nombre", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Crema Especial MLX", tiendaId: "t1", tienda: "Tienda Uno" }),
        fila({ producto: "Crema Especial MLX", tiendaId: "t2", tienda: "Tienda Dos" }),
      ]),
    });
    renderTabla();

    await screen.findAllByText("Crema Especial MLX");
    expect(
      screen.getByRole("columnheader", { name: PRODUCTOS_COLUMNAS.tienda }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Tienda Uno" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Tienda Dos" })).toBeInTheDocument();
  });

  it("la decisión es por CONTENIDO: se cuenta por tiendaId, no por nombre", () => {
    // Dos tiendas HOMÓNIMAS son dos tiendas. Contar por nombre las fundiría y escondería la
    // columna justo cuando más falta hace.
    expect(
      hayVariasTiendas([
        fila({ producto: "X", tiendaId: "t1", tienda: "Repetida" }),
        fila({ producto: "X", tiendaId: "t2", tienda: "Repetida" }),
      ]),
    ).toBe(true);
    expect(
      hayVariasTiendas([
        fila({ producto: "X", tiendaId: "t1" }),
        fila({ producto: "Y", tiendaId: "t1" }),
      ]),
    ).toBe(false);
  });

  it("R28 — la fila pinta EXACTAMENTE lo que devuelve `calcularEfectividad`", async () => {
    const porStatus = [
      { status: "entregada", conteo: 8 },
      { status: "rechazada", conteo: 6 },
      { status: EN_CURSO, conteo: 2 },
    ];
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Spray Protector", unidades: 19, ordenes: 16, porStatus })]),
    });
    renderTabla();

    await screen.findByText("Spray Protector");
    const esperado = calcularEfectividad(porStatus);
    const celdas = celdasDeFila("Spray Protector");

    // producto, unidades, órdenes, entregadas, rechazadas, en proceso, efectividad, rechazo.
    expect(celdas).toEqual([
      "Spray Protector",
      "19",
      "16",
      String(esperado.entregadas),
      String(esperado.rechazadas),
      String(esperado.enProceso),
      // FRACCIÓN por cien, con un decimal como máximo. 0,5 => «50%»; 0,375 => «37,5%». El
      // locale es el del repo (`MONEDA_LOCALE`, es-CR), que no pone espacio antes del signo.
      "50%",
      "37,5%",
    ]);
    // Y las dos cifras que se pintan son las de la función, no unas recalculadas aquí.
    expect(esperado.efectividad).toBe(0.5);
    expect(esperado.tasaRechazo).toBe(0.375);
  });

  it("`efectividadGestion` NO se pinta: dos porcentajes con el mismo nombre confunden", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({
          producto: "Spray Protector",
          ordenes: 16,
          porStatus: [
            { status: "entregada", conteo: 8 },
            { status: "rechazada", conteo: 6 },
            { status: EN_CURSO, conteo: 2 },
          ],
        }),
      ]),
    });
    renderTabla();

    await screen.findByText("Spray Protector");
    // (8 + 6) / 16 = 0,875 => «87,5%». No debe aparecer en ninguna celda.
    expect(screen.queryByText("87,5%")).toBeNull();
  });
});

/* ========================================================================== */
/* R33 — el orden llega HECHO                                                 */
/* ========================================================================== */

describe("FICHA 345 · el cliente NO reordena las filas (R33)", () => {
  it("las pinta en el orden EXACTO en que llegaron, aunque no parezca ordenado", async () => {
    // Las filas van a propósito en un orden que NINGÚN criterio de cliente produciría: ni por
    // unidades, ni por órdenes, ni alfabético. Si alguien añadiera un `.sort()` en el
    // componente, este caso lo caza — y ése es todo su motivo de existir. El orden es contrato
    // del servicio (unidades desc, órdenes desc, producto asc, tienda asc) y la paginación se
    // apoya en él: con dos criterios distintos, la página 2 dependería de cuál ganó al final.
    const orden = ["Zeta", "Alfa", "Mu"];
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Zeta", unidades: 3, ordenes: 3 }),
        fila({ producto: "Alfa", unidades: 40, ordenes: 40 }),
        fila({ producto: "Mu", unidades: 12, ordenes: 12 }),
      ]),
    });
    renderTabla();

    await screen.findByText("Zeta");
    const filasDom = screen.getAllByRole("row").slice(1); // la primera es la cabecera
    expect(filasDom.map((tr) => within(tr).getAllByRole("cell")[0]?.textContent)).toEqual(orden);
  });
});

/* ========================================================================== */
/* R45 — la paginación                                                        */
/* ========================================================================== */

describe("FICHA 345 · la tabla pagina (R45)", () => {
  const MUCHAS = Array.from({ length: 30 }, (_, i) =>
    fila({ producto: `Producto ${String(i + 1).padStart(2, "0")}`, unidades: 30 - i }),
  );

  it("con 30 productos enseña 25 y ofrece la barra de paginación", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(MUCHAS) });
    renderTabla();

    await screen.findByText("Producto 01");
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(25);
    expect(screen.getByRole("navigation", { name: "Paginación" })).toBeInTheDocument();
    expect(screen.queryByText("Producto 26")).toBeNull();
  });

  it("la segunda página enseña las cinco restantes", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(MUCHAS) });
    renderTabla();

    await screen.findByText("Producto 01");
    await usuario.click(screen.getByRole("button", { name: "Página siguiente" }));

    expect(await screen.findByText("Producto 26")).toBeInTheDocument();
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(5);
    expect(screen.queryByText("Producto 01")).toBeNull();
  });

  it("sin filas no hay barra de paginación que contradiga al estado vacío", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderTabla();

    await screen.findByText(PRODUCTOS_TEXTOS.vacioTitulo);
    expect(screen.queryByRole("navigation", { name: "Paginación" })).toBeNull();
  });
});

/* ========================================================================== */
/* R36 / R35 — el aviso y el universo                                         */
/* ========================================================================== */

describe("FICHA 345 · el rótulo de multiproducto (R36) y el universo (R35)", () => {
  it("pinta el aviso de que una orden con varios productos cuenta en cada uno", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Dr Melaxin" })]) });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    expect(screen.getByText(PRODUCTOS_TEXTOS.aviso)).toBeInTheDocument();
  });

  it("pinta el total del recorte y las órdenes sin producto interpretable", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Dr Melaxin", ordenes: 700 })], {
        ordenes: 768,
        ordenesSinProducto: 7,
      }),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    // Las dos cifras del DTO, no la suma de la columna: la suma puede superar el total.
    expect(screen.getByText(/768 órdenes en el rango/)).toBeInTheDocument();
    expect(screen.getByText(/7 sin producto interpretable/)).toBeInTheDocument();
  });
});
