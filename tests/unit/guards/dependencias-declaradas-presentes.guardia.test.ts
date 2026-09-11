import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNES — FICHA 420 — EL PASO DE DEPENDENCIAS MIDE LO QUE AFIRMA.
//
// EL DEFECTO QUE VIGILA (medido el 2026-09-11). init.sh comprobaba si existia el DIRECTORIO
// node_modules y, si existia, imprimia "dependencias presentes" sin abrir package.json.
// Tras mergear la ficha 410 -que anade web-push y @types/web-push- el gate completo sobre
// dev dio ese visto bueno EN VERDE y dos pasos mas tarde reventaba con
// lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push'. Parecia un
// error de codigo y era un pnpm install que faltaba.
//
// Y MEDIDO TAMBIEN AQUI: si falta SOLO el paquete de runtime y siguen estando sus tipos en
// node_modules/@types/, el typecheck PASA EN VERDE y el fallo sale en EJECUCION. O sea que el
// typecheck no cubre esto por detras; este paso es la unica red.
//
// SE DECLARA COMO GUARDIA, Y NO ES UNA ETIQUETA DECORATIVA. Este test no importa nada de lib/:
// lanza un proceso y lee init.sh. Ningun grafo de imports lo seleccionaria en modo rapido, que
// es exactamente el criterio de docs/verification.md para que una comprobacion corra SIEMPRE.
//
// SE LANZA EL SCRIPT CON node, NO SE IMPORTA. Importarlo correria la comprobacion como efecto
// de importar y podria dejar process.exitCode = 1 en el proceso de vitest -una suite roja sin un
// solo test rojo-. Ademas init.sh lo invoca asi: se prueba la cosa, no una copia de la cosa.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const VERIFICADOR = path.join(REPO_ROOT, "scripts", "verificar-dependencias.mjs");
const INIT_SH = path.join(REPO_ROOT, "init.sh");

const temporales: string[] = [];

afterAll(() => {
  for (const dir of temporales) rmSync(dir, { recursive: true, force: true });
});

/**
 * Monta un arbol FALSO en un directorio temporal. Los casos rojos NO pueden montarse sobre el
 * arbol real: romper el node_modules de quien corre la suite para probar que el gate se queja
 * es exactamente la clase de test que deja la maquina peor de como la encontro.
 */
function arbolFalso(opciones: {
  dependencias?: Record<string, string>;
  devDependencias?: Record<string, string>;
  /** Paquetes que SI se instalan en el node_modules falso. */
  instalados?: string[];
  /** Carpetas creadas sin package.json dentro: existen, pero no son un paquete. */
  carpetasVacias?: string[];
  /** Paquetes instalados como enlace simbolico ROTO, que es la forma real de pnpm. */
  enlacesRotos?: string[];
  /** Si es false, no se crea node_modules en absoluto. */
  conNodeModules?: boolean;
}): string {
  const raiz = mkdtempSync(path.join(tmpdir(), "guardia-420-"));
  temporales.push(raiz);

  writeFileSync(
    path.join(raiz, "package.json"),
    JSON.stringify({
      name: "arbol-falso",
      dependencies: opciones.dependencias ?? {},
      devDependencies: opciones.devDependencias ?? {},
      // Va a proposito: optionalDependencies PUEDE faltar legitimamente y el verificador no
      // debe exigirla. Si algun dia se exigiera, el caso verde de aqui se pondria rojo.
      optionalDependencies: { "paquete-opcional-ausente": "^1.0.0" },
    }),
  );

  if (opciones.conNodeModules === false) return raiz;

  const nodeModules = path.join(raiz, "node_modules");
  mkdirSync(nodeModules);

  for (const nombre of opciones.instalados ?? []) {
    const destino = path.join(nodeModules, nombre);
    mkdirSync(destino, { recursive: true });
    writeFileSync(path.join(destino, "package.json"), JSON.stringify({ name: nombre }));
  }

  for (const nombre of opciones.carpetasVacias ?? []) {
    mkdirSync(path.join(nodeModules, nombre), { recursive: true });
  }

  for (const nombre of opciones.enlacesRotos ?? []) {
    const objetivo = path.join(raiz, "store-borrado", nombre);
    mkdirSync(objetivo, { recursive: true });
    writeFileSync(path.join(objetivo, "package.json"), JSON.stringify({ name: nombre }));
    const enlace = path.join(nodeModules, nombre);
    mkdirSync(path.dirname(enlace), { recursive: true });
    symlinkSync(objetivo, enlace, "junction");
    rmSync(objetivo, { recursive: true, force: true });
  }

  return raiz;
}

function correrVerificador(raiz: string) {
  const proceso = spawnSync(process.execPath, [VERIFICADOR, raiz], { encoding: "utf8" });
  return {
    codigo: proceso.status,
    salida: proceso.stdout ?? "",
    error: proceso.stderr ?? "",
  };
}

describe("guardia 420 — el verificador de dependencias", () => {
  it("R4 — con todas las dependencias declaradas presentes pasa, y dice CUANTAS comprobo", () => {
    const raiz = arbolFalso({
      dependencias: { zod: "^4.0.0", next: "^16.0.0" },
      devDependencias: { vitest: "^4.0.0" },
      instalados: ["zod", "next", "vitest"],
    });

    const { codigo, salida, error } = correrVerificador(raiz);

    expect(codigo).toBe(0);
    // La cifra se MIDE: 3 declaradas, y la opcional ausente NO cuenta.
    expect(salida).toContain("3 declaradas, todas presentes");
    expect(error).toBe("");
  });

  it("R1/R2 — una dependencia declarada que NO esta en el arbol pone el paso en ROJO y la nombra", () => {
    // Reproduccion exacta del incidente del 2026-09-11: el arbol existe, esta casi entero, y le
    // falta web-push. El defecto viejo -"existe node_modules"- daba verde aqui.
    const raiz = arbolFalso({
      dependencias: { zod: "^4.0.0", "web-push": "^3.6.7", next: "^16.0.0" },
      instalados: ["zod", "next"],
    });

    const { codigo, error } = correrVerificador(raiz);

    expect(codigo).toBe(1);
    expect(error).toContain("web-push");
    // Y nombra SOLO lo que falta: un rojo que enumera tambien lo que esta bien no se lee.
    expect(error).not.toContain("- zod");
    expect(error).not.toContain("- next");
  });

  it("R2 — nombra TODAS las ausentes, de dependencies y de devDependencies, incluidas las de scope", () => {
    const raiz = arbolFalso({
      dependencias: { zod: "^4.0.0", "web-push": "^3.6.7" },
      devDependencias: { "@types/web-push": "^3.6.4", vitest: "^4.0.0" },
      instalados: ["zod", "vitest"],
    });

    const { codigo, error } = correrVerificador(raiz);

    expect(codigo).toBe(1);
    expect(error).toContain("web-push");
    expect(error).toContain("@types/web-push");
    expect(error).toContain("faltan 2 de las 4");
  });

  it("R1 — una carpeta sin manifiesto NO cuenta como paquete instalado", () => {
    // existsSync(node_modules/<nombre>) daria verde aqui. Node y TypeScript no: sin
    // package.json dentro, el modulo no resuelve.
    const raiz = arbolFalso({
      dependencias: { "web-push": "^3.6.7" },
      carpetasVacias: ["web-push"],
    });

    const { codigo, error } = correrVerificador(raiz);

    expect(codigo).toBe(1);
    expect(error).toContain("web-push");
  });

  it("R1 — un enlace simbolico ROTO (la forma real de pnpm) tampoco cuenta", () => {
    // En pnpm node_modules/<nombre> es un enlace al store virtual node_modules/.pnpm/...
    // Un store purgado a medias deja el enlace en pie apuntando a la nada.
    const raiz = arbolFalso({
      dependencias: { "web-push": "^3.6.7", zod: "^4.0.0" },
      instalados: ["zod"],
      enlacesRotos: ["web-push"],
    });

    const { codigo, error } = correrVerificador(raiz);

    expect(codigo).toBe(1);
    expect(error).toContain("web-push");
  });

  it("R5 — un arbol sin node_modules se reporta como arbol sin instalar, no como 58 ausencias", () => {
    const raiz = arbolFalso({
      dependencias: { zod: "^4.0.0", "web-push": "^3.6.7" },
      conNodeModules: false,
    });

    const { codigo, error } = correrVerificador(raiz);

    expect(codigo).toBe(1);
    expect(error).toContain("sin instalar");
    // El titular no se ahoga en una lista: no se enumeran las 2 (ni las 58 del repo real).
    expect(error).not.toContain("- zod");
  });

  it("R3 — el rojo trae el comando de reparacion ya escrito", () => {
    const raiz = arbolFalso({
      dependencias: { "web-push": "^3.6.7" },
      instalados: [],
    });

    const { error } = correrVerificador(raiz);

    // Lo caro de este fallo nunca fue arreglarlo -1,3 s en el incidente- sino averiguar que era.
    expect(error).toContain("pnpm install --frozen-lockfile");
  });

  it("R1 — el arbol REAL de este repo tiene todas sus dependencias declaradas", () => {
    // ESTE es el test que habria cazado el caso de la 410 con solo correr la suite. No monta
    // nada: mide el node_modules de quien esta corriendo esto ahora mismo.
    const { codigo, salida, error } = correrVerificador(REPO_ROOT);

    expect(error).toBe("");
    expect(codigo).toBe(0);
    expect(salida).toMatch(/^\d+ declaradas, todas presentes/);
  });
});

describe("guardia 420 — el gate LLAMA al verificador", () => {
  const init = readFileSync(INIT_SH, "utf8");

  it("R6 — init.sh invoca scripts/verificar-dependencias.mjs y FALLA con el", () => {
    // La leccion del composition root: que el script exista no prueba nada si nadie lo llama.
    // Un verificador huerfano es el mismo fallo mudo que esta ficha cierra, un piso mas abajo.
    const invocacion = init
      .split("\n")
      .find((linea) => linea.includes("scripts/verificar-dependencias.mjs"));

    expect(invocacion, "init.sh ya no invoca el verificador de dependencias").toBeDefined();
    expect(invocacion).toContain("fail");
  });

  it("R2 — el visto bueno de dependencias ya no cuelga solo de que exista la carpeta", () => {
    // La linea exacta que produjo el incidente. Si reaparece, el gate vuelve a afirmar sin medir.
    expect(init).not.toContain('ok "dependencias presentes"');
  });

  it("R5/R6 — la instalacion de arranque usa el lockfile y corta el gate si falla", () => {
    const instalacion = init
      .split("\n")
      .find((linea) => linea.trim().startsWith("pnpm install"));

    expect(instalacion, "init.sh ya no instala en el arranque").toBeDefined();
    expect(instalacion).toContain("--frozen-lockfile");
    expect(instalacion).toContain("fail");
  });
});

describe("guardia 420 — el verificador no depende de lo que verifica", () => {
  // SIN COMENTARIOS, con el quitador de la ficha 283. El script EXPLICA en su cabecera que no usa
  // child_process ni red; buscar esas palabras sobre el texto crudo encontraba la explicacion y
  // daba un rojo falso. Afirmar sobre comentarios es afirmar sobre lo que el codigo DICE de si
  // mismo, no sobre lo que hace.
  const fuente = codigoSinComentarios("scripts/verificar-dependencias.mjs");

  it("R7 — solo importa modulos node:, nunca un paquete de node_modules", () => {
    // Comprobar que las dependencias estan presentes USANDO una dependencia es circular: se
    // caeria justo el dia que tiene que hablar, y con un rastro que no se parece al problema.
    const importados = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

    expect(importados.length).toBeGreaterThan(0);
    for (const modulo of importados) {
      expect(modulo, `${modulo} no es un modulo nativo de node`).toMatch(/^node:/);
    }
  });

  it("R7 — no lanza procesos ni toca la red", () => {
    expect(fuente).not.toContain("child_process");
    expect(fuente).not.toContain("fetch(");
  });
});
