import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import {
  MSG_CANTON_RETIRADO,
  MSG_PROVINCIA_RETIRADA,
  msgDistritoRetirado,
} from "@/lib/services/geo-resolucion";

// FICHA 374 / I1-I2 (R37) — **EL CANAL PUBLICA EL MOTIVO DE FILA NUEVO, EN LOS DOS ARTEFACTOS.**
//
// POR QUE ESTO ES PARTE DEL DESPLIEGUE Y NO CORTESIA. `resolveGeo` lo comparten la carga masiva por
// sesion Y la cotizacion por API key, asi que el rechazo por «nodo retirado» CAMBIA EL CONTRATO DE
// UNA API PARA TERCEROS: hay integradores con codigo escrito contra ella. La cabecera de
// `docs/api/CHANGELOG.md` fija la convencion —entrada fechada ANTES de la release— y esta ficha
// entra por ahi.
//
// LO QUE VIGILA ESTE ARCHIVO, y son tres cosas distintas:
//   1. que los DOS artefactos —el objeto TS que sirve `/api/docs/openapi` y su espejo textual
//      `docs/api/api-key-openapi.yaml`— lo digan, y digan LO MISMO. Un espejo que se queda atras no
//      rompe ningun test de runtime: solo le enseña al integrador una respuesta que ya no es;
//   2. que lo que el contrato promete sea EXACTAMENTE lo que el codigo emite. Los mensajes se
//      IMPORTAN de `geo-resolucion.ts`, no se reescriben aqui: un literal copiado a mano se queda
//      atras a la primera errata corregida en un solo lado;
//   3. que la entrada del changelog EXISTA, con su fecha y su titulo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const yaml = fs.readFileSync(path.join(RAIZ, "docs", "api", "api-key-openapi.yaml"), "utf8");
/**
 * El yaml ESCAPA las comillas dentro de una cadena entrecomillada (`\"error\"`), asi que su texto
 * crudo nunca contendria literalmente la descripcion del objeto TS. Se desescapan para poder
 * comparar las dos por su CONTENIDO, que es lo que el integrador lee.
 */
const yamlLegible = yaml.replace(/\\"/g, '"');
const changelog = fs.readFileSync(path.join(RAIZ, "docs", "api", "CHANGELOG.md"), "utf8");

const schemas = openApiSpec.components.schemas;

/** El objeto TS entero, serializado: la forma mas simple de preguntarle «¿dices esto?». */
const specTexto = JSON.stringify(openApiSpec);

const FECHA = "2026-09-06";

describe("374/R37 — los DOS artefactos declaran el rechazo por nodo RETIRADO", () => {
  it("anti-vacuidad: los dos artefactos se leyeron y no estan vacios", () => {
    expect(specTexto.length).toBeGreaterThan(10_000);
    expect(yaml.length).toBeGreaterThan(10_000);
  });

  it("el objeto TS nombra el motivo en las tres claves de la terna de `CotizacionRow`", () => {
    const props = schemas.CotizacionRow.properties as Record<string, { description?: string }>;
    for (const clave of ["provincia", "canton", "distrito"]) {
      expect(props[clave]?.description, `\`${clave}\` no menciona la retirada`).toMatch(
        /RETIRAD[AO] del catálogo/,
      );
    }
  });

  it("el objeto TS nombra el motivo en las tres claves de la terna de `CargaRow`", () => {
    const props = schemas.CargaRow.properties as Record<string, { description?: string }>;
    for (const clave of ["provincia", "canton", "distrito"]) {
      expect(props[clave]?.description, `\`${clave}\` no menciona la retirada`).toMatch(
        /RETIRAD[AO] del catálogo/,
      );
    }
  });

  it("el ESPEJO textual dice lo mismo: las seis descripciones estan en el yaml", () => {
    const props = {
      ...(schemas.CotizacionRow.properties as Record<string, { description?: string }>),
    };
    const cargaProps = schemas.CargaRow.properties as Record<string, { description?: string }>;
    for (const clave of ["provincia", "canton", "distrito"] as const) {
      // La descripcion EXACTA del objeto TS tiene que aparecer literalmente en el yaml: es la
      // unica forma de que «dicen lo mismo» sea una medida y no una impresion.
      expect(yamlLegible, `${clave} de CotizacionRow no esta en el yaml`).toContain(
        props[clave]?.description as string,
      );
      expect(yamlLegible, `${clave} de CargaRow no esta en el yaml`).toContain(
        cargaProps[clave]?.description as string,
      );
    }
  });

  it("⭑ el contrato publica EXACTAMENTE los mensajes que el codigo emite", () => {
    // Se IMPORTAN de `geo-resolucion.ts`. Si alguien corrige una errata en un solo lado, esto se
    // pone rojo en vez de dejar el documento mintiendo.
    const distrito = msgDistritoRetirado("Cabagra");
    expect(specTexto).toContain(distrito);
    expect(yaml).toContain(distrito);

    // Los otros dos viajan en la prosa del schema de fila, que es donde se enumeran los motivos.
    const prosa = schemas.CotizacionRow.description as string;
    expect(prosa).toContain(MSG_PROVINCIA_RETIRADA);
    expect(prosa).toContain(MSG_CANTON_RETIRADO);
    expect(yaml).toContain(MSG_PROVINCIA_RETIRADA);
    expect(yaml).toContain(MSG_CANTON_RETIRADO);
  });

  it("el contrato deja dicho que SIGUE siendo 200 con exito parcial, no un error de lote", () => {
    // Es la mitad que un integrador necesita para NO tratar esto como una caida: la fila retirada
    // no aborta el lote.
    const prosa = schemas.CotizacionRow.description as string;
    expect(prosa).toMatch(/éxito parcial/);
    expect(prosa).toMatch(/precedencia|primero provincia/i);
  });

  it("el ejemplo de la respuesta de `/cotizacion` muestra una fila retirada en `errores`", () => {
    // Un ejemplo es lo primero que se lee en Swagger UI: si solo lo dijera la prosa, nadie lo veria.
    expect(specTexto).toContain("esta retirado del catalogo");
    expect(yaml).toContain("esta retirado del catalogo");
  });
});

describe("374/R37 — la entrada del changelog existe, fechada y con su aviso", () => {
  it(`hay una entrada del ${FECHA} sobre el motivo de fila nuevo`, () => {
    const titulo = changelog
      .split("\n")
      .find((l) => l.startsWith(`## ${FECHA}`));
    expect(titulo, `no hay entrada fechada ${FECHA} en docs/api/CHANGELOG.md`).toBeDefined();
    expect(titulo).toMatch(/RETIRAD/i);
  });

  it("la entrada dice las tres cosas que el aviso tiene que decir", () => {
    const desde = changelog.indexOf(`## ${FECHA}`);
    const siguiente = changelog.indexOf("\n## ", desde + 1);
    const entrada = changelog.slice(desde, siguiente === -1 ? undefined : siguiente);

    // (a) QUE cambia: los tres mensajes, tal como el codigo los emite.
    expect(entrada).toContain(MSG_PROVINCIA_RETIRADA);
    expect(entrada).toContain(MSG_CANTON_RETIRADO);
    expect(entrada).toContain("esta retirado del catalogo");
    // (b) QUE NO cambia: sigue siendo 200 con exito parcial y no se toca ningun schema.
    expect(entrada).toMatch(/200/);
    expect(entrada).toMatch(/éxito parcial/);
    // (c) QUE HACER si tu codigo enumera los motivos.
    expect(entrada).toMatch(/si tu código enumera/i);
    // Y es un aviso para copiar y mandar, no una nota de dos lineas.
    expect(entrada.length).toBeGreaterThan(800);
  });
});
