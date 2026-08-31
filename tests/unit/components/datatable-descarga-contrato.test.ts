import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Feature 151 (T9) — GUARDIA de «tabla sin dominio» (R29). El `DataTable` es genérico
// sobre `T` y lo montan ~31 pantallas: si la descarga le metiera filtros, urls o tipos de
// dominio, ese acoplamiento se propagaría a todas. Este test es una lectura ESTÁTICA del
// módulo: no comprueba que compila, comprueba lo que el archivo dice.

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_DATATABLE = path.join(RAIZ, "components/shared/DataTable.tsx");
const fuente = readFileSync(RUTA_DATATABLE, "utf8");

/** Especificadores de todos los `import ... from "..."` del módulo. */
function importsDe(codigo: string): string[] {
  return [...codigo.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

/** Especificadores de los `import("...")` dinámicos. */
function importsDinamicosDe(codigo: string): string[] {
  return [...codigo.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
}

describe("contrato de descarga del DataTable", () => {
  it("DataTable no importa acciones, tipos de dominio ni utilidades de filtros", () => {
    const especificadores = [
      ...importsDe(fuente),
      ...importsDinamicosDe(fuente),
    ];
    expect(especificadores.length).toBeGreaterThan(0);

    for (const especificador of especificadores) {
      // Nada de Server Actions, servicios, repositorios ni rutas de la app.
      expect(especificador).not.toMatch(/^@\/lib\/(actions|services|repositories)\b/);
      expect(especificador).not.toMatch(/^@\/app\//);
      expect(especificador).not.toMatch(/^\.\.\//);
      // Nada de tipos de dominio: el único tipo admitido es el genérico de descarga.
      expect(especificador).not.toMatch(
        /^@\/lib\/types\/(?!descarga$)/,
      );
      // Nada de utilidades de filtros ni de serialización de consulta.
      expect(especificador).not.toMatch(/filtro|filter|query|swr/i);
    }

    // Ni filtros, ni urls, ni parámetros de consulta en el cuerpo del módulo.
    expect(fuente).not.toMatch(/URLSearchParams|useSearchParams|useRouter/);
    expect(fuente).not.toMatch(/\bfetch\s*\(/);
  });

  it("la configuración de descarga solo expone título, columnas, obtenerFilas, formatos y ámbito", () => {
    // Ficha 314 — `ambitoColumnas` entra como QUINTO miembro, y esta guardia se amplía en vez
    // de relajarse. Es la única forma de declarar el ámbito de la preferencia de columnas: la
    // alternativa —colgarlo de `DataTableProps`— no habría tocado este archivo, pero
    // permitiría declarar un ámbito en una tabla que no ofrece descarga, un estado que no
    // significa nada. A cambio se AÑADE abajo la aserción de que el miembro es un `string` sin
    // dominio, así que la guardia queda más fuerte, no más laxa.
    const bloque = fuente.match(
      /export interface DataTableDescarga \{([\s\S]*?)\n\}/,
    );
    expect(bloque).not.toBeNull();

    const miembros = [
      ...bloque![1].matchAll(/^\s{2}(\w+)\??:/gm),
    ].map((m) => m[1]);
    expect(miembros).toEqual([
      "titulo",
      "columnas",
      "obtenerFilas",
      "formatos",
      "ambitoColumnas",
    ]);

    // `obtenerFilas` es una FUNCIÓN sin parámetros: la tabla no le pasa filtros, ni
    // página, ni url. El consumidor cierra sobre los suyos (D4).
    expect(bloque![1]).toMatch(
      /obtenerFilas:\s*\(\)\s*=>\s*Promise<DescargaFilasResult>/,
    );

    // El ámbito es un IDENTIFICADOR, no una configuración: `string` a secas, opcional, y sin
    // ningún tipo de dominio detrás. Un `ManifiestoFlujo`, un `AmbitoDescarga` o un objeto
    // meterían dominio justo en la interfaz que ~31 pantallas comparten.
    expect(bloque![1]).toMatch(/\n\s{2}ambitoColumnas\?:\s*string;/);
  });
});
