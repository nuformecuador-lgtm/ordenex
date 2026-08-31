import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  PARAM_TERMINO_DEFAULT,
  activosDesdeUrl,
  queryTrasLimpiar,
  seleccionDesdeUrl,
  terminoDesdeUrl,
  valoresDeParam,
} from "@/lib/utils/filtros-url";
import type { FilterDef } from "@/components/shared/FilterComponent";

// Feature 335 / T1.2 + T1.4 — el codec PURO: formato de los valores (R4, R8, R9) y
// borrado de «Limpiar todo» (R15, R19, R20, R21).
//
// Sin renderizar nada: si para escribir un caso hiciera falta un componente, la logica
// estaria en el lugar equivocado.

const ZONA: FilterDef = {
  key: "zona_id",
  label: "Zona",
  kind: "multi",
  options: [{ value: "A", label: "A" }, { value: "B", label: "B" }],
};

describe("valoresDeParam — formato de los valores", () => {
  it("R8 — parte un param por coma en una lista de valores", () => {
    const params = new URLSearchParams("zona_id=A,B");
    expect(valoresDeParam(params, "zona_id")).toEqual(["A", "B"]);
  });

  it("R8 — recorta los espacios de los extremos de cada trozo", () => {
    const params = new URLSearchParams("zona_id= A , B ");
    expect(valoresDeParam(params, "zona_id")).toEqual(["A", "B"]);
  });

  it("R8 — descarta las partes vacias", () => {
    const params = new URLSearchParams("zona_id=A,,B,");
    expect(valoresDeParam(params, "zona_id")).toEqual(["A", "B"]);
  });

  it("R9 — concatena las apariciones repetidas en el orden de la URL", () => {
    const params = new URLSearchParams("zona_id=A&zona_id=B,C");
    expect(valoresDeParam(params, "zona_id")).toEqual(["A", "B", "C"]);
  });

  it("R8 — un param ausente da lista vacia", () => {
    expect(valoresDeParam(new URLSearchParams(""), "zona_id")).toEqual([]);
  });

  it("R4 — el nombre del param es exactamente FilterDef.key, sin prefijo ni transformacion", () => {
    // La clave declarada lleva guion bajo y se busca TAL CUAL: ni `f.zona_id`, ni
    // `zonaId`, ni `zona`. Estas tres variantes existen en la URL y ninguna cuenta.
    const params = new URLSearchParams("f.zona_id=A&zonaId=A&zona=A");
    expect(seleccionDesdeUrl(params, [ZONA])).toEqual({});

    const conLaClave = new URLSearchParams(`${ZONA.key}=A`);
    expect(seleccionDesdeUrl(conLaClave, [ZONA])).toEqual({ zona_id: ["A"] });
  });
});

describe("terminoDesdeUrl y activosDesdeUrl", () => {
  it("R1 — el termino libre llega recortado desde su param", () => {
    const params = new URLSearchParams(`${PARAM_TERMINO_DEFAULT}=  guia123  `);
    expect(terminoDesdeUrl(params, PARAM_TERMINO_DEFAULT)).toBe("guia123");
  });

  it("R1 — sin param, el termino es cadena vacia", () => {
    expect(terminoDesdeUrl(new URLSearchParams(""), "q")).toBe("");
  });

  it("R2 — las claves activas salen en el orden OFRECIDO, no en el de la URL", () => {
    const params = new URLSearchParams("zona_id=A&mensajero_id=M");
    const ofrecidos = [{ key: "mensajero_id" }, { key: "zona_id" }, { key: "tienda_id" }];
    expect(activosDesdeUrl(params, ofrecidos)).toEqual(["mensajero_id", "zona_id"]);
  });

  it("R2 — una clave repetida en la URL se activa exactamente una vez", () => {
    const params = new URLSearchParams("zona_id=A&zona_id=B");
    expect(activosDesdeUrl(params, [{ key: "zona_id" }])).toEqual(["zona_id"]);
  });

  it("R15 — un param que no corresponde a ningun filtro ofrecido no activa nada", () => {
    const params = new URLSearchParams("cierre=abc");
    expect(activosDesdeUrl(params, [{ key: "zona_id" }])).toEqual([]);
  });
});

describe("queryTrasLimpiar — «Limpiar todo» (R19-R21)", () => {
  it("R19 — quita el param del termino y las claves propias", () => {
    const params = new URLSearchParams("q=abc&zona_id=A&mensajero_id=M");
    expect(queryTrasLimpiar(params, ["q", "zona_id", "mensajero_id"])).toBe("");
  });

  it("R20 — conserva los params ajenos con su valor y sin reordenarlos", () => {
    const params = new URLSearchParams("uno=1&q=abc&dos=2&zona_id=A&tres=3");
    expect(queryTrasLimpiar(params, ["q", "zona_id"])).toBe("uno=1&dos=2&tres=3");
  });

  it("R15/R20 — la URL real de cierres-admin: `?cierre=<uuid>&mensajero=<id>` conserva el cierre", () => {
    // `CierresAdminModule` monta la barra de filtros Y lee `?cierre=` para abrir el
    // detalle. Borrar la query entera cerraria ese detalle de golpe.
    const uuid = "3f2b1c7a-0d4e-4a6b-9c11-5e8f2a7d6b40";
    const params = new URLSearchParams(`cierre=${uuid}&mensajero=42`);
    expect(queryTrasLimpiar(params, ["q", "mensajero"])).toBe(`cierre=${uuid}`);
  });

  it("R21 — sin ningun par restante devuelve cadena vacia", () => {
    expect(queryTrasLimpiar(new URLSearchParams("q=abc"), ["q"])).toBe("");
    expect(queryTrasLimpiar(new URLSearchParams(""), ["q"])).toBe("");
  });

  it("R20 — un param ajeno repetido conserva sus dos apariciones", () => {
    const params = new URLSearchParams("tag=a&q=x&tag=b");
    expect(queryTrasLimpiar(params, ["q"])).toBe("tag=a&tag=b");
  });
});

describe("pureza del modulo", () => {
  it("R4 — el codec no importa react ni next (es puro, se prueba sin renderizar)", () => {
    const fuente = readFileSync(
      path.join(process.cwd(), "lib/utils/filtros-url.ts"),
      "utf8",
    );
    const origenes = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(origenes.length).toBeGreaterThan(0);
    for (const origen of origenes) {
      expect(origen).not.toMatch(/^react(\/|$)/);
      expect(origen).not.toMatch(/^next(\/|$)/);
    }
    expect(fuente).not.toMatch(/require\(\s*"(react|next)/);
  });
});
