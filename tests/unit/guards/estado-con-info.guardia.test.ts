// GUARDIA — FICHA 456 (T3.1/T3.14, design §6 DH; R18, R19): NINGÚN NOMBRE DE ESTADO SE PINTA SIN SU
// BOTÓN DE INFORMACIÓN.
//
// `components/shared/EstadoInfo.tsx` es el ÚNICO archivo de `app/` y `components/` que pinta en JSX
// un nombre de estado, la señal de pendiente o la nota de ayuda. Esta guardia lo hace cumplir con el
// escáner de TypeScript (AST, así que los comentarios no cuentan) en CUATRO BRAZOS:
//
//   (a) RENDER, sin excepciones: un símbolo vigilado dentro de un hijo JSX (`{nombreDeEstado(x)}`) o
//       en el cuerpo del `render` de una columna, fuera de `EstadoInfo.tsx`.
//   (b) USOS CON MOTIVO: toda referencia a un símbolo vigilado fuera de `EstadoInfo.tsx` está en
//       `USOS_PERMITIDOS` con una de CUATRO clases cerradas y su motivo escrito. Una entrada que ya
//       no hace falta también falla (la lista no engorda en silencio).
//   (c) HERMANO PRESENTE: una excepción `control-con-hermano` tiene que referenciar el botón
//       (`InfoEstado`, `EstadoConInfo`, `LeyendaEstadosConInfo` o `codigoEstado`), en su archivo o en
//       el que declare `hermanoEn`. Una excepción sin su botón es justo el hueco que la 456 cierra.
//   (d) SIN TOOLTIPS A MANO: un archivo que importa un popover o un tooltip Y un símbolo vigilado.
//
// Las clases cerradas (design §6):
//   · `frase`: el nombre va dentro de un texto corrido (errores, avisos, toasts, confirmaciones) o de
//     un nombre accesible (R16);
//   · `descarga`: columnas de CSV/XLSX/PDF (R17);
//   · `recuento`: rótulo de una cifra que agrega varias órdenes o gestiones (design §5.2, R16);
//   · `control-con-hermano`: el nombre vive dentro de un control (fila del chat, opción de filtro,
//     lista `aria-hidden` de una gráfica) o es una línea de texto que no puede partirse, y el botón va
//     como hermano.
//
// Reconciliación R-456-5 (`progress/impl_456.md`): los símbolos vigilados incluyen los ALIAS que dejó
// la 455 (`estatusLabel`, `ORDER_STATUS_LABELS`, `resultadoLabel`, `notaGestionPendiente`,
// `RESULTADO_LABEL`, `RESULTADO_FILA_LABEL`, `etiquetaDeDesenlace`, `chipDeEstado`, `etiquetaEstado`,
// `textoPendienteConfirmacion`, `NOTA_AYUDA_SOLICITADA`, `nombrePublicoDeEstado`): sin ellos, una
// pantalla que pintara `{estatusLabel(x)}` pasaría verde.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE = "components/shared/EstadoInfo.tsx";

export const SIMBOLOS_VIGILADOS: ReadonlySet<string> = new Set([
  // La fuente (lib/types).
  "nombreDeEstado",
  "NOMBRE_ESTADO",
  "nombreDeResultado",
  "SENAL_PENDIENTE",
  "nombrePublicoDeEstado",
  "DESCRIPCION_ESTADO",
  "DESCRIPCION_NOTA_AYUDA",
  "descripcionDeEstado",
  // La nota y la señal (components/shared/nota-pendiente-confirmacion.ts).
  "NOTA_AYUDA_SOLICITADA",
  "textoPendienteConfirmacion",
  // Alias de la 455 en `app/`.
  "estatusLabel",
  "ORDER_STATUS_LABELS",
  "resultadoLabel",
  "notaGestionPendiente",
  "RESULTADO_LABEL",
  "RESULTADO_FILA_LABEL",
  "etiquetaDeDesenlace",
  "chipDeEstado",
  "etiquetaEstado",
  // Helpers de `app/` que DEVUELVEN un nombre de estado (hallazgo 2 de `progress/review_456.md`): el
  // brazo (a) solo ve el símbolo vigilado DIRECTO en el `render`, así que un helper que envuelve
  // `nombreDeEstado` y se llama desde un `render` pasaba verde (medido: el registro de acciones
  // devuelto a su versión previa a la 456 no caía). Vigilado, ese revert cae por el brazo (a).
  "valorLegible",
]);

/** El texto de la nota de ayuda como literal (R12): solo puede escribirse en su módulo. */
const LITERAL_NOTA_AYUDA = "Ayuda solicitada a la tienda";

/** Lo que cuenta como «el botón está» (brazo c). */
const HERMANOS = ["InfoEstado", "InfosEstado", "EstadoConInfo", "LeyendaEstadosConInfo", "SenalPendienteConInfo", "NotaAyudaConInfo", "codigoEstado"];

const MODULOS_TOOLTIP = new Set([
  "@/components/ui/popover",
  "@/components/ui/tooltip",
  "@base-ui/react/popover",
  "@base-ui/react/tooltip",
]);

export type Clase = "frase" | "descarga" | "recuento" | "control-con-hermano";

export interface UsoPermitido {
  clase: Clase;
  motivo: string;
  /** Solo `control-con-hermano`: archivos donde vive el botón hermano, si no es este mismo. */
  hermanoEn?: readonly string[];
}

export interface Analisis {
  /** Referencias a símbolos vigilados (o el literal de la nota), con su línea. */
  referencias: string[];
  /** Brazo (a): usos en render. */
  render: string[];
  /** Referencia a un hermano (brazo c). */
  tieneHermano: boolean;
  /** Importa un popover o un tooltip (brazo d). */
  importaTooltip: boolean;
}

/** El análisis de UNA fuente. Exportado para las mutaciones sintéticas (R19). */
export function analizar(codigo: string, nombre = "fuente.tsx"): Analisis {
  const kind = nombre.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, kind);
  const referencias: string[] = [];
  const render: string[] = [];
  let tieneHermano = false;
  let importaTooltip = false;
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /**
   * ¿El nodo está dentro de un HIJO JSX (no de un atributo) o es la expresión de un `render:`? Se
   * detiene en el cuerpo `{ … }` de una función: lo que se calcula en una sentencia (una constante,
   * un título) no se PINTA ahí; si luego se pinta, esa referencia la cubre el brazo (b), con su clase.
   */
  function enRender(n: ts.Node): boolean {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isBlock(p)) return false;
      if (ts.isJsxExpression(p)) {
        if (p.parent && ts.isJsxAttribute(p.parent)) return false;
        return true;
      }
      if (ts.isJsxAttribute(p)) return false;
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "render") return true;
    }
    return false;
  }

  function dentroDeImport(n: ts.Node): boolean {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p)) return true;
    }
    return false;
  }

  function visitar(n: ts.Node) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (MODULOS_TOOLTIP.has(n.moduleSpecifier.text)) importaTooltip = true;
    }
    if (ts.isIdentifier(n)) {
      // Un IMPORT no es un botón: el hermano cuenta solo si se USA (medido: con el `<InfoEstado>`
      // borrado de la fila del chat y su import intacto, la guardia seguía verde).
      if (HERMANOS.includes(n.text) && !dentroDeImport(n)) tieneHermano = true;
      if (SIMBOLOS_VIGILADOS.has(n.text)) {
        referencias.push(`${linea(n)}:${n.text}`);
        if (enRender(n)) render.push(`${linea(n)}:${n.text}`);
      }
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(LITERAL_NOTA_AYUDA)) {
      referencias.push(`${linea(n)}:«${LITERAL_NOTA_AYUDA}»`);
      if (enRender(n)) render.push(`${linea(n)}:«${LITERAL_NOTA_AYUDA}»`);
    }
    if (ts.isJsxText(n) && n.text.includes(LITERAL_NOTA_AYUDA)) {
      referencias.push(`${linea(n)}:«${LITERAL_NOTA_AYUDA}»`);
      render.push(`${linea(n)}:«${LITERAL_NOTA_AYUDA}»`);
    }
    ts.forEachChild(n, visitar);
  }
  visitar(sf);
  return { referencias, render, tieneHermano, importaTooltip };
}

// ─── Las excepciones, archivo por archivo (T3.14: solo las cuatro clases, con su motivo) ─────────

const F = "frase" as const;
const D = "descarga" as const;
const R = "recuento" as const;
const H = "control-con-hermano" as const;

export const USOS_PERMITIDOS: Readonly<Record<string, UsoPermitido>> = {
  // ── Frases: el nombre dentro de un texto corrido o de un nombre accesible (R16) ──
  "components/shared/nota-pendiente-confirmacion.ts": { clase: F, motivo: "DEFINE la señal y la nota; las pinta `EstadoInfo.tsx` (y las frases que las citan)" },
  "app/(app)/ordenes/_components/estatus-label.ts": { clase: F, motivo: "DEFINE los alias `estatusLabel`/`resultadoLabel`/`notaGestionPendiente` (455) que usan los mensajes de error" },
  "app/(app)/ordenes/_components/corregir-dia-reparto-error-messages.ts": { clase: F, motivo: "mensaje de error que nombra el estado" },
  "app/(app)/ordenes/_components/corregir-fecha-reprogramacion-textos.ts": { clase: F, motivo: "mensaje de error que nombra el estado" },
  "app/(app)/ordenes/_components/deshacer-asignacion-error-messages.ts": { clase: F, motivo: "mensaje de error que nombra el estado" },
  "app/(app)/ordenes/_components/envio-devolucion-central-error-messages.ts": { clase: F, motivo: "mensaje de error que nombra el estado" },
  "app/(app)/ordenes/_components/traspaso-error-messages.ts": { clase: F, motivo: "mensaje de error que nombra el estado" },
  "app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx": { clase: F, motivo: "toast del escáner («No se puede recibir: la orden está en …»)" },
  "app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx": { clase: F, motivo: "toast del escáner («No se puede recibir: la orden está en …»)" },
  "app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx": { clase: F, motivo: "toast del escáner («No se puede recibir: la orden está en …»)" },
  "app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts": { clase: F, motivo: "mensaje de error de la recogida por guía" },
  "app/(app)/recoleccion/_components/useRecolectarPorGuia.ts": { clase: F, motivo: "toast de la recolección por guía" },
  "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx": { clase: F, motivo: "toast tras registrar la gestión (`GestionarOrdenPanel.tsx:786`, design §5.2); la cabecera usa `EstadoConInfo`" },
  "app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx": { clase: F, motivo: "texto de ayuda del diálogo («La orden sigue «En reparto» hasta entonces…»)" },
  "app/(app)/ordenes/_components/RecuperarABodegaModal.tsx": { clase: F, motivo: "descripción del modal de confirmación" },
  "app/(app)/novedades/_components/RechazarNovedadModal.tsx": { clase: F, motivo: "textos del modal de rechazo (frases con el nombre)" },
  "app/(app)/novedades/_components/RechazosSlaModule.tsx": { clase: F, motivo: "texto del vacío de la pestaña (frase)" },
  "app/(app)/ordenes/_components/motivo-historial.ts": { clase: F, motivo: "motivo de la migración de retiro, en prosa («Migración: retiro de …»)" },
  "app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts": { clase: F, motivo: "`etiquetaEstado`: el estado común de la selección y el aviso de estados fuera del listado, dentro de frases de `SateliteOrdenesListado`" },
  "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx": { clase: F, motivo: "«N seleccionada(s) · <estado>» y el aviso de estados fuera del listado (`role=status`, frases)" },
  "app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx": { clase: F, motivo: "aviso «… Resultado: <nombre>.» y nombres accesibles de sección; el título «<nombre> (N)» es recuento y cada fila lleva `EstadoConInfo`" },
  "app/(app)/analitica/_components/entregas/ProductosTabla.tsx": { clase: F, motivo: "texto de ayuda de la composición («Cada orden cuenta en un solo grupo: …»)" },
  "app/(app)/analitica/_components/entregas/otros-resultados.ts": { clase: F, motivo: "composición de «Otros resultados» en prosa" },
  "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx": { clase: F, motivo: "pista del retorno en prosa («Flete por rechazo + IVA de las órdenes en …»); la lista de desenlaces usa `EstadoConInfo`" },
  "app/(app)/analitica/_components/entregas/etiqueta-desenlace.ts": { clase: F, motivo: "DEFINE `etiquetaDeDesenlace` (alias), que usan las categorías de la barra (con leyenda propia) y la prosa" },
  "app/(app)/cierres-admin/_components/cierre-factura.tsx": { clase: F, motivo: "títulos y avisos de la sección de barridas («Pasaron a Novedad interna», «Al aprobar el cierre… «Por devolver a tienda»»); el origen de cada fila usa `EstadoConInfo` y las pestañas son recuento" },
  // ── Descargas (R17) ──
  "app/(app)/ordenes/_components/ordenes-descarga-columnas.ts": { clase: D, motivo: "columna «Estado» de la descarga de órdenes" },
  "app/(app)/recepcion-satelite/_components/satelite-descarga-columnas.ts": { clase: D, motivo: "columna «Estado» de la descarga de la bodega satélite" },
  "app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts": { clase: D, motivo: "encabezados de la descarga de productos" },
  "app/(app)/ranking/_components/ranking-descarga-columnas.ts": { clase: D, motivo: "encabezado de la descarga del ranking" },
  "app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts": { clase: D, motivo: "celda «Resultado» de la hoja fundida de gestiones" },
  "app/(app)/historico/acciones/_components/historial-acciones-columnas.ts": { clase: D, motivo: "DEFINE `valorLegible`, que da el nombre del resultado a la descarga del registro; en pantalla `celdaValor` pinta el resultado con `EstadoConInfo` y solo llama a `valorLegible` para las acciones que NO guardan un resultado. Lo comprueban `tests/components/HistorialAccionesValorInfo.test.tsx` (botón en pantalla, nombre en la descarga) y el caso «la excepción `descarga` del registro de acciones» de esta guardia" },
  "app/(app)/historico/acciones/_components/historial-acciones-descarga-columnas.ts": { clase: D, motivo: "celdas «Valor anterior/nuevo» de la descarga del registro (`valorLegible`)" },
  // ── Recuentos (design §5.2) ──
  "app/(app)/monitoreo/_components/contadores.ts": { clase: R, motivo: "contadores del tablero del día (resultados y cubos)" },
  "app/(app)/cierres-admin/_components/cierre-labels.ts": { clase: R, motivo: "`RESULTADO_LABEL`: pestañas con cifra del cierre, títulos «<nombre> (N)» y textos vacíos" },
  "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx": { clase: R, motivo: "título «<nombre> (N)» de cada sección y su nombre accesible; el botón va junto al título (`InfoEstado`)" },
  "app/(app)/cierre-dia/_components/CierreDiaModule.tsx": { clase: R, motivo: "título «<nombre> (N)» de cada sección del cierre del mensajero, su nombre accesible y el de la descarga; el botón va junto al título (`InfoEstado`)" },
  "app/(app)/mis-asignaciones/_components/KpisMensajero.tsx": { clase: R, motivo: "KPI del periodo" },
  "app/(app)/analitica/_components/entregas/desenlaces-de-fila.ts": { clase: R, motivo: "frase «Entregado: 4 · …» de la columna «En qué terminaron» de `ProductosTabla`: cada trozo es un nombre con la cifra de órdenes del producto que acabaron así (agrega varias órdenes). No tiene botón al lado: el `InfosEstado` de `DineroProductoDetalle` es de OTRA lista (hallazgo 3 de `progress/review_456.md`)" },
  "app/(app)/analitica/_components/entregas/KpisEfectividad.tsx": { clase: R, motivo: "KPI del periodo y su ayuda" },
  "app/(app)/analitica/_components/entregas/madurez-textos.ts": { clase: R, motivo: "KPI del periodo y sus textos" },
  "app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx": { clase: R, motivo: "encabezados de columnas numéricas de la tabla de cohortes" },
  "app/(app)/ranking/historico/_components/ranking-historico-labels.ts": { clase: R, motivo: "encabezado de columna numérica del histórico del ranking" },
  // ── Control con hermano ──
  "app/(app)/ordenes/_components/filtro-estado-def.ts": { clase: H, motivo: "etiqueta de cada opción del filtro de estado (dentro del `<button role=option>`); el botón lo pinta `MultiSelectFilter` por `codigoEstado`" },
  "app/(app)/ordenes/_components/EstatusBadge.tsx": { clase: H, motivo: "reexporta `ORDER_STATUS_LABELS` (455); el chip se pinta con `EstadoConInfo`" },
  "app/(app)/mis-asignaciones/_components/chat/chat-format.ts": { clase: H, motivo: "texto del chip de la fila del chat, DENTRO del `<button>` de la fila (su nombre accesible)", hermanoEn: ["app/(app)/mis-asignaciones/_components/chat/ChatOrdenesLista.tsx"] },
  "app/(app)/mis-asignaciones/_components/chat/ChatOrdenesLista.tsx": { clase: H, motivo: "el chip va dentro del `<button>` de la fila; el botón de información es su hermano (design §4.3)" },
  "app/(app)/mis-asignaciones/_components/chat/ChatConversacion.tsx": { clase: H, motivo: "usa `chipDeEstado` solo por su color; el nombre lo pinta `EstadoConInfo`" },
  "app/(app)/analitica/_components/entregas/ConteoPorStatusDona.tsx": { clase: H, motivo: "categorías de `GraficaRanking` (lista `aria-hidden`); leyenda propia debajo (design §5.1 fila 16)" },
  "app/(app)/analitica/_components/entregas/ConteoEntregasAnillo.tsx": { clase: H, motivo: "categorías de `GraficaReparto` (leyenda `aria-hidden`); leyenda propia debajo (fila 17)" },
  "app/(app)/wallet/_components/detalle-movimiento-labels.ts": { clase: H, motivo: "`resultadosTexto`: la línea «Entregado · Reprogramado» de cada orden del movimiento (también la descarga); la pantalla pone los botones a su lado", hermanoEn: ["app/(app)/wallet/_components/DetalleMovimientoCierre.tsx"] },
  "app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts": { clase: H, motivo: "`resultadosTexto`: la línea de resultados de cada orden del movimiento (también la descarga); la pantalla pone los botones a su lado", hermanoEn: ["app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx"] },
  "app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx": { clase: H, motivo: "«Resultado: X» / «De A a B» es una línea de texto: los botones van al final de la línea, uno por resultado" },
  "app/_landing/RastreoDialog.tsx": { clase: H, motivo: "el texto de una entrada de nombre no reconocido (R15) se pinta tal cual; las demás van con `EstadoConInfo`/`SenalPendienteConInfo`" },
};

// ─── El recorrido del árbol ───────────────────────────────────────────────────────────────────────

function listar(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const completo = path.join(dir, e);
    if (statSync(completo).isDirectory()) listar(completo, acc);
    else if (/\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) acc.push(completo);
  }
  return acc;
}

const rel = (abs: string) => path.relative(RAIZ, abs).split(path.sep).join("/");
const ARCHIVOS = [...listar(path.join(RAIZ, "app")), ...listar(path.join(RAIZ, "components"))].map(rel);
const ARCHIVOS_TEST = new Set(listar(path.join(RAIZ, "tests", "components")).map(rel));
const ANALISIS = new Map(ARCHIVOS.map((f) => [f, analizar(readFileSync(path.join(RAIZ, f), "utf8"), f)] as const));

/** Todos los hallazgos del árbol con una tabla de excepciones dada (para el test y el informe). */
export function hallazgos(
  analisis: ReadonlyMap<string, Analisis>,
  permitidos: Readonly<Record<string, UsoPermitido>>,
): { a: string[]; b: string[]; c: string[]; d: string[]; caducas: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  const c: string[] = [];
  const d: string[] = [];
  const caducas: string[] = [];
  for (const [f, an] of analisis) {
    if (f === FUENTE) continue;
    for (const r of an.render) a.push(`${f}:${r}`);
    if (an.referencias.length > 0 && !permitidos[f]) b.push(`${f} (${an.referencias.join(", ")})`);
    if (an.importaTooltip && an.referencias.length > 0) d.push(f);
  }
  for (const [f, uso] of Object.entries(permitidos)) {
    const an = analisis.get(f);
    if (!an || an.referencias.length === 0) caducas.push(f);
    if (uso.clase === "control-con-hermano") {
      const donde = uso.hermanoEn ?? [f];
      if (!donde.some((x) => analisis.get(x)?.tieneHermano)) c.push(f);
    }
    if (!uso.motivo.trim()) caducas.push(`${f} (sin motivo)`);
  }
  return { a, b, c, d, caducas };
}

// ─── Los tests ────────────────────────────────────────────────────────────────────────────────────

describe("456 · guardia — ningún nombre de estado sin su botón de información (R18)", () => {
  const h = hallazgos(ANALISIS, USOS_PERMITIDOS);

  it("(a) ningún símbolo vigilado se PINTA fuera de `EstadoInfo.tsx` (hijo JSX o `render` de columna)", () => {
    expect(h.a, "pinta el nombre sin el componente compartido: usa `EstadoConInfo`/`InfoEstado`").toEqual([]);
  });

  it("(b) toda otra referencia está en `USOS_PERMITIDOS` con clase y motivo", () => {
    expect(h.b, "usa un nombre de estado sin excepción declarada (clasifícalo o pinta con `EstadoConInfo`)").toEqual([]);
  });

  it("(b) ninguna excepción sobra: cada archivo listado sigue referenciando un símbolo vigilado", () => {
    expect(h.caducas).toEqual([]);
  });

  it("(c) cada excepción `control-con-hermano` tiene su botón hermano", () => {
    expect(h.c, "excepción sin su botón de información").toEqual([]);
  });

  it("(d) nadie arma un tooltip o popover propio junto a un nombre de estado", () => {
    expect(h.d).toEqual([]);
  });

  it("la excepción `descarga` del registro de acciones: su motivo se cumple (la pantalla pinta con el botón)", () => {
    // Hallazgo 2: el motivo decía «la celda de pantalla usa `EstadoConInfo`» y nada lo comprobaba.
    // Se exige que el archivo USE el botón (no solo lo importe) y que exista el test de componente
    // que fija la celda con botón y la descarga con el nombre.
    const f = "app/(app)/historico/acciones/_components/historial-acciones-columnas.ts";
    expect(USOS_PERMITIDOS[f]?.clase).toBe("descarga");
    expect(ANALISIS.get(f)?.tieneHermano, "la celda de pantalla ya no usa `EstadoConInfo`").toBe(true);
    expect(ARCHIVOS_TEST.has("tests/components/HistorialAccionesValorInfo.test.tsx")).toBe(true);
  });

  it("las clases son las cuatro cerradas de design §6", () => {
    for (const uso of Object.values(USOS_PERMITIDOS)) {
      expect(["frase", "descarga", "recuento", "control-con-hermano"]).toContain(uso.clase);
    }
  });

  it("ANTI-VACÍO: leyó al menos un archivo de cada superficie de design §5, y la fuente sí pinta", () => {
    const rutas = [
      "app/(app)/ordenes/",
      "app/(app)/monitoreo/",
      "app/(app)/incidentes/",
      "app/(app)/cierres-admin/",
      "app/(app)/recepcion-satelite/",
      "app/(app)/mis-asignaciones/",
      "app/(app)/novedades/",
      "app/(app)/analitica/",
      "app/_landing/",
      "components/shared/",
    ];
    for (const r of rutas) expect(ARCHIVOS.some((f) => f.startsWith(r)), r).toBe(true);
    const fuente = ANALISIS.get(FUENTE);
    expect(fuente?.render.length ?? 0).toBeGreaterThan(0);
    expect(ARCHIVOS.length).toBeGreaterThan(500);
  });
});

describe("456 · guardia — las mutaciones sintéticas (R19)", () => {
  const mapa = (codigo: string, f: string) => new Map([[f, analizar(codigo, f)]] as const);

  it("1 · `<span>{nombreDeEstado(x)}</span>` en una pantalla → brazo (a)", () => {
    const f = "app/(app)/x/Pantalla.tsx";
    const h = hallazgos(mapa(`import { nombreDeEstado } from "@/lib/types/order-status";\nexport const P = ({ x }: { x: string }) => <span>{nombreDeEstado(x)}</span>;`, f), { [f]: { clase: "frase", motivo: "m" } });
    expect(h.a).toHaveLength(1);
  });

  it("2 · `render: (o) => estatusLabel(o.estatus)` en una columna → brazo (a)", () => {
    const f = "app/(app)/x/columnas.ts";
    const h = hallazgos(mapa(`import { estatusLabel } from "./estatus-label";\nexport const c = [{ id: "e", render: (o: { estatus: string }) => estatusLabel(o.estatus) }];`, f), { [f]: { clase: "descarga", motivo: "m" } });
    expect(h.a).toHaveLength(1);
  });

  it("3 · un uso en una ruta NO permitida → brazo (b)", () => {
    const f = "app/(app)/x/mensajes.ts";
    const h = hallazgos(mapa(`import { nombreDeEstado } from "@/lib/types/order-status";\nexport const m = (v: string) => "Está en " + nombreDeEstado(v);`, f), {});
    expect(h.b).toHaveLength(1);
  });

  it("4 · una excepción `control-con-hermano` SIN su botón → brazo (c)", () => {
    const f = "app/(app)/x/filtro.ts";
    const h = hallazgos(mapa(`import { estatusLabel } from "./estatus-label";\nexport const o = (v: string) => ({ value: v, label: estatusLabel(v) });`, f), { [f]: { clase: "control-con-hermano", motivo: "m" } });
    expect(h.c).toEqual([f]);
  });

  it("4b · una excepción `control-con-hermano` que IMPORTA el botón pero no lo usa → brazo (c)", () => {
    const f = "app/(app)/x/Fila.tsx";
    const h = hallazgos(
      mapa(`import { InfoEstado } from "@/components/shared/EstadoInfo";\nimport { chipDeEstado } from "./c";\nexport const F = ({ v }: { v: string }) => { const c = chipDeEstado(v); return <button>{c.label}</button>; };`, f),
      { [f]: { clase: "control-con-hermano", motivo: "m" } },
    );
    expect(h.c).toEqual([f]);
  });

  it("5 · `EstadoInfo.tsx` pinta y NO se marca", () => {
    const h = hallazgos(mapa(`import { nombreDeEstado } from "@/lib/types/order-status";\nexport const E = ({ c }: { c: string }) => <span>{nombreDeEstado(c)}</span>;`, FUENTE), {});
    expect(h).toEqual({ a: [], b: [], c: [], d: [], caducas: [] });
  });

  it("(extra) el literal de la nota escrito en JSX → brazo (a); un popover propio → brazo (d)", () => {
    const f = "app/(app)/x/Nota.tsx";
    const h1 = hallazgos(mapa(`export const N = () => <span>Ayuda solicitada a la tienda</span>;`, f), { [f]: { clase: "frase", motivo: "m" } });
    expect(h1.a).toHaveLength(1);
    const h2 = hallazgos(mapa(`import { Popover } from "@/components/ui/popover";\nimport { estatusLabel } from "./e";\nexport const t = (v: string) => estatusLabel(v);\nvoid Popover;`, f), { [f]: { clase: "frase", motivo: "m" } });
    expect(h2.d).toEqual([f]);
  });

  it("(extra) un helper vigilado (`valorLegible`) llamado desde el `render` de una columna → brazo (a)", () => {
    // La mutación X2 del revisor, en sintético: la versión previa a la 456 del registro de acciones.
    const f = "app/(app)/x/registro-columnas.ts";
    const h = hallazgos(
      mapa(`import { valorLegible } from "./v";\nexport const c = [{ id: "anterior", render: (o: { a: string; v: string | null }) => valorLegible(o.a, o.v) ?? "—" }];`, f),
      { [f]: { clase: "descarga", motivo: "m" } },
    );
    expect(h.a).toHaveLength(1);
  });

  it("(extra) un nombre en un ATRIBUTO (nombre accesible) no es render (R16)", () => {
    const f = "app/(app)/x/Aria.tsx";
    const h = hallazgos(mapa(`import { estatusLabel } from "./e";\nexport const A = ({ v }: { v: string }) => <section aria-label={estatusLabel(v)} />;`, f), { [f]: { clase: "frase", motivo: "m" } });
    expect(h.a).toEqual([]);
  });
});
