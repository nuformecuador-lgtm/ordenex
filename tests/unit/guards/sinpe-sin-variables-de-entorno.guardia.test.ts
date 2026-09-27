import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RAIZ_DEL_REPO, archivosDeCodigoCensados } from "../../fixtures/raices-de-codigo";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T16-G1 (R17) — LA VARIABLE DE ENTORNO NO PUEDE VOLVER POR LA PUERTA DE ATRAS.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE, Y POR QUE NO BASTA CON HABERLA BORRADO UNA VEZ. El bloque `negocio` de una
// plantilla salia de `NEXT_PUBLIC_SINPE_NUMERO`/`NEXT_PUBLIC_SINPE_NOMBRE`, y esas dos variables
// tienen dos propiedades que las hacen especialmente peligrosas AHORA que el dato vive en la base:
//
//   1. El prefijo `NEXT_PUBLIC_` las HORNEA EN EL BUNDLE DEL CLIENTE en tiempo de build. Un valor
//      rancio sobrevive a cualquier cambio en Vercel hasta el siguiente despliegue.
//   2. Reintroducirlas como «red de seguridad» (`valorDeLaZona || valorDelEntorno`) suena prudente
//      y es la peor de las opciones: con las columnas `NOT NULL`, el lado izquierdo NUNCA puede
//      estar vacio, asi que la red no se dispara jamas en el caso que pretende cubrir. Lo unico
//      que puede hacer es TAPAR un fallo distinto —una lectura que se olvido del `select`, un DTO
//      a medio construir— devolviendo un numero plausible y equivocado, en silencio. Que es el
//      modo de fallo exacto de esta ficha.
//
// COMO SE CENSA. `archivosDeCodigoCensados()` deriva las raices DEL DISCO y las compara contra un
// inventario declarado (ficha 422): una carpeta nueva no se queda fuera sola. Se le añade
// `.env.example`, que no es codigo pero es donde la variable «vuelve a existir» primero.
//
// LA UNICA EXCEPCION, ESCRITA A LA VISTA. `scripts/seed-sinpe-inicial.ts` es el TRASVASE: lee las
// dos variables UNA vez para mover su valor a la base, y por eso tiene que poder nombrarlas. La
// alternativa —disfrazar el literal concatenando cadenas dentro del script— dejaria la guardia
// verde sin que nadie se enterara, y una guardia que se burla con un `join("_")` no vigila nada.

const PATRON = "NEXT_PUBLIC_SINPE";

/**
 * ⚠️ ALLOWLIST POR RUTA COMPLETA, no por `basename`. Un `basename` deja entrar a cualquier archivo
 * homonimo escrito en otra carpeta.
 */
const PERMITIDOS = new Map<string, string>([
  [
    "scripts/seed-sinpe-inicial.ts",
    "EL TRASVASE. Lee las dos variables UNA vez para mover su valor a `zona.sinpe_*`. Es el unico " +
      "punto del arbol autorizado, y su cabecera lo dice. Cuando la siembra este hecha en los dos " +
      "entornos, las variables se retiran del panel de Vercel (T28) y este archivo deja de tener " +
      "efecto: no se borra porque una base recreada vuelve a necesitarlo.",
  ],
  [
    "scripts/seed-zonas.ts",
    "Importa `leerSemilla` del trasvase para no crear una zona sin SINPE (R11), pero NO nombra " +
      "las variables: aparece aqui solo si alguien las escribe. Declarado para que la excepcion " +
      "se revise si eso pasa.",
  ],
]);

/** Los archivos que se miran: el codigo censado + `.env.example`. */
function archivosVigilados(): string[] {
  const archivos = archivosDeCodigoCensados();
  if (fs.existsSync(path.join(RAIZ_DEL_REPO, ".env.example"))) archivos.push(".env.example");
  return archivos;
}

function infractores(patron: string, archivos = archivosVigilados()): string[] {
  const fallos: string[] = [];
  for (const rel of archivos) {
    if (PERMITIDOS.has(rel)) continue;
    const contenido = fs.readFileSync(path.join(RAIZ_DEL_REPO, rel), "utf8");
    if (contenido.includes(patron)) fallos.push(rel);
  }
  return fallos;
}

describe("429/R17 — la cadena `NEXT_PUBLIC_SINPE` no vive en el arbol", () => {
  it("⭑ no aparece en ningun archivo de codigo censado ni en `.env.example`", () => {
    expect(infractores(PATRON)).toEqual([]);
  });

  it("el censo mira algo (anti-vacuidad): mas de cien archivos y las raices de siempre", () => {
    // Sin esto, un `archivosDeCodigoCensados()` que devolviera vacio dejaria el caso de arriba en
    // verde sin haber leido nada.
    const archivos = archivosVigilados();
    expect(archivos.length).toBeGreaterThan(100);
    for (const raiz of ["lib/", "app/", "components/", "scripts/"]) {
      expect(archivos.some((a) => a.startsWith(raiz)), raiz).toBe(true);
    }
    expect(archivos).toContain(".env.example");
  });

  it("⭑ CONTRAPRUEBA — el mismo detector, sobre una cadena que SI esta, encuentra infractores", () => {
    // Es la unica forma de demostrar que el caso de arriba pasa porque no hay nada, y no porque el
    // detector este roto. `NEXT_PUBLIC_SITE_URL` sigue viva a proposito (limite declarado nº 7 de
    // la ficha: el `urlBase` no se toca).
    const conUnaQueExiste = infractores("NEXT_PUBLIC_SITE_URL");
    expect(conUnaQueExiste.length).toBeGreaterThan(0);
  });

  it("⭑ CONTRAPRUEBA — un infractor INYECTADO en memoria pone la guardia roja", () => {
    // La contraprueba de verdad: se fabrica el defecto y se comprueba que el detector lo caza.
    const falso = path.join(RAIZ_DEL_REPO, "lib", "utils", "sinpe-cr.ts");
    const original = fs.readFileSync(falso, "utf8");
    try {
      fs.writeFileSync(
        falso,
        `${original}\n// intruso de la contraprueba: ${PATRON}_NUMERO\n`,
        "utf8",
      );
      expect(infractores(PATRON)).toContain("lib/utils/sinpe-cr.ts");
    } finally {
      fs.writeFileSync(falso, original, "utf8");
    }
    // Y el arbol queda como estaba.
    expect(infractores(PATRON)).toEqual([]);
  });

  it("cada excepcion de la allowlist EXISTE y trae su motivo escrito", () => {
    // Una allowlist con una entrada muerta es una puerta abierta con el cartel puesto.
    for (const [rel, motivo] of PERMITIDOS) {
      expect(fs.existsSync(path.join(RAIZ_DEL_REPO, rel)), rel).toBe(true);
      expect(motivo.trim().length, rel).toBeGreaterThan(80);
    }
  });

  it("⭑ el trasvase sigue siendo el UNICO que la nombra de verdad", () => {
    // Si `seed-zonas.ts` empezara a leerlas por su cuenta, esto lo dice: la excepcion esta
    // declarada para vigilarla, no para taparla.
    const seedZonas = fs.readFileSync(path.join(RAIZ_DEL_REPO, "scripts/seed-zonas.ts"), "utf8");
    expect(seedZonas).not.toContain(PATRON);
  });
});
