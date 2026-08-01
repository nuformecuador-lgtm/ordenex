// @vitest-environment jsdom
// Feature 170 (T G.2) — R39: MIENTRAS el rollout esté incompleto, el sistema sigue
// funcionando.
//
// Puede parecer un test de una fase ya terminada —las 25 tablas descargan— y es justo al
// revés: R39 es la propiedad que hizo posible entregar en seis tandas sin dejar la
// aplicación rota entre PR y PR, y **la que hay que seguir cumpliendo**. Sigue en uso:
//
//  - las SEIS tablas del Anexo II no tienen (ni tendrán) la prop, y tienen que comportarse
//    exactamente como antes de la 151;
//  - la FASE 2 (paginación) volverá a tocar estas mismas pantallas una a una;
//  - cualquier tabla futura nace sin la prop y no puede nacer rota por ello.
//
// Lo que se afirma es el contrato opt-in del `DataTable` de la 151: sin `descarga`, ni
// control, ni carga extra, ni un solo cambio en lo que la tabla renderiza. Se comprueba
// sobre el `DataTable` genérico —el punto por el que pasan las 31 tablas— y luego sobre una
// tabla REAL de las excluidas, para que no sea una propiedad del componente de laboratorio.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTable, type Column } from "@/components/shared/DataTable";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
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

import { OrdenesConErrorTabla } from "@/app/(app)/ordenes/_components/OrdenesConErrorTabla";

interface Fila {
  id: string;
  nombre: string;
}

const COLUMNAS: Column<Fila>[] = [
  { id: "nombre", value: "Nombre" },
  { id: "id", value: "Código" },
];

const DATOS: Fila[] = [
  { id: "a", nombre: "Ana" },
  { id: "b", nombre: "Beto" },
];

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Rollout parcial · una tabla sin la prop se comporta como antes", () => {
  it("sin `descarga` no renderiza control alguno y la tabla es idéntica", () => {
    // R39 + R2. El contrato es opt-in: la ausencia de la prop no deja un hueco, ni un botón
    // deshabilitado, ni un aviso. La comparación es literal: el mismo HTML con y sin la
    // prop, salvo el control.
    const { container: sinDescarga } = render(
      <DataTable columns={COLUMNAS} data={DATOS} rowKey="id" ariaLabel="Tabla" />,
    );
    const htmlSinDescarga = sinDescarga.innerHTML;

    expect(screen.queryByRole("button", { name: /descargar/i })).toBeNull();
    // La tabla, entera: cabeceras y filas, exactamente las de siempre.
    const tabla = screen.getByRole("table", { name: "Tabla" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(DATOS.length + 1);
    expect(within(tabla).getByText("Ana")).toBeInTheDocument();
    cleanup();

    const { container: conDescarga } = render(
      <DataTable
        columns={COLUMNAS}
        data={DATOS}
        rowKey="id"
        ariaLabel="Tabla"
        descarga={{
          titulo: "Tabla",
          columnas: [{ clave: "nombre", encabezado: "Nombre" }],
          obtenerFilas: async () => ({ status: "ok", filas: [{ nombre: "Ana" }] }),
        }}
      />,
    );

    // Lo ÚNICO que cambia es que aparece el control; el resto del DOM es el mismo.
    expect(screen.getByRole("button", { name: "Descargar Tabla" })).toBeInTheDocument();
    const htmlDeLaTabla = (html: string) => html.slice(html.indexOf("<table"));
    expect(htmlDeLaTabla(conDescarga.innerHTML)).toBe(htmlDeLaTabla(htmlSinDescarga));
  });

  it("sin `descarga` no se carga el generador ni se entrega archivo alguno", async () => {
    // R39/R32: una tabla no cableada no paga NADA por el rollout. Ni el import dinámico de
    // exceljs, ni una consulta extra, ni un side effect de descarga. Se interactúa con la
    // tabla (click en una fila) para que «no se llamó» no sea el resultado de no tocar nada.
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNAS} data={DATOS} rowKey="id" ariaLabel="Tabla" />);

    await user.click(screen.getByText("Ana"));

    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("una tabla REAL declarada fuera de alcance sigue sin control y sin cambios", () => {
    // R2/R39 sobre una de las seis exclusiones del Anexo II: la previsualización de órdenes
    // con error (feature 143), que ya tiene SU propia descarga de errores y por eso quedó
    // fuera. Sigue enseñando sus filas y no ha ganado un segundo botón por el rollout.
    render(
      <OrdenesConErrorTabla
        errores={[
          {
            fila: 3,
            numRemision: "REM-003",
            errores: { destinatario: ["Requerido"] },
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Descargar /i })).toBeNull();
    const tabla = screen.getByRole("table", { name: "Órdenes con error" });
    expect(within(tabla).getByText("REM-003")).toBeInTheDocument();
    expect(within(tabla).getAllByRole("row")).toHaveLength(2);
  });
});
