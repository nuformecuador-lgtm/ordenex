import { describe, it, expect } from "vitest";
import { listarOrdenesSchema, ordenFilterSchema } from "@/lib/types/orden";
import { openApiSpec } from "@/lib/api/openapi-spec";
import { COLUMNAS_MANIFIESTO } from "@/lib/utils/manifiesto-xlsx";

// Feature 160 (T23) — el NO ALCANCE, asertado y no solo declarado. Los limites de R29/R30/R31
// son decisiones (QA4/QA5), no descuidos: si alguien los cruza sin querer, esto rompe.
//
// Nota de alcance: este archivo cubre lo verificable desde el BACKEND (bordes, contratos y
// especificacion publica). La comprobacion de que la vista del paquete y la etiqueta imprimible
// no PINTAN el conteo es de la fase de frontend.

describe("R29 — el conteo no es ordenable ni filtrable en el servidor", () => {
  // El `ORDER BY` del listado usa lista blanca de columnas REALES de `orden`; el conteo es
  // derivado en tiempo de lectura. El borde ya lo rechaza sin codigo nuevo.
  it("`sortBy` con el campo de intentos -> rechazo del borde (lista blanca)", () => {
    for (const candidato of ["intentos", "intentosEntrega", "intentos_entrega"]) {
      const r = listarOrdenesSchema.safeParse({ sortBy: candidato });
      expect(r.success).toBe(false);
    }
    // Contraste: los campos admitidos siguen pasando (sin regresion de R31 de la 6).
    expect(listarOrdenesSchema.safeParse({ sortBy: "created_at" }).success).toBe(true);
    expect(listarOrdenesSchema.safeParse({ sortBy: "num_guia" }).success).toBe(true);
  });

  it("`filter` con el campo de intentos -> rechazo por `.strict()` de la whitelist", () => {
    for (const clave of ["intentos", "intentosEntrega", "intentos_entrega"]) {
      const r = ordenFilterSchema.safeParse({ [clave]: 2 });
      expect(r.success).toBe(false);
    }
    // Contraste: la unica clave admitida hoy sigue admitida.
    expect(ordenFilterSchema.safeParse({ status_id: "os-devuelta" }).success).toBe(true);
  });
});

describe("R31 — el contrato publico de integradores NO gana el campo (QA5)", () => {
  it("la especificacion OpenAPI no menciona los intentos en ningun sitio", () => {
    const serializada = JSON.stringify(openApiSpec).toLowerCase();
    expect(serializada).not.toContain("intentos");
    expect(serializada).not.toContain("intentosentrega");
  });
});

describe("R16 — el campo es ADITIVO: los DTO excluidos no lo tienen", () => {
  // Guarda de tipos: si alguien agregara `intentosEntrega` a los DTO excluidos, estas
  // aserciones de tipo dejarian de compilar (el `never` deja de serlo).
  it("compila: `ApiOrdenListItemDTO`, `ApiOrdenDetalleDTO`, `EtiquetaGuiaDTO` y `OrdenDTO` no lo declaran", async () => {
    type SinCampo<T> = "intentosEntrega" extends keyof T ? never : true;
    const api = await import("@/lib/types/api-orden");
    const etiqueta = await import("@/lib/types/etiqueta-guia");
    const orden = await import("@/lib/types/orden");
    // Los `import` mantienen viva la referencia a los modulos; los chequeos son de tipo.
    expect(api).toBeDefined();
    expect(etiqueta).toBeDefined();
    expect(orden).toBeDefined();

    const okApiList: SinCampo<import("@/lib/types/api-orden").ApiOrdenListItemDTO> = true;
    const okApiDetalle: SinCampo<import("@/lib/types/api-orden").ApiOrdenDetalleDTO> = true;
    const okEtiqueta: SinCampo<import("@/lib/types/etiqueta-guia").EtiquetaGuiaDTO> = true;
    const okOrden: SinCampo<import("@/lib/types/orden").OrdenDTO> = true;
    expect([okApiList, okApiDetalle, okEtiqueta, okOrden]).toEqual([true, true, true, true]);
  });

  // El contrapunto: donde SI va, va. Si el campo desapareciera de los DTO internos, el dato
  // dejaria de llegar a las superficies sin que nada mas rompiera.
  it("compila: los DTO internos SI lo declaran (opcional)", async () => {
    type ConCampo<T> = "intentosEntrega" extends keyof T ? true : never;
    const okListado: ConCampo<import("@/lib/types/orden").OrdenListItemDTO> = true;
    const okAsignacion: ConCampo<
      import("@/lib/interfaces/services/IMisAsignacionesService").MiAsignacionDTO
    > = true;
    const okRecepcion: ConCampo<
      import("@/lib/interfaces/services/IRecepcionSateliteService").RecepcionSateliteDTO
    > = true;
    const okNovedad: ConCampo<import("@/lib/types/novedad").NovedadDTO> = true;
    const okRechazo: ConCampo<import("@/lib/types/rechazo-sla-tienda").RechazoSlaTiendaDTO> = true;
    const okLiberada: ConCampo<
      import("@/lib/interfaces/repositories/ILiberacionReprogramadaRepository").LiberadaHoyRow
    > = true;
    expect([okListado, okAsignacion, okRecepcion, okNovedad, okRechazo, okLiberada]).toEqual(
      [true, true, true, true, true, true],
    );
  });

  // El manifiesto es el UNICO que lo lleva NO opcional (design 160 §3.6): su DTO enumera sus
  // propiedades una a una para que el archivo no omita campos en silencio.
  it("el manifiesto declara `intentos` (no opcional) y lo emite como columna", () => {
    type NoOpcional<T> = undefined extends T ? never : true;
    const ok: NoOpcional<import("@/lib/types/manifiesto").ManifiestoFilaDTO["intentos"]> = true;
    expect(ok).toBe(true);
    expect(COLUMNAS_MANIFIESTO.map((c) => c.key)).toContain("intentos");
  });
});
