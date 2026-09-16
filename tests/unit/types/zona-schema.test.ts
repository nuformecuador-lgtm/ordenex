import { describe, it, expect } from "vitest";
import {
  crearZonaSchema,
  actualizarZonaSchema,
  listarZonasSchema,
} from "@/lib/types/zona";

// Feature 24 / feature 54 (reconciliacion PR #40). Validacion en el borde (R19) y
// clamp de paginacion (R24). El schema nuevo lleva cobroVehiculo + tarifas + esCentral
// (default false), SIN pagoEntrega/pagoRechazo/esGam.

const validCrear = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritoIds: ["d1", "d2"],
  tarifas: [],
  // ⭑ FICHA 429 (R11): crear una bodega EXIGE el numero y el titular. Valores FICTICIOS:
  // el repositorio es publico y aqui no se escribe ningun SINPE real.
  sinpeNumero: "80000000",
  sinpeNombre: "Titular de Prueba",
};

/**
 * ⭑ FICHA 429 — EL PAYLOAD DE ACTUALIZAR YA NO ES EL DE CREAR.
 *
 * Los dos esquemas se separaron en la 376 por `esCentral`; la 429 añade la segunda diferencia: el
 * SINPE va SOLO al crear, porque se edita por su propia accion y con otro modelo de permisos. Como
 * los dos son `.strict()`, mandarlo a `actualizarZonaSchema` es un rechazo explicito.
 */
const validActualizar = {
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritoIds: ["d1", "d2"],
  tarifas: [],
};

describe("crearZonaSchema (R19)", () => {
  it("acepta una entrada valida (esCentral opcional por default)", () => {
    expect(crearZonaSchema.safeParse(validCrear).success).toBe(true);
  });

  it("aplica esCentral=false por default", () => {
    const r = crearZonaSchema.parse(validCrear);
    expect(r.esCentral).toBe(false);
  });

  it("acepta esCentral=true explicito", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, esCentral: true }).success).toBe(true);
  });

  it("rechaza nombre vacio", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, nombre: "" }).success).toBe(false);
  });

  it("rechaza conjunto de distritos vacio", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, distritoIds: [] }).success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, hack: 1 }).success).toBe(false);
  });

  it("cobroVehiculo=true exige >=1 tarifa con vehiculoId", () => {
    expect(crearZonaSchema.safeParse({ ...validCrear, cobroVehiculo: true, tarifas: [] }).success).toBe(false);
    expect(
      crearZonaSchema.safeParse({
        ...validCrear,
        cobroVehiculo: true,
        tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
      }).success,
    ).toBe(true);
  });

  it("cobroVehiculo=false rechaza tarifa con vehiculoId y >1 tarifa", () => {
    expect(
      crearZonaSchema.safeParse({
        ...validCrear,
        cobroVehiculo: false,
        tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
      }).success,
    ).toBe(false);
  });
});

describe("actualizarZonaSchema (R19/R22)", () => {
  it("acepta el mismo payload que crear (reemplazo completo, id viaja aparte)", () => {
    expect(actualizarZonaSchema.safeParse(validActualizar).success).toBe(true);
  });

  it("rechaza campos desconocidos (strict)", () => {
    expect(actualizarZonaSchema.safeParse({ ...validActualizar, hack: 1 }).success).toBe(false);
  });

  it("⭑ FICHA 429 (R11): el SINPE NO se acepta al actualizar — se edita por su propia accion", () => {
    // Si viajara en el reemplazo completo de `actualizarZona` —que es `maestro`-only— un guardado
    // de distritos pisaria EN SILENCIO la correccion que un `adminSatelite` acaba de hacer sobre su
    // bodega. Con `.strict()` es un rechazo explicito, no un descarte mudo.
    expect(
      actualizarZonaSchema.safeParse({ ...validActualizar, sinpeNumero: "70000001" }).success,
    ).toBe(false);
    expect(
      actualizarZonaSchema.safeParse({ ...validActualizar, sinpeNombre: "Titular" }).success,
    ).toBe(false);
    // Y la otra mitad: al CREAR son obligatorios, asi que quitarlos lo rechaza.
    for (const campo of ["sinpeNumero", "sinpeNombre"] as const) {
      const payload: Record<string, unknown> = { ...validCrear };
      delete payload[campo];
      const r = crearZonaSchema.safeParse(payload);
      expect(r.success, campo).toBe(false);
      if (!r.success) expect(r.error.issues.some((i) => i.path[0] === campo), campo).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 376 / R1-R3 — «AUSENTE» Y «APAGADO» DEJAN DE SER LO MISMO EN EL BORDE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ POR QUE EL CASO DE ARRIBA NO BASTA, Y ES LA RAZON DE QUE ESTE BLOQUE EXISTA: `validCrear`
// OMITE `esCentral`, y ese caso solo mira `.success`. Con el defecto VIVO
// (`actualizarZonaSchema = crearZonaSchema`) tambien era `true` — el `default(false)` parsea
// perfectamente—. Lo que distingue las dos versiones no es el exito: es el VALOR que sale.

describe("376/R1-R3 — la marca de zona central: crear pone default, actualizar no", () => {
  it("⭑ R1: al ACTUALIZAR, el campo ausente sale como `undefined` (no como `false`)", () => {
    // ESTA es la aserción que se pone roja si alguien devuelve
    // `export const actualizarZonaSchema = crearZonaSchema`. Probado a mano el 2026-09-07.
    const salida = actualizarZonaSchema.parse(validActualizar);
    expect(salida.esCentral).toBeUndefined();
    expect(salida).not.toHaveProperty("esCentral", false);
  });

  it("⭑ R2: al CREAR, el campo ausente sigue saliendo como `false`", () => {
    // La otra mitad: la separacion de esquemas NO puede llevarse por delante el default de crear.
    // Una zona nueva sin la marca es exactamente lo que un payload sin el campo esta pidiendo.
    expect(crearZonaSchema.parse(validCrear).esCentral).toBe(false);
  });

  it("R3: un `false` EXPLICITO parsea a `false` en los DOS esquemas", () => {
    // «No lo mandé» y «lo mandé apagado» tienen que llegar distintos al servidor: uno se ignora,
    // el otro se rechaza con motivo (R5/R6).
    expect(actualizarZonaSchema.parse({ ...validActualizar, esCentral: false }).esCentral).toBe(false);
    expect(crearZonaSchema.parse({ ...validCrear, esCentral: false }).esCentral).toBe(false);
  });

  it("R3: `esCentral: true` explicito parsea a `true` en los DOS esquemas", () => {
    expect(actualizarZonaSchema.parse({ ...validActualizar, esCentral: true }).esCentral).toBe(true);
    expect(crearZonaSchema.parse({ ...validCrear, esCentral: true }).esCentral).toBe(true);
  });

  it("`esCentral: null` se RECHAZA en los dos (seria un NULL en una columna NOT NULL)", () => {
    // `optional()` admite ausente, no admite nulo. Sin este caso, cambiar `optional()` por
    // `nullish()` pasaria desapercibido y Prisma intentaria escribir NULL.
    expect(actualizarZonaSchema.safeParse({ ...validActualizar, esCentral: null }).success).toBe(false);
    expect(crearZonaSchema.safeParse({ ...validCrear, esCentral: null }).success).toBe(false);
  });

  it("los dos esquemas siguen siendo `.strict()` y siguen aplicando la regla de tarifas", () => {
    // La separacion no puede haber perdido nada por el camino.
    expect(actualizarZonaSchema.safeParse({ ...validActualizar, hack: 1 }).success).toBe(false);
    expect(
      actualizarZonaSchema.safeParse({ ...validActualizar, cobroVehiculo: true, tarifas: [] }).success,
    ).toBe(false);
    expect(
      actualizarZonaSchema.safeParse({
        ...validActualizar,
        cobroVehiculo: false,
        tarifas: [{ cobroEntregado: 10, cobroRechazado: 5, vehiculoId: "v1" }],
      }).success,
    ).toBe(false);
  });
});

describe("listarZonasSchema — clamp de pageSize (R24)", () => {
  it("aplica defaults", () => {
    const r = listarZonasSchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBeGreaterThan(0);
  });

  it("acota pageSize a MAX_PAGE_SIZE", () => {
    const r = listarZonasSchema.parse({ page: 1, pageSize: 100000 });
    expect(r.pageSize).toBeLessThanOrEqual(100);
  });
});
