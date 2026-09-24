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
import { NOMBRES_RETIRADOS } from "../../fixtures/nombres-retirados-455";

const RAIZ = path.resolve(__dirname, "../../..");


const RETIRADOS = new Set<string>(NOMBRES_RETIRADOS);
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALTERNATIVA = NOMBRES_RETIRADOS.map(escapar).join("|");
const CITADO_EN_CODIGO = new RegExp(`[«"](${ALTERNATIVA})[»"]`);
const CITADO_EN_DOC = new RegExp(`(?:«|\\*\\*|"|\`)(${ALTERNATIVA})(?:»|\\*\\*|"|\`)`);
const ABREVIATURA_BODEGA = /(?<![A-Za-zÁÉÍÓÚáéíóúÑñ])B\.\s/;

/**
 * Excepciones CERRADAS con motivo y numero exacto (no son pendientes: se quedan).
 */
const EXCEPCIONES: Record<string, { maximo: number; motivo: string }> = {
  "lib/types/order-status.ts": {
    maximo: 2,
    motivo:
      "`ESTADO_RETIRADO.nombreHistorico`: el nombre que tenian los estados retirados, que R11 obliga a " +
      "mostrar como «<historico> (estado retirado)» en las filas historicas",
  },
};

/**
 * ⏳ Lo que la FASE 2 tiene que cambiar (T2.1-T2.10). Medido el 2026-09-24 sobre este arbol.
 * La Fase 2 retira cada entrada al corregir su archivo; no puede anadir ninguna.
 */
const PENDIENTES_FASE_2: Record<string, number> = {
  "app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts": 3,
  "app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx": 2,
  "app/(app)/analitica/_components/entregas/HoyGestionBarras.tsx": 1,
  "app/(app)/analitica/_components/entregas/KpisEfectividad.tsx": 2,
  "app/(app)/analitica/_components/entregas/madurez-textos.ts": 1,
  "app/(app)/analitica/_components/operativo/catalogo-paneles.ts": 1,
  "app/(app)/cierres-admin/_components/cierre-factura.tsx": 1,
  "app/(app)/cierres-admin/_components/cierre-labels.ts": 8,
  "app/(app)/mis-asignaciones/recoger/page.tsx": 1,
  "app/(app)/mis-asignaciones/_components/chat/chat-format.ts": 4,
  "app/(app)/mis-asignaciones/_components/chat/ChatOrdenesLista.tsx": 1,
  "app/(app)/mis-asignaciones/_components/KpisMensajero.tsx": 1,
  "app/(app)/mis-asignaciones/_components/pos-card/pos-estado.ts": 9,
  "app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx": 2,
  "app/(app)/mis-asignaciones/_components/RecogerModule.tsx": 2,
  "app/(app)/mis-asignaciones/_components/RepartoModule.tsx": 1,
  "app/(app)/monitoreo/_components/contadores.ts": 5,
  "app/(app)/novedades/_components/novedad-grupo-textos.ts": 1,
  "app/(app)/ordenes/_components/EstatusBadge.tsx": 9,
  "app/(app)/ranking/historico/_components/ranking-historico-labels.ts": 1,
  "app/(app)/ranking/_components/ranking-descarga-columnas.ts": 1,
  "app/(app)/recoleccion/_components/RecoleccionModule.tsx": 1,
  "app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx": 1,
  "lib/analytics/metrics.ts": 1, // T2.6: etiqueta «Sin gestionar» -> «Novedad interna», JUNTO con catalogo-paneles.ts (guardia etiquetas-visibles)
  "lib/auth/menu-visibility.ts": 1, // T2.2 (titulo de menu «Recoger en bodega»)
  "lib/types/rastreo-publico.ts": 12, // T1.9 (BLOQUEO: el DTO del rastreo exige tocar app/_landing/RastreoDialog.tsx)
  "components/shared/nota-pendiente-confirmacion.ts": 1,
  "docs/ayuda/mensajero/recoleccion.md": 2,
  "docs/ayuda/mensajero/reparto.md": 2,
  "docs/ayuda/tienda/novedades.md": 1,
};

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
    return ABREVIATURA_BODEGA.test(l) ? [`${nombre}:${i + 1} B.`] : [];
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

describe("455/G2 — el detector de nombres retirados no esta roto", () => {
  it("no denuncia los nombres VIGENTES que contienen uno retirado, ni la prosa, ni los comentarios", () => {
    const sano = [
      `// aqui decia «Entregada»`,
      `const a = "Devuelta a tienda";`,
      `const b = "Devolviendo a bodega central";`,
      `const c = "la orden fue entregada";`,
      `const d = <p>Por recolectar en tienda</p>;`,
      `const e = "Bodega central";`,
    ].join("\n");
    expect(hallazgosEnCodigo(sano)).toEqual([]);
    expect(hallazgosEnDocumento("La orden quedó entregada. Ver «Devuelta a tienda».")).toEqual([]);
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
    const infractores: string[] = [];
    for (const [archivo, hallazgos] of todos) {
      const permitido = EXCEPCIONES[archivo]?.maximo ?? PENDIENTES_FASE_2[archivo];
      if (permitido !== undefined && hallazgos.length <= permitido) continue;
      infractores.push(...hallazgos);
    }
    expect(
      infractores,
      "un nombre de estado RETIRADO (requirements 455 §0.3) volvio como texto visible. Usa el nombre " +
        "de `NOMBRE_ESTADO` (`nombreDeEstado`) o, si es un grupo/accion, un texto propio (R6).",
    ).toEqual([]);
  });

  it("cada excepcion y cada pendiente sigue haciendo falta, con su numero exacto", () => {
    for (const [archivo, { maximo }] of Object.entries(EXCEPCIONES)) {
      expect(todos.get(archivo)?.length ?? 0, `${archivo}: la excepcion cambio`).toBe(maximo);
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
