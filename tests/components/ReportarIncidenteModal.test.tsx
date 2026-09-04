// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ReportarIncidenteModal,
  REPORTAR_INCIDENTE_CONFIRMAR,
  EVIDENCIAS_AYUDA,
  FALTA_CAUSA,
  FALTA_MOTIVO,
  FALTA_EVIDENCIA,
} from "@/app/(app)/ordenes/_components/ReportarIncidenteModal";
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { reportarIncidente } from "@/lib/actions/incidentes";

// Feature 158 (T2.7 — R41/R45/R46, camino del ADMIN) — el modal POR ORDEN de "Reportar
// incidente" del módulo de órdenes (Q-H). Se prueba AISLADO (la Server Action, el toast y SWR
// se mockean) para afirmar la UI y el FormData sin DB ni sesión.
//
// Lo que este archivo protege y NINGÚN test de backend puede proteger:
//   - que sin causa, sin motivo o sin al menos una foto el envío NO llega a la action (R45/R46);
//   - que la foto se exige en las TRES causas, incluidas `perdido` y `robado` (Q-B), y que el
//     copy dice QUÉ fotografiar cuando no hay paquete: la decisión del humano tiene un coste
//     y la UI no puede disimularlo con un "campo requerido" seco;
//   - que el envío válido llama a la action con la forma esperada (values del enum, no
//     etiquetas; una entrada `evidencia` por foto);
//   - que la causa se pinta traducida y sale del MISMO catálogo que el panel del mensajero.
vi.mock("@/lib/actions/incidentes", () => ({
  reportarIncidente: vi.fn(),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const reportarMock = vi.mocked(reportarIncidente);

// `reportarIncidenteSchema` exige uuid en `ordenId` (casa el `@default(uuid())` de `orden`),
// así que el fixture usa uno REAL: con un id inventado el camino feliz no sería alcanzable.
const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const ORDEN = {
  id: ORDEN_ID,
  numRemision: "REM-001",
  numGuia: 1001,
  zonaNombre: "GAM",
};

const LABEL_FOTOS = "Fotos de evidencia";
const GRUPO_CAUSA = "Causa del incidente";

function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

function montar(onSuccess = vi.fn()) {
  render(
    <ReportarIncidenteModal
      open
      orden={ORDEN}
      onOpenChange={vi.fn()}
      onSuccess={onSuccess}
    />,
  );
  return onSuccess;
}

async function rellenar(
  user: ReturnType<typeof userEvent.setup>,
  opts: { causa?: string; motivo?: string; fotos?: number } = {},
) {
  if (opts.causa) {
    await user.click(screen.getByRole("radio", { name: opts.causa }));
  }
  if (opts.fotos) {
    await user.upload(
      screen.getByLabelText(LABEL_FOTOS),
      Array.from({ length: opts.fotos }, (_, i) => foto(`f${i}.jpg`)),
    );
    await vi.waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" }),
        ).getAllByRole("img"),
      ).toHaveLength(opts.fotos as number),
    );
  }
  if (opts.motivo !== undefined) {
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: opts.motivo } });
  }
}

function confirmar() {
  return screen.getByRole("button", { name: REPORTAR_INCIDENTE_CONFIRMAR });
}

beforeEach(() => {
  vi.clearAllMocks();
  reportarMock.mockResolvedValue({ status: "ok", incidenteId: "i1" });
});
afterEach(cleanup);

describe("Feature 158 (T2.7) — R45: la causa es la MISMA lista CERRADA de tres, traducida", () => {
  it("ofrece exactamente las 3 causas del SEED, con su etiqueta acentuada", () => {
    montar();
    const grupo = screen.getByRole("radiogroup", { name: GRUPO_CAUSA });
    const radios = within(grupo).getAllByRole("radio");
    expect(radios).toHaveLength(CAUSA_INCIDENTE_SEED.length);
    // El orden es el del SEED, no uno propio: la lista se deriva, no se teclea.
    radios.forEach((radio, i) => {
      expect(radio).toHaveAccessibleName(CAUSA_INCIDENTE_LABEL[CAUSA_INCIDENTE_SEED[i]]);
    });
  });

  it("NUNCA pinta el slug crudo del enum (`danado` se lee «Paquete dañado»)", () => {
    montar();
    const grupo = screen.getByRole("radiogroup", { name: GRUPO_CAUSA });
    expect(within(grupo).getByText(CAUSA_INCIDENTE_LABEL.danado)).toBeInTheDocument();
    expect(within(grupo).queryByText("danado")).toBeNull();
  });

  it("las etiquetas salen del MISMO catálogo que usa el panel del mensajero (no una copia)", () => {
    // Estructural: si alguien duplicara las cadenas aquí, cambiar el catálogo dejaría a las
    // dos pantallas llamando distinto a la misma causa y este caso no lo notaría. Lo que se
    // fija es que lo pintado ES el valor del catálogo compartido, sea cual sea.
    montar();
    for (const causa of CAUSA_INCIDENTE_SEED) {
      expect(
        screen.getByRole("radio", { name: CAUSA_INCIDENTE_LABEL[causa] }),
      ).toBeInTheDocument();
    }
  });
});

describe("Feature 158 (T2.7) — R45/R46: no deja enviar sin causa, sin motivo o sin foto", () => {
  it("con el formulario vacío el confirmar está deshabilitado y dice QUÉ falta", () => {
    montar();
    expect(confirmar()).toBeDisabled();
    const nota = screen.getByText(new RegExp(FALTA_CAUSA));
    expect(nota).toHaveTextContent(FALTA_MOTIVO);
    expect(nota).toHaveTextContent(FALTA_EVIDENCIA);
  });

  it("sin CAUSA no llama a la action (con motivo y foto completos)", async () => {
    const user = userEvent.setup();
    montar();
    await rellenar(user, { motivo: "Caja aplastada en bodega", fotos: 1 });
    expect(confirmar()).toBeDisabled();
    await user.click(confirmar());
    expect(reportarMock).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(FALTA_CAUSA))).toBeInTheDocument();
  });

  it("sin MOTIVO no llama a la action (con causa y foto completos)", async () => {
    const user = userEvent.setup();
    montar();
    await rellenar(user, { causa: CAUSA_INCIDENTE_LABEL.danado, fotos: 1 });
    expect(confirmar()).toBeDisabled();
    await user.click(confirmar());
    expect(reportarMock).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(FALTA_MOTIVO))).toBeInTheDocument();
  });

  it("un motivo de sólo espacios NO cuenta como motivo", async () => {
    const user = userEvent.setup();
    montar();
    await rellenar(user, { causa: CAUSA_INCIDENTE_LABEL.danado, motivo: "   ", fotos: 1 });
    expect(confirmar()).toBeDisabled();
    await user.click(confirmar());
    expect(reportarMock).not.toHaveBeenCalled();
  });

  // Q-B: la foto es obligatoria en las TRES causas, también donde NO hay paquete. Es la
  // decisión del humano que más duele y la que un `it.each` deja fijada de una vez.
  it.each(CAUSA_INCIDENTE_SEED)(
    "R46 (Q-B): con causa «%s» y motivo, pero SIN foto, no llama a la action",
    async (causa) => {
      const user = userEvent.setup();
      montar();
      await rellenar(user, {
        causa: CAUSA_INCIDENTE_LABEL[causa],
        motivo: "El paquete no está",
      });
      expect(confirmar()).toBeDisabled();
      await user.click(confirmar());
      expect(reportarMock).not.toHaveBeenCalled();
      expect(screen.getByText(new RegExp(FALTA_EVIDENCIA))).toBeInTheDocument();
    },
  );

  it("R46 (Q-B): el copy de la foto dice QUÉ fotografiar cuando NO hay paquete", () => {
    montar();
    const ayuda = screen.getByText(EVIDENCIAS_AYUDA);
    expect(ayuda).toBeInTheDocument();
    // No basta con «es obligatoria»: tiene que nombrar alternativas CONCRETAS de bodega.
    expect(ayuda.textContent).toMatch(/perdi|robar/i);
    expect(ayuda.textContent).toMatch(/guía|etiqueta/i);
    expect(ayuda.textContent).toMatch(/bodega|estante|ubicación/i);
    expect(ayuda.textContent).toMatch(/denuncia/i);
  });
});

describe("Feature 158 (T2.7) — R41/R45/R46: el envío válido llama a la action con la forma esperada", () => {
  it("manda ordenId, causa (VALUE del enum, no la etiqueta), motivo y una entrada por foto", async () => {
    const user = userEvent.setup();
    const onSuccess = montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.robado,
      motivo: "Faltante detectado en el conteo",
      fotos: 2,
    });
    expect(confirmar()).toBeEnabled();
    await user.click(confirmar());

    await vi.waitFor(() => expect(reportarMock).toHaveBeenCalledTimes(1));
    const fd = reportarMock.mock.calls[0][0] as FormData;
    expect(fd.get("ordenId")).toBe(ORDEN_ID);
    expect(fd.get("causa")).toBe("robado"); // el VALUE, nunca «Paquete robado»
    expect(fd.get("motivo")).toBe("Faltante detectado en el conteo");
    expect(fd.getAll("evidencia")).toHaveLength(2);
    // NO viaja monto: quien reporta no tarifa (R50/R51), y que el campo no exista es la
    // primera línea de esa separación (misma decisión que el schema del borde).
    expect(fd.get("monto")).toBeNull();
    expect(fd.get("indemnizacion")).toBeNull();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("el motivo viaja RECORTADO, no re-escrito", async () => {
    const user = userEvent.setup();
    montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.perdido,
      motivo: "  se perdió en tránsito  ",
      fotos: 1,
    });
    await user.click(confirmar());
    await vi.waitFor(() => expect(reportarMock).toHaveBeenCalledTimes(1));
    const fd = reportarMock.mock.calls[0][0] as FormData;
    expect(fd.get("motivo")).toBe("se perdió en tránsito");
  });

  it("una sola foto basta (1..N, no exactamente N)", async () => {
    const user = userEvent.setup();
    montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.danado,
      motivo: "Caja rota",
      fotos: 1,
    });
    expect(confirmar()).toBeEnabled();
    await user.click(confirmar());
    await vi.waitFor(() => expect(reportarMock).toHaveBeenCalledTimes(1));
    expect((reportarMock.mock.calls[0][0] as FormData).getAll("evidencia")).toHaveLength(1);
  });
});

describe("Feature 158 (T2.7) — el resultado de dominio del servidor llega al usuario", () => {
  it("un `conflict` muestra el motivo REAL del servidor y NO cierra en éxito", async () => {
    const user = userEvent.setup();
    reportarMock.mockResolvedValue({
      status: "conflict",
      motivo: "Esta orden ya tiene un incidente en curso.",
    });
    const onSuccess = montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.danado,
      motivo: "Caja rota",
      fotos: 1,
    });
    await user.click(confirmar());
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Esta orden ya tiene un incidente en curso."),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("un `validation_error` del servidor se pinta POR CAMPO", async () => {
    const user = userEvent.setup();
    reportarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { motivo: ["motivo requerido"] },
    });
    montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.danado,
      motivo: "Caja rota",
      fotos: 1,
    });
    await user.click(confirmar());
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("motivo requerido"),
    );
  });

  it("un `forbidden` NO se disfraza de éxito", async () => {
    const user = userEvent.setup();
    reportarMock.mockResolvedValue({ status: "forbidden" });
    const onSuccess = montar();
    await rellenar(user, {
      causa: CAUSA_INCIDENTE_LABEL.danado,
      motivo: "Caja rota",
      fotos: 1,
    });
    await user.click(confirmar());
    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });
});

// El aviso de la foto que NO entró, visto por el usuario en una superficie real (el helper que
// decide está probado aparte, en `EvidenciasField.test.tsx`). Aquí `comprimirImagen` NO se
// mockea: en jsdom no hay canvas, así que devuelve el original — el peor caso honesto y justo el
// que produce estos rechazos.
describe("una foto que no vale se dice AL ELEGIRLA y con su nombre", () => {
  it("⭑ una foto de más de 5 MB no entra en la lista y el aviso la nombra", async () => {
    const user = userEvent.setup();
    montar();

    const enorme = new File(["x"], "IMG_9001.jpg", { type: "image/jpeg" });
    Object.defineProperty(enorme, "size", { value: 6 * 1024 * 1024, configurable: true });
    await user.upload(screen.getByLabelText(LABEL_FOTOS), enorme);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No se adjuntó «IMG_9001.jpg»: supera los 5 MB.");
    // Y no se quedó a medias: la foto NO está en la lista (no hay previsualización).
    expect(
      screen.queryByRole("list", { name: "Fotos de evidencia seleccionadas" }),
    ).toBeNull();
    // Sigue faltando la foto para poder enviar: el bloqueo no se disimula.
    expect(confirmar()).toBeDisabled();
  });

  it("un HEIC que no se pudo convertir se nombra igual, sin hablar de MIME", async () => {
    montar();

    // Se entrega saltando el `accept` a propósito, como hace el test del chat (316): `accept` es
    // una SUGERENCIA para el selector del sistema —en Android se puede elegir «cualquier
    // archivo», y la cámara de un iPhone entrega lo que entrega—, así que la lista blanca se
    // aplica en el código y no en el atributo.
    const input = screen.getByLabelText(LABEL_FOTOS) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "IMG_0045.heic", { type: "image/heic" })],
      configurable: true,
    });
    fireEvent.change(input);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No se adjuntó «IMG_0045.heic»: debe ser JPEG, PNG o WEBP.");
  });
});

describe("Feature 158 (T2.7) — la consecuencia se dice ANTES de confirmar", () => {
  it("advierte que la orden sale del flujo y que otro administrador decide", () => {
    montar();
    const nota = screen.getAllByRole("note")[0];
    expect(nota.textContent).toMatch(/incidente/i);
    expect(nota.textContent).toMatch(/no se podrá asignar|saldrá del flujo/i);
    // R51 hecho visible desde el propio reporte: quien reporta no aprueba.
    expect(nota.textContent).toMatch(/otro administrador/i);
  });
});
