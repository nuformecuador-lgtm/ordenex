import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import {
  documentoVisiblePara,
  ETIQUETAS_GRUPO,
  PSEUDO_ROLES_AYUDA,
  ROLES_AYUDA,
  rutasDeDocumento,
} from "@/lib/ayuda/documento";
import { ARCHIVO_EXCLUIDO } from "@/lib/ayuda/catalogo";

// ⭑ FICHA 433 — LA GUARDIA QUE MANTIENE HONESTO EL MAPEO PANTALLA↔DOCUMENTO.
//
// QUÉ VIGILA, Y POR QUÉ EXISTE
// ----------------------------
// El botón «?» del encabezado NO tiene una tabla ruta→documento escrita a mano: la DERIVA del
// `pantalla:` que declara cada `.md`. Eso quita de un plumazo el modo de fallo de las tablas
// gemelas — pero abre otro, y es el que cierra este archivo: si alguien escribe una ruta que
// no existe (una errata, una pantalla que se renombró, un `/wallet/satelite` en singular), el
// documento queda apuntando al vacío y el síntoma es que el «?» DESAPARECE de esa pantalla.
// Desaparecer no rompe ningún test: la pantalla sigue funcionando, el build pasa, el
// typecheck pasa, y nadie se entera hasta que alguien pregunte por qué ahí no hay ayuda.
// Es exactamente la familia de fallos mudos que más cara sale en este repo.
//
// La otra mitad es el HUÉRFANO: un `.md` que nadie puede alcanzar. Un documento sin `roles`
// no se le enseña a nadie (la regla es lista blanca, fallo seguro); uno sin `pantalla` no
// tiene «?»; uno en una carpeta nueva se agruparía bajo un nombre feo. Los tres son trabajo
// escrito que no llega a ningún usuario.
//
// SE DECLARA COMO GUARDIA (`*.guardia.test.ts`) PORQUE NO IMPORTA LO QUE VIGILA: lee ARCHIVOS
// del disco —los `.md` y el árbol de `app/`—, así que ningún grafo de imports la
// seleccionaría en el modo rápido. Las guardias corren SIEMPRE.
//
// ⚠️ ESTA GUARDIA NO EDITA NI EXIGE NADA DEL TEXTO de los documentos: sólo mira el
// frontmatter. Lo que un documento DICE es responsabilidad de quien lo escribe y lo revisa.

const RAIZ = process.cwd();
const DIR_AYUDA = path.join(RAIZ, "docs", "ayuda");
const DIR_APP = path.join(RAIZ, "app");

/** Las rutas relativas (con `/`) de todos los `.md` de la carpeta, README incluido. */
function listarMarkdown(prefijo = ""): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(path.join(DIR_AYUDA, prefijo), { withFileTypes: true })) {
    const relativo = prefijo === "" ? entrada.name : `${prefijo}/${entrada.name}`;
    if (entrada.isDirectory()) encontrados.push(...listarMarkdown(relativo));
    else if (entrada.name.endsWith(".md")) encontrados.push(relativo);
  }
  return encontrados;
}

/**
 * Todas las rutas REALES de la aplicación: cada carpeta de `app/` que tenga un `page.tsx`.
 *
 * Los segmentos entre paréntesis son grupos de rutas de Next y NO aparecen en la URL
 * (`app/(app)/ordenes/page.tsx` -> `/ordenes`). Los segmentos entre corchetes SÍ, tal cual:
 * `docs/ayuda/publico/rastreo-de-paquete.md` declara `/paquete/[numGuia]`, que es la forma en
 * la que esa ruta existe en el repositorio.
 */
function rutasDeLaApp(dir = DIR_APP, url = ""): Set<string> {
  const rutas = new Set<string>();
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory()) {
      if (entrada.name === "page.tsx") rutas.add(url === "" ? "/" : url);
      continue;
    }
    // `_components`, `_shared`… son carpetas privadas de Next: nunca son ruta.
    if (entrada.name.startsWith("_")) continue;
    const esGrupo = entrada.name.startsWith("(") && entrada.name.endsWith(")");
    const siguiente = esGrupo ? url : `${url}/${entrada.name}`;
    for (const ruta of rutasDeLaApp(path.join(dir, entrada.name), siguiente)) rutas.add(ruta);
  }
  return rutas;
}

const ARCHIVOS = listarMarkdown();
const DOCUMENTOS = ARCHIVOS.filter((relativo) => relativo !== ARCHIVO_EXCLUIDO).map(
  (relativo) => {
    const { datos } = partirFrontmatter(
      readFileSync(path.join(DIR_AYUDA, relativo), "utf8"),
    );
    return { relativo, datos, rutas: rutasDeDocumento(datos) };
  },
);
const RUTAS_APP = rutasDeLaApp();
const ROLES_VALIDOS = new Set<string>([...ROLES_AYUDA, ...PSEUDO_ROLES_AYUDA]);

describe("ayuda · el frontmatter no puede apuntar al vacío", () => {
  it("hay documentos que vigilar (si esto falla, la guardia se quedó mirando una carpeta vacía)", () => {
    // Sin este caso, borrar `docs/ayuda/**` dejaría TODOS los demás en verde sobre cero
    // elementos — una guardia que no vigila nada y no lo dice.
    expect(DOCUMENTOS.length).toBeGreaterThanOrEqual(30);
  });

  it("toda `pantalla:` declarada apunta a una ruta que EXISTE en app/", () => {
    const rotas = DOCUMENTOS.flatMap((doc) =>
      doc.rutas
        .filter((ruta) => !RUTAS_APP.has(ruta))
        .map((ruta) => `${doc.relativo} -> ${ruta}`),
    );
    expect(rotas).toEqual([]);
  });

  it("y la lista de rutas reales se leyó de verdad (si no, el caso de arriba sería vacuo)", () => {
    // El modo de fallo del caso anterior es que `rutasDeLaApp()` devuelva un conjunto vacío
    // por un cambio de estructura: entonces `!RUTAS_APP.has(...)` sería falso para todo y el
    // test pasaría sin comprobar nada. Este caso lo ancla contra dos rutas conocidas.
    expect(RUTAS_APP.size).toBeGreaterThan(20);
    expect(RUTAS_APP.has("/ordenes")).toBe(true);
    expect(RUTAS_APP.has("/ayuda")).toBe(true);
  });

  it("ningún documento queda huérfano: todos declaran pantalla, roles, título y fecha", () => {
    const incompletos = DOCUMENTOS.filter(
      (doc) =>
        doc.rutas.length === 0 ||
        (doc.datos.roles ?? []).length === 0 ||
        !doc.datos.titulo ||
        !doc.datos.actualizado,
    ).map((doc) => doc.relativo);
    expect(incompletos).toEqual([]);
  });

  it("los roles declarados son roles reales o los dos pseudo-roles admitidos", () => {
    // Un `roles: [adminTiendas]` con una `s` de más no rompe nada: simplemente el documento
    // deja de verse, y en silencio.
    const desconocidos = DOCUMENTOS.flatMap((doc) =>
      (doc.datos.roles ?? [])
        .filter((rol) => !ROLES_VALIDOS.has(rol))
        .map((rol) => `${doc.relativo} -> ${rol}`),
    );
    expect(desconocidos).toEqual([]);
  });

  it("toda carpeta de docs/ayuda tiene etiqueta en el índice", () => {
    const carpetas = [
      ...new Set(
        DOCUMENTOS.map((doc) => doc.relativo.split("/")[0]).filter((c) => c.endsWith(".md") === false),
      ),
    ];
    const sinEtiqueta = carpetas.filter((carpeta) => ETIQUETAS_GRUPO[carpeta] === undefined);
    expect(sinEtiqueta).toEqual([]);
  });

  it("dos documentos NO pueden declarar la misma ruta para el MISMO rol", () => {
    // `/ordenes` la declaran DOS documentos (oficina y tienda) y eso es correcto: el
    // acotamiento por rol deja uno solo en pie para cada persona. Lo que no puede pasar es que
    // le queden dos al mismo rol — ahí el «?» elegiría por orden de lectura del disco, que es
    // una preferencia que nadie decidió.
    //
    // ⚠️ SE PREGUNTA CON `documentoVisiblePara`, EL PREDICADO DE VERDAD, y no con una copia de
    // la regla escrita aquí. Antes esta guardia la re-implementaba: coincidía con la del módulo,
    // sí, pero el día que alguien cambie el acotamiento —por ejemplo para que el maestro pueda
    // leer la ayuda de los otros portales— la guardia seguiría midiendo la regla VIEJA y el
    // choque de `/ordenes` que existe para impedir se colaría en silencio.
    const choques: string[] = [];
    for (const rol of ROLES_AYUDA) {
      const porRuta = new Map<string, string[]>();
      for (const doc of DOCUMENTOS) {
        if (!documentoVisiblePara({ roles: doc.datos.roles ?? [] }, rol)) continue;
        for (const ruta of doc.rutas) {
          porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), doc.relativo]);
        }
      }
      for (const [ruta, docs] of porRuta) {
        if (docs.length > 1) choques.push(`${rol} · ${ruta} -> ${docs.join(", ")}`);
      }
    }
    expect(choques).toEqual([]);
  });
});
