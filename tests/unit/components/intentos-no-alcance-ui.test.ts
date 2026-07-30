import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

// Feature 160 (T23, parte de UI) — el NO ALCANCE de PRESENTACION, asertado y no solo
// declarado. La parte de contratos/OpenAPI vive en `tests/unit/types/intentos-no-alcance.test.ts`;
// aqui se blinda que ninguna de las superficies EXCLUIDAS (design §5.4 "Fuera, con
// motivo") consuma la pieza compartida de intentos. Es una guarda de FUENTE a proposito:
// la vista del paquete es un Server Component `async` que resuelve sesion y Server
// Actions, y montarlo en jsdom exigiria doblar medio borde para probar una AUSENCIA.
// Si alguien importa el modulo ahi, esto rompe.

/** Superficies que R30/QA4/QA5/QA6 dejan FUERA, con su motivo. */
const EXCLUIDAS: { archivo: string; motivo: string }[] = [
  {
    archivo: "app/paquete/[numGuia]/page.tsx",
    motivo: "R30/QA4: accesible a cualquier rol autenticado, no al alcance de la orden",
  },
  {
    archivo: "app/(app)/ordenes/_components/EtiquetaGuia.tsx",
    motivo: "R30: documento fisico del paquete, no vista de gestion",
  },
  {
    archivo: "app/(app)/ordenes/_components/etiquetas-pdf.ts",
    motivo: "R30: el PDF espeja la etiqueta imprimible",
  },
  {
    archivo: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
    motivo: "QA6: su grano es la GESTION, no la orden; documento de dinero congelado",
  },
];

describe("R30/QA4/QA5/QA6 — las superficies excluidas no consumen la pieza de intentos", () => {
  for (const { archivo, motivo } of EXCLUIDAS) {
    it(`${archivo} no importa ni nombra el dato (${motivo})`, () => {
      const fuente = readFileSync(resolve(process.cwd(), archivo), "utf8");
      expect(fuente).not.toContain("intentos-entrega");
      expect(fuente).not.toContain("IntentosDato");
      expect(fuente).not.toContain("columnaIntentos");
      expect(fuente).not.toContain("intentosEntrega");
    });
  }

  it("el listado de superficies excluidas apunta a archivos que EXISTEN (si se renombran, esto avisa)", () => {
    for (const { archivo } of EXCLUIDAS) {
      expect(() => readFileSync(resolve(process.cwd(), archivo), "utf8")).not.toThrow();
    }
  });
});
