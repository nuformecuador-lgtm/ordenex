import { describe, it, expect } from "vitest";
import { ESTADOS_REPARTO_MENSAJERO } from "@/lib/constants/reparto-mensajero-estados";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNÉS — FICHA 413 (T1.1, R2) — UNA DECLARACIÓN, DOS LECTORES.
//
// La regla que gobierna toda la 413 la dejó escrita la 409:
//
//   > Si el aviso dijera «5» y la pantalla enseñara 4, el aviso queda desacreditado el primer día.
//
// El aviso «tenés N órdenes para mañana» cuenta EXACTAMENTE el mismo universo que el portal del
// mensajero muestra. Si cada uno escribiera su lista de estados, el día que el portal ganara un
// cuarto estatus —ya pasó una vez: la 235 metió `ayuda_tienda`— el aviso contaría uno menos **y
// nada se pondría rojo**. Es el mismo remedio que la 409 aplicó a `PROYECCION_ANCLAJE_DEVOLUCION`.
//
// ---------------------------------------------------------------------------------------------
// POR QUÉ ESTA GUARDIA CRUZA DOS FUENTES EN VEZ DE AFIRMAR «HAY UNA SOLA DECLARACIÓN»
// ---------------------------------------------------------------------------------------------
// El design de la 413 pedía que `MisAsignacionesService` IMPORTARA la lista. **No se puede, y el
// motivo está medido**: `tests/unit/guards/carga-del-mensajero.guardia.test.ts` (235/262) —una
// guardia VIGENTE, que nació de dos agujeros reales que costaban dinero y operación— lee el FUENTE
// del portal y exige que `findMisAsignaciones(...)` reciba una LISTA LITERAL cuyos elementos sean
// literales de texto o identificadores declarados CON UN LITERAL EN ESE MISMO MÓDULO. Su lector
// (`valorDe`) REVIENTA con un spread, con un índice o con un import. Pasarle
// `ESTADOS_REPARTO_MENSAJERO` la pondría ROJA.
//
// Así que el amarre se hace por las dos vías que sí caben, y las dos se ponen rojas solas:
//
//   1. EN COMPILACIÓN — las tres `const` del portal van anotadas con `EstadoRepartoMensajero`.
//      Quitar un valor de la tupla deja `MisAsignacionesService.ts` SIN COMPILAR.
//   2. AQUÍ — se extrae la lista del **FUENTE del portal** (la misma técnica que usa la guardia de
//      la 235, no la constante que el portal importa) y se compara miembro a miembro con la tupla.
//      Un cuarto estatus en el portal ⇒ ROJO.
//
// ⚠️ LEER LA CONSTANTE DESDE EL PORTAL PARA COMPARARLA CONSIGO MISMA habría sido la «aserción
// contra su propia fuente» que este repo ya pagó: siempre verde, y dejaría pasar exactamente el
// fallo que esta guardia existe para cazar.
//
// Y EL REPOSITORIO DEL AVISO SÍ LA IMPORTA, y no puede nombrar ni uno de los tres literales: eso
// es lo que mata la MUTACIÓN OBLIGATORIA de R2 (duplicar la lista allí).
//
// SE DECLARA COMO GUARDIA PORQUE ESCANEA EL ÁRBOL: ningún grafo de imports la seleccionaría.

const RUTA_FUENTE = "lib/constants/reparto-mensajero-estados.ts";
const RUTA_PORTAL = "lib/services/MisAsignacionesService.ts";
const RUTA_REPO_AVISO = "lib/repositories/RepartoMananaRepository.ts";

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia estados-reparto-mensajero: ${que}. La guardia NO pudo leer lo que vigila; se ` +
      `detiene en ROJO en vez de dar por buena una lectura vacía. Si el código se reorganizó, ` +
      `actualiza la extracción — no borres la comprobación.`,
  );
}

/**
 * El valor de una expresión que en este módulo es o un literal de texto o el nombre de un `const`
 * declarado con uno. Copiado A PROPÓSITO del `valorDe` de `carga-del-mensajero.guardia.test.ts`:
 * las dos leen el MISMO archivo con la MISMA gramática, y si esta aceptara algo que aquélla no,
 * podrían dar veredictos distintos sobre el mismo fuente.
 */
function valorDe(fuenteModulo: string, expresion: string): string {
  const literal = /^["'`]([^"'`]*)["'`]$/.exec(expresion.trim());
  if (literal) return literal[1];

  const identificador = expresion.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identificador)) {
    reventar(`${RUTA_PORTAL}: \`${identificador}\` no es ni un literal ni un identificador simple`);
  }
  const decl = new RegExp(
    `\\b(?:const|let|var)\\s+${identificador}\\s*(?::[^=]*)?=\\s*["'\`]([^"'\`]+)["'\`]`,
  ).exec(fuenteModulo);
  if (!decl) {
    reventar(`${RUTA_PORTAL}: \`${identificador}\` no se declara con un literal en ese módulo`);
  }
  return decl[1];
}

/** La lista literal que recibe `findMisAsignaciones(...)` en el fuente del portal, resuelta. */
function listaDelPortal(): string[] {
  const fuente = codigoSinComentarios(RUTA_PORTAL);
  const llamada = /\bfindMisAsignaciones\s*\(([^)]*)\)/.exec(fuente);
  if (!llamada) reventar(`${RUTA_PORTAL}: no se encontró la llamada a \`findMisAsignaciones(…)\``);
  const arreglo = /\[([^\]]*)\]/.exec(llamada[1]);
  if (!arreglo) {
    reventar(`${RUTA_PORTAL}: \`findMisAsignaciones(…)\` ya no recibe una lista literal de estatus`);
  }
  const piezas = arreglo[1]
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (piezas.length === 0) reventar(`${RUTA_PORTAL}: la lista de estatus salió vacía`);
  return piezas.map((e) => valorDe(fuente, e));
}

describe("413/R2 — la lista de estados del reparto del mensajero tiene UNA fuente", () => {
  it("⭑ la tupla declara EXACTAMENTE los tres estados, en orden — literal a mano", () => {
    // Escrito a mano, no derivado. Si mañana el universo del portal cambia, este aserto obliga a
    // venir aquí a decirlo, que es justo el punto.
    expect([...ESTADOS_REPARTO_MENSAJERO]).toEqual(["por_recoger", "en_reparto", "ayuda_tienda"]);
  });

  it("⭑ y la declara EL MÓDULO DE CONSTANTES, no otro sitio", () => {
    const fuente = codigoSinComentarios(RUTA_FUENTE);
    expect(fuente).toMatch(/export const ESTADOS_REPARTO_MENSAJERO\s*=\s*\[/);
    // AUTOCOMPROBACIÓN: si la extracción de abajo leyera un archivo vacío, los bucles pasarían en
    // verde sin haber comprobado nada.
    expect(fuente.length).toBeGreaterThan(200);
  });
});

describe("413/R2 — LOS DOS LECTORES dicen lo mismo, y se mide en sus fuentes", () => {
  it("⭑ LECTOR 1 (el portal): su lista, extraída del FUENTE, coincide con la tupla", () => {
    // ⚠️ Éste es EL aserto de R2. Se extrae del fuente del portal —no de la constante que importa—
    // porque comparar la constante consigo misma estaría siempre verde.
    //
    // SE PONE ROJO SI: el portal añade un cuarto estatus a `findMisAsignaciones(...)` (el aviso
    // contaría uno menos), o si le quita uno (el aviso contaría de más).
    const portal = listaDelPortal();

    // AUTOCOMPROBACIÓN antes de afirmar nada: la extracción encontró algo de verdad.
    expect(portal.length).toBeGreaterThan(0);
    expect(portal).toEqual([...ESTADOS_REPARTO_MENSAJERO]);
  });

  it("⭑ LECTOR 2 (el repositorio del aviso): IMPORTA la tupla", () => {
    const fuente = codigoSinComentarios(RUTA_REPO_AVISO);
    expect(fuente).toMatch(
      /import\s*\{[^}]*ESTADOS_REPARTO_MENSAJERO[^}]*\}\s*from\s*["']@\/lib\/constants\/reparto-mensajero-estados["']/,
    );
    // Y la USA de verdad: un import sin uso es la familia «el composition root que no inyecta».
    const sinLaLineaDelImport = fuente
      .split("\n")
      .filter((l) => !l.includes("import"))
      .join("\n");
    expect(sinLaLineaDelImport).toContain("ESTADOS_REPARTO_MENSAJERO");
  });

  it("⭑⭑ MUTACIÓN OBLIGATORIA: el repositorio NO nombra ni uno de los tres literales", () => {
    // ES EL ASERTO QUE MATA LA MUTACIÓN de R2: «duplicar la lista en el repositorio». Con
    // `estatus: { value: { in: ["por_recoger", "en_reparto", "ayuda_tienda"] } }` escrito allí, el
    // comportamiento de HOY sería idéntico y ninguna otra suite se movería — y el día que el
    // portal cambiara, las dos cifras divergirían en silencio. Esto lo pone ROJO el mismo día.
    const fuente = codigoSinComentarios(RUTA_REPO_AVISO);
    for (const estado of ESTADOS_REPARTO_MENSAJERO) {
      expect(
        fuente.includes(`"${estado}"`) || fuente.includes(`'${estado}'`),
        `${RUTA_REPO_AVISO} escribe el literal "${estado}" en vez de leer ESTADOS_REPARTO_MENSAJERO`,
      ).toBe(false);
    }
  });

  it("el repositorio tampoco escribe su propia cota de fecha con el helper equivocado", () => {
    // La otra mitad de «un solo criterio»: `orden.fecha_reparto` es `@db.Date`, así que la cota es
    // `startOfDayCR`. `inicioDelDiaCREnUtc` —la buena contra columnas `timestamp`— desplazaría el
    // día seis horas. R3 lo mide contra Postgres con un reloj a las 23:50 CR; esto lo caza antes,
    // y con un mensaje que dice cuál es el helper correcto.
    const fuente = codigoSinComentarios(RUTA_REPO_AVISO);
    expect(
      fuente.includes("inicioDelDiaCREnUtc") || fuente.includes("inicioDelDiaSiguienteCREnUtc"),
      "`orden.fecha_reparto` es `@db.Date`: la cota es `startOfDayCR`, no las de columnas `timestamp`",
    ).toBe(false);
  });
});
