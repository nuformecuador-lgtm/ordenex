// @vitest-environment jsdom
// Feature 170 (T A.2) — descarga del listado de la bodega satélite. Cubre R1, R10, R14 y R20.
//
// Era la primera tabla de FAMILIA B del rollout: el dataset entero llegaba por props y el
// archivo se proyectaba del array que la tabla pintaba, sin releer nada.
//
// Feature 170 — FASE 2 (T K.3): esa pantalla PAGINA, así que «lo que la tabla pinta» es una
// página y proyectarla degradaría la descarga a «descargá lo que se ve» (R52). El módulo
// relee el conjunto completo al pulsar y le aplica los filtros vigentes; lo que este archivo
// sigue fijando es lo de siempre —qué columnas salen, con qué valores crudos y respetando
// los tres filtros—, ahora sobre el CONJUNTO. La no-degradación a la página la mide
// `tests/components/paginacion/SatelitePaginacion.test.tsx`.
//
// Feature 184 — Tanda A (T A.4, R1/R2/R3/R7/R8/R11): ese «relee el conjunto y le aplica los
// filtros vigentes» era el último criterio de filtrado DUPLICADO del repo —uno en SQL y otro
// en el navegador— y además bajaba al cliente las filas que los filtros descartaban. El
// conjunto pasa a pedirse a una lectura DEDICADA que ya lo devuelve filtrado
// (`listarOrdenesBodegaCompleto`). Lo que este archivo gana son los casos que distinguen las
// dos cosas, que el xlsx por sí solo NO distingue: los argumentos de la lectura (R3), que la
// pantalla no vuelva a filtrar lo que le llega (R2) y que el listado compuesto ya no se lea.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

// El control de descarga NO pinta el fallo en la tabla: lo dice por toast (`DescargarDatasetButton`
// :96). Para poder afirmar QUÉ dice —y qué no dice— el doble del toast tiene que ser inspeccionable.
const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// La cámara nunca se abre en estos tests; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

// Feature 170 — FASE 2 (T K.3) · Feature 184 — Tanda A (T A.4): las TRES lecturas del dominio
// que esta pantalla puede hacer, cada una con su doble, porque lo que se mide es CUÁL usa el
// archivo:
//
//   - `paginado`  → lo que la tabla pinta (una página, ya filtrada por el servidor);
//   - `completo`  → la lectura DEDICADA a este listado, de donde sale el archivo desde T A.4;
//   - `compuesto` → `listarRecepcionSatelite()`, el listado que además resuelve «Por recibir»,
//     el nombre de zona y `sinZona`. Era de donde salía el archivo hasta T A.4 y sigue
//     declarado A PROPÓSITO: que ya NO se llame al descargar es la mitad de lo que R1 pide, y
//     sin el doble no habría forma de afirmarlo (el módulo simplemente no lo importaría).
const { paginadoMock, completoMock, compuestoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  completoMock: vi.fn(),
  compuestoMock: vi.fn(),
}));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  recibirLote: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarRecepcionSatelite: (...a: unknown[]) => compuestoMock(...a),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoMock(...a),
  listarOrdenesBodegaCompleto: (...a: unknown[]) => completoMock(...a),
  // La poda no participa en ninguna descarga (R28) y este archivo no marca nada: cero llamadas.
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({ enviarACentral: vi.fn() }));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";

const ZONA_ACTOR = "Limón";

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_bodega_satelite",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA_ACTOR,
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    intentosEntrega: 0,
    ...over,
  };
}

/**
 * El CONJUNTO del actor: SOLO órdenes de su zona (el service las acota con
 * `findRecepcionSateliteByZona`), en dos cantones y dos estados. En el orden del flujo de la
 * bodega, que es el que impone el `ORDER BY` del listado (R51): primero las recibidas, luego
 * las que están por devolver.
 */
const ORDENES: RecepcionSateliteDTO[] = [
  makeOrden({ id: "o1", numRemision: "REM-001", cantonNombre: "Central", distritoNombre: "Limón" }),
  makeOrden({
    id: "o2",
    numRemision: "REM-002",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
  }),
  makeOrden({
    id: "o3",
    numRemision: "REM-003",
    estatusValue: "por_devolver",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
    numGuia: null,
    direccion: null,
    montoCobrar: null,
    intentosEntrega: 2,
  }),
];

/**
 * El filtro que resuelve el SERVIDOR (T K.1), reimplementado aquí a propósito: comparación
 * por igualdad EXACTA del nombre, como el SQL, para que el doble no sea el mismo código que
 * se está midiendo.
 */
function filtrarComoElServidor(
  ordenes: RecepcionSateliteDTO[],
  input: { estados?: string[]; canton_id?: string[]; distrito_id?: string[] } = {},
): RecepcionSateliteDTO[] {
  return ordenes.filter((orden) => {
    if (input.estados?.length && !input.estados.includes(orden.estatusValue)) return false;
    // Pedido humano (2026-08-19): la geografia viaja por ID; en este andamiaje el id de un
    // canton es su nombre (ver `catalogoSatelite`).
    if (input.canton_id?.length && !input.canton_id.includes(orden.cantonNombre)) return false;
    if (input.distrito_id?.length) {
      if (orden.distritoNombre === null) return false;
      if (!input.distrito_id.includes(orden.distritoNombre)) return false;
    }
    return true;
  });
}

function renderModulo(ordenes: RecepcionSateliteDTO[] = ORDENES) {
  paginadoMock.mockImplementation(async (input = {}) => {
    const filtradas = filtrarComoElServidor(ordenes, input);
    return {
      status: "ok",
      items: filtradas,
      page: 1,
      pageSize: PAGE_SIZE_SATELITE,
      total: filtradas.length,
    };
  });
  // T A.4: el conjunto del archivo lo devuelve el SERVIDOR ya filtrado, con la misma forma
  // (`ListarCompletoResult`) que `filasDesdeResultado` sabe traducir. El doble aplica el mismo
  // criterio que el de la página —no el de la pantalla, que ya no existe—: si el archivo
  // trajera filas que este doble descartó, es que alguien las filtró en otra parte.
  completoMock.mockImplementation(async (input = {}) => {
    const filtradas = filtrarComoElServidor(ordenes, input);
    return { status: "ok", items: filtradas, total: filtradas.length };
  });
  // El listado COMPUESTO sigue respondiendo: que el archivo no lo use tiene que ser una
  // decisión de la pantalla, no una consecuencia de que el doble no devuelva nada.
  compuestoMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: ordenes.filter((o) => o.estatusValue === "en_bodega_satelite"),
    asignadas: [],
    porDevolver: ordenes.filter((o) => o.estatusValue === "por_devolver"),
    enTransitoACentral: [],
    devueltas: [],
    zonaNombre: ZONA_ACTOR,
    sinZona: false,
  });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={[]}
        ordenesBodega={paginaBodega(ordenes)}
        catalogoFiltros={catalogoSatelite(ordenes)}
        zonaNombre={ZONA_ACTOR}
        sinZona={false}
        mensajeros={[]}
        bloqueoBodega={{
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
        }}
      />
    </SWRConfig>,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: "Descargar Órdenes de la bodega" });
}

/**
 * Elige una opción del filtro multi de la barra (estado / cantón / distrito). Mismo
 * recorrido que `tests/unit/components/filter-component.test.tsx`: el panel no se cierra
 * al marcar, así que se reusa el `listbox` si ya está abierto.
 */
/**
 * PIDE un filtro en el selector de la barra. Pedido humano (2026-08-19): esta pantalla monta
 * `BuscadorFiltros`, la barra de `/ordenes`, y ahi los filtros NO estan puestos de entrada.
 */
async function pedirFiltro(user: ReturnType<typeof userEvent.setup>, label: string) {
  if (screen.queryByRole("listbox", { name: "Filtros" }) === null) {
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
  }
  const puesto = within(await screen.findByRole("listbox", { name: "Filtros" })).getByRole(
    "option",
    { name: label },
  );
  if (puesto.getAttribute("aria-selected") !== "true") await user.click(puesto);
}

async function filtrarPor(
  user: ReturnType<typeof userEvent.setup>,
  filtro: string,
  opcion: string,
) {
  await pedirFiltro(user, filtro);
  const abierto = screen.queryByRole("listbox", { name: filtro });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
      return screen.getByRole("listbox", { name: filtro });
    })());
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Órdenes de la bodega satélite · descarga", () => {
  it("ofrece la descarga de las órdenes de la bodega", async () => {
    const user = userEvent.setup();
    renderModulo();

    // R1: control presente, con nombre accesible que identifica el listado.
    expect(botonDescarga()).toBeInTheDocument();
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^ordenes-de-la-bodega-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Una fila por orden del CONJUNTO, en el orden del flujo de la bodega (R51).
    const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.numRemision)).toEqual(["REM-001", "REM-002", "REM-003"]);
    expect(columnas.map((c) => c.header)).toContain("Nº Remisión");
    expect(titulo).toBe("Órdenes de la bodega");
    // Valores CRUDOS: sin "—" ni "Pendiente" de presentación (R7).
    expect(filas[2].numGuia).toBeNull();
    expect(filas[2].direccion).toBeNull();
    expect(filas[2].intentos).toBe(2);
    // Y nada que la tabla no muestre: el teléfono del destinatario no es columna (R24).
    expect(Object.values(filas[0])).not.toContain("88880000");
  });

  it("respeta los filtros de estado, cantón y distrito aplicados", async () => {
    const user = userEvent.setup();
    renderModulo();

    // Se filtra por cantón: la tabla se queda con dos filas…
    // La etiqueta del cantón desambigua con la provincia (feature 117).
    await filtrarPor(user, "Cantón", "Pococí");
    const tabla = screen.getByRole("table", { name: "Órdenes de la bodega" });
    // El conteo NO basta como ancla: durante la carga el `DataTable` pinta un `<tr>` con
    // `role="status"` («Cargando») y filas skeleton `aria-hidden` que no cuentan como `row`,
    // así que hay instantes en los que el número cuadra con la tabla a medio cargar. Se exige
    // además que no quede carga en vuelo.
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(2 + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    // R10: …y el archivo trae EXACTAMENTE esas dos, no las tres del conjunto.
    const [, filasCanton] = buildXlsxRowsMock.mock.calls[0];
    expect(filasCanton.map((f) => f.numRemision)).toEqual(["REM-002", "REM-003"]);

    // Se añade el filtro de estado (AND con el de cantón): queda una sola.
    await filtrarPor(user, "Estado", "Recibidas");
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(2));
    const [, filasEstado] = buildXlsxRowsMock.mock.calls[1];
    expect(filasEstado.map((f) => f.numRemision)).toEqual(["REM-002"]);
  });

  it("el archivo sale de la lectura DEDICADA al listado, no del listado compuesto ni de otra página (R1)", async () => {
    // Feature 184 — Tanda A (T A.4, R1/R8). Tres cosas a la vez, y las tres son la misma
    // exigencia vista por sus tres lados:
    //
    //   (a) montar la pantalla NO ejecuta la lectura del conjunto (R8): el conjunto se lee
    //       cuando el usuario pulsa, y ni una vez antes;
    //   (b) al pulsar se llama a `listarOrdenesBodegaCompleto` —la lectura dedicada— UNA vez;
    //   (c) y NO se relee `listarRecepcionSatelite`, que es un listado compuesto: devuelve
    //       además «Por recibir», el nombre de zona y `sinZona`, o sea datos de otras
    //       secciones de la pantalla que el archivo no necesita. Ésa es la deuda que la tanda
    //       A cierra, y este mock existe para que su ausencia sea afirmable.
    //
    // Y sigue sin pedir páginas: descargar por partes lo que se decidió entregar entero es la
    // otra forma de degradar el archivo.
    const user = userEvent.setup();
    renderModulo();

    await waitFor(() => expect(paginadoMock).toHaveBeenCalled());
    const paginasAntes = paginadoMock.mock.calls.length;
    expect(completoMock).not.toHaveBeenCalled();
    expect(compuestoMock).not.toHaveBeenCalled();

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    expect(completoMock).toHaveBeenCalledTimes(1);
    expect(compuestoMock).not.toHaveBeenCalled();
    expect(paginadoMock.mock.calls.length).toBe(paginasAntes);
  });

  it("descargar con filtros aplicados pide el conjunto con ESOS filtros (R3)", async () => {
    // R3 + R2: los filtros vigentes viajan al servidor, y viajan SOLOS. Que el archivo salga
    // bien no basta: la pantalla podría pedir el conjunto SIN filtros y recortarlo aquí —que
    // es exactamente lo que hacía hasta T A.4— y el xlsx saldría idéntico. Lo que distingue
    // una cosa de la otra son los ARGUMENTOS de la lectura.
    const user = userEvent.setup();
    renderModulo();

    await filtrarPor(user, "Cantón", "Pococí");
    const tabla = screen.getByRole("table", { name: "Órdenes de la bodega" });
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(2 + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });
    await filtrarPor(user, "Estado", "Recibidas");
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [entrada] = completoMock.mock.calls[0] as [Record<string, unknown>];
    expect(entrada).toEqual({
      estados: ["en_bodega_satelite"],
      canton_id: ["Pococí"],
    });
    // Y el recorte de página NO contamina la lectura del conjunto: pedir `page`/`pageSize`
    // aquí sería descargar una página con otro nombre (y el borde lo rechazaría, R17).
    expect(entrada).not.toHaveProperty("page");
    expect(entrada).not.toHaveProperty("pageSize");
  });

  it("la pantalla NO vuelve a filtrar ni a ordenar lo que devolvió el servidor (R2)", async () => {
    // El caso que discrimina «el servidor filtra» de «el servidor filtra Y la pantalla
    // también». Con el filtro de cantón puesto, el doble devuelve A PROPÓSITO una fila que ese
    // filtro excluye, y en un orden que cualquier orden de cliente cambiaría (REM-003 antes
    // que REM-002). El archivo tiene que traer las dos, en ESE orden: si la pantalla
    // conservara su filtro de memoria, la de Central desaparecería sin que nada fallara.
    const user = userEvent.setup();
    renderModulo();

    await filtrarPor(user, "Cantón", "Pococí");
    const tabla = screen.getByRole("table", { name: "Órdenes de la bodega" });
    await waitFor(() => {
      expect(within(tabla).getAllByRole("row")).toHaveLength(2 + 1);
      expect(within(tabla).queryByRole("status")).not.toBeInTheDocument();
    });

    const deOtroCanton = ORDENES.find((o) => o.numRemision === "REM-001")!;
    const dePococi = ORDENES.find((o) => o.numRemision === "REM-003")!;
    completoMock.mockResolvedValueOnce({
      status: "ok",
      items: [dePococi, deOtroCanton],
      total: 2,
    });

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.numRemision)).toEqual(["REM-003", "REM-001"]);
  });

  it("un fallo de la lectura no produce archivo y el mensaje no lleva datos personales (R7)", async () => {
    const user = userEvent.setup();
    renderModulo();
    completoMock.mockResolvedValueOnce({ status: "forbidden" });

    await user.click(botonDescarga());
    // Ancla POSITIVA: se espera a que el aviso SALGA, no a que el archivo no salga (una
    // ausencia se cumple también antes de que la descarga empiece, y ese ancla no anclaría
    // nada).
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));

    const [mensaje] = errorToastMock.mock.calls[0] as [string];
    expect(mensaje).toMatch(/Vuelve a intentarlo/);
    // Accionable, y sin una sola fila del dominio: ni destinatarios, ni teléfonos, ni guías.
    for (const dato of ["Ana Pérez", "88880000", "REM-001", "Calle 1, casa 2"]) {
      expect(mensaje).not.toContain(dato);
    }
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  it("solo contiene órdenes de la zona del actor", async () => {
    const user = userEvent.setup();
    // El servicio ya acotó por zona (R14/R20): la pantalla NUNCA recibe una orden ajena.
    // Lo que este test fija es que la descarga no amplía ese alcance por su cuenta: el
    // archivo es exactamente el conjunto que devuelve el listado, fila a fila.
    renderModulo();

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(ORDENES.length);
    for (const fila of filas) {
      expect(fila.zona).toBe(ZONA_ACTOR);
    }
    expect(new Set(filas.map((f) => f.numRemision))).toEqual(
      new Set(ORDENES.map((o) => o.numRemision)),
    );
  });
});
