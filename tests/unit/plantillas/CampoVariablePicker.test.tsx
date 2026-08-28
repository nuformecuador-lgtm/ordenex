// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

import { CampoVariablePicker } from "@/app/(app)/configuracion/plantillas/_components/CampoVariablePicker";
import {
  CAMPOS_PLANTILLA,
  CAMPOS_PLANTILLA_OFRECIDOS,
  CLAVES_OCULTAS_EN_SELECTOR,
} from "@/lib/types/plantilla-datos";

afterEach(() => {
  cleanup();
});

const CAMPOS_OFRECIDOS = CAMPOS_PLANTILLA_OFRECIDOS;
const MONTO = CAMPOS_PLANTILLA.find((c) => c.clave === "monto");
const CLIENTE = CAMPOS_PLANTILLA.find((c) => c.clave === "cliente");
const NOTAS = CAMPOS_PLANTILLA.find((c) => c.clave === "notas");
if (MONTO === undefined || CLIENTE === undefined || NOTAS === undefined) {
  throw new Error("Fixture inválido: el catálogo cambió las claves usadas por este test.");
}
// Precondición del test R9: `notas` es sensible y `cliente` no lo es, en el catálogo real.
if (NOTAS.sensible !== true || CLIENTE.sensible === true) {
  throw new Error(
    "R9 asume notas.sensible === true y cliente.sensible !== true; el catálogo cambió.",
  );
}

/**
 * La lista ya no se "abre": se pinta siempre. Este helper conserva el nombre por el que
 * el resto de los tests la referencian, pero ahora solo localiza el input de filtro sin
 * disparar ninguna transición de apertura (no existe tal cosa).
 */
function localizarFiltro() {
  return screen.getByRole("textbox", { name: /campo/i });
}

describe("CampoVariablePicker", () => {
  it("R1: pinta el nombre y la descripción de cada opción", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);

    const opcionMonto = screen.getByRole("option", { name: new RegExp(MONTO.nombre) });
    expect(within(opcionMonto).getByText(MONTO.nombre)).toBeInTheDocument();
    expect(within(opcionMonto).getByText(MONTO.descripcion)).toBeInTheDocument();

    const opcionCliente = screen.getByRole("option", {
      name: new RegExp(CLIENTE.nombre),
    });
    expect(within(opcionCliente).getByText(CLIENTE.nombre)).toBeInTheDocument();
    expect(within(opcionCliente).getByText(CLIENTE.descripcion)).toBeInTheDocument();
  });

  it("R2: teclear una clave inventada + Enter no llama a onSeleccionar ni crea opción", () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const filtro = localizarFiltro();

    fireEvent.change(filtro, { target: { value: "sucursal" } });
    fireEvent.keyDown(filtro, { key: "Enter" });

    expect(onSeleccionar).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it('R3: filtro "monto" deja solo campos de monto; "GUIA" y "guía" dan el mismo conjunto', () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro();

    fireEvent.change(filtro, { target: { value: "monto" } });
    const opcionesMonto = screen.getAllByRole("option").map((o) => o.id);
    expect(opcionesMonto.length).toBeGreaterThan(0);
    expect(
      opcionesMonto.every((id) => id.includes("monto") || id.includes("total")),
    ).toBe(true);

    fireEvent.change(filtro, { target: { value: "GUIA" } });
    const idsMayus = screen.getAllByRole("option").map((o) => o.id);

    fireEvent.change(filtro, { target: { value: "guía" } });
    const idsAcento = screen.getAllByRole("option").map((o) => o.id);

    expect(idsMayus.length).toBeGreaterThan(0);
    expect(idsAcento).toEqual(idsMayus);
  });

  it("R4: filtro vacío muestra los campos OFRECIDOS (sin alias ni ocultos), en su orden", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);

    const opciones = screen.getAllByRole("option");
    expect(opciones).toHaveLength(CAMPOS_OFRECIDOS.length);
    expect(opciones.map((o) => o.id)).toEqual(
      CAMPOS_OFRECIDOS.map((c) => `campo-opcion-${c.clave}`),
    );

    const clavesExcluidas = ["num_guia", "nombre", "destinatario", "num_remision", "total"];
    for (const clave of clavesExcluidas) {
      expect(document.getElementById(`campo-opcion-${clave}`)).toBeNull();
    }
  });

  // Feature 288, pedido humano 2026-08-27: 27 campos dejan de OFRECERSE. Siguen en el
  // catalogo y siguen resolviendo (eso lo fija
  // `tests/unit/plantillas/campos-ocultos-siguen-resolviendo.test.ts`); aqui solo se
  // comprueba que el selector no los propone.
  it("ocultos: ninguna de las 27 claves retiradas aparece con el filtro vacío", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);

    expect(CLAVES_OCULTAS_EN_SELECTOR.size).toBe(27);
    for (const clave of CLAVES_OCULTAS_EN_SELECTOR) {
      expect(document.getElementById(`campo-opcion-${clave}`)).toBeNull();
    }
  });

  it("ocultos: tampoco aparecen BUSCANDOLOS por su nombre exacto", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro();

    for (const clave of CLAVES_OCULTAS_EN_SELECTOR) {
      const campo = CAMPOS_PLANTILLA.find((c) => c.clave === clave);
      if (campo === undefined) throw new Error(`El catálogo perdió ${clave}`);

      // Por nombre legible...
      fireEvent.change(filtro, { target: { value: campo.nombre } });
      expect(document.getElementById(`campo-opcion-${clave}`)).toBeNull();

      // ...y por la clave cruda, que es como la buscaría quien ya la conoce.
      fireEvent.change(filtro, { target: { value: clave } });
      expect(document.getElementById(`campo-opcion-${clave}`)).toBeNull();
    }
  });

  it("ofrecidos: los campos que SI se ofrecen siguen encontrándose por su nombre", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro();

    for (const campo of CAMPOS_OFRECIDOS) {
      fireEvent.change(filtro, { target: { value: campo.nombre } });
      expect(document.getElementById(`campo-opcion-${campo.clave}`)).not.toBeNull();
    }
  });

  it('R6: filtro "zzz" no deja ninguna opción y muestra un aviso de vacío', () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro();

    fireEvent.change(filtro, { target: { value: "zzz" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByText(/ningún campo coincide con la búsqueda/i),
    ).toBeInTheDocument();
  });

  it('R7: elegir «Monto a cobrar» llama a onSeleccionar con "monto" una sola vez', () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const filtro = localizarFiltro();
    fireEvent.change(filtro, { target: { value: "Monto a cobrar" } });

    fireEvent.click(screen.getByRole("option", { name: new RegExp(MONTO.nombre) }));

    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith("monto");
  });

  it("R8: tras elegir, el filtro queda vacío y la lista vuelve a mostrar el catálogo completo", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro() as HTMLInputElement;
    fireEvent.change(filtro, { target: { value: "monto" } });
    fireEvent.click(screen.getByRole("option", { name: new RegExp(MONTO.nombre) }));

    expect(filtro.value).toBe("");
    // La segunda mitad de R8 ("cerrar la lista") se deroga porque la lista ya no es algo
    // que se abra o cierre; lo que sobrevive es que la búsqueda parte de cero: vuelve a
    // verse el catálogo entero.
    expect(screen.getAllByRole("option")).toHaveLength(CAMPOS_OFRECIDOS.length);
  });

  // R9 se prueba INYECTANDO el catálogo, no con el default, y la razón es un efecto
  // colateral real de ocultar los 27 (pedido humano 2026-08-27): `notas` era el único campo
  // `sensible` que el selector ofrecía, y ahora está oculto. Hoy NINGÚN campo ofrecido es
  // sensible, así que con el catálogo por defecto el distintivo no es alcanzable.
  //
  // El camino de código sigue vivo y sigue importando: en cuanto se ofrezca un campo
  // sensible —o se reponga alguno de los ocultos— tiene que pintar su distintivo. Por eso se
  // inyectan las entradas REALES del catálogo (`notas` y `cliente`, que siguen ahí) en vez de
  // borrar el test o de fabricar un campo de mentira.
  it("R9: la opción de un campo sensible trae el distintivo; la de uno normal no", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} campos={[NOTAS, CLIENTE]} />);

    const opcionNotas = document.getElementById(`campo-opcion-${NOTAS.clave}`);
    const opcionCliente = document.getElementById(`campo-opcion-${CLIENTE.clave}`);
    expect(opcionNotas).not.toBeNull();
    expect(opcionCliente).not.toBeNull();

    expect(within(opcionNotas as HTMLElement).getByText(/dato sensible/i)).toBeInTheDocument();
    expect(
      within(opcionCliente as HTMLElement).queryByText(/dato sensible/i),
    ).not.toBeInTheDocument();
  });

  it("R29: ArrowDown/ArrowUp mueven aria-activedescendant y Enter selecciona la activa", () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const filtro = localizarFiltro();

    const primeraId = `campo-opcion-${CAMPOS_OFRECIDOS[0].clave}`;
    const segundaId = `campo-opcion-${CAMPOS_OFRECIDOS[1].clave}`;

    expect(filtro).toHaveAttribute("aria-activedescendant", primeraId);

    fireEvent.keyDown(filtro, { key: "ArrowDown" });
    expect(filtro).toHaveAttribute("aria-activedescendant", segundaId);

    fireEvent.keyDown(filtro, { key: "ArrowUp" });
    expect(filtro).toHaveAttribute("aria-activedescendant", primeraId);

    fireEvent.keyDown(filtro, { key: "Enter" });
    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith(CAMPOS_OFRECIDOS[0].clave);
  });

  it("R29: Escape no es capturado por el picker, para que el Sheet anfitrión pueda cerrarse", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = localizarFiltro();

    const evento = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    filtro.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(false);
  });

  it("Nuevo — lista siempre visible: recién montado, sin ninguna interacción previa, ya hay listbox con todas las opciones del catálogo", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(CAMPOS_OFRECIDOS.length);
  });

  it("Nuevo — scroll propio: el contenedor de la lista tiene overflow-y-auto y una altura máxima", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);

    const listbox = screen.getByRole("listbox");
    expect(listbox.className).toMatch(/overflow-y-auto/);
    expect(listbox.className).toMatch(/max-h-\d+/);
  });

  it("R30: el filtro se encuentra por nombre accesible, la lista es un listbox, y aria-activedescendant coincide con la opción activa", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const filtro = screen.getByRole("textbox", { name: /campo/i });

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    const activeId = filtro.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    const opcionActiva = document.getElementById(activeId as string);
    expect(opcionActiva).not.toBeNull();
    expect(opcionActiva).toHaveAttribute("role", "option");
    expect(opcionActiva).toHaveAttribute("aria-selected", "true");
  });
});
