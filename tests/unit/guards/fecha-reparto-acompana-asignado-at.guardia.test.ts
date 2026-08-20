import fs from "fs";
import path from "path";

import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNÉS — `fecha_reparto` SE ESCRIBE Y SE LIMPIA SIEMPRE CON `asignado_at`.
//
// LA INVARIANTE, DICHA COMO UNA SOLA REGLA (feature 246, R10):
//
//   > El día de reparto sólo tiene valor mientras la orden tenga mensajero asignado. Se escribe
//   > SIEMPRE en la misma escritura que fija `asignado_at`, y se limpia SIEMPRE en la misma
//   > escritura que lo limpia.
//
// ⚠️ POR QUÉ HACE FALTA UNA GUARDIA Y NO BASTA CON «acordarse». La feature 235 pagó exactamente
// este defecto: una marca persistida (`orden.ayuda`) con N sitios de limpieza y NINGUNO que rompa
// el build cuando se olvida uno. El resultado fue una fuga permanente en `/novedades`. `fecha_reparto`
// tiene la misma forma —una columna que acompaña a otra— y hoy son SEIS los sitios que limpian
// `asignado_at`. Una lista que haya que recordar es una lista que un día se olvida; un censo del
// árbol no se olvida.
//
// QUÉ CENSA, EXACTAMENTE. Recorre `lib/` entero buscando escrituras sobre `asignadoAt` /
// `asignado_at` —tanto en `data: { ... }` de Prisma como en `SET` de SQL crudo— y exige que la
// MISMA escritura toque `fechaReparto` / `fecha_reparto`. No mira una lista de archivos conocidos:
// un sitio NUEVO que escriba `asignado_at` entra solo en el censo. Ése es el punto.
//
// ⚠️ AVISO PARA OTRAS FICHAS EN VUELO (la 240, `rechazo manual de la tienda`): si tu arista limpia
// la asignación (`mensajero_asignado_id` / `asignado_at`), esta guardia se pondrá ROJA hasta que
// limpies también `fecha_reparto`. Eso es la guardia haciendo su trabajo, no un fallo tuyo.
//
// POR QUÉ SE LEE DEL FUENTE Y NO SE IMPORTA NADA. No hay ninguna constante que importar: lo que se
// vigila es la FORMA de un objeto literal repartido por seis archivos. Y el censo se escribe en un
// archivo de test, NUNCA por `node -e`: ahí `\b` llega como backspace y el censo miente en verde.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LIB = path.join(REPO_ROOT, "lib");

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia fecha-reparto-acompana-asignado-at: ${que}. La guardia NO pudo leer lo que vigila; ` +
      `se detiene en ROJO en vez de dar por buena una lectura vacía. Si el código se reorganizó, ` +
      `actualiza la extracción — no borres la comprobación.`,
  );
}

/** Todos los `.ts` bajo `lib/`, recursivo. */
function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...archivosTs(ruta));
    else if (entrada.name.endsWith(".ts")) out.push(ruta);
  }
  return out;
}

/**
 * Una ESCRITURA sobre la orden: el trozo de código que la contiene, ya sin comentarios.
 *
 * Se extrae por delimitadores equilibrados —llaves para un `data: { ... }` de Prisma, y de
 * `SET` hasta `WHERE` para un `UPDATE` crudo— y no por «N líneas alrededor»: una ventana de
 * líneas se puede colar en la escritura de al lado y dar por buena una limpieza que está en otro
 * sitio.
 */
interface Escritura {
  archivo: string;
  clase: "prisma-data" | "sql-set";
  texto: string;
}

/** Del `{` en `desde` hasta su `}` pareja. `null` si no cierra (código truncado o raro). */
function bloqueLlaves(fuente: string, desde: number): string | null {
  const abre = fuente.indexOf("{", desde);
  if (abre === -1) return null;
  let nivel = 0;
  for (let i = abre; i < fuente.length; i += 1) {
    const c = fuente[i];
    if (c === "{") nivel += 1;
    else if (c === "}") {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(abre, i + 1);
    }
  }
  return null;
}

/**
 * Escrituras de Prisma: `data: { ... asignadoAt ... }`. Se busca cada `data:` y se comprueba si su
 * bloque menciona `asignadoAt`; así el bloque devuelto es EXACTAMENTE el de esa escritura.
 */
function escriturasPrisma(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bdata\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const bloque = bloqueLlaves(codigo, m.index);
    if (bloque === null) continue;
    if (/\basignadoAt\b/.test(bloque)) out.push({ archivo, clase: "prisma-data", texto: bloque });
  }
  return out;
}

/**
 * Escrituras en SQL crudo: del `SET` hasta el `WHERE` (o `RETURNING`) de ese mismo `UPDATE`.
 * Sólo cuentan las que ASIGNAN `asignado_at` (`"asignado_at" =`), no las que lo leen.
 */
function escriturasSql(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bSET\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const resto = codigo.slice(m.index);
    const fin = resto.search(/\bWHERE\b|\bRETURNING\b/);
    const set = fin === -1 ? resto.slice(0, 600) : resto.slice(0, fin);
    if (/"asignado_at"\s*=/.test(set)) out.push({ archivo, clase: "sql-set", texto: set });
  }
  return out;
}

/** ¿Esta escritura toca el día de reparto, de la forma que sea? */
function tocaFechaReparto(texto: string): boolean {
  return /\bfechaReparto\b/.test(texto) || /"fecha_reparto"/.test(texto);
}

const ESCRITURAS: Escritura[] = (() => {
  if (!fs.existsSync(LIB)) reventar("no existe el directorio `lib/`");
  const archivos = archivosTs(LIB);
  if (archivos.length === 0) reventar("no se encontró ni un `.ts` bajo `lib/`");
  const out: Escritura[] = [];
  for (const ruta of archivos) {
    const codigo = quitarComentarios(fs.readFileSync(ruta, "utf8"));
    const rel = path.relative(REPO_ROOT, ruta).replace(/\\/g, "/");
    out.push(...escriturasPrisma(rel, codigo), ...escriturasSql(rel, codigo));
  }
  return out;
})();

describe("guardia · el día de reparto acompaña SIEMPRE a `asignado_at` (246/R10)", () => {
  it("la guardia encuentra escrituras que vigilar (si no, todo lo demás mentiría en verde)", () => {
    // Un censo vacío pasa todos los `every` del mundo. Esta cota es lo que impide que un refactor
    // que mueva las escrituras deje la guardia verde y muda.
    if (ESCRITURAS.length === 0) reventar("el censo no encontró ni una escritura de `asignado_at`");
    // Hoy son SEIS limpiezas + tres estampados (bodega, satélite, deshacer gestión) + el de
    // `generarGuiaLote`. La cota es holgada a propósito: lo que se afirma es «hay censo», no un
    // número exacto que un refactor legítimo tendría que venir a actualizar.
    expect(ESCRITURAS.length).toBeGreaterThanOrEqual(6);
  });

  it("TODA escritura que fija o limpia `asignado_at` toca también `fecha_reparto`", () => {
    const infractoras = ESCRITURAS.filter((e) => !tocaFechaReparto(e.texto));
    const detalle = infractoras
      .map((e) => `  · ${e.archivo} (${e.clase}):\n    ${e.texto.replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n");
    expect(
      infractoras,
      `Estas escrituras tocan \`asignado_at\` y NO tocan \`fecha_reparto\`:\n${detalle}\n\n` +
        `La invariante (246/R10) es que el día de reparto sólo tiene valor mientras la orden ` +
        `tenga mensajero. Si esta escritura FIJA la asignación, tiene que fijar también el día; ` +
        `si la LIMPIA, tiene que limpiarlo. En la misma escritura, no en una segunda pasada.`,
    ).toEqual([]);
  });

  it("una escritura que limpia `asignado_at` limpia el día a NULL, no lo deja con valor", () => {
    // La mitad negativa de la invariante: limpiar el mensajero y dejar una reserva viva sería una
    // reserva HUÉRFANA, y el corte tendría que decidir qué hacer con ella.
    const limpiezas = ESCRITURAS.filter((e) =>
      e.clase === "prisma-data"
        ? /\basignadoAt\s*:\s*null\b/.test(e.texto)
        : /"asignado_at"\s*=\s*NULL/i.test(e.texto),
    );
    if (limpiezas.length === 0) reventar("el censo no encontró ni una LIMPIEZA de `asignado_at`");
    for (const e of limpiezas) {
      const limpiaElDia =
        e.clase === "prisma-data"
          ? /\bfechaReparto\s*:\s*null\b/.test(e.texto)
          : /"fecha_reparto"\s*=\s*NULL/i.test(e.texto);
      expect(
        limpiaElDia,
        `${e.archivo} limpia \`asignado_at\` pero no pone \`fecha_reparto\` a NULL`,
      ).toBe(true);
    }
  });

  it("R17: ninguna escritura del día de reparto hace aritmética de zona horaria en el SQL", () => {
    // La única definición del día vive en `lib/utils/fecha-cr.ts` y entra a las consultas como
    // PARÁMETRO. Un `NOW()::date` o un `interval '6 hours'` aquí sería una segunda definición del
    // día, en el peor sitio posible: dentro de una sentencia, donde nadie la busca.
    const conDia = ESCRITURAS.filter((e) => e.clase === "sql-set" && tocaFechaReparto(e.texto));
    if (conDia.length === 0) reventar("el censo no encontró ninguna escritura SQL del día");
    for (const e of conDia) {
      expect(e.texto, `${e.archivo}: el SET usa NOW()::date`).not.toMatch(/NOW\(\)\s*::\s*date/i);
      expect(e.texto, `${e.archivo}: el SET usa CURRENT_DATE`).not.toMatch(/CURRENT_DATE/i);
      expect(e.texto, `${e.archivo}: el SET usa AT TIME ZONE`).not.toMatch(/AT TIME ZONE/i);
      expect(e.texto, `${e.archivo}: el SET nombra la zona de CR`).not.toMatch(
        /America\/Costa_Rica/,
      );
      expect(e.texto, `${e.archivo}: el SET usa un interval`).not.toMatch(/interval\s+'/i);
    }
  });
});

describe("guardia · autocomprobación (el censo detecta lo que dice detectar)", () => {
  it("caza un `data` de Prisma que fija `asignadoAt` sin el día", () => {
    const fuente = `
      await tx.orden.updateMany({
        where: { id },
        data: { estatusId, mensajeroAsignadoId: m, asignadoAt: new Date() },
      });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false);
  });

  it("da por buena la misma escritura cuando SÍ lleva el día", () => {
    const fuente = `
      await tx.orden.updateMany({
        where: { id },
        data: { estatusId, mensajeroAsignadoId: m, asignadoAt: new Date(), fechaReparto },
      });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(true);
  });

  it("caza un `SET` de SQL crudo que limpia `asignado_at` sin el día", () => {
    const fuente = `
      const rows = await tx.$queryRaw\`
        UPDATE "orden"
        SET "mensajero_asignado_id" = NULL,
            "asignado_at" = NULL,
            "updated_at" = NOW()
        WHERE "id" = \${id}
        RETURNING "id"\`;
    `;
    const encontradas = escriturasSql("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false);
  });

  it("el bloque extraído NO se desborda a la escritura de al lado", () => {
    // Si el censo cogiera «N líneas alrededor» en vez de llaves equilibradas, la limpieza del
    // segundo `data` daría por buena la del primero. Esto lo demuestra.
    const fuente = `
      await a.update({ data: { asignadoAt: new Date() } });
      await b.update({ data: { asignadoAt: null, fechaReparto: null } });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(2);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false); // la primera SIGUE siendo infractora
    expect(tocaFechaReparto(encontradas[1].texto)).toBe(true);
  });

  it("no confunde una LECTURA de `asignado_at` con una escritura", () => {
    // `ORDER BY asignado_at` y `select: { asignadoAt: true }` no son escrituras y no deben entrar
    // en el censo: si entraran, la guardia exigiría limpiar el día en un `SELECT`.
    const orderBy = `const x = await p.orden.findMany({ orderBy: { asignadoAt: "desc" } });`;
    expect(escriturasPrisma("fixture.ts", quitarComentarios(orderBy))).toEqual([]);
    const select = `const sql = \`SELECT "asignado_at" FROM "orden" WHERE id = 1\`;`;
    expect(escriturasSql("fixture.ts", quitarComentarios(select))).toEqual([]);
  });
});
