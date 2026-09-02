// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import {
  FiltroSeccionesProvider,
  SeccionFiltrable,
} from "@/app/(app)/_components/filtro-secciones";

import {
  construirFiltrosEntregas,
  ATAJOS_CREACION,
  CLAVE_CREACION,
  CLAVE_MENSAJERO,
  CLAVE_TIENDA,
} from "@/app/(app)/_components/entregas-filtros-def";
import { FiltrosEntregas } from "@/app/(app)/_components/FiltrosEntregas";
import {
  FiltroEntregasProvider,
  useFiltroEntregas,
} from "@/app/(app)/_components/filtro-entregas";
import { construirFiltrosOrdenes } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({
    status: "ok" as const,
    catalogo: CATALOGO,
  })),
}));
/*
 * ⚠️ FICHA 351 (2026-09-02) — ESTE SEGUNDO DOBLE ES UNA TRAMPA, NO UNA DEPENDENCIA. LÉELO ANTES
 * DE BORRARLO POR «MUERTO».
 *
 * Hasta esta ficha la barra pedía sus mensajeros a `listarMensajerosParaAsignacion` —la lista de
 * ASIGNACIÓN, que por diseño incluye a los dados de baja— y este doble la servía. Ya no la llama:
 * los mensajeros salen del catálogo. Lo lógico sería retirar el doble, y sería un error medido.
 *
 * SE QUEDA, ENVENENADO. Devuelve a alguien que NO existe en el catálogo (`Zulema Fantasma`), y
 * ningún caso de este archivo la espera nunca. Como `vi.mock` de un módulo que nadie importa es
 * inerte, mientras la barra esté bien esto no hace nada; en cuanto alguien vuelva a enchufar la
 * acción al filtro, Zulema aparece en el desplegable y el caso «ofrece al mensajero que trae el
 * catálogo, y solo a él» se pone rojo.
 *
 * Por qué hace falta y no basta con la guardia de texto de `AsignacionBloqueoPorCierre.test.tsx`:
 * se midió. Con la reversión completa aplicada (import + `useSWR` + sobrescritura del catálogo),
 * SIN esta trampa sólo caía la guardia que lee el archivo fuente, y ningún test de conducta se
 * enteraba — porque en jsdom la acción real falla y la barra caía de vuelta al catálogo, dando
 * por casualidad el resultado correcto. Un agujero de cobertura de libro: verde por accidente.
 */
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(async () => ({
    status: "ok" as const,
    mensajeros: [{ id: "zzz", nombre: "Zulema Fantasma" }],
  })),
}));
const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  // Ficha 351: el mensajero vive DENTRO del catálogo, y con él llegan `zonaId` y `estado`.
  mensajeros: [{ id: "m1", nombre: "Ana", zonaId: "z1", estado: "activo" }],
  zonas: [{ id: "z1", nombre: "Central" }],
  tiendas: [],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1" }],
};

/** Fecha fija: los atajos se resuelven a rangos, y un rango sin reloj fijo no se compara. */
const AHORA = new Date("2026-08-17T12:00:00.000Z");

afterEach(cleanup);

describe("Barra de entregas — los SIETE filtros que la cifra sabe aplicar", () => {
  it("declara fecha, zona, la cadena geográfica, tienda y mensajero, y nada más", () => {
    const defs = construirFiltrosEntregas(CATALOGO, { ahora: AHORA });

    expect(defs.map((f) => f.key)).toEqual([
      CLAVE_CREACION,
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      CLAVE_TIENDA,
      CLAVE_MENSAJERO,
    ]);
    expect(defs.map((f) => f.label)).toEqual([
      "Fecha",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Tienda",
      "Mensajero",
    ]);
  });

  // ⚠ ESTE CASO CAMBIÓ DE SIGNO EL 2026-08-17, y merece decirse: antes afirmaba justo lo
  // contrario —que provincia/cantón/distrito NO se ofrecían—, y estaba bien: la cifra salía
  // de `analytics_daily`, cuyo grano no tiene esas coordenadas, así que ofrecerlas prometía
  // un recorte que la cifra ignoraba en silencio. Lo que cambió no es la opinión sino la
  // FUENTE: el conteo se lee de la tabla `orden`, que sí tiene esas tres columnas. El motivo
  // por el que no estaban desapareció.
  it("ofrece la cadena geográfica, ahora que la fuente sabe recortarla", () => {
    const defs = construirFiltrosEntregas(CATALOGO, { ahora: AHORA });
    const claves = defs.map((f) => f.key);

    expect(claves).toContain("provincia_id");
    expect(claves).toContain("canton_id");
    expect(claves).toContain("distrito_id");
  });

  // La cadena se DECLARA, no se programa: cantón cuelga de provincia y distrito de cantón,
  // igual que en la barra de órdenes. Sin `dependsOn`, el selector de distrito ofrecería los
  // de todo el país aunque el usuario ya hubiera elegido un cantón.
  it("encadena provincia -> cantón -> distrito con `dependsOn` y `parentValue`", () => {
    const defs = construirFiltrosEntregas(CATALOGO, { ahora: AHORA });
    const canton = defs.find((f) => f.key === "canton_id");
    const distrito = defs.find((f) => f.key === "distrito_id");

    expect(canton?.dependsOn).toBe("provincia_id");
    expect(distrito?.dependsOn).toBe("canton_id");
    expect(canton?.options).toEqual([{ value: "c1", label: "Escazú", parentValue: "p1" }]);
    expect(distrito?.options).toEqual([{ value: "d1", label: "San Rafael", parentValue: "c1" }]);
  });

  /**
   * ⚠ ESTE CASO CAMBIÓ DE SIGNO CON LA FICHA 351 (2026-09-02), igual que el de la cadena
   * geográfica de más arriba, y por eso se deja escrito.
   *
   * Decía: «el filtro de mensajero se llena con la lista servida, NO con el catálogo», y era la
   * descripción fiel de lo que pasaba: la barra pedía sus mensajeros a
   * `listarMensajerosParaAsignacion`. Esa lista es la de ASIGNACIÓN y por diseño incluye a los
   * dados de baja —en un modal de asignar hay a quien deshabilitar y un motivo que enseñar—; en
   * un desplegable de filtro eso era, con palabras del humano, «información que no debe
   * mostrarse». La afirmación se invierte: los mensajeros salen del CATÁLOGO, que es la única
   * fuente que ya trae el recorte de estado hecho en el `WHERE`.
   */
  it("ficha 351: el filtro de mensajero se llena con el CATÁLOGO, no con la lista de asignación", () => {
    const defs = construirFiltrosEntregas(CATALOGO, { ahora: AHORA });
    const mensajero = defs.find((f) => f.key === CLAVE_MENSAJERO);

    expect(mensajero?.kind).toBe("multi");
    expect(mensajero?.options).toEqual([{ value: "m1", label: "Ana" }]);
  });

  /**
   * La contraprueba de la de arriba, y la que mata la mutación de verdad: con el catálogo VACÍO
   * de mensajeros, el desplegable se queda sin opciones. Si alguien devolviera la barra a una
   * segunda fuente, este caso seguiría encontrando opciones que el catálogo no tiene.
   */
  it("con el catálogo sin mensajeros, el desplegable no ofrece ninguno", () => {
    const defs = construirFiltrosEntregas(
      { ...CATALOGO, mensajeros: [] },
      { ahora: AHORA },
    );
    const mensajero = defs.find((f) => f.key === CLAVE_MENSAJERO);

    // El control SIGUE declarado (R64: un filtro sin opciones no desaparece, se queda vacío);
    // lo que no hay es a quién ofrecer.
    expect(mensajero).toBeDefined();
    expect(mensajero?.options).toEqual([]);
  });
});

// El pedido fue "los mismos rangos que en órdenes". Comparar los rangos RESUELTOS —y no
// solo los `value` de los atajos— es lo que mata la mutación que de verdad importa:
// cambiar aquí un `dias` dejaría los mismos cuatro nombres ofreciendo otras fechas.
describe("Barra de entregas — la fecha usa los MISMOS rangos que órdenes", () => {
  it("el filtro de fecha ofrece atajo por atajo el mismo rango que la barra de órdenes", () => {
    const entregas = construirFiltrosEntregas(CATALOGO, { ahora: AHORA });
    const ordenes = construirFiltrosOrdenes(CATALOGO, {
      incluirTienda: false,
      ahora: AHORA,
    });

    const fechaEntregas = entregas.find((f) => f.key === CLAVE_CREACION);
    const fechaOrdenes = ordenes.find((f) => f.key === CLAVE_CREACION);

    expect(fechaEntregas?.kind).toBe("dateRange");
    expect(fechaEntregas?.options).toEqual(fechaOrdenes?.options);
    // Anti-vacío: si los atajos desaparecieran de los dos lados, el `toEqual` de arriba
    // seguiría pasando comparando dos listas vacías.
    expect(fechaEntregas?.options).toHaveLength(ATAJOS_CREACION.length);
    expect(ATAJOS_CREACION.length).toBeGreaterThan(0);
  });
});

describe("Barra de entregas — se monta como la de órdenes", () => {
  it("nace con el buscador y el selector de filtros, sin ningún control puesto", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltrosEntregas />
      </SWRConfig>,
    );

    expect(
      screen.getByRole("searchbox", { name: "Buscar sección" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /filtros/i })).toBeInTheDocument();
    // Ningún filtro puesto: el selector no anuncia cuenta y no hay combos montados.
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

/* ========================================================================== */
/* El campo filtra las SECCIONES de la página                                 */
/* ========================================================================== */

/** La página mínima: la barra y dos secciones con nombre. */
function PaginaDePrueba() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltroSeccionesProvider>
        <FiltrosEntregas />
        <SeccionFiltrable titulo="Entregas">
          <p>contenido de entregas</p>
        </SeccionFiltrable>
        <SeccionFiltrable titulo="Indicadores operativos">
          <p>contenido operativo</p>
        </SeccionFiltrable>
      </FiltroSeccionesProvider>
    </SWRConfig>
  );
}

/** Teclea en el campo y deja pasar el debounce de la barra. */
async function teclear(texto: string) {
  const campo = screen.getByRole("searchbox", { name: "Buscar sección" });
  fireEvent.change(campo, { target: { value: texto } });
  await screen.findByRole("searchbox", { name: "Buscar sección" });
}

describe("El campo filtra las secciones por su nombre", () => {
  it("sin nada escrito están TODAS: el filtro no se nota hasta que se usa", () => {
    render(<PaginaDePrueba />);

    expect(screen.getByText("contenido de entregas")).toBeInTheDocument();
    expect(screen.getByText("contenido operativo")).toBeInTheDocument();
  });

  it("escribir «Entregas» deja esa sección y RETIRA las demás", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("Entregas");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.getByText("contenido de entregas")).toBeInTheDocument();
    // Se DESMONTA, no se esconde con CSS: una sección oculta que sigue en el árbol
    // seguiría leyéndose en un lector de pantalla y tabulándose.
    expect(screen.queryByText("contenido operativo")).toBeNull();
    vi.useRealTimers();
  });

  // Sin normalizar, «operativos» no encontraría «Indicadores operativos» (no es prefijo) y
  // «analitica» no encontraría nada con tilde. Las dos son la forma real de teclear.
  it("busca por subcadena y sin exigir acentos ni mayúsculas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("OPERATIVOS");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.getByText("contenido operativo")).toBeInTheDocument();
    expect(screen.queryByText("contenido de entregas")).toBeNull();
    vi.useRealTimers();
  });

  it("cuando no coincide ninguna, lo DICE en vez de dejar la página en blanco", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PaginaDePrueba />);
    await teclear("zzz");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.queryByText("contenido de entregas")).toBeNull();
    expect(screen.queryByText("contenido operativo")).toBeNull();
    expect(screen.getByText(/ninguna sección coincide/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

// Una sección montada FUERA del proveedor no puede quedar escondida para siempre: no hay
// campo que la devuelva. El default del contexto es «no hay filtro» justo por esto.
describe("Sin proveedor, una sección filtrable se pinta siempre", () => {
  it("se renderiza tal cual, sin contexto que la esconda", () => {
    render(
      <SeccionFiltrable titulo="Entregas">
        <p>contenido suelto</p>
      </SeccionFiltrable>,
    );

    expect(screen.getByText("contenido suelto")).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* Poner y QUITAR filtros desde el selector                                   */
/* ========================================================================== */

// Bug reportado el 2026-08-18: al desmarcar un filtro en el selector, su valor seguía
// recortando la cifra y «Limpiar todo» se quedaba visible sin nada que limpiar.
//
// La causa está escrita entera en `alCambiarActivos` (`FiltrosEntregas.tsx`): `FilterComponent`
// poda su propia selección cuando una clave deja de estar declarada, pero esa poda vive en un
// efecto SUYO y la barra lo desmonta en cuanto no queda ningún filtro puesto. Al desmarcar el
// último, el efecto no llega a correr. Estos casos son los que impiden que vuelva.

/** La barra, el proveedor y un espía que enseña el filtro publicado. */
function BarraConEspia() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <FiltroEntregasProvider>
        <FiltrosEntregas />
        <EspiaDeFiltro />
      </FiltroEntregasProvider>
    </SWRConfig>
  );
}

function EspiaDeFiltro() {
  const { filtro } = useFiltroEntregas();
  return <output data-testid="filtro-publicado">{JSON.stringify(filtro)}</output>;
}

function filtroPublicado(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("filtro-publicado").textContent ?? "{}");
}

/**
 * Marca o desmarca un filtro en el selector «Filtros» y CIERRA el desplegable.
 *
 * El cierre no es cosmético: el panel vive en un portal con guardas de foco, así que
 * dejarlo abierto tapa los controles que este mismo test tiene que pulsar después.
 */
async function alternarEnSelector(nombre: string) {
  fireEvent.click(screen.getByRole("button", { name: /filtros/i }));
  const opcion = await screen.findByRole("option", { name: new RegExp(nombre, "i") });
  fireEvent.click(opcion);
  fireEvent.keyDown(opcion, { key: "Escape" });
}

describe("Quitar un filtro del selector lo quita también de la cifra", () => {
  it("el filtro publicado arranca VACÍO: nada preestablecido", () => {
    render(<BarraConEspia />);
    expect(filtroPublicado()).toEqual({});
  });

  it("desmarcar el ÚNICO filtro puesto borra su valor del filtro publicado", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<BarraConEspia />);

    await alternarEnSelector("Zona");
    // Elegir una zona: sin valor elegido el bug no se ve, porque no hay nada que quedarse
    // pegado.
    fireEvent.click(await screen.findByRole("button", { name: /^Zona:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Central" }));
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });
    expect(filtroPublicado()).toMatchObject({ zona_id: ["z1"] });

    // Y ahora se retira del selector. Este es el momento en que `FilterComponent` se
    // DESMONTA (era el único puesto) y su poda interna no llega a correr.
    await alternarEnSelector("Zona");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(filtroPublicado()).toEqual({});
    vi.useRealTimers();
  });

  it("quitar uno de DOS deja el otro intacto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<BarraConEspia />);

    await alternarEnSelector("Zona");
    fireEvent.click(await screen.findByRole("button", { name: /^Zona:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Central" }));
    await alternarEnSelector("Provincia");
    fireEvent.click(await screen.findByRole("button", { name: /^Provincia:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "San José" }));
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });
    expect(filtroPublicado()).toMatchObject({ zona_id: ["z1"], provincia_id: ["p1"] });

    await alternarEnSelector("Zona");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    // La mutación que este caso mata: podar de más (vaciar la selección entera al retirar
    // uno). Quitar un filtro no puede llevarse por delante los demás.
    expect(filtroPublicado()).toEqual({ provincia_id: ["p1"] });
    vi.useRealTimers();
  });
});

describe("«Limpiar todo» solo está cuando hay algo que limpiar", () => {
  it("no aparece con la barra recién abierta", () => {
    render(<BarraConEspia />);
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
  });

  it("aparece al poner un filtro y DESAPARECE al quitarlo", async () => {
    render(<BarraConEspia />);

    await alternarEnSelector("Zona");
    expect(screen.getByRole("button", { name: "Limpiar todo" })).toBeInTheDocument();

    await alternarEnSelector("Zona");

    // El síntoma reportado: el botón se quedaba porque `seleccion` conservaba la clave
    // huérfana de un control ya retirado.
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
  });

  it("sigue desapareciendo aunque el filtro llegara a tener un valor elegido", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<BarraConEspia />);

    await alternarEnSelector("Zona");
    fireEvent.click(await screen.findByRole("button", { name: /^Zona:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Central" }));
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    await alternarEnSelector("Zona");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
    vi.useRealTimers();
  });
});

/* ========================================================================== */
/* FICHA 351 — el desplegable de mensajero, montado de verdad                 */
/* ========================================================================== */

/**
 * Los dos casos de arriba miran la función pura. Éste monta la barra ENTERA y recorre el camino
 * completo —SWR → `catalogoFetcher` → `obtenerCatalogoFiltrosOrdenes` → `construirFiltrosEntregas`
 * → opciones en pantalla—, que es donde de verdad entraba la segunda fuente: hasta la ficha 351
 * había un `useSWR("entregas:mensajeros")` que traía la lista de asignación y ganaba a la del
 * catálogo sin que ninguna aserción sobre la función pura se enterara.
 */
describe("Ficha 351 — el desplegable de mensajero se puebla desde el catálogo", () => {
  it("ofrece al mensajero que trae el catálogo, y solo a él", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltrosEntregas />
      </SWRConfig>,
    );

    await alternarEnSelector("Mensajero");
    fireEvent.click(await screen.findByRole("button", { name: /^Mensajero:/ }));

    // «Ana» es quien está en `CATALOGO.mensajeros`. Que aparezca prueba que la lista viajó desde
    // el catálogo hasta la pantalla; no hay ninguna otra fuente que pudiera haberla puesto ahí.
    expect(await screen.findByRole("option", { name: "Ana" })).toBeInTheDocument();
    // Y no hay NADIE MÁS. Se afirma sobre la lista ENTERA —no solo «Ana está»— porque una segunda
    // fuente añadiría opciones sin quitar ésta. «Todos» es el control de marcar/desmarcar que
    // `FilterComponent` pone en todo filtro `multi`, no un mensajero.
    const listbox = screen.getByRole("listbox", { name: "Mensajero" });
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
      "Ana",
    ]);
  });
});

/* ========================================================================== */
/* FICHA 351 — la etiqueta de tienda, sin el sufijo «(inactiva)»              */
/* ========================================================================== */

/**
 * La barra de entregas componía la MISMA etiqueta que la de órdenes, importando su
 * `SUFIJO_INACTIVA`: `t.activa ? t.nombre : nombre + " (inactiva)"` (decisión (e) de la 144,
 * R51). Esa decisión está revertida desde el 2026-09-02 y la constante ya no existe.
 *
 * Este caso está aquí —y no solo en `ordenes-filtros-def.test.ts`— porque eran DOS sitios
 * componiendo el sufijo, y limpiar uno y olvidar el otro es exactamente el fallo que nadie mira:
 * las dos barras se ven en pantallas distintas.
 */
describe("Ficha 351 — la opción de tienda no lleva sufijo", () => {
  it("etiqueta el nombre a secas aunque el DTO diga `activa: false`", () => {
    const defs = construirFiltrosEntregas(
      {
        ...CATALOGO,
        tiendas: [
          { id: "t1", nombre: "Tienda Viva", esApiKey: false, activa: true },
          // Cuenta dada de baja: hoy el servidor no la entrega, pero el DTO todavía puede
          // expresarla. Si alguien vuelve a leer la bandera, este caso lo caza.
          { id: "t2", nombre: "Tienda Cerrada", esApiKey: false, activa: false },
        ],
      },
      { ahora: AHORA },
    );
    const tienda = defs.find((f) => f.key === CLAVE_TIENDA);

    expect((tienda?.options ?? []).map((o) => o.label)).toEqual([
      "Tienda Viva",
      "Tienda Cerrada",
    ]);
    for (const opcion of tienda?.options ?? []) {
      expect(opcion.label).not.toMatch(/\(inactiva\)/);
    }
  });
});
