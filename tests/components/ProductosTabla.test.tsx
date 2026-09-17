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
  textoTiendaUnica,
  tiendaUnicaDe,
} from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { textoDesenlacesDeFila } from "@/app/(app)/analitica/_components/entregas/desenlaces-de-fila";
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
    ordenesAcompanadas: 0,
    dinero: null,
    ...parcial,
  };
}

function datos(filas: FilaProductoDTO[], extra: Partial<ConteoProductosDTO> = {}): ConteoProductosDTO {
  return {
    filas,
    ordenes: filas.reduce((s, f) => s + f.ordenes, 0),
    ordenesSinProducto: 0,
    dinero: { estado: "denegado" },
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

/** Las CELDAS de una fila de la tabla, en el orden en que están pintadas. */
function tdsDeFila(nombre: string | RegExp): HTMLTableCellElement[] {
  const celda = screen.getByRole("cell", { name: nombre });
  const tr = celda.closest("tr");
  return [...(tr?.querySelectorAll("td") ?? [])];
}

/** Los textos de las celdas de una fila de la tabla, en el orden en que están pintadas. */
function celdasDeFila(nombre: string | RegExp): string[] {
  return tdsDeFila(nombre).map((td) => td.textContent ?? "");
}

/**
 * La CIFRA de una celda: el número que la encabeza, sin las líneas de contexto que la ficha
 * 347 pone debajo (la composición de «Otros resultados», las acompañadas, lo pendiente).
 *
 * Se lee por `.tabular-nums`, que es la clase del componente `Cifra` y de nadie más: las
 * líneas de contexto usan `Contexto`, que no la lleva. Si mañana alguien pinta una cifra sin
 * `Cifra`, este helper cae al `textContent` entero y el caso lo dirá.
 */
function cifraDeCelda(td: HTMLTableCellElement): string {
  return td.querySelector(".tabular-nums")?.textContent ?? td.textContent ?? "";
}

/**
 * Los encabezados de DATOS de la tabla de productos, en su orden.
 *
 * El `<th>` del control de desglose NO es uno: su rótulo es `sr-only` y lo antepone `DataTable`
 * cuando el consumidor pasa `renderExpanded` — desde la ficha 442 eso es SIEMPRE, porque la fila
 * que se abre lleva las cifras que salieron de la cabecera.
 */
function encabezadosDeDatos(): string[] {
  const tabla = screen.getAllByRole("table")[0];
  return [...tabla.querySelectorAll<HTMLTableCellElement>("thead th")]
    .filter((th) => th.querySelector(".sr-only") === null)
    .map((th) => th.textContent ?? "");
}

/**
 * `matchMedia` REAL del entorno, guardada antes de que ningún caso la sustituya: el caso de la
 * vista de teléfono la reemplaza para forzar `useIsMobile`, y sin reponerla los casos siguientes
 * heredarían la vista de móvil sin pedirla.
 */
const MATCH_MEDIA_REAL = window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = MATCH_MEDIA_REAL;
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

    // FICHA 442 — el control de las reglas de lectura SÍ está desde el primer render: no es un
    // dato, es la puerta a las advertencias. Lo que ya no está es el párrafo abierto: las seis
    // líneas en gris se pliegan bajo «Cómo se cuenta» (ver el bloque de la 442 más abajo).
    expect(
      screen.getByRole("button", { name: new RegExp(PRODUCTOS_TEXTOS.comoSeCuenta) }),
    ).toBeInTheDocument();
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
  it("FICHA 442 — pinta CUATRO columnas de datos sin dinero, y «Efectividad» es la última", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Dr Melaxin", unidades: 19, ordenes: 16 })]),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    // ⚠ EL ORDEN SE ATA ENTERO, no columna a columna: el defecto de la 442 no era que faltara un
    // encabezado, era que había CATORCE y «Efectividad de entrega» caía en la 13.ª posición,
    // fuera de la ventana. Un caso que solo comprobara «cada encabezado está» pasaba en verde
    // con la tabla rota, que es exactamente lo que pasó.
    expect(encabezadosDeDatos()).toEqual([
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.ordenes,
      PRODUCTOS_COLUMNAS.desenlaces,
      PRODUCTOS_COLUMNAS.efectividad,
    ]);
    // Y la posición de «Efectividad» dicha con un número: dentro de las cuatro primeras, que es
    // lo que cabe sin desplazar. MUTACIÓN: devolverla al final de catorce pone esto en rojo.
    expect(encabezadosDeDatos().indexOf(PRODUCTOS_COLUMNAS.efectividad)).toBeLessThan(4);
  });

  it("FICHA 442 — las cifras que bajaron al detalle NO son columnas, y siguen estando", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([fila({ producto: "Dr Melaxin", unidades: 19, ordenes: 16 })]),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    // Las tres que dejaron de ser columna…
    for (const rotulo of [
      PRODUCTOS_COLUMNAS.unidades,
      PRODUCTOS_COLUMNAS.otrosResultados,
      PRODUCTOS_COLUMNAS.rechazo,
    ]) {
      expect(encabezadosDeDatos(), rotulo).not.toContain(rotulo);
    }

    // …se leen enteras al abrir la fila. ⚠ ESTA ES LA MITAD QUE HACE QUE LA DE ARRIBA VALGA
    // ALGO: sin ella, «quitar columnas» y «perder datos» pasarían el mismo caso.
    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Dr Melaxin", "Tienda Uno"),
      }),
    );
    for (const rotulo of [
      PRODUCTOS_COLUMNAS.unidades,
      PRODUCTOS_COLUMNAS.otrosResultados,
      PRODUCTOS_COLUMNAS.rechazo,
    ]) {
      expect(screen.getByText(rotulo), rotulo).toBeInTheDocument();
    }
    // Las unidades, con su cifra: 19.
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  it("con UNA sola tienda en la respuesta la columna Tienda NO se pinta, y su nombre se dice UNA vez", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Dr Melaxin", tiendaId: "t1", tienda: "Nuform" }),
        fila({ producto: "BASE C", tiendaId: "t1", tienda: "Nuform" }),
      ]),
    });
    renderTabla();

    await screen.findByText("Dr Melaxin");
    expect(screen.queryByRole("columnheader", { name: PRODUCTOS_COLUMNAS.tienda })).toBeNull();

    // ⚠ FICHA 442 — LA OTRA MITAD, Y ES LA QUE FALTABA. Hasta esta ficha la columna se escondía
    // y con ella desaparecía el NOMBRE de la tienda: la pantalla dejaba de decir de quién eran
    // esas filas. Ahora se dice una vez, en el chip, y por eso el número de apariciones es una
    // aserción y no una impresión: 1, no 0 y no 25.
    const apariciones = screen.getAllByText(textoTiendaUnica("Nuform"));
    expect(apariciones).toHaveLength(1);
    // Y el nombre suelto no se repite fila a fila.
    expect(screen.queryAllByRole("cell", { name: "Nuform" })).toHaveLength(0);
  });

  it("FICHA 442 — con VARIAS tiendas no hay chip: ahí la columna sí distingue", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        fila({ producto: "Crema Especial MLX", tiendaId: "t1", tienda: "Nuform" }),
        fila({ producto: "Crema Especial MLX", tiendaId: "t2", tienda: "Distribuidora Karla" }),
      ]),
    });
    renderTabla();

    await screen.findAllByText("Crema Especial MLX");
    // No puede haber chip Y columna: un nombre de tienda dicho dos veces en la misma pantalla,
    // una como filtro y otra como dato, invita a leer uno por el otro.
    expect(screen.queryByText(textoTiendaUnica("Nuform"))).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: PRODUCTOS_COLUMNAS.tienda }),
    ).toBeInTheDocument();
  });

  it("FICHA 442 — la decisión chip/columna es UNA sola, y `tiendaUnicaDe` es su otra cara", () => {
    const unaTienda = [
      fila({ producto: "X", tiendaId: "t1", tienda: "Nuform" }),
      fila({ producto: "Y", tiendaId: "t1", tienda: "Nuform" }),
    ];
    const dosTiendas = [
      fila({ producto: "X", tiendaId: "t1", tienda: "Nuform" }),
      fila({ producto: "X", tiendaId: "t2", tienda: "Otra" }),
    ];

    // Las dos funciones son EXCLUYENTES por construcción: exactamente una de ellas «habla».
    expect(hayVariasTiendas(unaTienda)).toBe(false);
    expect(tiendaUnicaDe(unaTienda)).toBe("Nuform");
    expect(hayVariasTiendas(dosTiendas)).toBe(true);
    expect(tiendaUnicaDe(dosTiendas)).toBeNull();
    // Y sin filas no hay ninguna tienda que decir: ni chip, ni columna.
    expect(tiendaUnicaDe([])).toBeNull();
    expect(hayVariasTiendas([])).toBe(false);
  });

  it("FICHA 442 — para un `adminTienda` la columna NO PUEDE existir, y no por una regla de rol", () => {
    // ⚠ ESTO NO SE SUPONE, SE DERIVA DEL ALCANCE. `lib/analytics/alcance.ts` resuelve el
    // `adminTienda` como `{ tipo: "tienda", tiendaId: actor.usuarioId }` y
    // `lib/analytics/alcance-columnas.ts` lo traduce a `where { tiendaId }`: el servidor no le
    // puede devolver filas de dos tiendas. Sea cual sea el número de filas, el `Set` de
    // `tiendaId` tiene tamaño 1, así que `hayVariasTiendas` es falso SIEMPRE — sin que el
    // cliente escriba ni un `if (rol === …)`, que es lo que R37/R46 prohíben.
    const comoLasSirveElServidorAUnaTienda = Array.from({ length: 25 }, (_, i) =>
      fila({ producto: `Producto ${i}`, tiendaId: "la-unica", tienda: "Nuform" }),
    );
    expect(hayVariasTiendas(comoLasSirveElServidorAUnaTienda)).toBe(false);
    expect(tiendaUnicaDe(comoLasSirveElServidorAUnaTienda)).toBe("Nuform");
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
    // La primera celda es la del control de desglose, que `DataTable` antepone: se descarta.
    const celdas = celdasDeFila("Spray Protector").slice(1);

    // FICHA 442 — producto, órdenes, en qué terminaron, efectividad. Cuatro celdas, no nueve.
    expect(celdas).toEqual([
      "Spray Protector",
      "16",
      // La celda de desenlaces es la BARRA (sin texto) y la frase que la dice con números. La
      // frase sale de la MISMA función pura que la tabla usa, así que este caso afirma que la
      // celda la pinta — no que el test sepa redactarla.
      textoDesenlacesDeFila(porStatus),
      // FRACCIÓN por cien, con un decimal como máximo. 0,5 => «50%»; 0,375 => «37,5%». El
      // locale es el del repo (`MONEDA_LOCALE`, es-CR), que no pone espacio antes del signo.
      "50%",
    ]);
    // R28 — y lo que la frase enumera son los cubos de `calcularEfectividad`, no un recuento
    // propio: 8 entregadas, 6 rechazadas, 2 en proceso.
    expect(textoDesenlacesDeFila(porStatus)).toContain(String(esperado.entregadas));
    expect(textoDesenlacesDeFila(porStatus)).toContain(String(esperado.rechazadas));
    expect(textoDesenlacesDeFila(porStatus)).toContain(String(esperado.enProceso));
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
/* FICHA 346 / 442 — la FRASE del desenlace SUMA la columna «Órdenes»         */
/* ========================================================================== */

describe("FICHA 346/442 · «En qué terminaron» suma la columna «Órdenes»", () => {
  /**
   * LOS NÚMEROS QUE LA CELDA PINTA, leídos del DOM y sumados aquí.
   *
   * ⚠ SE LEE EL TEXTO PINTADO Y NO LA FUNCIÓN QUE LO PRODUCE. Comparar la frase contra
   * `textoDesenlacesDeFila` sería compararla consigo misma y estaría verde pase lo que pase
   * (`asercion-contra-su-propia-fuente`). Lo que este helper mide es lo que el humano suma con
   * el dedo: «3 entregadas · 2 rechazadas · 4 devueltas · 2 reprogramadas · 13 en proceso».
   */
  function numerosDelDesenlace(nombreFila: string): number[] {
    const i = encabezadosDeDatos().indexOf(PRODUCTOS_COLUMNAS.desenlaces);
    expect(i).toBeGreaterThanOrEqual(0);
    // +1: `DataTable` antepone la celda del control de desglose a cada fila.
    const td = tdsDeFila(nombreFila)[i + 1];
    const texto = td.textContent ?? "";
    return [...texto.matchAll(/(\d+)\s/g)].map((m) => Number(m[1]));
  }

  /** La cifra de la columna «Órdenes» de una fila. */
  function ordenesDeFila(nombreFila: string): number {
    const i = encabezadosDeDatos().indexOf(PRODUCTOS_COLUMNAS.ordenes);
    expect(i).toBeGreaterThanOrEqual(0);
    return Number(cifraDeCelda(tdsDeFila(nombreFila)[i + 1]).replace(/\./g, ""));
  }

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

  it("`Crema Especial MLX`: 3 + 2 + 4 + 2 + 13 = 24, la captura del 2026-08-29", async () => {
    // LA CAPTURA que abrió la ficha 346: la pantalla decía «Órdenes 24» y debajo 3 entregadas, 2
    // rechazadas y 13 en proceso. 3 + 2 + 13 = 18, y faltaban seis órdenes que no aparecían en
    // ninguna columna.
    //
    // ⚠ LA FICHA 442 NO DEROGA ESE ARREGLO, LE CAMBIA LA FORMA: las cuatro columnas de cubos se
    // convierten en UNA frase que los enumera. La igualdad que la 346 compró sigue siendo
    // comprobable a simple vista y sigue teniendo su caso — ahora sobre la frase, que es lo que
    // se lee. Volver a dejar fuera «otros resultados» (el defecto original) pone esto en rojo
    // exactamente igual: la suma daría 18 y la columna dice 24.
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla();

    await screen.findByText("Crema Especial MLX");

    const numeros = numerosDelDesenlace("Crema Especial MLX");
    expect(numeros).toEqual([3, 2, 4, 2, 13]);
    expect(numeros.reduce((a, b) => a + b, 0)).toBe(ordenesDeFila("Crema Especial MLX"));
    expect(ordenesDeFila("Crema Especial MLX")).toBe(24);

    // Y el porcentaje de la captura, intacto y ahora VISIBLE sin desplazar: 3/24.
    expect(screen.getByText("12,5%")).toBeInTheDocument();
  });

  it("los cinco cubos se nombran por su nombre, sin enumerarlos en ningún rótulo", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla();

    await screen.findByText("Crema Especial MLX");
    // La frase DERIVA las etiquetas del catálogo (`etiquetaDeDesenlace`): un sexto desenlace
    // entra solo. El rótulo de la columna, en cambio, NO enumera nada — mentiría el día que el
    // catálogo crezca, que es el defecto que la 346 reparó.
    const texto = tdsDeFila("Crema Especial MLX")
      .map((td) => td.textContent ?? "")
      .join(" ");
    for (const trozo of ["3 entregadas", "2 rechazadas", "4 devueltas", "2 reprogramadas", "13 en proceso"]) {
      expect(texto, trozo).toContain(trozo);
    }
    expect(PRODUCTOS_COLUMNAS.desenlaces).toBe("En qué terminaron");
  });

  it("el % de rechazo de la captura sigue ahí: se lee al abrir la fila", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla();

    await screen.findByText("Crema Especial MLX");
    // 2/24 = 8,3 %. Ya no es una columna —la 442 lo bajó al detalle— pero NO se perdió.
    expect(screen.queryByText("8,3%")).toBeNull();

    await usuario.click(
      screen.getByRole("button", {
        name: PRODUCTOS_TEXTOS.abrirDetalle("Crema Especial MLX", "Tienda Uno"),
      }),
    );
    expect(await screen.findByText("8,3%")).toBeInTheDocument();
    // Y el cubo «Otros resultados» con su composición, que la 347 puso y esta ficha no pierde.
    expect(screen.getByText("4 devueltas · 2 reprogramadas")).toBeInTheDocument();
  });

  it("y también en la vista de TELÉFONO, donde las cifras van apiladas", async () => {
    // R46 — un teléfono no puede enseñar menos datos que un portátil. Si el arreglo se hubiera
    // hecho solo en las columnas de escritorio, el móvil seguiría enseñando un desglose que no
    // suma, y es la vista con la que más se mira esta pantalla.
    //
    // `useIsMobile` lee `window.matchMedia`, que el setup deja siempre en `matches: false`. Se
    // fuerza a `true` en vez de mockear el hook: así el caso comprueba de verdad la rama de
    // teléfono del componente y no una constante puesta a mano.
    window.matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    consultarMock.mockResolvedValue({ status: "ok", datos: datos([CREMA]) });
    renderTabla();

    await screen.findByText("Crema Especial MLX");

    // La prueba de que ESTAMOS en la vista de teléfono y no en la de escritorio: dos columnas de
    // datos, producto y la celda que apila las cifras.
    expect(encabezadosDeDatos()).toEqual([
      PRODUCTOS_COLUMNAS.producto,
      PRODUCTOS_COLUMNAS.cifras,
    ]);

    // Cada cifra vive en una línea «etiqueta + valor». Se leen las dos de la pila.
    const linea = (etiqueta: string) => {
      const rotulo = screen.getByText(etiqueta);
      return (rotulo.parentElement?.textContent ?? "").replace(etiqueta, "");
    };

    expect(linea(PRODUCTOS_COLUMNAS.ordenes)).toBe("24");
    expect(linea(PRODUCTOS_COLUMNAS.efectividad)).toBe("12,5%");
    // Y la MISMA frase de desenlaces que en el portátil, entera.
    expect(screen.getByText(textoDesenlacesDeFila(CREMA.porStatus))).toBeInTheDocument();
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
    // `[1]` y no `[0]`: desde la ficha 442 la fila se abre SIEMPRE, así que `DataTable` antepone
    // la celda del control de desglose y el nombre del producto es la segunda.
    expect(filasDom.map((tr) => within(tr).getAllByRole("cell")[1]?.textContent)).toEqual(orden);
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
  it("FICHA 442 — el aviso NO ocupa una línea en gris: se abre con «Cómo se cuenta»", async () => {
    const usuario = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([fila({ producto: "Dr Melaxin" })]) });
    renderTabla();

    await screen.findByText("Dr Melaxin");

    // ⚠ LA MITAD QUE MIDE EL ARREGLO: cerrado, el aviso NO está en el DOM. Antes de la 442 eran
    // SEIS párrafos siempre visibles por encima de la tabla, y empujaban la primera fila fuera
    // de la primera pantalla. No se escondieron con CSS: no se montan.
    expect(screen.queryByText(PRODUCTOS_TEXTOS.aviso)).toBeNull();
    expect(screen.queryByText(PRODUCTOS_TEXTOS.avisoDesglose)).toBeNull();

    // ⚠ Y LA MITAD QUE IMPIDE QUE «ARREGLAR» SEA «BORRAR»: R36 sigue vivo, a un clic.
    await usuario.click(
      screen.getByRole("button", { name: new RegExp(PRODUCTOS_TEXTOS.comoSeCuenta) }),
    );
    expect(await screen.findByText(PRODUCTOS_TEXTOS.aviso)).toBeInTheDocument();
    expect(screen.getByText(PRODUCTOS_TEXTOS.avisoDesglose)).toBeInTheDocument();
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
