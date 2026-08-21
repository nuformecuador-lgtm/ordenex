// @vitest-environment jsdom
import type { ReactNode } from "react";
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

// El enlace de vuelta a la landing usa `next/link`; en jsdom se sustituye por
// un `<a>` equivalente, el mismo doble que usa
// tests/integration/login-form-reset-link.test.tsx.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * Ancestros del elemento (incluido él mismo) que llevan la clase `hidden`.
 *
 * El panel de marca de esta pantalla es `hidden ... md:flex`: un enlace metido
 * ahí no existiría en móvil, que es justo donde es la única salida. jsdom no
 * resuelve media queries, así que la forma honesta de fijar "está presente sin
 * depender del breakpoint" es comprobar que ni el enlace ni ninguno de sus
 * ancestros arrastra ese `hidden`.
 */
function ancestrosOcultos(el: HTMLElement): string[] {
  const ocultos: string[] = [];
  for (let nodo: HTMLElement | null = el; nodo !== null; nodo = nodo.parentElement) {
    if (nodo.classList.contains("hidden")) ocultos.push(nodo.className);
  }
  return ocultos;
}

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

describe("app/postulacion/page.tsx — salida a la landing", () => {
  it("ofrece un enlace accesible de vuelta cuyo href es exactamente / y que no depende del breakpoint", async () => {
    findManyVehiculosMock.mockResolvedValue([{ id: "veh-moto", name: "moto" }]);
    tipoFindManyMock.mockResolvedValue([{ id: "tipo-cedula", value: "cedula" }]);

    const { default: PostulacionPage } = await import("@/app/postulacion/page");
    const element = await PostulacionPage();
    render(element);

    // (a) existe la salida y lleva a la landing, no a "atrás" ni a otra ruta.
    const volver = screen.getByRole("link", { name: "Volver al inicio" });
    expect(volver).toHaveAttribute("href", "/");

    // (b) está en las dos anchuras: no vive bajo el `hidden md:flex` del panel de marca.
    expect(ancestrosOcultos(volver)).toEqual([]);
  });
});
