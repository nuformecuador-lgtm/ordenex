// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { claveColumnas } from "@/lib/manifiesto/preferencia-columnas";

// ---------------------------------------------------------------------------
// Ficha 314 (T14) — la descarga de `/ordenes` deja ELEGIR qué columnas salen y en qué orden.
// Cubre R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R16, R20, R32, R33 y R34.
//
// Se monta el consumidor REAL (`OrdenesModule`) y solo se aísla el codificador binario
// (`buildXlsxRows`), así que el recorrido
// `preferencia -> DescargarDatasetButton -> construirDescarga -> buildXlsxRows` es el de
// producción y lo que se afirma son las columnas que de verdad llegan al archivo.
//
// R35 sigue rigiendo: «todas las columnas» se DERIVA de `COLUMNAS_DESCARGA_ORDENES` y ningún
// caso afirma un total. Publicar la columna 23 no debe tocar este archivo.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const listarOrdenesMock = vi.fn();
const listarOrdenesCompletoMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
  listarOrdenesCompleto: (...a: unknown[]) => listarOrdenesCompletoMock(...a),
}));

vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: vi.fn(async () => ({ status: "ok", estatus: [] })),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Solo el codificador binario se aísla: `construirDescarga` corre REAL, así que el nombre del
// archivo, el nombre de la hoja y el recorrido de columnas que se afirman son los de verdad.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import {
  AMBITO_DESCARGA_ORDENES,
  COLUMNAS_DESCARGA_ORDENES,
} from "@/app/(app)/ordenes/_components/ordenes-descarga-columnas";

/** La clave del ámbito de órdenes, tal y como la arma el control común. */
const CLAVE_ORDENES = `ordenex:descarga-columnas:${AMBITO_DESCARGA_ORDENES}`;

/** Todos los encabezados del catálogo, DERIVADOS. Nunca una lista escrita a mano. */
const ENCABEZADOS = COLUMNAS_DESCARGA_ORDENES.map((c) => c.encabezado);
/** Todas las claves del catálogo, derivadas. */
const CLAVES = COLUMNAS_DESCARGA_ORDENES.map((c) => c.clave);
/** Una columna cualquiera que se ocultará, y otra que debe seguir saliendo. */
const OCULTA = COLUMNAS_DESCARGA_ORDENES[3]!;
const PRESENTE = COLUMNAS_DESCARGA_ORDENES[0]!;

function makeOrden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 1000 + i,
    numRemision: `REM-${String(i).padStart(3, "0")}`,
    estatusId: "est-entregada",
    estatusValue: "entregada",
    destinatario: `Destinatario ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
    producto: `Producto ${i}`,
    peso: 1.5,
    notas: null,
    direccion: `Calle ${i}`,
    montoCobrar: 1000 + i,
    intentosEntrega: 0,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
  } as OrdenListItemDTO;
}

const PAGINA_VISIBLE = [makeOrden(1), makeOrden(2)];
const DATASET_COMPLETO = Array.from({ length: 7 }, (_, i) => makeOrden(i + 1));

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: "Descargar Órdenes" });
}

function disparadorSelector() {
  return screen.getAllByRole("button", {
    name: "Elegir columnas de la descarga",
  });
}

async function abrirSelector(indice = 0) {
  const user = userEvent.setup();
  await user.click(disparadorSelector()[indice]!);
  await screen.findAllByText("Columnas del archivo");
  return user;
}

/** Encabezados que recibió el generador en su ÚLTIMA llamada, en su orden. */
function encabezadosDelArchivo(): string[] {
  const llamada = buildXlsxRowsMock.mock.calls.at(-1);
  expect(llamada).toBeDefined();
  return llamada![0].map((columna) => columna.header);
}

function casilla(encabezado: string) {
  return screen.getByRole("checkbox", { name: encabezado });
}

function guardarPreferencia(preferencia: {
  ocultas?: string[];
  orden?: string[];
}): void {
  window.localStorage.setItem(CLAVE_ORDENES, JSON.stringify(preferencia));
}

/** Fecha local de hoy en `YYYY-MM-DD`, misma convención que el nombre de archivo. */
function hoyISO(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: PAGINA_VISIBLE,
    page: 1,
    pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    total: 100,
  });
  listarOrdenesCompletoMock.mockResolvedValue({
    status: "ok",
    items: DATASET_COMPLETO,
    total: DATASET_COMPLETO.length,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Descarga de órdenes · elección de columnas", () => {
  it("R1 — ofrece un control propio junto al botón de descarga", async () => {
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    expect(botonDescarga()).toBeInTheDocument();
    expect(disparadorSelector()).toHaveLength(1);
    // Cerrado no muestra nada: es un control PARALELO, no un paso del camino de descarga.
    expect(screen.queryByText("Columnas del archivo")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    // Y abrirlo NO descarga.
    await abrirSelector();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("R2 — presenta una casilla por columna del catálogo, sin omitir ninguna", async () => {
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    await abrirSelector();

    // La lista esperada se DERIVA de la constante: una columna publicada mañana aparece sola.
    for (const encabezado of ENCABEZADOS) {
      expect(casilla(encabezado)).toBeInTheDocument();
      expect(casilla(encabezado)).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(ENCABEZADOS.length);
  });

  it("R3 — el nombre de cada casilla ES el encabezado con el que la columna sale en el archivo", async () => {
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    const user = await abrirSelector();

    // No basta con que los textos coincidan: se descarga y se comprueba que la cabecera del
    // ARCHIVO lleva esos mismos textos, en el mismo orden.
    const nombres = screen.getAllByRole("checkbox").map((c) => {
      const id = c.getAttribute("aria-labelledby");
      return (id && document.getElementById(id)?.textContent) || "";
    });
    expect(nombres).toEqual(ENCABEZADOS);

    await user.keyboard("{Escape}");
    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).toEqual(nombres);
  });

  it("R16 — sin preferencia el archivo lleva el catálogo completo, en el orden del catálogo", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(encabezadosDelArchivo()).toEqual(ENCABEZADOS);
  });

  it("R4, R5 — una columna marcada viaja en la cabecera y una desmarcada no", async () => {
    guardarPreferencia({ ocultas: [OCULTA.clave] });
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const cabecera = encabezadosDelArchivo();
    expect(cabecera).toContain(PRESENTE.encabezado);
    expect(cabecera).not.toContain(OCULTA.encabezado);
    // Todas las demás siguen ahí, derivando «todas» de la fuente de verdad.
    expect(cabecera).toEqual(
      ENCABEZADOS.filter((e) => e !== OCULTA.encabezado),
    );
  });

  it("R6 — un solo click descarga con lo guardado, sin confirmar columnas", async () => {
    guardarPreferencia({ ocultas: [OCULTA.clave] });
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    // El selector ni siquiera está desplegado: no hay paso intermedio.
    expect(screen.queryByText("Columnas del archivo")).toBeNull();

    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1);
    expect(encabezadosDelArchivo()).not.toContain(OCULTA.encabezado);
    expect(screen.queryByText("Columnas del archivo")).toBeNull();
  });

  it("R7 — con una sola marcada, la casilla se deshabilita y el click no la desmarca", async () => {
    guardarPreferencia({
      ocultas: CLAVES.filter((clave) => clave !== PRESENTE.clave),
    });
    const antes = window.localStorage.getItem(CLAVE_ORDENES);
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    await abrirSelector();

    const ultima = casilla(PRESENTE.encabezado);
    expect(ultima).toHaveAttribute("aria-checked", "true");
    // Base UI rinde la casilla como `role="checkbox"` no nativo: el estado deshabilitado
    // viaja en `aria-disabled`, que es lo que lee la tecnología asistiva.
    expect(ultima).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Debe quedar al menos una columna")).toBeVisible();

    // `fireEvent` a propósito: user-event se negaría a entregar el click y el caso quedaría
    // sin probar. Lo que hay que demostrar es que ni un click que SÍ llega mueve el estado.
    fireEvent.click(ultima);

    expect(ultima).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(CLAVE_ORDENES)).toBe(antes);
  });

  it("R8 — «Restablecer» deja todas marcadas y en el orden del catálogo", async () => {
    guardarPreferencia({
      ocultas: [OCULTA.clave],
      orden: [...CLAVES].reverse(),
    });
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    const user = await abrirSelector();

    await user.click(screen.getByRole("button", { name: "Restablecer" }));

    for (const encabezado of ENCABEZADOS) {
      expect(casilla(encabezado)).toHaveAttribute("aria-checked", "true");
    }
    // Y el orden vuelve al del catálogo: «Restablecer» borra las DOS listas.
    const nombres = screen.getAllByRole("checkbox").map((c) => {
      const id = c.getAttribute("aria-labelledby");
      return (id && document.getElementById(id)?.textContent) || "";
    });
    expect(nombres).toEqual(ENCABEZADOS);
    expect(window.localStorage.getItem(CLAVE_ORDENES)).toBe('{"ocultas":[]}');
  });

  it("R9 — lo elegido sigue vigente tras remontar", async () => {
    const user = userEvent.setup();
    const { unmount } = envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    await abrirSelector();
    await user.click(casilla(OCULTA.encabezado));

    await waitFor(() => {
      const crudo = window.localStorage.getItem(CLAVE_ORDENES);
      expect(crudo).not.toBeNull();
      expect(JSON.parse(crudo!).ocultas).toContain(OCULTA.clave);
    });

    unmount();
    cleanup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    await user.click(botonDescarga());

    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).not.toContain(OCULTA.encabezado);
    expect(encabezadosDelArchivo()).toContain(PRESENTE.encabezado);
  });

  it("R20 — con un orden guardado, la cabecera del archivo sale EN ESE orden", async () => {
    const alReves = [...CLAVES].reverse();
    guardarPreferencia({ ocultas: [OCULTA.clave], orden: alReves });
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const esperado = alReves
      .filter((clave) => clave !== OCULTA.clave)
      .map(
        (clave) =>
          COLUMNAS_DESCARGA_ORDENES.find((c) => c.clave === clave)!.encabezado,
      );
    expect(encabezadosDelArchivo()).toEqual(esperado);
    // Contraprueba de no-vacuidad: ese orden NO es el del catálogo.
    expect(encabezadosDelArchivo()).not.toEqual(
      ENCABEZADOS.filter((e) => e !== OCULTA.encabezado),
    );
  });

  it("R19, R20 — lo que el selector muestra tras mover es lo que sale en la cabecera del archivo", async () => {
    // La otra cara de R20, sin expectativas escritas a mano: se mueve una columna DESDE LA UI y
    // se comprueba que el archivo sale exactamente como quedó la lista. Es lo que impide el
    // fallo mudo de manual —la lista se mueve, el archivo no— y no depende de que nadie acierte
    // a escribir el orden esperado.
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    const user = await abrirSelector();

    const segunda = ENCABEZADOS[1]!;
    await user.click(screen.getByRole("button", { name: `Subir ${segunda}` }));
    await user.click(screen.getByRole("button", { name: `Bajar ${segunda}` }));
    await user.click(screen.getByRole("button", { name: `Bajar ${segunda}` }));

    const enPantalla = screen.getAllByRole("checkbox").map((c) => {
      const id = c.getAttribute("aria-labelledby");
      return (id && document.getElementById(id)?.textContent) || "";
    });
    // Premisa: la lista SÍ se movió. Sin esto el caso pasaría también sin reordenar nada.
    expect(enPantalla).not.toEqual(ENCABEZADOS);

    await user.keyboard("{Escape}");
    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(encabezadosDelArchivo()).toEqual(enPantalla);
  });

  it("R10 — cambiar órdenes no altera la preferencia de un flujo de manifiesto, ni al revés", async () => {
    const CLAVE_MANIFIESTO = claveColumnas("carga_masiva");
    const preferenciaManifiesto = JSON.stringify({ ocultas: ["telefono"] });
    window.localStorage.setItem(CLAVE_MANIFIESTO, preferenciaManifiesto);

    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");
    await abrirSelector();
    await user.click(casilla(OCULTA.encabezado));

    await waitFor(() => {
      expect(window.localStorage.getItem(CLAVE_ORDENES)).not.toBeNull();
    });
    // La del manifiesto no se movió NI UN CARÁCTER.
    expect(window.localStorage.getItem(CLAVE_MANIFIESTO)).toBe(
      preferenciaManifiesto,
    );
    // Y la de órdenes no contiene lo del manifiesto: son dos claves distintas.
    expect(
      JSON.parse(window.localStorage.getItem(CLAVE_ORDENES)!).ocultas,
    ).toEqual([OCULTA.clave]);
  });

  it("R32 — dos selectores del MISMO ámbito se sincronizan sin recargar la página", async () => {
    const user = userEvent.setup();
    envolver(
      <>
        <OrdenesModule permitirDescarga />
        <OrdenesModule permitirDescarga />
      </>,
    );
    await screen.findAllByText("Destinatario 1");
    expect(disparadorSelector()).toHaveLength(2);

    // Se edita desde el PRIMER selector…
    await abrirSelector(0);
    await user.click(casilla(OCULTA.encabezado));
    await user.keyboard("{Escape}");

    // …y el SEGUNDO botón, que nunca se abrió, descarga ya al día. Ésta es la evidencia
    // fuerte: sus columnas visibles salen del snapshot de SU hook, así que si la segunda
    // superficie no se hubiera enterado, la columna seguiría en el archivo.
    await user.click(
      screen.getAllByRole("button", { name: "Descargar Órdenes" })[1]!,
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).not.toContain(OCULTA.encabezado);
    expect(encabezadosDelArchivo()).toContain(PRESENTE.encabezado);

    // Y su selector, al abrirse, muestra la casilla ya desmarcada. Sin recargar la página.
    await abrirSelector(1);
    expect(casilla(OCULTA.encabezado)).toHaveAttribute("aria-checked", "false");
  });

  it("R33 — una tabla SIN ámbito no muestra selector y emite todas sus columnas", async () => {
    // El mismo control común, sin `ambitoColumnas`: es lo que siguen haciendo las otras 24
    // tablas del árbol. Se le deja incluso una preferencia escrita en el ámbito de órdenes,
    // para que se vea que no la mira.
    guardarPreferencia({ ocultas: [OCULTA.clave] });
    const user = userEvent.setup();
    const columnas = [
      { clave: "uno", encabezado: "Uno" },
      { clave: "dos", encabezado: "Dos" },
    ];
    render(
      <DescargarDatasetButton
        titulo="Sin ámbito"
        columnas={columnas}
        obtenerFilas={async () => ({
          status: "ok" as const,
          filas: [{ uno: "a", dos: "b" }],
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Elegir columnas de la descarga" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Descargar Sin ámbito" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).toEqual(["Uno", "Dos"]);
  });

  it("R33 — sin ámbito, el control entrega el array de columnas TAL CUAL, no una copia derivada", async () => {
    // Esto no es una sutileza de implementación: es una propiedad de la que ya dependía una
    // pantalla viva. `ExportarVistaFinanciera` (feature 184) mantiene UNA instancia estable de
    // su array de columnas y la reescribe EN SITIO desde `obtenerFilas`, porque el juego de
    // columnas de ese archivo depende de la forma del importe y esa forma solo se conoce cuando
    // llega el DTO. Si el control derivara una copia al renderizar, el archivo saldría con las
    // columnas ANTERIORES —una columna «Neto» vacía en las métricas que no la publican— sin un
    // solo error. Se reproduce aquí en pequeño para que la propiedad tenga dueño.
    const user = userEvent.setup();
    const columnas = [
      { clave: "uno", encabezado: "Uno" },
      { clave: "dos", encabezado: "Dos" },
    ];
    render(
      <DescargarDatasetButton
        titulo="Columnas tardías"
        columnas={columnas}
        obtenerFilas={async () => {
          // La forma del archivo se decide AQUÍ, no al renderizar.
          columnas.splice(0, columnas.length, {
            clave: "tres",
            encabezado: "Tres",
          });
          return { status: "ok" as const, filas: [{ tres: "c" }] };
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Descargar Columnas tardías" }),
    );
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).toEqual(["Tres"]);
  });

  it("R34 — con preferencia guardada NO cambian el nombre del archivo, la hoja ni las filas", async () => {
    guardarPreferencia({
      ocultas: [OCULTA.clave],
      orden: [...CLAVES].reverse(),
    });
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);
    await screen.findByText("Destinatario 1");

    await user.click(botonDescarga());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // La hoja y las filas: el filtro va en las columnas, nunca en los datos.
    const [, filas, hoja] = buildXlsxRowsMock.mock.calls[0]!;
    expect(hoja).toBe("Órdenes");
    expect(filas).toHaveLength(DATASET_COMPLETO.length);
    expect(filas.map((f) => f.numRemision)).toEqual(
      DATASET_COMPLETO.map((o) => o.numRemision),
    );
    // Y la fila sigue llegando ENTERA, con la clave oculta incluida: la columna no se emite,
    // pero el dato no se recorta.
    expect(Object.keys(filas[0]!).sort()).toEqual([...CLAVES].sort());

    // El nombre del archivo: mismo patrón `ordenes-YYYY-MM-DD.xlsx` de siempre.
    const [, , nombreArchivo] = descargarBlobMock.mock.calls[0]!;
    expect(nombreArchivo).toBe(`ordenes-${hoyISO()}.xlsx`);

    // Y la action del dataset se llamó igual que siempre: el servidor no se entera de nada.
    expect(listarOrdenesCompletoMock).toHaveBeenCalledTimes(1);
    expect(listarOrdenesCompletoMock.mock.calls[0][0]).toEqual({});
  });
});
