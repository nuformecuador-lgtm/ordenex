// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { LandingConteos } from "@/app/_landing/LandingConteos";
import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";

// Feature 198 — las cifras en la landing.
//
// EL CASO QUE IMPORTA es el segundo: que un fallo de la lectura NO tumbe la landing. Es la
// unica pantalla que ve alguien de fuera y estas cifras son adorno; caerse por un contador
// seria cambiar la portada por una pantalla de error.

vi.mock("@/lib/actions/conteos-publicos", () => ({
  obtenerConteosPublicos: vi.fn(),
}));

const conteosMock = vi.mocked(obtenerConteosPublicos);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LandingConteos", () => {
  it("pinta las tres cifras con separador de miles", async () => {
    conteosMock.mockResolvedValue({
      cantonesConCobertura: 12,
      ordenesGestionadas: 34567,
      ordenesSinGestionar: 890,
    });

    render(await LandingConteos());

    const region = screen.getByRole("region", { name: "Ordenex en números" });
    const texto = region.textContent ?? "";

    // Se compara sobre `textContent` CRUDO y no con `getByText`: `es-CR` separa los miles con
    // un espacio fino inseparable (U+202F) que el normalizador de Testing Library no
    // reconcilia con el de la consulta, y el caso fallaba por eso y no por el componente.
    //
    // Y el esperado se DERIVA del mismo formateador en vez de escribirse a mano: qué
    // separador usa `es-CR` depende de la build de ICU, así que codificarlo aquí haría que el
    // test afirmara la locale del entorno en lugar del comportamiento del componente.
    expect(texto).toContain(new Intl.NumberFormat("es-CR").format(34567));
    // Y que NO aparezca el número crudo, que es lo que el formateo viene a evitar.
    expect(texto).not.toContain("34567");
    expect(texto).toContain("12");
    expect(texto).toContain("890");
  });

  it("NO BLOQUEANTE: si la lectura falla, la landing sigue sin el bloque", async () => {
    // Base caida, migracion a medias, lo que sea: el visitante ve la landing entera, sin
    // cifras y sin error. Devolver `null` es lo que lo garantiza.
    conteosMock.mockRejectedValue(new Error("base caida"));

    const arbol = await LandingConteos();

    expect(arbol).toBeNull();
  });

  it("no le pasa ningun argumento a la accion", async () => {
    // La accion es publica y su firma vacia es la defensa contra convertirla en un oraculo
    // por inquilino. El consumidor tiene que respetarlo.
    conteosMock.mockResolvedValue({
      cantonesConCobertura: 1,
      ordenesGestionadas: 1,
      ordenesSinGestionar: 1,
    });

    await LandingConteos();

    expect(conteosMock).toHaveBeenCalledWith();
  });
});
