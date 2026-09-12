import fs from "node:fs";
import path from "node:path";

// FICHA 422 (B1 de `progress/review_422.md`, 2026-09-11) — QUE ES «TODO EL ARBOL», DECLARADO Y
// COMPARADO CONTRA EL DISCO.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE EXISTE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Dos guardias de esta ficha (`push-intencion-de-baja` y `push-alta-punto-unico`) afirman cosas de
// la forma «esto aparece UNA SOLA VEZ **en todo el arbol**»: R10 (nadie se da de baja sin declarar
// su motivo) y R16 (hay UNA sola llamada a `Notification.requestPermission()`). Las dos escribian
// su propia lista de carpetas a mano:
//
//     const RAICES_DEL_CENSO = ["app", "components", "hooks", "lib"];
//
// Y esa lista estaba INCOMPLETA. La revision lo midio: `providers/` —donde vive el `ToastProvider`
// que envuelve al componente de reactivacion de esta misma ficha— quedaba fuera, y un intruso
// escrito ahi daba `TSC_EXIT=0` con **145 archivos de guardia y 2.091 casos EN VERDE**. O sea: las
// dos guardias decian «en todo el arbol» mirando 4 de 8 raices.
//
// ⚠️ EL ARREGLO NO ES ANADIR `"providers"`. Eso repara el sintoma de hoy y deja la causa intacta:
// **una lista de raices escrita a mano envejece sola y en silencio**, que es exactamente la familia
// de fallo mudo que estas guardias existen para cerrar. Una carpeta nueva de primer nivel —o una
// que alguien anada dentro de seis meses— volveria a quedarse fuera sin que nada fallara.
//
// POR ESO AQUI LA LISTA SE **DERIVA DEL DISCO** Y SE **COMPARA** CONTRA UN INVENTARIO DECLARADO:
//
//   · `raicesDelArbol()` recorre el repositorio y devuelve toda raiz de primer nivel que contenga
//     codigo TypeScript. No hay lista de carpetas escrita a mano en esa funcion.
//   · `INVENTARIO_DE_RAICES` dice, para CADA una, si se censa y POR QUE.
//   · `fallosDelInventario()` compara las dos. Una raiz nueva que nadie haya clasificado **pone las
//     guardias rojas** y obliga a escribir su motivo. Una entrada del inventario que ya no exista en
//     el disco, tambien.
//
// Es el mismo mecanismo que `api-key-dependencias-usuario.ts` usa con las FK hacia `usuario`: la
// verdad se deriva, la decision se escribe, y la guardia exige que coincidan. Derivar las dos de la
// misma fuente dejaria el caso verde por construccion —«asercion contra su propia fuente», leccion
// ya escrita en este repo— y no detectaria nada.

export const RAIZ_DEL_REPO = path.resolve(__dirname, "..", "..");

/** Nombre con el que se declara el conjunto de archivos `.ts` sueltos en la raiz del repositorio. */
export const PSEUDO_RAIZ_ARCHIVOS = "(raiz)";

export interface RaizDeCodigo {
  /** Carpeta de primer nivel, o `(raiz)` para los `.ts` sueltos del directorio raiz. */
  readonly ruta: string;
  /** `true` = sus archivos entran en el censo de las guardias. */
  readonly censada: boolean;
  /** POR QUE. Obligatorio en las dos respuestas: una decision sin motivo no se puede revisar. */
  readonly motivo: string;
}

/**
 * EL INVENTARIO. Una entrada por raiz de codigo del repositorio, con su decision y su porque.
 *
 * La regla que se siguio para decidir: **se censa todo lo que se despliega o lo que el build
 * type-checkea**, y solo queda fuera lo que tiene una razon legitima para nombrar lo que las
 * guardias persiguen. Hoy eso es una sola carpeta, y esta dicho abajo.
 */
export const INVENTARIO_DE_RAICES: readonly RaizDeCodigo[] = [
  {
    ruta: "app",
    censada: true,
    motivo:
      "El arbol de rutas: el portal autenticado y la landing publica. Aqui vive el `LogoutButton` " +
      "(una de las dos superficies que se dan de baja) y el layout que monta la reactivacion. Es " +
      "el sitio mas obvio donde aparecera una tercera superficie.",
  },
  {
    ruta: "components",
    censada: true,
    motivo:
      "Los componentes compartidos: `PushOptIn` (el interruptor) y `PushReactivacion`. La revision " +
      "colo aqui un intruso con alias sobre `AvisoVersionNueva.tsx`, un componente YA montado.",
  },
  {
    ruta: "e2e",
    censada: true,
    motivo:
      "Especificaciones de Playwright. No se despliegan, pero tampoco tienen ningun motivo " +
      "legitimo para importar la baja ni para pedir el permiso del navegador: censarla no cuesta " +
      "nada y deja una raiz menos que explicar. Una excepcion que no hace falta no se escribe.",
  },
  {
    ruta: "hooks",
    censada: true,
    motivo:
      "Donde vive el estado del canal en este dispositivo (`usePushSuscripcion`), que es la otra " +
      "superficie que se da de baja y el UNICO sitio del arbol que pide el permiso (R16).",
  },
  {
    ruta: "lib",
    censada: true,
    motivo:
      "El servidor, los repositorios, las Server Actions y los modulos del navegador sin React " +
      "(`lib/pwa/**`). Aqui viven la baja, el alta y el camino del envio que R6 protege.",
  },
  {
    ruta: "providers",
    censada: true,
    motivo:
      "⚠️ LA RAIZ QUE FALTABA, y no es un rincon: `ToastProvider` es quien ENVUELVE a " +
      "`<PushReactivacion />` en el layout de esta misma ficha. La revision escribio aqui una baja " +
      "sin motivo y un segundo `requestPermission()` y las 145 guardias salieron VERDES.",
  },
  {
    ruta: "scripts",
    censada: true,
    motivo:
      "El build la type-checkea (`next build` compila `scripts/**`), asi que es codigo que viaja " +
      "con el repositorio. Un script de Node no tiene `navigator` y no podria darse de baja de " +
      "verdad, pero censarla cuesta cero y una raiz sin censar es una raiz por la que colarse.",
  },
  {
    ruta: PSEUDO_RAIZ_ARCHIVOS,
    censada: true,
    motivo:
      "Los `.ts` sueltos del directorio raiz. No son configuracion inerte: `middleware.ts` se " +
      "ejecuta en CADA peticion del portal. Van censados como una raiz mas para que no exista un " +
      "hueco entre «carpetas» y «archivos».",
  },
  {
    ruta: "tests",
    censada: false,
    motivo:
      "⚠️ LA UNICA FUERA, y con una razon que ninguna otra tiene: es el sitio que SI necesita " +
      "nombrar lo que las guardias persiguen. `baja-push.test.ts` importa `lib/pwa/baja-push` para " +
      "probarlo, el doble `navegador-push.ts` define `requestPermission`, y las propias guardias " +
      "llevan los patrones escritos. Censarla las convertiria a ellas mismas en infractoras. " +
      "LIMITE DECLARADO: una «superficie» escrita dentro de `tests/` no se despliega, no la ve " +
      "ninguna persona y no puede dar de baja el dispositivo de nadie.",
  },
];

/** Las carpetas que nunca son codigo de este repositorio, aunque contengan `.ts`. */
const NUNCA_ES_CODIGO = new Set(["node_modules"]);

/** ¿Hay algun `.ts`/`.tsx` dentro de `dir`? Corta en cuanto encuentra el primero. */
function tieneCodigo(dir: string): boolean {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entrada of entradas) {
    if (entrada.name.startsWith(".") || NUNCA_ES_CODIGO.has(entrada.name)) continue;
    if (entrada.isDirectory()) {
      if (tieneCodigo(path.join(dir, entrada.name))) return true;
    } else if (/\.(ts|tsx)$/.test(entrada.name)) {
      return true;
    }
  }
  return false;
}

/**
 * LAS RAICES DE CODIGO QUE EXISTEN DE VERDAD, leidas del disco.
 *
 * ⚠️ AQUI NO HAY NINGUNA LISTA DE CARPETAS. Una raiz es «de codigo» si contiene al menos un
 * archivo `.ts`/`.tsx`; se ignoran `node_modules` y todo lo que empieza por punto (`.next`, `.git`,
 * `.claude`, `.vitest`). Esa es toda la regla, y por eso una carpeta nueva aparece sola.
 */
export function raicesDelArbol(): string[] {
  const raices: string[] = [];
  let hayArchivosSueltos = false;
  for (const entrada of fs.readdirSync(RAIZ_DEL_REPO, { withFileTypes: true })) {
    if (entrada.name.startsWith(".") || NUNCA_ES_CODIGO.has(entrada.name)) continue;
    if (entrada.isDirectory()) {
      if (tieneCodigo(path.join(RAIZ_DEL_REPO, entrada.name))) raices.push(entrada.name);
    } else if (/\.(ts|tsx)$/.test(entrada.name)) {
      hayArchivosSueltos = true;
    }
  }
  if (hayArchivosSueltos) raices.push(PSEUDO_RAIZ_ARCHIVOS);
  return raices.sort();
}

/**
 * Lo que no cuadra entre el disco y el inventario. Lista vacia = cada raiz que existe esta
 * clasificada, y cada entrada del inventario existe.
 */
export function fallosDelInventario(
  raices: readonly string[] = raicesDelArbol(),
  inventario: readonly RaizDeCodigo[] = INVENTARIO_DE_RAICES,
): string[] {
  const fallos: string[] = [];
  const declaradas = new Map(inventario.map((r) => [r.ruta, r] as const));
  for (const raiz of raices) {
    const entrada = declaradas.get(raiz);
    if (!entrada) {
      fallos.push(
        `la raiz de codigo \`${raiz}/\` existe en el arbol y NO esta en INVENTARIO_DE_RAICES: ` +
          "decide si el censo de las guardias de push tiene que mirarla y escribe el porque. " +
          "Una raiz sin clasificar es una raiz por la que se cuela una superficie nueva.",
      );
      continue;
    }
    if (entrada.motivo.trim().length < 60) {
      fallos.push(`la raiz \`${raiz}\` esta clasificada sin motivo escrito`);
    }
  }
  for (const entrada of inventario) {
    if (!raices.includes(entrada.ruta)) {
      fallos.push(
        `\`${entrada.ruta}\` esta en INVENTARIO_DE_RAICES pero ya no tiene codigo en el arbol: ` +
          "un inventario que se desvia de la realidad ya no vigila nada.",
      );
    }
  }
  return fallos;
}

/** Las raices que SI se censan, derivadas del inventario. */
export function raicesCensadas(): string[] {
  return INVENTARIO_DE_RAICES.filter((r) => r.censada).map((r) => r.ruta);
}

function archivosDe(dir: string, acc: string[]): string[] {
  for (const entrada of fs.readdirSync(path.join(RAIZ_DEL_REPO, dir), { withFileTypes: true })) {
    if (entrada.name.startsWith(".") || NUNCA_ES_CODIGO.has(entrada.name)) continue;
    const rel = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) archivosDe(rel, acc);
    else if (/\.(ts|tsx)$/.test(entrada.name)) acc.push(rel);
  }
  return acc;
}

/**
 * TODOS los archivos de codigo de las raices censadas, en rutas relativas con `/`.
 *
 * Incluye los `.ts` sueltos de la raiz del repositorio cuando `(raiz)` esta censada: ese hueco
 * entre «carpetas» y «archivos» era real, y `middleware.ts` corre en cada peticion.
 */
export function archivosDeCodigoCensados(): string[] {
  const archivos: string[] = [];
  for (const raiz of raicesCensadas()) {
    if (raiz === PSEUDO_RAIZ_ARCHIVOS) {
      for (const entrada of fs.readdirSync(RAIZ_DEL_REPO, { withFileTypes: true })) {
        if (!entrada.isDirectory() && /\.(ts|tsx)$/.test(entrada.name)) archivos.push(entrada.name);
      }
    } else {
      archivosDe(raiz, archivos);
    }
  }
  return archivos.sort();
}
