// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  IncidentesAdminModule,
  R51_MOTIVO,
  RETRACTAR_CONFIRMAR,
  RETRACTAR_TITULO,
} from "@/app/(app)/incidentes/_components/IncidentesAdminModule";
import {
  verIncidente,
  aprobarIncidente,
  rechazarIncidente,
  retractarIncidente,
} from "@/lib/actions/incidentes";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";

// Feature 158 (T2.9 — R51) — **QUIEN REPORTA NO APRUEBA, también en la interfaz.**
//
// La guardia REAL vive en el servidor y tiene sus cinco casos
// (`tests/unit/services/incidente-admin-service.test.ts` › bloque «R51 — QUIEN REPORTA NO
// APRUEBA»). Este archivo cubre la OTRA mitad, que el diseño pide explícitamente: que la UI
// **no invite** a algo que la transacción va a negar, y que diga POR QUÉ en vez de dejar un
// botón apagado sin explicación.
//
// El dato con el que se decide es `esPropio`, calculado EN EL SERVIDOR (el DTO no expone el id
// del autor): la UI no compara identificadores, así que no puede equivocarse comparando mal.
vi.mock("@/lib/actions/incidentes", () => ({
  verIncidente: vi.fn(),
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  listarIncidentes: vi.fn(),
  reportarIncidente: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const verMock = vi.mocked(verIncidente);
const aprobarMock = vi.mocked(aprobarIncidente);
const rechazarMock = vi.mocked(rechazarIncidente);
const retractarMock = vi.mocked(retractarIncidente);

function incidente(esPropio: boolean): IncidenteAdminDTO {
  return {
    incidenteId: "i1",
    ordenId: "o1",
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    zonaNombre: "GAM",
    estatusValue: "incidente",
    causa: "robado",
    motivo: "Faltante en el conteo",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPorNombre: "Ana Admin",
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-30T10:00:00.000Z",
    evidenciaUrls: [],
    esPropio,
  };
}

async function abrir(esPropio: boolean) {
  const user = userEvent.setup();
  const i = incidente(esPropio);
  verMock.mockResolvedValue({ status: "ok", incidente: i });
  render(<IncidentesAdminModule pendientes={[i]} historico={[]} sinZona={false} />);
  await user.click(
    screen.getByRole("button", { name: "Ver o decidir el incidente de la orden REM-001" }),
  );
  await screen.findByText("Detalle del incidente");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  retractarMock.mockResolvedValue({
    status: "ok",
    incidenteId: "i1",
    estado: "rechazado",
  });
});
afterEach(cleanup);

describe("Feature 158 (T2.9) — R51: en un incidente PROPIO no se ofrece la decisión", () => {
  it("«Aprobar» está DESHABILITADO", async () => {
    await abrir(true);
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled();
  });

  it("«Rechazar» está DESHABILITADO (la regla cubre las DOS decisiones, no sólo el dinero)", async () => {
    await abrir(true);
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
  });

  it("el MOTIVO es visible: no es un botón apagado sin explicación", async () => {
    await abrir(true);
    const nota = screen.getByText(R51_MOTIVO);
    expect(nota).toBeInTheDocument();
    // El texto tiene que decir la regla, no un genérico «no permitido».
    expect(nota.textContent).toMatch(/reportaste vos/i);
    expect(nota.textContent).toMatch(/otro administrador/i);
  });

  it("hacer click en «Aprobar» NO abre la captura del monto ni llama a la action", async () => {
    const user = await abrir(true);
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(screen.queryByLabelText("Monto de la indemnización")).toBeNull();
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it("hacer click en «Rechazar» NO abre el motivo ni llama a la action", async () => {
    const user = await abrir(true);
    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(screen.queryByLabelText("Motivo del rechazo")).toBeNull();
    expect(rechazarMock).not.toHaveBeenCalled();
  });
});

describe("Feature 158 (T2.9) — R51: el caso de CONTROL, para que el bloqueo no pase por casualidad", () => {
  it("en un incidente AJENO las dos decisiones SÍ se ofrecen", async () => {
    await abrir(false);
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeEnabled();
  });

  it("en un incidente AJENO el motivo de R51 NO aparece (no se avisa de lo que no pasa)", async () => {
    await abrir(false);
    expect(screen.queryByText(R51_MOTIVO)).toBeNull();
  });

  it("en un incidente AJENO no se ofrece retractar: eso es del AUTOR (R59)", async () => {
    await abrir(false);
    expect(screen.queryByRole("button", { name: RETRACTAR_CONFIRMAR })).toBeNull();
  });
});

describe("Feature 158 (T2.9/R59) — la salida del autor SÍ existe: retractar", () => {
  it("en un incidente PROPIO se ofrece «Retractar reporte»", async () => {
    await abrir(true);
    expect(screen.getByRole("button", { name: RETRACTAR_CONFIRMAR })).toBeEnabled();
  });

  it("el retracto avisa de su efecto y llama a la action SIN motivo (no es un rechazo)", async () => {
    const user = await abrir(true);
    await user.click(screen.getByRole("button", { name: RETRACTAR_CONFIRMAR }));
    expect(await screen.findByText(RETRACTAR_TITULO)).toBeInTheDocument();
    // El sub-modal repite el rótulo en su confirmar; se pulsa el ÚLTIMO (el del sub-modal).
    const botones = screen.getAllByRole("button", { name: RETRACTAR_CONFIRMAR });
    await user.click(botones[botones.length - 1]);
    await vi.waitFor(() => expect(retractarMock).toHaveBeenCalledTimes(1));
    expect(retractarMock).toHaveBeenCalledWith({ incidenteId: "i1" });
    expect(Object.keys(retractarMock.mock.calls[0][0] as object)).toEqual(["incidenteId"]);
    expect(rechazarMock).not.toHaveBeenCalled();
  });
});

describe("Feature 158 (T2.9) — el servidor sigue siendo la guardia real", () => {
  it("un `conflict` de R51 llegado del servidor se muestra con SU mensaje", async () => {
    // Aunque la UI no lo ofrezca, la regla se comprueba de nuevo en el servidor (dos
    // pestañas, un reintento, una llamada directa). Si vuelve, el mensaje del servidor
    // llega tal cual: es el que explica la regla del doble control.
    const user = await abrir(false); // la UI lo ofrece…
    aprobarMock.mockResolvedValue({
      status: "conflict",
      motivo: "No podés resolver un incidente que vos mismo reportaste.",
    });
    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    const input = await screen.findByLabelText("Monto de la indemnización");
    await user.type(input, "12500.00");
    await user.click(screen.getByRole("button", { name: "Aprobar e indemnizar" }));
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "No podés resolver un incidente que vos mismo reportaste.",
      ),
    );
    expect(successMock).not.toHaveBeenCalled();
  });
});
