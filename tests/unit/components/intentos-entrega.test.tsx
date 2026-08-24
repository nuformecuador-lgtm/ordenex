// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { DataTable } from "@/components/shared/DataTable";
// Feature 276 (T11/T12): el quitador de comentarios unico del repo (feature 209).
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import {
  INTENTOS_COLUMN_ID,
  INTENTOS_LABEL,
  IntentosDato,
  IntentosValor,
  columnaIntentos,
  valorIntentos,
} from "@/components/shared/intentos-entrega";

// Feature 160 (T15) — la pieza compartida: UNA definicion del dato, DOS formas de
// presentacion. Estos tests fijan lo que las 12 superficies heredan; si esto se rompe,
// se rompen las doce a la vez.

afterEach(() => {
  cleanup();
});

interface Fila {
  id: string;
  numRemision: string;
  intentosEntrega?: number;
}

function tabla(filas: Fila[]) {
  const columns = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" as const },
    columnaIntentos<Fila>(),
  ];
  return render(
    <DataTable columns={columns} data={filas} rowKey="id" ariaLabel="Órdenes" />,
  );
}

describe("valorIntentos — R19: el valor SIEMPRE se resuelve a un numero", () => {
  it("devuelve el conteo tal cual cuando el backend lo envia", () => {
    expect(valorIntentos({ intentosEntrega: 3 })).toBe(3);
  });

  it("devuelve 0 cuando el conteo es 0 (no lo confunde con ausencia)", () => {
    expect(valorIntentos({ intentosEntrega: 0 })).toBe(0);
  });

  it("devuelve 0 cuando el campo NO viaja (fixture viejo), nunca undefined", () => {
    expect(valorIntentos({})).toBe(0);
    // El punto del requisito: lo que se pinta es un numero, no un hueco.
    expect(typeof valorIntentos({})).toBe("number");
  });
});

describe("columnaIntentos — R17: columna propia con encabezado 'Intentos'", () => {
  it("expone el id y el encabezado declarados por el contrato compartido", () => {
    const columna = columnaIntentos<Fila>();
    expect(columna.id).toBe(INTENTOS_COLUMN_ID);
    expect(INTENTOS_COLUMN_ID).toBe("intentos");
    expect(columna.value).toBe(INTENTOS_LABEL);
    expect(INTENTOS_LABEL).toBe("Intentos");
  });

  it("R17: la tabla monta un columnheader 'Intentos'", () => {
    tabla([{ id: "o1", numRemision: "REM-1", intentosEntrega: 2 }]);
    expect(
      screen.getByRole("columnheader", { name: INTENTOS_LABEL }),
    ).toBeInTheDocument();
  });

  it("R19: la celda muestra el NUMERO correcto (2), no una marca generica", () => {
    tabla([{ id: "o1", numRemision: "REM-1", intentosEntrega: 2 }]);
    const fila = screen.getByRole("row", { name: /REM-1/ });
    const celdas = within(fila).getAllByRole("cell");
    // La columna de intentos es la 2.a: su celda dice exactamente "2".
    expect(celdas[1]).toHaveTextContent(/^2$/);
  });

  it("R19: con conteo 0 la celda dice '0' — ni vacia ni con el placeholder '—'", () => {
    tabla([{ id: "o1", numRemision: "REM-0", intentosEntrega: 0 }]);
    const celdas = within(screen.getByRole("row", { name: /REM-0/ })).getAllByRole(
      "cell",
    );
    expect(celdas[1]).toHaveTextContent(/^0$/);
    expect(celdas[1].textContent).not.toBe("");
    expect(celdas[1].textContent).not.toContain("—");
  });

  it("R19: con el campo AUSENTE la celda tambien dice '0'", () => {
    tabla([{ id: "o1", numRemision: "REM-X" }]);
    const celdas = within(screen.getByRole("row", { name: /REM-X/ })).getAllByRole(
      "cell",
    );
    expect(celdas[1]).toHaveTextContent(/^0$/);
  });

  it("cada fila lleva su propio numero (la columna no pinta un valor fijo)", () => {
    tabla([
      { id: "o1", numRemision: "REM-A", intentosEntrega: 0 },
      { id: "o2", numRemision: "REM-B", intentosEntrega: 4 },
    ]);
    expect(
      within(screen.getByRole("row", { name: /REM-A/ })).getAllByRole("cell")[1],
    ).toHaveTextContent(/^0$/);
    expect(
      within(screen.getByRole("row", { name: /REM-B/ })).getAllByRole("cell")[1],
    ).toHaveTextContent(/^4$/);
  });
});

describe("IntentosValor — enfasis REDUNDANTE, nunca portador unico (a11y)", () => {
  it("con >= 1 resalta, pero el numero sigue siendo el texto visible", () => {
    render(<IntentosValor intentos={3} />);
    const nodo = screen.getByText("3");
    expect(nodo).toBeInTheDocument();
    expect(nodo.className).toContain("font-semibold");
  });

  it("con 0 se renderiza igual (no devuelve null) y sin resalte", () => {
    render(<IntentosValor intentos={0} />);
    const nodo = screen.getByText("0");
    expect(nodo).toBeInTheDocument();
    expect(nodo.className).not.toContain("font-semibold");
  });
});

describe("IntentosDato — R18: dato etiquetado 'Intentos: N'", () => {
  it("renderiza la etiqueta Y el numero en la misma linea", () => {
    render(<IntentosDato intentos={2} />);
    expect(screen.getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("R19: con 0 se renderiza igual, no se omite el dato", () => {
    const { container } = render(<IntentosDato intentos={0} />);
    expect(screen.getByText("Intentos: 0")).toBeInTheDocument();
    expect(container.textContent).toBe("Intentos: 0");
  });

  it("no impone tamano de texto propio: lo hereda del contenedor", () => {
    // R18 pide "el mismo tratamiento visual que los campos hermanos": si el dato
    // trajera su propio tamano de fuente, se veria distinto en cada superficie.
    const { container } = render(<IntentosDato intentos={1} />);
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });

  it("acepta className para adoptar el markup de la superficie que lo hospeda", () => {
    const { container } = render(
      <IntentosDato intentos={1} className="text-sm text-muted-foreground" />,
    );
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toContain("text-sm");
  });
});

describe("R20 — el umbral NO viaja al cliente en ninguna de las dos formas", () => {
  it("ni la columna ni el dato etiquetado muestran un 'de N'", () => {
    tabla([{ id: "o1", numRemision: "REM-1", intentosEntrega: 2 }]);
    render(<IntentosDato intentos={2} />);
    expect(screen.queryByText(/\bde\s+\d+/)).toBeNull();
  });

  it("contrato: el modulo no importa ni nombra la configuracion del umbral", () => {
    const fuente = readFileSync(
      resolve(process.cwd(), "components/shared/intentos-entrega.tsx"),
      "utf8",
    );
    expect(fuente).not.toContain("reintentosConfig");
    expect(fuente).not.toContain("MIN_INTENTOS_ENTREGA");
    expect(fuente).not.toContain("lib/config/reintentos");
  });
});

// =================================================================================================
// FEATURE 276 (T11/T12, R10) — LAS DOS SUPERFICIES QUE CREAN GESTION TAMPOCO SE LLEVAN EL UMBRAL.
// =================================================================================================
//
// La 160/R20 (arriba) fijo este contrato para la pieza compartida de intentos. La 276 añade dos
// consumidores que SI toman una decision con el umbral —que botones ofrecer— y por eso el contrato
// hay que repetirlo sobre ellos: la tentacion natural al escribir esa pantalla es importar
// `reintentosConfig` y comparar, y eso mandaria la configuracion al navegador.
//
// Lo que hacen en su lugar: leer el booleano `enElTope`, que el SERVIDOR ya decidio, y filtrar los
// desenlaces con `permitidoEnElTope`, un modulo puro que tampoco trae el umbral dentro.
describe("276/R10 — el umbral no cruza por el panel del mensajero ni por la ventana de la tienda", () => {
  const SUPERFICIES = [
    "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx",
    "app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx",
  ];

  it.each(SUPERFICIES)("%s no importa ni nombra la configuracion del umbral", (ruta) => {
    // Se mira el CODIGO, no la prosa: los comentarios de estos dos archivos nombran el umbral a
    // proposito —explican por que NO se importa— y un barrido sobre el texto crudo obligaria a
    // borrar justo la explicacion. Es el quitador unico del repo (feature 209).
    const codigo = codigoSinComentarios(ruta);
    // Anti-vacuidad: si la ruta cambiara de sitio, `readFileSync` lanza; si quedara vacia, esto lo
    // dice antes de que tres `not.toContain` pasen en verde sobre la nada.
    expect(codigo.length).toBeGreaterThan(1000);
    expect(codigo).not.toContain("reintentosConfig");
    expect(codigo).not.toContain("MIN_INTENTOS_ENTREGA");
    expect(codigo).not.toContain("lib/config/reintentos");
  });

  it("lo que SI leen es el modulo puro de la regla, que tampoco trae el umbral dentro", () => {
    for (const ruta of SUPERFICIES) {
      expect(codigoSinComentarios(ruta)).toContain("@/lib/types/tope-intentos");
    }
    // El eslabon que cierra la cadena: importarlo no arrastra la configuracion (el modulo tiene su
    // propio caso literal en `tests/unit/types/tope-intentos.test.ts`).
    const modulo = codigoSinComentarios("lib/types/tope-intentos.ts");
    expect(modulo).not.toContain("reintentosConfig");
    expect(modulo).not.toContain("MIN_INTENTOS_ENTREGA");
  });
});

describe("D6 — el diseno de CHIP quedo descartado, no aplazado", () => {
  it("el modulo no exporta badge/chip de intentos", async () => {
    const modulo = await import("@/components/shared/intentos-entrega");
    expect("IntentosEntregaBadge" in modulo).toBe(false);
    expect("conChipIntentos" in modulo).toBe(false);
  });
});
