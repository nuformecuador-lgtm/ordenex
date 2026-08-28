// PLANTILLA DE TIENDA (2026-08-27). Un interruptor en el formulario declara que el texto de
// esta plantilla NO va a Meta: se envia por el camino wa.me, que no necesita Message Template
// ni aprobacion de nadie. De ahi las tres reglas que se vigilan aqui:
//
//   1. `crear` con el flag encendido guarda `activo` —no `saved_not_aprobation`— y sigue sin
//      tocar a Meta. Nacer como borrador la dejaria esperando un veredicto que nadie emitira.
//   2. `enviarAprobacion` la RECHAZA (`no_aplica`). El boton esta oculto en la UI, pero el
//      guard vive en el service: ocultar un boton no impide la accion, y crear el template en
//      Meta no se deshace.
//   3. `actualizar` no la propaga JAMAS, se edite lo que se edite, y encender el interruptor
//      sobre un borrador lo deja usable (`activo`) en el mismo guardado.
//
// Lo vigilado es sobre todo NEGATIVO —que no salga nada hacia un tercero— porque esa regresion
// no la delata ningun resultado: la plantilla se guarda igual de bien mientras alguien, por
// detras, la manda a Meta de forma irreversible.
import { describe, expect, it, vi } from "vitest";

import { PlantillaMensajeService } from "@/lib/services/PlantillaMensajeService";
import type { PlantillaWhatsappPropagator } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";
import type {
  IPlantillaMensajeRepository,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { Actor } from "@/lib/interfaces/services/IPlantillaMensajeService";

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

function plantilla(overrides: Partial<PlantillaPublica> = {}): PlantillaPublica {
  return {
    id: "pl-1",
    nombre: "aviso_tienda",
    cuerpo: "Hola {{cliente}}",
    variables: ["cliente"],
    variablesNombres: {},
    estado: "saved_not_aprobation",
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: null,
    templateIdioma: null,
    createdBy: "m1",
    createdAt: new Date("2026-08-27"),
    updatedAt: new Date("2026-08-27"),
    ...overrides,
  };
}

function repoFalso(overrides: Partial<IPlantillaMensajeRepository> = {}) {
  const create = vi.fn(
    async (data: { nombre: string; estado: PlantillaPublica["estado"]; plantillaTienda?: boolean }) =>
      plantilla({
        nombre: data.nombre,
        estado: data.estado,
        plantillaTienda: data.plantillaTienda ?? false,
      }),
  );
  const findById = vi.fn(async () => plantilla());
  const update = vi.fn(async () => plantilla());
  const updateEstado = vi.fn(async (_id: string, estado: PlantillaPublica["estado"]) =>
    plantilla({ estado }),
  );
  const findByNombre = vi.fn(async () => null);
  return {
    create,
    findById,
    update,
    updateEstado,
    findByNombre,
    ...overrides,
  } as unknown as IPlantillaMensajeRepository & {
    create: typeof create;
    findById: typeof findById;
    update: typeof update;
    updateEstado: typeof updateEstado;
  };
}

function propagadorFalso() {
  return {
    trasCrear: vi.fn(async () => {}),
    trasActualizar: vi.fn(async () => {}),
    trasEliminar: vi.fn(async () => {}),
  } as unknown as PlantillaWhatsappPropagator & {
    trasCrear: ReturnType<typeof vi.fn>;
    trasActualizar: ReturnType<typeof vi.fn>;
  };
}

describe("crear una plantilla de tienda", () => {
  it("nace `activo` y con el flag persistido", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    const res = await service.crear(
      { nombre: "aviso", cuerpo: "Hola {{cliente}}", plantillaTienda: true },
      MAESTRO,
    );

    expect(res.status).toBe("ok");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "activo", plantillaTienda: true }),
    );
  });

  it("sigue sin tocar a Meta: activa NO significa enviada", async () => {
    const repo = repoFalso();
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    await service.crear({ nombre: "aviso", cuerpo: "Hola", plantillaTienda: true }, MAESTRO);

    expect(whatsapp.trasCrear).not.toHaveBeenCalled();
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
  });

  // El contraste con el caso de arriba es el requisito: el MISMO metodo, con el interruptor
  // apagado, sigue guardando un borrador. El flag no puede cambiar nada mas que esto.
  it("con el interruptor apagado nada cambia: sigue naciendo borrador", async () => {
    const repo = repoFalso();
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    await service.crear({ nombre: "aviso", cuerpo: "Hola", plantillaTienda: false }, MAESTRO);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "saved_not_aprobation", plantillaTienda: false }),
    );
  });
});

describe("enviarAprobacion sobre una plantilla de tienda", () => {
  it("responde `no_aplica` sin llamar a Meta ni tocar el estado", async () => {
    const repo = repoFalso({
      findById: vi.fn(async () => plantilla({ estado: "activo", plantillaTienda: true })),
    } as Partial<IPlantillaMensajeRepository>);
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.enviarAprobacion("pl-1", MAESTRO);

    expect(res.status).toBe("no_aplica");
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
    expect(repo.updateEstado).not.toHaveBeenCalled();
  });
});

describe("actualizar una plantilla de tienda", () => {
  // El caso que mas duele si se rompe: una fila que YA esta enlazada con Meta (porque se
  // marco como de tienda despues) no puede reenviarse al editarla.
  it("no propaga aunque la fila tenga templateId", async () => {
    const deTienda = plantilla({
      estado: "activo",
      plantillaTienda: true,
      templateId: "tpl-1",
    });
    const repo = repoFalso({
      findById: vi.fn(async () => deTienda),
      update: vi.fn(async () => deTienda),
    } as Partial<IPlantillaMensajeRepository>);
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.actualizar("pl-1", { cuerpo: "Otro texto" }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
    expect(repo.updateEstado).not.toHaveBeenCalled();
  });

  // Se mira lo que la plantilla ES al terminar de guardar, no lo que era: el interruptor se
  // enciende en ESTA misma edicion, asi que la fila previa todavia dice `false`.
  it("encender el interruptor sobre un borrador lo deja `activo` y no lo envia", async () => {
    const borrador = plantilla(); // saved_not_aprobation, plantillaTienda false
    const repo = repoFalso({
      findById: vi.fn(async () => borrador),
      update: vi.fn(async () => plantilla({ plantillaTienda: true })),
    } as Partial<IPlantillaMensajeRepository>);
    const whatsapp = propagadorFalso();
    const service = new PlantillaMensajeService(repo, whatsapp);

    const res = await service.actualizar("pl-1", { plantillaTienda: true }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.update).toHaveBeenCalledWith(
      "pl-1",
      expect.objectContaining({ plantillaTienda: true }),
    );
    expect(repo.updateEstado).toHaveBeenCalledWith("pl-1", "activo");
    expect(whatsapp.trasActualizar).not.toHaveBeenCalled();
  });

  // Un `inactivo` puesto a mano es una decision del negocio, no un tramite a medias: marcar la
  // plantilla como de tienda no puede reactivarla por la puerta de atras.
  it("un `inactivo` NO se reactiva al marcarla de tienda", async () => {
    const inactiva = plantilla({ estado: "inactivo" });
    const repo = repoFalso({
      findById: vi.fn(async () => inactiva),
      update: vi.fn(async () => plantilla({ estado: "inactivo", plantillaTienda: true })),
    } as Partial<IPlantillaMensajeRepository>);
    const service = new PlantillaMensajeService(repo, propagadorFalso());

    const res = await service.actualizar("pl-1", { plantillaTienda: true }, MAESTRO);

    expect(res.status).toBe("ok");
    expect(repo.updateEstado).not.toHaveBeenCalled();
  });
});
