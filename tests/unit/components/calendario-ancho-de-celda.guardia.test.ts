import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// GUARDIA — la celda del dia DEBE declarar el mismo ancho que la cabecera.
//
// POR QUE EXISTE. La fila del calendario es `flex` y `showOutsideDays={false}`: los dias que no
// pertenecen al mes se renderizan como celda SIN boton dentro. El ancho lo ponia solo el boton
// (`day_button: size-8`), asi que esas celdas colapsaban a 0 px y CORRIAN el mes entero hacia la
// izquierda. Reportado el 2026-09-05 con una captura: el 1 de septiembre de 2026 (martes) se
// pintaba bajo «Lu» y el 5, que era sabado, bajo «Vi». El desfase era exactamente el numero de
// dias ocultos al inicio del mes: 1 en septiembre (empieza martes), 3 en octubre (empieza jueves),
// y las dos cosas se leen en la misma captura.
//
// POR QUE ES UNA GUARDIA DE TEXTO Y NO UN RENDER. jsdom no calcula layout: en el DOM el hueco SI
// existe y el indice de la celda es correcto, asi que un test de render pasa en VERDE con el bug
// puesto — se comprobo, 36 meses en verde mientras la app estaba rota. Sin un navegador, lo unico
// que distingue el estado bueno del malo es la clase declarada.
const FUENTE = readFileSync(resolve(process.cwd(), "components/ui/calendar.tsx"), "utf8");

/** Valor literal de una clave de `classNames`, admitiendo que ocupe varias lineas. */
function valorDe(clave: "weekday" | "day" | "day_button", fuente = FUENTE): string {
  // Salto de linea + espacios + la clave EXACTA con sus dos puntos: asi `day:` no captura
  // `day_button:`, que empieza igual.
  const re = new RegExp(String.raw`\n\s*` + clave + String.raw`:\s*((?:"[^"]*"\s*\+?\s*)+)`);
  return (fuente.match(re)?.[1] ?? "").replace(/["+\s]+/g, " ").trim();
}

/** El ancho declarado, normalizando `size-N` (que fija ancho y alto a la vez) a `w-N`. */
function anchoDe(clave: "weekday" | "day" | "day_button", fuente = FUENTE): string | null {
  const m = valorDe(clave, fuente).match(/\b(w-\d+|size-\d+)\b/);
  return m ? m[1].replace(/^size-/, "w-") : null;
}

describe("calendario · la celda del dia conserva su sitio aunque no tenga boton", () => {
  it("el extractor lee las tres claves por separado", () => {
    expect(valorDe("weekday")).not.toBe("");
    expect(valorDe("day")).not.toBe("");
    expect(valorDe("day_button")).not.toBe("");
    // `day` no puede haber capturado el valor de `day_button`
    expect(valorDe("day")).not.toBe(valorDe("day_button"));
  });

  it("`day` declara un ancho explicito", () => {
    expect(anchoDe("day")).not.toBeNull();
  });

  it("`day`, `weekday` y `day_button` declaran el MISMO ancho", () => {
    const weekday = anchoDe("weekday");
    expect({ day: anchoDe("day"), boton: anchoDe("day_button") }).toEqual({
      day: weekday,
      boton: weekday,
    });
  });

  it("CONTRAPRUEBA: sobre un cuerpo mutado sin el ancho, el detector lo ve", () => {
    const mutado = FUENTE.replace(/\n(\s*)day: "w-\d+ /, '\n$1day: "');
    expect(mutado).not.toBe(FUENTE);
    expect(anchoDe("day", mutado)).toBeNull();
    // y el de la cabecera sigue ahi, o sea que el detector no se apago entero
    expect(anchoDe("weekday", mutado)).not.toBeNull();
  });
});
