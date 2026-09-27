// FICHA 456 (T1.2, design §1.2; R1-R6, R8, R15) — la explicación de cada estado, contra la tabla
// APROBADA por el humano, leída del DISCO (`specs/456-tooltip-estados/textos-aprobados.md`).
//
// Es un literal EXTERNO, no la propia fuente: comparar `DESCRIPCION_ESTADO` contra sí misma estaría
// siempre en verde (memoria «Aserción contra su propia fuente»). Si alguien cambia una coma de la
// fuente, o si `DIAS_RECHAZO_AUTOMATICO` pasa a 7 sin que el humano apruebe el texto nuevo, cae aquí.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { devolucionSlaConfig } from "@/lib/config/devolucion-sla";
import {
  codigoDeNombre,
  DESCRIPCION_ESTADO,
  DESCRIPCION_NOTA_AYUDA,
  descripcionDeEstado,
  descripcionNovedad,
  NOMBRE_ESTADO,
  ORDER_STATUS_SEED,
  type OrderStatusValue,
} from "@/lib/types/order-status";

const RAIZ = path.resolve(__dirname, "../../..");
const MD = readFileSync(path.join(RAIZ, "specs", "456-tooltip-estados", "textos-aprobados.md"), "utf8");

/** Filas `| a | b |` de un trozo de markdown, sin la cabecera ni el separador. */
function filas(trozo: string): Array<[string, string]> {
  return trozo
    .split(/\r?\n/)
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => {
      const celdas = l.split("|").slice(1, -1).map((c) => c.trim());
      return [celdas[0], celdas[1]] as [string, string];
    });
}

/** La PRIMERA tabla: la de los 20 estados, aprobada por el humano (antes de «## Validado»). */
const TABLA_ESTADOS = filas(MD.slice(0, MD.indexOf("## Validado contra el código")));
/** La tabla de la sección «Pendiente de visto bueno del humano» (la nota de ayuda). */
const TABLA_PENDIENTE = filas(MD.slice(MD.indexOf("## Pendiente de visto bueno del humano")));

describe("456 — la explicación de cada estado (fuente única, R1-R8)", () => {
  it("la tabla aprobada se lee entera: 20 filas, y la de la nota, 1 (el parser no está vacío)", () => {
    expect(TABLA_ESTADOS).toHaveLength(20);
    expect(TABLA_PENDIENTE).toHaveLength(1);
  });

  it("R1 — 20 estados, 20 explicaciones, una por código vigente y ninguna de más", () => {
    expect(Object.keys(DESCRIPCION_ESTADO).sort()).toEqual([...ORDER_STATUS_SEED].sort());
    for (const texto of Object.values(DESCRIPCION_ESTADO)) expect(texto.trim().length).toBeGreaterThan(20);
  });

  it.each(TABLA_ESTADOS)("R2/R5 — «%s»: la explicación es la fila de la tabla aprobada", (nombre, texto) => {
    const codigo = codigoDeNombre(nombre);
    expect(codigo, `«${nombre}» no es el nombre de ningún estado vigente`).not.toBeNull();
    expect(DESCRIPCION_ESTADO[codigo as OrderStatusValue]).toBe(texto);
  });

  it("R8 — la nota de ayuda es igual a la sección «Pendiente de visto bueno del humano»", () => {
    const [nota, texto] = TABLA_PENDIENTE[0];
    expect(nota).toBe("Ayuda solicitada a la tienda");
    expect(DESCRIPCION_NOTA_AYUDA).toBe(texto);
  });

  it("R4/R5 — «Novedad» usa los plazos de la configuración (con 7 días y 48 horas dice eso, no 5 ni 24)", () => {
    const texto = descripcionNovedad({ DIAS_RECHAZO_AUTOMATICO: 7, HORAS_REINTENTO: 48 });
    expect(texto).toContain("a los 7 días");
    expect(texto).toContain("a las 48 horas");
    expect(texto).not.toMatch(/\b5\b/);
    expect(texto).not.toMatch(/\b24\b/);
    // Y la entrada vigente sale de la configuración vigente, no de un número escrito a mano.
    expect(DESCRIPCION_ESTADO.novedad).toBe(descripcionNovedad(devolucionSlaConfig));
  });

  it("R6 — «Novedad» no da el número de intentos: sus únicos números son los dos plazos", () => {
    const numeros = DESCRIPCION_ESTADO.novedad.match(/\d+/g) ?? [];
    expect(numeros.map(Number).sort((a, b) => a - b)).toEqual(
      [devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO, devolucionSlaConfig.HORAS_REINTENTO].sort((a, b) => a - b),
    );
  });

  it("un plazo menor que 2 lanza con un mensaje que nombra el plazo", () => {
    expect(() => descripcionNovedad({ DIAS_RECHAZO_AUTOMATICO: 1, HORAS_REINTENTO: 24 })).toThrow(/DIAS_RECHAZO_AUTOMATICO/);
    expect(() => descripcionNovedad({ DIAS_RECHAZO_AUTOMATICO: 5, HORAS_REINTENTO: 1 })).toThrow(/HORAS_REINTENTO/);
  });

  it("R15 — retirados, desconocidos y vacío no tienen explicación (`null`: sin botón)", () => {
    for (const v of ["devolucion_por_confirmar", "ayuda_tienda", "pendiente", "xyz", "", null, undefined]) {
      expect(descripcionDeEstado(v)).toBeNull();
    }
    expect(descripcionDeEstado("en_reparto")).toBe(DESCRIPCION_ESTADO.en_reparto);
  });

  it("design DF — `codigoDeNombre` es la inversa de `NOMBRE_ESTADO` y no inventa códigos", () => {
    for (const c of ORDER_STATUS_SEED) expect(codigoDeNombre(NOMBRE_ESTADO[c])).toBe(c);
    expect(codigoDeNombre("Estado no reconocido")).toBeNull();
    expect(codigoDeNombre("entregado")).toBeNull(); // un código no es un nombre
  });

  it("R3 — el tipo es exhaustivo: 19 claves no compilan", () => {
    const { entregado: _quitado, ...diecinueve } = DESCRIPCION_ESTADO;
    // @ts-expect-error — falta `entregado`: `Record<OrderStatusValue, string>` exige las 20.
    const incompleto: Record<OrderStatusValue, string> = diecinueve;
    expect(Object.keys(incompleto)).toHaveLength(19);
  });
});
