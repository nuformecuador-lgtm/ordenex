// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PorRecibirModule } from "@/app/(app)/recepcion-satelite/_components/PorRecibirModule";
import { AVISO_SIN_ZONA_SATELITE } from "@/app/(app)/recepcion-satelite/_components/AvisoSinZonaSatelite";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 279 (T4.5) — pantalla «Por recibir» del portal del `adminSatelite`.
//
// Es la mitad de arriba de lo que hasta el 2026-08-24 era una sola pantalla, y este
// archivo hereda los casos cuyo SUJETO eran las tarjetas por recibir, que vivían en
// `RecepcionSateliteModule.test.tsx` (ahí queda escrito cuál fue a parar dónde).
//
// LA REGLA DE ESTE ARCHIVO (R29): esta pantalla se define en buena parte por lo que NO
// tiene —ni botón de recepción, ni listado, ni filtros, ni paginación, ni acciones de
// lote—, y una ausencia se rompe sin que nadie se entere: un `queryBy` que deja de
// encontrar algo pasa igual de verde si el render entero se rompió. Por eso CADA ausencia
// va con una afirmación POSITIVA en el MISMO caso.

vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: (...a: unknown[]) => recibirPorQrMock(...a),
  listarRecepcionSatelite: vi.fn(),
}));

const { refreshMock, recibirPorQrMock, successMock, errorMock, infoMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    recibirPorQrMock: vi.fn(),
    successMock: vi.fn(),
    errorMock: vi.fn(),
    infoMock: vi.fn(),
  }));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    info: infoMock,
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

// La cámara nunca se abre en estos casos; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

const ZONA = "Limón";
const ESTADO_EN_RUTA = `${ORDER_STATUS_LABELS.en_ruta_bodega_satelite} de ${ZONA}`;
const REGION = "Por recibir";
const ABRIR_ESCANER = "Recibir paquete";

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_ruta_bodega_satelite",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA,
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  };
}

function renderModule(props?: {
  porRecibir?: RecepcionSateliteDTO[];
  zonaNombre?: string | null;
  sinZona?: boolean;
}) {
  render(
    <PorRecibirModule
      porRecibir={props?.porRecibir ?? []}
      zonaNombre={props?.zonaNombre === undefined ? ZONA : props.zonaNombre}
      sinZona={props?.sinZona ?? false}
    />,
  );
}

/** El acceso al receptor por guía/escaneo, esté la tarjeta plegada o no. */
const accesoReceptor = () => screen.queryByRole("button", { name: ABRIR_ESCANER });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PorRecibirModule — las tarjetas", () => {
  // Hereda de `RecepcionSateliteModule.test.tsx` el caso «'Por recibir' lista las órdenes
  // SIN ningún botón de acción», que a su vez venía de reexpresar el que afirmaba lo
  // contrario (Feature 63: cada tarjeta traía su "Aceptar").
  it("R1/R2: lista cada orden con su remisión, su estado legible y su detalle, SIN ningún botón", async () => {
    const user = userEvent.setup();
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2", destinatario: "Beto Ruiz" }),
      ],
    });

    const region = screen.getByRole("region", { name: REGION });

    // POSITIVO: las dos tarjetas están, con su remisión, su destinatario y su estado.
    expect(within(region).getAllByText(/REM-R1/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/REM-R2/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Beto Ruiz/).length).toBeGreaterThan(0);
    // El estado legible aparece en CADA tarjeta (badge de cabecera y, con el detalle
    // `keepMounted`, también dentro): se afirma una por una, que es lo que importa.
    const tarjetas = within(region).getAllByRole("listitem");
    expect(tarjetas).toHaveLength(2);
    for (const tarjeta of tarjetas) {
      expect(within(tarjeta).getAllByText(ESTADO_EN_RUTA).length).toBeGreaterThan(0);
    }

    // POSITIVO: el detalle desplegable sigue ahí (R2) — la tarjeta no perdió información
    // al perder el botón.
    const desplegables = within(region).getAllByRole("button", {
      name: /Ver detalle completo/i,
    });
    expect(desplegables).toHaveLength(2);
    await user.click(desplegables[0]);
    expect(within(region).getAllByText(/Calle 1, casa 2/).length).toBeGreaterThan(0);

    // AUSENCIA (R1): ni acción por-orden, ni acción en lote, ni ninguna otra vía.
    expect(within(region).queryByRole("button", { name: "Aceptar" })).toBeNull();
    expect(within(region).queryByRole("button", { name: /todas/i })).toBeNull();
    expect(within(region).queryByRole("button", { name: /asignar|gestionar/i })).toBeNull();
  });

  it("R5: la tarjeta no monta pie de acciones (y sí el desplegable de detalle)", () => {
    renderModule({ porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })] });
    const region = screen.getByRole("region", { name: REGION });

    // POSITIVO: hay exactamente UN control en la tarjeta, y es el del detalle.
    const botones = within(region).getAllByRole("button");
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveAccessibleName(/Ver detalle completo/i);
  });

  it("R2: el banner cuenta las órdenes por recibir", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
        makeOrden({ id: "r3", numRemision: "REM-R3" }),
      ],
    });
    const region = screen.getByRole("region", { name: REGION });
    expect(
      within(region).getByText("3 Órdenes nuevas por recibir"),
    ).toBeInTheDocument();
  });

  // Heredados de `RecepcionSateliteModule.test.tsx` (feature 160, R18/R25 y R19): el dato
  // de intentos de entrega en las CARDS. La columna del listado sigue afirmada allí.
  it("R18/R25: la tarjeta muestra los intentos de entrega etiquetados como un campo más", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "p1", numRemision: "REM-P1", intentosEntrega: 2 })],
    });
    const region = screen.getByRole("region", { name: REGION });
    const etiqueta = within(region).getByText("Intentos");
    expect(etiqueta.tagName).toBe("DT");
    expect(etiqueta.parentElement?.querySelector("dd")?.textContent).toBe("2");
  });

  it("R19: con 0 intentos LO MUESTRA igual", () => {
    renderModule({
      porRecibir: [makeOrden({ id: "p1", numRemision: "REM-P0", intentosEntrega: 0 })],
    });
    const region = screen.getByRole("region", { name: REGION });
    expect(
      within(region).getByText("Intentos").parentElement?.querySelector("dd")
        ?.textContent,
    ).toBe("0");
  });
});

describe("PorRecibirModule — el escáner", () => {
  it("R6: con zona ofrece los dos caminos, cámara y número de guía tecleado", async () => {
    const user = userEvent.setup();
    renderModule({ porRecibir: [makeOrden({ id: "r1" })] });

    // La tarjeta arranca plegada (la cámara no se enciende sola).
    await user.click(screen.getByRole("button", { name: ABRIR_ESCANER }));
    const region = screen.getByRole("region", {
      name: "Recibir por número de guía o escaneo",
    });
    expect(
      within(region).getByRole("button", { name: "Escanear con cámara" }),
    ).toBeInTheDocument();
    expect(within(region).getByRole("textbox")).toBeInTheDocument();
  });

  // R28/R42 — EL CASO QUE EL HUMANO FIRMÓ. Hasta el 2026-08-24 la pantalla escondía el
  // escáner justo cuando la lista estaba vacía, que es exactamente cuando el actor tiene
  // el paquete en la mano y la orden todavía no se registró. Es el mismo fallo que la
  // feature 167 documentó con la recolección del mensajero.
  it("R28/R42: con zona y la lista VACÍA se dice el vacío Y el escáner sigue ofreciéndose", () => {
    renderModule({ porRecibir: [] });

    // POSITIVO: la región está y dice que no hay nada.
    const region = screen.getByRole("region", { name: REGION });
    expect(within(region).getByText("No hay órdenes por recibir.")).toBeInTheDocument();
    // Sin órdenes no hay banner de contador.
    expect(within(region).queryByRole("status")).toBeNull();

    // Y LA HERRAMIENTA SIGUE AHÍ.
    expect(accesoReceptor()).not.toBeNull();
  });

  it("R26/R43: sin zona sólo el aviso — ni escáner ni tarjetas", () => {
    renderModule({
      sinZona: true,
      zonaNombre: null,
      porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })],
    });

    // POSITIVO: el aviso está, con el MISMO texto que la otra pantalla (afirmado contra
    // el literal exportado, no contra una copia a mano).
    expect(screen.getByRole("alert")).toHaveTextContent(AVISO_SIN_ZONA_SATELITE);

    // AUSENCIA: ni el escáner ni la lista, aunque la lista traiga órdenes.
    expect(accesoReceptor()).toBeNull();
    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    expect(screen.queryByText(/REM-R1/)).toBeNull();
  });

  it("R21: tras recibir por guía se relee del servidor", async () => {
    const user = userEvent.setup();
    recibirPorQrMock.mockResolvedValue({ status: "ok", ordenId: "r1" });
    renderModule({ porRecibir: [makeOrden({ id: "r1", numRemision: "REM-R1" })] });

    await user.click(screen.getByRole("button", { name: ABRIR_ESCANER }));
    const modal = await screen.findByRole("dialog");
    await user.type(within(modal).getByRole("textbox"), "1001");
    await user.click(within(modal).getByRole("button", { name: "Recibir" }));

    // POSITIVO: la acción se invocó con la guía tecleada — no se está midiendo un no-op.
    await waitFor(() =>
      expect(recibirPorQrMock).toHaveBeenCalledWith({ numGuia: 1001 }),
    );
    // Y la relectura del Server Component, que es lo que hace desaparecer la orden.
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});

describe("PorRecibirModule — lo que esta pantalla NO monta", () => {
  it("R16/R24: no monta listado, filtros, paginación, acciones de lote ni los avisos de bodega", () => {
    renderModule({
      porRecibir: [
        makeOrden({ id: "r1", numRemision: "REM-R1" }),
        makeOrden({ id: "r2", numRemision: "REM-R2" }),
      ],
    });

    // POSITIVO: la región «Por recibir» SÍ está, con sus dos tarjetas. Sin esto, las
    // nueve ausencias de abajo pasarían igual con la pantalla en blanco.
    const region = screen.getByRole("region", { name: REGION });
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);

    // El listado de la bodega y todo su aparato.
    expect(screen.queryByRole("region", { name: "Órdenes de la bodega" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Filtros/ })).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: /Paginación de las órdenes de la bodega/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /asignar|enviar a central|recuperar/i })).toBeNull();

    // Los tres avisos de bodega y el manifiesto, que son de «En bodega» (R24).
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).not.toBeNull(); // el banner del contador SÍ es de aquí
    expect(screen.queryByText(/Liberadas hoy/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Descargar manifiesto/i }),
    ).toBeNull();

    // Y ningún modal de lote.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
