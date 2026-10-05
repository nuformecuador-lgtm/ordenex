import { describe, it, expect } from "vitest";
import {
  catalogoDeVariables,
  ejemploDeVariableInforme,
} from "@/lib/whatsapp-envios/informes/catalogo";
import { CAMPOS_PLANTILLA_OFRECIDOS } from "@/lib/types/plantilla-datos";

// Ficha 474 (T3.1, R4/R53) — el catalogo de variables segun el tipo de plantilla.

describe("474/R4 — catalogoDeVariables", () => {
  it("plantilla de ORDEN (null): el catalogo de siempre, sin cambios", () => {
    const c = catalogoDeVariables(null);
    expect(c.map((v) => v.clave)).toEqual(CAMPOS_PLANTILLA_OFRECIDOS.map((v) => v.clave));
    expect(c.map((v) => v.clave)).not.toContain("destinatario_nombre");
  });

  it("plantilla de informe prueba_envio: fecha, hora y la comun", () => {
    expect(catalogoDeVariables("prueba_envio").map((v) => v.clave)).toEqual([
      "fecha",
      "hora",
      "destinatario_nombre",
    ]);
  });

  it("plantilla de informe aviso_interno: sus cinco y la comun", () => {
    expect(catalogoDeVariables("aviso_interno").map((v) => v.clave)).toEqual([
      "titulo",
      "texto",
      "enlace",
      "fecha",
      "hora",
      "destinatario_nombre",
    ]);
  });

  it("R53: la comun lleva su nombre y el ejemplo de la maqueta («Daniel»)", () => {
    const comun = catalogoDeVariables("prueba_envio").find((v) => v.clave === "destinatario_nombre");
    expect(comun).toEqual({
      clave: "destinatario_nombre",
      nombre: "Nombre del destinatario",
      descripcion: "El nombre de la persona que recibe el mensaje.",
      ejemplo: "Daniel",
    });
  });

  it("informe desconocido: catalogo vacio (toda clave sale desconocida)", () => {
    expect(catalogoDeVariables("no_existe")).toEqual([]);
  });

  it("los ejemplos que viajan a Meta salen del informe, y una clave ajena cae al marcador", () => {
    const ej = ejemploDeVariableInforme("prueba_envio");
    expect(ej("fecha")).toBe("05/10/2026");
    expect(ej("destinatario_nombre")).toBe("Daniel");
    expect(ej("otra")).toBe("OTRA");
  });
});
