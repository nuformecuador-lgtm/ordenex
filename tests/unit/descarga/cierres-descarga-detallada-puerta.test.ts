// Feature 230 (T6.1) — la PUERTA ÚNICA de la descarga detallada. Cubre R13 y R36.
//
// R13 dice que las filas de cada archivo detallado salen EXCLUSIVAMENTE de un único punto de
// entrada de servidor POR PANTALLA, y de ninguna otra fuente. R36, que lo elegido en el diálogo
// viaja como RECORTE de ese mismo borde, sin abrir una consulta paralela para resolverlo.
//
// Se comprueban por LECTURA DE FUENTE y no por render, porque lo que se afirma es estructural: no
// «esta vez no llamó a otra cosa», sino «no hay otra cosa a la que pueda llamar». Un test de
// comportamiento con dobles no vería el segundo camino si el segundo camino no se ejercita.
//
// La mitad de comportamiento —qué objeto viaja y que no viaja nada más— la cubren
// `DescargarGestionesDialog.test.tsx` (R34) y `CierresAdminDescargaDetallada.test.tsx` (R33).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

const DIALOGO = "app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx";
const PANTALLA_CIERRES_DIA = "app/(app)/cierres-admin/_components/CierresAdminModule.tsx";
const PANTALLA_BODEGA = "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx";

function fuente(relativa: string): string {
  const texto = readFileSync(path.join(RAIZ, relativa), "utf8");
  expect(texto.length, `${relativa} está vacío`).toBeGreaterThan(500);
  return texto;
}

/** Quita comentarios conservando líneas: la prosa de este repo nombra símbolos a propósito. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_todo, previo: string) => previo);
}

describe("puerta única de la descarga detallada de cierres (R13/R36)", () => {
  it("las filas salen de la Server Action de esa pantalla y de ninguna otra fuente (R13)", () => {
    const dialogo = sinComentarios(fuente(DIALOGO));

    // (a) El diálogo no conoce NINGUNA acción: la recibe por prop. Así no puede haber una
    // segunda fuente escondida, y el mismo componente sirve a las dos pantallas.
    expect(dialogo).not.toMatch(/from\s+["']@\/lib\/actions\//);
    // (b) Y solo hay UN sitio donde se invoca esa prop.
    expect(dialogo.match(/\baccion\(/g) ?? []).toHaveLength(1);
    // (c) Las filas del archivo se derivan de ESE resultado, con el adaptador común.
    expect(dialogo).toMatch(/filasDesdeResultado\(\s*accion\(/);

    // (d) Cada pantalla le pasa la acción de SU listado, y ninguna le pasa la de la otra: los
    // dos conjuntos son disjuntos (design §2.6) y cruzarlos daría un archivo fuera de alcance.
    const cierresDia = sinComentarios(fuente(PANTALLA_CIERRES_DIA));
    expect(cierresDia).toMatch(/accion=\{listarGestionesCierresAdminCompleto\}/);
    expect(cierresDia).not.toMatch(/listarGestionesCierresBodegaCompleto/);

    const bodega = sinComentarios(fuente(PANTALLA_BODEGA));
    expect(bodega).toMatch(/accion=\{listarGestionesCierresBodegaCompleto\}/);
    expect(bodega).not.toMatch(/listarGestionesCierresAdminCompleto/);
  });

  it("lo elegido viaja como filtro del mismo borde, sin consulta paralela (R36)", () => {
    const dialogo = sinComentarios(fuente(DIALOGO));

    // Lo que el usuario elige se convierte en el RECORTE de la MISMA llamada, no en una segunda
    // lectura que resuelva los mensajeros o el rango por su cuenta.
    expect(dialogo).toMatch(/accion\(recorteElegido\(\)\)/);
    // `elegidos` y ya no `seleccion` (2026-08-19): el diálogo abre con TODOS marcados, así que
    // el estado pasó a ser `string[] | null` —`null` = «no ha tocado nada»— y lo que viaja es
    // `seleccion ?? idsCatalogo`. Lo que esta guardia vigila no cambia: lo elegido es el recorte
    // de la MISMA llamada, y sigue sin haber una segunda lectura que resuelva los mensajeros.
    expect(dialogo).toMatch(/mensajeroIds:\s*elegidos/);

    // Ni `fetch`, ni SWR, ni ninguna otra llamada de red: el catálogo del diálogo llega por
    // prop, ya acotado al alcance por el servidor (R29).
    expect(dialogo).not.toMatch(/\bfetch\(/);
    expect(dialogo).not.toMatch(/from\s+["']swr["']/);
    expect(dialogo).not.toMatch(/useEffect/);
  });
});
