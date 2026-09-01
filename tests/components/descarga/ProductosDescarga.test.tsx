// @vitest-environment jsdom
//
// FICHA 345 (T8.4) — la DESCARGA de la tabla de productos de `/analitica`. Cubre R47, R50 y R52.
//
// El riesgo propio de esta descarga no es el formato: es la PROCEDENCIA. Las otras verticales de
// analítica exportan desde una lectura dedicada del servidor; ésta proyecta el DTO que ya está
// en pantalla (Familia B). La consecuencia buena es que el archivo NO PUEDE discrepar de la
// tabla; la que hay que vigilar es que nadie añada «de paso» una segunda consulta —bastaría una
// gestión registrada entre las dos para que el fichero dijera otra cosa que la pantalla—.
//
// Y la segunda mitad: la columna Tienda desaparece de la PANTALLA cuando la respuesta trae una
// sola tienda, pero en el ARCHIVO va siempre (R50). Un fichero que circula tiene que decir de
// quién es cada fila; quien lo reciba por correo no sabe con qué filtro se generó.
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
  PRODUCTOS_COLUMNAS,
  PRODUCTOS_TEXTOS,
} from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS } from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import type { ConteoProductosDTO, FilaProductoDTO } from "@/lib/types/conteo-productos";

vi.mock("@/lib/actions/conteo-productos", () => ({
  consultarConteoProductos: vi.fn(),
}));
const consultarMock = vi.mocked(consultarConteoProductos);

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador común se aísla de exceljs: aquí se juzga QUÉ filas y QUÉ columnas se le entregan.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

/** Un status que NO es ninguno de los cinco desenlaces: la orden sigue su curso. */
const EN_CURSO = "en_reparto";

/** DOS productos de la MISMA tienda: en pantalla la columna Tienda no se pinta (R46). */
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
  },
  {
    tiendaId: "3f2a1c88-9b40-4d21-8e77-1c0b5a6d2e91",
    tienda: "Tienda Uno",
    producto: "Bálsamo Tensor",
    unidades: 31,
    ordenes: 29,
    porStatus: [
      { status: "entregada", conteo: 20 },
      { status: "devuelta", conteo: 5 },
      { status: EN_CURSO, conteo: 4 },
    ],
  },
];

const DTO: ConteoProductosDTO = {
  filas: FILAS,
  ordenes: 45,
  ordenesSinProducto: 3,
  lastSync: "2026-09-01T18:30:00.000Z",
};

function montar() {
  return render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <FiltroEntregasProvider>
          <ProductosTabla />
        </FiltroEntregasProvider>
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
  consultarMock.mockResolvedValue({ status: "ok", datos: DTO });
});
afterEach(cleanup);

describe("FICHA 345 · la descarga de productos", () => {
  it("R47 — la tabla ofrece su control y el archivo trae una fila por producto", async () => {
    const user = userEvent.setup();
    montar();

    const boton = await screen.findByRole("button", {
      name: `Descargar ${PRODUCTOS_TEXTOS.descarga}`,
    });
    await user.click(boton);
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(FILAS.length);
    expect(hoja).toBe(PRODUCTOS_TEXTOS.descarga);
    expect(columnas.map((c) => c.key)).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => c.clave),
    );
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("R50 — el archivo lleva la TIENDA aunque la pantalla haya ocultado esa columna", async () => {
    const user = userEvent.setup();
    montar();

    await screen.findByText("Spray Protector");
    // La pantalla NO pinta la columna: las dos filas son de la misma tienda.
    expect(screen.queryByRole("columnheader", { name: PRODUCTOS_COLUMNAS.tienda })).toBeNull();

    await user.click(
      screen.getByRole("button", { name: `Descargar ${PRODUCTOS_TEXTOS.descarga}` }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [columnas, filas] = buildXlsxRowsMock.mock.calls[0];
    // El archivo SÍ la lleva, y la primera.
    expect(columnas[0].key).toBe("tienda");
    expect(filas.map((f) => f.tienda)).toEqual(["Tienda Uno", "Tienda Uno"]);
  });

  it("R52 — las filas salen de la pantalla: la acción NO se vuelve a llamar", async () => {
    const user = userEvent.setup();
    montar();

    await screen.findByText("Spray Protector");
    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole("button", { name: `Descargar ${PRODUCTOS_TEXTOS.descarga}` }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    // LA aserción de esta ficha: una sola lectura, la que ya pintó la tabla. Si alguien
    // cablease aquí una segunda consulta —aunque preguntara lo mismo— el archivo podría
    // discrepar de lo que el usuario acaba de ver.
    expect(consultarMock).toHaveBeenCalledTimes(1);
  });

  it("R49 — ninguna celda del archivo lleva el uuid de la tienda", async () => {
    const user = userEvent.setup();
    montar();

    await screen.findByText("Spray Protector");
    await user.click(
      screen.getByRole("button", { name: `Descargar ${PRODUCTOS_TEXTOS.descarga}` }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    for (const fila of filas) {
      expect(Object.values(fila).join(" ")).not.toContain(FILAS[0].tiendaId);
    }
  });

  it("los porcentajes viajan en PUNTOS y sin el signo de la pantalla", async () => {
    const user = userEvent.setup();
    montar();

    await screen.findByText("Spray Protector");
    // Lo que la PANTALLA muestra, para que el contraste sea explícito y no de memoria.
    expect(screen.getByText("37,5%")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `Descargar ${PRODUCTOS_TEXTOS.descarga}` }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    // `Spray Protector`: 8/16 y 6/16 medidos. El «%» convertiría una celda numérica en texto.
    expect(filas[0].efectividad).toBe(50);
    expect(filas[0].rechazo).toBe(37.5);
    expect(String(filas[0].rechazo)).not.toContain("%");
    // `Bálsamo Tensor`: 0 rechazos de 29 es un CERO legítimo, no una celda vacía.
    expect(filas[1].rechazo).toBe(0);
  });
});
