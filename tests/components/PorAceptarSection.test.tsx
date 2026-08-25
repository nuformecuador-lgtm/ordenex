// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import {
  PorAceptarSection,
  type PorAceptarOrdenBase,
} from "@/app/(app)/_components/PorAceptarSection";

// Feature 63 — sección "por aceptar": banner con contador de nuevas + lista de órdenes +
// render de detalle opcional. Componente puro; se afirma la composición sin Server Actions
// ni router.
//
// QUÉ SE RETIRÓ DE ESTE ARCHIVO Y POR QUÉ (ficha 279, T4.2, R3/R29 — 2026-08-24)
// -----------------------------------------------------------------------------
// La sección tenía DOS vías de acción y las dos están muertas:
//
// - la acción EN LOTE («aceptar todas») se retiró el 2026-08-19 por pedido humano —aceptar
//   de golpe todo lo que hay en pantalla se firma sin mirar—;
// - la acción POR-ORDEN (el botón «Aceptar») la retira la ficha 279: la recepción del
//   satélite pasa a ser SOLO por QR. Con ella se fueron del contrato `onAceptarUna`,
//   `textoBotonUna` y `mostrarAcciones`, esta última una prop cuya única función era
//   ocultar ese mismo botón.
//
// Tres casos de este archivo tenían al botón por SUJETO —«'aceptar' por-orden invoca
// onAceptarUna», «NO ofrece acción en lote» y «con mostrarAcciones=false lista sin
// botones»— y se FUNDEN en uno solo, abajo: «no pinta NINGÚN botón». No se borran sin
// sustituto: lo que afirmaban (que la acción por-orden estaba cableada al id correcto)
// muere con el código, porque no hay acción equivalente que reponer — la recepción vive
// ahora en `tests/components/EscanerRecepcion.test.tsx`.
//
// Cada ausencia va con su POSITIVO en el mismo caso (R29): un `queryByRole` que deja de
// encontrar un botón pasa igual de verde si el render entero se rompió.

interface Orden extends PorAceptarOrdenBase {
  extra?: string;
}

function make(id: string, numRemision = `REM-${id}`): Orden {
  return { id, numRemision, destinatario: `Dest ${id}`, extra: `X-${id}` };
}

function renderSection(props?: Partial<Parameters<typeof PorAceptarSection<Orden>>[0]>) {
  render(
    <PorAceptarSection<Orden>
      titulo={props?.titulo ?? "Por recibir"}
      nuevasLabel={props?.nuevasLabel ?? ((n) => `${n} nuevas`)}
      ordenes={props?.ordenes ?? []}
      vacio={props?.vacio ?? "No hay órdenes."}
      renderDetalle={props?.renderDetalle}
      renderItem={props?.renderItem}
      listClassName={props?.listClassName}
    />,
  );
}

afterEach(() => cleanup());

describe("PorAceptarSection", () => {
  it("es una región accesible con el título dado", () => {
    renderSection({ titulo: "Por recoger" });
    expect(screen.getByRole("region", { name: "Por recoger" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Por recoger" })).toBeInTheDocument();
  });

  it("muestra el vacío y ningún botón cuando no hay órdenes", () => {
    renderSection({ ordenes: [], vacio: "Nada por recibir." });
    expect(screen.getByText("Nada por recibir.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    // Sin órdenes no hay banner.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("muestra el banner con el contador de nuevas cuando hay órdenes", () => {
    renderSection({
      ordenes: [make("1"), make("2"), make("3")],
      nuevasLabel: (n) => `${n} Órdenes nuevas por recibir`,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 Órdenes nuevas por recibir",
    );
  });

  // R3/R29 — la fusión de los tres casos del botón, con la tarjeta POR DEFECTO.
  it("no pinta NINGÚN botón con la tarjeta por defecto: ni por-orden ni en lote (y sí el título, el banner y cada orden)", () => {
    renderSection({
      titulo: "Por recibir",
      ordenes: [make("a"), make("b")],
      nuevasLabel: (n) => `${n} Órdenes nuevas por recibir`,
    });
    const region = screen.getByRole("region", { name: "Por recibir" });

    // POSITIVO primero: el render ocurrió de verdad. Si esto no estuviera, las tres
    // ausencias de abajo pasarían igual con la región vacía.
    expect(
      within(region).getByRole("heading", { name: "Por recibir" }),
    ).toBeInTheDocument();
    expect(within(region).getByRole("status")).toHaveTextContent(
      "2 Órdenes nuevas por recibir",
    );
    expect(within(region).getByText(/REM-a/)).toBeInTheDocument();
    expect(within(region).getByText(/REM-b/)).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);

    // AUSENCIA: ni un botón. Ni el «Aceptar» por-orden, ni un «aceptar todas».
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(within(region).queryByRole("button", { name: /aceptar/i })).toBeNull();
    expect(within(region).queryByRole("button", { name: /todas/i })).toBeNull();
  });

  // La otra mitad de R3: el consumidor real de esta sección pinta su propia tarjeta con
  // `renderItem`, así que la ausencia hay que afirmarla también por ese camino.
  it("tampoco pinta ningún botón con renderItem (y sí lo que el consumidor le da)", () => {
    renderSection({
      ordenes: [make("a"), make("b")],
      renderItem: (orden) => <article>tarjeta-{orden.numRemision}</article>,
    });
    const region = screen.getByRole("region", { name: "Por recibir" });

    // POSITIVO: la sección montó las dos tarjetas del consumidor.
    expect(within(region).getByText("tarjeta-REM-a")).toBeInTheDocument();
    expect(within(region).getByText("tarjeta-REM-b")).toBeInTheDocument();

    // AUSENCIA: la sección no añade ningún botón propio encima de lo del consumidor.
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
  });

  it("renderiza el detalle de cada orden con renderDetalle", () => {
    renderSection({
      ordenes: [make("a")],
      renderDetalle: (orden) => <span>detalle-{orden.extra}</span>,
    });
    expect(screen.getByText("detalle-X-a")).toBeInTheDocument();
  });
});
