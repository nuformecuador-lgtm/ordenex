// Ficha 475 (design §7, R19, R23-R33) — PDF del informe de transito (maquetas `PdfTransito1/2`).
//
// A4 vertical con jsPDF y la FUENTE EMBEBIDA de etiquetas (`fuenteEtiqueta`): las 14 estandar
// (WinAnsi) no tienen `₡` (U+20A1) y jsPDF lo BORRA sin avisar — el defecto que la 282 ya pago en
// las etiquetas (R32). Todo texto de la base pasa por `imprimible`: un caracter que la fuente no
// cubre sale como «?» visible en vez de desaparecer.
//
// Altura de fila FIJA (el texto largo se recorta a una linea con «…»): asi la paginacion es exacta
// y una tabla partida repite su cabecera sin perder ni duplicar filas (R31).
//
// Datos que entran: SOLO los de R26 y los nombres de zona y estado. `FilaTransito` no trae
// telefono, direccion, tienda, mensajero ni producto (R30 por construccion).
import { jsPDF } from "jspdf";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import { cubreCodePoint, registrarFuente } from "@/lib/pdf/etiquetas-fuente-registro";
import { formatMontoString } from "@/lib/config/moneda";
import { sumarMontos } from "@/lib/utils/kpis-financieros";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { fechaCRLegible, horaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import { nombreDeEstado } from "@/lib/types/order-status";
import { HITO_EN_PALABRAS } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type {
  GrupoParados,
  ModeloInformeTransito,
  PaqueteTransito,
  ZonaConAlertas,
} from "@/lib/whatsapp-envios/informes/transito/calculo";

const ANCHO = 210;
const ALTO = 297;
const MARGEN = 12;
const UTIL = ANCHO - 2 * MARGEN;
/** Ultima coordenada en la que puede acabar contenido (el pie vive debajo). */
const LIMITE = ALTO - 18;
const ALTO_FILA = 5.5;
const ALTO_CABECERA = 6;

const TINTA: [number, number, number] = [18, 35, 63];
const GRIS: [number, number, number] = [74, 83, 104];
const ROJO: [number, number, number] = [185, 28, 28];
const AMBAR: [number, number, number] = [146, 64, 14];
const LINEA: [number, number, number] = [227, 232, 242];

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** «Lunes 5 de octubre de 2026», del dia calendario de Costa Rica. */
export function fechaLargaCR(instante: Date): string {
  const [anio, mes, dia] = fechaCalendarioCR(instante).split("-").map((n) => Number.parseInt(n, 10));
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return `${DIAS_SEMANA[semana]} ${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/** Nombre del archivo (R33): `transito-YYYY-MM-DD.pdf` con la fecha CR. */
export function nombreArchivoTransito(ahora: Date): string {
  return `transito-${fechaCalendarioCR(ahora)}.pdf`;
}

/** Sustituye por «?» lo que la fuente embebida no puede imprimir (nunca desaparece en silencio). */
function imprimible(texto: string): string {
  let out = "";
  for (const c of texto.replace(/[\r\n\t]+/g, " ")) {
    const cp = c.codePointAt(0) ?? 0x3f;
    out += cubreCodePoint(fuenteEtiqueta, cp) ? c : "?";
  }
  return out;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

function sinImporte(monto: string | null): boolean {
  return monto === null || sumarMontos([monto]) === "0.00";
}

interface Columna {
  titulo: string;
  ancho: number;
  derecha?: boolean;
}

const COLUMNAS_ZONA: Columna[] = [
  { titulo: "REMISIÓN", ancho: 22 },
  { titulo: "GUÍA", ancho: 14 },
  { titulo: "DÍAS", ancho: 13 },
  { titulo: "ESTADO", ancho: 31 },
  { titulo: "CLIENTE", ancho: 33 },
  { titulo: "CANTÓN · DISTRITO", ancho: 35 },
  { titulo: "POR COBRAR", ancho: 19, derecha: true },
  { titulo: "", ancho: 19 },
];

const COLUMNAS_PARADOS: Columna[] = [
  { titulo: "GUÍA", ancho: 25 },
  { titulo: "ZONA", ancho: 81 },
  { titulo: "DÍAS EN EL ESTADO", ancho: 40, derecha: true },
  { titulo: "DÍAS TOTALES", ancho: 40, derecha: true },
];

class Lienzo {
  readonly doc: jsPDF;
  y = MARGEN;

  constructor() {
    this.doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    registrarFuente(this.doc, fuenteEtiqueta);
    this.doc.setFont(fuenteEtiqueta.nombre, fuenteEtiqueta.estilo);
  }

  estilo(pt: number, color: [number, number, number] = TINTA): void {
    this.doc.setFont(fuenteEtiqueta.nombre, fuenteEtiqueta.estilo);
    this.doc.setFontSize(pt);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  texto(t: string, x: number, y: number, opciones: { derecha?: boolean } = {}): void {
    this.doc.text(imprimible(t), x, y, opciones.derecha ? { align: "right" } : undefined);
  }

  /** Recorta a una linea con «…» para que la altura de fila sea fija. */
  recortado(t: string, ancho: number): string {
    const limpio = imprimible(t);
    if (this.doc.getTextWidth(limpio) <= ancho) return limpio;
    let corte = limpio;
    while (corte.length > 1 && this.doc.getTextWidth(`${corte}…`) > ancho) corte = corte.slice(0, -1);
    return `${corte}…`;
  }

  /** Parrafo envuelto al ancho util; devuelve la altura usada. */
  parrafo(t: string, pt: number, color: [number, number, number] = GRIS, interlinea = 4): void {
    this.estilo(pt, color);
    const lineas = this.doc.splitTextToSize(imprimible(t), UTIL) as string[];
    for (const l of lineas) {
      this.asegurar(interlinea);
      this.doc.text(l, MARGEN, this.y);
      this.y += interlinea;
    }
  }

  nuevaPagina(): void {
    this.doc.addPage("a4", "portrait");
    this.y = MARGEN + 4;
  }

  /** Salta de pagina si `alto` no cabe. Devuelve `true` si salto. */
  asegurar(alto: number): boolean {
    if (this.y + alto <= LIMITE) return false;
    this.nuevaPagina();
    return true;
  }

  linea(y: number, grosor = 0.2, color: [number, number, number] = LINEA): void {
    this.doc.setDrawColor(color[0], color[1], color[2]);
    this.doc.setLineWidth(grosor);
    this.doc.line(MARGEN, y, ANCHO - MARGEN, y);
  }

  cabeceraTabla(columnas: Columna[]): void {
    this.estilo(6.5, GRIS);
    let x = MARGEN;
    const base = this.y + 4;
    for (const c of columnas) {
      if (c.titulo !== "") this.texto(c.titulo, c.derecha ? x + c.ancho - 1 : x + 1, base, { derecha: c.derecha });
      x += c.ancho;
    }
    this.y += ALTO_CABECERA;
    this.linea(this.y, 0.4, TINTA);
  }

  /**
   * Una tabla con cabecera repetida en cada pagina (R31). `celdas` devuelve el texto de cada
   * columna; `extra` dibuja lo que no es texto de celda (las marcas).
   */
  tabla<T>(
    columnas: Columna[],
    filas: readonly T[],
    celdas: (f: T) => string[],
    color: (f: T) => [number, number, number],
    extra?: (f: T, base: number) => void,
  ): void {
    this.cabeceraTabla(columnas);
    for (const f of filas) {
      if (this.asegurar(ALTO_FILA)) this.cabeceraTabla(columnas);
      const base = this.y + 3.8;
      this.estilo(7.5, color(f));
      const textos = celdas(f);
      let x = MARGEN;
      columnas.forEach((c, i) => {
        const t = textos[i] ?? "";
        if (t !== "") {
          const r = this.recortado(t, c.ancho - 2);
          this.doc.text(r, c.derecha ? x + c.ancho - 1 : x + 1, base, c.derecha ? { align: "right" } : undefined);
        }
        x += c.ancho;
      });
      extra?.(f, base);
      this.y += ALTO_FILA;
      this.linea(this.y);
    }
  }
}

function porCobrarCelda(monto: string | null): string {
  return sinImporte(monto) ? "—" : formatMontoString(monto);
}

function cantonDistrito(p: PaqueteTransito): string {
  return p.distrito === null || p.distrito.trim() === "" ? p.canton : `${p.canton} · ${p.distrito}`;
}

function encabezado(l: Lienzo, m: ModeloInformeTransito): void {
  l.estilo(9, GRIS);
  l.texto("Ordenex", MARGEN, 16);
  l.estilo(18);
  l.texto("Informe de tránsito", MARGEN, 24);
  l.estilo(8, GRIS);
  l.texto("Paquetes sin cierre logístico que están por vencer su plazo o ya lo pasaron", MARGEN, 30);
  l.estilo(10);
  l.texto(fechaLargaCR(m.ahora), ANCHO - MARGEN, 16, { derecha: true });
  l.estilo(8, GRIS);
  l.texto(`${horaCRLegible(m.ahora)} · hora de Costa Rica`, ANCHO - MARGEN, 21, { derecha: true });
  l.texto(`Días contados desde ${HITO_EN_PALABRAS[m.hito]}`, ANCHO - MARGEN, 26, { derecha: true });
  l.y = 35;
}

function totales(l: Lienzo, m: ModeloInformeTransito): void {
  const t = m.totales;
  const recuadros: { k: string; v: string; s: string; color: [number, number, number] }[] = [
    { k: "VENCIDOS", v: String(t.vencidos), s: "pasaron su plazo", color: t.vencidos > 0 ? ROJO : TINTA },
    { k: "POR VENCER", v: String(t.porVencer), s: "vencen en los próximos días", color: TINTA },
    { k: "PARADOS", v: String(t.parados), s: "sin moverse de estado", color: t.parados > 0 ? AMBAR : TINTA },
    {
      k: "POR COBRAR",
      v: formatMontoString(t.porCobrar),
      s: `en ${plural(t.enAlerta, "paquete", "paquetes")}`,
      color: TINTA,
    },
  ];
  const separacion = 4;
  const ancho = (UTIL - separacion * 3) / 4;
  recuadros.forEach((r, i) => {
    const x = MARGEN + i * (ancho + separacion);
    l.doc.setDrawColor(LINEA[0], LINEA[1], LINEA[2]);
    l.doc.setLineWidth(0.3);
    l.doc.roundedRect(x, l.y, ancho, 19, 2, 2, "S");
    l.estilo(6.5, GRIS);
    l.texto(r.k, x + 3, l.y + 5);
    l.estilo(15, r.color);
    l.texto(r.v, x + 3, l.y + 12);
    l.estilo(6.5, GRIS);
    l.texto(r.s, x + 3, l.y + 16.5);
  });
  l.y += 26;
}

function bloqueParados(l: Lienzo, grupos: readonly GrupoParados[], total: number): void {
  l.asegurar(8 + ALTO_CABECERA + ALTO_FILA * 2);
  l.estilo(9, AMBAR);
  l.texto(`ATENCIÓN · ${plural(total, "PAQUETE PARADO", "PAQUETES PARADOS")}`, MARGEN, l.y + 3);
  l.y += 6;
  for (const g of grupos) {
    l.asegurar(5 + ALTO_CABECERA + ALTO_FILA);
    l.estilo(8.5);
    l.texto(
      `${nombreDeEstado(g.estado)} · parado si lleva más de ${plural(g.umbral, "día", "días")}`,
      MARGEN,
      l.y + 3.5,
    );
    l.y += 5;
    l.tabla(
      COLUMNAS_PARADOS,
      g.paquetes,
      (p) => [p.numGuia === null ? "—" : String(p.numGuia), p.zonaNombre, String(p.diasEnEstado ?? "—"), String(p.dias)],
      () => TINTA,
    );
    l.y += 2;
  }
  l.y += 4;
}

function tablaZona(l: Lienzo, z: ZonaConAlertas): void {
  l.asegurar(8 + ALTO_CABECERA + ALTO_FILA);
  l.estilo(11);
  l.texto(z.zona.nombre, MARGEN, l.y + 4);
  l.estilo(7.5, GRIS);
  l.texto(
    `Plazo ${plural(z.plazo.plazoDias, "día", "días")} · alerta desde el día ${z.umbral} · ` +
      `${plural(z.paquetes.length, "paquete", "paquetes")} · ${formatMontoString(z.porCobrar)} por cobrar`,
    ANCHO - MARGEN,
    l.y + 4,
    { derecha: true },
  );
  l.y += 7;
  l.tabla(
    COLUMNAS_ZONA,
    z.paquetes,
    (p) => [
      p.numRemision,
      p.numGuia === null ? "—" : String(p.numGuia),
      `${p.dias}/${p.plazoDias}`,
      nombreDeEstado(p.estado),
      p.destinatario,
      cantonDistrito(p),
      porCobrarCelda(p.montoCobrar),
      "",
    ],
    (p) => (p.vencido ? ROJO : TINTA),
    (p, base) => {
      // R27: la marca es TEXTO, ademas del color.
      const xMarca = ANCHO - MARGEN - COLUMNAS_ZONA[COLUMNAS_ZONA.length - 1].ancho + 1;
      let x = xMarca;
      l.estilo(6, ROJO);
      if (p.vencido) {
        l.texto("VENCIDO", x, base);
        x += l.doc.getTextWidth("VENCIDO ");
      }
      if (p.parado) {
        l.estilo(6, AMBAR);
        l.texto("PARADO", x, base);
      }
    },
  );
  l.y += 4;
}

function seccionFuera(l: Lienzo, m: ModeloInformeTransito): void {
  const paquetes = m.fuera.reduce((n, z) => n + z.paquetes.length, 0);
  const porCobrar = sumarMontos(m.fuera.map((z) => z.porCobrar));
  l.asegurar(14 + 8 + ALTO_CABECERA + ALTO_FILA);
  l.estilo(14);
  l.texto("Informe de tránsito · fuera de la GAM", MARGEN, l.y + 5);
  l.estilo(8, GRIS);
  l.texto(
    `${plural(paquetes, "paquete", "paquetes")} en ${plural(m.fuera.length, "zona", "zonas")} · ` +
      `${formatMontoString(porCobrar)} por cobrar`,
    MARGEN,
    l.y + 10,
  );
  l.y += 14;
  for (const z of m.fuera) tablaZona(l, z);
}

function resumenParametros(l: Lienzo, m: ModeloInformeTransito): void {
  l.asegurar(12);
  l.y += 2;
  l.linea(l.y);
  l.y += 5;
  l.estilo(9);
  l.texto("Parámetros de este informe", MARGEN, l.y);
  l.y += 5;
  l.parrafo(`Días contados desde ${HITO_EN_PALABRAS[m.hito]}.`, 7.5);
  for (const z of m.parametrosUsados.zonas) {
    l.parrafo(
      `${z.zona.nombre}: plazo ${plural(z.plazo.plazoDias, "día", "días")} y aviso ` +
        `${plural(z.plazo.avisoDias, "día", "días")} antes (alerta desde el día ${z.umbral}).`,
      7.5,
    );
  }
  const estados = m.parametrosUsados.estados
    .map((e) =>
      e.umbralParado === null
        ? `${nombreDeEstado(e.estado)} (sin umbral de parado)`
        : `${nombreDeEstado(e.estado)} (parado si más de ${plural(e.umbralParado, "día", "días")})`,
    )
    .join("; ");
  l.parrafo(`Estados incluidos: ${estados}.`, 7.5);
  const sin = m.sinHito;
  l.parrafo(
    `${plural(sin, "paquete", "paquetes")} en estos estados ${sin === 1 ? "aún no ha" : "aún no han"} pasado por ` +
      `${HITO_EN_PALABRAS[m.hito]}: no se ${sin === 1 ? "cuenta" : "cuentan"}.`,
    7.5,
  );
}

function pies(l: Lienzo, m: ModeloInformeTransito): void {
  const total = l.doc.getNumberOfPages();
  const sello = `Ordenex · Informe de tránsito · ${fechaCRLegible(m.ahora)} ${horaCRLegible(m.ahora)}`;
  for (let i = 1; i <= total; i++) {
    l.doc.setPage(i);
    l.linea(ALTO - 12);
    l.estilo(7, GRIS);
    l.texto(sello, MARGEN, ALTO - 8);
    l.texto(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 8, { derecha: true });
  }
}

/** El PDF del informe. Con 0 paquetes en alerta, una hoja que lo dice (R19). */
export function pdfInformeTransito(m: ModeloInformeTransito): Uint8Array {
  const l = new Lienzo();
  encabezado(l, m);
  totales(l, m);

  if (m.totales.enAlerta === 0) {
    l.estilo(11);
    l.texto("No hay paquetes en alerta con estos parámetros.", MARGEN, l.y + 4);
    l.y += 10;
  } else {
    if (m.parados.length > 0) bloqueParados(l, m.parados, m.totales.parados);
    if (m.central !== null) tablaZona(l, m.central);
    if (m.fuera.length > 0) {
      // Maqueta: las zonas fuera de la GAM empiezan pagina si ya se dibujo algo antes.
      if (m.central !== null || m.parados.length > 0) l.nuevaPagina();
      seccionFuera(l, m);
    }
  }

  if (m.sinAlertas.length > 0) {
    l.asegurar(8);
    l.parrafo(`Sin paquetes en alerta: ${m.sinAlertas.map((z) => z.nombre).join(" · ")}`, 8, GRIS);
  }
  resumenParametros(l, m);
  pies(l, m);
  return new Uint8Array(l.doc.output("arraybuffer"));
}
