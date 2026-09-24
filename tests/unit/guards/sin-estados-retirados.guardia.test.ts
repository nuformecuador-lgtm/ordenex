// GUARDIA — FICHA 454 (T1.23, R37): LOS DOS ESTADOS RETIRADOS NO VUELVEN AL CÓDIGO.
//
// La 454 retira del catálogo `devolucion_por_confirmar` (el pre-estado de la devolución, 239) y
// `ayuda_tienda` (la solicitud de ayuda a la tienda, 235). La gestión se registra sin cambiar el
// estado y se aplica al aprobar el cierre; la ayuda es un evento (`orden_evento`). El tipo
// `OrderStatusValue` ya no los admite, así que el compilador caza casi todo — pero NO caza un
// literal en un `string` suelto (una lista `readonly string[]`, un `case` sobre un `string`, un
// `where` crudo, un texto de UI que compara), que es justo por donde volvería el estado muerto: el
// sistema no falla, aparenta.
//
// ## Qué exige
//
// En `lib/`, `app/` y `components/`, los dos values solo pueden aparecer:
//   1. en COMENTARIOS (las notas fechadas que explican el retiro, que no se borran);
//   2. dentro de un MAPA DE RETIRADOS: una declaración cuyo nombre termina en `_RETIRADO` o
//      `_RETIRADOS` (`HITO_POR_ESTATUS_RETIRADO`, `ORDER_STATUS_LABELS_RETIRADOS`, …). Esos mapas
//      existen por R40: las filas HISTÓRICAS que los referencian se siguen leyendo igual;
//   3. en la lista cerrada `PERMITIDOS`, de abajo, con su motivo.
//
// Los nombres de FAMILIA de historial que contienen el texto (`solicitud_ayuda_tienda`,
// `rescate_ayuda_tienda`) no cuentan: el detector exige frontera de palabra con `_`.
//
// ## Cómo está hecha
//
// Con el AST de TypeScript, no con un barrido de texto: un barrido tendría que adivinar qué es
// comentario (y un `//` dentro de una URL lo engaña) y en qué declaración está cada aparición. Se
// miran los nodos que llevan TEXTO de código —literales de cadena y de plantilla, identificadores
// (una clave `ayuda_tienda:`) y texto JSX— y se sube por los padres buscando la declaración.
//
// Lleva control de no-vacuidad y contraprueba (fuente sintético sano, infractor y dentro de un mapa
// de retirados), como el resto de guardias de este repo.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const DIRECTORIOS = ["lib", "app", "components"] as const;

const RETIRADOS = ["devolucion_por_confirmar", "ayuda_tienda"] as const;
const PATRON = new RegExp(`(?<![A-Za-z0-9_])(${RETIRADOS.join("|")})(?![A-Za-z0-9_])`);

/** Nombre de declaración que admite los dos values (un mapa de retirados, R40). */
const NOMBRE_DE_RETIRADOS = /_RETIRADOS?$/;

/**
 * Excepciones por archivo, CERRADAS y con motivo. `maximo` es el número exacto de apariciones
 * admitidas: una más es una infracción, una menos deja la excepción caducada (y la guardia lo dice).
 */
const PERMITIDOS: Record<string, { maximo: number; motivo: string }> = {
  "lib/api/openapi-spec.ts": {
    maximo: 1,
    motivo:
      "la documentación pública avisa al integrador de que una gestión ANTERIOR al 2026-09-23 " +
      "puede traer ese `estadoResultante` en `gestiones[]` (fila histórica, R36/R40)",
  },
};

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name) && !/\.d\.ts$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function dentroDeMapaDeRetirados(nodo: ts.Node): boolean {
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (
      (ts.isVariableDeclaration(p) || ts.isPropertyDeclaration(p)) &&
      ts.isIdentifier(p.name) &&
      NOMBRE_DE_RETIRADOS.test(p.name.text)
    ) {
      return true;
    }
  }
  return false;
}

/** Las apariciones de los dos values en CÓDIGO (no en comentarios) fuera de un mapa de retirados. */
export function apariciones(codigo: string, nombre = "fuente.tsx"): string[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgos: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    let texto: string | null = null;
    if (
      ts.isStringLiteral(nodo) ||
      ts.isNoSubstitutionTemplateLiteral(nodo) ||
      ts.isTemplateHead(nodo) ||
      ts.isTemplateMiddle(nodo) ||
      ts.isTemplateTail(nodo)
    ) {
      texto = nodo.text;
    } else if (ts.isIdentifier(nodo)) {
      texto = nodo.text;
    } else if (ts.isJsxText(nodo)) {
      texto = nodo.text;
    }
    if (texto !== null) {
      const m = PATRON.exec(texto);
      if (m && !dentroDeMapaDeRetirados(nodo)) {
        const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf));
        hallazgos.push(`${nombre}:${line + 1} ${m[1]}`);
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return hallazgos;
}

const FUENTES = DIRECTORIOS.flatMap((d) => listarFuentes(path.join(RAIZ, d))).map((completo) => ({
  ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
  codigo: readFileSync(completo, "utf8"),
}));

// =============================================================================================
// 0 — el detector no está roto
// =============================================================================================

describe("0 — el detector de esta guardia no está roto", () => {
  it("no denuncia comentarios, ni las familias de historial que contienen el texto", () => {
    const sano = `
      // aquí decía \`ayuda_tienda\`: salió del catálogo (454)
      /* devolucion_por_confirmar tampoco */
      const FAMILIAS = ["solicitud_ayuda_tienda", "rescate_ayuda_tienda"];
      const url = "https://x.test//ayuda";
    `;
    expect(apariciones(sano)).toEqual([]);
  });

  it("CONTRAPRUEBA: ve el literal, la clave, la plantilla y el texto JSX", () => {
    const infractor = `
      const A = "ayuda_tienda";
      const B = { devolucion_por_confirmar: "x" };
      const C = \`estado \${x} devolucion_por_confirmar\`;
      function D() { return <p>ayuda_tienda</p>; }
    `;
    expect(apariciones(infractor)).toEqual([
      "fuente.tsx:2 ayuda_tienda",
      "fuente.tsx:3 devolucion_por_confirmar",
      "fuente.tsx:4 devolucion_por_confirmar",
      "fuente.tsx:5 ayuda_tienda",
    ]);
  });

  it("CONTRAPRUEBA: dentro de un mapa `*_RETIRADO(S)` se admite; fuera, no", () => {
    const codigo = `
      export const HITO_POR_ESTATUS_RETIRADO = { ayuda_tienda: "en_reparto" };
      export const ETIQUETAS_RETIRADOS: Record<string, string> = {
        devolucion_por_confirmar: "Devolución por confirmar",
      };
      export const ETIQUETAS = { ayuda_tienda: "Ayuda" };
    `;
    expect(apariciones(codigo)).toEqual(["fuente.tsx:6 ayuda_tienda"]);
  });

  it("el censo LEYÓ el árbol de verdad (no-vacuidad)", () => {
    expect(FUENTES.length).toBeGreaterThan(500);
    // Los dos mapas de retirados que R40 exige existen y el detector los ve como admitidos: si
    // alguien los renombrara sin el sufijo, esta guardia se pondría roja en el caso de abajo.
    const conMapa = FUENTES.filter((f) => /_RETIRADOS?\b/.test(f.codigo)).map((f) => f.ruta);
    expect(conMapa).toEqual(
      expect.arrayContaining([
        "lib/types/rastreo-publico.ts",
        "app/(app)/ordenes/_components/EstatusBadge.tsx",
      ]),
    );
  });
});

// =============================================================================================
// R37 — el árbol
// =============================================================================================

describe("454/R37 — `devolucion_por_confirmar` y `ayuda_tienda` no vuelven al código", () => {
  it("fuera de comentarios y de los mapas de retirados, no aparecen (salvo la lista cerrada)", () => {
    const infractores: string[] = [];
    for (const { ruta, codigo } of FUENTES) {
      const hallazgos = apariciones(codigo, ruta);
      const permitido = PERMITIDOS[ruta];
      if (permitido !== undefined && hallazgos.length <= permitido.maximo) continue;
      infractores.push(...hallazgos);
    }
    expect(
      infractores,
      "un estado RETIRADO por la 454 volvió al código. La gestión pendiente es `en_reparto` con su " +
        "evento `gestion_registrada` (`lib/repositories/gestion-pendiente.ts`) y la ayuda es el " +
        "evento `ayuda_solicitada` (`lib/repositories/ayuda-abierta.ts`). Si es para LEER una fila " +
        "histórica (R40), va en un mapa cuyo nombre termine en `_RETIRADO(S)`.",
    ).toEqual([]);
  });

  it("cada excepción de la lista cerrada sigue haciendo falta (no caduca en silencio)", () => {
    for (const [ruta, { maximo }] of Object.entries(PERMITIDOS)) {
      const fuente = FUENTES.find((f) => f.ruta === ruta);
      expect(fuente, `${ruta} ya no existe: retira su excepción`).toBeDefined();
      expect(apariciones(fuente!.codigo, ruta), `${ruta}: la excepción caducó`).toHaveLength(
        maximo,
      );
    }
  });
});
