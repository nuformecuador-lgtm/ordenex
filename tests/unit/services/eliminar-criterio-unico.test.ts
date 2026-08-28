import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import { EliminarOrdenService } from "@/lib/services/EliminarOrdenService";
import type { IOrdenRepository, OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import {
  ELIMINABLES_ESPERADOS,
  catalogoCubiertoPorLasDosListas,
} from "@/tests/fixtures/estados-eliminables";

// FICHA 319 — LA FUENTE DEL HECHO ES UNA.
//
// El criterio de «se puede eliminar» vive en DOS sitios porque responde a DOS preguntas
// distintas: `EliminarOrdenService` decide si lo AUTORIZA, y `OrdenService` decide si la UI
// OFRECE el boton. Que sean dos llamadores no es duplicar la regla; duplicarla seria que cada
// uno tuviera su lista. Si divergen, la barra ofrece «Eliminar» sobre filas que el servidor
// rechaza — el fallo mudo exacto que el campo del DTO existe para impedir.
//
// Este archivo lo mide de la unica forma que no miente: recorre el catalogo ENTERO, pregunta a
// los dos servicios por CADA estado y exige que respondan lo mismo. No lee codigo ni compara
// constantes: ejecuta las dos rutas de verdad.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const PAGINA = { page: 1, pageSize: 20, sortBy: "created_at", sortDir: "desc" } as const;

function listItem(estatusValue: string): OrdenListItemDTO {
  return {
    id: "o1",
    numGuia: 1,
    numRemision: "REM-1",
    estatusId: "os-1",
    estatusValue,
    destinatario: "Ana",
    telefonoDest: "0991234567",
    tiendaId: "store1",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Caja",
    peso: 1.5,
    notas: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    tiendaNombre: "Tienda Uno",
  };
}

/**
 * Doble MINIMO del repo: `listar` solo llama a `list`. El `as unknown as` es deliberado y esta
 * acotado a este archivo — construir las ~40 firmas de `IOrdenRepository` para ejercitar una
 * sola es ruido que esconde lo que este test mide.
 */
function ordenServiceCon(estatusValue: string): OrdenService {
  const items = [listItem(estatusValue)];
  const repo = {
    list: vi.fn(async () => ({ items, total: items.length })),
  } as unknown as IOrdenRepository;
  return new OrdenService(repo, fakeIntentosEnLote());
}

function ordenRow(estatusValue: string): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue,
    numGuia: 1,
    deletedAt: null,
    zonaId: "z1",
    zonaEsGam: true,
    tiendaId: "store1",
    fechaReparto: null,
  };
}

function eliminarServiceCon(estatusValue: string): EliminarOrdenService {
  return new EliminarOrdenService({
    findByIdsForTransicion: vi.fn(async () => [ordenRow(estatusValue)]),
    softDelete: vi.fn(async (ids: readonly string[]) => ids.length),
  });
}

/** Lo que el LISTADO le dice a la pantalla sobre esa fila. */
async function laUiOfreceElBoton(estatusValue: string): Promise<boolean> {
  const r = await ordenServiceCon(estatusValue).listar(PAGINA, MAESTRO);
  if (r.status !== "ok") throw new Error(`listar respondio ${r.status}`);
  return r.items[0].eliminable === true;
}

/** Lo que el SERVIDOR hace de verdad con esa fila. */
async function elServidorLoAutoriza(estatusValue: string): Promise<boolean> {
  const r = await eliminarServiceCon(estatusValue).eliminar({ ordenIds: ["o1"] }, MAESTRO);
  return r.status === "ok";
}

describe("eliminar orden / la UI y el servidor responden LO MISMO (ficha 319)", () => {
  it("el recorrido cubre el catalogo entero, y no esta vacio", () => {
    // Autocomprobacion del detector: un `it.each` sobre una lista vacia pasa VERDE sin haber
    // comprobado nada. Aqui se afirma el tamano antes de creerse los 22 casos de abajo.
    expect(ORDER_STATUS_SEED.length).toBeGreaterThanOrEqual(20);
    expect(catalogoCubiertoPorLasDosListas().cubiertos).toEqual(
      catalogoCubiertoPorLasDosListas().catalogo,
    );
  });

  it.each(ORDER_STATUS_SEED)(
    "%s: el boton que ofrece la UI es exactamente lo que el servidor autoriza",
    async (estatusValue) => {
      const ofrecido = await laUiOfreceElBoton(estatusValue);
      const autorizado = await elServidorLoAutoriza(estatusValue);

      expect({ estatusValue, ofrecido }).toEqual({ estatusValue, ofrecido: autorizado });
    },
  );

  it.each(ORDER_STATUS_SEED)(
    "%s: y las dos coinciden con la lista que dicto el humano",
    async (estatusValue) => {
      // La tercera pata: que coincidan entre si no basta si las dos se movieran juntas. La
      // referencia esta escrita a mano en el fixture, fuera de `lib/`.
      const esperado = ([...ELIMINABLES_ESPERADOS] as string[]).includes(estatusValue);

      expect(await laUiOfreceElBoton(estatusValue)).toBe(esperado);
      expect(await elServidorLoAutoriza(estatusValue)).toBe(esperado);
    },
  );
});
