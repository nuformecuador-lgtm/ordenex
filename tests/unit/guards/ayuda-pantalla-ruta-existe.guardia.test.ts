import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { partirFrontmatter } from "@/lib/ayuda/frontmatter";
import {
  candidatosRutaDocumento,
  documentosQuePuedeLeer,
  documentosVisiblesPara,
  ETIQUETAS_GRUPO,
  PSEUDO_ROLES_AYUDA,
  ROLES_AYUDA,
  ROLES_LECTURA_TOTAL_AYUDA,
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

/**
 * Los mismos documentos del disco con la FORMA que pide `lib/ayuda/documento.ts`, para poder
 * preguntarle a las funciones de verdad en vez de re-implementarlas aquí. El `slug` se deja
 * con su `.md`: esta guardia habla de ARCHIVOS, y así el mensaje de un fallo nombra el que hay
 * que abrir.
 */
const COMO_RESUMEN = DOCUMENTOS.map((doc) => ({
  slug: doc.relativo,
  rutas: doc.rutas,
  roles: doc.datos.roles ?? [],
}));
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
    // ⭑ FICHA 435 — SE PREGUNTA POR `candidatosRutaDocumento`, QUE ES DE DONDE SALE EL MAPA
    // DEL «?», y no con una copia de la regla escrita aquí (hallazgo m3 de la revisión 433).
    // No es un detalle de estilo y esta ficha es la prueba: la oficina pasó a LEER el catálogo
    // entero, y si alguien ensanchara también el «?» —`mapaRutaDocumento` con el predicado de
    // lectura—, `/ordenes` le daría al maestro DOS candidatos. El mapa se come el segundo en
    // silencio (gana el primero por orden alfabético de slug) y hasta el caso de
    // `acotamiento-por-rol` que afirma `oficina/ordenes` seguiría verde. Mirando los
    // CANDIDATOS, no el ganador, el empate se ve.
    const choques: string[] = [];
    for (const rol of ROLES_AYUDA) {
      for (const [ruta, docs] of candidatosRutaDocumento(COMO_RESUMEN, rol)) {
        if (docs.length > 1) choques.push(`${rol} · ${ruta} -> ${docs.join(", ")}`);
      }
    }
    expect(choques).toEqual([]);
  });

  it("y el empate de /ordenes EXISTE de verdad: sin esto, el caso de arriba sería vacuo", () => {
    // El modo de fallo del caso anterior es que `candidatosRutaDocumento` devuelva un mapa
    // vacío —por un cambio de forma en los datos que le paso— y entonces no haya nada que
    // comparar. Estos dos anclajes son la ruta que SÍ está disputada: el maestro tiene un solo
    // candidato y es el de oficina; la tienda, el suyo. Los dos documentos existen.
    expect(candidatosRutaDocumento(COMO_RESUMEN, "maestro").get("/ordenes")).toEqual([
      "oficina/ordenes.md",
    ]);
    expect(candidatosRutaDocumento(COMO_RESUMEN, "adminTienda").get("/ordenes")).toEqual([
      "tienda/ordenes.md",
    ]);
    expect(DOCUMENTOS.filter((doc) => doc.rutas.includes("/ordenes")).length).toBe(2);
  });
});

describe("ayuda · el acotamiento de LECTURA (ficha 435) no se puede ensanchar sin que se vea", () => {
  // ⭑ FICHA 435 — la oficina lee el catálogo entero; los otros tres roles, sólo lo suyo. Los
  // recuentos por rol viven en `tests/components/AyudaLayout.test.tsx`, que es donde se ve lo
  // que la persona recibe. Lo que se cierra AQUÍ es la forma de la regla, contra los archivos
  // del disco y en una guardia —que corre siempre, también en el gate rápido—.

  it("los dos roles de lectura total son de OFICINA, y están dentro de ROLES_AYUDA", () => {
    // Escrito a mano: si alguien mete `mensajero`, `adminTienda` o `adminSatelite` en la lista,
    // esto se pone rojo antes de que ningún recuento se mueva. Son cuentas de gente ajena a la
    // empresa (tiendas y satélites) o de calle: leer la ayuda de la caja no es asunto suyo.
    expect([...ROLES_LECTURA_TOTAL_AYUDA]).toEqual(["maestro", "admin"]);
    for (const rol of ROLES_LECTURA_TOTAL_AYUDA) {
      expect((ROLES_AYUDA as readonly string[]).includes(rol), rol).toBe(true);
    }
  });

  it("leer NUNCA es más estrecho que «es tu pantalla»: quien ve un documento puede abrirlo", () => {
    // La otra mitad, y la que impide el 404 tonto: un índice que ofrece un enlace que el gate
    // de la página rechaza. Se recorre rol por rol sobre los documentos REALES.
    for (const rol of ROLES_AYUDA) {
      const suyos = documentosVisiblesPara(COMO_RESUMEN, rol).map((doc) => doc.slug);
      const legibles = new Set(documentosQuePuedeLeer(COMO_RESUMEN, rol).map((d) => d.slug));
      expect(suyos.length, rol).toBeGreaterThan(0);
      expect(suyos.filter((slug) => !legibles.has(slug)), rol).toEqual([]);
    }
  });
});
