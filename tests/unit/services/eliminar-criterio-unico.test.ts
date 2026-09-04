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
// FICHA 358 (2026-09-02): el SEGUNDO rol que borra. Su `usuarioId` es la `tienda_id` de las
// ordenes que fabrican los helpers de abajo (`store1`), asi que las filas son SUYAS.
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
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
function ordenServiceCon(estatusValue: string, intentos = 0): OrdenService {
  const items = [listItem(estatusValue)];
  const repo = {
    list: vi.fn(async () => ({ items, total: items.length })),
  } as unknown as IOrdenRepository;
  // PEDIDO HUMANO 2026-09-04: el MISMO doble de intentos alimenta a los dos servicios, con el
  // mismo numero. Si cada lado sembrara el suyo, este archivo podria dar verde con la UI y el
  // servidor mirando ordenes distintas — que es exactamente lo que viene a descartar.
  return new OrdenService(repo, fakeIntentosEnLote(intentos === 0 ? {} : { o1: intentos }));
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

function eliminarServiceCon(estatusValue: string, intentos = 0): EliminarOrdenService {
  return new EliminarOrdenService(
    {
      findByIdsForTransicion: vi.fn(async () => [ordenRow(estatusValue)]),
      softDelete: vi.fn(
        async (params: { ids: readonly string[]; ownerId: string | null }) => params.ids.length,
      ),
    },
    fakeIntentosEnLote(intentos === 0 ? {} : { o1: intentos }),
  );
}

/** Lo que el LISTADO le dice a la pantalla sobre esa fila. */
async function laUiOfreceElBoton(
  estatusValue: string,
  actor: Actor = MAESTRO,
  intentos = 0,
): Promise<boolean> {
  const r = await ordenServiceCon(estatusValue, intentos).listar(PAGINA, actor);
  if (r.status !== "ok") throw new Error(`listar respondio ${r.status}`);
  return r.items[0].eliminable === true;
}

/** Lo que el SERVIDOR hace de verdad con esa fila. */
async function elServidorLoAutoriza(
  estatusValue: string,
  actor: Actor = MAESTRO,
  intentos = 0,
): Promise<boolean> {
  const r = await eliminarServiceCon(estatusValue, intentos).eliminar({ ordenIds: ["o1"] }, actor);
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

  // -------------------------------------------------------------------------------------
  // PEDIDO HUMANO 2026-09-04 — LA MISMA PREGUNTA, CON LA SEGUNDA MITAD DEL CRITERIO.
  //
  // El invariante no cambia de forma: la UI y el servidor tienen que responder lo mismo. Lo que
  // cambia es que ahora hay DOS entradas que pueden divergir, y la nueva es la mas facil de
  // olvidar en un solo lado —el listado tiene el numero de intentos a mano desde la feature 160,
  // asi que es tentador no pasarselo al servidor, o al reves—. Se recorre el catalogo ENTERO con
  // un intento sembrado: NINGUN estado debe ser eliminable.
  // -------------------------------------------------------------------------------------
  it.each(ORDER_STATUS_SEED)(
    "%s con UN intento de entrega: ni la UI lo ofrece ni el servidor lo autoriza",
    async (estatusValue) => {
      expect(await laUiOfreceElBoton(estatusValue, MAESTRO, 1)).toBe(false);
      expect(await elServidorLoAutoriza(estatusValue, MAESTRO, 1)).toBe(false);
    },
  );

  it.each(ELIMINABLES_ESPERADOS)(
    "%s: es el INTENTO lo que lo bloquea, no el estado (con cero, los dos dicen que si)",
    async (estatusValue) => {
      // El control POSITIVO del `it.each` de arriba. Sin el, aquel pasaria verde aunque el
      // criterio se hubiera roto y NADA fuera eliminable nunca.
      expect(await laUiOfreceElBoton(estatusValue, MAESTRO, 0)).toBe(true);
      expect(await elServidorLoAutoriza(estatusValue, MAESTRO, 0)).toBe(true);
    },
  );

  it.each(ELIMINABLES_ESPERADOS)(
    "%s (tienda): la segunda mitad tampoco se olvida para el otro rol que borra",
    async (estatusValue) => {
      expect(await laUiOfreceElBoton(estatusValue, TIENDA, 1)).toBe(false);
      expect(await elServidorLoAutoriza(estatusValue, TIENDA, 1)).toBe(false);
    },
  );

  // -------------------------------------------------------------------------------------
  // FICHA 358 — LA MISMA PREGUNTA, PARA EL SEGUNDO ROL QUE BORRA.
  //
  // Desde el 2026-09-02 la tienda tambien borra, acotada a lo suyo. El invariante de este
  // archivo no cambia de forma, cambia de alcance: si la UI y el servidor pueden divergir para
  // el maestro, tambien pueden divergir para la tienda —y ahi ademas hay una frontera entre
  // inquilinos de por medio—. El recorrido se repite ENTERO, no con un caso de muestra.
  // -------------------------------------------------------------------------------------
  it.each(ORDER_STATUS_SEED)(
    "%s (tienda, sobre una orden SUYA): la UI ofrece exactamente lo que el servidor autoriza",
    async (estatusValue) => {
      const ofrecido = await laUiOfreceElBoton(estatusValue, TIENDA);
      const autorizado = await elServidorLoAutoriza(estatusValue, TIENDA);

      expect({ estatusValue, ofrecido }).toEqual({ estatusValue, ofrecido: autorizado });
      // Y la tienda no tiene una ventana distinta de la del maestro: cambia QUIEN puede, no QUE
      // se puede borrar.
      expect(ofrecido).toBe(([...ELIMINABLES_ESPERADOS] as string[]).includes(estatusValue));
    },
  );

  it.each(ELIMINABLES_ESPERADOS)(
    "%s (tienda, sobre una orden AJENA): ni se ofrece ni se autoriza",
    async (estatusValue) => {
      // El caso que la ficha existe para blindar, preguntado a las DOS mitades a la vez: sobre
      // una orden de otra tienda, el estado eliminable no basta.
      const ajena: Actor = { usuarioId: "store-de-otro", rol: "adminTienda" };

      expect(await laUiOfreceElBoton(estatusValue, ajena)).toBe(false);
      expect(await elServidorLoAutoriza(estatusValue, ajena)).toBe(false);
    },
  );
});
