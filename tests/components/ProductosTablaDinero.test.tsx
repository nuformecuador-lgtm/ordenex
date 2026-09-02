// @vitest-environment jsdom
//
// FICHA 347 (F6) — el DINERO en la tabla de productos de `/analitica`, y la fila que se abre.
//
// Cubre R6, R29, R30, R31 (el render), R32, R33, R34, R36, R45, R46, R57, R59, R60, R61, R62,
// R63, R64, R65 y R76.
//
// Archivo aparte del de la 345 y no un bloque dentro de él: aquel prueba que la pantalla no
// INVENTA nada (ni orden propio, ni porcentaje propio); éste prueba las tres cosas que sólo
// pueden salir mal cuando hay dinero delante.
//
//   1. QUIÉN LO VE (R6). Sin la concesión no hay columna, ni panel, ni control, ni aviso — y
//      la tabla queda EXACTAMENTE como estaba.
//   2. «NO HAY» NO ES «CERO» (R30). Es la mutación M6, y es la diferencia entre «todavía no se
//      sabe lo que cobró Ordenex» y «Ordenex no cobró nada». Son dos hechos distintos.
//   3. LO QUE SE LEE CERRADO NO SE CONSULTA (R33). Veinticinco filas cerradas cuestan CERO
//      lecturas de detalle; abrir una cuesta exactamente una, y de SU fila.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import {
  ProductosTabla,
  PRODUCTOS_COLUMNAS,
  PRODUCTOS_TEXTOS,
  textoAcompanadas,
  textoColumnasNoSumables,
  textoPendiente,
} from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { DETALLE_DINERO_TEXTOS } from "@/app/(app)/analitica/_components/entregas/DineroProductoDetalle";
import { textoSello } from "@/app/(app)/analitica/_components/entregas/ActualizarAnalitica";
import {
  FiltroEntregasProvider,
  useFiltroEntregas,
} from "@/app/(app)/_components/filtro-entregas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import { consultarDetalleDineroProducto } from "@/lib/actions/detalle-dinero-producto";
import { money } from "@/lib/config/moneda";
import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ConteoProductosDTO,
  DineroProductoDTO,
  FilaProductoDTO,
} from "@/lib/types/conteo-productos";

vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));
vi.mock("@/lib/actions/detalle-dinero-producto", () => ({
  consultarDetalleDineroProducto: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoProductos);
const detalleMock = vi.mocked(consultarDetalleDineroProducto);

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

/**
 * Las cifras de dinero de una fila, ya cuadradas: `6215 + 28785 = 35000` (R20) y
 * `35000 + 10000 = 45000` (R21). Se escriben cuadradas para que la pantalla se pruebe con un
 * dato que el servidor puede producir de verdad.
 */
const DINERO: DineroProductoDTO = {
  recaudado: "45000.00",
  liquidado: { recaudado: "35000.00", ordenex: "6215.00", tienda: "28785.00", ordenes: 4 },
  pendiente: { recaudado: "10000.00", ordenes: 1 },
  retorno: "2260.00",
};

/** La misma fila SIN nada liquidado: el caso de R30, y el que mata la mutación M6. */
const DINERO_SIN_LIQUIDAR: DineroProductoDTO = {
  recaudado: "10000.00",
  liquidado: { recaudado: "0.00", ordenex: null, tienda: null, ordenes: 0 },
  pendiente: { recaudado: "10000.00", ordenes: 1 },
  retorno: null,
};

function fila(parcial: Partial<FilaProductoDTO> & { producto: string }): FilaProductoDTO {
  return {
    tiendaId: "t1",
    tienda: "Tienda Uno",
    unidades: 6,
    ordenes: 5,
    porStatus: [
      { status: "entregada", conteo: 4 },
      { status: EN_CURSO, conteo: 1 },
    ],
    ordenesAcompanadas: 3,
    dinero: DINERO,
    ...parcial,
  };
}

function datos(
  filas: FilaProductoDTO[],
  extra: Partial<ConteoProductosDTO> = {},
): ConteoProductosDTO {
  return {
    filas,
    ordenes: filas.reduce((s, f) => s + f.ordenes, 0),
    ordenesSinProducto: 0,
    dinero: { estado: "concedido" },
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

function renderTabla(dinero: boolean) {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltroEntregasProvider>
          <CambiarFiltro />
          <ProductosTabla dinero={dinero} />
        </FiltroEntregasProvider>
      </SWRConfig>
    </ToastProvider>,
  );
}

/** Los encabezados de la tabla de PRODUCTOS (la primera del documento). */
function encabezados(): string[] {
  const tabla = screen.getAllByRole("table")[0];
  return [...tabla.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
}

/** La celda de una fila bajo un encabezado dado, buscando el índice por su rótulo. */
function celda(nombreFila: string, encabezado: string): HTMLTableCellElement {
  const i = encabezados().indexOf(encabezado);
  expect(i, `no existe la columna «${encabezado}»`).toBeGreaterThanOrEqual(0);
  const tr = screen.getByRole("cell", { name: nombreFila }).closest("tr");
  return [...(tr?.querySelectorAll("td") ?? [])][i];
}

/** La cifra de una celda, sin las líneas de contexto que la ficha 347 pone debajo. */
function cifra(td: HTMLTableCellElement): string {
  return td.querySelector(".tabular-nums")?.textContent ?? td.textContent ?? "";
}

const MATCH_MEDIA_REAL = window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = MATCH_MEDIA_REAL;
});
afterEach(cleanup);

/* ========================================================================== */
/* R6 — quién ve el dinero                                                    */
/* ========================================================================== */

describe("FICHA 347 · R6 — sin la concesión no hay NADA de dinero en la pantalla", () => {
  it("sin la prop, la tabla queda exactamente como la dejó la 346", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr" })], { dinero: { estado: "denegado" } }),
    });
    renderTabla(false);

    await screen.findByText("Base Dr");

    // Ni una de las tres columnas…
    for (const columna of [
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
    ]) {
      expect(encabezados()).not.toContain(columna);
    }
    // …ni el aviso del dinero…
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeNull();
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoLiquidado)).toBeNull();
    // …ni el control que abre el panel. `DataTable` sólo antepone esa columna cuando el
    // consumidor pasa `renderExpanded`, así que su ausencia se comprueba por el botón.
    expect(
      screen.queryByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    ).toBeNull();
    // Y el detalle NO se consulta jamás.
    expect(detalleMock).not.toHaveBeenCalled();
  });

  it("con la prop pero con la respuesta DENEGADA, tampoco: el servidor manda", async () => {
    // Los dos hechos son distintos: la prop dice «qué se dibuja» y el estado de la respuesta
    // dice «qué se sirvió». Si el borde denegara, pintar las columnas con «—» en cada fila se
    // leería como «este producto no movió dinero», que es una afirmación falsa.
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero: null })], {
        dinero: { estado: "denegado" },
      }),
    });
    renderTabla(true);

    await screen.findByText("Base Dr");
    expect(encabezados()).not.toContain(PRODUCTOS_COLUMNAS.recaudado);
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeNull();
  });

  it("las columnas de VOLUMEN siguen ahí en los dos casos", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr" })], { dinero: { estado: "denegado" } }),
    });
    renderTabla(false);

    await screen.findByText("Base Dr");
    for (const columna of [
      PRODUCTOS_COLUMNAS.unidades,
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.entregadas,
      PRODUCTOS_COLUMNAS.otrosResultados,
    ]) {
      expect(encabezados()).toContain(columna);
    }
  });
});

/* ========================================================================== */
/* Las tres columnas, sus marcas y sus líneas de contexto                     */
/* ========================================================================== */

describe("FICHA 347 · las tres columnas de dinero (R45/R63)", () => {
  beforeEach(() => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Base Dr" })]) });
  });

  it("el ORDEN de escritorio pone el dinero JUSTO detrás del producto (R63)", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // ⚠ ANTES DE ESTA FICHA NINGÚN TEST FIJABA EL ORDEN DE LAS COLUMNAS DE ESCRITORIO: los
    // casos de la 345 comprueban que cada encabezado ESTÁ, y el índice de una columna se busca
    // por su rótulo, así que una permutación pasaba entera en verde. Ahora el orden es una
    // DECISIÓN con un número detrás y por eso se ata a mano.
    //
    // POR QUÉ EL DINERO VA EL SEGUNDO Y NO EL ÚLTIMO, que sería el orden natural: a 1440 px la
    // tabla pide 1416 y su contenedor da 1102 (ficha 348, con la columna «Tienda» montada y los
    // trece mínimos declarados), así que 314 px se quedan fuera pase lo que pase — y crecieron a
    // propósito desde los 200 de la 347: es lo que cuesta que ninguna palabra se parta. Las
    // cuatro formas de llegar a cero destrozan las cabeceras o parten los nombres de producto,
    // que es justo el defecto reparado. Si alguien tiene que arrastrar para leer una columna, que sea
    // «% de rechazo» —derivada de dos columnas que están a la vista— y no el dinero, que es el
    // dato que se pidió.
    expect(encabezados()).toEqual([
      // La columna del control de desglose: sin texto visible, con nombre accesible.
      "Desglose",
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
      PRODUCTOS_COLUMNAS.unidades,
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.entregadas,
      PRODUCTOS_COLUMNAS.rechazadas,
      PRODUCTOS_COLUMNAS.otrosResultados,
      PRODUCTOS_COLUMNAS.enProceso,
      PRODUCTOS_COLUMNAS.efectividad,
      PRODUCTOS_COLUMNAS.rechazo,
    ]);
  });

  it("y los cuatro cubos del desglose siguen CONTIGUOS y en su orden (ficha 346)", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // Lo que el dinero NO puede romper: los cuatro cubos que suman la columna «Órdenes» se leen
    // seguidos, que es lo que permite comprobar la igualdad de un vistazo. El dinero se mete
    // ANTES del bloque de volumen, nunca EN MEDIO de él.
    const h = encabezados();
    const cubos = [
      PRODUCTOS_COLUMNAS.entregadas,
      PRODUCTOS_COLUMNAS.rechazadas,
      PRODUCTOS_COLUMNAS.otrosResultados,
      PRODUCTOS_COLUMNAS.enProceso,
    ];
    const i = h.indexOf(cubos[0]);
    expect(h.slice(i, i + 4)).toEqual(cubos);
    // Y «Órdenes», el total que esos cuatro suman, va justo antes de ellos.
    expect(h[i - 1]).toBe(PRODUCTOS_COLUMNAS.ordenes);
  });

  it("pinta los tres importes con `money`, COMPLETOS y sin abreviar", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // R63 — el importe COMPLETO. Es el defecto exacto que midieron la 343 (`₡1.70` donde el
    // DOM decía `₡1.700`) y la 344: dinero cortado no se ve roto, se ve como OTRO número.
    expect(cifra(celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado))).toBe(money("45000.00"));
    expect(cifra(celda("Base Dr", PRODUCTOS_COLUMNAS.ordenex))).toBe(money("6215.00"));
    expect(cifra(celda("Base Dr", PRODUCTOS_COLUMNAS.paraTienda))).toBe(money("28785.00"));
  });

  it("R63 — ninguna celda de dinero lleva `truncate`, `line-clamp` ni `overflow-hidden`", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    for (const columna of [
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
    ]) {
      const html = celda("Base Dr", columna).outerHTML;
      expect(html, columna).not.toMatch(/\btruncate\b/);
      expect(html, columna).not.toMatch(/\bline-clamp-/);
      expect(html, columna).not.toMatch(/\boverflow-hidden\b/);
      // Y la cifra no se puede partir por la mitad.
      expect(html, columna).toMatch(/whitespace-nowrap/);
    }
  });

  // ─── FICHA 348 · el aviso de «no sumable» se MUDÓ del encabezado a una leyenda ────────────
  //
  // La 347 lo escribía dentro de los tres rótulos («Recaudado (no sumable)») y el caso de aquí
  // afirmaba justo eso. Medido en Chromium a 1440 px con la columna «Tienda» montada: en dos de
  // esas tres columnas la palabra MÁS ANCHA del encabezado era literalmente `sumable)` (61 px),
  // así que el aviso decidía el ancho de una columna de dinero y dejaba el rótulo en 3 y 4
  // líneas. El aviso NO se pierde: se muda a una leyenda que además dice algo que la marca no
  // decía — CUÁLES son, todas juntas y en su orden.
  //
  // ⚠ Y EL CASO NUEVO AFIRMA MÁS QUE EL VIEJO, que es la condición para cambiarlo: las columnas
  // de dinero se DEDUCEN DEL DOM (las que aparecen al conceder el dinero y no están sin él), no
  // de una lista escrita en el test. El día que exista una cuarta, este caso la exige en la
  // leyenda sin que nadie lo edite. El viejo se habría quedado verde con una marca de menos.
  it("R45 (348) — la leyenda nombra EXACTAMENTE las columnas que llevan un importe", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // QUÉ ES UNA COLUMNA DE DINERO, leído del DOM y no de una lista escrita aquí: aquella cuya
    // celda pinta un importe, o sea el símbolo de la moneda de la app. Así el caso no depende
    // de cuántas columnas de dinero haya hoy.
    const simbolo = money("1.00").replace(/[\d.,\s]/g, "");
    expect(simbolo, "el símbolo de la moneda").not.toBe("");
    const h = encabezados();
    const conImporte = h.filter(
      (nombre) => nombre.trim() !== "" && celda("Base Dr", nombre).textContent?.includes(simbolo),
    );
    expect(conImporte.length).toBeGreaterThan(0);

    const leyenda = screen.getByText(textoColumnasNoSumables(conImporte));
    expect(leyenda).toBeInTheDocument();

    // …y la otra mitad: ninguna columna SIN importe se cuela en la leyenda. Las de conteo SÍ son
    // aditivas, y decir que no lo son es tan dañino como callar que las de dinero no lo son.
    for (const nombre of h) {
      if (nombre.trim() === "" || conImporte.includes(nombre)) continue;
      expect(leyenda.textContent, nombre).not.toContain(nombre);
    }
  });

  it("R45 (348) — y ningún encabezado sigue cargando la marca en su rótulo", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // `sumable` era la palabra más ancha de dos de las tres columnas de dinero. Que vuelva al
    // rótulo es exactamente la regresión que la ficha 348 repara.
    for (const h of encabezados()) expect(h).not.toMatch(/sumable/i);
  });

  it("R45 — y el aviso está escrito arriba, con todas las letras", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    const aviso = screen.getByText(PRODUCTOS_TEXTOS.avisoDinero);
    expect(aviso).toBeInTheDocument();
    // Las dos cosas que el aviso TIENE que decir, y no una versión suave de ellas.
    expect(aviso.textContent).toMatch(/ORDEN completa/);
    expect(aviso.textContent).toMatch(/no se pueden sumar/);
  });

  it("R29 — dice que el reparto es SÓLO de lo ya liquidado", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    expect(screen.getByText(PRODUCTOS_TEXTOS.avisoLiquidado)).toBeInTheDocument();
  });

  it("R13 — la celda de Recaudado dice en cuántas de sus órdenes hay otro producto", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // Es lo que permite calibrar el aviso EN ESTA FILA: con 3 de 5, ese importe está también
    // en otras filas de la tabla.
    expect(celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado).textContent).toContain(
      textoAcompanadas(3, 5),
    );
  });

  it("R28/R29 — y lo pendiente de cierre, con su importe y sus órdenes", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    expect(celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado).textContent).toContain(
      textoPendiente("10000.00", 1),
    );
  });

  it("sin nada pendiente, esa segunda línea NO se pinta", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({
          producto: "Todo Liquidado",
          dinero: {
            ...DINERO,
            recaudado: "35000.00",
            pendiente: { recaudado: "0.00", ordenes: 0 },
          },
        }),
      ]),
    });
    renderTabla(true);
    await screen.findByText("Todo Liquidado");

    expect(celda("Todo Liquidado", PRODUCTOS_COLUMNAS.recaudado).textContent).not.toContain(
      "Pendiente de cierre",
    );
  });

  it("R46 — no hay ningún `<tfoot>` ni total al pie", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    expect(document.querySelectorAll("tfoot")).toHaveLength(0);
  });
});

/* ========================================================================== */
/* R30 — «no hay» NO es «cero» (mutación M6)                                  */
/* ========================================================================== */

describe("FICHA 347 · R30 — sin nada liquidado se pinta «—», nunca `0,00`", () => {
  it("las dos celdas del reparto son el marcador de dato ausente", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Cierre", dinero: DINERO_SIN_LIQUIDAR })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Cierre");

    // ⚠ ÉSTE ES EL CASO QUE MATA LA MUTACIÓN M6. «Todavía no se sabe lo que cobró Ordenex» y
    // «Ordenex no cobró nada» son dos hechos distintos, y en una pantalla de dinero la
    // diferencia decide si alguien reclama una liquidación o no.
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.ordenex))).toBe(money(null));
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.paraTienda))).toBe(money(null));
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.ordenex))).not.toBe(money("0.00"));
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.paraTienda))).not.toBe(money("0.00"));

    // Y lo que SÍ es un hecho se pinta: lo recaudado existe desde que se registró la gestión.
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.recaudado))).toBe(money("10000.00"));
  });

  it("una fila SIN ninguna orden que aporte pinta «—» en las tres", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Ventas", dinero: null })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Ventas");

    for (const columna of [
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
    ]) {
      expect(cifra(celda("Sin Ventas", columna)), columna).toBe(money(null));
    }
  });

  it("y esa fila NO ofrece el control de abrir: no hay detalle que enseñar", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Ventas", dinero: null })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Ventas");

    expect(
      screen.queryByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Sin Ventas", "Tienda Uno"),
      }),
    ).toBeNull();
  });
});

/* ========================================================================== */
/* R61 / R62 / R65 / R76 — los estados                                        */
/* ========================================================================== */

describe("FICHA 347 · los estados de la lectura con dinero", () => {
  it("R61 — mientras carga no pinta ni un importe", async () => {
    consultarMock.mockImplementation(() => new Promise(() => {}));
    renderTabla(true);

    // Ni ceros ni importes de la lectura anterior: no hay ninguna cifra de dinero en el DOM.
    expect(document.body.textContent).not.toContain(money("45000.00"));
    expect(document.body.textContent).not.toContain(money("0.00"));
  });

  it("R65 — pinta el instante en que estas cifras se leyeron de la base", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Base Dr" })]) });
    renderTabla(true);
    await screen.findByText("Base Dr");

    // Sale del MISMO `lastSync` que sella el productor de la caché, así que el sello del
    // volumen y el del dinero no pueden ser dos instantes distintos (R78). Se sirve de una
    // caché de 15 minutos: sin el sello la pantalla afirma que la cifra es de este segundo.
    expect(screen.getByText(textoSello("2026-09-01T18:30:00.000Z"))).toBeInTheDocument();
  });

  it("R76 — con el tope superado lo dice, y NO pinta columnas de dinero vacías", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero: null })], {
        dinero: { estado: "limite_excedido", limite: 5000 },
      }),
    });
    renderTabla(true);
    await screen.findByText("Base Dr");

    expect(screen.getByText(PRODUCTOS_TEXTOS.dineroLimiteExcedido(5000))).toBeInTheDocument();
    // Pintar las columnas con «—» en todas las filas se leería como «este producto no movió
    // dinero», que es falso: lo que pasa es que no se pudo calcular.
    expect(encabezados()).not.toContain(PRODUCTOS_COLUMNAS.recaudado);
    // Y el VOLUMEN sigue intacto: el tope es de la lectura de dinero, no de la de productos.
    expect(encabezados()).toContain(PRODUCTOS_COLUMNAS.unidades);
    expect(screen.getByText("Base Dr")).toBeInTheDocument();
  });

  it("R59 — cambiar el filtro vuelve a consultar y las cifras se releen", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Base Dr" })]) });
    renderTabla(true);

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
    await usuario.click(screen.getByRole("button", { name: "cambiar filtro" }));

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(2));
    expect(consultarMock.mock.calls[1]?.[0]).toEqual({ zona_id: ["z-9"] });
  });
});

/* ========================================================================== */
/* R32 / R33 / R34 — la fila que se abre                                      */
/* ========================================================================== */

describe("FICHA 347 · el detalle orden por orden (R32/R33/R34)", () => {
  const DOS_FILAS = [
    fila({ producto: "Base Dr" }),
    fila({ producto: "Creatina", tiendaId: "t2", tienda: "Tienda Dos" }),
  ];

  function payloadDe(producto: string) {
    return {
      status: "ok" as const,
      datos: {
        producto,
        tiendaNombre: "Tienda Uno",
        totales: DINERO,
        total: 5,
        page: 1,
        pageSize: 25,
        ordenes: [
          {
            ordenId: "o1",
            guia: "77001",
            destinatario: "Ana Pérez",
            resultados: ["entregada" as const],
            estado: "liquidada" as const,
            recaudado: "35000.00",
            ordenex: "6215.00",
            tienda: "28785.00",
            retorno: null,
          },
        ],
      },
    };
  }

  it("R33 — con las filas CERRADAS, el detalle no se consulta ni una vez", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue(payloadDe("Base Dr"));
    renderTabla(true);

    await screen.findByText("Base Dr");
    await screen.findByText("Creatina");
    // Se espera un poco a que cualquier efecto pendiente corra: si el panel se montara con la
    // fila cerrada, aquí ya habría una llamada.
    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(detalleMock).not.toHaveBeenCalled();
  });

  it("R32 — abrir una fila consulta EXACTAMENTE una vez, y con SU tienda y SU producto", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue(payloadDe("Base Dr"));
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );

    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(1));
    // ⚠ EL `tienda_id` VIAJA COMO FACETA DEL FILTRO, no como un campo suelto: es la puerta que
    // `recortarFiltroConteoEntregas` ya interseca con el alcance del actor (R43/R44). Si
    // alguien lo sacara del filtro, el servidor dejaría de recortarlo.
    expect(detalleMock.mock.calls[0]?.[0]).toEqual({
      filtro: { tienda_id: ["t1"] },
      producto_clave: "Base Dr",
      page: 1,
    });
  });

  it("R34 — dos filas abiertas consultan LO SUYO y no se pisan", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue(payloadDe("Base Dr"));
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(1));

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Creatina", "Tienda Dos"),
      }),
    );
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));

    // Cada panel pide LO SUYO: sin la tienda y el producto en la clave SWR, el segundo habría
    // leído la respuesta cacheada del primero.
    expect(detalleMock.mock.calls[1]?.[0]).toEqual({
      filtro: { tienda_id: ["t2"] },
      producto_clave: "Creatina",
      page: 1,
    });
  });

  it("R38/R36/R37 — el panel enseña los totales para cotejar, y la orden con su guía", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue(payloadDe("Base Dr"));
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );

    const panel = await screen.findByRole("region", {
      name: DETALLE_DINERO_TEXTOS.region("Base Dr", "Tienda Uno"),
    });

    // Los `totales` en la cabecera son las MISMAS cifras de la fila (R38): sirven para cotejar
    // la suma sin salir de la pantalla.
    //
    // `getAllByText` y no `getByText`: con UNA sola orden en la página, el total de la
    // cabecera y el aporte de esa orden son el MISMO importe y aparecen dos veces. Que
    // coincidan es justamente lo que R38 promete, así que exigir una sola aparición sería
    // exigir que el cuadre NO se vea.
    expect(within(panel).getAllByText(money("45000.00")).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(money("6215.00")).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(money("28785.00")).length).toBeGreaterThan(0);
    // R19 — el retorno va en la cabecera y FUERA del reparto, con su explicación al lado.
    expect(within(panel).getAllByText(money("2260.00")).length).toBeGreaterThan(0);
    expect(within(panel).getByText(DETALLE_DINERO_TEXTOS.totales.retornoPista)).toBeInTheDocument();

    // R36 — la orden se identifica por su guía y LLEVA a esa orden.
    const enlace = within(panel).getByRole("link", { name: DETALLE_DINERO_TEXTOS.verOrden("77001") });
    expect(enlace).toHaveAttribute("href", "/ordenes?q=77001");
    // R37 — y dice el resultado que la hizo aportar y si está liquidada.
    expect(within(panel).getByText("Entregadas")).toBeInTheDocument();
    expect(within(panel).getByText(DETALLE_DINERO_TEXTOS.estado.liquidada)).toBeInTheDocument();
  });

  it("R42 — un producto sin ninguna orden que aporte enseña su estado vacío, no un error", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue({ status: "vacio" });
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );

    expect(await screen.findByText(DETALLE_DINERO_TEXTOS.vacio)).toBeInTheDocument();
  });

  it("R62 — un `limite_excedido` del detalle lo dice, y no como una tabla vacía", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(DOS_FILAS) });
    detalleMock.mockResolvedValue({ status: "limite_excedido", limite: 5000 });
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );

    expect(
      await screen.findByText(DETALLE_DINERO_TEXTOS.limiteExcedido(5000)),
    ).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* Entrega B — la composición de «Otros resultados» en la pantalla            */
/* ========================================================================== */

describe("FICHA 347 · la composición de «Otros resultados» (R50/R54/R57)", () => {
  const CREMA = fila({
    producto: "Crema Especial MLX",
    unidades: 29,
    ordenes: 24,
    porStatus: [
      { status: "entregada", conteo: 3 },
      { status: "rechazada", conteo: 2 },
      { status: "devuelta", conteo: 4 },
      { status: "reprogramada", conteo: 2 },
      { status: EN_CURSO, conteo: 13 },
    ],
  });

  it("R50 — la celda dice CUÁNTAS arriba y DE QUÉ debajo, sin tocar la etiqueta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla(true);
    await screen.findByText("Crema Especial MLX");

    const td = celda("Crema Especial MLX", PRODUCTOS_COLUMNAS.otrosResultados);
    expect(cifra(td)).toBe("6");
    expect(td.textContent).toContain("4 devueltas · 2 reprogramadas");
    // Y la ETIQUETA de la columna NO enumera: mentiría el día que el catálogo gane un
    // desenlace, que es el defecto que la 346 acaba de reparar.
    expect(PRODUCTOS_COLUMNAS.otrosResultados).toBe("Otros resultados");
  });

  it("R57 — es legible SIN apuntar: es texto en el DOM, no un `title` ni un tooltip", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla(true);
    await screen.findByText("Crema Especial MLX");

    // Un tooltip no existe en táctil, no se copia y los lectores de pantalla lo tratan
    // distinto. Esta tabla ya tuvo DOS arreglos de ancho medidos a 390 px: el teléfono no es
    // un borde aquí, es el caso que rompe.
    const linea = screen.getByText("4 devueltas · 2 reprogramadas");
    expect(linea).toBeInTheDocument();
    expect(linea.getAttribute("title")).toBeNull();
    expect(linea.closest("[role='tooltip']")).toBeNull();
  });

  it("R54 — con el conteo en cero, no se pinta ninguna composición", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({
          producto: "Spray Protector",
          porStatus: [
            { status: "entregada", conteo: 8 },
            { status: "rechazada", conteo: 6 },
          ],
        }),
      ]),
    });
    renderTabla(true);
    await screen.findByText("Spray Protector");

    const td = celda("Spray Protector", PRODUCTOS_COLUMNAS.otrosResultados);
    expect(cifra(td)).toBe("0");
    // La celda es EXACTAMENTE el conteo: ni una línea en blanco que haga la fila más alta.
    expect(td.textContent).toBe("0");
  });
});

/* ========================================================================== */
/* R64 / R57 — el teléfono no enseña menos                                    */
/* ========================================================================== */

describe("FICHA 347 · la vista de TELÉFONO lleva el mismo dinero (R64)", () => {
  beforeEach(() => {
    // `useIsMobile` lee `matchMedia`. Se fuerza la vista de teléfono, y `beforeEach` global la
    // repone después para que ningún caso la herede sin pedirla.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it("las tres cifras de dinero y sus dos líneas de contexto están en la pila", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({
          producto: "Crema Especial MLX",
          porStatus: [
            { status: "entregada", conteo: 3 },
            { status: "devuelta", conteo: 4 },
            { status: EN_CURSO, conteo: 13 },
          ],
        }),
      ]),
    });
    renderTabla(true);
    await screen.findByText("Crema Especial MLX");

    // La prueba de que ESTAMOS en la vista de teléfono: las DOS columnas de datos y ni una
    // más. La primera es la del control que abre el detalle, que `DataTable` antepone cuando
    // el consumidor pasa `renderExpanded` —y que aquí existe justamente porque el dinero está
    // concedido también en el teléfono—.
    expect(encabezados().slice(-2)).toEqual([
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.cifras,
    ]);
    expect(encabezados()).toHaveLength(3);

    // Ni un dato menos que en el portátil: las tres etiquetas, los tres importes…
    for (const etiqueta of [
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
    ]) {
      expect(screen.getByText(etiqueta), etiqueta).toBeInTheDocument();
    }
    expect(screen.getByText(money("45000.00"))).toBeInTheDocument();
    expect(screen.getByText(money("6215.00"))).toBeInTheDocument();
    expect(screen.getByText(money("28785.00"))).toBeInTheDocument();
    // …las dos líneas de contexto…
    expect(screen.getByText(textoAcompanadas(3, 5))).toBeInTheDocument();
    expect(screen.getByText(textoPendiente("10000.00", 1))).toBeInTheDocument();
    // …y la composición de «Otros resultados» (R57).
    expect(screen.getByText("4 devueltas")).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* FICHA 348 — que ninguna palabra se parta: los trece mínimos y el no-partido */
/* ========================================================================== */

describe("FICHA 348 · el ancho de las columnas es una DECISIÓN, no el resto del reparto", () => {
  // Dos tiendas distintas: es lo que monta la columna «Tienda», y es el caso que la 347 NO
  // midió —la base local tiene una sola tienda, así que la columna no se montaba y el reparto
  // de ancho se midió sin ella—. Con ella montada, en producción, `Nuform` salía partido.
  beforeEach(() => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Base Dr", tiendaId: "t1", tienda: "Nuform" }),
        fila({ producto: "Colágeno", tiendaId: "t2", tienda: "Distribuidora Karla" }),
      ]),
    });
  });

  /** Los `<th>` de DATOS: el del control de desglose no lo es (su rótulo es `sr-only`). */
  function encabezadosDeDatos(): HTMLTableCellElement[] {
    const tabla = screen.getAllByRole("table")[0];
    return [...tabla.querySelectorAll<HTMLTableCellElement>("thead th")].filter(
      (th) => th.querySelector(".sr-only") === null,
    );
  }

  it("las TRECE columnas declaran un ancho mínimo, y ninguna se queda sin él", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    const ths = encabezadosDeDatos();
    // Trece: tienda + producto + tres de dinero + ocho de conteo. Si mañana hay una más, este
    // número cambia a mano y con ello se relee la tabla de mínimos del componente.
    expect(ths.map((th) => th.textContent)).toHaveLength(13);

    // ⚠ SIN ESTE CASO NADA ATABA LOS ANCHOS. Antes de la 348, la tabla declaraba TRES mínimos
    // para trece columnas y quitarlos no ponía nada en rojo: el navegador estrujaba las otras
    // diez hasta partir palabras y la suite entera seguía verde. Se comprobó quitando el
    // mínimo de «Tienda» — ningún test cayó.
    for (const th of ths) {
      expect(th.style.minWidth, `la columna «${th.textContent}» no declara mínimo`).not.toBe("");
    }
  });

  it("y ninguno de esos mínimos es simbólico: por debajo de 5rem no cabe ni el rótulo", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // 5rem = 80 px, y el suelo está MEDIDO en Chromium: el rótulo más corto de la tabla
    // (`Órdenes`) mide 53 px y su `<th>` añade 24 px de relleno, o sea 77. Un mínimo por debajo
    // de eso deja de proteger nada y sólo aparenta hacerlo.
    for (const th of encabezadosDeDatos()) {
      const valor = th.style.minWidth;
      expect(valor, `«${th.textContent}» → ${valor}`).toMatch(/^[\d.]+rem$/);
      expect(Number.parseFloat(valor), `«${th.textContent}» → ${valor}`).toBeGreaterThanOrEqual(5);
    }
  });

  it("ningún nombre —de producto o de tienda— puede partirse por dentro", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // El defecto reportado por el humano, en su forma comprobable sin navegador: `wrap-anywhere`
    // reduce el `min-content` de la columna a UN carácter y autoriza al navegador a dejarla más
    // estrecha que su palabra más larga. Medido a 1440 px con la columna «Tienda» montada: 66 px
    // de columna para un dato que pedía 114, y `Nuform` partido en dos líneas (`Nufor` + `m`).
    // `break-all` e `hyphens-auto` parten igual; `break-words` no reduce el `min-content`, pero
    // aquí tampoco hace falta y se prefiere no tener ninguna.
    for (const nombre of [PRODUCTOS_COLUMNAS.producto, PRODUCTOS_COLUMNAS.tienda]) {
      const html = celda("Base Dr", nombre).outerHTML;
      expect(html, nombre).not.toMatch(/\bwrap-anywhere\b/);
      expect(html, nombre).not.toMatch(/\bbreak-all\b/);
      expect(html, nombre).not.toMatch(/\bhyphens-auto\b/);
    }
  });
});

describe("FICHA 348 · `textoColumnasNoSumables` deriva la leyenda, no la escribe", () => {
  it("con tres nombres los enumera en su orden, con la conjunción del español", () => {
    expect(textoColumnasNoSumables(["A", "B", "C"])).toBe(
      "Las columnas de dinero que no se pueden sumar hacia abajo: A, B y C.",
    );
  });

  it("con dos, «A y B»; con una, sólo «A» y en singular", () => {
    // Lo que este caso protege: que la leyenda siga siendo legible el día que el catálogo de
    // columnas de dinero cambie. Escribir los tres nombres a mano pasaría el caso de arriba y
    // se rompería aquí en silencio — que es exactamente el fallo mudo que la ficha evita.
    expect(textoColumnasNoSumables(["A", "B"])).toBe(
      "Las columnas de dinero que no se pueden sumar hacia abajo: A y B.",
    );
    expect(textoColumnasNoSumables(["A"])).toBe(
      "La columna de dinero que no se puede sumar hacia abajo: A.",
    );
  });

  it("con cuatro —el día que aparezca una más— la nueva entra sola", () => {
    expect(textoColumnasNoSumables(["A", "B", "C", "D"])).toBe(
      "Las columnas de dinero que no se pueden sumar hacia abajo: A, B, C y D.",
    );
  });
});
