// @vitest-environment jsdom
// FICHA 374 (H3 · R47) — EL BLINDAJE DEL SELECTOR GEOGRÁFICO DE TARIFAS.
//
// =================================================================================================
// ESTE ARCHIVO ES LO ÚNICO QUE IMPIDE QUE UN «ARREGLO» RAZONABLE ROMPA PRODUCCIÓN EN SILENCIO.
// =================================================================================================
//
// `ZonaRepository.update` hace `deleteMany({ zonaId })` + `createMany(distritoIds)` (`:230-235`):
// REEMPLAZO TOTAL de `zona_distrito` con lo que mande el formulario. Si alguien «mejorase» este
// selector escondiendo los distritos retirados —o, peor, filtrando `initialSelected` para no
// pre-marcarlos—, el siguiente guardado de esa zona BORRARÍA sus filas. A partir de ahí ese
// distrito resolvería 0 zonas y toda alta futura moriría con «no tiene zona asignada»…
//
// …y NO SE PONDRÍA ROJO NADA: el bucle de la reconciliación hace `continue` cuando la zona resuelta
// es `null` (`ZonaRepository.ts:266-267`). Ni una excepción, ni un log, ni un test.
//
// Por eso las tres afirmaciones de abajo no son cosmética: son la red. Y por eso el caso marcado
// con ⭑ mira `onSelectedChange`, que es EXACTAMENTE lo que el formulario manda al servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeografiaSelector } from "@/app/(app)/configuracion/tarifas/_components/GeografiaSelector";
import type { ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

function distrito(
  id: string,
  nombre: string,
  activo: boolean,
): ProvinciaArbolDTO["cantones"][number]["distritos"][number] {
  return { id, nombre, zonaId: "z-sur", zonaNombre: "Zona Sur", zonaEspecial: false, activo };
}

//  Puntarenas (activa)
//    Buenos Aires (activo) → Cabagra (activo)  ·  Volcán (RETIRADO por su cuenta)
//    Osa (RETIRADO)        → Puerto Cortés (flag propio encendido ⇒ retirado por herencia)
const ARBOL: ProvinciaArbolDTO[] = [
  {
    id: "p-pu",
    nombre: "Puntarenas",
    activo: true,
    cantones: [
      {
        id: "c-ba",
        nombre: "Buenos Aires",
        activo: true,
        distritos: [distrito("d-cab", "Cabagra", true), distrito("d-vol", "Volcán", false)],
      },
      {
        id: "c-osa",
        nombre: "Osa",
        activo: false,
        distritos: [distrito("d-cortes", "Puerto Cortés", true)],
      },
    ],
  },
];

/** Los tres distritos de la zona que se está editando, incluidos los DOS retirados. */
const INICIALES = ["d-cab", "d-vol", "d-cortes"];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * La casilla de un distrito.
 *
 * Se busca por PREFIJO y no por el nombre completo porque el `<label>` del selector envuelve a la
 * vez la casilla y el texto de la fila, así que el nombre accesible que resulta es
 * «Seleccionar distrito Volcán Volcán(zona: Zona Sur)». Es una redundancia que viene de antes de
 * esta ficha y que no se toca aquí; lo que este archivo protege es otra cosa.
 */
function casillaDeDistrito(nombre: string): Promise<HTMLElement> {
  return screen.findByRole("checkbox", {
    name: new RegExp(String.raw`^Seleccionar distrito ${nombre}\b`),
  });
}

/** Monta el selector y despliega el árbol escribiendo en su buscador (`defaultOpen` con texto). */
async function montarYDesplegar(onSelectedChange?: (ids: string[]) => void) {
  const user = userEvent.setup();
  render(
    <GeografiaSelector
      provincias={ARBOL}
      initialSelected={INICIALES}
      onSelectedChange={onSelectedChange}
    />,
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
    "a",
  );
  return user;
}

describe("374/R47 — el selector de Tarifas SIGUE ofreciendo los nodos retirados", () => {
  it("se PINTAN, y con su distintivo: propio y heredado se distinguen", async () => {
    await montarYDesplegar();

    expect(await screen.findByText("Volcán")).toBeInTheDocument();
    expect(screen.getByText("Puerto Cortés")).toBeInTheDocument();
    expect(screen.getByText("Cabagra")).toBeInTheDocument();
    // El distintivo es lo ÚNICO que la ficha 374 añade aquí: marca, no esconde.
    // «Inactivo» sale DOS veces —el cantón Osa y el distrito Volcán, los dos con su flag propio
    // apagado— y «Inactivo por su cantón» una: Puerto Cortés, cuyo flag sigue encendido.
    expect(screen.getAllByText("Inactivo")).toHaveLength(2);
    expect(screen.getAllByText("Inactivo por su cantón")).toHaveLength(1);
    expect(screen.queryByText("Inactivo por su provincia")).toBeNull();
  });

  it("van MARCADOS si venían en `initialSelected`", async () => {
    await montarYDesplegar();

    expect(await casillaDeDistrito("Volcán")).toBeChecked();
    expect(await casillaDeDistrito("Puerto Cortés")).toBeChecked();
  });

  it("su casilla RESPONDE al clic, en los dos sentidos", async () => {
    const onSelectedChange = vi.fn();
    const user = await montarYDesplegar(onSelectedChange);

    const casilla = await casillaDeDistrito("Volcán");
    await user.click(casilla);
    expect(casilla).not.toBeChecked();
    expect(onSelectedChange).toHaveBeenLastCalledWith(["d-cab", "d-cortes"]);

    await user.click(casilla);
    expect(casilla).toBeChecked();
    expect(onSelectedChange).toHaveBeenLastCalledWith(["d-cab", "d-cortes", "d-vol"]);
  });

  it("⭑ LO QUE SE MANDA AL GUARDAR conserva los retirados que llegaron en `initialSelected`", async () => {
    // ESTE es el caso que impide el borrado silencioso de `zona_distrito`: sin tocar nada, el
    // formulario tiene que reportar los TRES ids, retirados incluidos. Un filtro por
    // disponibilidad en `initialSelected` —o en el árbol que se renderiza— deja aquí dos.
    const onSelectedChange = vi.fn();
    render(
      <GeografiaSelector
        provincias={ARBOL}
        initialSelected={INICIALES}
        onSelectedChange={onSelectedChange}
      />,
    );

    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).toHaveBeenCalledWith(["d-cab", "d-vol", "d-cortes"]);
  });

  it("⭑ y el árbol RENDERIZADO contiene los tres, sin filtro por disponibilidad", async () => {
    await montarYDesplegar();

    const casillas = await screen.findAllByRole("checkbox");
    const nombres = casillas.map((c) => c.getAttribute("aria-label"));
    expect(nombres).toEqual([
      "Seleccionar todos los distritos de Puntarenas",
      "Seleccionar todos los distritos de Buenos Aires",
      "Seleccionar distrito Cabagra",
      "Seleccionar distrito Volcán",
      "Seleccionar todos los distritos de Osa",
      "Seleccionar distrito Puerto Cortés",
    ]);
  });
});

describe("374/R39 — el filtro extraído colapsa los espacios, que el `norm()` viejo no hacía", () => {
  it("«puerto  cortes» con dos espacios y sin acentos encuentra «Puerto Cortés»", async () => {
    const user = userEvent.setup();
    render(<GeografiaSelector provincias={ARBOL} />);
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar en el catálogo geográfico" }),
      "puerto  cortes",
    );

    expect(await screen.findByText("Puerto Cortés")).toBeInTheDocument();
    expect(screen.queryByText("Cabagra")).toBeNull();
  });
});
