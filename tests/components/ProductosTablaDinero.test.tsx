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
// FICHA 449 — LA OTRA FUENTE del nombre de la cifra de bodega. Se importa a propósito desde el
// módulo de rótulos del cierre: comparar el texto de esta pantalla contra el de aquélla es lo
// único que garantiza que sigan siendo UNO, y no dos nombres para una misma cifra (ficha 338).
import { FULFILLMENT_COL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
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
  // FICHA 449 — el servicio de bodega de sus 4 ordenes liquidadas (4 x 696). Cifra PROPIA: NO
  // esta dentro de `liquidado.ordenex`, y por eso el cuadre de arriba no la menciona.
  fulfillment: "2784.00",
};

/** La misma fila SIN nada liquidado: el caso de R30, y el que mata la mutación M6. */
const DINERO_SIN_LIQUIDAR: DineroProductoDTO = {
  recaudado: "10000.00",
  liquidado: { recaudado: "0.00", ordenex: null, tienda: null, ordenes: 0 },
  pendiente: { recaudado: "10000.00", ordenes: 1 },
  retorno: null,
  // FICHA 449 — `null` por el MISMO motivo que los tres de arriba: sin una sola orden liquidada
  // no hay cifra que afirmar, y «no hubo» no se escribe `0.00`.
  fulfillment: null,
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

/**
 * FICHA 442 — el VALOR de un dato de la fila desplegable, buscado por su rótulo.
 *
 * El detalle es una rejilla de bloques «rótulo arriba, cifra debajo», así que el valor es el
 * hermano siguiente del rótulo. Se busca por el rótulo y no por posición: si mañana el orden de
 * los bloques cambia, este helper sigue midiendo lo mismo.
 *
 * ⚠ La fila tiene que estar ABIERTA: `DataTable` no mete el contenido en el DOM hasta entonces,
 * que es justamente lo que hace que la tabla cerrada cueste cero lecturas (R33).
 */
async function valorDeDetalle(rotulo: string): Promise<string> {
  // ⚠ SE BUSCA DENTRO DE `[data-slot="detalle-producto"]` Y NO EN TODO EL DOCUMENTO. El panel de
  // órdenes de la 347 repite los mismos rótulos a propósito —sus totales están ahí «para
  // cotejar» (R38)—, así que un `screen.getByText("Cobró Ordenex")` encuentra DOS y falla. Lo
  // que estos casos miden es la cifra de la FILA, que sale del DTO ya en pantalla y no de una
  // segunda consulta: es la que mata la mutación M6.
  const bloque = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-slot="detalle-producto"]');
    expect(el, "la fila no está abierta: no hay bloque de detalle").not.toBeNull();
    return el as HTMLElement;
  });
  const etiqueta = within(bloque).getByText(rotulo);
  return etiqueta.nextElementSibling?.textContent ?? "";
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
  it("sin la prop, la tabla no lleva ni una cifra de dinero, ni en la fila ni en su detalle", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr" })], { dinero: { estado: "denegado" } }),
    });
    renderTabla(false);

    await screen.findByText("Base Dr");

    // Ni la columna…
    expect(encabezados()).not.toContain(PRODUCTOS_COLUMNAS.recaudado);
    // …ni el aviso del dinero, ni siquiera dentro de «Cómo se cuenta»…
    await usuario.click(
      screen.getByRole("button", { name: new RegExp(PRODUCTOS_TEXTOS.comoSeCuenta) }),
    );
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeNull();
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoLiquidado)).toBeNull();

    // ⚠ FICHA 442 — EL CONTROL DE ABRIR SÍ EXISTE AHORA, Y NO ES UNA FUGA. Hasta esta ficha la
    // fila solo se abría para el dinero; ahora lleva también el volumen que bajó de la cabecera
    // (unidades, otros resultados, % de rechazo), que existe para todo el mundo. Lo que este
    // caso afirma es que al abrirla no aparece ni un importe y NO se consulta el detalle.
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno"),
      }),
    );
    // FICHA 449 — y el servicio de bodega entra en la misma lista: una cifra de dinero más es
    // una filtración más si la concesión no la tapa.
    for (const rotulo of [
      PRODUCTOS_COLUMNAS.ordenex,
      PRODUCTOS_COLUMNAS.paraTienda,
      PRODUCTOS_COLUMNAS.fulfillment,
    ]) {
      expect(screen.queryByText(rotulo), rotulo).toBeNull();
    }
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeNull();
    expect(document.body.textContent).not.toContain(money("45000.00"));
    // Y el detalle NO se consulta jamás.
    expect(detalleMock).not.toHaveBeenCalled();

    // Pero el volumen SÍ está: la fila abierta no está vacía.
    expect(screen.getByText(PRODUCTOS_COLUMNAS.unidades)).toBeInTheDocument();
    expect(screen.getByText(PRODUCTOS_COLUMNAS.rechazo)).toBeInTheDocument();
  });

  it("con la prop pero con la respuesta DENEGADA, tampoco: el servidor manda", async () => {
    // Los dos hechos son distintos: la prop dice «qué se dibuja» y el estado de la respuesta
    // dice «qué se sirvió». Si el borde denegara, pintar las cifras con «—» se leería como
    // «este producto no movió dinero», que es una afirmación falsa.
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero: null })], {
        dinero: { estado: "denegado" },
      }),
    });
    renderTabla(true);

    await screen.findByText("Base Dr");
    expect(encabezados()).not.toContain(PRODUCTOS_COLUMNAS.recaudado);
  });

  it("las cifras de VOLUMEN siguen ahí en los dos casos", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr" })], { dinero: { estado: "denegado" } }),
    });
    renderTabla(false);

    await screen.findByText("Base Dr");
    for (const columna of [
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.desenlaces,
      PRODUCTOS_COLUMNAS.efectividad,
    ]) {
      expect(encabezados()).toContain(columna);
    }
  });
});

/* ========================================================================== */
/* FICHA 442 — el dinero deja de ocupar el sitio de honor                     */
/* ========================================================================== */

describe("FICHA 442 · las cinco columnas, y el dinero al final", () => {
  beforeEach(() => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Base Dr" })]) });
  });

  it("el ORDEN de escritorio con dinero: cinco columnas y «Recaudado» la última", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // ⚠ EL DEFECTO QUE ESTE CASO CIERRA, medido a 1440 px el 2026-09-17: catorce columnas, siete
    // visibles sin desplazar y «Efectividad de entrega» en la 13.ª posición — fuera de pantalla.
    // Y lo primero que se veía eran las TRES columnas de dinero, las tres en «—» en las 25 filas.
    //
    // La 347 puso el dinero el segundo a propósito: con trece columnas algo se quedaba fuera
    // pase lo que pase, y prefirió que lo arrastrado fuera «% de rechazo». Con cinco columnas esa
    // disyuntiva ya no existe —no se queda fuera nada— así que el orden vuelve a ser el de las
    // preguntas: qué producto, cuántas órdenes, cómo acabaron, cuánto llegó, cuánto se recaudó.
    expect(encabezados()).toEqual([
      // La columna del control de desglose: sin texto visible, con nombre accesible.
      "Desglose",
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.desenlaces,
      PRODUCTOS_COLUMNAS.efectividad,
      PRODUCTOS_COLUMNAS.recaudado,
    ]);
  });

  it("«Efectividad» se lee entre las cinco primeras, no en la posición 13", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // La cifra del defecto, invertida y con su número: la posición. MUTACIÓN M1 — devolver
    // «Efectividad» detrás de las tres de dinero y los cuatro cubos la saca de aquí.
    const i = encabezados().indexOf(PRODUCTOS_COLUMNAS.efectividad);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThanOrEqual(4);
  });

  it("las dos cifras del reparto YA NO son columna: se leen al abrir la fila", async () => {
    const usuario = userEvent.setup();
    renderTabla(true);
    await screen.findByText("Base Dr");

    for (const rotulo of [PRODUCTOS_COLUMNAS.ordenex, PRODUCTOS_COLUMNAS.paraTienda]) {
      expect(encabezados(), rotulo).not.toContain(rotulo);
    }
    // Cerradas, sus importes no están en el DOM: eso es lo que devuelve el alto de cada fila.
    expect(document.body.textContent).not.toContain(money("6215.00"));

    // ⚠ MUTACIÓN M2 — «la fila desplegable deja de traer el dinero». Si el detalle se quedara
    // solo con el volumen, estas cuatro aserciones caen: las dos cifras del reparto estarían
    // escondidas de verdad, que es perder un dato y no reordenarlo.
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno"),
      }),
    );
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.ordenex)).toBe(money("6215.00"));
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.paraTienda)).toBe(money("28785.00"));
  });

  it("y la fila CERRADA vuelve a ser de un renglón: ninguna línea de apoyo bajo «Recaudado»", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // ⚠ EL OTRO DEFECTO MEDIDO: cada una de las tres columnas de dinero arrastraba una línea
    // secundaria («Con otro producto: 0 de 6») que doblaba el alto de CADA fila, y la 354 tuvo
    // que declarar 17rem de mínimo para que esas frases cupieran en un renglón. Sacadas de la
    // celda, la columna es una cifra y el mínimo vuelve al del rótulo.
    const td = celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado);
    expect(td.querySelectorAll("span.text-xs")).toHaveLength(0);
    expect(td.textContent).toBe(money("45000.00"));
    expect(td.textContent).not.toContain("Con otro producto");
    expect(td.textContent).not.toContain("Pendiente de cierre");
  });

  it("las dos frases de apoyo NO se pierden: se leen enteras en el detalle", async () => {
    const usuario = userEvent.setup();
    renderTabla(true);
    await screen.findByText("Base Dr");

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno"),
      }),
    );

    // R13 — en cuántas de sus órdenes hay otro producto, que es lo que calibra el aviso.
    const acompanadas = await screen.findByText(textoAcompanadas(3, 5));
    // R28/R29 — y lo pendiente de cierre, con su importe y sus órdenes.
    const pendiente = screen.getByText(textoPendiente("10000.00", 1));

    // R63 en su forma de esta ficha: enteras, sin abreviar y sin recortar.
    for (const linea of [acompanadas, pendiente]) {
      expect(linea.className).not.toMatch(/\btruncate\b/);
      expect(linea.className).not.toMatch(/\bline-clamp-/);
      expect(linea.className).not.toMatch(/\boverflow-hidden\b/);
    }
  });

  it("sin nada pendiente, la línea de pendiente NO se pinta", async () => {
    const usuario = userEvent.setup();
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

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Todo Liquidado", "Tienda Uno"),
      }),
    );
    await screen.findByText(textoAcompanadas(3, 5));
    // Un «Pendiente de cierre: ₡0 (0 órdenes)» en cada fila sería ruido justo en el caso bueno.
    // ⚠ La expresión ancla el DOS PUNTOS: «Pendiente de cierre» a secas es también el rótulo de
    // uno de los totales del panel de la 347, que sí se pinta y tiene que seguir haciéndolo.
    expect(screen.queryByText(/^Pendiente de cierre: /)).toBeNull();
  });

  it("R45 — LA ADVERTENCIA VIAJA CON EL DINERO: vive dentro del detalle", async () => {
    const usuario = userEvent.setup();
    renderTabla(true);
    await screen.findByText("Base Dr");

    // Cerrada, la advertencia no ocupa una línea en gris sobre la tabla…
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeNull();

    // …y abierta está pegada a las cifras, que es «donde alguien podría sumarlo por error»
    // (pedido del humano, 2026-09-17). MUTACIÓN M3: quitarla del detalle pone esto en rojo.
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno"),
      }),
    );
    const aviso = await screen.findByText(PRODUCTOS_TEXTOS.avisoDinero);
    // Las dos cosas que el aviso TIENE que decir, y no una versión suave de ellas.
    expect(aviso.textContent).toMatch(/ORDEN completa/);
    expect(aviso.textContent).toMatch(/no se pueden sumar/);

    // Y está DENTRO de la fila desplegable, no en cualquier sitio: el `<tr>` del detalle.
    const filaDetalle = aviso.closest("tr");
    expect(filaDetalle).not.toBeNull();
    expect(filaDetalle?.textContent).toContain(PRODUCTOS_COLUMNAS.ordenex);
  });

  it("pinta el importe de la columna con `money`, COMPLETO y sin abreviar", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // R63 — el importe COMPLETO. Es el defecto exacto que midieron la 343 (`₡1.70` donde el
    // DOM decía `₡1.700`) y la 344: dinero cortado no se ve roto, se ve como OTRO número.
    expect(cifra(celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado))).toBe(money("45000.00"));
  });

  it("R63 — la celda de dinero no lleva `truncate`, `line-clamp` ni `overflow-hidden`", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    const html = celda("Base Dr", PRODUCTOS_COLUMNAS.recaudado).outerHTML;
    expect(html).not.toMatch(/\btruncate\b/);
    expect(html).not.toMatch(/\bline-clamp-/);
    expect(html).not.toMatch(/\boverflow-hidden\b/);
    // Y la cifra no se puede partir por la mitad.
    expect(html).toMatch(/whitespace-nowrap/);
  });

  // ─── FICHA 348 · el aviso de «no sumable» se MUDÓ del encabezado a una leyenda ────────────
  //
  // La 347 lo escribía dentro de los tres rótulos («Recaudado (no sumable)») y medido en
  // Chromium a 1440 px la palabra MÁS ANCHA del encabezado era literalmente `sumable)` (61 px).
  // El aviso NO se pierde: es una leyenda que además dice CUÁLES son, derivándolas de las
  // columnas realmente pintadas. Desde la 442 la leyenda vive dentro de «Cómo se cuenta».
  it("R45 (348) — la leyenda nombra EXACTAMENTE las columnas que llevan un importe", async () => {
    const usuario = userEvent.setup();
    renderTabla(true);
    await screen.findByText("Base Dr");

    // QUÉ ES UNA COLUMNA DE DINERO, leído del DOM y no de una lista escrita aquí: aquella cuya
    // celda pinta un importe, o sea el símbolo de la moneda de la app. Así el caso no depende
    // de cuántas columnas de dinero haya hoy — el día que vuelva a haber tres, las exige.
    const simbolo = money("1.00").replace(/[\d.,\s]/g, "");
    expect(simbolo, "el símbolo de la moneda").not.toBe("");
    const h = encabezados();
    const conImporte = h.filter(
      (nombre) => nombre.trim() !== "" && celda("Base Dr", nombre).textContent?.includes(simbolo),
    );
    expect(conImporte.length).toBeGreaterThan(0);

    await usuario.click(
      screen.getByRole("button", { name: new RegExp(PRODUCTOS_TEXTOS.comoSeCuenta) }),
    );
    const leyenda = await screen.findByText(textoColumnasNoSumables(conImporte));
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

  it("R29/R45 — las reglas del dinero siguen escritas, en «Cómo se cuenta»", async () => {
    const usuario = userEvent.setup();
    renderTabla(true);
    await screen.findByText("Base Dr");

    await usuario.click(
      screen.getByRole("button", { name: new RegExp(PRODUCTOS_TEXTOS.comoSeCuenta) }),
    );
    // R45 pide que la advertencia se diga TRES veces: aquí, en el detalle y en el archivo.
    expect(await screen.findByText(PRODUCTOS_TEXTOS.avisoDinero)).toBeInTheDocument();
    // R29 — el reparto es SÓLO de lo ya liquidado.
    expect(screen.getByText(PRODUCTOS_TEXTOS.avisoLiquidado)).toBeInTheDocument();
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
  it("las dos cifras del reparto son el marcador de dato ausente", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Cierre", dinero: DINERO_SIN_LIQUIDAR })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Cierre");

    // Lo que SÍ es un hecho se pinta en la columna: lo recaudado existe desde que se registró la
    // gestión.
    expect(cifra(celda("Sin Cierre", PRODUCTOS_COLUMNAS.recaudado))).toBe(money("10000.00"));

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Sin Cierre", "Tienda Uno"),
      }),
    );

    // ⚠ ÉSTE ES EL CASO QUE MATA LA MUTACIÓN M6. «Todavía no se sabe lo que cobró Ordenex» y
    // «Ordenex no cobró nada» son dos hechos distintos, y en una pantalla de dinero la
    // diferencia decide si alguien reclama una liquidación o no.
    for (const rotulo of [PRODUCTOS_COLUMNAS.ordenex, PRODUCTOS_COLUMNAS.paraTienda]) {
      const valor = await valorDeDetalle(rotulo);
      expect(valor, rotulo).toBe(money(null));
      expect(valor, rotulo).not.toBe(money("0.00"));
    }
  });

  it("una fila SIN ninguna orden que aporte pinta «—» en las tres", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Ventas", dinero: null })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Ventas");

    expect(cifra(celda("Sin Ventas", PRODUCTOS_COLUMNAS.recaudado))).toBe(money(null));

    // Y la concesión se respeta aunque la fila no tenga dato: las dos cifras del reparto SE
    // DECLARAN y dicen «—». No pintarlas sería callar que no se sabe.
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Sin Ventas", "Tienda Uno"),
      }),
    );
    for (const rotulo of [PRODUCTOS_COLUMNAS.ordenex, PRODUCTOS_COLUMNAS.paraTienda]) {
      expect(await valorDeDetalle(rotulo), rotulo).toBe(money(null));
    }
  });

  it("y esa fila NO monta el panel de órdenes: no hay ninguna que enseñar", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Sin Ventas", dinero: null })]),
    });
    renderTabla(true);
    await screen.findByText("Sin Ventas");

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Sin Ventas", "Tienda Uno"),
      }),
    );
    await screen.findByText(PRODUCTOS_COLUMNAS.unidades);

    // El panel de la 347 lee órdenes; sin ninguna que aporte, montarlo sería una consulta para
    // enseñar un vacío. El resto del detalle —el volumen— sí está.
    expect(
      screen.queryByRole("region", {
        name: DETALLE_DINERO_TEXTOS.region("Sin Ventas", "Tienda Uno"),
      }),
    ).toBeNull();
    expect(detalleMock).not.toHaveBeenCalled();
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

  it("R76 — con el tope superado lo dice, y NO pinta cifras de dinero vacías", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero: null })], {
        dinero: { estado: "limite_excedido", limite: 5000 },
      }),
    });
    renderTabla(true);
    await screen.findByText("Base Dr");

    // ⚠ Y NO SE PLIEGA bajo «Cómo se cuenta»: no es una regla de lectura, es el estado de ESTA
    // consulta. Quien no lo lea creerá que estos productos no movieron dinero.
    expect(screen.getByText(PRODUCTOS_TEXTOS.dineroLimiteExcedido(5000))).toBeInTheDocument();
    expect(encabezados()).not.toContain(PRODUCTOS_COLUMNAS.recaudado);
    // Y el VOLUMEN sigue intacto: el tope es de la lectura de dinero, no de la de productos.
    expect(encabezados()).toContain(PRODUCTOS_COLUMNAS.ordenes);
    expect(encabezados()).toContain(PRODUCTOS_COLUMNAS.efectividad);
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
/* Entrega B — la composición de «Otros resultados», ahora en el detalle      */
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

  it("R50 — el detalle dice CUÁNTAS arriba y DE QUÉ debajo, sin tocar la etiqueta", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla(true);
    await screen.findByText("Crema Especial MLX");

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Crema Especial MLX", "Tienda Uno"),
      }),
    );

    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.otrosResultados)).toBe("6");
    expect(screen.getByText("4 devueltas · 2 reprogramadas")).toBeInTheDocument();
    // Y la ETIQUETA NO enumera: mentiría el día que el catálogo gane un desenlace, que es el
    // defecto que la 346 acaba de reparar.
    expect(PRODUCTOS_COLUMNAS.otrosResultados).toBe("Otros resultados");
  });

  it("R57 — es legible SIN apuntar: es texto en el DOM, no un `title` ni un tooltip", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla(true);
    await screen.findByText("Crema Especial MLX");

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Crema Especial MLX", "Tienda Uno"),
      }),
    );

    // Un tooltip no existe en táctil, no se copia y los lectores de pantalla lo tratan
    // distinto. Esta tabla ya tuvo DOS arreglos de ancho medidos a 390 px.
    const linea = await screen.findByText("4 devueltas · 2 reprogramadas");
    expect(linea.getAttribute("title")).toBeNull();
    expect(linea.closest("[role='tooltip']")).toBeNull();
  });

  it("R54 — con el conteo en cero, no se pinta ninguna composición", async () => {
    const usuario = userEvent.setup();
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

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Spray Protector", "Tienda Uno"),
      }),
    );

    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.otrosResultados)).toBe("0");
    // El dato es EXACTAMENTE el conteo: ni una línea en blanco que haga el detalle más alto.
    const bloque = screen.getByText(PRODUCTOS_COLUMNAS.otrosResultados).parentElement;
    expect(bloque?.textContent).toBe(`${PRODUCTOS_COLUMNAS.otrosResultados}0`);
  });
});

/* ========================================================================== */
/* R64 / R57 — el teléfono no enseña menos                                    */
/* ========================================================================== */

describe("FICHA 347/442 · la vista de TELÉFONO lleva lo mismo (R64)", () => {
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

  it("la pila lleva las mismas cifras que las columnas del portátil, y el resto en el detalle", async () => {
    const usuario = userEvent.setup();
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
    // más, más la del control que abre el detalle.
    expect(encabezados().slice(-2)).toEqual([
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.cifras,
    ]);
    expect(encabezados()).toHaveLength(3);

    // Lo que el portátil pone en columna, el teléfono lo apila: las mismas tres cifras.
    for (const etiqueta of [
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.efectividad,
      PRODUCTOS_COLUMNAS.recaudado,
      PRODUCTOS_COLUMNAS.desenlaces,
    ]) {
      expect(screen.getByText(etiqueta), etiqueta).toBeInTheDocument();
    }
    expect(screen.getByText(money("45000.00"))).toBeInTheDocument();
    // …y la frase de desenlaces, entera (R57).
    expect(screen.getByText(/3 entregadas/)).toBeInTheDocument();

    // Y el resto vive en la MISMA fila desplegable que en escritorio: ni un dato menos (R64).
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Crema Especial MLX", "Tienda Uno"),
      }),
    );
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.ordenex)).toBe(money("6215.00"));
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.paraTienda)).toBe(money("28785.00"));
    expect(screen.getByText(textoAcompanadas(3, 5))).toBeInTheDocument();
    expect(screen.getByText(textoPendiente("10000.00", 1))).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* FICHA 348 / 442 — el ancho de las columnas es una DECISIÓN                 */
/* ========================================================================== */

describe("FICHA 348/442 · el ancho de las columnas es una DECISIÓN, no el resto del reparto", () => {
  // Dos tiendas distintas: es lo que monta la columna «Tienda», y es el caso de producción que
  // la 347 NO midió —la base local tiene una sola tienda—. Con ella montada, `Nuform` salía
  // partido.
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

  it("las SEIS columnas declaran un ancho mínimo, y ninguna se queda sin él", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    const ths = encabezadosDeDatos();
    // ⚠ SEIS, Y ANTES ERAN TRECE. El número se escribe a mano a propósito: es la cifra del
    // defecto de la 442 y cambiarlo obliga a releer la tabla de mínimos del componente.
    expect(ths.map((th) => th.textContent)).toHaveLength(6);

    // ⚠ SIN ESTE CASO NADA ATABA LOS ANCHOS. Antes de la 348, la tabla declaraba TRES mínimos
    // para trece columnas y quitarlos no ponía nada en rojo: el navegador estrujaba las otras
    // hasta partir palabras y la suite entera seguía verde.
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

  it("FICHA 442 — la suma de los mínimos CABE en el contenedor de 1440 px", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // ⚠ ES LA CIFRA DEL DEFECTO, en su forma comprobable sin navegador: a 1440 px el contenedor
    // de esta sección mide 1102 px y con los trece mínimos de la 348 la tabla pedía 1416 — 314
    // px fuera, y «Efectividad» entre ellos. jsdom no hace layout, así que lo que se puede
    // afirmar aquí es la SUMA DE LOS MÍNIMOS DECLARADOS, que es lo que la gobierna.
    //
    // 68 px es la columna del control de desglose medida en Chromium (24 de relleno + 20 del
    // botón + 24). El margen sobra: lo que este caso impide es volver a declarar mínimos que no
    // caben. MUTACIÓN: devolver las trece columnas lo pone en rojo.
    const suma = encabezadosDeDatos()
      .map((th) => Number.parseFloat(th.style.minWidth) * 16)
      .reduce((a, b) => a + b, 0);
    expect(suma + 68).toBeLessThanOrEqual(1102);
  });

  it("ningún nombre —de producto o de tienda— puede partirse por dentro", async () => {
    renderTabla(true);
    await screen.findByText("Base Dr");

    // El defecto reportado por el humano en la 348, en su forma comprobable sin navegador:
    // `wrap-anywhere` reduce el `min-content` de la columna a UN carácter y autoriza al
    // navegador a dejarla más estrecha que su palabra más larga.
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
    //
    // ⚠ Y LA RAMA SINGULAR ES LA VIVA DESDE LA 442: de las tres cifras de dinero sólo
    // «Recaudado» es columna, así que la leyenda que se pinta es literalmente ésta.
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

/* ========================================================================== */
/* FICHA 449 — el SERVICIO DE BODEGA, en el detalle y sólo cuando hay monto   */
/* ========================================================================== */

/**
 * FICHA 449 — la cifra de bodega llega hasta la pantalla, y llega FUERA de la fórmula.
 *
 * ─── EL DEFECTO QUE CIERRA, MEDIDO ──────────────────────────────────────────────────────────
 *
 * La MISMA orden enseñaba el fulfillment en el detalle del cierre y lo escondía en esta tabla:
 * el `SELECT` del dinero por producto congelaba nueve columnas de tarifa y ésa no era una de
 * ellas. En producción, el 2026-09-17: 867 filas y 605.616 colones en siete días. La mitad de
 * backend ya la sube hasta el DTO; esto es lo que la pone delante de alguien.
 *
 * ─── LAS TRES COSAS QUE ESTOS CASOS AFIRMAN, Y POR QUÉ CADA UNA ─────────────────────────────
 *
 *  1. QUE SE PINTA CON SU MONTO, y en los DOS sitios del detalle: el bloque de la fila —que
 *     sale del DTO ya en pantalla, sin una segunda consulta— y la cabecera del panel de la 347,
 *     que repite los mismos rótulos «para cotejar» (R38).
 *  2. QUE NO SE PINTA CUANDO NO HAY NADA QUE DECIR. Y aquí la regla es distinta de la de sus
 *     cuatro hermanas a propósito: `ordenex`, `tienda`, `retorno` y lo pendiente se pintan
 *     SIEMPRE, con «—» cuando faltan, porque su ausencia contesta la pregunta que el usuario
 *     vino a hacer. El fulfillment no lo tiene contratado la mayoría de las tiendas, así que
 *     para ellas la cifra es un `"0.00"` CIERTO que se leería como un concepto que les aplica y
 *     les salió en cero. Los dos estados sin monto —`"0.00"` y `null`— se callan.
 *  3. QUE NO ES UN SUMANDO DE «Cobró Ordenex». Es la afirmación cara: dentro de `ordenex` vive
 *     la igualdad `ordenex + tienda === liquidado.recaudado`, cierta POR CONSTRUCCIÓN, y un
 *     sumando nuevo la rompería en silencio. El caso lo mide por comportamiento —la celda sigue
 *     diciendo lo mismo Y la suma de las dos NO aparece en el DOM—, no leyendo el código.
 */
describe("FICHA 449 · el fulfillment en el detalle de la fila", () => {
  /** El mismo dinero de arriba con OTRO fulfillment: los tres estados del contrato. */
  function conFulfillment(valor: string | null): DineroProductoDTO {
    return { ...DINERO, fulfillment: valor };
  }

  /** El payload del panel de la 347 con los totales que se le pasen. */
  function payload(totales: DineroProductoDTO) {
    return {
      status: "ok" as const,
      datos: {
        producto: "Base Dr",
        tiendaNombre: "Tienda Uno",
        totales,
        total: 1,
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

  /** El bloque de la FILA desplegada (el que no depende de la segunda consulta). */
  async function bloqueDeFila(): Promise<HTMLElement> {
    return waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="detalle-producto"]');
      expect(el, "la fila no está abierta: no hay bloque de detalle").not.toBeNull();
      return el as HTMLElement;
    });
  }

  /**
   * Abre la fila de `Base Dr` con ese dinero y devuelve el PANEL, ya asentado.
   *
   * ⚠ EL ANCLA ES UN CONTENIDO —el enlace de la guía— y no un conteo ni la llamada al mock.
   * Mientras el panel carga, `totales` es `null` y NINGUNA cifra está pintada: un caso de los
   * que dicen «esto no aparece» se cumpliría a media carga y pasaría sin haber medido nada.
   */
  async function abrir(dinero: DineroProductoDTO): Promise<HTMLElement> {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero })]),
    });
    detalleMock.mockResolvedValue(payload(dinero));
    renderTabla(true);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );
    const panel = await screen.findByRole("region", {
      name: DETALLE_DINERO_TEXTOS.region("Base Dr", "Tienda Uno"),
    });
    await within(panel).findByRole("link", { name: DETALLE_DINERO_TEXTOS.verOrden("77001") });
    return panel;
  }

  it("con monto, la cifra se pinta en los DOS sitios del detalle", async () => {
    const panel = await abrir(conFulfillment("2784.00"));

    // (1) el bloque de la fila: sale del DTO que ya estaba en pantalla.
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.fulfillment)).toBe(money("2784.00"));
    // (2) la cabecera del panel, con su pista al lado.
    expect(
      within(panel).getByText(DETALLE_DINERO_TEXTOS.totales.fulfillment),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(DETALLE_DINERO_TEXTOS.totales.fulfillmentPista),
    ).toBeInTheDocument();
    expect(within(panel).getAllByText(money("2784.00")).length).toBeGreaterThan(0);
  });

  it("con `0.00` NO se pinta: una tienda sin bodega no ve una fila de ceros", async () => {
    const panel = await abrir(conFulfillment("0.00"));
    const bloque = await bloqueDeFila();

    // Ni el rótulo, ni la pista, ni un cero colgando de ellos.
    expect(within(bloque).queryByText(PRODUCTOS_COLUMNAS.fulfillment)).toBeNull();
    expect(within(panel).queryByText(DETALLE_DINERO_TEXTOS.totales.fulfillment)).toBeNull();
    expect(within(panel).queryByText(DETALLE_DINERO_TEXTOS.totales.fulfillmentPista)).toBeNull();

    // ⚠ Y EL CASO NO ES VACÍO: el resto del detalle SÍ está pintado. Sin esto, «no aparece»
    // también sería cierto de una pantalla en blanco.
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.ordenex)).toBe(money("6215.00"));
    expect(within(panel).getAllByText(money("2260.00")).length).toBeGreaterThan(0);
  });

  it("con `null` tampoco se pinta —y sus cuatro hermanas SÍ, en «—»", async () => {
    // El contraste es el caso: `DINERO_SIN_LIQUIDAR` no tiene ni una orden liquidada, así que
    // `ordenex`, `tienda` y `retorno` llegan `null` y se pintan con la raya larga (R30). El
    // fulfillment llega `null` por el MISMO motivo y NO se pinta en absoluto. Son dos
    // tratamientos distintos del mismo `null`, y esta ficha los decidió a sabiendas.
    const panel = await abrir(DINERO_SIN_LIQUIDAR);
    const bloque = await bloqueDeFila();

    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.ordenex)).toBe(money(null));
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.paraTienda)).toBe(money(null));
    expect(within(bloque).queryByText(PRODUCTOS_COLUMNAS.fulfillment)).toBeNull();
    expect(within(panel).queryByText(DETALLE_DINERO_TEXTOS.totales.fulfillment)).toBeNull();
  });

  it("NO es un sumando de «Cobró Ordenex»: el reparto dice exactamente lo mismo", async () => {
    // ⚠ LA AFIRMACIÓN CARA DE LA FICHA. `ordenex` es flete + IVA y comisión + IVA, y «Para la
    // tienda» se calcula como la RESTA de eso contra lo recaudado: meter el fulfillment dentro
    // rompería `ordenex + tienda === liquidado.recaudado` sin que nada se viera roto.
    await abrir(conFulfillment("2784.00"));

    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.ordenex)).toBe(money("6215.00"));
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.paraTienda)).toBe(money("28785.00"));
    expect(await valorDeDetalle(PRODUCTOS_COLUMNAS.fulfillment)).toBe(money("2784.00"));

    // Y la suma de los dos —6215 + 2784 = 8999— NO está en ninguna parte del documento: nadie
    // puede leer que el total cambió. El número no aparece por ningún otro camino.
    expect(document.body.textContent).not.toContain(money("8999.00"));
  });

  it("el aviso de no-sumable CUBRE la cifra nueva, en los dos sitios", async () => {
    // ⚠ COMPROBADO, NO SUPUESTO. R45 pide que la advertencia viaje con el dinero; lo que la
    // hace cierta para una cifra nueva es que el párrafo esté DESPUÉS de ella y dentro del
    // mismo contenedor, que es lo que estas dos comparaciones de posición miden.
    const panel = await abrir(conFulfillment("2784.00"));
    const bloque = await bloqueDeFila();
    const detalleDeLaFila = bloque.parentElement as HTMLElement;

    const enLaFila = within(bloque).getByText(PRODUCTOS_COLUMNAS.fulfillment);
    const avisoDeLaFila = within(detalleDeLaFila).getByText(PRODUCTOS_TEXTOS.avisoDinero);
    expect(
      enLaFila.compareDocumentPosition(avisoDeLaFila) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);

    const enElPanel = within(panel).getByText(DETALLE_DINERO_TEXTOS.totales.fulfillment);
    const avisoDelPanel = within(panel).getByText(DETALLE_DINERO_TEXTOS.avisoOrden);
    expect(
      enElPanel.compareDocumentPosition(avisoDelPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("un solo nombre para una sola cifra: el que ya tiene en el detalle del cierre", () => {
    // ⚠ CONTRA OTRA FUENTE, no contra sí misma. `FULFILLMENT_COL` es la constante con la que
    // esta cifra se lee en el cierre y en las cinco descargas de gestiones; la ficha nace de
    // que la misma orden la enseñaba allí y la escondía aquí, así que bautizarla de nuevo
    // dejaría el defecto en pie con otra cara. Es la lección de la 338 con «Flete por rechazo».
    expect(PRODUCTOS_COLUMNAS.fulfillment).toBe(FULFILLMENT_COL);
    expect(DETALLE_DINERO_TEXTOS.totales.fulfillment).toBe(FULFILLMENT_COL);
  });

  it("R6 — sin la concesión la cifra no existe, aunque el DTO la traiga", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Base Dr", dinero: conFulfillment("2784.00") })], {
        dinero: { estado: "denegado" },
      }),
    });
    renderTabla(false);

    await screen.findByText("Base Dr");
    await usuario.click(
      screen.getByRole("button", { name: PRODUCTOS_TEXTOS.abrirDetalle("Base Dr", "Tienda Uno") }),
    );
    const bloque = await bloqueDeFila();

    // El volumen SÍ está —la fila abierta no está vacía—, y ni el rótulo ni el importe.
    expect(within(bloque).getByText(PRODUCTOS_COLUMNAS.unidades)).toBeInTheDocument();
    expect(within(bloque).queryByText(PRODUCTOS_COLUMNAS.fulfillment)).toBeNull();
    expect(document.body.textContent).not.toContain(money("2784.00"));
    expect(detalleMock).not.toHaveBeenCalled();
  });
});
