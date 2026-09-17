import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdir, readFile } from "node:fs/promises";

/**
 * ⭑ FICHA 433 · R20 — LA MEMORIA DEL CATÁLOGO: SE GUARDA EL ÉXITO, NUNCA EL FALLO.
 *
 * QUÉ SE ARREGLÓ Y POR QUÉ IMPORTA MÁS DE LO QUE PARECE. `leerCatalogoAyuda` memoriza una
 * PROMESA para leer los 31 archivos una vez por proceso y no una vez por página. Una promesa
 * RECHAZADA memorizada es permanente: el primer tropiezo de lectura —un descriptor que no se
 * pudo abrir, un archivo a medio subir en un despliegue— se convertiría en un fallo que dura lo
 * que viva el proceso. Y como el layout del portal lee este catálogo en TODAS las páginas, el
 * radio de daño no era «la ayuda no abre» sino «la aplicación no abre».
 *
 * Aquí se hace fallar al sistema de archivos DE VERDAD (doblando `node:fs/promises`) porque es
 * la única forma de medir esta propiedad: desde arriba, cualquier doble del catálogo se salta
 * justamente la parte que se quiere probar.
 *
 * `vi.resetModules()` antes de cada caso: la memoria vive en una variable de módulo, así que
 * cada caso estrena catálogo igual que estrena proceso.
 */

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);

/** Un `.md` mínimo pero COMPLETO: el parser de frontmatter es el de verdad. */
const DOCUMENTO = [
  "---",
  "titulo: Prueba",
  "modulo: pruebas",
  "pantalla: /ordenes",
  "roles: [maestro]",
  "actualizado: 2026-09-16",
  "---",
  "",
  "# Prueba",
  "",
].join("\n");

/** Una carpeta con un solo documento. `readdir` devuelve Dirents: name + isDirectory(). */
function carpetaConUnDocumento(): void {
  readdirMock.mockResolvedValue([
    { name: "prueba.md", isDirectory: () => false },
  ] as unknown as Awaited<ReturnType<typeof readdir>>);
  readFileMock.mockResolvedValue(DOCUMENTO);
}

async function catalogoNuevo() {
  vi.resetModules();
  return import("@/lib/ayuda/catalogo");
}

beforeEach(() => {
  readdirMock.mockReset();
  readFileMock.mockReset();
});

describe("433/R20 — un fallo de lectura no puede volverse permanente", () => {
  it("⭑ si la primera lectura falla, la SIGUIENTE vuelve a intentarlo (y funciona)", async () => {
    const { leerCatalogoAyuda } = await catalogoNuevo();

    readdirMock.mockRejectedValueOnce(new Error("EACCES: permission denied, scandir"));
    await expect(leerCatalogoAyuda()).rejects.toThrow("EACCES");

    // El segundo intento con el disco ya sano: si la promesa rechazada se hubiera quedado
    // memorizada, esto seguiría rechazando para siempre — y con él todas las páginas del
    // portal, que leen este catálogo en cada carga.
    carpetaConUnDocumento();
    const docs = await leerCatalogoAyuda();
    expect(docs.map((doc) => doc.slug)).toEqual(["prueba"]);
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });

  it("el rechazo se RELANZA, no se traga: quien llama se entera", async () => {
    // El otro modo de fallo posible al arreglar lo de arriba: devolver `[]` en vez de lanzar
    // dejaría al módulo de ayuda pintando un índice vacío como si no hubiera documentos.
    const { leerCatalogoAyuda, leerResumenesAyuda, leerDocumentoAyuda } = await catalogoNuevo();

    readdirMock.mockRejectedValue(new Error("ENOENT: no such file or directory"));
    await expect(leerCatalogoAyuda()).rejects.toThrow("ENOENT");
    await expect(leerResumenesAyuda()).rejects.toThrow("ENOENT");
    await expect(leerDocumentoAyuda("oficina/wallet-caja")).rejects.toThrow("ENOENT");
  });
});

describe("433 — y el ÉXITO sí se memoriza: los .md se leen una vez por proceso", () => {
  it("⭑ tres llamadas seguidas tocan el disco UNA vez", async () => {
    // La mitad que el arreglo no podía romper: sin memoria, este catálogo se releería en cada
    // carga de CADA página del portal. El contador es la única forma de afirmarlo.
    const { leerCatalogoAyuda, leerResumenesAyuda } = await catalogoNuevo();
    carpetaConUnDocumento();

    const primera = await leerCatalogoAyuda();
    await leerCatalogoAyuda();
    await leerResumenesAyuda();

    expect(readdirMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    // Y es LA MISMA lista, no una copia equivalente: es una sola lectura compartida.
    expect(await leerCatalogoAyuda()).toBe(primera);
  });

  it("el README no es un documento: se excluye al listar", async () => {
    const { leerCatalogoAyuda, ARCHIVO_EXCLUIDO } = await catalogoNuevo();
    readdirMock.mockResolvedValue([
      { name: ARCHIVO_EXCLUIDO, isDirectory: () => false },
      { name: "prueba.md", isDirectory: () => false },
      { name: "notas.txt", isDirectory: () => false },
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    readFileMock.mockResolvedValue(DOCUMENTO);

    const docs = await leerCatalogoAyuda();
    expect(docs.map((doc) => doc.slug)).toEqual(["prueba"]);
  });
});
