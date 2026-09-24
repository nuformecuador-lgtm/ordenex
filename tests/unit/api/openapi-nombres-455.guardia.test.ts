import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

/**
 * FICHA 455 (T1.8 · G5, design §6.5; R24, R25, R29, R44) — EL CONTRATO PUBLICA EL NOMBRE AL LADO DE
 * CADA CODIGO.
 *
 * Recorre el objeto OpenAPI entero: todo schema con una propiedad que lleva un CODIGO de estado o de
 * resultado (`estado`, `estadoResultante`, `estadoAnterior`, `resultadoAnterior`, y `resultado`
 * cuando su `enum` son codigos del catalogo) debe declarar su hermana `…Nombre`, y si el codigo es
 * `required`, el nombre tambien. Un `resultado` que NO es un codigo de estado (`creada`, `cotizada`,
 * `habilitada`, `error`) queda fuera: no hay estado que nombrar.
 *
 * Y R29: el catalogo publicado es EXACTAMENTE el vigente (20), y el resultado los 5.
 * El detector se prueba contra una mutacion en este mismo archivo (R44).
 */

type Nodo = Record<string, unknown>;
const CODIGOS = new Set<string>(ORDER_STATUS_SEED);
const CAMPOS = ["estado", "estadoResultante", "estadoAnterior", "resultadoAnterior", "resultado"] as const;

function llevaCodigo(campo: string, prop: Nodo): boolean {
  if (campo !== "resultado") return true;
  const valores = (prop.enum as unknown[] | undefined) ?? (prop.const !== undefined ? [prop.const] : []);
  return valores.length > 0 && valores.every((v) => v === null || CODIGOS.has(String(v)));
}

/** Las faltas de `…Nombre` en un documento OpenAPI (vacio = cumple). */
export function faltasDeNombre(doc: unknown, ruta = "$"): string[] {
  const faltas: string[] = [];
  const visitar = (n: unknown, r: string) => {
    if (Array.isArray(n)) {
      n.forEach((x, i) => visitar(x, `${r}[${i}]`));
      return;
    }
    if (!n || typeof n !== "object") return;
    const nodo = n as Nodo;
    const props = nodo.properties as Nodo | undefined;
    if (props && typeof props === "object") {
      const required = (nodo.required as string[] | undefined) ?? [];
      for (const campo of CAMPOS) {
        const prop = props[campo] as Nodo | undefined;
        if (!prop || !llevaCodigo(campo, prop)) continue;
        const nombre = `${campo}Nombre`;
        if (!(nombre in props)) faltas.push(`${r}.properties.${nombre}`);
        else if (required.includes(campo) && !required.includes(nombre)) faltas.push(`${r}.required ${nombre}`);
      }
    }
    for (const [k, v] of Object.entries(nodo)) visitar(v, `${r}.${k}`);
  };
  visitar(doc, ruta);
  return faltas;
}

const YAML = fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml"), "utf8");
const schemas = (openApiSpec.components as Nodo).schemas as Record<string, Nodo>;
const props = (s: string) => schemas[s].properties as Record<string, Nodo>;

describe("455/G5 — el detector de `…Nombre` no esta roto", () => {
  it("MUTACION (R44): un schema con `estado` sin `estadoNombre`, o con el nombre fuera de `required`, se denuncia", () => {
    const sinNombre = { components: { schemas: { X: { required: ["estado"], properties: { estado: { type: "string" } } } } } };
    expect(faltasDeNombre(sinNombre)).toEqual(["$.components.schemas.X.properties.estadoNombre"]);
    const noRequerido = {
      X: { required: ["estado"], properties: { estado: { type: "string" }, estadoNombre: { type: "string" } } },
    };
    expect(faltasDeNombre(noRequerido)).toEqual(["$.X.required estadoNombre"]);
  });

  it("un `resultado` que no es un codigo de estado no pide nombre", () => {
    const carga = { X: { properties: { resultado: { type: "string", enum: ["creada", "duplicada"] } } } };
    expect(faltasDeNombre(carga)).toEqual([]);
    const gestion = { X: { properties: { resultado: { type: "string", enum: ["novedad", "entregado"] } } } };
    expect(faltasDeNombre(gestion)).toEqual(["$.X.properties.resultadoNombre"]);
  });
});

describe("455/R24 · R25 · R29 (G5) — el contrato publicado", () => {
  it("R24/R25: ningun codigo sin su `…Nombre` en todo el objeto OpenAPI", () => {
    expect(faltasDeNombre(openApiSpec)).toEqual([]);
  });

  it("no-vacuidad: los once `…Nombre` estan donde el diseño los pide", () => {
    expect(Object.keys(props("OrdenListItem"))).toContain("estadoNombre");
    expect(Object.keys(props("OrdenGestion"))).toEqual(expect.arrayContaining(["resultadoNombre", "estadoResultanteNombre"]));
    expect(Object.keys(props("Evidencia"))).toContain("resultadoNombre");
    expect(Object.keys(props("CancelacionResponse"))).toEqual(
      expect.arrayContaining(["estadoAnteriorNombre", "estadoNombre"]),
    );
    expect(Object.keys(props("EliminacionResponse"))).toContain("estadoNombre");
    expect(Object.keys(props("HabilitacionRowResult"))).toContain("estadoNombre");
    expect(Object.keys(props("CargaOrden"))).toContain("estadoNombre");
    expect(Object.keys(props("CargaRowResult"))).toEqual(expect.arrayContaining(["estado", "estadoNombre"]));
    expect(Object.keys(props("CargaRowResult"))).not.toContain("estatus");
    const dataEstado = ((props("WebhookOrdenEstadoActualizado").data as Nodo).properties) as Nodo;
    const claves = Object.keys(dataEstado);
    expect(claves[claves.indexOf("estado") + 1]).toBe("estadoNombre"); // R25: pegado detras
    const dataEvento = ((props("WebhookOrdenEvento").data as Nodo).properties) as Nodo;
    expect(Object.keys(dataEvento)).toEqual(expect.arrayContaining(["resultadoNombre", "resultadoAnteriorNombre"]));
  });

  it("R29: el catalogo publicado es EXACTAMENTE el vigente, en su orden, y el resultado los cinco", () => {
    expect(props("OrdenListItem").estado.enum).toEqual([...ORDER_STATUS_SEED]);
    expect(props("OrdenGestion").resultado.enum).toEqual([
      "devolucion_a_origen_por_rechazo",
      "entregado",
      "incidente",
      "novedad",
      "reprogramado",
    ]);
  });

  it("el `.yaml` espejo declara cada `…Nombre` tantas veces como el objeto TS", () => {
    const cuenta = (re: RegExp) => (YAML.match(re) ?? []).length;
    const enTs = (nombre: string) => (JSON.stringify(schemas).match(new RegExp(`"${nombre}":\\{"type"`, "g")) ?? []).length;
    for (const nombre of ["estadoNombre", "resultadoNombre", "estadoResultanteNombre", "estadoAnteriorNombre", "resultadoAnteriorNombre"]) {
      expect(cuenta(new RegExp(`^\\s+${nombre}:\\s*$`, "gm")), nombre).toBe(enTs(nombre));
    }
    expect(YAML).not.toMatch(/^\s+estatus:/m);
  });
});
