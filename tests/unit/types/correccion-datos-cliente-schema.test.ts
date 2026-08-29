import { describe, it, expect } from "vitest";

import { corregirDatosClienteSchema } from "@/lib/types/correccion-datos-cliente";

// FICHA 312 / A2, AMPLIADA POR LA 327 / A3 — el schema del BORDE, derivado de
// `actualizarOrdenSchema` (312/design §4.1, 327/design §9.1).
//
// Lo que estos casos fijan y que no se ve leyendo el codigo: que `.pick(...).strict().extend(...)`
// conserva de verdad el modo estricto en zod 4 (no se da por sabido), y que 312/R6 se cumple por
// HERENCIA —el schema origen no tiene `.max()`, asi que la correccion tampoco—.
//
// ⚠️ ESTE ARCHIVO CAMBIA DE LADO DOS FILAS A PROPOSITO (327/design §8.2). `direccion` y `peso`
// estaban en la lista de RECHAZADOS de la 312 y pasan a la de ACEPTADOS: es exactamente el alcance
// que la 327 abre (su D1), y borrar los casos en vez de moverlos habria dejado la ficha sin la red
// que documenta que puertas siguen cerradas. `zonaId` SE QUEDA donde estaba —rechazado— porque la
// zona la deriva el servidor (327/R5), y se le suman los cinco de 327/D2.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

describe("312/A2 + 327/A3 — R1/R2: los NUEVE campos, y ni uno mas", () => {
  it("acepta los cuatro de la 312 juntos", () => {
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: "Ana Perez",
      telefonoDest: "8888-7777",
      producto: "caja de zapatos",
      notas: "dejar en porteria",
    });
    expect(r.success).toBe(true);
  });

  it("327/R1: acepta los NUEVE juntos", () => {
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: "Ana Perez",
      telefonoDest: "8888-7777",
      producto: "caja de zapatos",
      notas: "dejar en porteria",
      direccion: "avenida siempre viva 742",
      provinciaId: "p-1",
      cantonId: "c-1",
      distritoId: "d-1",
      peso: 2.5,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Los valores salen tal cual, sin recortes mudos: la normalizacion es del servicio.
    expect(r.data.direccion).toBe("avenida siempre viva 742");
    expect(r.data.peso).toBe(2.5);
    // Y la confirmacion, ausente, cae a `false`: la AUSENCIA no confirma nada (327/design §4.1).
    expect(r.data.confirmaCambioDeUbicacion).toBe(false);
  });

  it.each([
    // 312: los dos que ya estaban.
    ["estatusId", { estatusId: "os-1" }],
    ["tiendaId", { tiendaId: "t-1" }],
    // 327/R5: LA ZONA NO SE MANDA, SE DERIVA. Esta fila se queda donde estaba a proposito.
    ["zonaId", { zonaId: "z-1" }],
    // 327/D2: los cinco que la ficha deja explicitamente fuera.
    ["montoCobrar", { montoCobrar: 15000 }],
    ["cobraComision", { cobraComision: false }],
    ["numGuia", { numGuia: 8123 }],
    ["numRemision", { numRemision: "R-1" }],
    ["mensajeroAsignadoId", { mensajeroAsignadoId: "m-1" }],
    // Y el clasico: el rol no viaja en el input.
    ["rol", { rol: "maestro" }],
  ])("una clave fuera del alcance (%s) es validation_error", (_nombre, extra) => {
    // R2. `estatusId` es el que MAS duele: arrastraria una fila de historial, que es justo lo que
    // 312/D4 prohibe. `zonaId` es el segundo: escribir la zona a mano es mover el flete que se
    // factura sin que nadie derive nada del distrito.
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      destinatario: "Ana Perez",
      ...extra,
    });
    expect(r.success).toBe(false);
  });

  it("327/R2: `zonaId` no cuela ni con la confirmacion puesta", () => {
    // El gate de confirmacion NO es una llave maestra: `.strict()` sigue siendo `.strict()`.
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      provinciaId: "p-1",
      cantonId: "c-1",
      distritoId: "d-1",
      zonaId: "z-9",
      confirmaCambioDeUbicacion: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("327/A3 — R3: la geografia viaja COMPLETA o no viaja", () => {
  const GEO = { provinciaId: "p-1", cantonId: "c-1", distritoId: "d-1" };

  it.each([
    ["solo provincia", { provinciaId: GEO.provinciaId }],
    ["provincia + canton", { provinciaId: GEO.provinciaId, cantonId: GEO.cantonId }],
    ["solo distrito", { distritoId: GEO.distritoId }],
    ["canton + distrito", { cantonId: GEO.cantonId, distritoId: GEO.distritoId }],
  ])("%s es validation_error", (_n, parcial) => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, ...parcial });
    expect(r.success).toBe(false);
  });

  it("los tres juntos son validos", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, ...GEO });
    expect(r.success).toBe(true);
  });

  it("ninguno de los tres, con otro campo, tambien es valido", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, producto: "caja" });
    expect(r.success).toBe(true);
  });
});

describe("327/A3 — R4: la orden no se queda sin distrito", () => {
  it.each([
    ["null", null],
    ["cadena vacia", ""],
  ])("`distritoId` %s es validation_error", (_n, valor) => {
    // El origen declara `distritoId` como `.nullable()` (es el unico FK nullable de `orden`), pero
    // desde esta superficie no se puede vaciar: la zona se deriva del distrito y `orden.zona_id`
    // es NOT NULL.
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      provinciaId: "p-1",
      cantonId: "c-1",
      distritoId: valor,
    });
    expect(r.success).toBe(false);
  });
});

describe("327/A3 — R8/R9: direccion y peso", () => {
  it('`direccion: ""` es validation_error (hereda el `min(1)` del origen)', () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, direccion: "" });
    expect(r.success).toBe(false);
  });

  it('`direccion: "   "` PASA el borde: la vacia al recortar la rechaza el servicio', () => {
    // Anotado a proposito y no dejado a la intuicion: el `min(1)` no ve los espacios. La regla de
    // «vacio tras recortar» vive en UN sitio —`CAMPOS_NO_VACIABLES` del servicio— y trata igual a
    // `destinatario`, `telefonoDest`, `producto` y `direccion`. Su caso esta en
    // `tests/unit/services/corregir-datos-cliente-service.test.ts`.
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, direccion: "   " });
    expect(r.success).toBe(true);
  });

  it.each([
    ["cero", 0],
    ["negativo", -1],
  ])("`peso` %s es validation_error", (_n, peso) => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, peso });
    expect(r.success).toBe(false);
  });

  it("`peso: null` es validation_error: no se deja la orden sin peso desde aqui", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, peso: null });
    expect(r.success).toBe(false);
  });

  it("`peso: 0.5` es valido", () => {
    const r = corregirDatosClienteSchema.safeParse({ ordenId: ORDEN_ID, peso: 0.5 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.peso).toBe(0.5);
  });
});

describe("327/A3 — la confirmacion no cuenta como campo a corregir", () => {
  it("`confirmaCambioDeUbicacion` sola es validation_error", () => {
    // Si contara, una peticion que no corrige NADA pasaria el `refine` de 312/R3 y llegaria al
    // servicio. Y como SIEMPRE viene informada (tiene default), contaria siempre.
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      confirmaCambioDeUbicacion: true,
    });
    expect(r.success).toBe(false);
  });

  it("con un campo de verdad al lado si pasa, y llega como `true`", () => {
    const r = corregirDatosClienteSchema.safeParse({
      ordenId: ORDEN_ID,
      provinciaId: "p-1",
      cantonId: "c-1",
      distritoId: "d-1",
      confirmaCambioDeUbicacion: true,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.confirmaCambioDeUbicacion).toBe(true);
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
