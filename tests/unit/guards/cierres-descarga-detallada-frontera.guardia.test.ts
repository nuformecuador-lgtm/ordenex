// Feature 230 (T6.1) — GUARDIA de FRONTERA de la descarga detallada de cierres. Cubre R16, R27
// (mitad estructural), R41 y R49.
//
// El patrón es el de la feature 134 («puerta única»): las filas de un archivo salen de UNA Server
// Action y de ninguna otra fuente. Lo que esta guardia impide, y que un test de comportamiento no
// impediría, es la vía de escape: que el subárbol del control se ponga a hablar con el dominio por
// su cuenta —importar el servicio, el repositorio o Prisma, o armarse un `where`— y acabe
// entregando un conjunto que NADIE acotó por rol. En una pantalla de dinero eso no es un fallo de
// estilo: es enseñar los cierres de la bodega vecina.
//
// Es una lectura ESTÁTICA de los dos archivos nuevos del subárbol. Mutación comprobada: añadir a
// `DescargarGestionesDialog.tsx` un `import { CierresAdminService } from "@/lib/services/…"` pone
// roja la primera aserción.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

/** El SUBÁRBOL del control detallado: el diálogo y su declaración de columnas. */
const SUBARBOL = [
  "app/(app)/cierres-admin/_components/DescargarGestionesDialog.tsx",
  "app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts",
];

const MODULO_COLUMNAS = SUBARBOL[1];

function fuente(relativa: string): string {
  const completa = path.join(RAIZ, relativa);
  expect(existsSync(completa), `no existe ${relativa}`).toBe(true);
  const texto = readFileSync(completa, "utf8");
  // No-vacuidad: una guardia que lee un archivo vacío pasa verde sin comprobar nada.
  expect(texto.length, `${relativa} está vacío`).toBeGreaterThan(500);
  return texto;
}

/** Todos los archivos de un árbol, recursivamente. */
function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

describe("frontera de la descarga detallada de cierres (T6.1)", () => {
  it("el borde de descarga no importa servicio, repositorio ni Prisma (R16)", () => {
    for (const relativa of SUBARBOL) {
      const texto = fuente(relativa);
      expect(texto, `${relativa} importa un servicio`).not.toMatch(
        /from\s+["']@\/lib\/services\//,
      );
      expect(texto, `${relativa} importa un repositorio`).not.toMatch(
        /from\s+["']@\/lib\/repositories\//,
      );
      expect(texto, `${relativa} toca Prisma`).not.toMatch(/getPrismaClient|@prisma\/client/);
      // Y no se construye un criterio de consulta: el alcance y el recorte los compone el
      // servidor, no el cliente que pide el archivo (R15/R16).
      expect(texto, `${relativa} arma un where`).not.toMatch(/\bwhere\s*:/);
      expect(texto, `${relativa} arma un orderBy`).not.toMatch(/\borderBy\s*:/);
    }
  });

  it("ninguna ruta de app/api sirve esta descarga", () => {
    // La doctrina de la 134: la lectura es interna del mismo proyecto y el archivo se arma en el
    // navegador, así que va por Server Action. Una ruta HTTP paralela sería una segunda puerta,
    // con su propia (y distinta) resolución de alcance.
    const rutas = listarFuentes(path.join(RAIZ, "app", "api"));
    expect(rutas.length).toBeGreaterThan(0); // no-vacuidad: el árbol se recorrió de verdad
    const culpables = rutas.filter((archivo) =>
      /listarGestionesCierres(Admin|Bodega)Completo|GESTIONES_FUNDIDA|filaDescargaGestionFundida/.test(
        readFileSync(archivo, "utf8"),
      ),
    );
    expect(culpables).toEqual([]);
  });

  it("el módulo de columnas de la fundida es puro: no importa React ni toca el DOM (R49)", () => {
    const texto = fuente(MODULO_COLUMNAS);
    expect(texto).not.toMatch(/from\s+["']react["']/);
    expect(texto).not.toMatch(/from\s+["']react-dom/);
    expect(texto).not.toMatch(/"use client"/);
    expect(texto).not.toMatch(/\bdocument\.|\bwindow\./);
    // Y no importa NINGÚN `.tsx`: un módulo que importa un componente deja de ser puro aunque
    // hoy solo le pida un tipo.
    expect(texto).not.toMatch(/from\s+["'][^"']+\.tsx["']/);
  });

  it("el DTO de descarga no declara ningún campo de evidencia (R41)", () => {
    // El DTO es una `interface`: no existe en runtime, así que se lee el FUENTE, que es donde
    // vive la decisión. La forma más fuerte de cumplir R40/R41 es que el servidor no emita nada
    // relativo a la evidencia por este camino, ni siquiera un booleano derivado.
    const texto = fuente("lib/interfaces/services/ICierresAdminService.ts");
    const desde = texto.indexOf("export interface CierreGestionDescargaDTO");
    expect(desde).toBeGreaterThan(-1);
    const cuerpo = texto.slice(desde, texto.indexOf("\n}", desde));
    expect(cuerpo).toContain("numRemision"); // no-vacuidad: se leyó el DTO y no otro bloque
    expect(cuerpo).not.toMatch(/evidencia/i);
    expect(cuerpo).not.toMatch(/^\s*(gestionId|ordenId|cierreId|mensajeroId|zonaId)\b/im);
  });

  it("el código nuevo no ramifica por esCentral (R27)", () => {
    // R27: las gestiones de los cierres con destino BODEGA CENTRAL (la GAM) salen por el camino
    // de cierres del día SIN ningún tratamiento especial. Si hiciera falta un `if` sobre
    // `esCentral` en el código de esta feature, sería que la GAM es un caso aparte — y no lo es.
    for (const relativa of SUBARBOL) {
      expect(fuente(relativa), `${relativa} ramifica por esCentral`).not.toMatch(/esCentral/);
    }
  });
});
