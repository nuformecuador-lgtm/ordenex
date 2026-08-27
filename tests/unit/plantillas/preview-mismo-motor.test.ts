// Feature 282 / R11 — LA VISTA PREVIA SALE DEL MOTOR DE PRODUCCION.
//
// Lo que se vigila aqui no es "que la preview pinte bonito" sino que sea, literalmente, el
// mismo par de llamadas que hace el envio real:
//   renderPlantilla(cuerpo, resolverValoresPlantilla(extraerVariables(cuerpo), datos))
// tal como lo escribe `EnviarPlantillaWhatsappButton` con los datos de la orden. Por eso hay
// DOS asertos y no uno: la igualdad con la expresion de referencia (comportamiento) y el
// espia sobre `resolverValoresPlantilla` (camino). Sin el espia, una preview que
// reimplementara la sustitucion por su cuenta pasaria el primero mientras diverge del envio.
import { beforeEach, describe, expect, it, vi } from "vitest";

// El espia tiene que estar en el MODULO, no en una variable local: `previewConEjemplos`
// resuelve su import de `resolverValoresPlantilla` contra este modulo, y un `vi.spyOn` sobre
// el namespace importado no alcanza ese binding en ESM. `importOriginal` conserva el resto
// del catalogo (el fixture, el indice por clave) intacto.
vi.mock("@/lib/types/plantilla-datos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/types/plantilla-datos")>();
  return { ...actual, resolverValoresPlantilla: vi.fn(actual.resolverValoresPlantilla) };
});

import {
  DATOS_PLANTILLA_EJEMPLO,
  resolverValoresPlantilla,
} from "@/lib/types/plantilla-datos";
import {
  extraerVariables,
  previewConEjemplos,
  renderPlantilla,
} from "@/lib/utils/plantilla-mensaje";

const CUERPOS: Array<[string, string]> = [
  ["sin variables", "Tu pedido ya va en camino."],
  ["con una variable repetida", "{{cliente}}, tu pedido {{guia}} es tuyo, {{cliente}}."],
  ["con un alias del catalogo", "Guia {{num_guia}} para {{destinatario}}."],
  ["con una clave fuera del catalogo", "Recoge en {{sucursal}} antes de las 5."],
];

describe("R11: la preview es el mismo par de llamadas que el envio", () => {
  beforeEach(() => {
    vi.mocked(resolverValoresPlantilla).mockClear();
  });

  it.each(CUERPOS)("%s: identica a la expresion del envio", (_titulo, cuerpo) => {
    const referencia = renderPlantilla(
      cuerpo,
      resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO),
    );
    expect(previewConEjemplos(cuerpo)).toBe(referencia);
  });

  // EL CONTROL DEL ESPIA: si `previewConEjemplos` dejara de llamar a
  // `resolverValoresPlantilla`, este aserto cae aunque el texto siguiera coincidiendo.
  it("PASA por `resolverValoresPlantilla`, con las claves del cuerpo y el fixture", () => {
    const cuerpo = "Hola {{cliente}}, total {{monto}}";
    previewConEjemplos(cuerpo);
    expect(resolverValoresPlantilla).toHaveBeenCalledTimes(1);
    expect(resolverValoresPlantilla).toHaveBeenCalledWith(
      ["cliente", "monto"],
      DATOS_PLANTILLA_EJEMPLO,
    );
  });

  it("un cuerpo sin variables tambien pasa por el resolutor (con lista vacia)", () => {
    previewConEjemplos("Sin placeholders");
    expect(resolverValoresPlantilla).toHaveBeenCalledWith([], DATOS_PLANTILLA_EJEMPLO);
  });

  // El antiguo R25 de la feature 107 («clave desconocida -> marcador en MAYUSCULAS») queda
  // DEROGADO (design §4.3): al cliente le llega un hueco, y eso es lo que el panel «Asi lo
  // vera el cliente» tiene que ensenar. Quien avisa de la clave rota es R15, no un marcador
  // que el cliente nunca veria.
  it("una clave fuera del catalogo deja el hueco real, no el marcador en MAYUSCULAS", () => {
    expect(previewConEjemplos("Hola {{sucursal}}")).toBe("Hola ");
    expect(previewConEjemplos("Hola {{sucursal}}")).not.toContain("SUCURSAL");
  });

  it("los valores del catalogo se pintan ya formateados, como los veria el cliente", () => {
    expect(previewConEjemplos("Hola {{cliente}}, total {{monto}}")).toBe(
      "Hola María Rodríguez, total ₡12.500",
    );
    // Un alias resuelve igual que su base (R5): no es una clave invalida.
    expect(previewConEjemplos("{{num_guia}}")).toBe("10432");
  });
});
