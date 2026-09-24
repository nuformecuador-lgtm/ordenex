import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { armarData } from "@/lib/services/WebhookEventoOrdenService";
import type { DatosEntregaEvento } from "@/lib/interfaces/repositories/IWebhookEventoReader";
import { EVENTO_PUBLICO_POR_TIPO } from "@/lib/types/orden-evento";

// FICHA 454 (T1.20, R32/R33/R34/R36) — EL CONTRATO PUBLICO DE LA FICHA, en sus TRES artefactos:
// el objeto TS (lo que sirve `/api/docs/openapi`), su espejo `.yaml` y el CHANGELOG del canal.
//
// Lo que se afirma aqui y en ningun otro sitio:
//   1. el schema `WebhookOrdenEvento` documenta EXACTAMENTE los eventos que el servicio emite
//      (derivados de `EVENTO_PUBLICO_POR_TIPO`), y las claves de su `data` en el MISMO orden que
//      las escribe `armarData` —la firma se calcula sobre el string serializado—;
//   2. `OrdenGestion.pendienteConfirmacion` y `HabilitacionRowResult.ayudaCerrada` existen, son
//      booleanos y REQUERIDOS en los dos artefactos;
//   3. el CHANGELOG anuncia la baja de `ayuda_tienda` y los eventos nuevos.

const RAIZ = path.resolve(__dirname, "../../..");
const yaml = fs.readFileSync(path.join(RAIZ, "docs", "api", "api-key-openapi.yaml"), "utf8");
const changelog = fs.readFileSync(path.join(RAIZ, "docs", "api", "CHANGELOG.md"), "utf8");

type Nodo = Record<string, unknown>;
const schemas = openApiSpec.components.schemas as unknown as Record<string, Nodo>;
const evento = schemas.WebhookOrdenEvento;
const propsEvento = evento.properties as Record<string, Nodo>;
const data = propsEvento.data as Nodo;
const propsData = data.properties as Record<string, Nodo>;

/** El bloque de texto de un schema del `.yaml` (de `    Nombre:` hasta el siguiente de su nivel). */
function bloqueYaml(nombre: string): string {
  const lineas = yaml.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === `    ${nombre}:`);
  if (inicio === -1) throw new Error(`el .yaml no declara el schema ${nombre}`);
  const salida: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (l.trim() !== "" && !l.trim().startsWith("#") && l.length - l.trimStart().length <= 4) break;
    salida.push(l);
  }
  return salida.join("\n");
}

/** Los items `- x` de la PRIMERA lista `enum:` que sigue a la clave `clave:` dentro de `texto`. */
function enumTrasClave(texto: string, clave: string): string[] {
  const lineas = texto.split("\n");
  const i = lineas.findIndex((l) => l.trim() === `${clave}:`);
  if (i === -1) throw new Error(`no se encontro la clave ${clave}`);
  const j = lineas.findIndex((l, k) => k > i && l.trim() === "enum:");
  const items: string[] = [];
  for (let k = j + 1; k < lineas.length; k++) {
    const m = /^\s*-\s+(\S+)\s*$/.exec(lineas[k]);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

function datosEntrega(over: Partial<DatosEntregaEvento> = {}): DatosEntregaEvento {
  return {
    ordenEventoId: "ev-1",
    tipo: "gestion_corregida",
    createdAt: new Date("2026-09-23T15:00:00.000Z"),
    gestionId: "g-1",
    resultado: "devolucion_a_origen_por_rechazo",
    resultadoAnterior: "entregado",
    causa: null,
    actorRol: "maestro",
    mensajero: { id: "m-1", nombre: "Carlos" },
    orden: { tiendaId: "t-1", numGuia: 1, numRemision: "R-1", deletedAt: null },
    ...over,
  } as DatosEntregaEvento;
}

describe("454/R33/R36 — `WebhookOrdenEvento`: los eventos y la forma que el servicio emite", () => {
  it("el `enum` de `evento` son los nombres publicos de `EVENTO_PUBLICO_POR_TIPO`, sin duplicados", () => {
    // Literal A MANO ademas de la derivacion: si el mapa ganara un nombre, las dos cosas cambian
    // juntas y este literal obliga a decidirlo aqui (es el contrato con el integrador).
    expect(propsEvento.evento.enum).toEqual([
      "orden.ayuda_resuelta",
      "orden.ayuda_solicitada",
      "orden.gestion_anulada",
      "orden.gestion_corregida",
      "orden.gestion_registrada",
    ]);
    expect(propsEvento.evento.enum).toEqual(
      [...new Set(Object.values(EVENTO_PUBLICO_POR_TIPO))].sort(),
    );
  });

  it("las claves de `data` estan en el MISMO orden que las escribe `armarData`", () => {
    // Un `gestion_corregida` trae todas salvo `via`; un `ayuda_resuelta`, `via`. La union de los
    // dos, en el orden del cuerpo real, es el orden del contrato.
    const corregida = Object.keys(armarData(datosEntrega()));
    const resuelta = Object.keys(
      armarData(
        datosEntrega({
          tipo: "ayuda_habilitada_api",
          gestionId: null,
          resultado: null,
          resultadoAnterior: null,
        } as Partial<DatosEntregaEvento>),
      ),
    );
    expect(corregida).toEqual([
      "numGuia",
      "numRemision",
      "gestionId",
      "resultado",
      "resultadoAnterior",
      "motivo",
      "mensajero",
      "pendienteConfirmacion",
    ]);
    expect(resuelta).toEqual(["numGuia", "numRemision", "motivo", "mensajero", "via"]);
    expect(Object.keys(propsData)).toEqual([...corregida, "via"]);
    // Las SIEMPRE presentes son las requeridas; el resto se omite.
    expect(data.required).toEqual(["numGuia", "numRemision", "motivo", "mensajero"]);
  });

  it("`via` publica los TRES caminos de cierre de la ayuda", () => {
    expect(propsData.via.enum).toEqual(["mensajero", "tienda", "api"]);
  });

  it("el `.yaml` publica el MISMO schema: mismo `enum` de eventos, mismas claves requeridas", () => {
    const bloque = bloqueYaml("WebhookOrdenEvento");
    expect(enumTrasClave(bloque, "evento")).toEqual(propsEvento.evento.enum);
    expect(enumTrasClave(bloque, "via")).toEqual(["mensajero", "tienda", "api"]);
    for (const clave of Object.keys(propsData)) {
      expect(bloque, `el .yaml no declara data.${clave}`).toMatch(new RegExp(`\\n {12}${clave}:\\n`));
    }
  });
});

describe("454/R32/R24/R36 — las dos claves NUEVAS de las respuestas REST", () => {
  it("`OrdenGestion.pendienteConfirmacion` es boolean y requerida, en el TS y en el .yaml", () => {
    const gestion = schemas.OrdenGestion;
    expect((gestion.properties as Record<string, Nodo>).pendienteConfirmacion.type).toBe("boolean");
    expect(gestion.required).toContain("pendienteConfirmacion");
    const bloque = bloqueYaml("OrdenGestion");
    expect(bloque).toContain("        - pendienteConfirmacion");
    expect(bloque).toMatch(/\n {8}pendienteConfirmacion:\n {10}type: boolean\n/);
  });

  it("`HabilitacionRowResult.ayudaCerrada` es boolean y requerida, en el TS y en el .yaml", () => {
    const fila = schemas.HabilitacionRowResult;
    expect((fila.properties as Record<string, Nodo>).ayudaCerrada.type).toBe("boolean");
    expect(fila.required).toEqual(["numGuia", "resultado", "estado", "ayudaCerrada", "error"]);
    const bloque = bloqueYaml("HabilitacionRowResult");
    expect(bloque).toContain("        - ayudaCerrada");
    expect(bloque).toMatch(/\n {8}ayudaCerrada:\n {10}type: boolean\n/);
  });
});

describe("454/R34/R36 — el CHANGELOG del canal anuncia el cambio", () => {
  const entrada = (() => {
    const titulo = "## 2026-09-23 — El estado de una gestión se aplica al APROBAR el cierre";
    const inicio = changelog.indexOf(titulo);
    if (inicio === -1) return "";
    const resto = changelog.slice(inicio + 3);
    const fin = resto.indexOf("\n## ");
    return fin === -1 ? resto : resto.slice(0, fin);
  })();

  it("existe la entrada fechada y no es un titulo vacio", () => {
    expect(entrada.length).toBeGreaterThan(1000);
  });

  it("anuncia la baja de `ayuda_tienda`, los cinco eventos y las dos claves nuevas", () => {
    expect(entrada).toContain("`ayuda_tienda`");
    for (const e of propsEvento.evento.enum as string[]) expect(entrada).toContain(`\`${e}\``);
    expect(entrada).toContain("pendienteConfirmacion");
    expect(entrada).toContain("ayudaCerrada");
    expect(entrada).toContain("TIPIFICADA");
  });
});
