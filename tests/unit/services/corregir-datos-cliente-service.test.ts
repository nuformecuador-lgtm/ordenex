import { describe, it, expect, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { CorregirDatosClienteInput } from "@/lib/interfaces/services/ICorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";

// FICHA 312 / C2 — la secuencia del servicio, con dobles (sin DB, sin HTTP).
//
// LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, y conviene tenerlo escrito: el `WHERE` de la ventana.
// Los dobles no ven el SQL, asi que una mutacion del `where` del `updateMany` pasaria por aqui en
// verde. Eso se prueba donde vive: `tests/integration/db/corregir-datos-cliente.repo.test.ts`.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const TIENDA_ID = "tienda-1";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: TIENDA_ID, rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

function ordenDto(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: ORDEN_ID,
    numGuia: 8123,
    numRemision: "R-1",
    estatusId: "os-en-reparto",
    estatusValue: "en_reparto",
    destinatario: "Ana Perez",
    telefonoDest: "8888-7777",
    tiendaId: TIENDA_ID,
    zonaId: "z-1",
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: null,
    producto: "caja de zapatos",
    peso: null,
    notas: "dejar en porteria",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** `orden === null` cubre a la vez «no existe» y «borrada»: `findById` filtra `deleted_at`. */
function escenario(orden: OrdenDTO | null = ordenDto(), escritura: "ok" | "conflict" = "ok") {
  const findById = vi.fn(async () => orden);
  const corregirDatosCliente = vi.fn(async () => escritura);
  const service = new CorregirDatosClienteService({ findById, corregirDatosCliente });
  return { service, findById, corregirDatosCliente };
}

const CAMBIO: Omit<CorregirDatosClienteInput, "ordenId"> = { destinatario: "Ana Maria Perez" };

function entrada(extra: Partial<CorregirDatosClienteInput> = {}): CorregirDatosClienteInput {
  return { ordenId: ORDEN_ID, ...CAMBIO, ...extra };
}

describe("312/C2 — R10: los roles que no corrigen nunca", () => {
  it.each([
    ["mensajero", MENSAJERO],
    ["adminSatelite", ADMIN_SATELITE],
    ["apiKey", API_KEY],
  ])("%s recibe forbidden y NO se toca la base", async (_nombre, actor) => {
    const { service, findById, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada(), actor);

    expect(r).toEqual({ status: "forbidden" });
    // Ni siquiera se LEE: un forbidden que cuesta una consulta es un oraculo de existencia.
    expect(findById).not.toHaveBeenCalled();
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("312/C2 — R8: maestro y admin, sin restriccion de tienda", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s corrige una orden de CUALQUIER tienda", async (_nombre, actor) => {
    const { service, corregirDatosCliente } = escenario(ordenDto({ tiendaId: "tienda-ajena" }));

    const r = await service.corregir(entrada(), actor);

    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { destinatario: "Ana Maria Perez" },
      ESTADOS_SIN_CORRECCION,
    );
  });
});

describe("312/C2 — R9: adminTienda", () => {
  it("sobre orden de OTRA tienda: forbidden, sin escribir", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada(), OTRA_TIENDA);

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("sobre orden propia en el grupo DEVOLUCION: ok", async () => {
    const { service } = escenario(ordenDto({ estatusValue: ESTATUS_POR_GRUPO.devolucion }));
    const r = await service.corregir(entrada(), ADMIN_TIENDA);
    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
  });

  it("sobre orden propia en el grupo AYUDA: ok (P2, 2026-08-28)", async () => {
    const { service } = escenario(ordenDto({ estatusValue: ESTATUS_POR_GRUPO.ayuda }));
    const r = await service.corregir(entrada(), ADMIN_TIENDA);
    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
  });

  it("sobre orden propia en `en_reparto` (fuera de los dos grupos): forbidden", async () => {
    // La asimetria de la regla, medida en el mismo estado: el maestro SI puede ahi.
    const { service, corregirDatosCliente } = escenario(ordenDto({ estatusValue: "en_reparto" }));

    const r = await service.corregir(entrada(), ADMIN_TIENDA);

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();

    const maestro = escenario(ordenDto({ estatusValue: "en_reparto" }));
    expect(await maestro.service.corregir(entrada(), MAESTRO)).toEqual({
      status: "ok",
      cambios: ["destinatario"],
    });
  });
});

describe("312/C2 — R12: el mismo resultado opaco para tres causas distintas", () => {
  it("inexistente, borrada y ajena devuelven EL MISMO objeto", async () => {
    // `findById` filtra `deleted_at`, asi que «no existe» y «borrada» llegan igual: `null`.
    const inexistente = await escenario(null).service.corregir(entrada(), MAESTRO);
    const borrada = await escenario(null).service.corregir(entrada(), ADMIN_TIENDA);
    const ajena = await escenario().service.corregir(entrada(), OTRA_TIENDA);
    const rolAjeno = await escenario().service.corregir(entrada(), MENSAJERO);
    const bloqueada = await escenario(ordenDto({ estatusValue: "entregada" })).service.corregir(
      entrada(),
      MAESTRO,
    );

    expect(inexistente).toEqual({ status: "forbidden" });
    expect(borrada).toEqual(inexistente);
    expect(ajena).toEqual(inexistente);
    expect(rolAjeno).toEqual(inexistente);
    expect(bloqueada).toEqual(inexistente);
  });
});

describe("312/C2 — R11: la ventana de estado", () => {
  it.each([...ESTADOS_SIN_CORRECCION])(
    "`%s` es forbidden y NO llama al repositorio de escritura",
    async (estatusValue) => {
      const { service, corregirDatosCliente } = escenario(ordenDto({ estatusValue }));

      const r = await service.corregir(entrada(), MAESTRO);

      expect(r).toEqual({ status: "forbidden" });
      expect(corregirDatosCliente).not.toHaveBeenCalled();
    },
  );

  it("un estatus desconocido en el DTO no habilita nada (fallo cerrado)", async () => {
    const { service, corregirDatosCliente } = escenario(ordenDto({ estatusValue: undefined }));

    const r = await service.corregir(entrada(), MAESTRO);

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("312/C2 — R13: el conflicto que devuelve el repositorio", () => {
  it("`conflict` del repositorio se propaga sin reinterpretarlo", async () => {
    const { service } = escenario(ordenDto(), "conflict");
    const r = await service.corregir(entrada(), MAESTRO);
    expect(r).toEqual({ status: "conflict" });
  });
});

describe("312/C2 — R4: sin cambios, sin escritura", () => {
  it("los cuatro valores identicos a los almacenados: ok con `cambios` vacio y CERO escrituras", async () => {
    const orden = ordenDto();
    const { service, corregirDatosCliente } = escenario(orden);

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: orden.destinatario,
        telefonoDest: orden.telefonoDest,
        producto: orden.producto,
        notas: orden.notas,
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("los que solo difieren en ESPACIOS tampoco son un cambio", async () => {
    // La comparacion se hace tras la MISMA normalizacion que se aplicaria al guardar. Si el diff
    // comparase el crudo, esto escribiria una fila identica y moveria el `updated_at`, que es el
    // unico rastro que esta ficha deja (R15).
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: "  Ana Perez  ",
        telefonoDest: " 8888-7777 ",
        producto: "\tcaja de zapatos\n",
        notas: "  dejar en porteria ",
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("`notas: \"\"` sobre una orden con notas `null` no es un cambio (vacio es ausencia)", async () => {
    const { service, corregirDatosCliente } = escenario(ordenDto({ notas: null }));

    const r = await service.corregir({ ordenId: ORDEN_ID, notas: "   " }, MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("solo viajan al repositorio los campos que EFECTIVAMENTE cambian", async () => {
    const orden = ordenDto();
    const { service, corregirDatosCliente } = escenario(orden);

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: orden.destinatario, // igual: no viaja
        telefonoDest: " 8888-9999 ", // cambia: viaja RECORTADO (R17)
        notas: "", // pasa a null
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: ["telefonoDest", "notas"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { telefonoDest: "8888-9999", notas: null },
      ESTADOS_SIN_CORRECCION,
    );
  });
});

describe("312/C2 — R18: el telefono tiene que ser utilizable", () => {
  it("`abc` normaliza a vacio: validation_error y CERO escrituras", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, telefonoDest: "abc" }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(r).toHaveProperty("fieldErrors.telefonoDest");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("un numero local normal SI pasa: se guarda recortado, no en E.164 (R17/T1)", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, telefonoDest: " 8888-9999 " }, MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: ["telefonoDest"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { telefonoDest: "8888-9999" }, // NO `50688889999`
      ESTADOS_SIN_CORRECCION,
    );
  });

  it.each(["destinatario", "producto", "telefonoDest"])(
    "`%s` de solo espacios no puede vaciar la orden",
    async (campo) => {
      // Pasa el `min(1)` del schema y se convierte en vacio al recortar (design §10). Dejar una
      // orden sin destinatario no es corregirla.
      const { service, corregirDatosCliente } = escenario();

      const r = await service.corregir({ ordenId: ORDEN_ID, [campo]: "   " }, MAESTRO);

      expect(r).toMatchObject({ status: "validation_error" });
      expect(corregirDatosCliente).not.toHaveBeenCalled();
    },
  );
});

describe("312/C2 — R25: la decision sale del ACTOR, no del input", () => {
  it("un input que traiga `rol` y `tiendaId` no cambia el desenlace", async () => {
    const { service, corregirDatosCliente } = escenario();

    // El schema del borde rechazaria estas claves, pero el servicio no puede DEPENDER de eso: es
    // la segunda puerta, y la que revalida en cada peticion venga por donde venga.
    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Maria Perez",
        rol: "maestro",
        tiendaId: TIENDA_ID,
      } as unknown as CorregirDatosClienteInput,
      MENSAJERO,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("un `adminTienda` no se hace dueño de una orden ajena mandando su `tiendaId` en el input", async () => {
    const { service, corregirDatosCliente } = escenario(ordenDto({ tiendaId: "tienda-ajena" }));

    const r = await service.corregir(
      { ordenId: ORDEN_ID, destinatario: "Ana Maria Perez", tiendaId: "tienda-ajena" } as unknown as CorregirDatosClienteInput,
      ADMIN_TIENDA,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});
