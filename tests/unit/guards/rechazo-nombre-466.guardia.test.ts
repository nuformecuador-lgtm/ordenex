// GUARDIA — FICHA 466 (T1.1, design §3; R20, R21, R22, R23, R15): «RECHAZO» NO VUELVE COMO NOMBRE
// DE UN CONCEPTO, UN KPI O UN ESTADO.
//
// La 455 renombro el ESTADO `devolucion_a_origen_por_rechazo` a «Devolución a origen por rechazo».
// La 466 alinea los CONCEPTOS de dinero, los KPIs y los textos que lo nombran (requirements §0.2-§0.4)
// y retira las frases de §0.5 («flete por rechazo», «cobro por rechazo», «tasa de rechazo»…). La
// palabra sigue siendo legitima cuando nombra la ACCION de una persona («Rechazar»), el ACTO del
// destinatario o de la tienda («El destinatario rechazó el paquete») o la decision sobre OTRA entidad
// (un cierre, un incidente, una postulacion: §0.6). Por eso no se prohibe «rechaz» en todo el arbol
// (design §5, A3: ~3 700 apariciones casi todas legitimas) sino que hay TRES brazos:
//
//   1. DICCIONARIOS (R20, R22): sobre una lista CERRADA de archivos de rotulos, ningun texto visible
//      contiene «rechazo(s)», «rechazado(s)», «rechazada(s)» —una vez borrado el nombre vigente— fuera
//      de una lista cerrada de excepciones por ARCHIVO + TEXTO EXACTO + MOTIVO. «rechazó», «rechazar»
//      y «rechaza» no casan: son verbos de una accion (§0.6).
//   2. FRASES (R21): en `app/`, `lib/`, `components/`, `hooks/` (AST: los comentarios no cuentan) y en
//      `docs/ayuda/**` y `docs/api/**` (salvo el CHANGELOG, que es historia), ninguna frase de §0.5 en
//      ninguna caja. SIN excepciones. Es el brazo que caza un archivo nuevo fuera de la lista del 1.
//   3. ASISTENTE (R15): el contexto que `contextoPara` arma para cada rol no contiene frases de §0.5.
//
// ⏳ FASE 1 → FASE 2 (2026-10-01). Esta guardia nace en la Fase 1 (backend) y la pantalla todavia
// dice los textos viejos: cambiarla es la Fase 2 (frontend_dev, T2.1-T2.5). Para que la guardia sirva
// desde HOY sin fingir verde, lo pendiente vive en `PENDIENTES`, archivo por archivo y con el NUMERO
// EXACTO de hallazgos de cada brazo: uno mas es una infraccion nueva; uno menos deja la entrada
// caducada y la guardia pide retirarla. La Fase 2 termina cuando `PENDIENTES` esta VACIO (T2.6).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { contextoPara } from "@/lib/asistente/contexto";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import type { DocumentoAyuda } from "@/lib/ayuda/documento";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";

const RAIZ = path.resolve(__dirname, "../../..");

/** El nombre vigente del estado (R12). Se borra del texto ANTES de buscar: contiene «rechazo». */
const NOMBRE_VIGENTE = NOMBRE_ESTADO.devolucion_a_origen_por_rechazo;
const BORRAR_VIGENTE = new RegExp(NOMBRE_VIGENTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");

const palabra = (s: string) => `(?<![\\p{L}_])(?:${s})(?![\\p{L}_])`;

/** Brazo 1 (design §3.1): el sustantivo o el participio, NO el verbo («rechazó», «rechazar»). */
const PALABRA_RECHAZO = new RegExp(palabra("rechaz(?:o|os|ado|ados|ada|adas)"), "iu");

/** Brazo 2 (requirements §0.5): las frases retiradas, en cualquier caja. */
const FRASES_RETIRADAS = new RegExp(
  [
    palabra("fletes?\\s+por\\s+rechazos?"),
    palabra("cobros?\\s+por\\s+rechazos?"),
    palabra("cobros\\s+de\\s+rechazos"),
    palabra("ingreso\\s+de\\s+bodega\\s+por\\s+rechazos"),
    palabra("tasa\\s+de\\s+rechazo"),
    `%\\s*de\\s+rechazo(?![\\p{L}_])`,
    palabra("rechazo\\s*\\(%\\)"),
    palabra("rechazado\\s+por\\s+el\\s+cliente"),
    palabra("pas[aó]\\s+a\\s+rechazo"),
    palabra("corregir\\s+a\\s+rechazo"),
    palabra("entrega\\s+a\\s+rechazo"),
    palabra("marcar\\s+como\\s+rechazada"),
    palabra("qued[oó]\\s+rechazada"),
    palabra("rechazos\\s+por\\s+plazo\\s+vencido"),
  ].join("|"),
  "iu",
);
/** «Rechazos» como ROTULO ENTERO: igualdad del texto recortado, no «contiene» (design §3.2). */
const ROTULO_RECHAZOS = /^rechazos$/iu;

// Una sola «palabra» sin mayusculas ni espacios es una clave o un codigo, no un rotulo (mismo filtro
// que la G2 de la 455). Una consulta SQL tampoco es texto visible.
const PARECE_IDENTIFICADOR = /^[a-z0-9_.:/@#-]*$/;
const PARECE_SQL = /\b(SELECT|UPDATE|INSERT|DELETE|WHERE|FROM|JOIN|COUNT|GROUP BY|ORDER BY)\b/;

/** Brazo 1: la palabra «rechazo…» como texto visible, o `null`. */
export function palabraRechazo(texto: string): string | null {
  if (PARECE_IDENTIFICADOR.test(texto) || PARECE_SQL.test(texto)) return null;
  const m = PALABRA_RECHAZO.exec(texto.replace(BORRAR_VIGENTE, " "));
  return m ? m[0] : null;
}

/** Brazo 2: la frase retirada como texto visible, o `null`. */
export function fraseRetirada(texto: string): string | null {
  if (PARECE_IDENTIFICADOR.test(texto)) return null;
  const limpio = texto.replace(BORRAR_VIGENTE, " ");
  if (ROTULO_RECHAZOS.test(limpio.trim())) return limpio.trim();
  const m = FRASES_RETIRADAS.exec(limpio);
  return m ? m[0] : null;
}

/** Los textos visibles de un fuente TS/TSX (literales, plantillas, JSX), con su linea. Sin comentarios. */
export function textosVisibles(codigo: string, nombre = "fuente.tsx"): { linea: number; texto: string }[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { linea: number; texto: string }[] = [];
  const visitar = (n: ts.Node): void => {
    let texto: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) texto = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texto = n.text;
    else if (ts.isJsxText(n)) texto = n.text;
    if (texto !== null) out.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, texto });
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return out;
}

/** Brazo 1 sobre un fuente: `archivo:linea TEXTO` por cada texto visible con la palabra. */
export function hallazgosDiccionario(codigo: string, nombre = "fuente.tsx"): string[] {
  return textosVisibles(codigo, nombre).flatMap(({ linea, texto }) =>
    palabraRechazo(texto) ? [`${nombre}:${linea} ${texto.trim()}`] : [],
  );
}

/** Brazo 2 sobre un fuente: `archivo:linea FRASE`. */
export function hallazgosFrasesEnCodigo(codigo: string, nombre = "fuente.tsx"): string[] {
  return textosVisibles(codigo, nombre).flatMap(({ linea, texto }) => {
    const f = fraseRetirada(texto);
    return f ? [`${nombre}:${linea} ${f}`] : [];
  });
}

/** Brazo 2 sobre un documento: por lineas, quitando el codigo entre backticks. */
export function hallazgosFrasesEnDocumento(texto: string, nombre = "doc.md"): string[] {
  return texto.split("\n").flatMap((l, i) => {
    const f = fraseRetirada(l.replace(/`[^`]*`/g, " "));
    return f ? [`${nombre}:${i + 1} ${f}`] : [];
  });
}

/** Brazo 1 (design §3.1): la lista CERRADA de diccionarios de rotulos. */
export const DICCIONARIOS = [
  "lib/constants/wallet-rotulos.ts",
  "lib/constants/origen-legible-rotulos.ts",
  "lib/types/historial-accion.ts",
  "lib/analytics/metrics.ts",
  "lib/services/mensajes-bloqueo.ts",
  "app/(app)/wallet/_components/wallet-labels.ts",
  "app/(app)/wallet/_components/composicion-detalle-labels.ts",
  "app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts",
  "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts",
  "app/(app)/mi-wallet/_components/mi-wallet-labels.ts",
  "components/shared/wallet/detalle-movimiento-panel-labels.ts",
  "app/(app)/configuracion/tarifas/_components/tarifas-labels.ts",
  "app/(app)/cierres-admin/_components/cierre-labels.ts",
  "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx",
  "app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx",
  "app/(app)/analitica/_components/operativo/catalogo-paneles.ts",
  "app/(app)/analitica/_components/entregas/ProductosTabla.tsx",
  "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx",
  "app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts",
  "app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx",
  "app/(app)/novedades/_components/RechazosSlaModule.tsx",
] as const;

/**
 * Excepciones CERRADAS del brazo 1 (R20, R22): archivo + TEXTO EXACTO (recortado) + motivo. Cada
 * hallazgo del archivo tiene que ser uno de sus `textos`, y cada `texto` tiene que seguir saliendo.
 */
export const EXCEPCIONES: Record<string, { textos: readonly string[]; motivo: string }> = {
  // Medido el 2026-10-01 (T1.3). Las `descripcion` de las metricas citan los IDS de medida
  // (`entregas`, `devoluciones`, `rechazos`, `incidentes`), que son contrato publicado por API key
  // (requirements «Fuera de alcance», D4); y la de cierres nombra el estado de un CIERRE.
  "lib/analytics/metrics.ts": {
    textos: [
      "Embudo: ORDENES agrupadas por su estatus al corte sobre el universo B2 de la 124 (las vivas al corte mas las que llegaron a un estado terminal ese mismo dia), cada orden en una sola fila; el rollup NO conserva el archivo historico de estados terminales, asi que el historico de terminales se sirve de las medidas de flujo (entregas, devoluciones, rechazos, incidentes) y no de este embudo; no cuenta gestiones, asi que una gestion anulada no mueve esta cifra (solo la mueve el estado real de la orden).",
      "Entregas sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes (una orden reprogramada y luego entregada aporta dos gestiones) y excluye las gestiones anuladas.",
      "Devoluciones sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes y excluye las gestiones anuladas.",
      "Rechazos sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes y excluye las gestiones anuladas.",
      "Cierres de dia y de bodega por estado (solicitado, aprobado, rechazado, vencido) con sus totales snapshot; se lee de los cierres, no de ordenes, y las gestiones anuladas no alteran un total ya congelado.",
    ],
    motivo:
      "descripciones internas de metricas que citan los ids de medida (contrato, fuera de alcance de la " +
      "466) y el estado `rechazado` de un cierre (§0.6, otra entidad)",
  },
  "app/(app)/cierres-admin/_components/cierre-labels.ts": {
    textos: ["Rechazado"],
    motivo: "`ESTADO_LABEL.rechazado`: el estado de un CIERRE (`CierreEstado`), no de una orden (design §3.1)",
  },
  "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx": {
    textos: [
      "Un cierre rechazado no es terminal: sigue bloqueando al mensajero hasta que lo vuelva a solicitar y su bodega lo apruebe.",
    ],
    motivo: "nombra un CIERRE rechazado (§0.6, otra entidad; design §3.1)",
  },
  "app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx": {
    textos: [
      "A esta orden le queda el último intento de entrega, así que ya no se puede reprogramar: volver a mandarla a la calle sería un intento de más. Lo que sí podés registrar desde acá es el rechazo, y el mensajero todavía puede entregarla.",
    ],
    motivo:
      "`GESTION_AYUDA_TOPE_NOTA`: el ACTO de la tienda (su boton «Rechazar»); design §2.2 lo clasifica " +
      "«Se conserva» (linea 208). Elevado al leader en `progress/impl_466.md` por si se prefiere el nombre vigente",
  },
};

/**
 * ⏳ Lo que la FASE 2 tiene que cambiar (T2.1-T2.5), medido el 2026-10-01 sobre este arbol:
 * archivo -> numero EXACTO de hallazgos del brazo 1 (`diccionario`) y del brazo 2 (`frases`). La Fase 2
 * retira cada entrada al corregir su archivo; no puede anadir ninguna.
 */
export const PENDIENTES: Record<string, { diccionario?: number; frases?: number }> = {
  // T2.1 — wallet
  "app/(app)/wallet/_components/wallet-labels.ts": { diccionario: 1, frases: 1 },
  "app/(app)/wallet/_components/composicion-detalle-labels.ts": { diccionario: 2, frases: 2 },
  "app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts": { diccionario: 5, frases: 4 },
  // C7/C8 ya van en la Fase 1: `desglose-tienda-labels.test.ts` exige que digan lo MISMO que C1/C2.
  "app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts": { diccionario: 2, frases: 2 },
  "app/(app)/mi-wallet/_components/mi-wallet-labels.ts": { diccionario: 4, frases: 4 },
  "components/shared/wallet/detalle-movimiento-panel-labels.ts": { diccionario: 4, frases: 3 },
  // T2.2 — cierres y tarifas
  "app/(app)/configuracion/tarifas/_components/tarifas-labels.ts": { diccionario: 4, frases: 3 },
  "app/(app)/cierres-admin/_components/cierre-labels.ts": { diccionario: 9, frases: 6 },
  "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx": { diccionario: 7, frases: 5 },
  "app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx": { diccionario: 3, frases: 2 },
  "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx": { frases: 1 },
  "app/(app)/cierres-admin/_components/cierre-factura.tsx": { frases: 1 },
  // T2.3 — mensajero y novedades
  "app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx": { diccionario: 1, frases: 1 },
  "app/(app)/novedades/_components/RechazosSlaModule.tsx": { diccionario: 2, frases: 2 },
  "app/(app)/novedades/_components/RechazarNovedadModal.tsx": { frases: 1 },
  // T2.4 — analitica. La leyenda `catalogo-paneles.ts` (K1) ya va en la Fase 1: la guardia
  // `etiquetas-visibles` exige que diga lo MISMO que la metrica (design §3.6).
  "app/(app)/analitica/_components/entregas/ProductosTabla.tsx": { diccionario: 1, frases: 1 },
  "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx": { diccionario: 3, frases: 3 },
  "app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts": { diccionario: 2, frases: 2 },
  // T2.5 — ayuda
  "docs/ayuda/oficina/wallet-caja.md": { frases: 7 },
  "docs/ayuda/tienda/mi-wallet.md": { frases: 2 },
  "docs/ayuda/oficina/cierres.md": { frases: 2 },
};

/**
 * R23 (no-vacuidad): cuantos textos con «devolución a origen» tiene que encontrar el brazo 1. Con la
 * Fase 2 hecha (`PENDIENTES` vacio) son mas de 15 (design §3.4); mientras tanto solo esta puesto lo de
 * `lib/` (medido: 15 el 2026-10-01), y el umbral de la Fase 1 lo exige.
 */
const MINIMO_TEXTOS_NUEVOS = Object.keys(PENDIENTES).length > 0 ? 10 : 15;

function listar(dir: string, re: RegExp, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const completo = path.join(dir, e);
    if (statSync(completo).isDirectory()) listar(completo, re, acc);
    else if (re.test(e) && !/\.d\.ts$/.test(e)) acc.push(completo);
  }
  return acc;
}

const rel = (completo: string) => path.relative(RAIZ, completo).split(path.sep).join("/");
const textoDe = (hallazgo: string) => hallazgo.slice(hallazgo.indexOf(" ") + 1);

function censoDiccionarios(): { leidos: number; hallazgos: Map<string, string[]>; vigentes: number } {
  const hallazgos = new Map<string, string[]>();
  let leidos = 0;
  let vigentes = 0;
  for (const archivo of DICCIONARIOS) {
    const codigo = readFileSync(path.join(RAIZ, archivo), "utf8");
    leidos += 1;
    const h = hallazgosDiccionario(codigo, archivo);
    if (h.length > 0) hallazgos.set(archivo, h);
    vigentes += textosVisibles(codigo, archivo).filter(({ texto }) => /devoluci[oó]n(?:es)? a origen/iu.test(texto)).length;
  }
  return { leidos, hallazgos, vigentes };
}

function censoFrases(): { codigo: number; ayuda: number; hallazgos: Map<string, string[]> } {
  const hallazgos = new Map<string, string[]>();
  let codigo = 0;
  for (const d of ["app", "lib", "components", "hooks"]) {
    for (const f of listar(path.join(RAIZ, d), /\.tsx?$/)) {
      if (d === "app") codigo += 1;
      const h = hallazgosFrasesEnCodigo(readFileSync(f, "utf8"), rel(f));
      if (h.length > 0) hallazgos.set(rel(f), h);
    }
  }
  let ayuda = 0;
  for (const [d, re] of [
    ["docs/ayuda", /\.md$/],
    ["docs/api", /\.(md|ya?ml|html)$/],
  ] as const) {
    for (const f of listar(path.join(RAIZ, d), re)) {
      if (rel(f) === "docs/api/CHANGELOG.md") continue; // historia: cada entrada dice lo que dijo
      if (d === "docs/ayuda") ayuda += 1;
      const h = hallazgosFrasesEnDocumento(readFileSync(f, "utf8"), rel(f));
      if (h.length > 0) hallazgos.set(rel(f), h);
    }
  }
  return { codigo, ayuda, hallazgos };
}

/** Los hallazgos del brazo 1 que no cubre una excepcion (por texto) ni un pendiente (por numero). */
export function infractoresDiccionario(
  todos: ReadonlyMap<string, readonly string[]>,
  excepciones: typeof EXCEPCIONES = EXCEPCIONES,
  pendientes: typeof PENDIENTES = PENDIENTES,
): string[] {
  const infractores: string[] = [];
  for (const [archivo, hallazgos] of todos) {
    const excepcion = excepciones[archivo];
    const resto = excepcion ? hallazgos.filter((h) => !excepcion.textos.includes(textoDe(h))) : [...hallazgos];
    const pendiente = pendientes[archivo]?.diccionario;
    if (pendiente !== undefined && resto.length <= pendiente) continue;
    infractores.push(...resto);
  }
  return infractores;
}

/** Los hallazgos del brazo 2 que no cubre un pendiente (sin excepciones, design §3.2). */
export function infractoresFrases(
  todos: ReadonlyMap<string, readonly string[]>,
  pendientes: typeof PENDIENTES = PENDIENTES,
): string[] {
  const infractores: string[] = [];
  for (const [archivo, hallazgos] of todos) {
    const pendiente = pendientes[archivo]?.frases;
    if (pendiente !== undefined && hallazgos.length <= pendiente) continue;
    infractores.push(...hallazgos);
  }
  return infractores;
}

/** R22: una excepcion que ya no sale, o cuyo texto cambio, es un rojo que pide retirarla o ajustarla. */
export function excepcionesCaducadas(
  todos: ReadonlyMap<string, readonly string[]>,
  excepciones: typeof EXCEPCIONES = EXCEPCIONES,
): string[] {
  const caducadas: string[] = [];
  for (const [archivo, { textos }] of Object.entries(excepciones)) {
    const vistos = new Set((todos.get(archivo) ?? []).map(textoDe));
    for (const t of textos) if (!vistos.has(t)) caducadas.push(`${archivo}: «${t}»`);
  }
  return caducadas;
}

describe("466 — autocomprobacion del detector (una guardia estatica rota no falla: calla)", () => {
  it("MUTACION (R23): el literal, el texto JSX, la plantilla y el documento con una frase retirada dan rojo", () => {
    const infractor = [
      `const a = "Flete por rechazo cobrado a la tienda";`,
      `const b = <span>Tasa de rechazo</span>;`,
      "const c = `quedó rechazada`;",
      `const d = "Rechazos";`,
    ].join("\n");
    expect(hallazgosFrasesEnCodigo(infractor)).toEqual([
      "fuente.tsx:1 Flete por rechazo",
      "fuente.tsx:2 Tasa de rechazo",
      "fuente.tsx:3 quedó rechazada",
      "fuente.tsx:4 Rechazos",
    ]);
    expect(hallazgosDiccionario(infractor)).toEqual([
      "fuente.tsx:1 Flete por rechazo cobrado a la tienda",
      "fuente.tsx:2 Tasa de rechazo",
      "fuente.tsx:3 quedó rechazada",
      "fuente.tsx:4 Rechazos",
    ]);
    expect(hallazgosFrasesEnDocumento("Linea sana.\nEl **Cobro por rechazo** de la tienda.")).toEqual([
      "doc.md:2 Cobro por rechazo",
    ]);
  });

  it("MUTACION (R23): cada frase de §0.5 da rojo, en cualquier caja", () => {
    const frases = [
      "flete por rechazo",
      "FLETES POR RECHAZO",
      "IVA del flete por rechazo",
      "cobro por rechazo",
      "Cobros por rechazo",
      "cobros de rechazos",
      "Ingreso de bodega por rechazos",
      "tasa de rechazo",
      "% de rechazo",
      "Rechazo (%)",
      "Rechazado por el cliente",
      "La entrega pasa a rechazo.",
      "la entrega pasó a rechazo.",
      "Solo se puede corregir a rechazo",
      "una entrega a rechazo",
      "Marcar como rechazada",
      "La orden quedó rechazada.",
      "Paginación de rechazos por plazo vencido",
    ];
    for (const f of frases) expect(fraseRetirada(f), f).not.toBeNull();
  });

  it("no denuncia el nombre vigente, la accion, el acto, los comentarios ni los identificadores", () => {
    const sano = [
      `const a = "Devolución a origen por rechazo";`,
      `const b = "Rechazar";`,
      `const c = "El destinatario rechazó el paquete.";`,
      `// flete por rechazo`,
      `/* Tasa de rechazo */ const d = 1;`,
      `const e = "rechazos";`,
      `const f = "tasa_rechazo";`,
      `const g = "Flete por devolución a origen cobrado a la tienda";`,
      `const h = <p>Marcar como Devolución a origen por rechazo</p>;`,
      `const i = "Se rechaza la gestion";`,
    ].join("\n");
    expect(hallazgosFrasesEnCodigo(sano)).toEqual([]);
    expect(hallazgosDiccionario(sano)).toEqual([]);
    expect(hallazgosFrasesEnDocumento("Pasa a **Devolución a origen por rechazo**. Ver `flete por rechazo`.")).toEqual([]);
  });

  it("MUTACION (R22): una excepcion con el texto cambiado o que ya no sale da rojo", () => {
    const archivo = "lib/x.ts";
    const exc = { [archivo]: { textos: ["Rechazado"], motivo: "estado de un cierre" } };
    // La excepcion vigente pasa…
    expect(infractoresDiccionario(new Map([[archivo, [`${archivo}:3 Rechazado`]]]), exc, {})).toEqual([]);
    expect(excepcionesCaducadas(new Map([[archivo, [`${archivo}:3 Rechazado`]]]), exc)).toEqual([]);
    // …con otro texto en el mismo archivo, el hallazgo es infractor y la excepcion caduca.
    expect(infractoresDiccionario(new Map([[archivo, [`${archivo}:3 Rechazada`]]]), exc, {})).toEqual([
      `${archivo}:3 Rechazada`,
    ]);
    expect(excepcionesCaducadas(new Map([[archivo, [`${archivo}:3 Rechazada`]]]), exc)).toEqual([
      `${archivo}: «Rechazado»`,
    ]);
  });

  it("MUTACION: un pendiente cubre su numero exacto y ni uno mas", () => {
    const archivo = "app/y.ts";
    const dos = new Map([[archivo, [`${archivo}:1 flete por rechazo`, `${archivo}:2 cobro por rechazo`]]]);
    expect(infractoresFrases(dos, { [archivo]: { frases: 2 } })).toEqual([]);
    expect(infractoresFrases(dos, { [archivo]: { frases: 1 } })).toHaveLength(2);
    expect(infractoresFrases(dos, {})).toHaveLength(2);
  });
});

describe("466/R20 · R22 (brazo 1) — los diccionarios de rotulos", () => {
  const { leidos, hallazgos, vigentes } = censoDiccionarios();

  it("no-vacuidad (R23): lee TODOS los diccionarios y encuentra el texto nuevo", () => {
    expect(leidos).toBe(DICCIONARIOS.length);
    expect(vigentes, "«devolución a origen» no aparece en los diccionarios: el extractor no lee o el cambio no esta").toBeGreaterThan(
      MINIMO_TEXTOS_NUEVOS,
    );
  });

  it("ninguna palabra «rechazo» fuera de las excepciones y de lo pendiente de la Fase 2", () => {
    expect(
      infractoresDiccionario(hallazgos),
      "«rechazo» volvio como nombre de un concepto, KPI o estado (requirements 466 §0). Usa la forma " +
        "«devolución a origen» o el nombre vigente; si nombra otra entidad, declara la excepcion con su texto.",
    ).toEqual([]);
  });

  it("cada excepcion sigue haciendo falta con su texto exacto, y cada pendiente con su numero exacto", () => {
    expect(excepcionesCaducadas(hallazgos), "excepcion caducada: retirala o ajusta su texto").toEqual([]);
    for (const [archivo, { diccionario }] of Object.entries(PENDIENTES)) {
      if (diccionario === undefined) continue;
      const exc = EXCEPCIONES[archivo];
      const n = (hallazgos.get(archivo) ?? []).filter((h) => !exc?.textos.includes(textoDe(h))).length;
      expect(n, `${archivo}: el pendiente del brazo 1 cambio (retira o ajusta la entrada)`).toBe(diccionario);
    }
  });
});

describe("466/R21 (brazo 2) — las frases retiradas en todo el arbol", () => {
  const { codigo, ayuda, hallazgos } = censoFrases();

  it("no-vacuidad (R23): leyo codigo y documentos", () => {
    expect(codigo).toBeGreaterThan(300);
    expect(ayuda).toBeGreaterThan(10);
  });

  it("ninguna frase de §0.5 como texto visible fuera de lo pendiente de la Fase 2", () => {
    expect(
      infractoresFrases(hallazgos),
      "una frase RETIRADA por la 466 (§0.5) volvio como texto visible. Usa «devolución a origen» o el " +
        "nombre vigente «Devolución a origen por rechazo».",
    ).toEqual([]);
  });

  it("cada pendiente del brazo 2 sigue haciendo falta con su numero exacto", () => {
    for (const [archivo, { frases }] of Object.entries(PENDIENTES)) {
      if (frases === undefined) continue;
      expect(hallazgos.get(archivo)?.length ?? 0, `${archivo}: el pendiente del brazo 2 cambio`).toBe(frases);
    }
  });
});

describe("466/R15 (brazo 3) — el contexto del asistente, rol por rol", () => {
  it("ningun documento del contexto de ningun rol contiene una frase retirada (salvo lo pendiente)", async () => {
    const docs: DocumentoAyuda[] = await leerCatalogoAyuda();
    expect(docs.length).toBeGreaterThan(10);
    const infractores: string[] = [];
    for (const rol of ["maestro", "admin", "adminTienda", "adminSatelite", "mensajero", null] as const) {
      for (const d of contextoPara(docs, rol)) {
        const archivo = `docs/ayuda/${d.slug}.md`;
        const h = hallazgosFrasesEnDocumento(d.cuerpo, archivo);
        if (h.length > 0 && PENDIENTES[archivo]?.frases === undefined) infractores.push(`${rol}: ${h.join(", ")}`);
      }
    }
    expect(infractores).toEqual([]);
  });
});
