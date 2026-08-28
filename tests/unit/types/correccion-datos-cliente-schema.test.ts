import { describe, it, expect } from "vitest";

import { corregirDatosClienteSchema } from "@/lib/types/correccion-datos-cliente";

// FICHA 312 / A2 — el schema del BORDE, derivado de `actualizarOrdenSchema` (design §4.1).
//
// Lo que estos casos fijan y que no se ve leyendo el codigo: que `.pick(...).strict().extend(...)`
// conserva de verdad el modo estricto en zod 4 (no se da por sabido), y que R6 se cumple por
// HERENCIA —el schema origen no tiene `.max()`, asi que la correccion tampoco—.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

describe("312/A2 — R1/R2: solo los cuatro campos", () => {
  it("acepta los cuatro juntos", () => {
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: "Ana Perez",
      telefonoDest: "8888-7777",
      producto: "caja de zapatos",
      notas: "dejar en porteria",
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["estatusId", { estatusId: "os-1" }],
    ["zonaId", { zonaId: "z-1" }],
    ["peso", { peso: 3 }],
    ["direccion", { direccion: "avenida siempre viva 742" }],
    ["tiendaId", { tiendaId: "t-1" }],
    ["rol", { rol: "maestro" }],
  ])("una clave fuera del alcance (%s) es validation_error", (_nombre, extra) => {
    // R2. `direccion` y `estatusId` son los dos que MAS duelen: el primero arrastraria una
    // re-geocodificacion y el segundo una fila de historial, que es justo lo que D4 prohibe.
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: "Ana Perez",
      ...extra,
    });
    expect(r.success).toBe(false);
  });
});

describe("312/A2 — R3: hay que indicar al menos un campo", () => {
  it("solo `ordenId` es validation_error", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID });
    expect(r.success).toBe(false);
  });

  it("un solo campo basta", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, producto: "caja" });
    expect(r.success).toBe(true);
  });

  it("`notas: null` cuenta como campo indicado: es «vaciar las notas»", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, notas: null });
    expect(r.success).toBe(true);
  });
});

describe("312/A2 — lo que hereda del schema de actualizacion", () => {
  it.each(["destinatario", "telefonoDest", "producto"])(
    "`%s` vacio es validation_error (el `min(1)` viene del origen)",
    (campo) => {
      const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, [campo]: "" });
      expect(r.success).toBe(false);
    },
  );

  it("`ordenId` tiene que ser un uuid", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: "no-soy-uuid", producto: "caja" });
    expect(r.success).toBe(false);
  });

  it("sin `ordenId` no hay correccion posible", () => {
    const r = corregirDatosClienteSchema.safeParse({ producto: "caja" });
    expect(r.success).toBe(false);
  });
});

describe("312/A2 — R6: NINGUN tope de longitud propio", () => {
  it("`producto` y `notas` de 5.000 caracteres son VALIDOS y salen sin recortar", () => {
    // P3, 2026-08-28. Un tope que la carga masiva no tiene produciria el caso absurdo «se pudo
    // cargar pero no se puede corregir». Se comprueba el valor DEVUELTO, no solo el `success`:
    // un `.max()` daria error, pero un `.trim()`/`.slice()` mudo pasaria el `success` y recortaria.
    const largo = "x".repeat(5_000);
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      producto: largo,
      notas: largo,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.producto).toHaveLength(5_000);
    expect(r.data.notas).toHaveLength(5_000);
    expect(r.data.producto).toBe(largo);
  });

  it("`destinatario` y `telefonoDest` tampoco tienen tope", () => {
    const largo = "y".repeat(5_000);
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: largo,
      telefonoDest: largo,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.destinatario).toHaveLength(5_000);
    expect(r.data.telefonoDest).toHaveLength(5_000);
  });
});
