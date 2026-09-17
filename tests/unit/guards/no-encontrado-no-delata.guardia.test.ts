// GUARDIA — FICHA 438: LA PANTALLA DE «NO ENCONTRADO» EXISTE, NO DELATA EL MOTIVO Y NO
// ESCRIBE SU PROPIA LISTA DE ROLES.
//
// ## Por qué existe, y por qué censa el fuente en vez de sólo ejecutar
//
// Las tres promesas de esta ficha son ciertas HOY porque se escribieron así, y ninguna de las
// tres rompe un test el día que alguien las deshaga sin querer:
//
//   · Si se borra `app/(app)/not-found.tsx`, el portal vuelve a la pantalla interna de Next
//     —«404. This page could not be found.», en inglés— para una app que usan mensajeros en
//     Costa Rica. Compila, pasa el lint y no falla nada: simplemente deja de existir un archivo.
//   · Si alguien «mejora» el texto con un «no tenés acceso», la pantalla se ve MEJOR y a la vez
//     empieza a filtrar qué documentos existen a quien no debería saberlo (ficha 433: el 404 y
//     el 403 son indistinguibles A PROPÓSITO, porque los slugs son adivinables). Nada se pone
//     rojo: es más texto, y más amable.
//   · Si alguien escribe aquí un segundo mapa rol→ruta «para no depender del menú», las dos
//     listas divergen en la primera reorganización del sidebar y nadie se entera hasta que un
//     mensajero pulsa «Ir al inicio» y cae en otro 404.
//
// Es exactamente la familia que este repo llama «el sistema no falla, aparenta». Por eso el
// control es un censo del fuente: un guardia que mirase el diff deja de proteger en cuanto la
// rama se mergea.
//
// ## Cada detector se prueba contra código que SÍ infringe
//
// Un detector que no puede fallar es decorado. Cada cláusula lleva su caso positivo escrito
// abajo, y el censo lleva control de no-vacuidad: si los archivos se movieran, este guardia
// diría «verde» sin haber mirado nada.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");

/** Las dos alturas de la pantalla, y qué cubre cada una. */
const PANTALLA_DEL_PORTAL = "app/(app)/not-found.tsx";
const PANTALLA_DE_FUERA = "app/not-found.tsx";
/** La pieza compartida donde vive EL TEXTO, que es el requisito de seguridad. */
const PIEZA_COMPARTIDA = "components/shared/NoEncontradoState.tsx";

const PANTALLAS = [PANTALLA_DEL_PORTAL, PANTALLA_DE_FUERA, PIEZA_COMPARTIDA] as const;

/** Fuente de un archivo del repo, ya sin comentarios (los comentarios NOMBRAN lo prohibido). */
function codigo(relativo: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, relativo), "utf8"));
}

/* ── LOS DETECTORES ───────────────────────────────────────────────────────────────────────── */

/**
 * ¿El texto nombra el motivo? Este es el vocabulario que convierte la negativa en un dato: a
 * quien lee «no tenés acceso» la aplicación acaba de confirmarle que esa página EXISTE.
 *
 * `digest`-style: se busca sobre el CÓDIGO, no sobre los comentarios, porque los comentarios de
 * este árbol nombran a propósito lo que está prohibido (este mismo archivo es el ejemplo).
 */
const VOCABULARIO_DELATOR: readonly RegExp[] = [
  /no ten[eé]s acceso/i,
  /no tienes acceso/i,
  /sin acceso/i,
  /acceso denegado/i,
  /no ten[eé]s permiso/i,
  /no tienes permiso/i,
  /sin permiso/i,
  /no autorizad/i,
  /no est[aá]s autorizad/i,
  /prohibid/i,
  /\b403\b/,
  /forbidden/i,
  /unauthorized/i,
];

const delataElMotivo = (fuente: string): boolean =>
  VOCABULARIO_DELATOR.some((delator) => delator.test(fuente));

/**
 * ¿La pantalla escribe su propia tabla de roles o de rutas? Los nombres de rol son los valores
 * de `RolValue`; las rutas de portal son cualquier literal que empiece por `/` y siga con letra
 * (la raíz `"/"` está permitida: es la salida neutra cuando no hay sesión).
 */
const ROLES = [
  "maestro",
  "admin",
  "adminTienda",
  "adminSatelite",
  "mensajero",
  "apiKey",
] as const;

const escribeUnRol = (fuente: string): boolean =>
  ROLES.some((rol) => new RegExp(`["'\`]${rol}["'\`]`).test(fuente));

const escribeUnaRuta = (fuente: string): boolean => /["'`]\/[a-zA-Z]/.test(fuente);

/** ¿El destino sale de la fuente compartida del menú? */
const usaElMenuCompartido = (fuente: string): boolean =>
  /from\s+["']@\/lib\/auth\/menu-visibility["']/.test(fuente) &&
  /\bprimerDestino\b/.test(fuente) &&
  /\bitemsVisibles\b/.test(fuente) &&
  /\bSIDEBAR_ITEMS\b/.test(fuente);

/** ¿Monta el armazón del portal (`AppPage` -> `PageHeader`)? */
const montaElArmazon = (fuente: string): boolean => /\bAppPage\b/.test(fuente);

/** ¿Lee la sesión? La de la raíz no puede: Next la prerenderiza como `/_not-found`. */
const leeLaSesion = (fuente: string): boolean =>
  /\bresolveActorFromSession\b/.test(fuente) || /from\s+["']next\/headers["']/.test(fuente);

/** ¿Deja salir? Un enlace de vuelta, siempre. */
const dejaSalir = (fuente: string): boolean => /\bhrefInicio\b/.test(fuente);

/**
 * ¿La pieza compartida PINTA ese enlace? `dejaSalir` sólo comprueba que la pantalla PASA el
 * destino; una pieza que reciba la prop y no la use se lee igual de bien y deja un callejón.
 * Es la misma distinción que este repo escribió al medir un composition root que importaba un
 * notificador sin llegar a inyectarlo.
 */
const pintaElEnlace = (fuente: string): boolean =>
  /<Link\s+href=\{hrefInicio\}/.test(fuente);

/**
 * Nombres de las props declaradas en `NoEncontradoStateProps`. Se comparan POR IGUALDAD contra
 * una lista escrita a mano: una prop NUEVA obliga a decidir a mano si por ahí puede entrar el
 * motivo. Es la mitad ESTRUCTURAL del requisito de seguridad — la pieza no puede ramificar por
 * algo que no recibe, y eso no es una promesa: es que no hay parámetro.
 */
function propsDeLaPieza(fuente: string): string[] {
  const apertura = fuente.indexOf("interface NoEncontradoStateProps");
  if (apertura === -1) return [];
  const llave = fuente.indexOf("{", apertura);
  const cierre = fuente.indexOf("\n}", llave);
  if (llave === -1 || cierre === -1) return [];
  const cuerpo = fuente.slice(llave + 1, cierre);
  return [...cuerpo.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]).sort();
}

/* ── EL CENSO, SOBRE LOS ARCHIVOS REALES ──────────────────────────────────────────────────── */

describe("las dos pantallas existen (si se borran, vuelve el 404 en inglés y nada se pone rojo)", () => {
  for (const pantalla of PANTALLAS) {
    it(`${pantalla} está en el árbol`, () => {
      expect(existsSync(path.join(RAIZ, pantalla))).toBe(true);
    });
  }

  it("el censo no es vacío: los tres archivos tienen contenido", () => {
    for (const pantalla of PANTALLAS) {
      expect(codigo(pantalla).length).toBeGreaterThan(100);
    }
  });
});

describe("el texto no delata si la página existe o si no es para esta cuenta (ficha 433)", () => {
  for (const pantalla of PANTALLAS) {
    it(`${pantalla} no usa vocabulario que nombre el motivo`, () => {
      expect(delataElMotivo(codigo(pantalla))).toBe(false);
    });
  }

  it("la frase dice LAS DOS MITADES y las une: no es «no existe» ni «no tenés acceso» a secas", () => {
    // Literal escrito a mano, y PROHIBIDO derivarlo del componente: es el contrato de la
    // ficha. Si alguien lo cambia, que tenga que decidirlo aquí.
    expect(codigo(PIEZA_COMPARTIDA)).toContain(
      "Esta página no existe, o no es para tu cuenta.",
    );
  });

  it("el motivo no tiene por dónde ENTRAR: la pieza sólo recibe la salida", () => {
    // Igualdad, no `toContain`: una prop nueva pone esto rojo aunque sea inocente, que es
    // justo lo que se quiere — la decisión de abrirle una entrada al motivo no puede ser
    // silenciosa.
    expect(propsDeLaPieza(codigo(PIEZA_COMPARTIDA))).toEqual([
      "etiquetaInicio",
      "hrefInicio",
    ]);
  });

  it("y las dos pantallas montan LA MISMA pieza: no pueden decir cosas distintas", () => {
    for (const pantalla of [PANTALLA_DEL_PORTAL, PANTALLA_DE_FUERA]) {
      expect(codigo(pantalla)).toMatch(
        /from\s+["']@\/components\/shared\/NoEncontradoState["']/,
      );
    }
  });
});

describe("el armazón: la del portal lo conserva, la de fuera no puede", () => {
  it("la del portal monta AppPage (encabezado), y el layout del grupo le pone el sidebar", () => {
    expect(montaElArmazon(codigo(PANTALLA_DEL_PORTAL))).toBe(true);
  });

  it("la de fuera NO monta AppPage ni lee la sesión", () => {
    const fuente = codigo(PANTALLA_DE_FUERA);
    expect(montaElArmazon(fuente)).toBe(false);
    // Leer la cookie aquí volvería dinámica la ruta `/_not-found`, que Next prerenderiza.
    expect(leeLaSesion(fuente)).toBe(false);
  });
});

describe("la salida sale del menú compartido, no de una segunda lista de roles", () => {
  it("la del portal deriva el destino de SIDEBAR_ITEMS", () => {
    expect(usaElMenuCompartido(codigo(PANTALLA_DEL_PORTAL))).toBe(true);
  });

  it("la del portal no escribe ni un nombre de rol ni una ruta de portal", () => {
    const fuente = codigo(PANTALLA_DEL_PORTAL);
    expect(escribeUnRol(fuente)).toBe(false);
    expect(escribeUnaRuta(fuente)).toBe(false);
  });

  it("las dos dejan salir: ninguna es un callejón", () => {
    for (const pantalla of [PANTALLA_DEL_PORTAL, PANTALLA_DE_FUERA]) {
      expect(dejaSalir(codigo(pantalla))).toBe(true);
    }
    // Y el destino no se queda en la puerta: la pieza compartida lo PINTA.
    expect(pintaElEnlace(codigo(PIEZA_COMPARTIDA))).toBe(true);
  });
});

/* ── CADA DETECTOR, CONTRA CÓDIGO QUE SÍ INFRINGE ─────────────────────────────────────────── */

describe("los detectores muerden (si no, este guardia sería decorado)", () => {
  it("`delataElMotivo` caza las dos formas de filtrar el caso", () => {
    expect(delataElMotivo('title="No tenés acceso a esta página."')).toBe(true);
    expect(delataElMotivo('title="Acceso denegado"')).toBe(true);
    expect(delataElMotivo('const codigo = 403;')).toBe(true);
    expect(delataElMotivo('title="Esta página no existe, o no es para tu cuenta."')).toBe(
      false,
    );
  });

  it("`escribeUnRol` y `escribeUnaRuta` cazan la segunda lista escrita a mano", () => {
    expect(escribeUnRol('const inicio = rol === "mensajero" ? a : b;')).toBe(true);
    expect(escribeUnaRuta('const inicio = "/mis-asignaciones/reparto";')).toBe(true);
    // La raíz sigue permitida: es la salida neutra cuando no hay sesión.
    expect(escribeUnaRuta('const inicio = destino ?? "/";')).toBe(false);
  });

  it("`usaElMenuCompartido` distingue derivar del menú de no hacerlo", () => {
    const bueno = `import { itemsVisibles, primerDestino, SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";
      const inicio = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor));`;
    expect(usaElMenuCompartido(bueno)).toBe(true);
    expect(usaElMenuCompartido('const inicio = DESTINOS_POR_ROL[rol];')).toBe(false);
  });

  it("`montaElArmazon`, `leeLaSesion` y `dejaSalir` distinguen su caso", () => {
    expect(montaElArmazon("return <AppPage title=\"x\" />;")).toBe(true);
    expect(montaElArmazon("return <main />;")).toBe(false);
    expect(leeLaSesion('const a = await resolveActorFromSession();')).toBe(true);
    expect(leeLaSesion('import { cookies } from "next/headers";')).toBe(true);
    expect(leeLaSesion("return <main />;")).toBe(false);
    expect(dejaSalir("<NoEncontradoState hrefInicio={inicio} />")).toBe(true);
    expect(dejaSalir("<NoEncontradoState />")).toBe(false);
    expect(pintaElEnlace("<Link href={hrefInicio}>{etiquetaInicio}</Link>")).toBe(true);
    // Recibir la prop y no pintarla: el callejón que `dejaSalir` no puede ver.
    expect(pintaElEnlace("function X({ hrefInicio }) { return <EmptyState />; }")).toBe(
      false,
    );
  });

  it("`propsDeLaPieza` ve una prop nueva por la que entraría el motivo", () => {
    const conMotivo = `export interface NoEncontradoStateProps {
  hrefInicio: string;
  etiquetaInicio?: string;
  motivo: "no-existe" | "sin-permiso";
}
`;
    expect(propsDeLaPieza(conMotivo)).toEqual([
      "etiquetaInicio",
      "hrefInicio",
      "motivo",
    ]);
    // Y no se inventa nada si la interfaz no está: devuelve vacío, que no equivale a la lista
    // esperada y por tanto pone rojo el caso real en vez de dejarlo pasar.
    expect(propsDeLaPieza("export function x() {}")).toEqual([]);
  });
});
