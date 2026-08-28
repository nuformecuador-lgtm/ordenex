// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Feature 295 — LA MITAD DE PANTALLA: la fecha de creacion en los dos sitios que
// enseñan la etiqueta SIN imprimirla.
//
// Que se afirma aqui y por que ningun otro test lo veria:
//
//  · La fecha SE PINTA en la vista previa del modal y en `/paquete/<numGuia>`.
//    Los tests que dejo el backend leen los bytes del PDF: si la pantalla no la
//    pintara, seguirian todos en verde y el defecto original —"quien recibe el
//    paquete no sabe de cuando es"— quedaria a medio cerrar.
//  · Va EN LA CABECERA, con los numeros, no al final de la lista de campos. Eso
//    no es estetica: el PDF la dibuja centrada entre "GUÍA" y "REMISIÓN"
//    (`drawFechaCabecera`) y la previa existe para decidir si imprimir. Si las
//    dos no se parecen, la previa deja de servir para lo unico que sirve.
//  · Se pinta LA CADENA DEL SERVIDOR, sin reformatear. `fechaCreacion` ya viene
//    resuelta como fecha de calendario de Costa Rica; el navegador que abre
//    estas pantallas (el del mensajero, el del cliente que escanea el QR) puede
//    estar en cualquier zona horaria, y un `new Date(...).toLocaleDateString()`
//    en el cliente interpretaria la cadena como medianoche UTC y podria mostrar
//    EL DIA ANTERIOR. Es el mismo error que el backend evito no usando
//    `toISOString()`, un paso mas adelante en el camino.
//  · Y el cruce final: la cadena de la previa es LA MISMA que la que acaba
//    dentro del PDF, leida de sus bytes. No dos aserciones independientes que
//    podrian derivar.

// Stubs de QR/codigo de barras: jsdom no rasteriza canvas.
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr-stub" />,
}));
vi.mock("react-barcode", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="barcode-stub" data-value={value} />
  ),
}));
// El generador del PDF rasteriza el codigo de barras con jsbarcode sobre un
// canvas real, que jsdom no tiene (`getContext` -> null). Se dobla igual que en
// `EtiquetaGuiaPreview.test.tsx`: lo que aqui se mide es TEXTO del PDF, no
// pixeles.
vi.mock("jsbarcode", () => ({ default: vi.fn() }));

/** PNG 1x1 valido para que jsPDF acepte el raster del codigo de barras. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// La pagina del paquete es un Server Component `async`: resuelve sesion y lee por
// Server Action. Se doblan sus dos bordes y se ejercita el `page.tsx` REAL.
class NotFoundError extends Error {}
class RedirectError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("notFound");
  },
  redirect: (destino: string) => {
    throw new RedirectError(destino);
  },
}));

const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const obtenerEtiquetaPorGuiaMock = vi.fn();
vi.mock("@/lib/actions/etiquetas-guia", () => ({
  obtenerEtiquetaPorGuia: (...a: unknown[]) => obtenerEtiquetaPorGuiaMock(...a),
}));

import { EtiquetaGuia } from "@/app/(app)/ordenes/_components/EtiquetaGuia";
import { buildEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { CASO_EVIDENCIA } from "../fixtures/etiquetas-282";
import {
  fuentesDePagina,
  textoLegible,
  textosDePagina,
} from "../unit/pdf/pdf-inspector";

/**
 * Fecha de trabajo. Se elige a proposito una en la que el error de zona horaria
 * SE VERIA: `new Date("2026-08-27")` es medianoche UTC, y formateada en la hora
 * de Costa Rica (UTC-6) cae en el 26. Los dos vecinos se nombran para poder
 * afirmar que NO se muestran.
 */
const FECHA = "2026-08-27";
const DIA_ANTERIOR = "2026-08-26";
const DIA_SIGUIENTE = "2026-08-28";

function makeEtiqueta(overrides: Partial<EtiquetaGuiaDTO> = {}): EtiquetaGuiaDTO {
  return {
    ordenId: "orden-uuid-295",
    numGuia: 4021,
    numRemision: "REM-777",
    destinatario: "María Solís",
    telefonoDest: "0999888777",
    direccion: "100m sur de la iglesia",
    producto: "Caja de zapatos",
    montoCobrar: 12345.5,
    tiendaNombre: "Tienda Central",
    zonaNombre: "Zona A",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    fechaCreacion: FECHA,
    qrValue: "4021",
    barcodeValue: "4021",
    ...overrides,
  };
}

async function renderPaquete(etiqueta: EtiquetaGuiaDTO) {
  resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
  obtenerEtiquetaPorGuiaMock.mockResolvedValue({ status: "ok", etiqueta });
  const { default: PaquetePage } = await import("@/app/paquete/[numGuia]/page");
  return render(
    await PaquetePage({
      params: Promise.resolve({ numGuia: String(etiqueta.numGuia) }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG_1X1);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// La vista previa del modal de etiquetas
// ---------------------------------------------------------------------------

describe("Feature 295 — la vista previa pinta la fecha de creacion", () => {
  it("la muestra en la CABECERA, junto a la guia y la remision", () => {
    const etiqueta = makeEtiqueta();
    const { container } = render(<EtiquetaGuia etiqueta={etiqueta} />);

    const fecha = screen.getByTestId("etiqueta-fecha");
    expect(fecha).toHaveTextContent(FECHA);
    expect(screen.getByText("Fecha")).toBeInTheDocument();

    // DONDE, que es media feature: en la misma fila que los dos numeros. Con
    // controles positivos —la guia y la remision— para que "esta en la cabecera"
    // no pueda cumplirse por una cabecera vacia.
    const cabecera = container.querySelector("header");
    expect(cabecera).not.toBeNull();
    expect(cabecera).toContainElement(fecha);
    expect(cabecera).toHaveTextContent(String(etiqueta.numGuia));
    expect(cabecera).toHaveTextContent(etiqueta.numRemision);

    // Y NO como un campo mas del bloque de abajo, que es donde se pondria de
    // primeras y donde el PDF no la lleva.
    const campos = container.querySelector("dl");
    expect(campos?.textContent ?? "").not.toContain(FECHA);
  });

  it("pinta la cadena del servidor TAL CUAL: no la reformatea en el navegador", () => {
    render(<EtiquetaGuia etiqueta={makeEtiqueta()} />);

    const texto = screen.getByTestId("etiqueta-fecha").textContent ?? "";
    // Igualdad exacta contra el dato del DTO: cualquier `toLocaleDateString`,
    // `split("-").reverse()` o `Intl.DateTimeFormat` intermedio rompe aqui.
    expect(texto.trim()).toBe(FECHA);
    // Y nombrando el fallo concreto que se teme: derivarla en un navegador que
    // no esta en Costa Rica da uno de los dos dias vecinos.
    expect(texto).not.toContain(DIA_ANTERIOR);
    expect(texto).not.toContain(DIA_SIGUIENTE);
  });
});

// ---------------------------------------------------------------------------
// La pagina publica del paquete (destino del QR)
// ---------------------------------------------------------------------------

describe("Feature 295 — /paquete/<numGuia> pinta la fecha de creacion", () => {
  it("la muestra en la cabecera de la ficha, no al final de la lista", async () => {
    const etiqueta = makeEtiqueta();
    const { container } = await renderPaquete(etiqueta);

    expect(screen.getByText(FECHA)).toBeInTheDocument();
    expect(screen.getByText("Fecha")).toBeInTheDocument();

    // La cabecera de la ficha es el primer bloque de la tarjeta, el que lleva los
    // dos numeros; la lista de campos va debajo. Se afirma que la fecha esta en
    // el primero y NO en la segunda: al final del todo quedaria fuera de pantalla
    // en un movil, que es justo el dispositivo que escanea el QR.
    const cabecera = container.querySelector("section > div");
    expect(cabecera).not.toBeNull();
    expect(cabecera).toHaveTextContent(FECHA);
    expect(cabecera).toHaveTextContent(String(etiqueta.numGuia));
    expect(cabecera).toHaveTextContent(etiqueta.numRemision);

    const campos = container.querySelector("dl");
    expect(campos?.textContent ?? "", "control positivo: la lista existe").toContain(
      etiqueta.destinatario,
    );
    expect(campos?.textContent ?? "").not.toContain(FECHA);
  });

  it("pinta la cadena del servidor TAL CUAL: no la reformatea en el navegador", async () => {
    await renderPaquete(makeEtiqueta());

    // `getByText` con string exige coincidencia EXACTA del texto normalizado del
    // nodo: si la pagina mostrara "27/8/2026" o el dia vecino, esto no encuentra
    // nada. Los dos `queryByText` de abajo fijan cual es el fallo temido.
    expect(screen.getByText(FECHA)).toBeInTheDocument();
    expect(screen.queryByText(DIA_ANTERIOR)).toBeNull();
    expect(screen.queryByText(DIA_SIGUIENTE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El cruce: previa y papel dicen lo mismo
// ---------------------------------------------------------------------------

describe("Feature 295 — la previa y el PDF muestran LA MISMA fecha", () => {
  it("la cadena de la vista previa aparece igual dentro de los bytes del PDF", () => {
    const dto = CASO_EVIDENCIA.dto;

    // (1) Pantalla: lo que el usuario lee antes de mandar a imprimir.
    render(<EtiquetaGuia etiqueta={dto} />);
    const enPantalla = (
      screen.getByTestId("etiqueta-fecha").textContent ?? ""
    ).trim();

    // (2) Papel: lo que produce el generador de verdad, leido de sus bytes.
    const doc = buildEtiquetasPdf(
      [dto],
      new Map(),
      getHojaEtiqueta("100x100"),
      fuenteEtiqueta,
    );
    const u8 = new Uint8Array(Buffer.from(doc.output("arraybuffer")));
    const fuentes = fuentesDePagina(u8);
    const enPapel = textosDePagina(u8).map((t) =>
      textoLegible(t, fuentes.get(t.fuenteRes)),
    );

    // (3) El cruce, con la fuente comun como ancla para que no sea una
    // tautologia entre dos derivados del mismo bug.
    expect(enPantalla).toBe(dto.fechaCreacion);
    expect(enPapel).toContain(dto.fechaCreacion);
    expect(enPapel).toContain(enPantalla);
    // Control positivo de que se esta leyendo la fila de la fecha y no cualquier
    // texto suelto: el rotulo tambien esta en el PDF.
    expect(enPapel).toContain("FECHA");
  });
});
