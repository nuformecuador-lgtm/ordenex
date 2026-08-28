// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RechazosSlaModule } from "@/app/(app)/novedades/_components/RechazosSlaModule";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";
import type { RechazoSlaTiendaDTO } from "@/lib/types/rechazo-sla-tienda";

// Feature 102 (T12) — modulo cliente PRIVADO de la pestaña de rechazos por plazo vencido de
// `/novedades`. Cubre la superficie de la tienda (R12/R14): por cada orden rechazada muestra la
// guia (placeholder si null), la remision y el destinatario. Estado vacio legible. Re-fetch por
// Server Action (mock) al paginar.
//
// Feature 308 — NINGUN IMPORTE. Lo que se pintaba era `monto` = `ingreso_bodega_rechazo` (56),
// dinero de la BODEGA, en negrita y sin etiqueta, y la tienda lo leia como suyo. Todos los casos
// de abajo siguen ALIMENTANDO un `monto` en el DTO a proposito: si el componente volviera a
// pintarlo, estas aserciones tienen que ponerse rojas. Un test que dejara de pasar el monto no
// probaria nada, porque pasaria igual con el bug dentro.
vi.mock("@/lib/actions/rechazos-sla-tienda", () => ({
  listarRechazosSlaTiendaAction: vi.fn(),
}));

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMock = vi.mocked(listarRechazosSlaTiendaAction);

const rechazo = (over: Partial<RechazoSlaTiendaDTO> = {}): RechazoSlaTiendaDTO => ({
  id: "o1",
  numGuia: 12345,
  numRemision: "REM-001",
  destinatario: "Ana Cliente",
  monto: "3500.00",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RechazosSlaModule", () => {
  it("lista vacia -> estado vacio legible, sin filas", () => {
    render(<RechazosSlaModule items={[]} total={0} page={1} pageSize={10} />);

    expect(
      screen.getByText(/No tenés órdenes rechazadas por plazo vencido/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Órdenes rechazadas por plazo vencido" }),
    ).toBeNull();
  });

  it("R14: por cada orden muestra guia, remision y destinatario", () => {
    render(
      <RechazosSlaModule
        items={[
          rechazo({
            numGuia: 12345,
            numRemision: "REM-777",
            destinatario: "Ana Cliente",
            monto: "3500.00",
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const lista = screen.getByRole("list", { name: "Órdenes rechazadas por plazo vencido" });
    expect(within(lista).getByText(/12345/)).toBeInTheDocument();
    expect(within(lista).getByText(/REM-777/)).toBeInTheDocument();
    expect(within(lista).getByText("Ana Cliente")).toBeInTheDocument();
  });

  it("R14: numGuia null -> placeholder legible, no rompe la fila", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ numGuia: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  it("308: monto null tampoco pinta el badge 'Pendiente de cierre'", () => {
    // El badge era la rama nula del MISMO importe ajeno: solo existia para decir por que ese
    // ingreso de bodega aun no se podia pintar. Sin importe, no hay nada que estar esperando.
    render(
      <RechazosSlaModule
        items={[rechazo({ monto: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.queryByText(/pendiente de cierre/i)).toBeNull();
    expect(screen.queryByText(/₡/)).toBeNull();
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <RechazosSlaModule items={[rechazo()]} total={25} page={2} pageSize={10} />,
    );

    // total 25 / pageSize 10: la pagina 2 cubre los elementos 11 al 20.
    expect(
      screen.getByRole("navigation", { name: "Paginación de rechazos por plazo vencido" }),
    ).toBeInTheDocument();
    expect(screen.getByText("11-20 de 25")).toBeInTheDocument();
  });

  it("al paginar re-fetch por Server Action y actualiza la lista con la nueva pagina", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [
        rechazo({ id: "o2", numRemision: "REM-PAG2", destinatario: "Beto Pagina2" }),
      ],
      total: 15,
      page: 2,
      pageSize: 10,
    });
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", numRemision: "REM-PAG1" })]}
        total={15}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Página siguiente" }),
    );

    await vi.waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ page: 2 }),
    );
    expect(await screen.findByText("Beto Pagina2")).toBeInTheDocument();
  });

  it("al paginar con error muestra toast y NO rompe la vista actual", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({ status: "forbidden" });
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", destinatario: "Ana Cliente" })]}
        total={15}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Página siguiente" }),
    );

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    // La fila original sigue presente (no se limpió por el error).
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
  });
});

// Feature 160 (T20, R18/R19/R26) — la pestaña de rechazadas por plazo vencido también
// es una lista de cards, no un `DataTable`: dato etiquetado, no columna.
describe("RechazosSlaModule — intentos de entrega (feature 160)", () => {
  it("R18: cada rechazo muestra el dato etiquetado junto a sus otros campos", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", numRemision: "REM-777", intentosEntrega: 3 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-777");
    const dato = within(item).getByText("Intentos: 3");
    expect(dato.closest("p")).not.toBeNull();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual", () => {
    render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", intentosEntrega: 0 })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) muestra 0", () => {
    render(
      <RechazosSlaModule items={[rechazo({ id: "o1" })]} total={1} page={1} pageSize={10} />,
    );
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R26: cada rechazo lleva SU número de intentos (y ninguno lleva importe, 308)", () => {
    render(
      <RechazosSlaModule
        items={[
          rechazo({ id: "o1", monto: "3500.00", intentosEntrega: 2 }),
          rechazo({ id: "o2", monto: null, intentosEntrega: 0 }),
        ]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 2")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
    expect(within(items[0]).queryByText(/₡/)).toBeNull();
    expect(within(items[1]).queryByText(/pendiente de cierre/i)).toBeNull();
  });
});

// Feature 308 (2026-08-28) — EL IMPORTE AJENO, retirado y asertado.
//
// `RechazoSlaTiendaDTO.monto` NO es dinero de la tienda: la cadena medida es DTO ->
// `RechazosSlaTiendaService.listar` (passthrough de `row.monto`) ->
// `OrdenRepository.findRechazadasSlaByTienda`, que lo saca de
// `historialEstados[0].gestion.ingresoBodegaRechazo`, o sea el `ingreso_bodega_rechazo` de 56:
// lo que ingresa la BODEGA. Se pintaba en negrita y sin etiqueta, y a la tienda un rechazo le
// cuesta por otra via (flete de retorno + IVA). Decision del humano: se RETIRA.
//
// Estos casos MUERDEN porque el DTO SIGUE TRAYENDO el importe: no se comprueba que una constante
// valga lo que vale, se comprueba que un dato presente en las props NO LLEGA A LOS PIXELES. La
// mutacion de referencia es volver a pintarlo (con `money()` o crudo); ambas formas caen aqui.
describe("RechazosSlaModule — el monto de la bodega no se le muestra a la tienda (308)", () => {
  // Cifra deliberadamente sin colision con guia/remision/intentos del fixture.
  const MONTO_BODEGA = "48250.75";

  /** Cualquier forma plausible de pintar 48250.75: cruda, con miles, y redondeada (feature 230). */
  const RASTRO_DEL_IMPORTE = /48[.,\s]?25[01]/;

  it("con monto presente en el DTO, la card no muestra ni la cifra ni el simbolo", () => {
    render(
      <RechazosSlaModule
        items={[
          rechazo({
            id: "o1",
            numGuia: 12345,
            numRemision: "REM-777",
            destinatario: "Ana Cliente",
            monto: MONTO_BODEGA,
            intentosEntrega: 2,
          }),
        ]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    const item = screen.getByRole("listitem");
    // Contraste: la card SI esta renderizada (si no, esto pasaria en verde por vacio).
    expect(item).toHaveTextContent("REM-777");
    expect(item).toHaveTextContent("Ana Cliente");
    expect(item).toHaveTextContent("Intentos: 2");
    // Y el importe ajeno no esta, en ninguna de sus formas.
    expect(item.textContent ?? "").not.toMatch(RASTRO_DEL_IMPORTE);
    expect(item.textContent ?? "").not.toContain(MONTO_BODEGA);
    expect(item.textContent ?? "").not.toContain("₡");
  });

  it("tampoco queda rastro del importe fuera de la card (ni cabecera ni total)", () => {
    const { container } = render(
      <RechazosSlaModule
        items={[
          rechazo({ id: "o1", monto: MONTO_BODEGA }),
          rechazo({ id: "o2", monto: "1000000.00" }),
        ]}
        total={2}
        page={1}
        pageSize={10}
      />,
    );

    const pintado = container.textContent ?? "";
    expect(pintado).not.toMatch(RASTRO_DEL_IMPORTE);
    expect(pintado).not.toContain("₡");
    expect(pintado).not.toMatch(/1[.,\s]?000[.,\s]?000/);
  });

  it("la pagina que llega por la Server Action tampoco pinta el importe", async () => {
    const user = userEvent.setup();
    listarMock.mockResolvedValue({
      status: "ok",
      items: [
        rechazo({
          id: "o2",
          numRemision: "REM-PAG2",
          destinatario: "Beto Pagina2",
          monto: MONTO_BODEGA,
        }),
      ],
      total: 15,
      page: 2,
      pageSize: 10,
    });
    const { container } = render(
      <RechazosSlaModule
        items={[rechazo({ id: "o1", numRemision: "REM-PAG1" })]}
        total={15}
        page={1}
        pageSize={10}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("Beto Pagina2")).toBeInTheDocument();

    const pintado = container.textContent ?? "";
    expect(pintado).not.toMatch(RASTRO_DEL_IMPORTE);
    expect(pintado).not.toContain("₡");
  });

  it("el estado vacio ya no promete un monto que no se va a pintar", () => {
    render(<RechazosSlaModule items={[]} total={0} page={1} pageSize={10} />);

    const vacio = screen.getByRole("status");
    // Sigue explicando cuando aparecera algo aqui...
    expect(vacio).toHaveTextContent(/aparecerá acá/i);
    // ...pero sin prometer el importe (era el de la bodega) y sin la sigla prohibida.
    expect(vacio.textContent ?? "").not.toMatch(/monto/i);
    expect(vacio.textContent ?? "").not.toMatch(/\bSLA\b/);
  });

  it("el texto visible del modulo no usa la sigla SLA en ningun estado", () => {
    const { container } = render(
      <RechazosSlaModule items={[rechazo({ monto: MONTO_BODEGA })]} total={1} page={1} pageSize={10} />,
    );

    expect(container.textContent ?? "").not.toMatch(/\bSLA\b/);
    // Y las etiquetas accesibles tampoco (las lee un lector de pantalla).
    expect(
      screen.getByRole("list", { name: "Órdenes rechazadas por plazo vencido" }),
    ).toBeInTheDocument();
  });
});
