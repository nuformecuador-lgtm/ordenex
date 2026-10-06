// Ficha 476 (design §4.6, D6, R16-R22) — PDF del picking (maqueta `design-whatsapp/PdfPicking.dc.html`).
//
// DOS PASOS, para que el contenido del papel se pueda probar sin leer un PDF:
//   1. `maquetarPicking(modelo, medir)` — PURO: recibe la medida de texto y devuelve las paginas como
//      listas de operaciones (textos con su fuente, rectangulos, rayas). Aqui vive TODA la decision:
//      que se escribe, donde, con que fuente, cuando se salta de pagina.
//   2. `pdfDePicking(modelo)` — crea el jsPDF, registra la fuente embebida, le pasa a la maqueta la
//      medida REAL (`getTextWidth` de la MISMA fuente con que se dibuja) y ejecuta las operaciones.
//
// FUENTES (D6). Todo texto que lleva DATOS (tienda, producto, remision) va con la fuente EMBEBIDA de
// etiquetas, y antes pasa por `imprimible`: lo que su cobertura no tiene sale como «?» y se CUENTA
// (R22) — jsPDF borra en silencio lo que la fuente no cubre, y un producto que pierde letras en una
// hoja de picking es un paquete mal preparado. Helvetica solo para rotulos FIJOS de este modulo
// (la negrita), y un test exige que todos sean `seguroEnFuenteEstandar`.
//
// La tabla NUNCA recorta: el nombre del producto y las fichas de remision saltan de linea dentro de
// su celda, la fila crece, y una fila mas alta que una pagina se parte en filas «(continúa)» (R21).
import { jsPDF } from "jspdf";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { cubreCodePoint, registrarFuente } from "@/lib/pdf/etiquetas-fuente-registro";
import { fechaCortaCR, fechaLargaCR, horaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import type { GrupoPicking, ModeloPicking } from "@/lib/whatsapp-envios/informes/picking/modelo";

export type FuentePdf = "embebida" | "helvetica" | "helvetica-bold";
export type Rgb = readonly [number, number, number];

/** Ancho en mm de `texto` dibujado a `tam` puntos con `fuente`. */
export type MedirTexto = (texto: string, tam: number, fuente: FuentePdf) => number;

/** Para que un test encuentre una pieza sin depender de coordenadas. */
export type RolTexto =
  | "marca"
  | "tienda"
  | "subtitulo"
  | "fecha"
  | "hora"
  | "cifra-titulo"
  | "cifra-ordenes"
  | "cifra-unidades"
  | "atrasadas-titulo"
  | "atrasadas-lista"
  | "cabecera-tabla"
  | "producto"
  | "unidades"
  | "ficha"
  | "ficha-atrasada"
  | "total"
  | "nota"
  | "aviso-sustitucion"
  | "pie"
  | "pie-pagina";

export type OpPdf =
  | {
      tipo: "texto";
      rol: RolTexto;
      texto: string;
      x: number;
      y: number;
      tam: number;
      fuente: FuentePdf;
      color: Rgb;
      derecha?: boolean;
    }
  | { tipo: "rect"; rol: "cabecera-tabla" | "ficha" | "ficha-atrasada" | "atrasadas" | "casilla"; x: number; y: number; w: number; h: number; relleno: Rgb | null; borde: Rgb | null; radio: number }
  | { tipo: "linea"; x1: number; y1: number; x2: number; y2: number; color: Rgb; grosor: number };

export interface MaquetaPicking {
  paginas: OpPdf[][];
  /** Caracteres de datos sustituidos por «?» (R22). */
  sustituidos: number;
}

// ── Geometria (mm, A4 vertical) ──────────────────────────────────────────────
const ANCHO = 210;
const ALTO = 297;
const MARGEN = 15;
const UTIL = ANCHO - 2 * MARGEN;
/** Ultima coordenada en la que puede acabar contenido: el pie vive debajo. */
const LIMITE = ALTO - 20;
const Y_INICIO_PAGINA = MARGEN + 2;

const COL_PRODUCTO = { x: MARGEN, w: 60 };
const COL_UNIDADES = { x: COL_PRODUCTO.x + COL_PRODUCTO.w, w: 20 };
const COL_LISTO_W = 14;
const COL_REMISIONES = { x: COL_UNIDADES.x + COL_UNIDADES.w, w: UTIL - COL_PRODUCTO.w - COL_UNIDADES.w - COL_LISTO_W };
const COL_LISTO = { x: COL_REMISIONES.x + COL_REMISIONES.w, w: COL_LISTO_W };

const ALTO_CABECERA_TABLA = 7;
const PAD_FILA = 2;
const TAM_PRODUCTO = 9;
const INTERLINEA_PRODUCTO = 4.2;
const TAM_FICHA = 7.5;
const INTERLINEA_FICHA = 3.4;
const PAD_FICHA_H = 1.5;
const PAD_FICHA_V = 0.9;
const SEPARACION_FICHAS = 1.5;

const TINTA: Rgb = [18, 35, 63];
const GRIS: Rgb = [74, 83, 104];
const LINEA: Rgb = [227, 232, 242];
const FONDO_CABECERA: Rgb = [241, 244, 249];
const FONDO_FICHA: Rgb = [246, 248, 251];
const NARANJA: Rgb = [242, 100, 25];
const AMBAR_FONDO: Rgb = [254, 243, 199];
const AMBAR_BORDE: Rgb = [245, 158, 11];
const AMBAR_TEXTO: Rgb = [146, 64, 14];

/**
 * Rotulos FIJOS dibujados con Helvetica (D6). Viven aqui, juntos, para que un test los recorra y
 * exija que ninguno lleve un caracter que la fuente estandar borraria (`—`, `’`, …).
 */
export const ROTULOS_HELVETICA = {
  marca: "Ordenex · Picking",
  subtitulo: "Lo que está En preparación, agrupado por producto",
  horaSufijo: " · hora de Costa Rica",
  cifraOrdenes: "ÓRDENES",
  cifraUnidades: "UNIDADES",
  cabeceraProducto: "Producto",
  cabeceraUnidades: "Unidades",
  cabeceraRemisiones: "Remisiones que lo llevan",
  cabeceraListo: "Listo",
  sinProducto: "Sin producto indicado",
  totalPrefijo: "Total · ",
  pagina: "Página",
} as const;

/** `n` + singular/plural. */
function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * R22 — sustituye por «?» lo que la fuente embebida no puede imprimir y CUENTA cuantos. Los saltos
 * de linea y tabuladores pasan a espacio (no son un caracter perdido: son formato).
 */
export function imprimible(texto: string): { texto: string; sustituidos: number } {
  let out = "";
  let sustituidos = 0;
  for (const c of texto.replace(/[\r\n\t]+/g, " ")) {
    const cp = c.codePointAt(0) ?? 0x3f;
    if (cubreCodePoint(fuenteEtiqueta, cp)) {
      out += c;
    } else {
      out += "?";
      sustituidos += 1;
    }
  }
  return { texto: out, sustituidos };
}

/**
 * Parte `texto` en lineas que caben en `ancho`. Por palabras; una palabra mas ancha que la linea se
 * parte por caracteres (nunca se recorta ni se sale de la celda).
 */
export function partirEnLineas(texto: string, ancho: number, tam: number, fuente: FuentePdf, medir: MedirTexto): string[] {
  const palabras = texto.split(" ").filter((p) => p !== "");
  if (palabras.length === 0) return [""];
  const lineas: string[] = [];
  let actual = "";
  const empujar = (palabra: string): void => {
    // Palabra que no cabe sola: por caracteres.
    let trozo = "";
    for (const c of palabra) {
      if (trozo !== "" && medir(trozo + c, tam, fuente) > ancho) {
        lineas.push(trozo);
        trozo = c;
      } else {
        trozo += c;
      }
    }
    actual = trozo;
  };
  for (const p of palabras) {
    const candidata = actual === "" ? p : `${actual} ${p}`;
    if (medir(candidata, tam, fuente) <= ancho) {
      actual = candidata;
      continue;
    }
    if (actual !== "") lineas.push(actual);
    actual = "";
    if (medir(p, tam, fuente) <= ancho) actual = p;
    else empujar(p);
  }
  if (actual !== "") lineas.push(actual);
  return lineas;
}

/** Separacion minima (mm) entre el sello del pie y «Página X de Y». */
const HUECO_PIE = 4;

/**
 * Recorta `texto` con «…» para que quepa en `ancho` (una sola linea). Para el PIE, donde no cabe
 * saltar de linea: una tienda de nombre largo pisaba «Página X de Y» (revision 476, m2).
 */
export function recortarAlAncho(texto: string, ancho: number, tam: number, fuente: FuentePdf, medir: MedirTexto): string {
  if (medir(texto, tam, fuente) <= ancho) return texto;
  const elipsis = fuente !== "embebida" || cubreCodePoint(fuenteEtiqueta, 0x2026) ? "…" : "...";
  const chars = [...texto];
  while (chars.length > 0 && medir(`${chars.join("").trimEnd()}${elipsis}`, tam, fuente) > ancho) chars.pop();
  return `${chars.join("").trimEnd()}${elipsis}`;
}

interface Ficha {
  lineas: string[];
  w: number;
  h: number;
  atrasada: boolean;
}

interface LineaDeFichas {
  fichas: { ficha: Ficha; x: number }[];
  h: number;
}

/** Saneado UNA vez por dato (R22): el aviso cuenta caracteres del dato, no de cada vez que se pinta. */
class Saneador {
  sustituidos = 0;
  private readonly cache = new Map<string, string>();

  dato(clave: string, texto: string): string {
    const previo = this.cache.get(clave);
    if (previo !== undefined) return previo;
    const r = imprimible(texto);
    this.sustituidos += r.sustituidos;
    this.cache.set(clave, r.texto);
    return r.texto;
  }
}

class Maquetador {
  readonly paginas: OpPdf[][] = [[]];
  y = MARGEN;
  enTabla = false;

  constructor(private readonly medir: MedirTexto) {}

  get ops(): OpPdf[] {
    return this.paginas[this.paginas.length - 1];
  }

  texto(rol: RolTexto, texto: string, x: number, y: number, tam: number, fuente: FuentePdf, color: Rgb = TINTA, derecha = false): void {
    this.ops.push({ tipo: "texto", rol, texto, x, y, tam, fuente, color, ...(derecha ? { derecha: true } : {}) });
  }

  nuevaPagina(): void {
    this.paginas.push([]);
    this.y = Y_INICIO_PAGINA;
    if (this.enTabla) this.cabeceraTabla();
  }

  /** Salta de pagina si `alto` no cabe. */
  asegurar(alto: number): void {
    if (this.y + alto > LIMITE) this.nuevaPagina();
  }

  cabeceraTabla(): void {
    const y = this.y;
    this.ops.push({ tipo: "rect", rol: "cabecera-tabla", x: MARGEN, y, w: UTIL, h: ALTO_CABECERA_TABLA, relleno: FONDO_CABECERA, borde: null, radio: 0 });
    const base = y + 4.8;
    const t = (s: string, x: number, derecha = false) => this.texto("cabecera-tabla", s, x, base, 8, "helvetica-bold", GRIS, derecha);
    t(ROTULOS_HELVETICA.cabeceraProducto, COL_PRODUCTO.x + 2);
    t(ROTULOS_HELVETICA.cabeceraUnidades, COL_UNIDADES.x + COL_UNIDADES.w - 2, true);
    t(ROTULOS_HELVETICA.cabeceraRemisiones, COL_REMISIONES.x + 2);
    t(ROTULOS_HELVETICA.cabeceraListo, COL_LISTO.x + 2);
    this.y = y + ALTO_CABECERA_TABLA;
  }

  ancho(texto: string, tam: number, fuente: FuentePdf): number {
    return this.medir(texto, tam, fuente);
  }
}

function encabezado(m: Maquetador, modelo: ModeloPicking, tienda: string): void {
  m.texto("marca", ROTULOS_HELVETICA.marca, MARGEN, 18, 9, "helvetica", GRIS);
  const lineasTienda = partirEnLineas(tienda, 110, 18, "embebida", (t, tam, f) => m.ancho(t, tam, f));
  let y = 26;
  for (const l of lineasTienda) {
    m.texto("tienda", l, MARGEN, y, 18, "embebida");
    y += 7;
  }
  m.texto("subtitulo", ROTULOS_HELVETICA.subtitulo, MARGEN, y - 1, 8, "helvetica", GRIS);
  const derecha = ANCHO - MARGEN;
  m.texto("fecha", fechaLargaCR(modelo.ahora), derecha, 18, 10, "helvetica-bold", TINTA, true);
  m.texto("hora", `${horaCRLegible(modelo.ahora)}${ROTULOS_HELVETICA.horaSufijo}`, derecha, 23, 8, "helvetica", GRIS, true);
  m.texto("cifra-titulo", ROTULOS_HELVETICA.cifraOrdenes, derecha - 28, 30, 7, "helvetica", GRIS, true);
  m.texto("cifra-ordenes", String(modelo.totales.ordenes), derecha - 28, 37, 16, "helvetica-bold", TINTA, true);
  m.texto("cifra-titulo", ROTULOS_HELVETICA.cifraUnidades, derecha, 30, 7, "helvetica", GRIS, true);
  m.texto("cifra-unidades", String(modelo.totales.unidades), derecha, 37, 16, "helvetica-bold", TINTA, true);
  const abajo = Math.max(y + 3, 41);
  m.ops.push({ tipo: "linea", x1: MARGEN, y1: abajo, x2: ANCHO - MARGEN, y2: abajo, color: NARANJA, grosor: 0.8 });
  m.y = abajo + 6;
}

/** R19 — bloque de atrasadas sobre la tabla. Se parte entre paginas si hiciera falta. */
function bloqueAtrasadas(m: Maquetador, modelo: ModeloPicking, identificadores: Map<string, string>): void {
  const medir: MedirTexto = (t, tam, f) => m.ancho(t, tam, f);
  const n = modelo.atrasadas.length;
  const titulo =
    `${plural(n, "orden lleva", "órdenes llevan")} más de ${plural(modelo.diasAtraso, "día", "días")} ` +
    "en preparación, prepáralas primero:";
  const lista = modelo.atrasadas
    .map((a) => `${identificadores.get(a.ordenId) ?? a.identificador} (${plural(a.dias, "día", "días")})`)
    .join(" · ");
  const lineas: { rol: RolTexto; texto: string; tam: number; fuente: FuentePdf; color: Rgb; alto: number }[] = [
    ...partirEnLineas(titulo, UTIL - 8, 9, "helvetica-bold", medir).map((t) => ({
      rol: "atrasadas-titulo" as const,
      texto: t,
      tam: 9,
      fuente: "helvetica-bold" as const,
      color: AMBAR_TEXTO,
      alto: 4.6,
    })),
    ...partirEnLineas(lista, UTIL - 8, 8.5, "embebida", medir).map((t) => ({
      rol: "atrasadas-lista" as const,
      texto: t,
      tam: 8.5,
      fuente: "embebida" as const,
      color: TINTA,
      alto: 4.3,
    })),
  ];
  let i = 0;
  while (i < lineas.length) {
    m.asegurar(4 + lineas[i].alto + 2);
    const arriba = m.y;
    const ops: OpPdf[] = [];
    let y = arriba + 3;
    while (i < lineas.length && y + lineas[i].alto + 2 <= LIMITE) {
      const l = lineas[i];
      y += l.alto;
      ops.push({ tipo: "texto", rol: l.rol, texto: l.texto, x: MARGEN + 4, y: y - 1, tam: l.tam, fuente: l.fuente, color: l.color });
      i += 1;
    }
    const alto = y - arriba + 2;
    m.ops.push({ tipo: "rect", rol: "atrasadas", x: MARGEN, y: arriba, w: UTIL, h: alto, relleno: AMBAR_FONDO, borde: AMBAR_BORDE, radio: 1.5 });
    m.ops.push(...ops);
    m.y = arriba + alto;
    if (i < lineas.length) m.nuevaPagina();
  }
  m.y += 5;
}

/** Las fichas de remision de un producto, repartidas en lineas dentro de la celda. */
function lineasDeFichas(g: GrupoPicking, identificadores: Map<string, string>, medir: MedirTexto): LineaDeFichas[] {
  const anchoCelda = COL_REMISIONES.w - 4;
  const fichas: Ficha[] = g.ordenes.map((o) => {
    let texto = identificadores.get(o.ordenId) ?? o.identificador;
    if (o.cantidad > 1) texto += ` ×${o.cantidad}`;
    if (o.atrasada) texto += ` · ${o.dias} d`;
    const lineas = partirEnLineas(texto, anchoCelda - 2 * PAD_FICHA_H, TAM_FICHA, "embebida", medir);
    const w = Math.min(anchoCelda, Math.max(...lineas.map((l) => medir(l, TAM_FICHA, "embebida"))) + 2 * PAD_FICHA_H);
    return { lineas, w, h: lineas.length * INTERLINEA_FICHA + 2 * PAD_FICHA_V, atrasada: o.atrasada };
  });
  const filas: LineaDeFichas[] = [];
  let actual: LineaDeFichas = { fichas: [], h: 0 };
  let x = 0;
  for (const f of fichas) {
    if (actual.fichas.length > 0 && x + f.w > anchoCelda) {
      filas.push(actual);
      actual = { fichas: [], h: 0 };
      x = 0;
    }
    actual.fichas.push({ ficha: f, x });
    actual.h = Math.max(actual.h, f.h);
    x += f.w + SEPARACION_FICHAS;
  }
  if (actual.fichas.length > 0) filas.push(actual);
  return filas;
}

const altoDeFichas = (ls: readonly LineaDeFichas[]): number =>
  ls.reduce((n, l) => n + l.h, 0) + Math.max(0, ls.length - 1) * SEPARACION_FICHAS;

/** Dibuja UNA parte de la fila de un producto en `m.y` y avanza. */
function parteDeFila(
  m: Maquetador,
  nombre: string[],
  nombreFuente: FuentePdf,
  unidades: string | null,
  fichas: readonly LineaDeFichas[],
  conCasilla: boolean,
): void {
  const arriba = m.y;
  const alto = Math.max(nombre.length * INTERLINEA_PRODUCTO, altoDeFichas(fichas)) + 2 * PAD_FILA;
  nombre.forEach((l, i) => {
    m.texto("producto", l, COL_PRODUCTO.x + 2, arriba + PAD_FILA + 3.2 + i * INTERLINEA_PRODUCTO, TAM_PRODUCTO, nombreFuente, nombreFuente === "embebida" ? TINTA : GRIS);
  });
  if (unidades !== null) {
    m.texto("unidades", unidades, COL_UNIDADES.x + COL_UNIDADES.w - 2, arriba + PAD_FILA + 3.2, 10, "helvetica-bold", TINTA, true);
  }
  let y = arriba + PAD_FILA;
  for (const linea of fichas) {
    for (const { ficha, x } of linea.fichas) {
      const rol = ficha.atrasada ? "ficha-atrasada" : "ficha";
      m.ops.push({
        tipo: "rect",
        rol,
        x: COL_REMISIONES.x + 2 + x,
        y,
        w: ficha.w,
        h: ficha.h,
        relleno: ficha.atrasada ? AMBAR_FONDO : FONDO_FICHA,
        borde: ficha.atrasada ? AMBAR_BORDE : LINEA,
        radio: 1,
      });
      ficha.lineas.forEach((l, i) => {
        m.texto(rol, l, COL_REMISIONES.x + 2 + x + PAD_FICHA_H, y + PAD_FICHA_V + 2.6 + i * INTERLINEA_FICHA, TAM_FICHA, "embebida", ficha.atrasada ? AMBAR_TEXTO : TINTA);
      });
    }
    y += linea.h + SEPARACION_FICHAS;
  }
  if (conCasilla) {
    m.ops.push({ tipo: "rect", rol: "casilla", x: COL_LISTO.x + (COL_LISTO.w - 5) / 2, y: arriba + PAD_FILA, w: 5, h: 5, relleno: null, borde: GRIS, radio: 0.6 });
  }
  m.y = arriba + alto;
  m.ops.push({ tipo: "linea", x1: MARGEN, y1: m.y, x2: ANCHO - MARGEN, y2: m.y, color: LINEA, grosor: 0.2 });
}

/** R17/R21 — la fila de un producto; si no cabe salta de pagina, y si no cabe en NINGUNA se parte. */
function filaDeProducto(m: Maquetador, g: GrupoPicking, nombreVisible: string, identificadores: Map<string, string>): void {
  const medir: MedirTexto = (t, tam, f) => m.ancho(t, tam, f);
  const fuenteNombre: FuentePdf = g.clave === null ? "helvetica" : "embebida";
  const nombre = partirEnLineas(nombreVisible, COL_PRODUCTO.w - 4, TAM_PRODUCTO, fuenteNombre, medir);
  let restantes = lineasDeFichas(g, identificadores, medir);
  const paginaVacia = LIMITE - Y_INICIO_PAGINA - ALTO_CABECERA_TABLA;
  let primera = true;
  for (;;) {
    const nombreParte = primera ? nombre : partirEnLineas(`${nombreVisible} (continúa)`, COL_PRODUCTO.w - 4, TAM_PRODUCTO, fuenteNombre, medir);
    const altoNombre = nombreParte.length * INTERLINEA_PRODUCTO;
    const altoTodo = Math.max(altoNombre, altoDeFichas(restantes)) + 2 * PAD_FILA;
    if (m.y + altoTodo <= LIMITE) {
      parteDeFila(m, nombreParte, fuenteNombre, primera ? String(g.unidades) : null, restantes, primera);
      return;
    }
    const paginaFresca = m.y <= Y_INICIO_PAGINA + ALTO_CABECERA_TABLA;
    if (altoTodo <= paginaVacia && !paginaFresca) {
      m.nuevaPagina(); // cabe entera en una pagina nueva: no se parte
      continue;
    }
    // Mas alta que una pagina: tantas lineas de fichas como quepan aqui, y el resto «(continúa)».
    let k = 0;
    while (k < restantes.length && m.y + Math.max(altoNombre, altoDeFichas(restantes.slice(0, k + 1))) + 2 * PAD_FILA <= LIMITE) k += 1;
    if (k === 0) {
      if (!paginaFresca) {
        m.nuevaPagina();
        continue;
      }
      k = 1; // en una pagina recien abierta siempre se avanza: el bucle termina
    }
    parteDeFila(m, nombreParte, fuenteNombre, primera ? String(g.unidades) : null, restantes.slice(0, k), primera);
    restantes = restantes.slice(k);
    if (restantes.length === 0) return;
    primera = false;
    m.nuevaPagina();
  }
}

/** R20 — fila de total. */
function filaTotal(m: Maquetador, modelo: ModeloPicking): void {
  m.asegurar(9);
  const arriba = m.y;
  m.ops.push({ tipo: "linea", x1: MARGEN, y1: arriba, x2: ANCHO - MARGEN, y2: arriba, color: TINTA, grosor: 0.4 });
  const base = arriba + 5.5;
  const t = modelo.totales;
  m.texto("total", `${ROTULOS_HELVETICA.totalPrefijo}${plural(t.productos, "producto", "productos")}`, COL_PRODUCTO.x + 2, base, 9, "helvetica-bold");
  m.texto("total", String(t.unidades), COL_UNIDADES.x + COL_UNIDADES.w - 2, base, 10, "helvetica-bold", TINTA, true);
  m.texto("total", `en ${plural(t.ordenes, "orden", "órdenes")}`, COL_REMISIONES.x + 2, base, 9, "helvetica-bold");
  m.y = arriba + 9;
}

function parrafo(m: Maquetador, rol: RolTexto, texto: string, fuente: FuentePdf, color: Rgb): void {
  for (const l of partirEnLineas(texto, UTIL, 7.5, fuente, (t, tam, f) => m.ancho(t, tam, f))) {
    m.asegurar(3.8);
    m.y += 3.8;
    m.texto(rol, l, MARGEN, m.y, 7.5, fuente, color);
  }
}

/** El aviso de R22 (vacio si no se sustituyo nada). */
export function avisoSustitucion(n: number): string {
  if (n === 0) return "";
  return n === 1
    ? "1 carácter que no se puede imprimir se muestra como «?»."
    : `${n} caracteres que no se pueden imprimir se muestran como «?».`;
}

/** La maqueta entera del PDF: paginas con sus operaciones, y los caracteres sustituidos. */
export function maquetarPicking(modelo: ModeloPicking, medir: MedirTexto): MaquetaPicking {
  const s = new Saneador();
  const tienda = s.dato("tienda", modelo.tienda);
  const identificadores = new Map<string, string>();
  for (const g of modelo.grupos) {
    for (const o of g.ordenes) identificadores.set(o.ordenId, s.dato(`orden:${o.ordenId}`, o.identificador));
  }
  const nombres = modelo.grupos.map((g) => (g.clave === null ? ROTULOS_HELVETICA.sinProducto : s.dato(`producto:${g.clave}`, g.nombre)));

  const m = new Maquetador(medir);
  encabezado(m, modelo, tienda);
  if (modelo.atrasadas.length > 0) bloqueAtrasadas(m, modelo, identificadores);

  m.asegurar(ALTO_CABECERA_TABLA + 12);
  m.enTabla = true;
  m.cabeceraTabla();
  modelo.grupos.forEach((g, i) => filaDeProducto(m, g, nombres[i], identificadores));
  filaTotal(m, modelo);
  m.enTabla = false;

  m.y += 2;
  parrafo(
    m,
    "nota",
    "Ordenado de más a menos unidades. «×2» = esa remisión lleva dos unidades del producto. " +
      `Es la foto de las ${horaCRLegible(modelo.ahora)}: lo que entre después sale en el siguiente envío.`,
    "helvetica",
    GRIS,
  );
  if (s.sustituidos > 0) parrafo(m, "aviso-sustitucion", avisoSustitucion(s.sustituidos), "helvetica-bold", AMBAR_TEXTO);

  // R21 — pie en CADA pagina, en una segunda pasada: el total de paginas ya se conoce.
  const total = m.paginas.length;
  const sello = `Ordenex · Picking ${tienda} · ${fechaCortaCR(modelo.ahora)} ${horaCRLegible(modelo.ahora)}`;
  m.paginas.forEach((ops, i) => {
    const pagina = `${ROTULOS_HELVETICA.pagina} ${i + 1} de ${total}`;
    // El sello se recorta al hueco que deja «Página X de Y», que se ve SIEMPRE entero (m2).
    const hueco = UTIL - medir(pagina, 7, "helvetica") - HUECO_PIE;
    ops.push({ tipo: "linea", x1: MARGEN, y1: ALTO - 14, x2: ANCHO - MARGEN, y2: ALTO - 14, color: LINEA, grosor: 0.2 });
    ops.push({
      tipo: "texto",
      rol: "pie",
      texto: recortarAlAncho(sello, hueco, 7, "embebida", medir),
      x: MARGEN,
      y: ALTO - 9,
      tam: 7,
      fuente: "embebida",
      color: GRIS,
    });
    ops.push({
      tipo: "texto",
      rol: "pie-pagina",
      texto: pagina,
      x: ANCHO - MARGEN,
      y: ALTO - 9,
      tam: 7,
      fuente: "helvetica",
      color: GRIS,
      derecha: true,
    });
  });

  return { paginas: m.paginas, sustituidos: s.sustituidos };
}

function fijarFuente(doc: jsPDF, fuente: FuentePdf, tam: number): void {
  if (fuente === "embebida") doc.setFont(fuenteEtiqueta.nombre, fuenteEtiqueta.estilo);
  else doc.setFont("helvetica", fuente === "helvetica-bold" ? "bold" : "normal");
  doc.setFontSize(tam);
}

/** La medida REAL de jsPDF (`getTextWidth` con la misma fuente con que se dibuja). */
export function medidorDe(doc: jsPDF): MedirTexto {
  return (texto, tam, fuente) => {
    fijarFuente(doc, fuente, tam);
    return doc.getTextWidth(texto);
  };
}

/** R16 — el PDF A4 del picking. */
export function pdfDePicking(modelo: ModeloPicking): Uint8Array {
  return renderizarPicking(modelo).bytes;
}

/** El PDF y el numero de paginas de SU maqueta (el humo del test los cruza con el PDF real). */
export function renderizarPicking(modelo: ModeloPicking): { bytes: Uint8Array; paginas: number } {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  registrarFuente(doc, fuenteEtiqueta);
  const medir = medidorDe(doc);
  const maqueta = maquetarPicking(modelo, medir);
  maqueta.paginas.forEach((ops, i) => {
    if (i > 0) doc.addPage("a4", "portrait");
    for (const op of ops) {
      if (op.tipo === "texto") {
        fijarFuente(doc, op.fuente, op.tam);
        doc.setTextColor(op.color[0], op.color[1], op.color[2]);
        doc.text(op.texto, op.x, op.y, op.derecha ? { align: "right" } : undefined);
      } else if (op.tipo === "rect") {
        if (op.relleno !== null) doc.setFillColor(op.relleno[0], op.relleno[1], op.relleno[2]);
        if (op.borde !== null) {
          doc.setDrawColor(op.borde[0], op.borde[1], op.borde[2]);
          doc.setLineWidth(0.25);
        }
        const estilo = op.relleno !== null && op.borde !== null ? "FD" : op.relleno !== null ? "F" : "S";
        if (op.radio > 0) doc.roundedRect(op.x, op.y, op.w, op.h, op.radio, op.radio, estilo);
        else doc.rect(op.x, op.y, op.w, op.h, estilo);
      } else {
        doc.setDrawColor(op.color[0], op.color[1], op.color[2]);
        doc.setLineWidth(op.grosor);
        doc.line(op.x1, op.y1, op.x2, op.y2);
      }
    }
  });
  return { bytes: new Uint8Array(doc.output("arraybuffer")), paginas: maqueta.paginas.length };
}
