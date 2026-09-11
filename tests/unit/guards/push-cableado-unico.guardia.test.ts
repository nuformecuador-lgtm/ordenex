import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// FICHA 410 (T3.5 / T3.5b, R51) — GUARDIA DEL PUNTO UNICO DE CABLEADO DEL CANAL DE PUSH.
//
// ---------------------------------------------------------------------------------------------
// POR QUE EXISTE, Y NO ES TEORICO
// ---------------------------------------------------------------------------------------------
// El 2026-08-23 se midio en este mismo arbol que de SIETE notificadores reales, DOS no los pasaba
// nadie —incluido el aviso nocturno del corte, el que mas se emite— y la suite entera estaba verde.
// Un productor que se olvida de cablear su canal NO ROMPE NADA: simplemente no avisa.
//
// El canal de push evita eso cableandose UNA vez, decorando el repositorio en `repoReal()`. Esta
// guardia defiende esa unica linea en las DOS direcciones:
//
//   1. que `repoReal()` DEVUELVE un repositorio DECORADO (no solo que importe el decorador);
//   2. que NINGUN binding de produccion construye su repositorio por su cuenta, saltandose
//      `repoReal()` — que es como el decimotercer productor que alguien escriba dentro de seis
//      meses se quedaria sin push EN SILENCIO.
//
// ⚠️ VIVE EN `tests/unit/guards/` A PROPOSITO: lo que vigila es la FORMA de un archivo, no un
// comportamiento que un grafo de imports seleccione. Las guardias corren SIEMPRE, tambien en el
// modo rapido.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const RUTA_NOTIFICADORES = path.join(RAIZ, "lib", "notificaciones", "notificadores.ts");
const FUENTE = fs.readFileSync(RUTA_NOTIFICADORES, "utf8");
/** El fuente SIN comentarios: un cableado escrito en la prosa no es un cableado. */
const CODIGO = quitarComentarios(FUENTE);

describe("410 · autocomprobacion de la guardia", () => {
  it("lee un fuente con contenido y encuentra `repoReal`", () => {
    // Sin esto, un archivo que no se leyera dejaria TODA la guardia verde y muda. Ya paso en este
    // repo: una guardia salio verde con su detector roto porque no encontraba nada.
    expect(FUENTE.length).toBeGreaterThan(2000);
    expect(CODIGO).toContain("function repoReal()");
  });
});

describe("410/R51 · `repoReal()` devuelve el repositorio DECORADO", () => {
  /** El cuerpo de `repoReal()`, sin comentarios. */
  function cuerpoDeRepoReal(): string {
    const i = CODIGO.indexOf("function repoReal()");
    expect(i, "no se encontro `repoReal` en el fuente").toBeGreaterThan(-1);
    const abre = CODIGO.indexOf("{", i);
    let nivel = 0;
    for (let j = abre; j < CODIGO.length; j++) {
      if (CODIGO[j] === "{") nivel += 1;
      if (CODIGO[j] === "}") {
        nivel -= 1;
        if (nivel === 0) return CODIGO.slice(abre, j + 1);
      }
    }
    throw new Error("no se cerro el cuerpo de `repoReal`");
  }

  it("⭑ el `return` PASA el repositorio por `conPushWeb(...)`, no solo lo importa", () => {
    // «PASARLO» NO ES «IMPORTARLO», y esa distincion es todo el test: el fallo de 2026-08-23 se
    // reprodujo con una mutacion que dejaba el import intacto y quitaba solo el argumento.
    const cuerpo = cuerpoDeRepoReal();
    expect(cuerpo).toContain("conPushWeb(");
    expect(cuerpo).toMatch(/return\s+conPushWeb\(/);
    // Y el repositorio de verdad va DENTRO de la llamada, no al lado.
    expect(cuerpo).toMatch(/conPushWeb\(\s*new NotificacionRepository\(/);
  });

  it("⭑ MUTACION: devolver `new NotificacionRepository(prisma)` a secas pondria esto ROJO", () => {
    // La mutacion 6 del design §15, reproducida sobre el detector —no sobre el archivo— para que
    // este caso demuestre que el detector DISTINGUE en vez de afirmar sobre el mundo.
    const mutado = "{\n  const prisma = getPrismaClient();\n  return new NotificacionRepository(prisma);\n}";
    expect(/return\s+conPushWeb\(/.test(mutado)).toBe(false);
  });

  it("las cuatro piezas del canal se PASAN al decorador", () => {
    const cuerpo = cuerpoDeRepoReal();
    // Sin cualquiera de las cuatro, el decorador no compila — pero escribirlas aqui deja dicho
    // QUE se cablea, que es lo que alguien tiene que replicar si un dia esto se mueve de sitio.
    for (const pieza of [
      "new PushNotificacionReader(",
      "new PushSuscripcionRepository(",
      "new JobRepository(",
      "pushConfigurado",
    ]) {
      expect(cuerpo, `falta ${pieza} en el cableado`).toContain(pieza);
    }
  });
});

describe("410/R51 · NINGUN productor se salta `repoReal()`", () => {
  /** Los `notificar<X>Real` exportados, leidos DEL ARBOL y no de una lista escrita a mano. */
  const reales = [...FUENTE.matchAll(/^export const (notificar\w+Real)\b/gm)].map((m) => m[1]);

  it("⭑ hay doce bindings de produccion, y el recorrido los encuentra", () => {
    // AUTOCOMPROBACION: si la extraccion se rompiera, el barrido de abajo pasaria sobre una lista
    // vacia. El canario es el notificador que ESTUVO muerto en 2026-08-23.
    expect(reales.length).toBeGreaterThanOrEqual(12);
    expect(reales).toContain("notificarCierreDiaVencidoReal");
    expect(reales).toContain("notificarNovedadesSinGestionarReal");
  });

  it("⭑ los doce resuelven su repositorio por `repoReal()`", () => {
    const sinRepoReal: string[] = [];
    for (const nombre of reales) {
      // El cuerpo del binding: desde su `export const` hasta el `export` siguiente (o el final).
      const i = CODIGO.indexOf(`export const ${nombre}`);
      expect(i, `no se encontro el cuerpo de ${nombre}`).toBeGreaterThan(-1);
      const siguiente = CODIGO.indexOf("\nexport const ", i + 1);
      const cuerpo = CODIGO.slice(i, siguiente === -1 ? CODIGO.length : siguiente);
      if (!cuerpo.includes("repoReal()")) sinRepoReal.push(nombre);
    }
    expect(sinRepoReal).toEqual([]);
  });

  it("⭑ y NINGUNO construye `new NotificacionRepository(` por su cuenta", () => {
    // ESTE es el caso del productor FUTURO (R51). Un decimotercer `notificarXReal` que escriba
    // `new NotificacionRepository(getPrismaClient())` funcionaria perfectamente para la campana y
    // se quedaria SIN PUSH para siempre, sin que nada fallara. Aqui se pone rojo.
    const porSuCuenta: string[] = [];
    for (const nombre of reales) {
      const i = CODIGO.indexOf(`export const ${nombre}`);
      const siguiente = CODIGO.indexOf("\nexport const ", i + 1);
      const cuerpo = CODIGO.slice(i, siguiente === -1 ? CODIGO.length : siguiente);
      if (cuerpo.includes("new NotificacionRepository(")) porSuCuenta.push(nombre);
    }
    expect(porSuCuenta).toEqual([]);
  });

  it("⭑ `new NotificacionRepository(` aparece UNA sola vez en el archivo: dentro de `repoReal()`", () => {
    const apariciones = [...CODIGO.matchAll(/new NotificacionRepository\(/g)].length;
    expect(apariciones).toBe(1);
    const i = CODIGO.indexOf("function repoReal()");
    const j = CODIGO.indexOf("new NotificacionRepository(");
    expect(j).toBeGreaterThan(i);
  });

  it("⭑ MUTACION T3.5b: un productor nuevo que se salte `repoReal()` se detecta", () => {
    // Se inyecta el productor decimotercero EN EL FUENTE LEIDO (no en el archivo) y se comprueba
    // que el MISMO detector lo caza. Sin esto, las tres aserciones de arriba podrian estar
    // afirmando sobre un recorrido que no mira nada.
    const mutado =
      CODIGO +
      "\nexport const notificarAlgoNuevoReal: CierreNotificador = async (ctx) =>\n" +
      "  notificarCierreDiaPorAprobarCon(new NotificacionRepository(getPrismaClient()))(ctx);\n";
    const nuevos = [...mutado.matchAll(/^export const (notificar\w+Real)\b/gm)].map((m) => m[1]);
    expect(nuevos).toContain("notificarAlgoNuevoReal");

    const porSuCuenta = nuevos.filter((nombre) => {
      const i = mutado.indexOf(`export const ${nombre}`);
      const siguiente = mutado.indexOf("\nexport const ", i + 1);
      const cuerpo = mutado.slice(i, siguiente === -1 ? mutado.length : siguiente);
      return cuerpo.includes("new NotificacionRepository(");
    });
    expect(porSuCuenta).toEqual(["notificarAlgoNuevoReal"]);
  });
});

describe("410/R51 · y el camino REAL: `repoReal()` ejecutado de verdad devuelve el decorado", () => {
  it("⭑ el repositorio que sale de `notificadores.ts` es un `NotificacionRepositoryConPush`", async () => {
    // Leer el fuente demuestra la FORMA; esto demuestra el HECHO. `getPrismaClient()` es un
    // singleton PEREZOSO, asi que construir el repositorio no abre conexion: esto corre sin base.
    vi.resetModules();
    const modulo = await import("@/lib/notificaciones/notificadores");
    const { NotificacionRepositoryConPush } = await import(
      "@/lib/notificaciones/notificacion-repo-con-push"
    );

    // `repoReal` no se exporta a proposito (es detalle interno), asi que se ejercita por el camino
    // que la produccion usa: un binding real con un contexto que NO llega a escribir nada. Lo que
    // interesa es el TIPO del repositorio que el binding construye, y para verlo se espia la clase
    // decoradora.
    //
    // Los DOS metodos se doblan porque el emisor consulta la dedupe ANTES de crear: sin doblar
    // `existeNoLeidaPara`, la llamada moriria contra una base que aqui no existe y `emitirBestEffort`
    // se la tragaria, dejando este caso rojo por una razon ajena.
    const espiaGuardia = vi
      .spyOn(NotificacionRepositoryConPush.prototype, "existeNoLeidaPara")
      .mockResolvedValue(false);
    const espiaCrear = vi
      .spyOn(NotificacionRepositoryConPush.prototype, "crear")
      .mockResolvedValue(null);

    await modulo.notificarGeocodificacionCaidaReal({ afectados: 1, diaCR: "2026-09-12" });

    // Si `repoReal()` devolviera el repositorio SIN decorar, estos espias no se habrian llamado
    // NUNCA: el emisor habria ido directo a `NotificacionRepository`.
    expect(espiaGuardia).toHaveBeenCalled();
    expect(espiaCrear).toHaveBeenCalled();
    espiaGuardia.mockRestore();
    espiaCrear.mockRestore();
  });
});
