// @vitest-environment jsdom
//
// FICHA 388 — la descarga de la tabla de productos de `/analitica` deja ELEGIR sus columnas.
//
// El control ya era el común (`DescargarDatasetButton`, montado por la prop `descarga` del
// `DataTable`): lo que le faltaba era el ÁMBITO, que es el parámetro con el que ese control
// enciende el selector. Sin él la clave de preferencia es `null` y el hook «no lee, no escribe y
// devuelve las columnas declaradas tal cual» (R33 de la 314).
//
// ── LO QUE DE VERDAD PODÍA MORDER AQUÍ, Y POR QUÉ TIENE CASO PROPIO ────────────────────────
// Esta tabla es la primera con ámbito cuyo juego de columnas es CONDICIONAL: son once sin la
// concesión de dinero y veinte con ella (`descargaAnaliticaProductos(conDinero)`). Y `conDinero`
// no es solo «tiene el permiso»: también es `false` cuando la respuesta llega con
// `limite_excedido` (R76 de la 347), que es un estado TRANSITORIO del servidor. O sea que el
// MISMO actor, en la MISMA pantalla, salta de un juego al otro entre dos consultas.
//
// Con UN solo ámbito para los dos juegos el daño sería mudo: `usePreferenciaColumnas` sanea lo
// guardado contra las columnas PUBLICADAS (R29 de la 314), así que el primer clic del selector
// estando sin dinero reescribiría la preferencia sin las claves de dinero y las nueve columnas
// REAPARECERÍAN al volver la concesión, sin ningún error y sin que nadie las marcara.
//
// Por eso son DOS ámbitos, uno por juego —la misma decisión que la descarga de cierres tomó por
// nivel de detalle— y por eso los dos casos centrales de este archivo son:
//   · ocultar sin dinero NO toca lo guardado con dinero (ni al revés);
//   · una preferencia que nombre columnas de dinero NO puede colarlas en el archivo de quien no
//     tiene la concesión, ni impedir que ese archivo se genere.
//
// Se monta el consumidor REAL y solo se aísla el codificador binario, así que el recorrido
// `preferencia -> DescargarDatasetButton -> construirDescarga -> buildXlsxRows` es el de
// producción. Ningún caso afirma un NÚMERO de columnas: «todas» se deriva de las constantes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { FiltroEntregasProvider } from "@/app/(app)/_components/filtro-entregas";
import {
  ProductosTabla,
  PRODUCTOS_TEXTOS,
} from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import {
  AMBITO_DESCARGA_ANALITICA_PRODUCTOS,
  AMBITO_DESCARGA_ANALITICA_PRODUCTOS_DINERO,
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS,
  COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO,
} from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import type {
  ConteoProductosDTO,
  DineroProductoDTO,
  FilaProductoDTO,
} from "@/lib/types/conteo-productos";

vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));
const consultarMock = vi.mocked(consultarConteoProductos);

// El detalle por fila no se abre en este archivo, pero su acción es un módulo de servidor: se
// aísla igual que en `ProductosTablaDinero.test.tsx`.
vi.mock("@/lib/actions/detalle-dinero-producto", () => ({
  consultarDetalleDineroProducto: vi.fn(),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Solo el codificador binario se aísla: `construirDescarga` corre REAL, así que las columnas que
// se afirman son las que de verdad llegan al archivo.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

/** Cifras ya cuadradas: `6215 + 28785 = 35000` y `35000 + 10000 = 45000`. */
const DINERO: DineroProductoDTO = {
  recaudado: "45000.00",
  liquidado: { recaudado: "35000.00", ordenex: "6215.00", tienda: "28785.00", ordenes: 4 },
  pendiente: { recaudado: "10000.00", ordenes: 1 },
  retorno: "2260.00",
};

const FILAS: FilaProductoDTO[] = [
  {
    tiendaId: "3f2a1c88-9b40-4d21-8e77-1c0b5a6d2e91",
    tienda: "Tienda Uno",
    producto: "Spray Protector",
    unidades: 19,
    ordenes: 16,
    porStatus: [
      { status: "entregada", conteo: 8 },
      { status: "rechazada", conteo: 6 },
      { status: EN_CURSO, conteo: 2 },
    ],
    ordenesAcompanadas: 2,
    dinero: DINERO,
  },
];

function dto(concedido: boolean): ConteoProductosDTO {
  return {
    filas: FILAS,
    ordenes: 45,
    ordenesSinProducto: 3,
    dinero: concedido ? { estado: "concedido" } : { estado: "denegado" },
    lastSync: "2026-09-01T18:30:00.000Z",
  };
}

/** Las claves de `localStorage` de los dos ámbitos, tal y como las arma el control común. */
const CLAVE_SIN_DINERO = `ordenex:descarga-columnas:${AMBITO_DESCARGA_ANALITICA_PRODUCTOS}`;
const CLAVE_CON_DINERO = `ordenex:descarga-columnas:${AMBITO_DESCARGA_ANALITICA_PRODUCTOS_DINERO}`;

/** Todos los encabezados de cada juego, DERIVADOS. Nunca una lista escrita a mano. */
const ENCABEZADOS_BASE = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.encabezado);
const ENCABEZADOS_DINERO = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.map(
  (c) => c.encabezado,
);

/** Una columna base cualquiera que se ocultará, y otra que debe seguir saliendo. */
const BASE_OCULTA = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS[2]!;
const BASE_PRESENTE = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS[0]!;
/** La columna de dinero sobre la que se prueba que la preferencia sobrevive. */
const RECAUDADO = COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO.find(
  (c) => c.clave === "recaudado",
)!;

function montar(dinero: boolean) {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltroEntregasProvider>
          <ProductosTabla dinero={dinero} />
        </FiltroEntregasProvider>
      </SWRConfig>
    </ToastProvider>,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: `Descargar ${PRODUCTOS_TEXTOS.descarga}` });
}

function disparadorSelector() {
  return screen.getAllByRole("button", { name: "Elegir columnas de la descarga" });
}

async function abrirSelector(user: ReturnType<typeof userEvent.setup>) {
  await user.click(disparadorSelector()[0]!);
  await screen.findAllByText("Columnas del archivo");
}

function casilla(encabezado: string) {
  return screen.getByRole("checkbox", { name: encabezado });
}

/** Encabezados que recibió el generador en su ÚLTIMA llamada, en su orden. */
function encabezadosDelArchivo(): string[] {
  const llamada = buildXlsxRowsMock.mock.calls.at(-1);
  expect(llamada).toBeDefined();
  return llamada![0].map((columna) => columna.header);
}

/** Lo guardado bajo una clave, ya parseado. `null` si no hay nada escrito. */
function preferenciaGuardada(clave: string): { ocultas?: string[]; orden?: string[] } | null {
  const crudo = window.localStorage.getItem(clave);
  return crudo === null ? null : JSON.parse(crudo);
}

async function descargar(user: ReturnType<typeof userEvent.setup>, llamadas: number) {
  await user.click(botonDescarga());
  await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(llamadas));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
  consultarMock.mockResolvedValue({ status: "ok", datos: dto(true) });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("FICHA 388 · la descarga de productos deja elegir columnas", () => {
  it("ofrece el selector junto al botón, y abrirlo no descarga nada", async () => {
    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(false) });
    montar(false);
    await screen.findByText("Spray Protector");

    expect(botonDescarga()).toBeInTheDocument();
    expect(disparadorSelector()).toHaveLength(1);
    // Cerrado no muestra nada: es un control PARALELO, no un paso del camino de descarga.
    expect(screen.queryByRole("checkbox")).toBeNull();

    await abrirSelector(user);
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("sin la concesión presenta una casilla por columna base, todas marcadas", async () => {
    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(false) });
    montar(false);
    await screen.findByText("Spray Protector");
    await abrirSelector(user);

    for (const encabezado of ENCABEZADOS_BASE) {
      expect(casilla(encabezado)).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(ENCABEZADOS_BASE.length);
    // Y ninguna de dinero: el selector no puede ofrecer lo que el archivo no publica.
    expect(screen.queryByRole("checkbox", { name: RECAUDADO.encabezado })).toBeNull();
  });

  it("con la concesión presenta también las nueve de dinero", async () => {
    const user = userEvent.setup();
    montar(true);
    await screen.findByText("Spray Protector");
    await abrirSelector(user);

    for (const encabezado of ENCABEZADOS_DINERO) {
      expect(casilla(encabezado)).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(ENCABEZADOS_DINERO.length);
  });

  it("una columna desmarcada deja de viajar en el archivo", async () => {
    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(false) });
    montar(false);
    await screen.findByText("Spray Protector");
    await abrirSelector(user);

    await user.click(casilla(BASE_OCULTA.encabezado));
    await waitFor(() =>
      expect(preferenciaGuardada(CLAVE_SIN_DINERO)?.ocultas).toEqual([BASE_OCULTA.clave]),
    );

    await user.keyboard("{Escape}");
    await descargar(user, 1);

    const cabecera = encabezadosDelArchivo();
    expect(cabecera).toContain(BASE_PRESENTE.encabezado);
    expect(cabecera).not.toContain(BASE_OCULTA.encabezado);
    // Todas las demás siguen ahí, derivando «todas» de la fuente de verdad.
    expect(cabecera).toEqual(ENCABEZADOS_BASE.filter((e) => e !== BASE_OCULTA.encabezado));
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("EL CASO DE LA CONCESIÓN — ocultar sin dinero NO borra lo guardado con dinero", async () => {
    // Lo que el usuario ya había decidido CON la concesión.
    window.localStorage.setItem(
      CLAVE_CON_DINERO,
      JSON.stringify({ ocultas: [RECAUDADO.clave] }),
    );

    // Y ahora la pantalla llega SIN ella (permiso retirado, o `limite_excedido`) y toca otra
    // columna cualquiera: es la escritura que, con un ámbito compartido, sanearía la
    // preferencia contra las once columnas base y se llevaría por delante `recaudado`.
    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(false) });
    montar(false);
    await screen.findByText("Spray Protector");
    await abrirSelector(user);
    await user.click(casilla(BASE_OCULTA.encabezado));
    await waitFor(() =>
      expect(preferenciaGuardada(CLAVE_SIN_DINERO)?.ocultas).toEqual([BASE_OCULTA.clave]),
    );

    // (1) Lo guardado del otro juego sigue intacto, y en SU clave.
    expect(preferenciaGuardada(CLAVE_CON_DINERO)?.ocultas).toEqual([RECAUDADO.clave]);

    // (2) Y cuando la concesión vuelve, el archivo sigue sin la columna que se ocultó: no
    // REAPARECE. Con un solo ámbito, aquí saldría marcada otra vez.
    cleanup();
    const usuarioConDinero = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(true) });
    montar(true);
    await screen.findByText("Spray Protector");
    await descargar(usuarioConDinero, 1);

    const cabecera = encabezadosDelArchivo();
    expect(cabecera).not.toContain(RECAUDADO.encabezado);
    expect(cabecera).toEqual(ENCABEZADOS_DINERO.filter((e) => e !== RECAUDADO.encabezado));
    // Y la columna que se ocultó en el OTRO ámbito no se hereda aquí: son dos archivos.
    expect(cabecera).toContain(BASE_OCULTA.encabezado);
  });

  it("una preferencia que nombre columnas de dinero no las cuela en el archivo sin concesión", async () => {
    // El caso simétrico, y el que impide «declarar un solo ámbito con el catálogo de dinero
    // siempre publicado»: ahí estas claves saldrían como columnas vacías del archivo de quien
    // no tiene la concesión.
    window.localStorage.setItem(
      CLAVE_SIN_DINERO,
      JSON.stringify({
        ocultas: [],
        orden: [RECAUDADO.clave, "ordenex", BASE_PRESENTE.clave],
      }),
    );

    const user = userEvent.setup();
    consultarMock.mockResolvedValue({ status: "ok", datos: dto(false) });
    montar(false);
    await screen.findByText("Spray Protector");
    await descargar(user, 1);

    // Ni una columna de dinero, y el archivo se generó igual: una preferencia con claves que ya
    // no se publican no puede añadir columnas ni impedir la descarga.
    expect(encabezadosDelArchivo()).toEqual(ENCABEZADOS_BASE);
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("sin preferencia el archivo lleva el catálogo entero de su juego", async () => {
    const user = userEvent.setup();
    montar(true);
    await screen.findByText("Spray Protector");
    await descargar(user, 1);

    expect(encabezadosDelArchivo()).toEqual(ENCABEZADOS_DINERO);
    // Y nada se escribió en el navegador: abrir la pantalla no fija ninguna preferencia.
    expect(window.localStorage.getItem(CLAVE_CON_DINERO)).toBeNull();
    expect(window.localStorage.getItem(CLAVE_SIN_DINERO)).toBeNull();
  });
});
