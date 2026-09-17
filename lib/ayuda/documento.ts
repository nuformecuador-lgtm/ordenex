import type { RolValue } from "@prisma/client";

import type { FrontmatterAyuda } from "@/lib/ayuda/frontmatter";

/**
 * ⭑ FICHA 433 — el DOCUMENTO de ayuda como dato, y las reglas puras que lo acotan.
 *
 * Este módulo NO toca `fs` a propósito: lo importan el servidor (que lee los archivos) y
 * también el cliente (el índice filtra con `filtrarDocumentos`). Todo lo que sabe leer un
 * archivo vive en `catalogo.ts`, que es el ÚNICO que importa `node:fs`.
 */

/** Un documento de `docs/ayuda/**`, ya leído. */
export interface DocumentoAyuda {
  /**
   * Ruta relativa dentro de `docs/ayuda/` sin extensión — p. ej. `mensajero/reparto`.
   * Es la identidad del documento Y su URL (`/ayuda/mensajero/reparto`): NO hay una
   * segunda tabla de slugs que pueda divergir del árbol de archivos.
   */
  slug: string;
  /** La carpeta (`mensajero`, `oficina`, …). Es el grupo del índice. */
  grupo: string;
  titulo: string;
  modulo: string;
  /** Las rutas de la app que explica. Vacío si el documento no declara ninguna. */
  rutas: readonly string[];
  /** Los roles declarados en el frontmatter, CRUDOS (incluye `todos` y `publico`). */
  roles: readonly string[];
  /** `actualizado` del frontmatter, tal cual (ISO `YYYY-MM-DD`). */
  actualizado: string;
  /** El Markdown, sin frontmatter. */
  cuerpo: string;
}

/** Lo que el índice necesita para pintarse: metadatos SIN el cuerpo. */
export type ResumenDocumento = Omit<DocumentoAyuda, "cuerpo">;

/**
 * Quién ve el ítem «Ayuda» del menú y la ruta `/ayuda`: **las cinco cuentas de PERSONA**.
 *
 * ⚠️ `apiKey` NO ESTÁ, Y NO ES UN OLVIDO. Es una cuenta de máquina que no navega la UI
 * (`lib/types/roles.ts`, y el mismo criterio escrito en `ROLES_ACCESO_ANALITICA`), y además
 * `tests/unit/auth/destino-post-login.test.ts` afirma que `apiKey` NO tiene destino
 * post-login: como este ítem va sin `destinoInicial: false`, meterlo aquí convertiría
 * `/ayuda` en el primer —y único— destino elegible de esa cuenta y pondría rojo ese caso
 * sin que nadie hubiera decidido nada.
 *
 * `as const satisfies` y no `readonly RolValue[]`: el `satisfies` comprueba que cada nombre
 * es un `RolValue` real del esquema SIN ensanchar el tipo, así la tupla conserva su
 * identidad y el ítem de menú puede REFERENCIARLA. Mismo patrón que `ROLES_MI_WALLET`.
 */
export const ROLES_AYUDA = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
] as const satisfies readonly RolValue[];

/**
 * Los dos PSEUDO-ROLES que el frontmatter admite y que no son `RolValue`:
 *
 * - `todos` — el documento vale para cualquiera que haya entrado.
 * - `publico` — el documento explica una superficie que se usa SIN sesión (rastrear un
 *   paquete, postularse). Se le enseña a todo el mundo a propósito: es contenido que
 *   cualquiera puede ver escribiendo la URL, así que esconderlo no protege nada y sí deja
 *   a un administrador sin poder consultar cómo ve la pantalla su cliente.
 *
 * El acotamiento por rol existe para lo de DENTRO —que un mensajero no se tropiece con la
 * ayuda de Wallet—, no para lo que ya es público.
 */
export const PSEUDO_ROLES_AYUDA = ["todos", "publico"] as const;

/**
 * Etiqueta humana de cada carpeta de `docs/ayuda/`. Los textos son los de la tabla «Cómo
 * está organizada» del README de la carpeta.
 *
 * Es la ÚNICA tabla escrita a mano de este módulo, y está acotada a propósito: el mapeo
 * ruta→documento se DERIVA del frontmatter (por eso no se desincroniza), pero «cómo se
 * llama en castellano la carpeta `oficina`» no está escrito en ningún sitio del que
 * derivarlo. La guardia `ayuda-pantalla-ruta-existe.guardia.test.ts` exige que toda carpeta
 * presente en el disco tenga entrada aquí: una carpeta nueva se pone roja, no se cuela con
 * un nombre feo.
 */
export const ETIQUETAS_GRUPO: Record<string, string> = {
  mensajero: "Mensajeros",
  tienda: "Tiendas",
  satelite: "Bodegas satélite",
  oficina: "Oficina",
  compartido: "Compartido",
  publico: "Sin iniciar sesión",
};

/**
 * Orden en el que se apilan los grupos del índice. Los que no aparezcan aquí van detrás,
 * alfabéticos — no se pierden, sólo no tienen sitio decidido.
 */
const ORDEN_GRUPOS = ["mensajero", "tienda", "satelite", "oficina", "compartido", "publico"];

/**
 * Las rutas que un documento declara en `pantalla:`.
 *
 * Son VARIAS cuando una sola explicación cubre dos pantallas —hoy
 * `publico/entrar-y-recuperar-contrasena.md`, con `/login, /recuperar-contrasena`—, y por
 * eso el mapa ruta→documento es de muchos a uno y no una biyección.
 */
export function rutasDeDocumento(datos: FrontmatterAyuda): string[] {
  if (!datos.pantalla) return [];
  return datos.pantalla
    .split(",")
    .map((ruta) => ruta.trim())
    .filter((ruta) => ruta !== "");
}

/**
 * ⚠️ DE QUIÉN ES LA PANTALLA. Éste es el predicado ESTRICTO, y desde la ficha 435 **no es el
 * que decide quién puede LEER**: decide de quién es la pantalla que el documento explica.
 *
 * Un documento «es» de `rol` si su `roles:` lo declara, o si vale para todos / es público.
 * Es una LISTA BLANCA: un documento cuyo frontmatter no declare `roles` no es de nadie (y la
 * guardia lo caza antes).
 *
 * ⭑ QUIÉN LO USA, Y POR QUÉ SIGUE ESTRICTO. Lo usa `mapaRutaDocumento` —el mapa del botón
 * «?»—, y ahí el estrechamiento es lo que hace que la respuesta sea ÚNICA: `/ordenes` la
 * declaran DOS documentos (`oficina/ordenes.md` y `tienda/ordenes.md`), y lo que deja uno
 * solo en pie para cada persona es justamente esta regla. Si el «?» preguntara con el
 * predicado ANCHO de lectura, el maestro tendría dos candidatos para esa ruta y ganaría el
 * primero por orden alfabético de slug: un desempate que nadie decidió, en el botón que la
 * gente sí usa. `candidatosRutaDocumento` + la guardia lo dejan escrito y ejecutable.
 *
 * Para «¿puede ABRIR este documento?» está `puedeLeerDocumento`.
 */
export function documentoVisiblePara(
  doc: Pick<DocumentoAyuda, "roles">,
  rol: RolValue | null,
): boolean {
  if (rol === null) return false;
  if (!(ROLES_AYUDA as readonly string[]).includes(rol)) return false;
  return doc.roles.some(
    (declarado) =>
      declarado === rol || (PSEUDO_ROLES_AYUDA as readonly string[]).includes(declarado),
  );
}

/** Los documentos cuya pantalla es de `rol`. Es la lista del «?», no la de lectura. */
export function documentosVisiblesPara<T extends Pick<DocumentoAyuda, "roles">>(
  docs: readonly T[],
  rol: RolValue | null,
): T[] {
  return docs.filter((doc) => documentoVisiblePara(doc, rol));
}

/**
 * ⭑ FICHA 435 — LOS DOS ROLES DE OFICINA LEEN EL CATÁLOGO ENTERO.
 *
 * Decisión de producto del humano, tomada el 2026-09-16. El porqué, medido: la oficina es
 * quien atiende por teléfono las dudas de los 18 mensajeros y de las tiendas, y hasta hoy
 * `/ayuda/mensajero/reparto` le daba 404 — quien contesta no tenía delante la misma pantalla
 * que quien pregunta. El acotamiento por rol se diseñó simétrico y su razón sigue viva en la
 * otra dirección: lo que no puede pasar es que un mensajero, una tienda o un satélite —gente
 * ajena a la empresa— lean cómo funciona la caja. **Esta lista NO se ensancha a esos tres**;
 * si alguien lo intenta, los recuentos por rol de `AyudaLayout.test.tsx` se ponen rojos.
 *
 * ⚠️ NO CAMBIA EL SIGNIFICADO DE `roles:` EN EL FRONTMATTER. Ese campo sigue diciendo «de
 * quién es esta pantalla» (contrato escrito en `docs/ayuda/README.md`) y es lo que alimenta
 * la agrupación del índice y el «?». Lo que cambia es quién puede LEER, que es otra pregunta.
 *
 * Mismo patrón que `ROLES_AYUDA`: `as const satisfies` para que cada nombre se compruebe
 * contra `RolValue` sin ensanchar el tipo ni perder la identidad de la tupla.
 */
export const ROLES_LECTURA_TOTAL_AYUDA = [
  "maestro",
  "admin",
] as const satisfies readonly RolValue[];

/**
 * ⚠️ EL ACOTAMIENTO DE LECTURA — el predicado que decide si `/ayuda/<slug>` se abre o da 404,
 * y qué entra en el índice. Es el ANCHO: el estricto, MÁS el catálogo entero para la oficina.
 *
 * Las dos puertas duras se mantienen y son las de siempre: sin sesión no se lee nada, y
 * `apiKey` tampoco (no está en `ROLES_AYUDA`; es una cuenta de máquina que no navega la UI).
 * El fallo seguro sigue siendo esconder: para los tres roles que no son de oficina esto
 * devuelve exactamente lo mismo que `documentoVisiblePara`.
 */
export function puedeLeerDocumento(
  doc: Pick<DocumentoAyuda, "roles">,
  rol: RolValue | null,
): boolean {
  if (rol === null) return false;
  if (!(ROLES_AYUDA as readonly string[]).includes(rol)) return false;
  if ((ROLES_LECTURA_TOTAL_AYUDA as readonly string[]).includes(rol)) return true;
  return documentoVisiblePara(doc, rol);
}

/** Los documentos que `rol` puede LEER: el índice del módulo y el gate de la página. */
export function documentosQuePuedeLeer<T extends Pick<DocumentoAyuda, "roles">>(
  docs: readonly T[],
  rol: RolValue | null,
): T[] {
  return docs.filter((doc) => puedeLeerDocumento(doc, rol));
}

/**
 * EL MAPA RUTA→DOCUMENTO del botón «?», **derivado del frontmatter y ya acotado por rol**.
 *
 * ⚠️ NO HAY NINGUNA TABLA RUTA→DOCUMENTO ESCRITA A MANO EN ESTE REPO, y ésta es la razón:
 * una tabla se desincroniza del día en que alguien renombra un documento o mueve una
 * pantalla, y el síntoma sería un «?» que lleva a un 404 — o peor, que no aparece. Aquí la
 * única fuente es el `pantalla:` del propio documento.
 *
 * Que el acotamiento por rol ocurra AQUÍ y no en el botón no es un detalle de estilo: el
 * mapa se calcula en el servidor, que es el único que conoce la sesión, y lo que cruza al
 * cliente ya viene recortado. Un mensajero no recibe siquiera el slug de la ayuda de Wallet.
 *
 * Cuando dos documentos declaran la MISMA ruta —hoy `/ordenes`, que tiene el de oficina y el
 * de tienda—, el acotamiento por rol ya ha dejado uno solo en pie para cada persona. Si aun
 * así quedaran dos, gana el primero y la guardia lo dice: es un documento mal declarado, no
 * un empate que haya que resolver con una preferencia inventada.
 *
 * ⭑ FICHA 435 — PREGUNTA CON `documentoVisiblePara`, EL ESTRICTO, Y NO CON EL DE LECTURA. Es
 * el punto entero de la ficha: la oficina pasa a LEER el catálogo entero, pero su «?» sigue
 * llevando a la ayuda de SU pantalla. Con el predicado ancho aquí, `/ordenes` le daría al
 * maestro dos candidatos y el empate lo resolvería el orden alfabético del slug.
 */
export function mapaRutaDocumento(
  docs: readonly ResumenDocumento[],
  rol: RolValue | null,
): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const [ruta, slugs] of candidatosRutaDocumento(docs, rol)) {
    // `slugs` nunca está vacío: la ruta existe en el mapa porque un documento la declaró.
    mapa[ruta] = slugs[0];
  }
  return mapa;
}

/**
 * ⭑ FICHA 435 — LO MISMO QUE `mapaRutaDocumento`, PERO SIN TIRAR LOS EMPATES. Devuelve TODOS
 * los documentos que se disputan cada ruta, y de aquí sale el mapa de arriba quedándose con
 * el primero.
 *
 * ⚠️ EXISTE PARA QUE EL EMPATE SEA OBSERVABLE, que es lo único que un test puede vigilar. El
 * mapa se come el segundo candidato en silencio: si alguien ensanchara el «?» al predicado de
 * lectura, `mapaRutaDocumento(docs, "maestro")["/ordenes"]` seguiría devolviendo
 * `oficina/ordenes` —gana por alfabético— y ni un test se enteraría. La guardia
 * `ayuda-pantalla-ruta-existe.guardia.test.ts` pregunta por AQUÍ justamente por eso, y así
 * mide la regla que el mapa usa DE VERDAD en vez de re-implementarla al lado (hallazgo m3 de
 * `progress/review_433.md`).
 */
export function candidatosRutaDocumento(
  docs: readonly Pick<ResumenDocumento, "slug" | "rutas" | "roles">[],
  rol: RolValue | null,
): Map<string, string[]> {
  const porRuta = new Map<string, string[]>();
  for (const doc of documentosVisiblesPara(docs, rol)) {
    for (const ruta of doc.rutas) {
      porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), doc.slug]);
    }
  }
  return porRuta;
}

/** Un grupo del índice, con su etiqueta ya resuelta. */
export interface GrupoAyuda {
  clave: string;
  etiqueta: string;
  documentos: readonly ResumenDocumento[];
}

/** Agrupa los documentos por carpeta, en el orden en el que se apila el índice. */
export function agruparDocumentos(docs: readonly ResumenDocumento[]): GrupoAyuda[] {
  const porGrupo = new Map<string, ResumenDocumento[]>();
  for (const doc of docs) {
    const yaEstan = porGrupo.get(doc.grupo);
    if (yaEstan) yaEstan.push(doc);
    else porGrupo.set(doc.grupo, [doc]);
  }

  return [...porGrupo.entries()]
    .sort(([a], [b]) => posicionGrupo(a) - posicionGrupo(b) || a.localeCompare(b, "es"))
    .map(([clave, documentos]) => ({
      clave,
      etiqueta: ETIQUETAS_GRUPO[clave] ?? clave,
      documentos: [...documentos].sort((x, y) => x.titulo.localeCompare(y.titulo, "es")),
    }));
}

function posicionGrupo(clave: string): number {
  const i = ORDEN_GRUPOS.indexOf(clave);
  return i === -1 ? ORDEN_GRUPOS.length : i;
}

/**
 * El filtro del buscador. Sobre el TÍTULO y el MÓDULO, no sobre el cuerpo: el índice no
 * recibe los cuerpos (son ~90 KB que no tienen por qué cruzar a un teléfono en la calle), y
 * buscar por título es lo que resuelve «¿dónde estaba lo de los cierres?».
 */
export function filtrarDocumentos<T extends Pick<ResumenDocumento, "titulo" | "modulo">>(
  docs: readonly T[],
  consulta: string,
): T[] {
  const termino = normalizar(consulta);
  if (termino === "") return [...docs];
  return docs.filter(
    (doc) =>
      normalizar(doc.titulo).includes(termino) || normalizar(doc.modulo).includes(termino),
  );
}

/**
 * Minúsculas y SIN acentos: en la calle nadie escribe «Recolección» con tilde, y un buscador
 * que no encuentra «recoleccion» es un buscador roto.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
