// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PostulacionCard } from "@/app/(app)/_components/PostulacionCard";
import type {
  DocumentoFirmadoDTO,
  PostulacionPendienteDTO,
} from "@/lib/types/aprobacion-postulacion";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeDocumentos(): DocumentoFirmadoDTO[] {
  return [
    { tipo: "foto_rostro", url: "https://signed/foto", expiresInSeconds: 300 },
    { tipo: "cedula_anverso", url: "https://signed/ced-a", expiresInSeconds: 300 },
    { tipo: "cedula_reverso", url: "https://signed/ced-r", expiresInSeconds: 300 },
    { tipo: "propiedad_anverso", url: "https://signed/mat-a", expiresInSeconds: 300 },
    { tipo: "propiedad_reverso", url: "https://signed/mat-r", expiresInSeconds: 300 },
  ];
}

function makePostulacion(
  overrides: Partial<PostulacionPendienteDTO> = {},
): PostulacionPendienteDTO {
  return {
    usuarioId: "u1",
    nombre: "Ana",
    primerApellido: "Pérez",
    segundoApellido: "Gómez",
    email: "ana@example.com",
    telefono: "0999999999",
    tipoIdentificacion: "cedula",
    cedula: "0102030405",
    vehiculo: "moto",
    placa: "ABC-1234",
    documentos: makeDocumentos(),
    ...overrides,
  };
}

describe("PostulacionCard (feature 23)", () => {
  it("R7: muestra nombre, apellidos, email, teléfono, tipo/nº doc, vehículo y placa", () => {
    render(
      <PostulacionCard
        postulacion={makePostulacion()}
        onAprobar={vi.fn()}
        onRechazar={vi.fn()}
      />,
    );

    expect(screen.getByText("Ana Pérez Gómez")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("0999999999")).toBeInTheDocument();
    expect(screen.getByText("cedula")).toBeInTheDocument();
    expect(screen.getByText("0102030405")).toBeInTheDocument();
    expect(screen.getByText("moto")).toBeInTheDocument();
    expect(screen.getByText("ABC-1234")).toBeInTheDocument();
  });

  it("R7: los campos nulos se muestran como guion sin romper el render", () => {
    render(
      <PostulacionCard
        postulacion={makePostulacion({
          primerApellido: null,
          segundoApellido: null,
          vehiculo: null,
          placa: null,
        })}
        onAprobar={vi.fn()}
        onRechazar={vi.fn()}
      />,
    );

    // nombre sin apellidos no rompe.
    expect(screen.getByText("Ana")).toBeInTheDocument();
    // vehiculo y placa nulos -> guion (—) en al menos dos celdas.
    const guiones = screen.getAllByText("—");
    expect(guiones.length).toBeGreaterThanOrEqual(2);
  });

  it("R8: muestra un enlace 'Ver' por cada uno de los 5 documentos con etiqueta, href firmado, target _blank y rel seguro, en orden fijo", () => {
    render(
      <PostulacionCard
        postulacion={makePostulacion()}
        onAprobar={vi.fn()}
        onRechazar={vi.fn()}
      />,
    );

    const enlaces = screen
      .getAllByRole("link")
      .filter((a) => /^Ver /.test(a.textContent ?? ""));
    expect(enlaces).toHaveLength(5);

    // Orden fijo por tipo (independiente del orden de entrada).
    expect(enlaces.map((a) => a.textContent)).toEqual([
      "Ver Cédula (anverso)",
      "Ver Cédula (reverso)",
      "Ver Matrícula (anverso)",
      "Ver Matrícula (reverso)",
      "Ver Foto de rostro",
    ]);

    const anverso = screen.getByRole("link", { name: "Ver Cédula (anverso)" });
    expect(anverso).toHaveAttribute("href", "https://signed/ced-a");
    expect(anverso).toHaveAttribute("target", "_blank");
    expect(anverso).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("R13: renderiza botones Aprobar y Rechazar y los cablea con la postulación", async () => {
    const user = userEvent.setup();
    const onAprobar = vi.fn();
    const onRechazar = vi.fn();
    const postulacion = makePostulacion();

    render(
      <PostulacionCard
        postulacion={postulacion}
        onAprobar={onAprobar}
        onRechazar={onRechazar}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aprobar" }));
    expect(onAprobar).toHaveBeenCalledWith(postulacion);

    await user.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(onRechazar).toHaveBeenCalledWith(postulacion);
  });

  it("R8: el card queda accesible con un nombre por postulación", () => {
    render(
      <PostulacionCard
        postulacion={makePostulacion()}
        onAprobar={vi.fn()}
        onRechazar={vi.fn()}
      />,
    );
    const card = screen.getByLabelText("Postulación de Ana Pérez Gómez");
    expect(within(card).getByText("ana@example.com")).toBeInTheDocument();
  });
});
