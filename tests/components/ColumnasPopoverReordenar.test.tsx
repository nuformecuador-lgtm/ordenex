// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnasPopover } from "@/components/shared/ColumnasPopover";

// ---------------------------------------------------------------------------
// Ficha 314 (T13) — REORDENAR en el selector. Cubre R18, R19, R21, R22, R23, R24 y R25.
//
// El catálogo es SINTÉTICO y lo define este archivo: `ColumnasPopover` no importa ninguno, y
// que estas pruebas monten uno inventado ES la demostración de que no asume el número ni el
// contenido de las columnas de nadie (R35). Ningún caso afirma un total.
//
// R21 es lo que hace que este archivo pruebe el COMPONENTE y no una pantalla: el mismo control
// se monta con el ámbito del manifiesto y con el de la descarga de listados, y ofrece lo mismo
// en los dos. Reordenar vive en el componente, no en cada pantalla.
// ---------------------------------------------------------------------------

interface ColumnaFalsa {
  clave: string;
  encabezado: string;
}

/** Accesores a nivel de MÓDULO, como exige el diseño: identidad estable entre renders. */
const claveDe = (columna: ColumnaFalsa) => columna.clave;
const etiquetaDe = (columna: ColumnaFalsa) => columna.encabezado;
/** Etiqueta al estilo del manifiesto: `Etiqueta legible (clave_maquina)`. */
const etiquetaDeManifiesto = (columna: ColumnaFalsa) =>
  `${columna.encabezado} (${columna.clave})`;

const PUBLICADAS: readonly ColumnaFalsa[] = [
  { clave: "alfa", encabezado: "Columna Alfa" },
  { clave: "beta", encabezado: "Columna Beta" },
  { clave: "gama", encabezado: "Columna Gama" },
  { clave: "delta", encabezado: "Columna Delta" },
];

const CLAVE_DESCARGA = "ordenex:descarga-columnas:sintetico";
const CLAVE_MANIFIESTO = "ordenex:manifiesto-columnas:sintetico";

const TITULO = "Columnas del archivo";
const DISPARADOR = "Elegir columnas de la descarga";

function montar(
  props: Partial<React.ComponentProps<typeof ColumnasPopover<ColumnaFalsa>>> = {},
) {
  return render(
    <ColumnasPopover
      claveAlmacenamiento={CLAVE_DESCARGA}
      publicadas={PUBLICADAS}
      claveDe={claveDe}
      etiquetaDe={etiquetaDe}
      titulo={TITULO}
      etiquetaDisparador={DISPARADOR}
      {...props}
    />,
  );
}

async function abrir(disparador = DISPARADOR, titulo = TITULO) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: disparador }));
  await screen.findByText(titulo);
  return user;
}

/** Nombre accesible de una casilla, resuelto por su `aria-labelledby`. */
function nombreDe(casilla: HTMLElement): string {
  const id = casilla.getAttribute("aria-labelledby");
  return (id && document.getElementById(id)?.textContent) || "";
}

/** Las etiquetas de las casillas en el ORDEN en que están pintadas. */
function etiquetasEnPantalla(): string[] {
  return screen.getAllByRole("checkbox").map(nombreDe);
}

/** El estado marcado de cada casilla, en el orden de pantalla, indexado por su etiqueta. */
function marcadasPorEtiqueta(): Record<string, string | null> {
  const estado: Record<string, string | null> = {};
  for (const casilla of screen.getAllByRole("checkbox")) {
    estado[nombreDe(casilla)] = casilla.getAttribute("aria-checked");
  }
  return estado;
}

/** El orden persistido bajo esa clave, o `null` si no se escribió nada. */
function ordenGuardado(clave = CLAVE_DESCARGA): string[] | null {
  const crudo = window.localStorage.getItem(clave);
  if (crudo === null) return null;
  return (JSON.parse(crudo).orden as string[] | undefined) ?? null;
}

function guardarPreferencia(
  clave: string,
  preferencia: { ocultas?: string[]; orden?: string[] },
): void {
  window.localStorage.setItem(clave, JSON.stringify(preferencia));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ColumnasPopover — reordenar", () => {
  it("R18 — cada columna ofrece subir y bajar", async () => {
    montar();
    await abrir();

    for (const columna of PUBLICADAS) {
      expect(
        screen.getByRole("button", { name: `Subir ${columna.encabezado}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Bajar ${columna.encabezado}` }),
      ).toBeInTheDocument();
    }
  });

  it("R19 — mover una columna la reubica en la lista y persiste el orden", async () => {
    montar();
    const user = await abrir();

    const antes = etiquetasEnPantalla();
    // Se toma la SEGUNDA de pantalla y se sube: la evidencia es que ella y la primera
    // intercambian su sitio, sin afirmar cuántas hay ni cuál es cuál.
    const segunda = antes[1]!;
    await user.click(screen.getByRole("button", { name: `Subir ${segunda}` }));

    const despues = etiquetasEnPantalla();
    expect(despues[0]).toBe(segunda);
    expect(despues[1]).toBe(antes[0]);
    // El resto no se movió.
    expect(despues.slice(2)).toEqual(antes.slice(2));

    // Y quedó ESCRITO: la próxima descarga y el próximo montaje lo verán.
    expect(ordenGuardado()).toEqual(["beta", "alfa", "gama", "delta"]);
  });

  it("R19 — el orden guardado sigue vigente tras remontar el selector", async () => {
    const { unmount } = montar();
    const user = await abrir();
    await user.click(
      screen.getByRole("button", { name: `Bajar ${PUBLICADAS[0]!.encabezado}` }),
    );
    const trasMover = etiquetasEnPantalla();

    unmount();
    montar();
    await abrir();

    expect(etiquetasEnPantalla()).toEqual(trasMover);
  });

  it("R22 — la primera de la lista no puede subir", async () => {
    montar();
    const user = await abrir();

    const primera = etiquetasEnPantalla()[0]!;
    const subir = screen.getByRole("button", { name: `Subir ${primera}` });
    expect(subir).toBeDisabled();

    // Aunque el click llegue igualmente, la lista no se mueve y no se escribe nada.
    await user.click(subir);
    expect(etiquetasEnPantalla()[0]).toBe(primera);
    expect(window.localStorage.getItem(CLAVE_DESCARGA)).toBeNull();
  });

  it("R23 — la última de la lista no puede bajar", async () => {
    montar();
    const user = await abrir();

    const etiquetas = etiquetasEnPantalla();
    const ultima = etiquetas[etiquetas.length - 1]!;
    const bajar = screen.getByRole("button", { name: `Bajar ${ultima}` });
    expect(bajar).toBeDisabled();

    await user.click(bajar);
    const despues = etiquetasEnPantalla();
    expect(despues[despues.length - 1]).toBe(ultima);
    expect(window.localStorage.getItem(CLAVE_DESCARGA)).toBeNull();

    // Contraste: las que NO están en el extremo sí pueden, en los dos sentidos.
    expect(
      screen.getByRole("button", { name: `Subir ${ultima}` }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: `Bajar ${etiquetas[0]!}` }),
    ).not.toBeDisabled();
  });

  it("R24 — mover NO cambia el estado marcado de ninguna columna", async () => {
    // Se parte de una preferencia con una columna oculta, para que el estado no sea uniforme:
    // si mover tocara `ocultas`, la desmarcada volvería a marcarse y esto lo vería.
    guardarPreferencia(CLAVE_DESCARGA, { ocultas: ["gama"] });
    montar();
    const user = await abrir();

    const antes = marcadasPorEtiqueta();
    expect(antes["Columna Gama"]).toBe("false");
    expect(antes["Columna Alfa"]).toBe("true");

    await user.click(
      screen.getByRole("button", { name: "Bajar Columna Alfa" }),
    );

    expect(marcadasPorEtiqueta()).toEqual(antes);
    // Y en el almacenamiento las ocultas viajaron intactas.
    const crudo = JSON.parse(window.localStorage.getItem(CLAVE_DESCARGA)!);
    expect(crudo.ocultas).toEqual(["gama"]);
  });

  it("R25 — una columna DESMARCADA también se mueve", async () => {
    guardarPreferencia(CLAVE_DESCARGA, { ocultas: ["gama"] });
    montar();
    const user = await abrir();

    // La desmarcada aparece en la lista igual que las demás: por eso se puede mover.
    const gama = screen.getByRole("checkbox", { name: "Columna Gama" });
    expect(gama).toHaveAttribute("aria-checked", "false");

    const antes = etiquetasEnPantalla();
    const posicionAntes = antes.indexOf("Columna Gama");
    await user.click(screen.getByRole("button", { name: "Subir Columna Gama" }));

    const despues = etiquetasEnPantalla();
    expect(despues.indexOf("Columna Gama")).toBe(posicionAntes - 1);
    // Sigue desmarcada: moverla no la publicó en el archivo.
    expect(
      screen.getByRole("checkbox", { name: "Columna Gama" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(ordenGuardado()).toContain("gama");
  });

  it("R21 — el mismo selector ofrece reordenar en los DOS ámbitos", async () => {
    // Manifiesto y descarga son el mismo componente con otro ámbito: si uno ofreciera
    // reordenar y el otro no, sería una bifurcación por quién lo monta.
    const { unmount } = montar({
      claveAlmacenamiento: CLAVE_MANIFIESTO,
      etiquetaDe: etiquetaDeManifiesto,
      titulo: "Columnas del manifiesto",
      etiquetaDisparador: "Elegir columnas del manifiesto",
    });
    const userManifiesto = await abrir(
      "Elegir columnas del manifiesto",
      "Columnas del manifiesto",
    );

    const etiquetaManifiesto = etiquetasEnPantalla()[1]!;
    expect(etiquetaManifiesto).toContain("(beta)"); // el formato propio del manifiesto
    await userManifiesto.click(
      screen.getByRole("button", { name: `Subir ${etiquetaManifiesto}` }),
    );
    expect(etiquetasEnPantalla()[0]).toBe(etiquetaManifiesto);
    expect(ordenGuardado(CLAVE_MANIFIESTO)).toEqual([
      "beta",
      "alfa",
      "gama",
      "delta",
    ]);

    unmount();
    cleanup();

    // El MISMO componente, otro ámbito: ofrece exactamente lo mismo…
    montar();
    const userDescarga = await abrir();
    const etiquetaDescarga = etiquetasEnPantalla()[1]!;
    await userDescarga.click(
      screen.getByRole("button", { name: `Subir ${etiquetaDescarga}` }),
    );
    expect(etiquetasEnPantalla()[0]).toBe(etiquetaDescarga);
    expect(ordenGuardado(CLAVE_DESCARGA)).toEqual([
      "beta",
      "alfa",
      "gama",
      "delta",
    ]);

    // …y R10: cada ámbito escribió SOLO su clave, con su propio valor.
    expect(window.localStorage.getItem(CLAVE_MANIFIESTO)).not.toBeNull();
    expect(window.localStorage.getItem(CLAVE_DESCARGA)).not.toBeNull();
  });

  it("el foco no se pierde cuando la columna llega al extremo", async () => {
    // Sin esto, mover una columna hasta el final deshabilita el botón que se estaba pulsando y
    // el foco vuelve al `body`: quien navega con teclado se queda sin sitio desde el que
    // seguir. El foco pasa al botón CONTRARIO de la misma fila.
    montar();
    const user = await abrir();

    const primera = etiquetasEnPantalla()[0]!;
    await user.click(screen.getByRole("button", { name: `Bajar ${primera}` }));
    // Aún no está en el extremo: el foco se queda donde estaba, en «Bajar».
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Bajar ${primera}` }),
    );

    await user.click(screen.getByRole("button", { name: `Bajar ${primera}` }));
    await user.click(screen.getByRole("button", { name: `Bajar ${primera}` }));

    // Ya es la última: «Bajar» quedó deshabilitado y el foco está en «Subir».
    expect(
      screen.getByRole("button", { name: `Bajar ${primera}` }),
    ).toBeDisabled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Subir ${primera}` }),
    );
  });
});
