// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import {
  SegmentedToggle,
  type SegmentedOption,
} from "@/components/shared/SegmentedToggle";

// FICHA 428 — `soloIcono` MEDIDO EN EL COMPONENTE, no en la pantalla que lo pide.
//
// `/ordenes` lo ejerce de verdad (`ordenes-listado-orden.test.tsx`); aquí se miden las cosas que
// esa pantalla NO puede enseñar porque sus cuatro opciones traen icono: el fallback de la opción
// sin `Icono`, la limitación del `conteo` y —lo más importante— que el defecto sigue siendo el
// botón de texto de siempre, que es lo que pintan los otros ocho consumidores.
//
// Los textos van ESCRITOS A MANO en cada caso: importarlos del módulo que los declara dejaría
// estas aserciones comparándose con su propia fuente (memoria del repo).

type Vista = "mosaico" | "detalle";

const CON_ICONO: readonly SegmentedOption<Vista>[] = [
  { valor: "mosaico", etiqueta: "Más recientes", Icono: ArrowDownWideNarrow },
  { valor: "detalle", etiqueta: "Más antiguas", Icono: ArrowUpNarrowWide },
];

afterEach(() => cleanup());

describe("SegmentedToggle — sin `soloIcono` no cambia NADA (los otros 8 consumidores)", () => {
  // Esta ficha es opt-in y la prop nace en `false`. Lo que estos casos protegen es que nadie
  // «aproveche» para volverla global: cierres, geografía, histórico/acciones, mis-asignaciones y
  // monitoreo montan este mismo control y sus pestañas van con TEXTO.
  it("por defecto la etiqueta está ESCRITA en el botón", () => {
    render(
      <SegmentedToggle
        ariaLabel="Vista"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
      />,
    );

    const grupo = screen.getByRole("group", { name: "Vista" });
    expect(
      within(grupo)
        .getAllByRole("button")
        .map((b) => b.textContent?.trim()),
    ).toEqual(["Más recientes", "Más antiguas"]);
  });

  it("por defecto NO hay `aria-label` por opción: el nombre lo da el texto", () => {
    // Si alguien invirtiera el defecto, este caso se pone rojo antes de que ocho pantallas
    // encojan sin haberlo pedido.
    render(
      <SegmentedToggle
        ariaLabel="Vista"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
      />,
    );

    for (const boton of within(
      screen.getByRole("group", { name: "Vista" }),
    ).getAllByRole("button")) {
      expect(boton).not.toHaveAttribute("aria-label");
    }
  });

  it("por defecto el `conteo` se pinta entre paréntesis, como desde la 170", () => {
    render(
      <SegmentedToggle
        ariaLabel="Pestañas"
        options={[
          { valor: "mosaico", etiqueta: "Pendientes", conteo: 12 },
          { valor: "detalle", etiqueta: "Resueltas", conteo: 0 },
        ]}
        valor="mosaico"
        onChange={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole("group", { name: "Pestañas" }))
        .getAllByRole("button")
        .map((b) => b.textContent?.trim()),
    ).toEqual(["Pendientes(12)", "Resueltas(0)"]);
  });
});

describe("SegmentedToggle — con `soloIcono` la etiqueta se MUDA, no desaparece", () => {
  it("el botón se queda sin texto visible y con el icono dentro", () => {
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    for (const etiqueta of ["Más recientes", "Más antiguas"]) {
      const boton = screen.getByRole("button", { name: etiqueta });
      expect(boton.textContent).toBe("");
      expect(boton.querySelector("svg")).not.toBeNull();
      // El icono es decorativo: quien nombra el control es el `aria-label`, no el svg.
      expect(boton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("la etiqueta NO queda como texto visible en ninguna parte", () => {
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    // Es el efecto que la ficha vino a buscar: sin estos textos la barra de `/ordenes` recupera
    // los ~800 px que los dos conmutadores se comían.
    expect(screen.queryByText("Más recientes")).toBeNull();
    expect(screen.queryByText("Más antiguas")).toBeNull();
  });

  it("conserva el NOMBRE ACCESIBLE de cada opción, que es por donde la localizan las pantallas", () => {
    // Quitar el `aria-label` «porque ya está el tooltip» deja los botones sin nombre y rompe
    // tests de pantallas que no son la que pidió esto.
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    const grupo = screen.getByRole("group", { name: "Dirección" });
    expect(
      within(grupo)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Más recientes", "Más antiguas"]);
  });

  it("al enfocar, el tooltip revela la etiqueta que antes estaba escrita", async () => {
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    // Por FOCO y no por hover: el hover de base-ui pasa por su lógica de puntero, que en jsdom
    // no se activa con los eventos de `userEvent.hover` (ya medido en `NovedadesModule.test.tsx`).
    // El foco ejerce el MISMO camino de apertura, y de paso cubre a quien navega con teclado —que
    // en móvil, donde no hay hover, es la única ayuda que queda—.
    fireEvent.focus(screen.getByRole("button", { name: "Más antiguas" }));

    expect(await screen.findByText("Más antiguas")).toBeInTheDocument();
  });

  it("cada botón revela SU etiqueta, no la del vecino", async () => {
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    fireEvent.focus(screen.getByRole("button", { name: "Más recientes" }));
    expect(await screen.findByText("Más recientes")).toBeInTheDocument();
    expect(screen.queryByText("Más antiguas")).toBeNull();
  });

  it("sigue marcando la opción puesta y sigue llamando a `onChange`", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={onChange}
        soloIcono
      />,
    );

    expect(screen.getByRole("button", { name: "Más recientes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Más antiguas" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    expect(onChange).toHaveBeenCalledWith("detalle");
  });

  it("los botones siguen siendo HIJOS DIRECTOS del grupo: el tooltip no mete un envoltorio", () => {
    // No es cosmético: `ButtonGroup` resuelve el redondeo de los extremos con selectores de hijo
    // directo (`> *[data-slot]`). Un `<span>` envolvente los dejaría a todos redondeados por los
    // cuatro lados y el grupo se vería partido. El patrón `TooltipTrigger render={<Button …/>}`
    // es justo lo que lo evita.
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={CON_ICONO}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    const grupo = screen.getByRole("group", { name: "Dirección" });
    const hijos = [...grupo.children];
    expect(hijos.map((h) => h.tagName)).toEqual(["BUTTON", "BUTTON"]);
    for (const hijo of hijos) {
      expect(hijo).toHaveAttribute("data-slot");
    }
  });
});

describe("SegmentedToggle — el fallback: una opción sin `Icono` NUNCA sale vacía", () => {
  it("la opción sin icono se pinta con su texto de siempre", () => {
    // Es la red que evita el peor resultado posible: un botón sin texto, sin dibujo y sin nada
    // visible donde pulsar, que además nadie notaría —el nombre accesible seguiría ahí—.
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={[
          { valor: "mosaico", etiqueta: "Con icono", Icono: ArrowDownWideNarrow },
          { valor: "detalle", etiqueta: "Sin icono" },
        ]}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    const conIcono = screen.getByRole("button", { name: "Con icono" });
    const sinIcono = screen.getByRole("button", { name: "Sin icono" });

    expect(conIcono.textContent).toBe("");
    expect(sinIcono.textContent?.trim()).toBe("Sin icono");
    expect(sinIcono.querySelector("svg")).toBeNull();
  });

  it("y la que cae al fallback sigue funcionando como opción", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedToggle
        ariaLabel="Dirección"
        options={[
          { valor: "mosaico", etiqueta: "Con icono", Icono: ArrowDownWideNarrow },
          { valor: "detalle", etiqueta: "Sin icono" },
        ]}
        valor="mosaico"
        onChange={onChange}
        soloIcono
      />,
    );

    const sinIcono = screen.getByRole("button", { name: "Sin icono" });
    expect(sinIcono).toHaveAttribute("aria-pressed", "false");
    await user.click(sinIcono);
    expect(onChange).toHaveBeenCalledWith("detalle");
  });

  it("LIMITACIÓN ACEPTADA: con `soloIcono` el `conteo` no se pinta", () => {
    // Está escrita en el JSDoc de la prop y se ancla aquí para que no se descubra en producción.
    // Hoy ningún consumidor con `soloIcono` declara `conteo`; el día que alguien quiera las dos
    // cosas, este caso es el que le dice que hay una decisión que tomar antes.
    render(
      <SegmentedToggle
        ariaLabel="Pestañas"
        options={[
          {
            valor: "mosaico",
            etiqueta: "Pendientes",
            Icono: ArrowDownWideNarrow,
            conteo: 12,
          },
        ]}
        valor="mosaico"
        onChange={vi.fn()}
        soloIcono
      />,
    );

    expect(screen.getByRole("button", { name: "Pendientes" })).toBeInTheDocument();
    expect(screen.queryByText("(12)")).toBeNull();
    // Y el número tampoco se cuela en el nombre accesible por la puerta de atrás.
    expect(screen.queryByRole("button", { name: /12/ })).toBeNull();
  });
});
