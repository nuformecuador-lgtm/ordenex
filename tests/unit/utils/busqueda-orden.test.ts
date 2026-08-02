import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ACENTOS_FROM,
  ACENTOS_TO,
  normalizarTerminoBusqueda,
  soloDigitosSiPareceNumero,
} from "@/lib/utils/busqueda-orden";
import { normalizeName } from "@/lib/utils/normalize";

// Feature 169 / T1.1 — el normalizador COMPARTIDO del buscador de ordenes.
//
// Este archivo cubre el lado TypeScript. El lado Postgres (la columna generada) y la
// PARIDAD entre ambos la cubre `tests/integration/db/busqueda-normalizacion-paridad.test.ts`
// contra una base real: aqui no se puede demostrar que los dos coinciden, solo que este
// lado hace lo que dice.

const ROOT = path.join(__dirname, "..", "..", "..");

describe("mapa de acentos — es el contrato con el SQL", () => {
  it("los dos strings del mapa miden 48 caracteres", () => {
    // 24 letras acentuadas de uso real + sus 24 mayusculas. Si alguien añade un caracter
    // a un lado y no al otro, `translate()` empezaria a BORRAR caracteres (cuando `from`
    // es mas largo que `to`, Postgres elimina los sobrantes) y la columna quedaria
    // silenciosamente corrupta.
    expect(ACENTOS_FROM.length).toBe(48);
    expect(ACENTOS_TO.length).toBe(48);
    expect(ACENTOS_FROM.length).toBe(ACENTOS_TO.length);
  });

  it("ningun caracter se repite en el lado izquierdo", () => {
    expect(new Set(ACENTOS_FROM).size).toBe(48);
  });

  it("el lado derecho es ASCII puro (si no, no habria plegado)", () => {
    expect(/^[A-Za-z]+$/.test(ACENTOS_TO)).toBe(true);
  });

  it("la migracion usa EXACTAMENTE estos dos strings", () => {
    // El criterio de hecho de T1.2: el `translate()` del SQL se copia LITERALMENTE de estas
    // constantes. Comparar por texto es lo unico que impide que se desincronicen.
    const dir = fs
      .readdirSync(path.join(ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((n) => n.endsWith("_orden_busqueda_trgm"));
    expect(dir, "falta la carpeta de migracion _orden_busqueda_trgm").toBeDefined();
    const sql = fs.readFileSync(
      path.join(ROOT, "db", "migrations", dir as string, "migration.sql"),
      "utf8",
    );
    expect(sql).toContain(`'${ACENTOS_FROM}'`);
    expect(sql).toContain(`'${ACENTOS_TO}'`);
  });
});

describe("normalizarTerminoBusqueda", () => {
  it("baja la caja", () => {
    expect(normalizarTerminoBusqueda("JUAN PEREZ")).toBe("juan perez");
  });

  it("pliega las vocales acentuadas en ambas cajas", () => {
    expect(normalizarTerminoBusqueda("José")).toBe("jose");
    expect(normalizarTerminoBusqueda("MARÍA")).toBe("maria");
    expect(normalizarTerminoBusqueda("Hernández Solís")).toBe("hernandez solis");
  });

  it("pliega la ñ y la ç (efecto lateral aceptado: peña == pena)", () => {
    expect(normalizarTerminoBusqueda("Peña")).toBe("pena");
    expect(normalizarTerminoBusqueda("PEÑA")).toBe("pena");
    expect(normalizarTerminoBusqueda("Gonçalves")).toBe("goncalves");
  });

  it("pliega ANTES de bajar la caja (una mayuscula acentuada llega a minuscula sin tilde)", () => {
    // Si el orden fuera `translate(lower(x))`, en una base con LC_CTYPE=C `lower('Á')`
    // devolveria 'Á' y el mapa —que tambien lleva mayusculas— seguiria salvandolo. El
    // orden elegido hace que el resultado no dependa del locale en ningun caso.
    expect(normalizarTerminoBusqueda("ÁÉÍÓÚÑÇ")).toBe("aeiounc");
  });

  it("colapsa espacios repetidos y recorta los extremos (R8)", () => {
    expect(normalizarTerminoBusqueda("  juan    perez  ")).toBe("juan perez");
    expect(normalizarTerminoBusqueda("juan\tperez")).toBe("juan perez");
    expect(normalizarTerminoBusqueda("juan\n\nperez")).toBe("juan perez");
  });

  it("un termino con espacios repetidos produce el mismo resultado que con espacios simples (R8)", () => {
    expect(normalizarTerminoBusqueda("juan   carlos   perez")).toBe(
      normalizarTerminoBusqueda("juan carlos perez"),
    );
  });

  it("no toca los caracteres fuera del mapa (no hay plegado que Postgres no haga)", () => {
    // `ø`/`ł`/`å` NO estan en el mapa: no se pliegan aqui NI en la columna generada. Que
    // este test los fije es lo que impide que alguien "mejore" este lado sin tocar el SQL.
    expect(normalizarTerminoBusqueda("Bjørn Łukasz Åse")).toBe("bjørn łukasz åse");
  });

  it("NO se comporta como normalizeName: el buscador del mensajero (114) no cambia (R42)", () => {
    // `normalizeName` usa NFD + descarte de marcas combinantes: pliega MAS. La diferencia
    // es el motivo entero por el que este modulo existe separado.
    expect(normalizeName("Bjørn Łukasz Åse")).toBe("bjørn łukasz ase");
    expect(normalizarTerminoBusqueda("Bjørn Łukasz Åse")).not.toBe(
      normalizeName("Bjørn Łukasz Åse"),
    );
  });

  it("es idempotente: normalizar dos veces da lo mismo", () => {
    const una = normalizarTerminoBusqueda("  JOSÉ   Peña\t ");
    expect(normalizarTerminoBusqueda(una)).toBe(una);
  });

  it("no inventa nada con la cadena vacia", () => {
    expect(normalizarTerminoBusqueda("")).toBe("");
    expect(normalizarTerminoBusqueda("   ")).toBe("");
  });
});

describe("soloDigitosSiPareceNumero", () => {
  it("un termino de solo digitos devuelve esos digitos", () => {
    expect(soloDigitosSiPareceNumero("88880000")).toBe("88880000");
  });

  it("quita los separadores habituales de telefono (R13)", () => {
    expect(soloDigitosSiPareceNumero("8888-0000")).toBe("88880000");
    expect(soloDigitosSiPareceNumero("8888 0000")).toBe("88880000");
    expect(soloDigitosSiPareceNumero("(506) 8888-0000")).toBe("50688880000");
    expect(soloDigitosSiPareceNumero("+506 8888.0000")).toBe("50688880000");
    expect(soloDigitosSiPareceNumero("8888/0000")).toBe("88880000");
  });

  it("recorta los extremos antes de decidir", () => {
    expect(soloDigitosSiPareceNumero("  8888-0000  ")).toBe("88880000");
  });

  it("devuelve null si hay letras (no es un numero, es texto)", () => {
    expect(soloDigitosSiPareceNumero("juan")).toBeNull();
    expect(soloDigitosSiPareceNumero("REM-2026-0912")).toBeNull();
    expect(soloDigitosSiPareceNumero("8888-000a")).toBeNull();
  });

  it("devuelve null si no queda ni un digito", () => {
    expect(soloDigitosSiPareceNumero("---")).toBeNull();
    expect(soloDigitosSiPareceNumero("()")).toBeNull();
    expect(soloDigitosSiPareceNumero("")).toBeNull();
    expect(soloDigitosSiPareceNumero("   ")).toBeNull();
  });

  it("devuelve null ante comodines de LIKE (no son separadores de telefono)", () => {
    expect(soloDigitosSiPareceNumero("100%")).toBeNull();
    expect(soloDigitosSiPareceNumero("1_2")).toBeNull();
  });
});
