// GUARDIA — FICHA 455 (T1.10 · G2, design §6.2; R9, R37, R38, R41, R44): LOS NOMBRES RETIRADOS NO
// VUELVEN COMO TEXTO VISIBLE.
//
// La 455 fija UN nombre por estado (tabla §0.1) y retira los demas (§0.3): los plurales, los hitos
// del rastreo, los rotulos fijos de las tarjetas, «Sin gestionar», «Por recoger»… Y prohibe la
// abreviatura «B.» de «bodega» (R9). Esta guardia los busca como TEXTO VISIBLE:
//   - en codigo (`app/`, `lib/`, `components/`, `hooks/`): un literal de cadena o un texto JSX IGUAL
//     (tras `trim`) a un nombre retirado, o que lo CITA entre comillas angulares o dobles
//     (`«Entregada»`). Igualdad y no «contiene»: «Devuelta a tienda» es vigente y contiene «Devuelta»;
//   - en `docs/ayuda/**` y `docs/api/**` (menos el CHANGELOG, que es historia): el nombre entre `«»`,
//     `**`, comillas o backticks;
//   - en el contexto que el asistente (436) arma para CADA rol (`contextoPara`), que sale de esos
//     mismos documentos (R38);
//   - «B.» seguido de espacio, en los tres sitios.
// Los comentarios no se miran (AST de TypeScript).
//
// ⏳ FASE 1 → FASE 2 (2026-09-24). Esta guardia nace en la Fase 1 (backend) y la pantalla todavia
// dice los nombres viejos: cambiarla es la Fase 2 (frontend_dev, T2.1-T2.10). Para que la guardia
// sirva desde HOY sin fingir verde, lo pendiente vive en `PENDIENTES_FASE_2`, archivo por archivo y
// con el NUMERO EXACTO de apariciones: una mas es una infraccion nueva; una menos deja la entrada
// caducada y la guardia pide retirarla. La Fase 2 termina cuando esa lista esta VACIA (T2.9: sin
// anadir ninguna excepcion nueva).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import type { DocumentoAyuda } from "@/lib/ayuda/documento";
import { ESTADO_RETIRADO, NOMBRE_ESTADO, SUFIJO_ESTADO_RETIRADO } from "@/lib/types/order-status";
import { NOMBRES_RETIRADOS } from "../../fixtures/nombres-retirados-455";

const RAIZ = path.resolve(__dirname, "../../..");


const RETIRADOS = new Set<string>(NOMBRES_RETIRADOS);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALTERNATIVA = NOMBRES_RETIRADOS.map(escapar).join("|");
const CITADO_EN_CODIGO = new RegExp(`[«"“](${ALTERNATIVA})[»"”]`);
const CITADO_EN_DOC = new RegExp(`(?:«|\\*\\*|"|“|\`)(${ALTERNATIVA})(?:»|\\*\\*|"|”|\`)`);

// M3 (revision 455, 2026-09-24): R41 dice «CONTIENE», no «es igual a». Tres brazos mas, sobre el
// texto del que antes se borran los nombres VIGENTES (`NOMBRE_ESTADO`), que contienen alguno retirado
// («Devuelta a tienda», «Por devolver a tienda», «Por recolectar en tienda»):
//  - CONTENIDO: un nombre retirado de §0.3 como PALABRA COMPLETA dentro de un texto mas largo, con la
//    mayuscula con que lo escribe un rotulo («Reprogramada para», «Rechazadas por plazo vencido»,
//    «Recolectadas hoy»). Suma los plurales que §0.3 no enumera («Asignadas», «Recolectadas»).
//  - PLURAL: el participio femenino PLURAL de un estado viejo en minuscula («terminaron entregadas»,
//    «4 asignadas», «entregadas / asignadas»): contar ordenes en plural femenino es nombrar el grupo
//    de un estado viejo. El SINGULAR en minuscula es prosa («la orden fue entregada») y no se mira:
//    es el limite declarado de esta guardia.
//  - FRASE: las frases retiradas en cualquier caja («sin gestionar», «por recoger», «sin recoger»,
//    «por devolver» a secas).
// Solo en textos que parecen texto de persona: un identificador (`entregadas`, `sin_gestionar`) o
// una consulta SQL no son texto visible.
const LETRA = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
const palabra = (s: string) => `(?<![${LETRA}_])(?:${s})(?![${LETRA}_])`;
const VIGENTES = Object.values(NOMBRE_ESTADO)
  .slice()
  .sort((a, b) => b.length - a.length);
// Tambien se borra el formato de R11, «<nombre historico> (estado retirado)»: es la forma OBLIGADA de
// nombrar un retirado en una fila historica (la API de metricas lo documenta con un ejemplo).
const PERMITIDOS = [
  ...VIGENTES,
  ...Object.values(ESTADO_RETIRADO).map((r) => `${r.nombreHistorico}${SUFIJO_ESTADO_RETIRADO}`),
];
const BORRAR_VIGENTES = new RegExp(PERMITIDOS.map(escapar).join("|"), "gi");
const CONTENIDO = new RegExp(palabra(`${ALTERNATIVA}|Asignadas|Recolectadas`));
// El plural en minuscula junto a un sustantivo («ordenes asignadas para hoy», «guias asignadas») es
// un adjetivo de prosa, no el nombre de un grupo; pegado a `-`/`=` es un identificador
// («[procesar-devueltas-sla]», «entregadas=3»).
const PLURAL = new RegExp(
  `(?<!(?:[ÓóOo]rdenes|[Gg]u[íi]as|[Pp]aquetes|orden\\(es\\)) )(?<![-=])` +
    palabra("entregadas|devueltas|reprogramadas|rechazadas|asignadas|recolectadas") +
    `(?![-=])`,
);
const FRASE = new RegExp(palabra("sin gestionar|sin recoger|por recoger|por devolver(?! a )"), "i");
// Una sola «palabra» sin mayusculas ni espacios es una clave o un codigo, no un rotulo.
const PARECE_IDENTIFICADOR = /^[a-z0-9_.:/@#-]*$/;
const PARECE_SQL = /\b(SELECT|UPDATE|INSERT|DELETE|WHERE|FROM|JOIN|AS|COUNT|GROUP BY|ORDER BY)\b/;

/** El nombre retirado CONTENIDO en un texto visible, o `null`. */
export function contenidoRetirado(texto: string): string | null {
  if (PARECE_IDENTIFICADOR.test(texto) || PARECE_SQL.test(texto)) return null;
  const sinVigentes = texto.replace(BORRAR_VIGENTES, " ");
  const m = CONTENIDO.exec(sinVigentes) ?? PLURAL.exec(sinVigentes) ?? FRASE.exec(sinVigentes);
  return m ? m[0] : null;
}
const ABREVIATURA_BODEGA = /(?<![A-Za-zÁÉÍÓÚáéíóúÑñ])B\.\s/;

/**
 * Excepciones CERRADAS con motivo y numero exacto (no son pendientes: se quedan).
 */
// m1 (revision 455, 2026-09-24): cada excepcion declara el TEXTO que permite, no un numero. Antes
// era «archivo + maximo N» y `NOTA_AYUDA_SOLICITADA = "Sin gestionar"` seguia verde (1 hallazgo = 1
// permitido); ahora el hallazgo tiene que ser EXACTAMENTE uno de `textos`, y todos tienen que estar.
const EXCEPCIONES: Record<string, { textos: readonly string[]; motivo: string }> = {
  "lib/types/order-status.ts": {
    // FICHA 456 (2026-09-24, reconciliacion R-456-3 de `progress/impl_456.md`): «sin gestionar» es la
    // frase del texto APROBADO por el humano para explicar «Novedad interna» («El mensajero terminó el
    // día sin gestionar el paquete.», `DESCRIPCION_ESTADO.novedad_interna`). Es prosa (verbo + objeto),
    // no el nombre de un estado, y la tabla aprobada no se edita.
    textos: ["Devolución por confirmar", "Ayuda solicitada a la tienda", "sin gestionar"],
    motivo:
      "`ESTADO_RETIRADO.nombreHistorico`: el nombre que tenian los estados retirados, que R11 obliga a " +
      "mostrar como «<historico> (estado retirado)» en las filas historicas; y la frase «sin gestionar» " +
      "del texto aprobado de la 456 para «Novedad interna» (`DESCRIPCION_ESTADO`)",
  },
  // FASE 2 (2026-09-24): no es un pendiente que se arregla, es una excepcion que SE QUEDA, y se
  // declara aqui y no escondida. requirements §0.3 retira «Ayuda solicitada a la tienda» COMO ESTADO;
  // design §2.1 (fila de `pos-estado.ts`) y `specs/456-tooltip-estados/textos-aprobados.md` fijan ese
  // mismo texto para la NOTA de la ayuda (la 454 la hizo evento: la orden sigue `en_reparto`), que
  // se pinta junto al chip de estado y nunca en su lugar. El detector no distingue estado de nota.
  "components/shared/nota-pendiente-confirmacion.ts": {
    textos: ["Ayuda solicitada a la tienda"],
    motivo:
      "`NOTA_AYUDA_SOLICITADA`: la nota de la ayuda de la 454 (evento, no estado), texto fijado por " +
      "design §2.1 y la 456; §0.3 lo retira solo como nombre de estado",
  },
  // ⚠️ FICHA 462 (backend, 2026-09-25) — EXCEPCION DECLARADA, ELEVADA AL LEADER, NO RESUELTA AQUI.
  // `TEXTO_REPROGRAMADAS_ESPERAN_CIERRE` es el literal NORMATIVO de requirements 462/R17 (el detalle
  // persistido del aviso) y cita la MARCA de la pantalla de cierres («Retiene reprogramadas de hoy»,
  // 462/R27), no el nombre de un estado: la orden retenida esta en `reprogramado` (Forma A) o en
  // `en_reparto` (Forma B, 454). El detector no distingue una marca de un estado, y ademas los textos
  // de la Fase 3 de esa ficha (R27 «Retiene N reprogramadas de hoy», R32 «Hay N reprogramadas de
  // hoy…») chocan con esta misma guardia. Dos specs aprobados por el humano se contradicen; la
  // decision —reformular los literales de la 462 con `NOMBRE_ESTADO.reprogramado` («ordenes con
  // Reprogramado para hoy») o mantenerlos— es del leader/humano. Si se reformulan, esta excepcion se
  // RETIRA (la guardia lo exige sola: «cada excepcion sigue haciendo falta»).
  "lib/notificaciones/emitir.ts": {
    textos: ["reprogramadas"],
    motivo:
      "`TEXTO_REPROGRAMADAS_ESPERAN_CIERRE` (462/R17): cita la marca «Retiene reprogramadas de hoy» de " +
      "/cierres-admin (462/R27), no un estado; conflicto 462 vs 455 §0.3 elevado al leader el 2026-09-25",
  },
};

/**
 * ⏳ Lo que la FASE 2 tiene que cambiar (T2.1-T2.10). Medido el 2026-09-24 sobre este arbol.
 * La Fase 2 retira cada entrada al corregir su archivo; no puede anadir ninguna.
 */
const PENDIENTES_FASE_2: Record<string, number> = {};

function listar(dir: string, re: RegExp, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const completo = path.join(dir, e);
    if (statSync(completo).isDirectory()) listar(completo, re, acc);
    else if (re.test(e) && !/\.d\.ts$/.test(e)) acc.push(completo);
  }
  return acc;
}

/** Los nombres retirados usados como texto visible en un fuente TS/TSX. */
export function hallazgosEnCodigo(codigo: string, nombre = "fuente.tsx"): string[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hallazgos: string[] = [];
  const anotar = (n: ts.Node, que: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    hallazgos.push(`${nombre}:${line + 1} ${que}`);
  };
  const visitar = (n: ts.Node): void => {
    let texto: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) texto = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texto = n.text;
    else if (ts.isJsxText(n)) texto = n.text;
    if (texto !== null) {
      const limpio = texto.trim();
      if (RETIRADOS.has(limpio)) anotar(n, limpio);
      else {
        const m = CITADO_EN_CODIGO.exec(texto);
        if (m) anotar(n, m[1]);
        else if (ABREVIATURA_BODEGA.test(texto)) anotar(n, "B.");
        else {
          const c = contenidoRetirado(texto);
          if (c) anotar(n, c);
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hallazgos;
}

/** Los nombres retirados citados en un documento markdown (y la abreviatura «B.»). */
export function hallazgosEnDocumento(texto: string, nombre = "doc.md"): string[] {
  return texto.split("\n").flatMap((l, i) => {
    const m = CITADO_EN_DOC.exec(l);
    if (m) return [`${nombre}:${i + 1} ${m[1]}`];
    if (ABREVIATURA_BODEGA.test(l)) return [`${nombre}:${i + 1} B.`];
    const c = contenidoRetirado(l.replace(/`[^`]*`/g, " "));
    return c ? [`${nombre}:${i + 1} ${c}`] : [];
  });
}

const rel = (completo: string) => path.relative(RAIZ, completo).split(path.sep).join("/");

function censoCodigo(): Map<string, string[]> {
  const porArchivo = new Map<string, string[]>();
  for (const d of ["app", "lib", "components", "hooks"]) {
    for (const f of listar(path.join(RAIZ, d), /\.tsx?$/)) {
      const h = hallazgosEnCodigo(readFileSync(f, "utf8"), rel(f));
      if (h.length > 0) porArchivo.set(rel(f), h);
    }
  }
  return porArchivo;
}

function censoDocumentos(): Map<string, string[]> {
  const porArchivo = new Map<string, string[]>();
  for (const d of ["docs/ayuda", "docs/api"]) {
    for (const f of listar(path.join(RAIZ, d), /\.md$/)) {
      if (rel(f) === "docs/api/CHANGELOG.md") continue; // historia: cada entrada dice lo que dijo
      const h = hallazgosEnDocumento(readFileSync(f, "utf8"), rel(f));
      if (h.length > 0) porArchivo.set(rel(f), h);
    }
  }
  return porArchivo;
}

/** El nombre retirado de un hallazgo `archivo:linea NOMBRE`. */
const nombreDe = (hallazgo: string) => hallazgo.slice(hallazgo.indexOf(" ") + 1);

/**
 * Los hallazgos que NO cubre ni una excepcion (por TEXTO: cada hallazgo del archivo tiene que ser
 * uno de sus `textos`) ni un pendiente de la Fase 2 (por numero).
 */
export function infractoresDe(
  todos: ReadonlyMap<string, readonly string[]>,
  excepciones: typeof EXCEPCIONES = EXCEPCIONES,
  pendientes: Record<string, number> = PENDIENTES_FASE_2,
): string[] {
  const infractores: string[] = [];
  for (const [archivo, hallazgos] of todos) {
    const excepcion = excepciones[archivo];
    if (excepcion) {
      infractores.push(...hallazgos.filter((h) => !excepcion.textos.includes(nombreDe(h))));
      continue;
    }
    const pendiente = pendientes[archivo];
    if (pendiente !== undefined && hallazgos.length <= pendiente) continue;
    infractores.push(...hallazgos);
  }
  return infractores;
}

describe("455/G2 — el detector de nombres retirados no esta roto", () => {
  it("no denuncia los nombres VIGENTES que contienen uno retirado, ni la prosa, ni los comentarios", () => {
    const sano = [
      `// aqui decia «Entregada»`,
      `const a = "Devuelta a tienda";`,
      `const b = "Devolviendo a bodega central";`,
      `const c = "la orden fue entregada";`,
      `const d = <p>Por recolectar en tienda</p>;`,
      `const e = "Bodega central";`,
      // M3: lo que el brazo de «contiene» NO puede marcar.
      `const f = "Quedó en Por devolver a tienda y luego en Por devolver a bodega central";`,
      `const g = "Ningún mensajero tiene órdenes asignadas para hoy.";`,
      "const h = `[procesar-devueltas-sla] ${n} orden(es) omitida(s)`;",
      "const i = `(cargadas=${c}, entregadas=${e})`;",
      `const j = "asignadas";`,
      "const k = sql`SELECT COUNT(*) AS asignadas FROM x`;",
      `const l = "Guía 123 recolectada. Va a la bodega central.";`,
    ].join("\n");
    expect(hallazgosEnCodigo(sano)).toEqual([]);
    expect(hallazgosEnDocumento("La orden quedó entregada. Ver «Devuelta a tienda».")).toEqual([]);
    // R11: el formato obligado de un retirado en una fila historica no es un nombre retirado suelto.
    expect(
      hallazgosEnDocumento(`"estadoResultanteNombre": "Devolución por confirmar (estado retirado)",`),
    ).toEqual([]);
  });

  it("MUTACION (R44): ve el literal igual, el texto JSX, la cita entre comillas y la abreviatura", () => {
    const infractor = [
      `const a = "Entregada";`,
      `const b = <span>Por recoger</span>;`,
      "const c = `Quedó «Sin gestionar» hoy`;",
      `const d = "B. satélite";`,
    ].join("\n");
    expect(hallazgosEnCodigo(infractor)).toEqual([
      "fuente.tsx:1 Entregada",
      "fuente.tsx:2 Por recoger",
      "fuente.tsx:3 Sin gestionar",
      "fuente.tsx:4 B.",
    ]);
    expect(hallazgosEnDocumento("El estado **Rechazada** cambia.\nEn la B. central.")).toEqual([
      "doc.md:1 Rechazada",
      "doc.md:2 B.",
    ]);
  });

  // M3 (revision 455, 2026-09-24): los textos EXACTOS que la revision (M1, M2) y el recorrido
  // (F1-F8) encontraron en pantalla con la guardia verde. Con el detector de antes, igualdad o cita
  // entre «» y "", NINGUNO de estos salia.
  it("MUTACION (M1): la cita entre comillas tipograficas “ ”", () => {
    expect(
      hallazgosEnCodigo(`const m = { conflict: "Alguna orden ya no está en estado “Por devolver”." };`),
    ).toEqual(["fuente.tsx:1 Por devolver"]);
    expect(hallazgosEnDocumento("Queda en “Reprogramada” hasta mañana.")).toEqual(["doc.md:1 Reprogramada"]);
  });

  it("MUTACION (M2 y F1-F8): el nombre retirado CONTENIDO como palabra completa", () => {
    const infractor = [
      `const a = { value: "Reprogramada para" };`,
      `const b = "Rechazadas por plazo vencido";`,
      `const c = { conteo: "Entregadas / asignadas" };`,
      `const d = <span>Recolectada a las{" "}</span>;`,
      `const e = "Recolectadas hoy";`,
      `const f = "Asignadas";`,
      "const g = `${n} asignadas`;",
      "const h = `${x} terminaron entregadas`;",
      "const i = `entregadas y rechazadas de ${t}`;",
      `const j = "Tenes ordenes sin gestionar; gestionalas antes de cerrar.";`,
      `const k = "No hay órdenes por recoger hoy.";`,
      `const l = "ÓRDENES SIN GESTIONAR";`,
    ].join("\n");
    expect(hallazgosEnCodigo(infractor)).toEqual([
      "fuente.tsx:1 Reprogramada",
      "fuente.tsx:2 Rechazadas",
      "fuente.tsx:3 Entregadas",
      "fuente.tsx:4 Recolectada",
      "fuente.tsx:5 Recolectadas",
      "fuente.tsx:6 Asignadas",
      "fuente.tsx:7 asignadas",
      "fuente.tsx:8 entregadas",
      "fuente.tsx:9 entregadas",
      "fuente.tsx:10 sin gestionar",
      "fuente.tsx:11 por recoger",
      "fuente.tsx:12 SIN GESTIONAR",
    ]);
    expect(
      hallazgosEnDocumento(
        [
          "## Recolectadas hoy",
          "**Rechazadas por plazo vencido.** Las que se pasaron del plazo.",
          "efectividad = entregadas / asignadas   (hoy)",
          "| **Para recoger hoy** | Asignadas, todavía en bodega |",
        ].join("\n"),
      ),
    ).toEqual(["doc.md:1 Recolectadas", "doc.md:2 Rechazadas", "doc.md:3 entregadas", "doc.md:4 Asignadas"]);
  });

  it("MUTACION (m1): la excepcion se acota por TEXTO — «Sin gestionar» en el archivo de la nota cae", () => {
    const nota = "components/shared/nota-pendiente-confirmacion.ts";
    // La excepcion vigente pasa…
    expect(infractoresDe(new Map([[nota, [`${nota}:30 Ayuda solicitada a la tienda`]]]))).toEqual([]);
    // …y la mutacion V9 de la revision (el MISMO archivo, UN hallazgo, otro texto) ya no.
    expect(infractoresDe(new Map([[nota, [`${nota}:30 Sin gestionar`]]]))).toEqual([
      `${nota}:30 Sin gestionar`,
    ]);
  });
});

describe("455/R41 · R9 · R37 (G2) — el arbol", () => {
  const codigo = censoCodigo();
  const documentos = censoDocumentos();
  const todos = new Map([...codigo, ...documentos]);

  it("no-vacuidad: el censo leyo codigo y documentos", () => {
    expect(listar(path.join(RAIZ, "app"), /\.tsx?$/).length).toBeGreaterThan(300);
    expect(listar(path.join(RAIZ, "docs", "ayuda"), /\.md$/).length).toBeGreaterThan(10);
  });

  it("ningun nombre retirado como texto visible fuera de las excepciones y de lo pendiente de la Fase 2", () => {
    expect(
      infractoresDe(todos),
      "un nombre de estado RETIRADO (requirements 455 §0.3) volvio como texto visible. Usa el nombre " +
        "de `NOMBRE_ESTADO` (`nombreDeEstado`) o, si es un grupo/accion, un texto propio (R6).",
    ).toEqual([]);
  });

  it("cada excepcion y cada pendiente sigue haciendo falta, con su texto o su numero exacto", () => {
    for (const [archivo, { textos }] of Object.entries(EXCEPCIONES)) {
      expect((todos.get(archivo) ?? []).map(nombreDe).sort(), `${archivo}: la excepcion cambio`).toEqual(
        [...textos].sort(),
      );
    }
    for (const [archivo, n] of Object.entries(PENDIENTES_FASE_2)) {
      expect(todos.get(archivo)?.length ?? 0, `${archivo}: el pendiente cambio (retira o ajusta la entrada)`).toBe(n);
    }
  });
});

describe("455/R38 (G2) — el contexto del asistente, rol por rol", () => {
  it("ningun documento del contexto de ningun rol cita un nombre retirado (salvo los pendientes de la Fase 2)", async () => {
    const docs: DocumentoAyuda[] = await leerCatalogoAyuda();
    expect(docs.length).toBeGreaterThan(10);
    const infractores: string[] = [];
    for (const rol of ["maestro", "admin", "adminTienda", "adminSatelite", "mensajero", null] as const) {
      for (const d of contextoPara(docs, rol)) {
        const archivo = `docs/ayuda/${d.slug}.md`;
        const h = hallazgosEnDocumento(d.cuerpo, archivo);
        if (h.length > 0 && PENDIENTES_FASE_2[archivo] === undefined) infractores.push(`${rol}: ${h.join(", ")}`);
      }
    }
    expect(infractores).toEqual([]);
  });
});
