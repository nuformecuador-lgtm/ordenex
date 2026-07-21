// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InputRecoger } from "@/app/(app)/mis-asignaciones/_components/InputRecoger";
import { recogerAsignaciones } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 96 — Recoger por NÚMERO de guía (espejo de EscanerRecoger.test, pero por
// input de texto): al confirmar (Enter/botón) se resuelve el número tecleado contra la
// lista "por recoger" y se ACEPTA la orden con la MISMA action `recogerAsignaciones`,
// compartiendo la lógica del hook `useRecogerPorGuia` con el escáner. Se mockean la
// Server Action y el toast (sin DB ni sesión). A diferencia del escáner NO se parsea una
// URL: el texto tecleado ES el número, se compara directo contra `numGuia`.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  recogerAsignaciones: vi.fn(),
}));

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const recogerMock = vi.mocked(recogerAsignaciones);

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string; numGuia: number },
): MiAsignacionDTO {
  return {
    numRemision: "REM-001",
    estatusValue: "en_espera_aceptacion",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    ...over,
  };
}

const porRecoger = [
  makeAsignacion({ id: "ord-1", numGuia: 1001 }),
  makeAsignacion({ id: "ord-2", numGuia: 1002, numRemision: "REM-002" }),
];

/** Teclea el número de guía y confirma con Enter (submit del form). */
async function tecleaYConfirma(
  user: ReturnType<typeof userEvent.setup>,
  texto: string,
) {
  await user.type(screen.getByLabelText("Número de guía"), `${texto}{Enter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("InputRecoger (número de guía)", () => {
  it("al teclear una guía por recoger, recoge esa orden por su id (misma action)", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-2"] });
    render(<InputRecoger porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await tecleaYConfirma(user, "1002");

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("ok → toast de éxito (nombra la guía), dispara onRecogida y LIMPIA el input", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-1"] });
    render(<InputRecoger porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock.mock.calls[0][0]).toMatch(/1001/);
    expect(successMock.mock.calls[0][0]).not.toMatch(/ord-1/);
    expect(onRecogida).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(screen.getByLabelText("Número de guía")).toHaveValue(""),
    );
  });

  it("también recoge con el botón 'Recoger' (no solo con Enter)", async () => {
    const user = userEvent.setup();
    recogerMock.mockResolvedValue({ status: "ok", recogidas: ["ord-2"] });
    render(<InputRecoger porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await user.type(screen.getByLabelText("Número de guía"), "1002");
    await user.click(screen.getByRole("button", { name: "Recoger" }));

    await vi.waitFor(() =>
      expect(recogerMock).toHaveBeenCalledWith({ ordenIds: ["ord-2"] }),
    );
  });

  it("una guía que NO está entre las órdenes por recoger se rechaza en cliente, sin llamar a la action", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    render(<InputRecoger porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "9999");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/9999/);
    expect(recogerMock).not.toHaveBeenCalled();
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("robustez: input VACÍO no llama a la action (botón deshabilitado y Enter inerte)", async () => {
    const user = userEvent.setup();
    render(<InputRecoger porRecoger={porRecoger} onRecogida={vi.fn()} />);

    // Con el input vacío el botón está deshabilitado.
    expect(screen.getByRole("button", { name: "Recoger" })).toBeDisabled();
    // Y confirmar con Enter sobre el vacío no dispara nada.
    await user.type(screen.getByLabelText("Número de guía"), "{Enter}");
    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("robustez: entrada NO numérica no llama a la action", async () => {
    const user = userEvent.setup();
    render(<InputRecoger porRecoger={porRecoger} onRecogida={vi.fn()} />);

    await tecleaYConfirma(user, "abc");

    expect(recogerMock).not.toHaveBeenCalled();
  });

  it("conflict → toast de error, sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "conflict", detalle: [] });
    render(<InputRecoger porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(onRecogida).not.toHaveBeenCalled();
  });

  it("forbidden → toast de error 'sin permiso', sin onRecogida", async () => {
    const user = userEvent.setup();
    const onRecogida = vi.fn();
    recogerMock.mockResolvedValue({ status: "forbidden" });
    render(<InputRecoger porRecoger={porRecoger} onRecogida={onRecogida} />);

    await tecleaYConfirma(user, "1001");

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock.mock.calls[0][0]).toMatch(/permiso/i);
    expect(onRecogida).not.toHaveBeenCalled();
  });
});
