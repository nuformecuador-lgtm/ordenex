import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 374 / G5 (R61) — «TERMINAL» TIENE UNA SOLA FUENTE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE. El conteo de ordenes sin entregar decide, en la pantalla, si retirar un distrito es
// barato o caro. Su criterio es `deleted_at IS NULL` mas «el estatus no es terminal», y esa
// segunda mitad se IMPORTA de `lib/types/order-status-transiciones.ts`, que es la fuente que ya
// consumen la analitica, el ciclo de vida y la correccion.
//
// Dos listas de estados terminales son dos definiciones de «entregado» que un dia divergen, y la
// que divergiera contaria mal JUSTO en la pantalla que decide retirar territorio: un distrito con
// 40 ordenes vivas pareceria vacio, y alguien lo retiraria.
//
// LOS OTROS DOS CANDIDATOS DEL REPO ESTAN DESCARTADOS POR ESCRITO en el comentario del metodo:
// `ESTADOS_PENDIENTES` (lista LOCAL del cierre del dia, tres estados, deja fuera ordenes vivas) y
// «sin gestionar» (daria por resuelta una orden REPROGRAMADA, que tiene gestion y sigue sin
// entregarse).
//
// COMO SE MIDE. Se recorta el cuerpo del metodo y se exige (a) que el archivo IMPORTE
// `ESTADOS_TERMINALES` de su modulo, (b) que el cuerpo lo USE, y (c) que el cuerpo NO declare
// ninguna lista de estados propia. Con CONTRAPRUEBA sobre un cuerpo mutado en memoria.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const ARCHIVO = "lib/repositories/OrdenRepository.ts";
const METODO = "contarSinEntregarPorNodoGeografico";
const FUENTE_UNICA = "@/lib/types/order-status-transiciones";

/** El bloque `{ … }` que empieza en `desde`, cerrado por llaves balanceadas. */
function bloqueBalanceado(codigo: string, desde: number): string | null {
  const abre = codigo.indexOf("{", desde);
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}") {
      profundidad--;
      if (profundidad === 0) return codigo.slice(abre, i + 1);
    }
  }
  return null;
}

/**
 * El cuerpo REAL del metodo. LANZA si no esta: una guardia estatica rota no falla, CALLA, y ese es
 * el modo de fallo que este archivo existe para cerrar.
 */
function cuerpoDelMetodo(codigo: string, metodo: string): string {
  const declaracion = new RegExp(`(?:^|\\n)\\s*(?:private\\s+)?async\\s+${metodo}\\s*\\(`);
  const encontrado = declaracion.exec(codigo);
  if (encontrado === null) {
    throw new Error(
      `no se encontro \`async ${metodo}(\` en ${ARCHIVO}: o se renombro o se borro, y esta ` +
        "guardia estaria midiendo la nada",
    );
  }
  const cierreFirma = codigo.indexOf(")", encontrado.index + encontrado[0].length);
  const cuerpo = bloqueBalanceado(codigo, cierreFirma);
  if (cuerpo === null) throw new Error(`el cuerpo de \`${metodo}\` no cierra`);
  return cuerpo;
}

/**
 * EL DETECTOR. Devuelve la lista de fallos; vacia = el conteo usa la fuente unica.
 *
 * La declaracion propia se busca como un ARRAY LITERAL que contenga alguno de los estados
 * terminales entre comillas: es exactamente la forma que tendria una copia («["entregada", …]»).
 */
export function fallosDeFuenteUnica(cuerpo: string): string[] {
  const fallos: string[] = [];
  if (!cuerpo.includes("ESTADOS_TERMINALES")) {
    fallos.push("no usa `ESTADOS_TERMINALES`");
  }
  for (const estado of ESTADOS_TERMINALES) {
    if (new RegExp(`["'\`]${estado}["'\`]`).test(cuerpo)) {
      fallos.push(`declara el estado \`${estado}\` como literal`);
    }
  }
  return fallos;
}

// ---------------------------------------------------------------------------------------------
// 0 — El detector, contra respuestas conocidas
// ---------------------------------------------------------------------------------------------

describe("374/G5 — el detector se prueba a si mismo", () => {
  const SANO = `{
    return this.prisma.orden.count({
      where: { distritoId: id, deletedAt: null, estatus: { value: { notIn: [...ESTADOS_TERMINALES] } } },
    });
  }`;

  it("CONTRAPRUEBA (control positivo): el cuerpo que importa la fuente NO produce fallos", () => {
    expect(fallosDeFuenteUnica(SANO)).toEqual([]);
  });

  it("CONTRAPRUEBA: una lista propia inyectada SE DETECTA", () => {
    const mutado = SANO.replace(
      "[...ESTADOS_TERMINALES]",
      '["entregada", "devuelta_a_tienda", "incidente"]',
    );
    const fallos = fallosDeFuenteUnica(mutado);
    expect(fallos).toContain("no usa `ESTADOS_TERMINALES`");
    expect(fallos).toContain("declara el estado `entregada` como literal");
  });

  it("CONTRAPRUEBA: quitar la referencia a la fuente tambien se detecta", () => {
    const mutado = SANO.replace("[...ESTADOS_TERMINALES]", "listaDeEstados");
    expect(fallosDeFuenteUnica(mutado)).toEqual(["no usa `ESTADOS_TERMINALES`"]);
  });
});

// ---------------------------------------------------------------------------------------------
// 1 — R61: el arbol real
// ---------------------------------------------------------------------------------------------

describe("374/R61 — el conteo IMPORTA la lista de terminales y no declara la suya", () => {
  const codigo = codigoSinComentarios(ARCHIVO);

  it("anti-vacuidad: el archivo se lee y el metodo existe", () => {
    expect(codigo.length).toBeGreaterThan(1000);
    expect(cuerpoDelMetodo(codigo, METODO).length).toBeGreaterThan(50);
  });

  it(`\`${ARCHIVO}\` importa \`ESTADOS_TERMINALES\` de su fuente unica`, () => {
    const patron = new RegExp(
      `import\\s*\\{[^}]*ESTADOS_TERMINALES[^}]*\\}\\s*from\\s*["']${FUENTE_UNICA}["']`,
    );
    expect(codigo, "la lista se importa, no se declara").toMatch(patron);
  });

  it(`el cuerpo de \`${METODO}\` la USA y no declara ninguna lista propia`, () => {
    expect(
      fallosDeFuenteUnica(cuerpoDelMetodo(codigo, METODO)),
      "dos listas de estados terminales son dos definiciones de «entregado» que un dia divergen, " +
        "y la que divergiera contaria mal justo en la pantalla que decide retirar territorio",
    ).toEqual([]);
  });

  it("el `where` del conteo lleva ademas `deletedAt: null`", () => {
    // La otra mitad del criterio de R61: `deleted_at IS NULL` es lo que decide que la orden
    // existe, y es lo que usa el listado.
    expect(cuerpoDelMetodo(codigo, METODO)).toMatch(/deletedAt:\s*null/);
  });

  it("la fuente unica sigue teniendo exactamente los tres estados que declara", () => {
    // Literal, y el literal ES el contrato: si alguien añadiera un cuarto terminal, este caso
    // obliga a pasar por aqui y a mirar si el conteo de la pantalla sigue diciendo la verdad.
    expect([...ESTADOS_TERMINALES]).toEqual(["entregada", "devuelta_a_tienda", "incidente"]);
  });
});
