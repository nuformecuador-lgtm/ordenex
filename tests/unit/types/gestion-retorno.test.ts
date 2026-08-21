import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  RESULTADOS_QUE_VUELVEN,
  RETORNA_A_BODEGA,
  vuelveABodega,
} from "@/lib/types/gestion-retorno";

// Feature 238 (T1.1, R1/R2/R3/R5) — el PUNTO UNICO de «que paquete vuelve a bodega».
//
// Los cinco resultados del enum `GestionResultado` (`db/schema.prisma:706`) se escriben A MANO:
// si se derivaran del propio mapa, el test comprobaria que el mapa es igual a si mismo y estaria
// verde con cualquier contenido. Mismo criterio que `gestion-destino.test.ts` (239).
const RESULTADOS = ["entregada", "reprogramada", "devuelta", "rechazada", "incidente"] as const;

const FUENTE = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "lib", "types", "gestion-retorno.ts"),
  "utf8",
);

describe("RETORNA_A_BODEGA — el mapa exhaustivo (238/R1/R5)", () => {
  it("R1/R5: los CINCO resultados estan declarados, ninguno de mas ni de menos", () => {
    expect(Object.keys(RETORNA_A_BODEGA).sort()).toEqual([...RESULTADOS].sort());
  });

  it("R2: vuelven `devuelta`, `rechazada` y `reprogramada`", () => {
    expect(vuelveABodega("devuelta")).toBe(true);
    expect(vuelveABodega("rechazada")).toBe(true);
    // D4 (cerrada en el spec): la reprogramada VUELVE el mismo dia aunque la nueva visita sea
    // dentro de una semana — sale hacia bodega y espera ahi (`liberacion_reprogramada`, 46).
    expect(vuelveABodega("reprogramada")).toBe(true);
  });

  // EL CASO DE LA DECISION FIRMADA (2026-08-19). Si esto se pone verde con `incidente: true`, el
  // cierre exigiria escanear un paquete perdido, robado o danado —que por definicion no esta— y
  // ningun cierre con incidentes se podria aprobar jamas. La mutacion T5.4 es exactamente esa.
  it("R3: `incidente` esta DECLARADO como no-retornable, no omitido", () => {
    expect(vuelveABodega("incidente")).toBe(false);
    // Declarado: la clave EXISTE en el mapa. Omitirla daria `undefined` -> falsy -> el mismo
    // comportamiento aparente y ninguna decision escrita.
    expect(Object.prototype.hasOwnProperty.call(RETORNA_A_BODEGA, "incidente")).toBe(true);
    expect(RETORNA_A_BODEGA.incidente).toBe(false);
    expect(RETORNA_A_BODEGA.incidente).not.toBeUndefined();
  });

  it("R3: `entregada` tampoco vuelve (el paquete se quedo con el cliente)", () => {
    expect(vuelveABodega("entregada")).toBe(false);
  });

  it("los DOS que no vuelven son exactamente `entregada` e `incidente`", () => {
    const noVuelven = RESULTADOS.filter((r) => !vuelveABodega(r));
    expect(noVuelven).toEqual(["entregada", "incidente"]);
  });
});

describe("RESULTADOS_QUE_VUELVEN — la lista DERIVADA (238/R2)", () => {
  it("R2: es exactamente `devuelta`, `rechazada` y `reprogramada`", () => {
    // Literal a mano: es EL CONTRATO que el WHERE del repositorio y la cobertura del servicio
    // consumen. No se compara contra el `Record` que lo genera, porque eso estaria siempre verde.
    expect([...RESULTADOS_QUE_VUELVEN].sort()).toEqual([
      "devuelta",
      "rechazada",
      "reprogramada",
    ]);
  });

  it("R3: `incidente` NO esta en la lista, y `entregada` tampoco", () => {
    expect(RESULTADOS_QUE_VUELVEN).not.toContain("incidente");
    expect(RESULTADOS_QUE_VUELVEN).not.toContain("entregada");
    expect(RESULTADOS_QUE_VUELVEN).toHaveLength(3);
  });

  // La propiedad que pide T1.1: la lista se DERIVA del `Record`, no es un segundo literal. No se
  // puede afirmar comparandola con el `Record` (eso es compararla con su propia fuente): se
  // afirma sobre el CODIGO, que es donde vive la diferencia entre derivar y copiar.
  it("R2: se DERIVA del `Record` — no hay un segundo literal en el modulo", () => {
    expect(FUENTE).toMatch(/RESULTADOS_QUE_VUELVEN[\s\S]{0,200}Object\.keys\(RETORNA_A_BODEGA\)/);
    // Ni un array literal con los tres nombres en ninguna parte del archivo (que es justo lo que
    // la guardia `confirmacion-incidentes-excluidos` prohibe en el resto del arbol).
    const sinComentarios = FUENTE.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(sinComentarios).not.toMatch(/\[[^\]]*"devuelta"[^\]]*"rechazada"[^\]]*\]/);
  });
});
