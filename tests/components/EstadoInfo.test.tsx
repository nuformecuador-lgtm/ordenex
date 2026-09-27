// @vitest-environment jsdom
// FICHA 456 (T2.2, design §8; R7, R15, R20-R26, R29) — el botón de información y sus piezas.
//
// Los textos se comparan contra `specs/456-tooltip-estados/textos-aprobados.md` LEÍDO DEL DISCO
// (`tests/fixtures/textos-aprobados-456.ts`), no contra la constante que los emite.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CLASES_BOTON_INFO,
  EstadoConInfo,
  InfoEstado,
  InfosEstado,
  LeyendaEstadosConInfo,
  NotaAyudaConInfo,
  SenalPendienteConInfo,
} from "@/components/shared/EstadoInfo";
import { NOMBRE_ESTADO, ORDER_STATUS_SEED } from "@/lib/types/order-status";
import {
  TEXTO_APROBADO_NOTA_AYUDA,
  TEXTOS_APROBADOS_ESTADOS,
  textoAprobadoDe,
} from "../fixtures/textos-aprobados-456";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const boton = (nombre: string) => screen.getByRole("button", { name: `Qué significa «${nombre}»` });
const explicacion = () => screen.queryByRole("dialog");

describe("456 · EstadoConInfo — los 20 estados (R2, R7, R23, R24)", () => {
  it("la tabla del disco trae los 20 estados", () => {
    expect(TEXTOS_APROBADOS_ESTADOS).toHaveLength(20);
    expect(ORDER_STATUS_SEED).toHaveLength(20);
  });

  it.each(ORDER_STATUS_SEED.map((c) => [c] as const))(
    "%s: nombre visible, nombre accesible exacto y, abierto, un diálogo con nombre y descripción aprobados",
    async (codigo) => {
      const user = userEvent.setup();
      const nombre = NOMBRE_ESTADO[codigo];
      render(<EstadoConInfo codigo={codigo} />);
      expect(screen.getByText(nombre)).toBeTruthy();
      await user.click(boton(nombre));
      const dlg = await screen.findByRole("dialog");
      expect(dlg).toHaveAccessibleName(nombre);
      expect(dlg).toHaveAccessibleDescription(textoAprobadoDe(nombre));
    },
  );

  it("R7 — el texto no depende de la superficie (app y landing dicen lo mismo)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="app"><EstadoConInfo codigo="novedad" /></div>
        <div data-testid="landing"><EstadoConInfo codigo="novedad" superficie="landing" /></div>
      </>,
    );
    const [a, l] = screen.getAllByRole("button", { name: "Qué significa «Novedad»" });
    await user.click(a);
    const textoApp = (await screen.findByRole("dialog")).textContent;
    await user.keyboard("{Escape}");
    await waitFor(() => expect(explicacion()).toBeNull());
    await user.click(l);
    const textoLanding = (await screen.findByRole("dialog")).textContent;
    expect(textoLanding).toBe(textoApp);
    expect(textoApp).toContain(textoAprobadoDe("Novedad"));
  });
});

describe("456 · la interacción (R20-R22, R25, R29)", () => {
  it("R20 — pasar el puntero abre tras el retraso", async () => {
    const user = userEvent.setup();
    render(<EstadoConInfo codigo="en_reparto" />);
    await user.hover(boton("En reparto"));
    expect(await screen.findByRole("dialog", {}, { timeout: 2000 })).toHaveAccessibleName("En reparto");
  });

  it("R21 — clic abre y sigue abierto; el segundo clic cierra", async () => {
    const user = userEvent.setup();
    render(<EstadoConInfo codigo="entregado" />);
    await user.click(boton("Entregado"));
    await screen.findByRole("dialog");
    await new Promise((r) => setTimeout(r, 400));
    expect(explicacion()).not.toBeNull();
    await user.click(boton("Entregado"));
    await waitFor(() => expect(explicacion()).toBeNull());
  });

  it("R21 — pulsar fuera cierra", async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>fuera</p>
        <EstadoConInfo codigo="entregado" />
      </>,
    );
    await user.click(boton("Entregado"));
    await screen.findByRole("dialog");
    await user.click(screen.getByText("fuera"));
    await waitFor(() => expect(explicacion()).toBeNull());
  });

  it("R22 — Enter y Espacio abren; Escape cierra y devuelve el foco al botón", async () => {
    const user = userEvent.setup();
    render(<EstadoConInfo codigo="incidente" />);
    const b = boton("Incidente");
    b.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(explicacion()).toBeNull());
    expect(document.activeElement).toBe(b);
    await user.keyboard(" ");
    await screen.findByRole("dialog");
  });

  it("R22/R23 — el botón es alcanzable con Tab", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">antes</button>
        <EstadoConInfo codigo="recolectando" />
      </>,
    );
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(boton("Recolectando"));
  });

  it("R25 — abrir otro cierra el primero", async () => {
    const user = userEvent.setup();
    render(
      <>
        <EstadoConInfo codigo="entregado" />
        <EstadoConInfo codigo="novedad" />
      </>,
    );
    await user.click(boton("Entregado"));
    await screen.findByRole("dialog", { name: "Entregado" });
    await user.click(boton("Novedad"));
    await screen.findByRole("dialog", { name: "Novedad" });
    // El primero se cerró: su diálogo (por su nombre) ya no está.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Entregado" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Novedad" })).toBeTruthy();
  });

  it("R29 — cerrado, el texto no está en el DOM; abrir y cerrar no hace ninguna petición", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("sin red")));
    const user = userEvent.setup();
    render(<EstadoConInfo codigo="devuelta_a_tienda" />);
    expect(screen.queryByText(textoAprobadoDe("Devuelta a tienda"))).toBeNull();
    await user.click(boton("Devuelta a tienda"));
    await screen.findByText(textoAprobadoDe("Devuelta a tienda"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(textoAprobadoDe("Devuelta a tienda"))).toBeNull());
    expect(espia).not.toHaveBeenCalled();
  });

  it("R30 — el clic en el botón y en el texto abierto no sube al contenedor", async () => {
    const user = userEvent.setup();
    const alContenedor = vi.fn();
    render(
      <div onClick={alContenedor}>
        <EstadoConInfo codigo="en_reparto" />
      </div>,
    );
    await user.click(boton("En reparto"));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByText(textoAprobadoDe("En reparto")));
    fireEvent.click(dlg);
    expect(alContenedor).not.toHaveBeenCalled();
  });
});

describe("456 · retirados, desconocidos y forma del botón (R15, R26, R27)", () => {
  it.each([["devolucion_por_confirmar"], ["ayuda_tienda"], ["pendiente"], ["codigo_inventado"]])(
    "%s: se pinta el nombre de la 455 SIN botón",
    (codigo) => {
      const { container } = render(<EstadoConInfo codigo={codigo} />);
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.textContent).toMatch(/\(estado retirado\)|Estado no reconocido/);
      cleanup();
      render(<InfoEstado codigo={codigo} />);
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("R26/R27/R33 — caja de 16 px, área activable de 24 (after:-inset-1) y anillo OPACO", () => {
    render(<EstadoConInfo codigo="entregado" />);
    const clases = boton("Entregado").className.split(/\s+/);
    for (const c of ["size-4", "relative", "after:absolute", "after:-inset-1", "focus-visible:ring-3", "focus-visible:ring-ring"]) {
      expect(clases).toContain(c);
    }
    expect(CLASES_BOTON_INFO).not.toMatch(/ring-ring\/\d+/);
  });

  it("R28 — en la landing el popup lleva `tema-claro` aunque el documento esté en oscuro", async () => {
    document.documentElement.classList.add("dark");
    try {
      const user = userEvent.setup();
      render(<EstadoConInfo codigo="entregado" superficie="landing" />);
      await user.click(boton("Entregado"));
      const dlg = await screen.findByRole("dialog");
      expect(dlg.className).toContain("tema-claro");
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});

describe("456 · SenalPendienteConInfo y NotaAyudaConInfo (R11, R12, R23)", () => {
  it.each([["entregado"], ["reprogramado"], ["novedad"], ["devolucion_a_origen_por_rechazo"], ["incidente"]] as const)(
    "%s pendiente: «<resultado> · pendiente de confirmación» con la explicación de «En reparto»",
    async (resultado) => {
      const user = userEvent.setup();
      render(<SenalPendienteConInfo resultado={resultado} />);
      expect(screen.getByText(`${NOMBRE_ESTADO[resultado]} · pendiente de confirmación`)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Qué significa «pendiente de confirmación»" }));
      const dlg = await screen.findByRole("dialog");
      expect(dlg).toHaveAccessibleName("pendiente de confirmación");
      expect(dlg).toHaveAccessibleDescription(textoAprobadoDe("En reparto"));
    },
  );

  it("la nota de ayuda con su explicación (texto pendiente de visto bueno, leído del disco)", async () => {
    const user = userEvent.setup();
    render(<NotaAyudaConInfo />);
    expect(screen.getByText("Ayuda solicitada a la tienda")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Qué significa «Ayuda solicitada a la tienda»" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAccessibleName("Ayuda solicitada a la tienda");
    expect(dlg).toHaveAccessibleDescription(TEXTO_APROBADO_NOTA_AYUDA);
  });
});

describe("456 · LeyendaEstadosConInfo e InfosEstado (R10, R14)", () => {
  it("la leyenda es una lista con nombre y un botón por código, en el orden recibido", () => {
    render(<LeyendaEstadosConInfo codigos={["novedad", "entregado", "incidente"]} titulo="Qué significa cada estado" />);
    const lista = screen.getByRole("list", { name: "Qué significa cada estado" });
    const nombres = within(lista)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(nombres).toEqual(["Qué significa «Novedad»", "Qué significa «Entregado»", "Qué significa «Incidente»"]);
  });

  it("InfosEstado: un botón por código distinto, en el orden del texto", () => {
    render(<InfosEstado codigos={["entregado", "reprogramado", "entregado"]} />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Qué significa «Entregado»",
      "Qué significa «Reprogramado»",
    ]);
  });
});
