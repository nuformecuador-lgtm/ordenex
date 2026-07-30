import { describe, it, expect } from "vitest";

import { nombrePlantilla } from "@/app/(app)/mis-asignaciones/_components/chat-demo/chat-demo-data";

// Rediseno del chat del mensajero (rama ux) — presentacion del nombre de plantilla en los
// chips del chat. Las plantillas de Meta llegan en snake_case; el chip las muestra legibles.

describe("nombrePlantilla", () => {
  it("cambia los guiones bajos por espacios y capitaliza cada palabra", () => {
    expect(nombrePlantilla("hello_world")).toBe("Hello World");
  });

  it("acepta guiones medios y separadores repetidos", () => {
    expect(nombrePlantilla("voy-en__camino")).toBe("Voy En Camino");
  });

  it("conserva el resto de cada palabra (no destroza siglas)", () => {
    expect(nombrePlantilla("pago_SINPE_movil")).toBe("Pago SINPE Movil");
  });

  it("tolera espacios sobrantes en los extremos", () => {
    expect(nombrePlantilla("  recordatorio_entrega  ")).toBe(
      "Recordatorio Entrega",
    );
  });

  it("devuelve cadena vacia si el nombre esta vacio", () => {
    expect(nombrePlantilla("")).toBe("");
  });
});
