import { describe, it, expect, vi } from "vitest";

import {
  SincronizarPlantillasWhatsappService,
  mapEstadoMeta,
} from "@/lib/services/SincronizarPlantillasWhatsappService";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import type { PlantillaResumen, WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

// SINCRONIZACION Meta -> local, reescrita el 2026-08-27 por pedido humano:
//   1. ya NO importa plantillas que solo existen en Meta, y
//   2. solo ESCRIBE las locales que de verdad cambiaron.
//
// Lo que este archivo protege es justo lo que un refactor bienintencionado deshace: alguien
// lee «sincroniza» y vuelve a poner el `create`, o cambia el compara-y-escribe por un
// `updateMany` incondicional «porque es una consulta menos». La primera regresion mete
// plantillas sin cuerpo del catalogo en el modulo; la segunda mueve el `updatedAt` de toda la
// tabla cada 24 h. Ninguna de las dos rompe nada visible el dia que se comete.

function template(overrides: Partial<PlantillaResumen> = {}): PlantillaResumen {
  return {
    id: "meta-1",
    nombre: "listo_para_entrega_mensajero",
    idioma: "es",
    status: "APPROVED",
    categoria: "UTILITY",
    ...overrides,
  };
}

function clienteFalso(templates: PlantillaResumen[]): WhatsappPlantillasClient {
  return { listar: vi.fn().mockResolvedValue(templates) } as unknown as WhatsappPlantillasClient;
}

describe("SincronizarPlantillasWhatsappService", () => {
  it("cuenta por desenlace: actualizadas, sin cambios e ignoradas", async () => {
    const repo = {
      sincronizarTemplatePorNombre: vi
        .fn()
        .mockResolvedValueOnce("actualizada")
        .mockResolvedValueOnce("sin_cambios")
        .mockResolvedValueOnce("inexistente"),
    } as unknown as IPlantillaMensajeRepository;
    const service = new SincronizarPlantillasWhatsappService(
      clienteFalso([
        template({ nombre: "a" }),
        template({ nombre: "b" }),
        template({ nombre: "solo_en_meta" }),
      ]),
      repo,
    );

    expect(await service.sincronizar()).toEqual({
      leidas: 3,
      actualizadas: 1,
      sinCambios: 1,
      ignoradas: 1,
    });
  });

  it("un template que no existe aqui NO se crea: se ignora y ya", async () => {
    // El caso `hello_world`: aparecio en la WABA, se importo sola y quedo en el listado del
    // maestro sin cuerpo que el catalogo entienda. Ahora se cuenta y no se toca la base.
    const repo = {
      sincronizarTemplatePorNombre: vi.fn().mockResolvedValue("inexistente"),
    } as unknown as IPlantillaMensajeRepository;
    const service = new SincronizarPlantillasWhatsappService(
      clienteFalso([template({ nombre: "hello_world" })]),
      repo,
    );

    const r = await service.sincronizar();

    expect(r).toEqual({ leidas: 1, actualizadas: 0, sinCambios: 0, ignoradas: 1 });
    // La afirmacion que importa: el repositorio NO expone ninguna via de alta al sync.
    expect("crearDesdeMeta" in repo).toBe(false);
  });

  it("traduce el status de Meta y se lo pasa al repositorio, con el enlace del template", async () => {
    const sincronizar = vi.fn().mockResolvedValue("actualizada");
    const service = new SincronizarPlantillasWhatsappService(
      clienteFalso([template({ id: "t-9", nombre: "x", idioma: "es_CR", status: "REJECTED" })]),
      { sincronizarTemplatePorNombre: sincronizar } as unknown as IPlantillaMensajeRepository,
    );

    await service.sincronizar();

    expect(sincronizar).toHaveBeenCalledWith("x", {
      templateId: "t-9",
      idioma: "es_CR",
      estado: "refused",
    });
  });

  it("sin templates en Meta: cero de todo, y ni una escritura", async () => {
    const repo = {
      sincronizarTemplatePorNombre: vi.fn(),
    } as unknown as IPlantillaMensajeRepository;
    const service = new SincronizarPlantillasWhatsappService(clienteFalso([]), repo);

    expect(await service.sincronizar()).toEqual({
      leidas: 0,
      actualizadas: 0,
      sinCambios: 0,
      ignoradas: 0,
    });
    expect(repo.sincronizarTemplatePorNombre).not.toHaveBeenCalled();
  });
});

describe("mapEstadoMeta", () => {
  it.each([
    ["APPROVED", "activo"],
    ["approved", "activo"],
    ["REJECTED", "refused"],
    ["PENDING", "pending"],
    ["IN_APPEAL", "pending"],
    ["PENDING_DELETION", "pending"],
    ["LO_QUE_META_INVENTE_MAÑANA", "pending"],
  ])("%s -> %s", (status, esperado) => {
    expect(mapEstadoMeta(status)).toBe(esperado);
  });
});

/**
 * Prisma falso que ANOTA las lecturas y escrituras. Lo que se comprueba abajo no es el SQL
 * sino DOS cosas que no se ven en un diff: que la comparacion ocurre antes de escribir, y que
 * cuando no hay nada que cambiar NO se emite ningun `update`.
 */
function prismaEspia(fila: Record<string, unknown> | null) {
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const prisma = {
    plantillaMensaje: {
      findFirst: vi.fn().mockResolvedValue(fila),
      update: vi.fn(async (args: { where: unknown; data: unknown }) => {
        updates.push(args);
        return {};
      }),
    },
  };
  return { prisma, updates };
}

const FILA_AL_DIA = {
  id: "pl-1",
  templateId: "meta-1",
  templateIdioma: "es",
  estado: "activo" as const,
  welcomeMessage: false,
};

const DATOS_META = { templateId: "meta-1", idioma: "es", estado: "activo" as const };

describe("PlantillaMensajeRepository.sincronizarTemplatePorNombre", () => {
  it("todo coincide -> `sin_cambios` y NI UN update (el `updatedAt` no se mueve)", async () => {
    const { prisma, updates } = prismaEspia(FILA_AL_DIA);
    const repo = new PlantillaMensajeRepository(prisma as never);

    const r = await repo.sincronizarTemplatePorNombre("x", DATOS_META);

    expect(r).toBe("sin_cambios");
    expect(updates).toEqual([]);
  });

  it.each([
    ["templateId", { ...FILA_AL_DIA, templateId: "otro" }],
    ["idioma", { ...FILA_AL_DIA, templateIdioma: "es_CR" }],
    ["estado", { ...FILA_AL_DIA, estado: "pending" as const }],
  ])("difiere %s -> `actualizada`, en UN solo update por id", async (_campo, fila) => {
    const { prisma, updates } = prismaEspia(fila);
    const repo = new PlantillaMensajeRepository(prisma as never);

    const r = await repo.sincronizarTemplatePorNombre("x", DATOS_META);

    expect(r).toBe("actualizada");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      where: { id: "pl-1" },
      data: {
        templateId: "meta-1",
        templateIdioma: "es",
        estado: "activo",
        welcomeMessage: false,
      },
    });
  });

  it("sin fila local -> `inexistente`, sin escribir nada", async () => {
    const { prisma, updates } = prismaEspia(null);
    const repo = new PlantillaMensajeRepository(prisma as never);

    expect(await repo.sincronizarTemplatePorNombre("solo_en_meta", DATOS_META)).toBe(
      "inexistente",
    );
    expect(updates).toEqual([]);
  });

  it("un `inactivo` local NO se reactiva desde Meta, ni cuenta como cambio", async () => {
    // La desactivacion local decide si el mensajero puede enviarla, y es del negocio, no de
    // Meta. Ademas: si el estado destino no se resolviera ANTES de comparar, una plantilla
    // `inactivo` cuya aprobacion sigue viva en Meta se contaria como «cambiada» en CADA
    // corrida y se reescribiria eternamente sin cambiar nada.
    const { prisma, updates } = prismaEspia({ ...FILA_AL_DIA, estado: "inactivo" as const });
    const repo = new PlantillaMensajeRepository(prisma as never);

    const r = await repo.sincronizarTemplatePorNombre("x", DATOS_META);

    expect(r).toBe("sin_cambios");
    expect(updates).toEqual([]);
  });

  it("`inactivo` con el enlace desactualizado: se actualiza el enlace y el estado SIGUE inactivo", async () => {
    const { prisma, updates } = prismaEspia({
      ...FILA_AL_DIA,
      estado: "inactivo" as const,
      templateId: "viejo",
    });
    const repo = new PlantillaMensajeRepository(prisma as never);

    const r = await repo.sincronizarTemplatePorNombre("x", DATOS_META);

    expect(r).toBe("actualizada");
    expect(updates[0].data).toEqual({
      templateId: "meta-1",
      templateIdioma: "es",
      estado: "inactivo", // <- lo de Meta era `activo`; no lo reactiva
      welcomeMessage: false,
    });
  });

  it("Meta RECHAZA la bienvenida: se desmarca sola, en la misma escritura", async () => {
    // El caso que solo llega por aqui: nadie toco nada en la app, fue Meta quien movio el
    // template de APPROVED a REJECTED. Si la marca sobreviviera, el negocio creeria tener
    // bienvenida configurada y el cliente no recibiria nada al recoger el paquete.
    const { prisma, updates } = prismaEspia({ ...FILA_AL_DIA, welcomeMessage: true });
    const repo = new PlantillaMensajeRepository(prisma as never);

    const r = await repo.sincronizarTemplatePorNombre("x", { ...DATOS_META, estado: "refused" });

    expect(r).toBe("actualizada");
    expect(updates[0].data).toEqual({
      templateId: "meta-1",
      templateIdioma: "es",
      estado: "refused",
      welcomeMessage: false,
    });
  });

  it("la marca cuelga de una plantilla que ya no es `activo`: se limpia AUNQUE nada mas difiera", async () => {
    // Si `welcomeMessage` no entrara en la COMPARACION, esta fila se contaria como
    // `sin_cambios` y la marca sobreviviria indefinidamente a su plantilla. Es el unico caso
    // en que el desajuste es SOLO la marca.
    const { prisma, updates } = prismaEspia({
      ...FILA_AL_DIA,
      estado: "inactivo" as const,
      welcomeMessage: true,
    });
    const repo = new PlantillaMensajeRepository(prisma as never);

    expect(await repo.sincronizarTemplatePorNombre("x", DATOS_META)).toBe("actualizada");
    expect(updates[0].data).toMatchObject({ estado: "inactivo", welcomeMessage: false });
  });

  it("la bienvenida sigue `activo`: la marca NO se toca y no hay escritura", async () => {
    // El reverso del caso anterior: sincronizar la bienvenida vigente no puede desmarcarla.
    const { prisma, updates } = prismaEspia({ ...FILA_AL_DIA, welcomeMessage: true });
    const repo = new PlantillaMensajeRepository(prisma as never);

    expect(await repo.sincronizarTemplatePorNombre("x", DATOS_META)).toBe("sin_cambios");
    expect(updates).toEqual([]);
  });

  it("solo mira plantillas VIGENTES: una borrada no es candidata", async () => {
    const { prisma } = prismaEspia(null);
    const repo = new PlantillaMensajeRepository(prisma as never);

    await repo.sincronizarTemplatePorNombre("x", DATOS_META);

    expect(prisma.plantillaMensaje.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nombre: "x", deletedAt: null } }),
    );
  });
});
