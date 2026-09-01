// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

const detalleMock = vi.fn();
const detalleCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet", () => ({
  verDetalleDeMovimientoAction: (...a: unknown[]) => detalleMock(...a),
  verDetalleDeMovimientoCompletoAction: (...a: unknown[]) => detalleCompletoMock(...a),
}));

vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import { DETALLE_MOVIMIENTO_VACIO } from "@/app/(app)/wallet/_components/detalle-movimiento-labels";
import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

/**
 * Ficha 344 (B6) — ABRIR UNA FILA DEL LIBRO DE LA CAJA Y VER LAS ÓRDENES QUE LA COMPONEN.
 *
 * Cubre R1–R14, R25, R31, R33, R45, R47, R48 y R50–R52. La otra mitad —que las órdenes sean
 * EXACTAMENTE las que aportan y que la suma cuadre— se mide contra Postgres en
 * `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts`; ninguna de las dos
 * sustituye a la otra.
 *
 * SE MIDE DESDE EL LIBRO COMPLETO y no montando el panel suelto. Es deliberado: cuatro de los
 * requisitos —«cerrado no lee nada», «abrir cuesta UNA lectura», «dos filas abiertas no se
 * pisan» y «una fila que no nace de un cierre no ofrece control»— son propiedades del LIBRO, y
 * un test que montara un solo panel no podría afirmar ninguna.
 */

const FECHA_FILA = "2026-08-14";

function movimiento(over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: "28800.00",
    origenTipo: "cierre_dia",
    origenId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: `${FECHA_FILA}T10:00:00.000Z`,
    dueno: "propio",
    ...over,
  };
}

/** La fila de un ajuste MANUAL: no nace de un cierre, así que no se abre (R6). */
const MANUAL = movimiento({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tipo: "egreso",
  categoria: "egreso_ajuste",
  monto: "45.75",
  origenTipo: "manual",
  origenId: null,
  descripcion: "Faltante al cuadrar la caja",
});

/** La OTRA fila de cierre, para poder abrir dos a la vez (R4). */
const OTRA_DE_CIERRE = movimiento({
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  categoria: "ingreso_comision_cod",
  monto: "900.00",
});

function orden(over: Partial<OrdenAporteDTO> = {}): OrdenAporteDTO {
  return {
    ordenId: "11111111-1111-4111-8111-111111111111",
    guia: "48127",
    destinatario: "María Fernández",
    tiendaNombre: "Tienda Central",
    resultados: ["entregada"],
    aporte: "1700.00",
    ...over,
  };
}

/** Respuesta `ok` del borde, con el `total` y el `pageSize` que decide el SERVIDOR. */
function pagina(
  ordenes: OrdenAporteDTO[],
  total: number,
  page = 1,
  pageSize = 25,
  extra: { ordenesDelCierre?: number; mensajeroNombre?: string | null; monto?: string } = {},
) {
  return {
    status: "ok" as const,
    data: {
      monto: extra.monto ?? "28800.00",
      cierre: {
        fecha: `${FECHA_FILA}T00:00:00.000Z`,
        mensajeroNombre: extra.mensajeroNombre ?? "Kevin Solano Ramírez",
      },
      ordenesDelCierre: extra.ordenesDelCierre ?? 23,
      total,
      page,
      pageSize,
      ordenes,
    },
  };
}

function envolver(nodo: ReactElement) {
  // Caché SWR NUEVA por render: sin esto, el resultado de un caso alimentaría al siguiente y
  // «abrir cuesta una lectura» pasaría en verde sin haber leído nada.
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function pintar(movimientos: WalletMovimientoDTO[] = [movimiento()]) {
  return envolver(<WalletLedger movimientos={movimientos} />);
}

/** Nombres accesibles compuestos con el concepto y la fecha de SU fila (R5). */
const ABRIR_FLETE = `Ver las órdenes que componen Flete del ${FECHA_FILA}`;
const ABRIR_COMISION = `Ver las órdenes que componen Comisión COD del ${FECHA_FILA}`;
const PANEL_FLETE = `Órdenes que componen Flete del ${FECHA_FILA}`;
const PANEL_COMISION = `Órdenes que componen Comisión COD del ${FECHA_FILA}`;

function abrir(nombre: string) {
  return userEvent.click(screen.getByRole("button", { name: nombre }));
}

function panel(nombre: string): HTMLElement {
  return screen.getByRole("region", { name: nombre });
}

/**
 * Las filas de DATOS de la tabla del panel.
 *
 * `:scope > tbody > tr` y no `"tbody tr"`: este panel vive DENTRO de una fila del libro, así que
 * su `<thead>` también es descendiente del `<tbody>` de la tabla de fuera y un selector de
 * descendencia se traería la cabecera como si fuera un dato. Es el precio de anidar una tabla en
 * otra, y no verlo dejaría el conteo de filas mintiendo por uno.
 */
function filasDeDatos(region: HTMLElement): HTMLTableRowElement[] {
  const tabla = region.querySelector("table");
  return [...(tabla?.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr") ?? [])];
}

/** El input con el que la pantalla pidió la lectura número `n` (0-based). */
function inputDeLlamada(n: number): Record<string, unknown> {
  return detalleMock.mock.calls[n][0] as Record<string, unknown>;
}

beforeEach(() => {
  detalleMock.mockReset();
  detalleCompletoMock.mockReset();
  detalleMock.mockResolvedValue(pagina([orden()], 1));
  detalleCompletoMock.mockResolvedValue({ status: "ok", items: [orden()], total: 1 });
});

afterEach(() => {
  cleanup();
});

describe("Ficha 344 — abrir una fila del libro (R1–R7)", () => {
  it("R2: con el libro pintado y sus filas cerradas no se lee ningún detalle", async () => {
    pintar([movimiento(), OTRA_DE_CIERRE, MANUAL]);

    // El libro entero está pintado y no ha costado ni una lectura de detalle. Con el `useSWR`
    // montado desde el libro, serían tres.
    expect(await screen.findByRole("table", { name: "Libro de movimientos" })).toBeInTheDocument();
    expect(detalleMock).not.toHaveBeenCalled();

    // CONTROL DE NO-VACUIDAD: el lector está cableado de verdad; lo que no ha ocurrido es la
    // lectura, no el cableado. Sin esta línea, un libro que no llamara NUNCA al borde dejaría
    // el caso de arriba en verde.
    await abrir(ABRIR_FLETE);
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(1));
  });

  it("R3: abrir una fila cuesta exactamente UNA lectura, y sólo de esa fila", async () => {
    pintar([movimiento(), OTRA_DE_CIERRE]);

    await abrir(ABRIR_FLETE);
    await screen.findByRole("region", { name: PANEL_FLETE });

    expect(detalleMock).toHaveBeenCalledTimes(1);
    // R42: dos claves y ninguna más. Ni el cierre, ni la categoría, ni la tienda.
    expect(inputDeLlamada(0)).toEqual({
      movimientoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      page: 1,
    });
  });

  it("R1: al abrir una fila de cierre se muestran las órdenes que componen su importe", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", guia: "48127", aporte: "1700.00" }),
          orden({ ordenId: "o-2", guia: "48128", aporte: "3400.00" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);

    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(await dentro.findByText("₡1.700")).toBeInTheDocument();
    expect(dentro.getByText("₡3.400")).toBeInTheDocument();
  });

  it("R5: el control de abrir nombra SU fila, no un genérico repetido", async () => {
    pintar([movimiento(), OTRA_DE_CIERRE]);

    // Dos filas, dos nombres DISTINTOS, cada uno con el concepto y la fecha de la suya.
    expect(screen.getByRole("button", { name: ABRIR_FLETE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ABRIR_COMISION })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver detalle" })).toBeNull();
  });

  it("R6: una fila que no nace de un cierre NO ofrece control de apertura", async () => {
    pintar([movimiento(), MANUAL]);

    // La de cierre sí; la manual no tiene ningún botón de apertura en toda la tabla.
    expect(screen.getByRole("button", { name: ABRIR_FLETE })).toBeInTheDocument();
    const aperturas = screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Ver las órdenes"));
    expect(aperturas).toHaveLength(1);
  });

  it("R4: dos filas abiertas mantienen páginas independientes", async () => {
    detalleMock.mockImplementation(async (input: Record<string, unknown>) => {
      const id = String(input.movimientoId);
      const page = Number(input.page);
      return pagina([orden({ ordenId: `${id}-p${page}` })], 30, page, 25);
    });
    pintar([movimiento(), OTRA_DE_CIERRE]);

    await abrir(ABRIR_FLETE);
    await screen.findByRole("region", { name: PANEL_FLETE });
    await abrir(ABRIR_COMISION);
    await screen.findByRole("region", { name: PANEL_COMISION });

    // Dos lecturas, una por fila: ninguna se llevó por delante a la otra.
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));

    // Se avanza de página SÓLO en la primera.
    await userEvent.click(
      within(panel(PANEL_FLETE)).getByRole("button", { name: "Página siguiente" }),
    );
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(3));
    expect(inputDeLlamada(2)).toEqual({
      movimientoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      page: 2,
    });

    // Y la otra sigue donde estaba: su barra dice la primera página, no la segunda.
    await waitFor(() =>
      expect(within(panel(PANEL_FLETE)).getByText("26-30 de 30")).toBeInTheDocument(),
    );
    expect(within(panel(PANEL_COMISION)).getByText("1-25 de 30")).toBeInTheDocument();
  });

  it("R7: un fallo de lectura se cuenta DENTRO de la fila y el libro sigue en pie", async () => {
    detalleMock.mockResolvedValue({ status: "not_found" });
    pintar([movimiento(), MANUAL]);

    await abrir(ABRIR_FLETE);

    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(
      await dentro.findByText(/No se pudo cargar el detalle de este movimiento/),
    ).toBeInTheDocument();

    // El libro entero sigue pintado: la otra fila y su descripción no se han ido a ninguna parte.
    expect(screen.getByRole("table", { name: "Libro de movimientos" })).toBeInTheDocument();
    expect(screen.getByText(/Faltante al cuadrar la caja/)).toBeInTheDocument();
  });

  it("R8: un detalle sin órdenes muestra su estado vacío explícito", async () => {
    detalleMock.mockResolvedValue(pagina([], 0, 1, 25, { ordenesDelCierre: 23 }));
    pintar();

    await abrir(ABRIR_FLETE);

    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(await dentro.findByText(DETALLE_MOVIMIENTO_VACIO)).toBeInTheDocument();
  });
});

describe("Ficha 344 — qué dice el detalle (R9–R14)", () => {
  it("R10/R13/R14: cada orden muestra guía, destinatario, tienda, resultado y aporte", async () => {
    detalleMock.mockResolvedValue(
      pagina([orden({ resultados: ["entregada"], aporte: "1700.00" })], 1),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    // Las cinco cabeceras, en su sitio.
    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Guía", "Destinatario", "Tienda", "Resultado", "Aporte"]);

    expect(dentro.getByText("María Fernández")).toBeInTheDocument();
    // R14: la caja principal SÍ dice de qué tienda es cada orden.
    expect(dentro.getByText("Tienda Central")).toBeInTheDocument();
    // R13: la etiqueta legible del catálogo, NUNCA el valor del enum.
    expect(dentro.getByText("Entregada")).toBeInTheDocument();
    expect(dentro.queryByText("entregada")).toBeNull();
    expect(dentro.getByText("₡1.700")).toBeInTheDocument();
  });

  it("R20: una orden con DOS gestiones sale UNA vez y nombra los dos resultados", async () => {
    detalleMock.mockResolvedValue(
      pagina([orden({ resultados: ["entregada", "reprogramada"], aporte: "1700.00" })], 1),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });

    expect(within(region).getByText("Entregada · Reprogramada")).toBeInTheDocument();
    // UNA fila de datos, no dos: el grano es la ORDEN.
    expect(filasDeDatos(region)).toHaveLength(1);
  });

  it("R11: cada orden lleva enlace al listado de órdenes con SU guía", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const enlace = await dentro.findByRole("link", { name: "Ver en órdenes la guía 48127" });
    // El parámetro sale del defecto que lee el buscador de `/ordenes`, no de un literal a mano.
    expect(enlace).toHaveAttribute("href", "/ordenes?q=48127");
  });

  it("R9/R12: la cabecera dice la fecha del cierre, el mensajero y el «N de M»", async () => {
    detalleMock.mockResolvedValue(
      pagina([orden()], 14, 1, 25, { ordenesDelCierre: 23, mensajeroNombre: "Kevin Solano" }),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    expect(await dentro.findByText(`Cierre del día ${FECHA_FILA}`)).toBeInTheDocument();
    // R15 al revés: en la CAJA principal el mensajero SÍ se nombra.
    expect(dentro.getByText("Mensajero: Kevin Solano")).toBeInTheDocument();
    // La frase que el humano fue a buscar y no encontró.
    expect(
      dentro.getByText("14 de 23 órdenes del cierre aportan a este concepto"),
    ).toBeInTheDocument();
  });
});

describe("Ficha 344 — la paginación y el total (R25/R28)", () => {
  it("R25/R28: el total es el del CONJUNTO y se puede navegar a la página siguiente", async () => {
    // 28 órdenes aportan y la página trae 25: el servidor manda las dos cifras.
    const veinticinco = Array.from({ length: 25 }, (_, i) =>
      orden({ ordenId: `o-${i}`, guia: `4812${i}` }),
    );
    detalleMock.mockResolvedValue(pagina(veinticinco, 28, 1, 25));
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    // MUTACIÓN QUE ESTE CASO MATA: `const total = ordenes.length`. Con eso la barra diría
    // «1-25 de 25» y «Página siguiente» quedaría deshabilitada, así que nadie llegaría nunca a
    // las tres órdenes restantes.
    expect(await dentro.findByText("1-25 de 28")).toBeInTheDocument();
    const siguiente = dentro.getByRole("button", { name: "Página siguiente" });
    expect(siguiente).toBeEnabled();

    await userEvent.click(siguiente);
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));
    expect(inputDeLlamada(1).page).toBe(2);
  });
});

describe("Ficha 344 — el concepto que no se reparte (R48)", () => {
  it("R48: la fila se abre IGUAL y el panel dice de dónde sale ese importe", async () => {
    detalleMock.mockResolvedValue({
      status: "sin_reparto",
      motivo: "snapshot_del_cierre",
    });
    pintar([movimiento({ categoria: "egreso_pago_mensajero", tipo: "egreso" })]);

    await abrir(`Ver las órdenes que componen Pago a mensajero del ${FECHA_FILA}`);

    const region = await screen.findByRole("region", {
      name: `Órdenes que componen Pago a mensajero del ${FECHA_FILA}`,
    });

    // MUTACIÓN QUE ESTE CASO MATA: que la rama `sin_reparto` se quede MUDA (un panel vacío, o
    // el mismo estado vacío de la tabla). El panel tiene que REDACTAR de dónde sale el importe:
    // un panel en blanco se lee como «la pantalla está rota», que es justo lo que R48 prohíbe.
    expect(
      await within(region).findByText(/el total que el cierre del día dejó anotado/),
    ).toBeInTheDocument();
    expect((region.textContent ?? "").trim().length).toBeGreaterThan(80);

    // Y no promete un desglose que no hay: ni tabla, ni control de descarga.
    expect(within(region).queryByRole("table")).toBeNull();
    expect(within(region).queryByRole("button", { name: /^Descargar/ })).toBeNull();
  });

  it("R48/R49: los TRES conceptos sin reparto tienen frase propia, ninguno queda mudo", async () => {
    const motivos = [
      ["snapshot_del_cierre", /el total que el cierre del día dejó anotado/],
      ["suma_del_libro_por_tienda", /la suma de lo que ese mismo cierre le acreditó a cada tienda/],
      ["otro_productor", /la indemnización anotada en cada gestión/],
      ["no_nace_de_un_cierre", /no nace del cierre del día/],
    ] as const;
    // El catálogo es un `Record` TOTAL: si mañana nace un motivo sin frase, el build no compila.
    expect(motivos).toHaveLength(4);

    for (const [motivo, frase] of motivos) {
      detalleMock.mockReset();
      detalleMock.mockResolvedValue({ status: "sin_reparto", motivo });
      pintar();
      await abrir(ABRIR_FLETE);
      const region = await screen.findByRole("region", { name: PANEL_FLETE });
      expect(await within(region).findByText(frase), motivo).toBeInTheDocument();
      cleanup();
    }
  });
});

describe("Ficha 344 — la descarga del detalle (R31/R33)", () => {
  it("R31: el panel monta su control de descarga, con el nombre de SU fila", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    expect(
      await dentro.findByRole("button", { name: `Descargar ${PANEL_FLETE}` }),
    ).toBeInTheDocument();
  });

  it("R33: la descarga sale de la LECTURA DEDICADA y el navegador no recorta nada", async () => {
    // La página visible trae UNA orden; el conjunto del servidor trae TRES.
    detalleMock.mockResolvedValue(pagina([orden({ ordenId: "o-1" })], 3, 1, 25));
    detalleCompletoMock.mockResolvedValue({
      status: "ok",
      items: [
        orden({ ordenId: "o-1", guia: "48127", aporte: "1700.00" }),
        orden({ ordenId: "o-2", guia: "48128", aporte: "3400.00" }),
        orden({ ordenId: "o-3", guia: "48129", aporte: "10200.00" }),
      ],
      total: 3,
    });
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    // Hasta que alguien pulsa, la lectura del conjunto NO se llama (R3: abrir cuesta una).
    await dentro.findByRole("button", { name: `Descargar ${PANEL_FLETE}` });
    expect(detalleCompletoMock).not.toHaveBeenCalled();

    await userEvent.click(dentro.getByRole("button", { name: `Descargar ${PANEL_FLETE}` }));

    await waitFor(() => expect(detalleCompletoMock).toHaveBeenCalledTimes(1));
    // El modo completo recibe SÓLO el id del movimiento: ni página, ni tamaño, ni filtros.
    expect(detalleCompletoMock.mock.calls[0][0]).toEqual({
      movimientoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });
});

describe("Ficha 344 — money-safe en el navegador (R45/R47/R51)", () => {
  it("R45: ninguna fuente nueva del panel opera con dinero", () => {
    const fuentes = [
      "app/(app)/wallet/_components/DetalleMovimientoCierre.tsx",
      "app/(app)/wallet/_components/detalle-movimiento-labels.ts",
      "app/(app)/wallet/_components/detalle-movimiento-descarga-columnas.ts",
      "app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx",
      "app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts",
      "app/(app)/mi-wallet/_components/detalle-mi-movimiento-descarga-columnas.ts",
    ];
    // Control de no-vacuidad: el barrido mira archivos que existen y tienen código.
    expect(fuentes).toHaveLength(6);

    for (const ruta of fuentes) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente.length, `${ruta} está vacío`).toBeGreaterThan(300);
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        expect(fuente, `${ruta} llama a ${prohibida}`).not.toMatch(prohibida);
      }
      expect(fuente, `${ruta} importa una biblioteca de decimales`).not.toMatch(
        /from\s+"(@prisma\/client|decimal\.js)"/,
      );
      // Y no suma la página: ni un `reduce`, ni un acumulador de importes.
      expect(fuente, `${ruta} acumula importes`).not.toMatch(/\.reduce\s*\(/);
    }
  });

  it("R47: el panel no pinta ningún subtotal de la página visible", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", aporte: "1700.00" }),
          orden({ ordenId: "o-2", aporte: "3400.00" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    const dentro = within(region);
    await dentro.findByText("₡1.700");

    expect(dentro.queryByText(/subtotal|total de la p[áa]gina/i)).toBeNull();
    // Dentro del CUERPO de la tabla hay exactamente tantos importes como órdenes: ninguna fila
    // de suma. Restar el importe de la fila y el de la página es lo único que el navegador tiene
    // prohibido con dinero, y para restarlos primero hay que pintarlos juntos.
    const importes = [...region.querySelectorAll("tbody td")]
      .map((c) => (c.textContent ?? "").trim())
      .filter((t) => t.startsWith("₡"));
    expect(importes).toEqual(["₡1.700", "₡3.400"]);
  });

  it("R51: la celda del aporte no lleva ninguna clase que trunque ni abrevie", async () => {
    pintar();
    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    const celda = [...region.querySelectorAll("tbody td")].find((c) =>
      (c.textContent ?? "").trim().startsWith("₡"),
    );
    expect(celda).toBeDefined();
    const clases = `${celda?.className ?? ""} ${celda?.querySelector("span")?.className ?? ""}`;
    for (const prohibida of ["truncate", "line-clamp", "overflow-hidden", "break-all"]) {
      expect(clases, `la celda del aporte lleva ${prohibida}`).not.toContain(prohibida);
    }
    // Y sí lleva las dos que la protegen: la cifra no se parte y queda en rejilla.
    expect(clases).toContain("whitespace-nowrap");
    expect(clases).toContain("tabular-nums");
  });
});

/**
 * Ficha 344 (T6.3) — LA FORMA DE LA TABLA EN UN TELÉFONO.
 *
 * EXISTE PORQUE SIN ESTO EL JUEGO DE COLUMNAS DE MÓVIL ES CÓDIGO MUERTO PARA LA SUITE. El
 * polyfill de `matchMedia` de `tests/setup/jest-dom.ts` devuelve siempre `matches: false`, o sea
 * escritorio, así que todos los casos de arriba pintan las CINCO columnas y ninguno llega a
 * pisar `COLUMNS_MOVIL`: borrarlo entero dejaría la suite en verde. Es lo que pasó en la ficha
 * 343, y por eso aquí se fuerza el hook y se afirman las dos formas.
 *
 * QUÉ SE AFIRMA, y por qué estos literales no son un espejo de `money`: `₡1.700`, `₡3.400` y
 * `₡10.200` son lo que un humano LEYÓ en Chromium con el defecto delante —la pantalla decía
 * `₡1.70` y `₡10.20`, dos números distintos y creíbles—. Son el contrato de esta ficha.
 *
 * Lo que ESTE test no puede ver, y por eso hay medición en navegador en `progress/impl_344.md`:
 * jsdom no hace layout, así que aquí no existen ni el ancho del panel, ni el desborde, ni las
 * flechas de scroll de la `DataTable`.
 */
describe("Ficha 344 — el detalle en un teléfono (R50/R52)", () => {
  const matchMediaOriginal = window.matchMedia;

  /** Un `matchMedia` que dice «sí» a la consulta de `useIsMobile` (`max-width: 767px`). */
  function fingirTelefono() {
    window.matchMedia = ((consulta: string) =>
      ({
        matches: /max-width:\s*767px/.test(consulta),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
  });

  it("en móvil la tabla tiene DOS columnas: «Orden» y «Aporte»", async () => {
    fingirTelefono();
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Orden", "Aporte"]);
  });

  it("R50: el aporte se lee ENTERO — `₡1.700`, `₡3.400` y `₡10.200`, sin recortar ni abreviar", async () => {
    fingirTelefono();
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", aporte: "1700.00" }),
          orden({ ordenId: "o-2", aporte: "3400.00" }),
          orden({ ordenId: "o-3", aporte: "10200.00" }),
        ],
        3,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    const dentro = within(region);

    // La celda ENTERA, no un `getByText` que pasaría con una subcadena.
    await dentro.findByText("₡1.700");
    const importes = filasDeDatos(region).map((tr) =>
      tr.querySelectorAll("td")[1]?.textContent?.trim(),
    );
    expect(importes).toEqual(["₡1.700", "₡3.400", "₡10.200"]);

    // Y NINGUNO de los números a medias que se leían en pantalla con el defecto de la 343.
    expect(dentro.queryByText("₡1.70")).toBeNull();
    expect(dentro.queryByText("₡10.20")).toBeNull();
  });

  it("R52: apilar cuatro columnas en una no esconde NINGÚN dato", async () => {
    fingirTelefono();
    detalleMock.mockResolvedValue(
      pagina([orden({ resultados: ["entregada"], aporte: "1700.00" })], 1),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    // Guía (enlazada), destinatario, tienda y resultado siguen en pantalla: viajan juntos, no
    // desaparecen. Es la misma información en dos columnas en vez de cinco.
    expect(
      await dentro.findByRole("link", { name: "Ver en órdenes la guía 48127" }),
    ).toBeInTheDocument();
    expect(dentro.getByText("María Fernández")).toBeInTheDocument();
    expect(dentro.getByText("Tienda Central")).toBeInTheDocument();
    expect(dentro.getByText("Entregada")).toBeInTheDocument();
    expect(dentro.getByText("₡1.700")).toBeInTheDocument();
  });

  it("R50: en móvil el panel se ACOTA al hueco visible del libro y se pega a su borde", async () => {
    // POR QUÉ ESTE CASO, y por qué sus números no son un espejo del código: MEDIDO en Chromium a
    // 390x844 el 2026-08-31, el panel heredaba 1.080 px de ancho de la tabla del libro —que
    // declara anchos mínimos por columna— dentro de un hueco visible de 308, y la columna del
    // aporte aterrizaba en x=[1064, 1108]: 674 px FUERA del área visible. El importe estaba
    // entero en el DOM y no había forma de leerlo sin arrastrar el libro entero de lado. Con el
    // acotamiento, la sección mide 308 y el aporte cae en x=[292, 336].
    //
    // jsdom no hace layout, así que aquí no se puede medir eso: lo que se afirma es EL CABLEADO
    // —que en móvil el panel pide el ancho de su contenedor de scroll y se acota con él—, que es
    // la parte que un refactor puede borrar sin que nada más chille. La medida vive en
    // `progress/impl_344.md`.
    fingirTelefono();
    const ANCHO = 308;
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).className.includes("overflow-x-auto") ? ANCHO : 0;
      },
    });
    try {
      pintar();
      await abrir(ABRIR_FLETE);
      const region = await screen.findByRole("region", { name: PANEL_FLETE });
      await within(region).findByText("₡1.700");

      expect(region.style.maxWidth).toBe(`${ANCHO}px`);
      expect(region.style.position).toBe("sticky");
      expect(region.style.left).toBe("0px");
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    }
  });

  it("en escritorio el panel NO se acota: el `max-width` sólo existe en móvil", async () => {
    // Control de no-vacuidad del caso de arriba, y la mitad que protege al escritorio: a 1440 la
    // sección mide 1.080 y el hueco 1.102, así que acotar no cambiaría nada — pero acotar a 1024
    // metería las CINCO columnas en 686 px y cambiaría un problema por otro. Por eso el corte es
    // el mismo `useIsMobile` que decide las columnas.
    pintar();
    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    expect(region.style.maxWidth).toBe("");
    expect(region.style.position).toBe("");
  });

  it("en escritorio NO cambia nada: las cinco columnas de siempre", async () => {
    // Control de no-vacuidad de los tres de arriba: si `useIsMobile` dejara de mirar la consulta,
    // este caso y el primero no podrían pasar a la vez.
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Guía", "Destinatario", "Tienda", "Resultado", "Aporte"]);
  });
});
