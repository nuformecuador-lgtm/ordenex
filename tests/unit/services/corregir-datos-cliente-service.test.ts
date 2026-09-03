import { describe, it, expect, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { CorregirDatosClienteInput } from "@/lib/interfaces/services/ICorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DistritoResueltoRow,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";

// FICHA 312 / C2, AMPLIADA POR LA 327 / C2 — la secuencia del servicio, con dobles (sin DB, sin
// HTTP).
//
// LO QUE ESTE ARCHIVO **NO** PUEDE PROBAR, y conviene tenerlo escrito: el `WHERE` de la ventana y
// el encolado de la re-geocodificacion. Los dobles no ven el SQL, asi que una mutacion del `where`
// del `updateMany` pasaria por aqui en verde. Eso se prueba donde vive:
// `tests/integration/db/corregir-datos-cliente.repo.test.ts` y
// `tests/integration/db/corregir-ubicacion-geocode.test.ts`.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const TIENDA_ID = "tienda-1";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_TIENDA: Actor = { usuarioId: TIENDA_ID, rol: "adminTienda" };
const OTRA_TIENDA: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

/** La orden sembrada: zona `z-1` (no GAM), distrito `d-1` (no especial). */
function orden(overrides: Partial<OrdenParaCorreccionRow> = {}): OrdenParaCorreccionRow {
  return {
    id: ORDEN_ID,
    tiendaId: TIENDA_ID,
    estatusValue: "en_reparto",
    numGuia: 8123,
    destinatario: "Ana Perez",
    telefonoDest: "8888-7777",
    producto: "caja de zapatos",
    notas: "dejar en porteria",
    direccion: "avenida siempre viva 742",
    peso: 1.5,
    montoCobrar: "15000.00",
    cobraComision: true,
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: "d-1",
    distritoNombre: "Distrito Uno",
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    esCentral: false,
    esZonaEspecial: false,
    yaEnUnCierre: false,
    ...overrides,
  };
}

/** El distrito PROPUESTO: `d-2`, en la zona `z-2`. Coherente con `p-1`/`c-1` salvo que se diga. */
function distrito(overrides: Partial<DistritoResueltoRow> = {}): DistritoResueltoRow {
  return {
    id: "d-2",
    nombre: "Distrito Dos",
    cantonId: "c-1",
    provinciaId: "p-1",
    zonaId: "z-2",
    zonaNombre: "Zona Dos",
    esCentral: false,
    esZonaEspecial: false,
    ...overrides,
  };
}

function tarifa(overrides: Partial<TarifaVigente> = {}): TarifaVigente {
  return {
    valorFlete: "2000.00",
    valorFleteGam: "1500.00",
    valorFleteDevuelto: "1000.00",
    valorFleteDevueltoGam: "800.00",
    comisionCod: "5.00",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    ...overrides,
  };
}

/**
 * `ordenFila === null` cubre a la vez «no existe» y «borrada»: `findParaCorreccion` filtra
 * `deleted_at`.
 */
function escenario(
  opciones: {
    ordenFila?: OrdenParaCorreccionRow | null;
    distritoFila?: DistritoResueltoRow | null;
    escritura?: "ok" | "conflict";
    tarifaFila?: TarifaVigente | null;
  } = {},
) {
  const findParaCorreccion = vi.fn(async () =>
    opciones.ordenFila === undefined ? orden() : opciones.ordenFila,
  );
  const findDistritoParaCorreccion = vi.fn(async () =>
    opciones.distritoFila === undefined ? distrito() : opciones.distritoFila,
  );
  // Los parametros se DECLARAN (aunque no se usen) para que `mock.calls[0][1]` tenga tipo: sin
  // ellos, vitest infiere la tupla vacia y las aserciones sobre el `data` que llega al repositorio
  // no compilan.
  const corregirDatosCliente = vi.fn(
    async (
      _ordenId: string,
      _data: Record<string, unknown>,
      _estadosBloqueados: readonly string[],
    ) => opciones.escritura ?? "ok",
  );
  const resolveTarifa = vi.fn(async () =>
    opciones.tarifaFila === undefined ? tarifa() : opciones.tarifaFila,
  );
  const service = new CorregirDatosClienteService(
    { findParaCorreccion, findDistritoParaCorreccion, corregirDatosCliente },
    { resolveTarifa },
  );
  return {
    service,
    findParaCorreccion,
    findDistritoParaCorreccion,
    corregirDatosCliente,
    resolveTarifa,
  };
}

const CAMBIO: Omit<CorregirDatosClienteInput, "ordenId"> = { destinatario: "Ana Maria Perez" };

function entrada(extra: Partial<CorregirDatosClienteInput> = {}): CorregirDatosClienteInput {
  return { ordenId: ORDEN_ID, ...CAMBIO, ...extra };
}

/** El cambio de UBICACION completo hacia `d-2`, que es lo que dispara el gate del dinero. */
const MUDANZA = { provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2" } as const;

describe("312/C2 — R10: los roles que no corrigen nunca", () => {
  it.each([
    ["mensajero", MENSAJERO],
    ["adminSatelite", ADMIN_SATELITE],
    ["apiKey", API_KEY],
  ])("%s recibe forbidden y NO se toca la base", async (_nombre, actor) => {
    const { service, findParaCorreccion, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada(), actor);

    expect(r).toEqual({ status: "forbidden" });
    // Ni siquiera se LEE: un forbidden que cuesta una consulta es un oraculo de existencia.
    expect(findParaCorreccion).not.toHaveBeenCalled();
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("312/C2 — R8: maestro y admin, sin restriccion de tienda", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s corrige una orden de CUALQUIER tienda", async (_nombre, actor) => {
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ tiendaId: "tienda-ajena" }),
    });

    const r = await service.corregir(entrada(), actor);

    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { destinatario: "Ana Maria Perez" },
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
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
    const { service } = escenario({
      ordenFila: orden({ estatusValue: ESTATUS_POR_GRUPO.devolucion }),
    });
    const r = await service.corregir(entrada(), ADMIN_TIENDA);
    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
  });

  it("sobre orden propia en el grupo AYUDA: ok (P2 de la 312, 2026-08-28)", async () => {
    const { service } = escenario({ ordenFila: orden({ estatusValue: ESTATUS_POR_GRUPO.ayuda }) });
    const r = await service.corregir(entrada(), ADMIN_TIENDA);
    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
  });

  it("sobre orden propia en `en_reparto` (fuera de los dos grupos): forbidden", async () => {
    // La asimetria de la regla, medida en el mismo estado: el maestro SI puede ahi.
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ estatusValue: "en_reparto" }),
    });

    const r = await service.corregir(entrada(), ADMIN_TIENDA);

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();

    const maestro = escenario({ ordenFila: orden({ estatusValue: "en_reparto" }) });
    expect(await maestro.service.corregir(entrada(), MAESTRO)).toEqual({
      status: "ok",
      cambios: ["destinatario"],
    });
  });

  it("327/P2: el adminTienda SI puede mover su propio flete, con el aviso delante", async () => {
    // Resuelta por el humano el 2026-08-28: es el mismo nivel de confianza que ya tiene para
    // cargar ordenes y declarar su monto a cobrar. Lo que NO puede es hacerlo sin verlo.
    const sinConfirmar = escenario({
      ordenFila: orden({ estatusValue: ESTATUS_POR_GRUPO.devolucion }),
    });
    const aviso = await sinConfirmar.service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA },
      ADMIN_TIENDA,
    );
    expect(aviso).toMatchObject({ status: "confirmacion_requerida" });
    expect(sinConfirmar.corregirDatosCliente).not.toHaveBeenCalled();

    const confirmado = escenario({
      ordenFila: orden({ estatusValue: ESTATUS_POR_GRUPO.devolucion }),
    });
    const r = await confirmado.service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA, confirmaCambioDeUbicacion: true },
      ADMIN_TIENDA,
    );
    expect(r).toEqual({ status: "ok", cambios: ["distritoId"] });
  });
});

describe("312/C2 + 327/R30 — el mismo resultado opaco para cuatro causas distintas", () => {
  it("inexistente, borrada y ajena devuelven EL MISMO objeto", async () => {
    // `findParaCorreccion` filtra `deleted_at`, asi que «no existe» y «borrada» llegan igual.
    const inexistente = await escenario({ ordenFila: null }).service.corregir(entrada(), MAESTRO);
    const borrada = await escenario({ ordenFila: null }).service.corregir(entrada(), ADMIN_TIENDA);
    const ajena = await escenario().service.corregir(entrada(), OTRA_TIENDA);
    const rolAjeno = await escenario().service.corregir(entrada(), MENSAJERO);
    const bloqueada = await escenario({
      ordenFila: orden({ estatusValue: "entregada" }),
    }).service.corregir(entrada(), MAESTRO);

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
      const { service, corregirDatosCliente } = escenario({ ordenFila: orden({ estatusValue }) });

      const r = await service.corregir(entrada(), MAESTRO);

      expect(r).toEqual({ status: "forbidden" });
      expect(corregirDatosCliente).not.toHaveBeenCalled();
    },
  );

  it.each([...ESTADOS_SIN_CORRECCION])(
    "327/R27: `%s` sigue siendo forbidden CON los campos nuevos en la entrada",
    async (estatusValue) => {
      // La ventana no se ensancha ni se estrecha por los cinco campos que la 327 añade: es la
      // misma regla, sobre mas datos.
      const { service, corregirDatosCliente, findDistritoParaCorreccion } = escenario({
        ordenFila: orden({ estatusValue }),
      });

      const r = await service.corregir(
        { ordenId: ORDEN_ID, direccion: "otra calle", peso: 3, ...MUDANZA },
        MAESTRO,
      );

      expect(r).toEqual({ status: "forbidden" });
      expect(corregirDatosCliente).not.toHaveBeenCalled();
      // Ni siquiera se consulta el catalogo: la puerta se cierra antes.
      expect(findDistritoParaCorreccion).not.toHaveBeenCalled();
    },
  );

  it("un estatus desconocido en la fila no habilita nada (fallo cerrado)", async () => {
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ estatusValue: undefined as unknown as string }),
    });

    const r = await service.corregir(entrada(), MAESTRO);

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("312/C2 + 327/R29 — el conflicto que devuelve el repositorio", () => {
  it("`conflict` del repositorio se propaga sin reinterpretarlo", async () => {
    const { service } = escenario({ escritura: "conflict" });
    const r = await service.corregir(entrada(), MAESTRO);
    expect(r).toEqual({ status: "conflict" });
  });
});

describe("312/C2 + 327/R10 — sin cambios, sin escritura", () => {
  it("los NUEVE valores identicos a los almacenados: ok con `cambios` vacio y CERO escrituras", async () => {
    const fila = orden();
    const { service, corregirDatosCliente, findDistritoParaCorreccion } = escenario({
      ordenFila: fila,
    });

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: fila.destinatario,
        telefonoDest: fila.telefonoDest,
        producto: fila.producto,
        notas: fila.notas,
        direccion: fila.direccion ?? undefined,
        provinciaId: fila.provinciaId,
        cantonId: fila.cantonId,
        distritoId: fila.distritoId ?? undefined,
        peso: fila.peso ?? undefined,
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
    // Y no se paga la consulta del catalogo: si nada cambia, no hay geografia que resolver.
    expect(findDistritoParaCorreccion).not.toHaveBeenCalled();
  });

  it("los que solo difieren en ESPACIOS tampoco son un cambio (incluida la direccion)", async () => {
    // La comparacion se hace tras la MISMA normalizacion que se aplicaria al guardar. Si el diff
    // comparase el crudo, esto escribiria una fila identica y moveria el `updated_at`.
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: "  Ana Perez  ",
        telefonoDest: " 8888-7777 ",
        producto: "\tcaja de zapatos\n",
        notas: "  dejar en porteria ",
        direccion: "  avenida siempre viva 742  ",
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it('`notas: ""` sobre una orden con notas `null` no es un cambio (vacio es ausencia)', async () => {
    const { service, corregirDatosCliente } = escenario({ ordenFila: orden({ notas: null }) });

    const r = await service.corregir({ ordenId: ORDEN_ID, notas: "   " }, MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: [] });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("solo viajan al repositorio los campos que EFECTIVAMENTE cambian", async () => {
    const fila = orden();
    const { service, corregirDatosCliente } = escenario({ ordenFila: fila });

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: fila.destinatario, // igual: no viaja
        telefonoDest: " 8888-9999 ", // cambia: viaja RECORTADO (312/R17)
        notas: "", // pasa a null
        direccion: "  calle nueva 10  ", // cambia: viaja RECORTADA (327/R8)
        peso: 1.5, // igual: no viaja
      },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: ["telefonoDest", "notas", "direccion"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { telefonoDest: "8888-9999", notas: null, direccion: "calle nueva 10" },
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
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

  it("un numero local normal SI pasa: se guarda recortado, no en E.164 (312/R17)", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, telefonoDest: " 8888-9999 " }, MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: ["telefonoDest"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { telefonoDest: "8888-9999" }, // NO `50688889999`
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
    );
  });

  it.each(["destinatario", "producto", "telefonoDest", "direccion"])(
    "327/R8 — `%s` de solo espacios no puede vaciar la orden",
    async (campo) => {
      // Pasa el `min(1)` del schema y se convierte en vacio al recortar. `direccion` entra en esta
      // lista con la 327 y por el mismo motivo: dejar la orden sin direccion no es corregirla.
      const { service, corregirDatosCliente } = escenario();

      const r = await service.corregir({ ordenId: ORDEN_ID, [campo]: "   " }, MAESTRO);

      expect(r).toMatchObject({ status: "validation_error" });
      expect(r).toHaveProperty(`fieldErrors.${campo}`);
      expect(corregirDatosCliente).not.toHaveBeenCalled();
    },
  );
});

describe("327/C2 — R9: el peso, revalidado en el servidor", () => {
  it.each([
    ["cero", 0],
    ["negativo", -1],
  ])("peso %s es validation_error sin escribir", async (_n, peso) => {
    // La segunda puerta no puede DEPENDER de la primera (R28): el schema ya lo rechaza, y aun asi
    // el servicio lo vuelve a comprobar.
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, peso }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(r).toHaveProperty("fieldErrors.peso");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("un peso valido distinto del almacenado se escribe, y NO dispara el gate", async () => {
    const { service, corregirDatosCliente, resolveTarifa } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, peso: 3.25 }, MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: ["peso"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { peso: 3.25 },
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
    );
    // El peso no entra en `derivarIngresoOrden`: no mueve dinero, no hay nada que avisar.
    expect(resolveTarifa).not.toHaveBeenCalled();
  });
});

describe("327/C2 — R6: la cadena provincia -> canton -> distrito", () => {
  it("el distrito no pertenece al CANTON recibido: validation_error, sin escribir", async () => {
    const { service, corregirDatosCliente } = escenario({
      distritoFila: distrito({ cantonId: "c-9" }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(r).toHaveProperty("fieldErrors.distritoId");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("el canton no pertenece a la PROVINCIA recibida: validation_error, sin escribir", async () => {
    const { service, corregirDatosCliente } = escenario({
      distritoFila: distrito({ provinciaId: "p-9" }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("un distrito que no existe: validation_error, sin escribir", async () => {
    const { service, corregirDatosCliente } = escenario({ distritoFila: null });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("327/C2 — R7: la zona se deriva, y solo si el distrito resuelve UNA", () => {
  it("un distrito SIN zona (0) se rechaza nombrando el motivo, sin escribir", async () => {
    const { service, corregirDatosCliente } = escenario({
      distritoFila: distrito({ zonaId: null, zonaNombre: null }),
    });

    const r = await service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA, confirmaCambioDeUbicacion: true },
      MAESTRO,
    );

    expect(r).toMatchObject({ status: "validation_error" });
    if (r.status !== "validation_error") return;
    expect(r.fieldErrors.distritoId?.[0]).toMatch(/zona/i);
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("un distrito AMBIGUO (>1 zona) llega igual como `zonaId: null` y se rechaza", async () => {
    // El colapso vive en el repositorio (`zonaUnicaDeDistrito`): 0 y >1 se traducen los dos a
    // `null`, «no se inventa una zona». El servicio no distingue, y no debe.
    const { service, corregirDatosCliente } = escenario({
      distritoFila: distrito({ zonaId: null, zonaNombre: null }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r).toMatchObject({ status: "validation_error" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("327/C2 — R11: EL GATE DEL DINERO", () => {
  it("cambiar el distrito SIN confirmar: `confirmacion_requerida`, CERO escrituras", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    expect(corregirDatosCliente).not.toHaveBeenCalled();

    // Las DOS columnas del aviso, cada una con sus dos importes.
    expect(r.aviso.actual.zonaId).toBe("z-1");
    expect(r.aviso.actual.zonaNombre).toBe("Zona Uno");
    expect(r.aviso.propuesta.zonaId).toBe("z-2");
    expect(r.aviso.propuesta.zonaNombre).toBe("Zona Dos");
    expect(r.aviso.propuesta.distritoNombre).toBe("Distrito Dos");
    for (const lado of [r.aviso.actual, r.aviso.propuesta]) {
      expect(lado.tarifa).toBe("resuelta");
      expect(lado.fleteConIva).toMatch(/^\d+\.\d{2}$/);
      expect(lado.comisionConIva).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("el gate se dispara DENTRO DE LA MISMA ZONA si cambia la marca especial del distrito", async () => {
    // El motivo de que la clave se llame `confirmaCambioDeUbicacion` y no `…DeZona`: la marca
    // `zona_especial` es del DISTRITO, asi que el flete puede moverse sin que la zona cambie.
    const { service, corregirDatosCliente } = escenario({
      distritoFila: distrito({ zonaId: "z-1", zonaNombre: "Zona Uno", esZonaEspecial: true }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    expect(r.aviso.actual.zonaId).toBe(r.aviso.propuesta.zonaId);
    expect(r.aviso.actual.esZonaEspecial).toBe(false);
    expect(r.aviso.propuesta.esZonaEspecial).toBe(true);
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it.each([
    ["solo la direccion", { direccion: "calle nueva 10" }],
    ["solo el peso", { peso: 4 }],
    ["solo los cuatro de la 312", { destinatario: "Ana Maria", producto: "otra caja" }],
  ])("%s NO dispara el gate: se escribe a la primera", async (_n, campos) => {
    const { service, corregirDatosCliente, resolveTarifa } = escenario();

    const r = await service.corregir({ ordenId: ORDEN_ID, ...campos }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
    expect(resolveTarifa).not.toHaveBeenCalled();
  });

  it("R15/R5 — CON la confirmacion escribe, y la `zonaId` es la DERIVADA", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA, confirmaCambioDeUbicacion: true },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: ["distritoId"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      // `z-2` sale del DISTRITO resuelto; `p-1`/`c-1` no viajan porque no cambian.
      { distritoId: "d-2", zonaId: "z-2" },
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
    );
  });

  it("R5 — una `zonaId` colada en el input NO llega al repositorio", async () => {
    // El schema del borde ya la rechaza, pero el servicio es la segunda puerta y no puede
    // DEPENDER de la primera (R28). Lo que se escribe es lo que el servidor derivo.
    const { service, corregirDatosCliente } = escenario();

    await service.corregir(
      {
        ordenId: ORDEN_ID,
        ...MUDANZA,
        confirmaCambioDeUbicacion: true,
        zonaId: "z-inventada",
      } as unknown as CorregirDatosClienteInput,
      MAESTRO,
    );

    const data = corregirDatosCliente.mock.calls[0][1] as Record<string, unknown>;
    expect(data.zonaId).toBe("z-2");
    expect(data.zonaId).not.toBe("z-inventada");
  });

  it("mover los TRES ids escribe los tres mas la zona derivada", async () => {
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ provinciaId: "p-0", cantonId: "c-0", distritoId: "d-0" }),
    });

    const r = await service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA, confirmaCambioDeUbicacion: true },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: ["provinciaId", "cantonId", "distritoId"] });
    expect(corregirDatosCliente).toHaveBeenCalledWith(
      ORDEN_ID,
      { provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2", zonaId: "z-2" },
      ESTADOS_SIN_CORRECCION,
      // ⭑ FICHA 362 / Q1 — el RASTRO. `ubicacionCorregida` decide si se escribe la fila del
      // registro; el actor es QUIEN la escribe. Ni la direccion ni el distrito viajan aqui.
      { actorUsuarioId: expect.any(String), ubicacionCorregida: expect.any(Boolean) },
    );
  });
});

describe("327/C2 — R13/R14: los dos huecos de configuracion que el aviso SEÑALA", () => {
  it("R13 — sin tarifa para el par (tienda, zona): `sin_tarifa`, no un importe de cero", async () => {
    const { service } = escenario({ tarifaFila: null });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    expect(r.aviso.propuesta.tarifa).toBe("sin_tarifa");
    expect(r.aviso.actual.tarifa).toBe("sin_tarifa");
    // El importe SIGUE siendo "0.00" por debajo: por eso la pantalla ramifica por el
    // discriminante y NO por el numero. Si mirase el numero, un flete real de cero se leeria como
    // «falta configurar», y al reves.
    expect(r.aviso.propuesta.fleteConIva).toBe("0.00");
  });

  it("R14 — distrito especial SIN pacto: el origen del flete lo dice", async () => {
    const { service } = escenario({
      distritoFila: distrito({ esZonaEspecial: true }),
      tarifaFila: tarifa({ tarifaEspecial: null }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    // Mismo importe que una orden corriente, y por eso sin esta marca el hueco seria invisible.
    expect(r.aviso.propuesta.fleteOrigen).toBe("especial_sin_pacto");
    expect(r.aviso.actual.fleteOrigen).toBe("normal");
  });

  it("R14 — distrito especial CON pacto: el origen es `especial`", async () => {
    const { service } = escenario({
      distritoFila: distrito({ esZonaEspecial: true }),
      tarifaFila: tarifa({ tarifaEspecial: "3500.00" }),
    });

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("confirmacion_requerida");
    if (r.status !== "confirmacion_requerida") return;
    expect(r.aviso.propuesta.fleteOrigen).toBe("especial");
  });
});

describe("327/C2 — R16: la orden que ya entro en un cierre", () => {
  it("con una fila de cierre el aviso lo dice; sin ninguna, no", async () => {
    const conCierre = escenario({ ordenFila: orden({ yaEnUnCierre: true }) });
    const r1 = await conCierre.service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);
    expect(r1).toMatchObject({ status: "confirmacion_requerida", aviso: { yaEnUnCierre: true } });

    const sinCierre = escenario();
    const r2 = await sinCierre.service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);
    expect(r2).toMatchObject({ status: "confirmacion_requerida", aviso: { yaEnUnCierre: false } });
  });

  it("NO bloquea: con la confirmacion se escribe igual", async () => {
    // Lo ya facturado esta congelado en una fila inmutable; lo que cambia es el futuro. Bloquear
    // condenaria a re-intentarse con la ubicacion equivocada justo a la orden que sigue viva.
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ yaEnUnCierre: true }),
    });

    const r = await service.corregir(
      { ordenId: ORDEN_ID, ...MUDANZA, confirmaCambioDeUbicacion: true },
      MAESTRO,
    );

    expect(r).toEqual({ status: "ok", cambios: ["distritoId"] });
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
  });
});

describe("312/C2 + 327/R28 — la decision sale del ACTOR, no del input", () => {
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
    const { service, corregirDatosCliente } = escenario({
      ordenFila: orden({ tiendaId: "tienda-ajena" }),
    });

    const r = await service.corregir(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Maria Perez",
        tiendaId: "tienda-ajena",
      } as unknown as CorregirDatosClienteInput,
      ADMIN_TIENDA,
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("327/C2 — R18/R31: la precarga cruza LA MISMA puerta", () => {
  it("un rol sin permiso recibe `forbidden` y CERO datos de la orden", async () => {
    const { service, findParaCorreccion } = escenario();

    const r = await service.obtenerUbicacion(ORDEN_ID, MENSAJERO);

    expect(r).toEqual({ status: "forbidden" });
    expect(findParaCorreccion).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("8888-7777");
  });

  it.each([
    ["orden ajena", { ordenFila: orden({ tiendaId: "tienda-ajena" }) }, ADMIN_TIENDA],
    ["orden inexistente o borrada", { ordenFila: null }, MAESTRO],
    ["estado fuera de la ventana", { ordenFila: orden({ estatusValue: "entregada" }) }, MAESTRO],
  ])("%s recibe el MISMO objeto opaco", async (_n, opciones, actor) => {
    const { service } = escenario(opciones as Parameters<typeof escenario>[0]);
    const r = await service.obtenerUbicacion(ORDEN_ID, actor as Actor);
    expect(r).toEqual({ status: "forbidden" });
  });

  it("con permiso devuelve los NUEVE valores actuales, y NADA de dinero de la orden", async () => {
    const { service } = escenario();

    const r = await service.obtenerUbicacion(ORDEN_ID, MAESTRO);

    expect(r).toEqual({
      status: "ok",
      orden: {
        ordenId: ORDEN_ID,
        destinatario: "Ana Perez",
        telefonoDest: "8888-7777",
        producto: "caja de zapatos",
        notas: "dejar en porteria",
        direccion: "avenida siempre viva 742",
        peso: 1.5,
        provinciaId: "p-1",
        cantonId: "c-1",
        distritoId: "d-1",
        zonaNombre: "Zona Uno",
        distritoNombre: "Distrito Uno",
        numGuia: 8123,
        yaEnUnCierre: false,
      },
    });
    // `montoCobrar` NO viaja a la pantalla: no se edita aqui y no hace falta para pintar.
    expect(JSON.stringify(r)).not.toContain("15000");
  });
});
