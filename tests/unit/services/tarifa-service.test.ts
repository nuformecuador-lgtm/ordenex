import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";
import { TarifaService } from "@/lib/services/TarifaService";
import type { ITarifaRepository } from "@/lib/interfaces/repositories/ITarifaRepository";
import type { Actor } from "@/lib/interfaces/services/ITarifaService";
import type { CrearTarifaInput, TarifaDTO } from "@/lib/types/tarifa";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };
const TIENDA: Actor = { usuarioId: "store1", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "msg1", rol: "mensajero" };
const DESCONOCIDO: Actor = { usuarioId: "x", rol: "invitado" as RolValue };

function dto(overrides: Partial<TarifaDTO> = {}): TarifaDTO {
  return {
    id: "cob-1",
    tiendaId: "tienda-1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
    zonaId: null,
    isDefault: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function buildRepo(overrides: Partial<ITarifaRepository> = {}): ITarifaRepository {
  return {
    create: vi.fn().mockResolvedValue(dto()),
    findById: vi.fn().mockResolvedValue(dto()),
    list: vi.fn().mockResolvedValue({ items: [dto()], total: 1 }),
    update: vi.fn().mockResolvedValue(dto()),
    hardDelete: vi.fn().mockResolvedValue("ok" as const),
    esTiendaAsignable: vi.fn().mockResolvedValue(true),
    existeZona: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function crearInput(overrides: Partial<CrearTarifaInput> = {}): CrearTarifaInput {
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
    ...overrides,
  };
}

let repo: ITarifaRepository;
let service: TarifaService;

beforeEach(() => {
  repo = buildRepo();
  service = new TarifaService(repo);
});

describe("crear — matriz de autorizacion (R9-R13/R16)", () => {
  it("R10: maestro crea", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    // Los opcionales ausentes se normalizan antes de llegar al repositorio:
    // `null` los nullables, `false` el flag de tarifa por defecto.
    expect(repo.create).toHaveBeenCalledWith(
      {
        ...crearInput(),
        tarifaEspecial: null,
        tarifaEspecialDevuelta: null,
        zonaId: null,
        isDefault: false,
      },
      // FICHA 362 (R3): el segundo argumento es QUIEN crea, que el repositorio congela en la
      // misma transaccion que la escritura.
      MAESTRO.usuarioId,
    );
  });

  it("R11: admin no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R12: adminTienda no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R12: mensajero no puede crear -> forbidden", async () => {
    const r = await service.crear(crearInput(), MENSAJERO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.crear(crearInput(), DESCONOCIDO);
    expect(r.status).toBe("forbidden");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R16: crear valido persiste y devuelve el DTO", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tarifa).toEqual(dto());
  });

  // Invariante del modelo nuevo: la tarifa pertenece a una tienda, y esa tienda
  // debe ser un usuario con rol adminTienda.
  it("R15: tienda que no es adminTienda -> validation_error sin persistir", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ tiendaId: "no-tienda" }), MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tiendaId");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("no-tienda");
    expect(repo.create).not.toHaveBeenCalled();
  });

  // El service NO restringe el rol del duenno mas alla de lo que responde el
  // repo: si la cuenta es tarifable (adminTienda o la cuenta dedicada de una
  // API key), la tarifa se persiste sin distincion alguna.
  it("la cuenta dedicada de una API key se puede tarifar como una tienda", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(true) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ tiendaId: "usuario-de-la-key" }), MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("usuario-de-la-key");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tiendaId: "usuario-de-la-key" }), expect.any(String));
  });

  // Tarifa especial: unico campo opcional. Ausente NO es 0 -> viaja como null.
  it("crear sin tarifa especial la persiste como null (no como 0)", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tarifaEspecial: null }), expect.any(String));
  });

  it("crear con tarifa especial la persiste con su monto", async () => {
    await service.crear(crearInput({ tarifaEspecial: 1250.5 }), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tarifaEspecial: 1250.5 }), expect.any(String));
  });

  // zonaId es OPCIONAL: sin zona la tarifa aplica a la tienda entera.
  it("crear sin zona no comprueba la zona y persiste zonaId null", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.existeZona).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ zonaId: null }), expect.any(String));
  });

  it("crear con zona existente la persiste", async () => {
    await service.crear(crearInput({ zonaId: "zona-1" }), MAESTRO);
    expect(repo.existeZona).toHaveBeenCalledWith("zona-1");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ zonaId: "zona-1" }), expect.any(String));
  });

  // Sin esta comprobacion un id invalido escaparia como error crudo de FK.
  it("crear con una zona inexistente -> validation_error sin persistir", async () => {
    repo = buildRepo({ existeZona: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.crear(crearInput({ zonaId: "no-existe" }), MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("zonaId");
    expect(repo.create).not.toHaveBeenCalled();
  });

  // isDefault nace en false: marcarla por defecto es un acto explicito.
  it("crear sin isDefault la persiste como false", async () => {
    await service.crear(crearInput(), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }), expect.any(String));
  });

  it("crear con isDefault true lo respeta", async () => {
    await service.crear(crearInput({ isDefault: true }), MAESTRO);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }), expect.any(String));
  });
});

describe("obtener (R9-R13/R17/R19)", () => {
  it("R10: maestro obtiene", async () => {
    const r = await service.obtener("cob-1", MAESTRO);
    expect(r.status).toBe("ok");
  });

  it("R11: admin obtiene (solo lectura)", async () => {
    const r = await service.obtener("cob-1", ADMIN);
    expect(r.status).toBe("ok");
  });

  it("R12: adminTienda no puede obtener -> forbidden", async () => {
    const r = await service.obtener("cob-1", TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("R12: mensajero no puede obtener -> forbidden", async () => {
    const r = await service.obtener("cob-1", MENSAJERO);
    expect(r.status).toBe("forbidden");
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.obtener("cob-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R17/R19: inexistente o borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.obtener("x", MAESTRO);
    expect(r.status).toBe("not_found");
  });
});

describe("listar (R9-R13/R18/R19)", () => {
  it("R10/R11: maestro y admin listan", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const r = await service.listar({ page: 1, pageSize: 20 }, actor);
      expect(r.status).toBe("ok");
    }
  });

  it("R12: adminTienda/mensajero no listan -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.listar({ page: 1, pageSize: 20 }, actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.listar({ page: 1, pageSize: 20 }, DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R18: devuelve items/page/pageSize/total y calcula skip", async () => {
    const r = await service.listar({ page: 2, pageSize: 10 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.page).toBe(2);
      expect(r.pageSize).toBe(10);
      expect(r.total).toBe(1);
    }
    const arg = (repo.list as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBe(10); // (page-1)*pageSize
    expect(arg.take).toBe(10);
  });

  it("R19: no expone borrados (delegado al repo, que ya filtra)", async () => {
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    service = new TarifaService(repo);
    const r = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(0);
  });
});

describe("actualizar (R9-R13/R20-R23)", () => {
  it("R10: maestro aplica solo los campos presentes y delega", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2", fulfillment: 9 }, MAESTRO);
    expect(r.status).toBe("ok");
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toEqual({ tiendaId: "tienda-2", fulfillment: 9 });
  });

  it("R22: no toca id/created_at (no estan en UpdateTarifaData)", async () => {
    await service.actualizar("cob-1", { tiendaId: "tienda-2" }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).not.toHaveProperty("id");
    expect(data).not.toHaveProperty("createdAt");
  });

  it("R11: admin no puede actualizar -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden actualizar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.actualizar("cob-1", { tiendaId: "tienda-2" }, DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  it("R21: inexistente o borrado -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.actualizar("x", { tiendaId: "tienda-2" }, MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Invariante del modelo nuevo, lado actualizar: reasignar a una tienda que no
  // es adminTienda, o reactivar una tarifa de una tienda degradada, se rechaza.
  it("R23: reasignar a una tienda que no es adminTienda -> validation_error sin update", async () => {
    repo = buildRepo({ esTiendaAsignable: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { tiendaId: "no-tienda" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(r.fieldErrors).toHaveProperty("tiendaId");
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("no-tienda");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // ⚠️ CADUCIDAD DECLARADA (feature 274): este test disparaba la revalidacion con
  // `{ status: "activo" }` («reactivar una tarifa revalida su tienda»). `status` ya
  // no existe, asi que ese segundo motivo de la rama se retira. Lo que SI sobrevive
  // -y es lo que este test conserva- es que, cuando `tiendaId` viaja en `null`, la
  // tienda efectiva sigue siendo la de la fila existente y se revalida.
  it("R23: desacotar la tienda revalida la tienda actual -> validation_error si dejo de ser adminTienda", async () => {
    repo = buildRepo({
      // con zona: si no, la guarda de R15 saltaria antes por par (null, null).
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: "degradada", zonaId: "zona-1" })),
      esTiendaAsignable: vi.fn().mockResolvedValue(false),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { tiendaId: null }, MAESTRO);

    expect(r.status).toBe("validation_error");
    // sin tiendaId util en el input, la tienda efectiva es la del registro existente.
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("degradada");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // Actualizar distingue "no viene" de "viene en null": lo primero no toca la
  // columna, lo segundo LIMPIA el pacto especial.
  it("actualizar sin tarifaEspecial no toca la columna", async () => {
    await service.actualizar("cob-1", { fulfillment: 9 }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).not.toHaveProperty("tarifaEspecial");
  });

  it("actualizar con zonaId null desacota la tarifa sin comprobar zona", async () => {
    await service.actualizar("cob-1", { zonaId: null }, MAESTRO);
    expect(repo.existeZona).not.toHaveBeenCalled();
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toHaveProperty("zonaId", null);
  });

  it("actualizar a una zona inexistente -> validation_error sin update", async () => {
    repo = buildRepo({ existeZona: vi.fn().mockResolvedValue(false) });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { zonaId: "no-existe" }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("actualizar con tarifaEspecial null limpia el pacto especial", async () => {
    await service.actualizar("cob-1", { tarifaEspecial: null }, MAESTRO);
    const data = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(data).toHaveProperty("tarifaEspecial", null);
  });

  // ⚠️ Mismo cambio: los dos tramos de `status` (inactivar no revalida, reactivar
  // si) se van con la columna. La rama queda con su primera mitad: solo se revalida
  // cuando `tiendaId` viaja en el input.
  it("R23: solo revalida la tienda si se reasigna", async () => {
    // cambio numerico puro: no hay motivo para revalidar la tienda.
    await service.actualizar("cob-1", { fulfillment: 9 }, MAESTRO);
    expect(repo.esTiendaAsignable).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();

    // cambiar la zona tampoco revalida la tienda.
    await service.actualizar("cob-1", { zonaId: "zona-1" }, MAESTRO);
    expect(repo.esTiendaAsignable).not.toHaveBeenCalled();

    // reasignar el duenno si.
    await service.actualizar("cob-1", { tiendaId: "tienda-2" }, MAESTRO);
    expect(repo.esTiendaAsignable).toHaveBeenCalledWith("tienda-2");
  });
});

// La cascada de resolucion (R1-R6) NO considera la fila `(tienda NULL, zona NULL)`
// como un nivel: una tarifa asi no se le cobra a nadie y ademas ocupa el unico
// `(zona_id, tienda_id)`. Se prohibe en el service porque en `actualizar` el par
// que queda depende de la fila existente y zod no la ve (design 274 §3.3).
describe("274/R14-R16 — la tarifa debe acotar por tienda, por zona o por ambas", () => {
  it("R14: crear sin tienda y sin zona -> validation_error y CERO llamadas al repo", async () => {
    const { tiendaId, ...sinTienda } = crearInput();
    void tiendaId;

    const r = await service.crear(sinTienda, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("tiendaId");
      expect(r.fieldErrors).toHaveProperty("zonaId");
    }
    // No se gasta un viaje a la base en algo ya invalido: ni la comprobacion de
    // tienda, ni la de zona, ni el insert.
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.esTiendaAsignable).not.toHaveBeenCalled();
    expect(repo.existeZona).not.toHaveBeenCalled();
  });

  it("R14: crear con tiendaId null y zonaId null explicitos -> validation_error", async () => {
    const r = await service.crear(crearInput({ tiendaId: null, zonaId: null }), MAESTRO);
    expect(r.status).toBe("validation_error");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("R16: crear con tienda y sin zona -> ok", async () => {
    const r = await service.crear(crearInput({ tiendaId: "tienda-1" }), MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ zonaId: null }), expect.any(String));
  });

  it("R16: crear con zona y sin tienda -> ok", async () => {
    const { tiendaId, ...sinTienda } = crearInput();
    void tiendaId;

    const r = await service.crear({ ...sinTienda, zonaId: "zona-1" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tiendaId: null, zonaId: "zona-1" }), expect.any(String));
  });

  // El caso que la decision del humano nombro explicitamente: desacotar la zona de
  // una tarifa que YA no tenia tienda deja la fila global.
  it("R15: actualizar { zonaId: null } sobre una fila sin tienda -> validation_error sin update", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: null, zonaId: "zona-1" })),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { zonaId: null }, MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors).toHaveProperty("tiendaId");
      expect(r.fieldErrors).toHaveProperty("zonaId");
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("R15: actualizar { tiendaId: null } sobre una fila sin zona -> validation_error sin update", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: "tienda-1", zonaId: null })),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { tiendaId: null }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(repo.update).not.toHaveBeenCalled();
  });

  // El par efectivo se calcula sobre la fila EXISTENTE: el mismo input que arriba
  // es valido aqui porque la fila conserva su zona. Es lo que zod no podria ver.
  it("R16: { tiendaId: null } sobre una fila CON zona -> ok (el par sigue acotado)", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: "tienda-1", zonaId: "zona-1" })),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { tiendaId: null }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.update).toHaveBeenCalledWith("cob-1", { tiendaId: null }, expect.any(String));
  });

  it("R16: { zonaId: null } sobre una fila CON tienda -> ok", async () => {
    repo = buildRepo({
      findById: vi.fn().mockResolvedValue(dto({ tiendaId: "tienda-1", zonaId: "zona-1" })),
    });
    service = new TarifaService(repo);

    const r = await service.actualizar("cob-1", { zonaId: null }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(repo.update).toHaveBeenCalledWith("cob-1", { zonaId: null }, expect.any(String));
  });

  it("R16: un cambio numerico sobre una fila ya acotada no dispara la guarda", async () => {
    const r = await service.actualizar("cob-1", { fulfillment: 9 }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.update).toHaveBeenCalled();
  });
});

describe("274/R12 — el DTO que devuelve el service no lleva `status`", () => {
  it("crear ok: el TarifaDTO no tiene la clave `status`", async () => {
    const r = await service.crear(crearInput(), MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      // assert de AUSENCIA DE CLAVE, no de valor: `undefined` no basta.
      expect(Object.keys(r.tarifa)).not.toContain("status");
      expect(r.tarifa).not.toHaveProperty("status");
    }
  });

  it("obtener/listar tampoco la exponen", async () => {
    const uno = await service.obtener("cob-1", MAESTRO);
    if (uno.status === "ok") expect(uno.tarifa).not.toHaveProperty("status");

    const varias = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    if (varias.status === "ok") {
      for (const item of varias.items) expect(item).not.toHaveProperty("status");
    }
  });
});

describe("borrar (R9-R13)", () => {
  it("R10: maestro borra (borrado FISICO) -> ok", async () => {
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(repo.hardDelete).toHaveBeenCalledWith("cob-1", expect.any(String));
  });

  it("R11: admin no puede borrar -> forbidden", async () => {
    const r = await service.borrar("cob-1", ADMIN);
    expect(r.status).toBe("forbidden");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("R12: adminTienda/mensajero no pueden borrar -> forbidden", async () => {
    for (const actor of [TIENDA, MENSAJERO]) {
      const r = await service.borrar("cob-1", actor);
      expect(r.status).toBe("forbidden");
    }
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("R13: rol no reconocido -> forbidden", async () => {
    const r = await service.borrar("cob-1", DESCONOCIDO);
    expect(r.status).toBe("forbidden");
  });

  // El borrado es FISICO y `cierre_detail.tarifa_id` es FK RESTRICT: una tarifa que
  // ya liquido un cierre no se puede sacar. Eso NO es un "no existe" -existe, y muy
  // concretamente-, y confundirlos le diria al maestro que la borro cuando no.
  it("tarifa congelada en un cierre -> conflict (no not_found)", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("referenced" as const) });
    service = new TarifaService(repo);
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("conflict");
  });

  it("carrera: existia al comprobar y ya no al borrar -> not_found", async () => {
    repo = buildRepo({ hardDelete: vi.fn().mockResolvedValue("not_found" as const) });
    service = new TarifaService(repo);
    const r = await service.borrar("cob-1", MAESTRO);
    expect(r.status).toBe("not_found");
  });

  it("inexistente -> not_found", async () => {
    repo = buildRepo({ findById: vi.fn().mockResolvedValue(null) });
    service = new TarifaService(repo);
    const r = await service.borrar("x", MAESTRO);
    expect(r.status).toBe("not_found");
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it("desaparece del listado tras borrar (repo delega correctamente)", async () => {
    await service.borrar("cob-1", MAESTRO);
    repo = buildRepo({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    service = new TarifaService(repo);
    const r = await service.listar({ page: 1, pageSize: 20 }, MAESTRO);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toHaveLength(0);
  });
});
