// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mocks de las dependencias server-side de app/postulacion/page.tsx. El page.tsx
// (Server Component real) se importa sin mockear: se ejercita su carga real de
// catalogos (R1). La pagina es PUBLICA: no lee cookies ni sesion (R22).
const findManyVehiculosMock = vi.fn();
vi.mock("@/lib/repositories/VehiculoRepository", () => ({
  VehiculoRepository: vi.fn().mockImplementation(function VehiculoRepositoryMock(this: {
    findMany: typeof findManyVehiculosMock;
  }) {
    this.findMany = findManyVehiculosMock;
  }),
}));

const tipoFindManyMock = vi.fn();
vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({
    tipoIdentificacion: { findMany: tipoFindManyMock },
  })),
}));

// Aisla la pagina del formulario cliente con un stub que refleja las props.
vi.mock("@/app/postulacion/_components/PostulacionForm", () => ({
  PostulacionForm: (props: {
    tiposIdentificacion: { value: string; label: string }[];
    vehiculos: { value: string; label: string }[];
  }) => (
    <div
      data-testid="postulacion-form-stub"
      data-tipos={props.tiposIdentificacion.map((t) => t.label).join(",")}
      data-vehiculos={props.vehiculos.map((v) => v.label).join(",")}
    >
      form
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/postulacion/page.tsx — pagina publica (R1, R22)", () => {
  it("renderiza el formulario con los catalogos cargados, sin requerir sesion", async () => {
    findManyVehiculosMock.mockResolvedValue([
      { id: "veh-moto", name: "moto" },
      { id: "veh-carro", name: "carro" },
    ]);
    tipoFindManyMock.mockResolvedValue([
      { id: "tipo-cedula", value: "cedula" },
      { id: "tipo-ruc", value: "ruc" },
    ]);

    const { default: PostulacionPage } = await import("@/app/postulacion/page");
    const element = await PostulacionPage();
    render(element);

    const stub = screen.getByTestId("postulacion-form-stub");
    expect(stub).toBeInTheDocument();
    // Etiquetas de presentacion aplicadas a los valores crudos del catalogo.
    expect(stub).toHaveAttribute("data-tipos", "Cédula,RUC");
    expect(stub).toHaveAttribute("data-vehiculos", "Moto,Carro");
  });
});
