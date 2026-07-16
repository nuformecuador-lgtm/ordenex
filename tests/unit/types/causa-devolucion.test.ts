import { describe, it, expect } from "vitest";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import {
  CAUSA_DEVOLUCION_LABEL,
  CAUSA_DEVOLUCION_OPTIONS,
} from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";

// Feature 73 (R1/R2/R3) — la fuente UNICA de verdad del par valor->etiqueta y su doble
// candado de exhaustividad frente al enum Prisma.

describe("Feature 73 · CAUSA_DEVOLUCION_SEED — catalogo CERRADO de 3 (R1, F1.4-d)", () => {
  it("R1: tiene EXACTAMENTE las 3 causas del pedido literal", () => {
    expect([...CAUSA_DEVOLUCION_SEED]).toEqual(["not_found", "wrong_number", "wrong_address"]);
    expect(CAUSA_DEVOLUCION_SEED).toHaveLength(3);
  });

  it("R1/F1.4-d: no ofrece 'Otro' ni reserva valores futuros", () => {
    const valores = [...CAUSA_DEVOLUCION_SEED] as string[];
    expect(valores).not.toContain("otro");
    expect(valores).not.toContain("other");
    expect(valores).not.toContain("desconocido");
  });

  it("R2: el doble candado de exhaustividad esta declarado (rompe el build si divergen)", () => {
    // Los dos candados son de TIPO -> no se pueden ejercitar en runtime; se afirma que el
    // codigo los declara, igual que el patron hermano METODO_PAGO_SEED (lib/types/metodo-pago.ts:17-21):
    //  - `satisfies readonly GestionCausaDevolucion[]` rompe si el SEED inventa un valor que
    //    el enum Prisma NO tiene (SEED con valor fantasma).
    //  - `_EnsureExhaustive` rompe si el enum GANA un valor que el SEED NO lista.
    // La prueba viva de que funcionan es que `pnpm typecheck` pasa con el enum y el SEED
    // alineados, y falla al desalinearlos (verificado por el implementer, ver la bitacora).
    const fuente = readSource();
    expect(fuente).toMatch(/as const satisfies readonly GestionCausaDevolucion\[\]/);
    expect(fuente).toMatch(
      /type _EnsureExhaustive = Exclude<GestionCausaDevolucion, CausaDevolucion> extends never \? true : never;/,
    );
  });
});

describe("Feature 73 · etiquetas legibles en español (R3)", () => {
  it("R3: cada valor mapea a su etiqueta EXACTA del pedido literal del humano", () => {
    expect(CAUSA_DEVOLUCION_LABEL).toEqual({
      not_found: "Cliente no localizado",
      wrong_number: "Número de celular errado",
      wrong_address: "Dirección errada",
    });
  });

  it("R3: las opciones se DERIVAN del SEED, no de una lista literal paralela", () => {
    expect(CAUSA_DEVOLUCION_OPTIONS.map((o) => o.value)).toEqual([...CAUSA_DEVOLUCION_SEED]);
    expect(CAUSA_DEVOLUCION_OPTIONS).toEqual([
      { value: "not_found", label: "Cliente no localizado" },
      { value: "wrong_number", label: "Número de celular errado" },
      { value: "wrong_address", label: "Dirección errada" },
    ]);
  });

  it("R3: ninguna etiqueta expone el slug crudo del enum", () => {
    for (const { value, label } of CAUSA_DEVOLUCION_OPTIONS) {
      expect(label).not.toContain(value);
      expect(label).not.toMatch(/_/);
    }
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "types", "causa-devolucion.ts"),
    "utf8",
  );
}
