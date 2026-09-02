import { describe, it, expect } from "vitest";
import {
  DIRECCIONES_ORDEN,
  claveDeOrden,
  esquemaOrdenamiento,
  ordenTotal,
} from "@/lib/types/ordenamiento-listado";
import { z } from "zod";
import {
  SORT_DIRS,
  SORT_FIELDS,
  listarOrdenesCompletoSchema,
  listarOrdenesSchema,
} from "@/lib/types/orden";

// FICHA 352 — el CONTRATO de ordenamiento, en su capa pura. Lo que el `ORDER BY` de verdad
// hace se mide contra Postgres (`tests/integration/db/orden-listado-orden-total.test.ts`);
// aqui se fija lo que puede entrar por el borde y como se compone el criterio.

/** La forma de un criterio de `orderBy` de Prisma, sin arrastrar el tipo generado. */
type Criterio = Record<string, "asc" | "desc">;

describe("ordenTotal — el desempate va AL FINAL y es obligatorio", () => {
  it("añade el desempate como ultimo criterio, sin tocar los anteriores", () => {
    const criterios: Criterio[] = [{ prioridad: "desc" }, { createdAt: "desc" }];
    expect(ordenTotal(criterios, { id: "asc" })).toEqual([
      { prioridad: "desc" },
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("el desempate va DESPUES: si fuera antes, mandaria el sobre el criterio pedido", () => {
    // El orden del array ES el orden del `ORDER BY`. Un desempate colocado primero deja de
    // desempatar y pasa a ordenar, y la fecha que pidio el usuario no se aplica nunca.
    const criterios: Criterio[] = [{ createdAt: "desc" }];
    const conDesempate = ordenTotal(criterios, { id: "asc" });
    expect(conDesempate.at(-1)).toEqual({ id: "asc" });
    expect(conDesempate[0]).toEqual({ createdAt: "desc" });
  });

  it("no muta el array que recibe", () => {
    const criterios: Criterio[] = [{ createdAt: "desc" }];
    ordenTotal(criterios, { id: "asc" });
    expect(criterios).toEqual([{ createdAt: "desc" }]);
  });
});

describe("claveDeOrden — la cache distingue dos ordenes distintos", () => {
  it("«mas reciente» y «mas antiguo» NO comparten clave", () => {
    // Si la clave no incluyera el sentido, el primero que pide «mas antiguo» le serviria su
    // resultado al siguiente que pide «mas reciente».
    expect(claveDeOrden({ sortBy: "created_at", sortDir: "desc" })).not.toBe(
      claveDeOrden({ sortBy: "created_at", sortDir: "asc" }),
    );
  });

  it("dos campos distintos con el mismo sentido tampoco comparten clave", () => {
    expect(claveDeOrden({ sortBy: "created_at", sortDir: "desc" })).not.toBe(
      claveDeOrden({ sortBy: "num_guia", sortDir: "desc" }),
    );
  });

  it("el mismo ordenamiento produce SIEMPRE la misma clave (no refetchea en cada render)", () => {
    expect(claveDeOrden({ sortBy: "created_at", sortDir: "desc" })).toBe(
      claveDeOrden({ sortBy: "created_at", sortDir: "desc" }),
    );
  });
});

describe("esquemaOrdenamiento — union CERRADA de literales", () => {
  const schema = z.object(esquemaOrdenamiento(["created_at", "num_guia"], "created_at", "desc"));

  it("sin entrada aplica los defaults declarados", () => {
    expect(schema.parse({})).toEqual({ sortBy: "created_at", sortDir: "desc" });
  });

  it("un campo fuera de la lista blanca se RECHAZA (no se ignora)", () => {
    expect(() => schema.parse({ sortBy: "password_hash" })).toThrow(z.ZodError);
  });

  it("una direccion que no es asc/desc se RECHAZA", () => {
    expect(() => schema.parse({ sortDir: "descendente" })).toThrow(z.ZodError);
  });

  it("las direcciones son exactamente dos, y son las mismas que usa /ordenes", () => {
    expect(DIRECCIONES_ORDEN).toEqual(["asc", "desc"]);
    expect(SORT_DIRS).toBe(DIRECCIONES_ORDEN); // fuente unica, no una copia
  });
});

describe("listarOrdenesSchema — el borde de /ordenes", () => {
  it("el defecto es la mas reciente primero (pedido humano del 2026-08-19, intacto)", () => {
    const entrada = listarOrdenesSchema.parse({});
    expect(entrada.sortBy).toBe("created_at");
    expect(entrada.sortDir).toBe("desc");
  });

  it("admite los tres campos de la lista blanca en los dos sentidos", () => {
    for (const sortBy of SORT_FIELDS) {
      for (const sortDir of SORT_DIRS) {
        expect(listarOrdenesSchema.parse({ sortBy, sortDir })).toMatchObject({ sortBy, sortDir });
      }
    }
  });

  it("un nombre de columna libre NO entra", () => {
    // La razon de que `sortBy` sea una union cerrada: un `orderBy` de texto libre deja al
    // cliente nombrar columnas que su rol no deberia ni tocar.
    expect(() => listarOrdenesSchema.parse({ sortBy: "monto_cobrar" })).toThrow(z.ZodError);
    expect(() => listarOrdenesSchema.parse({ sortBy: "peso" })).toThrow(z.ZodError);
  });

  it("una clave DESCONOCIDA se rechaza en vez de descartarse en silencio", () => {
    // `.strict()`. Sin esto, `{ sort: "fecha", dir: "asc" }` —los nombres equivocados— no daba
    // error y devolvia el listado en el orden POR DEFECTO: la flecha puesta en la cabecera y
    // las filas sin mover.
    expect(() => listarOrdenesSchema.parse({ sort: "created_at" })).toThrow(z.ZodError);
    expect(() => listarOrdenesSchema.parse({ orderBy: "created_at" })).toThrow(z.ZodError);
    expect(() => listarOrdenesSchema.parse({ sortDirection: "asc" })).toThrow(z.ZodError);
  });

  it("el modo descarga hereda la lista blanca, los defaults y el rechazo de claves ajenas", () => {
    // Lo descargado tiene que salir en el MISMO orden que lo que se ve en pantalla.
    expect(listarOrdenesCompletoSchema.parse({})).toMatchObject({
      sortBy: "created_at",
      sortDir: "desc",
    });
    expect(() => listarOrdenesCompletoSchema.parse({ sortBy: "monto_cobrar" })).toThrow(z.ZodError);
    expect(() => listarOrdenesCompletoSchema.parse({ page: 2 })).toThrow(z.ZodError);
  });
});
