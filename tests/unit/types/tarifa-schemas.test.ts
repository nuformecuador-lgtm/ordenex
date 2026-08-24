import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  crearTarifaSchema,
  actualizarTarifaSchema,
  listarTarifasSchema,
  type TarifaDTO,
} from "@/lib/types/tarifa";
import { tarifasConfig } from "@/lib/config/tarifas";

// Quita comentarios de linea y de bloque. Sin esto, un assert de "esta cadena ya no
// aparece en el fuente" se pondria rojo por el propio comentario que EXPLICA la
// retirada -y, peor, se podria satisfacer reescribiendo un comentario-. Al mirar
// solo codigo, el assert cae del lado de las declaraciones reales.
function fuenteSinComentarios(rutaRelativa: string): string {
  const texto = readFileSync(resolve(process.cwd(), rutaRelativa), "utf8");
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function baseCrear() {
  return {
    tiendaId: "tienda-1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
  };
}

describe("crearTarifaSchema — validacion de creacion (R2/R3/R5/R14/R15)", () => {
  it("acepta un input valido", () => {
    const r = crearTarifaSchema.safeParse(baseCrear());
    expect(r.success).toBe(true);
  });

  it("rechaza tiendaId vacio (R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), tiendaId: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("tiendaId");
  });

  // `tiendaId` DEJO de ser obligatoria (migracion tarifa_zona_is_default): ausente =
  // la tarifa no se acota a ninguna tienda. Lo que NO se relajo es la cadena vacia: "" no
  // es "sin tienda", es un id invalido, y aceptarlo escribiria basura en una FK. Los dos
  // tests juntos son el contrato; el de arriba es el que impide que esto se vaya de mas.
  it("acepta tiendaId ausente = tarifa no acotada a ninguna tienda", () => {
    const { tiendaId, ...rest } = baseCrear();
    void tiendaId;
    const r = crearTarifaSchema.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tiendaId ?? null).toBeNull();
  });

  it("acepta tiendaId null explicito", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), tiendaId: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tiendaId).toBeNull();
  });

  // La tarifa se identifica por su TIENDA, no por un nombre: `nombre` sigue siendo
  // del modelo viejo y strict lo rechaza.
  it("rechaza `nombre` del modelo viejo (strict)", () => {
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), nombre: "Tarifa GAM" }).success).toBe(
      false,
    );
  });

  // ⚠️ CAMBIO DE DECISION (migracion `20260824140000_tarifa_zona_is_default`): `zonaId`
  // volvio a la tabla, ahora OPCIONAL. Este test afirmaba lo contrario -que zonaId era
  // del modelo viejo y strict lo rechazaba- y se invierte a proposito, no se borra: la
  // tarifa SIGUE siendo por-tienda, y la zona solo la ACOTA ademas.
  it("acepta `zonaId` (opcional) y tambien su ausencia", () => {
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), zonaId: "zona-1" }).success).toBe(true);
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), zonaId: null }).success).toBe(true);
    expect(crearTarifaSchema.safeParse(baseCrear()).success).toBe(true);
  });

  it("acepta `isDefault` (opcional, booleano) y rechaza un no-booleano", () => {
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), isDefault: true }).success).toBe(true);
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), isDefault: "si" }).success).toBe(false);
  });

  it("rechaza una columna numerica ausente (R5/R15)", () => {
    const { valorFlete, ...rest } = baseCrear();
    void valorFlete;
    const r = crearTarifaSchema.safeParse(rest);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFlete");
  });

  it("rechaza monto negativo (R2/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), fulfillment: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("fulfillment");
  });

  it("rechaza valor no numerico (R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), valorFleteGam: "diez" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("valorFleteGam");
  });

  it("rechaza porcentaje > 100 (R3/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), ivaFlete: 150 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("ivaFlete");
  });

  it("rechaza porcentaje negativo (R3/R5/R15)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), comisionCod: -1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("comisionCod");
  });

  it("acepta porcentaje en el limite 100 (R3)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), ivaComisionCod: 100 });
    expect(r.success).toBe(true);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const r = crearTarifaSchema.safeParse({ ...baseCrear(), extra: "x" });
    expect(r.success).toBe(false);
    // 274/R11: `status` tampoco se acepta en creacion; la columna ya no existe.
    expect(crearTarifaSchema.safeParse({ ...baseCrear(), status: "inactivo" }).success).toBe(false);
  });
});

describe("actualizarTarifaSchema — todos opcionales, strict (R20/R23)", () => {
  it("acepta objeto vacio", () => {
    expect(actualizarTarifaSchema.safeParse({}).success).toBe(true);
  });

  it("acepta cambio de un solo campo", () => {
    expect(actualizarTarifaSchema.safeParse({ tiendaId: "tienda-2" }).success).toBe(true);
  });

  it("rechaza tiendaId vacio (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ tiendaId: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors).toHaveProperty("tiendaId");
  });

  // ⚠️ CAMBIO DE DECISION (feature 274, `20260825120000_drop_tarifa_status`): este
  // test afirmaba lo CONTRARIO —que `{ status: "activo" }` era un update valido—.
  // Se invierte a proposito, no se borra: la columna `tarifas.status` y el tipo
  // `estado_tarifa` dejaron de existir, y con ellos la idea de tarifa "inactiva".
  // No hizo falta escribir ninguna validacion nueva para rechazarlo: el schema es
  // `.strict()`, asi que `status` cae como campo desconocido.
  it("274/R11: rechaza `status` (columna retirada) por strict, sea cual sea su valor", () => {
    for (const valor of ["activo", "inactivo", "borrado", "", null]) {
      const r = actualizarTarifaSchema.safeParse({ status: valor });
      expect(r.success).toBe(false);
    }
    // El error es de campo DESCONOCIDO (strict), no de enum invalido: es lo que
    // demuestra que la validacion no se reescribio a mano.
    const r = actualizarTarifaSchema.safeParse({ status: "activo" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].code).toBe("unrecognized_keys");
  });

  it("rechaza monto negativo (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ valorFlete: -5 });
    expect(r.success).toBe(false);
  });

  it("rechaza porcentaje fuera de 0..100 (R20/R23)", () => {
    const r = actualizarTarifaSchema.safeParse({ comisionCod: 101 });
    expect(r.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarTarifaSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ deletedAt: null }).success).toBe(false);
    expect(actualizarTarifaSchema.safeParse({ createdAt: new Date() }).success).toBe(false);
    // campo del modelo viejo: ya no existe.
    expect(actualizarTarifaSchema.safeParse({ nombre: "Nueva" }).success).toBe(false);
  });

  // Mismo cambio de decision que en creacion: `zonaId` vuelve, opcional, y `null`
  // es un valor CON significado (desacotar la tarifa de su zona).
  it("acepta zonaId (incluido null para desacotar) e isDefault", () => {
    expect(actualizarTarifaSchema.safeParse({ zonaId: "zona-1" }).success).toBe(true);
    expect(actualizarTarifaSchema.safeParse({ zonaId: null }).success).toBe(true);
    expect(actualizarTarifaSchema.safeParse({ isDefault: true }).success).toBe(true);
  });
});

describe("274/R12 — `TarifaDTO` no expone `status`", () => {
  // Segunda mitad de R12: no basta con que el DTO que devuelve `crear` no traiga la
  // clave en tiempo de ejecucion; el TIPO tampoco debe declararla, o alguien la
  // volveria a rellenar creyendo que el contrato la pide.
  it("el bloque `interface TarifaDTO` no declara la propiedad `status`", () => {
    const fuente = fuenteSinComentarios("lib/types/tarifa.ts");
    const bloque = /export interface TarifaDTO \{([\s\S]*?)\n\}/.exec(fuente);
    expect(bloque).not.toBeNull();
    const cuerpo = bloque![1];
    // el bloque se leyo de verdad (guardia contra un regex que casa con vacio)
    expect(cuerpo).toMatch(/\btiendaId\b/);
    expect(cuerpo).not.toMatch(/\bstatus\b/);
  });

  it("un TarifaDTO literal con `status` no compila y el tipo no tiene esa clave", () => {
    // `keyof TarifaDTO` no incluye "status": si alguien la reintroduce, este
    // `satisfies` deja de compilar y el typecheck lo caza.
    const claves = ["id", "tiendaId", "zonaId"] as const;
    type ClaveDTO = keyof TarifaDTO;
    claves satisfies readonly ClaveDTO[];
    // @ts-expect-error 274/R12: "status" ya no es una clave de TarifaDTO.
    const noEsClave: ClaveDTO = "status";
    expect(noEsClave).toBe("status"); // el valor existe; lo que no existe es el tipo
  });
});

describe("listarTarifasSchema — paginacion (R18)", () => {
  it("aplica defaults", () => {
    const r = listarTarifasSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(tarifasConfig.DEFAULT_PAGE_SIZE);
    }
  });

  it("rechaza page/pageSize no positivos", () => {
    expect(listarTarifasSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(listarTarifasSchema.safeParse({ pageSize: -1 }).success).toBe(false);
    expect(listarTarifasSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it("acota pageSize a MAX_PAGE_SIZE (R18)", () => {
    const r = listarTarifasSchema.safeParse({ pageSize: 100000 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.pageSize).toBe(tarifasConfig.MAX_PAGE_SIZE);
  });
});
