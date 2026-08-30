import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 333 (F3, R27/R28) — GUARDIA: **QUIEN DECIDE UN COBRO DE GASTO FIJO ES EL MAESTRO, Y ESO
 * SE EXPRESA CON UN PREDICADO PROPIO.**
 *
 * ## Que protege, y por que hace falta una guardia estatica
 *
 * Desde la ficha 94, `maestro` y `admin` son EQUIVALENTES en todo el arbol: una veintena larga de
 * servicios y paginas autoriza con `esAccesoTotal`, que devuelve `true` para los dos. Esta ficha
 * abre la PRIMERA excepcion deliberada a esa paridad: **aprobar o rechazar un cobro de gasto fijo
 * es solo del `maestro`** (R24), porque esa operacion escribe un egreso en la caja central.
 *
 * Una excepcion asi se pierde sola. El movimiento natural de quien pase por aqui dentro de seis
 * meses —viendo que TODO lo demas de wallet usa `esAccesoTotal`— es «unificar» el guard, y el
 * resultado seria que el `admin` vuelve a poder autorizar dinero sin que ningun test funcional se
 * ponga rojo: los casos de `gasto-fijo-cobro-service.test.ts` que prueban R24 seguirian existiendo
 * pero habria que borrarlos a la vez, y en un mismo commit eso pasa. Esta guardia hace que la
 * unificacion tenga que ser EXPLICITA.
 *
 * Y protege la direccion contraria con la misma fuerza (R28): que nadie ESTRECHE de rebote el CRUD
 * de plantillas, el libro o el desglose. La excepcion es de UNA capacidad, no de un modulo.
 *
 * ## Como afirma
 *
 * Sobre el **USO EFECTIVO**: fuente sin comentarios NI sentencias de import. Es la leccion que
 * este repo tiene medida en `notificacion-notificadores-reales.test.ts` — un `toContain` a secas
 * se satisface con el `import` de arriba, asi que una guardia ingenua da por vivo un simbolo que
 * ya nadie usa. Aqui ademas los comentarios NOMBRAN a proposito lo que el codigo tiene prohibido
 * («el camino de decision NO autoriza con esAccesoTotal»), asi que leer el texto crudo denunciaria
 * la EXPLICACION y obligaria a borrarla.
 *
 * La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const AUTH = "lib/auth/acceso-total.ts";
const SERVICIO_COBRO = "lib/services/GastoFijoCobroService.ts";
const ACCION_COBRO = "lib/actions/gasto-fijo-cobro.ts";

/** El predicado ESTRECHO de esta ficha y el ANCHO al que excepciona. */
const PREDICADO_ESTRECHO = "puedeDecidirCobroGastoFijo";
const PREDICADO_ANCHO = "esAccesoTotal";

/**
 * Los servicios que autorizan con `esAccesoTotal` y que esta ficha NO puede tocar (R28). Censo
 * explicito y no derivado: si uno se renombra o se queda sin guard, el primer bloque cae en vez
 * de salirse del alcance en silencio.
 */
const SERVICIOS_QUE_SIGUEN_CON_ACCESO_TOTAL: readonly string[] = [
  "lib/services/WalletService.ts",
  "lib/services/WalletEgresoService.ts",
  "lib/services/GastoFijoPlantillaService.ts",
];

/** Corta en seco: una guardia que no puede leer lo que vigila se detiene en ROJO, no en verde. */
function reventar(que: string): never {
  throw new Error(
    `guardia gasto-fijo-decision-rol: ${que}. NO se pudo leer lo que se vigila; se detiene en ` +
      `ROJO en vez de dar por buena una lectura vacia. Si el codigo se movio, actualiza el censo ` +
      `— no borres la comprobacion.`,
  );
}

function leer(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!existsSync(ruta)) reventar(`falta el archivo censado \`${rel}\``);
  const fuente = readFileSync(ruta, "utf8");
  if (fuente.trim().length === 0) reventar(`\`${rel}\` se leyo en blanco`);
  return fuente;
}

/**
 * Quita las sentencias `import` (incluidas las multilinea) de un fuente YA sin comentarios.
 *
 * Un bloque de import termina en la linea que trae el `from "…"`. Es la misma forma que usa
 * `notificacion-notificadores-reales.test.ts`, escrita aqui sobre el quitador COMPARTIDO del repo
 * para no estrenar una quinta semantica de «codigo sin comentarios».
 */
export function sinImports(fuenteSinComentarios: string): string {
  const salida: string[] = [];
  let dentroDeImport = false;
  for (const linea of fuenteSinComentarios.split("\n")) {
    const t = linea.trim();
    if (dentroDeImport) {
      if (/from\s+["']/.test(t)) dentroDeImport = false;
      continue;
    }
    if (t.startsWith("import ")) {
      if (!/from\s+["']/.test(t)) dentroDeImport = true;
      continue;
    }
    salida.push(linea);
  }
  return salida.join("\n");
}

/** El USO EFECTIVO de un archivo: sin comentarios y sin imports. */
function uso(rel: string): string {
  return sinImports(quitarComentarios(leer(rel)));
}

/**
 * El CUERPO de un metodo `async <nombre>(` de una clase, por conteo de llaves.
 *
 * Hace falta porque `GastoFijoCobroService` autoriza con los DOS predicados —el ancho para LEER
 * (R25/R55) y el estrecho para DECIDIR (R24)—, asi que un barrido sobre el archivo entero no
 * podria distinguirlos y esta guardia no diria nada. Lo que R27 exige es que el camino de decision
 * no use el ancho, y eso es una afirmacion sobre DOS METODOS concretos.
 */
export function cuerpoDelMetodo(fuente: string, nombre: string): string {
  const firma = new RegExp(`\\basync\\s+${nombre}\\s*\\(`);
  const m = firma.exec(fuente);
  if (m === null) return "";
  const abre = fuente.indexOf("{", m.index + m[0].length);
  if (abre === -1) return "";
  let profundidad = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === "{") profundidad++;
    else if (fuente[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuente.slice(abre, i + 1);
    }
  }
  return "";
}

/** Los `.ts`/`.tsx` de un arbol de produccion, en rutas relativas a la raiz. */
function archivosDe(dirRelativo: string): string[] {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(completo);
        continue;
      }
      if (!/\.tsx?$/.test(entrada.name)) continue;
      encontrados.push(path.relative(RAIZ, completo).split(path.sep).join("/"));
    }
  };
  recorrer(path.join(RAIZ, dirRelativo));
  return encontrados;
}

/* -------------------------------------------------------------------------- */
/* 0 — Autocomprobacion: la guardia mira lo que dice mirar                     */
/* -------------------------------------------------------------------------- */

describe("(0) autocomprobacion — sin esto, la guardia podria estar verde POR VACIA", () => {
  it("los tres archivos del nucleo existen y no se leen en blanco", () => {
    for (const rel of [AUTH, SERVICIO_COBRO, ACCION_COBRO]) {
      expect(leer(rel).length, `${rel} vacio`).toBeGreaterThan(200);
    }
  });

  it("`cuerpoDelMetodo` recorta de verdad: encuentra los metodos y NO se lleva a sus vecinos", () => {
    const fuente = uso(SERVICIO_COBRO);
    const aprobar = cuerpoDelMetodo(fuente, "aprobar");
    const listar = cuerpoDelMetodo(fuente, "listarPendientes");

    // Encontrados y no vacios.
    expect(aprobar.length).toBeGreaterThan(200);
    expect(listar.length).toBeGreaterThan(50);
    // Y REALMENTE separados: cada uno lleva lo suyo y NO lo del otro.
    expect(aprobar).toContain("crearMovimientos");
    expect(listar).not.toContain("crearMovimientos");
    expect(listar).toContain("contarPendientes");
    expect(aprobar).not.toContain("contarPendientes");
  });

  it("`cuerpoDelMetodo` devuelve vacio para un metodo que no existe (y no algo al azar)", () => {
    expect(cuerpoDelMetodo(uso(SERVICIO_COBRO), "reabrirCobro")).toBe("");
  });

  it("`sinImports` quita la sentencia y NO el uso, ni en una linea ni en un bloque", () => {
    const codigo = [
      'import { esAccesoTotal } from "@/lib/auth/acceso-total";',
      "import {",
      "  puedeDecidirCobroGastoFijo,",
      '} from "@/lib/auth/acceso-total";',
      "const a = esAccesoTotal(rol);",
    ].join("\n");
    const resultado = sinImports(codigo);
    expect(resultado).toContain("const a = esAccesoTotal(rol);");
    expect(resultado).not.toContain("from");
    // CONTRAPRUEBA: sobre el texto CRUDO, un `toContain` del predicado estrecho pasaria solo por
    // el import. Es exactamente el falso verde que esta guardia existe para no repetir.
    expect(codigo).toContain(PREDICADO_ESTRECHO);
    expect(sinImports(codigo)).not.toContain(PREDICADO_ESTRECHO);
  });
});

/* -------------------------------------------------------------------------- */
/* R27 — el camino de DECISION no autoriza con `esAccesoTotal`                 */
/* -------------------------------------------------------------------------- */

describe("333/R27 — el camino de decision no autoriza con `esAccesoTotal`", () => {
  it("⭑ `aprobar` y `rechazar` usan el predicado ESTRECHO y NO el ancho", () => {
    const fuente = uso(SERVICIO_COBRO);
    for (const metodo of ["aprobar", "rechazar"] as const) {
      const cuerpo = cuerpoDelMetodo(fuente, metodo);
      expect(cuerpo.length, `no se encontro el cuerpo de \`${metodo}\``).toBeGreaterThan(100);
      expect(cuerpo, `\`${metodo}\` autoriza con ${PREDICADO_ANCHO}`).not.toContain(
        PREDICADO_ANCHO,
      );
      expect(cuerpo, `\`${metodo}\` NO autoriza con ${PREDICADO_ESTRECHO}`).toContain(
        PREDICADO_ESTRECHO,
      );
    }
  });

  it("⭑ el predicado estrecho tiene NOMBRE PROPIO y no es un `rol !== \"maestro\"` suelto", () => {
    // Un literal suelto no seria greppable como CAPACIDAD y no dejaria rastro en el diff el dia
    // que el humano decida ensanchar la lista. La ficha pide un predicado con nombre.
    const cuerpoAprobar = cuerpoDelMetodo(uso(SERVICIO_COBRO), "aprobar");
    expect(cuerpoAprobar).not.toMatch(/rol\s*[!=]==?\s*["']maestro["']/);
    expect(cuerpoAprobar).not.toMatch(/RolValue\.maestro/);
  });

  it("⭑ el predicado vive JUNTO a la regla que excepciona, y `esAccesoTotal` no se toco", () => {
    const fuente = uso(AUTH);
    expect(fuente).toContain(`function ${PREDICADO_ESTRECHO}`);
    // La lista de roles que DECIDEN tiene exactamente un valor: el maestro.
    expect(fuente).toMatch(
      /ROLES_DECIDEN_COBRO_GASTO_FIJO[^=]*=\s*\[\s*RolValue\.maestro\s*,?\s*\]/,
    );
    // Y el predicado ANCHO sigue devolviendo maestro + admin: la paridad de la 94 no se rompio.
    expect(fuente).toMatch(/ROLES_ACCESO_TOTAL[^=]*=\s*\[\s*RolValue\.maestro,\s*RolValue\.admin\s*,?\s*\]/);
  });

  it("⭑ la Server Action NO autoriza: el borde resuelve sesion y forma, el rol lo decide el servicio", () => {
    // Si el borde decidiera el rol, habria DOS declaraciones del criterio y podrian divergir; y
    // esconder el boton en la UI seria autorizacion de mentira mientras la action siga abierta.
    const fuente = uso(ACCION_COBRO);
    expect(fuente).not.toContain(PREDICADO_ANCHO);
    expect(fuente).not.toContain(PREDICADO_ESTRECHO);
    expect(fuente).toContain("UnauthenticatedError"); // lo que SI le toca al borde
  });

  it("⭑ el predicado estrecho no aparece en NINGUN otro modulo de produccion", () => {
    // Es lo que impide que la excepcion se copie a otra operacion sin que nadie lo decida.
    const permitidos = new Set([AUTH, SERVICIO_COBRO]);
    const infractores = [...archivosDe("lib"), ...archivosDe("app")]
      .filter((rel) => !permitidos.has(rel))
      .filter((rel) => sinImports(quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"))).includes(PREDICADO_ESTRECHO));

    expect(
      infractores,
      "la excepcion a la paridad de la 94 se copio a otro modulo sin decidirlo",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — lo demas sigue autorizando igual                                      */
/* -------------------------------------------------------------------------- */

describe("333/R28 — las demas operaciones de wallet y plantillas siguen con `esAccesoTotal`", () => {
  it("⭑ los servicios censados siguen usandolo (esta ficha NO los estrecha)", () => {
    for (const rel of SERVICIOS_QUE_SIGUEN_CON_ACCESO_TOTAL) {
      const fuente = uso(rel);
      expect(fuente, `${rel} dejo de autorizar con ${PREDICADO_ANCHO}`).toContain(
        PREDICADO_ANCHO,
      );
      expect(fuente, `${rel} adopto el predicado estrecho`).not.toContain(PREDICADO_ESTRECHO);
    }
  });

  it("⭑ el CRUD de plantillas conserva el guard ancho en TODOS sus metodos de escritura", () => {
    // Es el archivo con mas riesgo de contagio: convive con la cascada de la 333 desde F1b.
    const fuente = uso("lib/services/GastoFijoPlantillaService.ts");
    for (const metodo of [
      "crearPlantilla",
      "actualizarPlantilla",
      "setActivaPlantilla",
      "eliminarPlantilla",
    ] as const) {
      const cuerpo = cuerpoDelMetodo(fuente, metodo);
      expect(cuerpo.length, `no se encontro \`${metodo}\``).toBeGreaterThan(50);
      expect(cuerpo, `\`${metodo}\` cambio de guard`).toContain(PREDICADO_ANCHO);
    }
  });

  it("⭑ dentro del propio servicio de cobros, LEER sigue siendo de acceso total (R25/R55)", () => {
    const fuente = uso(SERVICIO_COBRO);
    for (const metodo of ["listarPendientes", "contarPendientesDePlantilla"] as const) {
      const cuerpo = cuerpoDelMetodo(fuente, metodo);
      expect(cuerpo.length, `no se encontro \`${metodo}\``).toBeGreaterThan(50);
      expect(cuerpo, `\`${metodo}\` se estrecho: el admin dejaria de ver la cola`).toContain(
        PREDICADO_ANCHO,
      );
      expect(cuerpo).not.toContain(PREDICADO_ESTRECHO);
    }
  });

  it("⭑ el arbol sigue teniendo MUCHOS consumidores de `esAccesoTotal`: la paridad no se movio", () => {
    // Cota inferior explicita. Si alguien «unificara» los guards en la direccion contraria —
    // estrechando media wallet— este numero se desplomaria y aqui se veria.
    const consumidores = [...archivosDe("lib"), ...archivosDe("app")].filter((rel) =>
      sinImports(quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"))).includes(
        PREDICADO_ANCHO,
      ),
    );
    expect(consumidores.length).toBeGreaterThan(15);
    // Y el servicio de cobros esta ENTRE ellos: usa los dos predicados, cada uno en su sitio.
    expect(consumidores).toContain(SERVICIO_COBRO);
  });
});

/* -------------------------------------------------------------------------- */
/* Contraprueba: la guardia caza la mutacion que existe para cazar             */
/* -------------------------------------------------------------------------- */

describe("contraprueba — el detector marca lo que dice marcar, y no marca lo que no", () => {
  it("un `aprobar` que autorizara con `esAccesoTotal` se detecta", () => {
    const mutado = [
      "class X {",
      "  async aprobar(input, actor, ahora) {",
      '    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };',
      "    return this.runTx(async (tx) => ({ status: 'ok' }));",
      "  }",
      "}",
    ].join("\n");
    const cuerpo = cuerpoDelMetodo(sinImports(quitarComentarios(mutado)), "aprobar");
    expect(cuerpo).toContain(PREDICADO_ANCHO);
    expect(cuerpo).not.toContain(PREDICADO_ESTRECHO);
  });

  it("y el codigo REAL no lo contiene: la contraprueba de arriba no esta midiendo su propio ruido", () => {
    expect(cuerpoDelMetodo(uso(SERVICIO_COBRO), "aprobar")).not.toContain(PREDICADO_ANCHO);
  });

  it("un comentario que NOMBRE el predicado prohibido no cuenta como uso", () => {
    const soloProsa = [
      "class X {",
      "  async aprobar(input, actor, ahora) {",
      "    // ojo: aqui NO se usa esAccesoTotal, se usa el predicado estrecho",
      '    if (!puedeDecidirCobroGastoFijo(actor.rol)) return { status: "forbidden" };',
      "  }",
      "}",
    ].join("\n");
    const cuerpo = cuerpoDelMetodo(sinImports(quitarComentarios(soloProsa)), "aprobar");
    expect(cuerpo).not.toContain(PREDICADO_ANCHO);
    expect(cuerpo).toContain(PREDICADO_ESTRECHO);
  });
});
