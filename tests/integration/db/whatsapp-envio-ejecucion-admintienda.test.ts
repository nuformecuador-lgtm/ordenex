import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { WhatsappEnvioRepository } from "@/lib/repositories/WhatsappEnvioRepository";
import { WhatsappEjecucionRepository } from "@/lib/repositories/WhatsappEjecucionRepository";
import { EjecucionEnvioService, MOTIVOS, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import { informePruebaEnvio } from "@/lib/whatsapp-envios/informes/prueba-envio";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import {
  HAY_BASE_DE_DATOS,
  clienteConTransaccionAnidada,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { ETIQUETA_ROL, crearEnvio, crearPlantilla, crearUsuario, usuarioModelo } from "./_whatsapp-envios-474";

// Ficha 474 — m4 de la review (enmienda de R16 AL EJECUTAR). El envio se guardo con un usuario
// `admin` elegido por USUARIO; despues ese usuario pasa a `adminTienda`. Con un informe NO apto
// para `adminTienda`, la ejecucion NO se lo envia y deja su entrega VISIBLE (`rechazo_permanente`
// con motivo). El rol sale del SQL de `resolverDestinatarios` en el momento de ejecutar, y la
// entrega excluida se escribe con el INSERT real: por eso se mide contra Postgres, con los dos
// repositorios reales y solo Meta y la plantilla como dobles.
//
// Como correrlo (necesita DATABASE_URL; sin ella el describe se salta):
//   pnpm exec vitest run tests/integration/db/whatsapp-envio-ejecucion-admintienda.test.ts

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const informeNoApto = {
  ...(informePruebaEnvio as unknown as InformeWhatsapp<unknown>),
  aptoParaAdminTienda: false,
  parametros: z.unknown(),
  generar: async () => ({ tipo: "contenido" as const, valores: {} }),
} as InformeWhatsapp<unknown>;

describeSiHayBase("474/R16 enmienda (m4) — adminTienda excluido al ejecutar", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ un usuario que pasa a adminTienda tras guardar NO recibe y queda visible con motivo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const modelo = await usuarioModelo(tx);
      const admin = await crearUsuario(tx, modelo, "admin", { nombre: "474m4 A admin", telefono: "88881111" });
      const cambia = await crearUsuario(tx, modelo, "admin", { nombre: "474m4 B cambia", telefono: "88882222" });
      const p = await crearPlantilla(tx);
      const envioId = await crearEnvio(tx, { plantillaId: p.id, activo: true, usuarioIds: [admin.id, cambia.id] });

      // DESPUES de guardar: cambia de rol a adminTienda.
      await tx.$executeRawUnsafe(
        `UPDATE "usuario" SET "rol_id" = (SELECT r."id" FROM "rol" r WHERE r."value" = $1::"rol_value") WHERE "id" = $2`,
        ETIQUETA_ROL.adminTienda,
        cambia.id,
      );

      const cliente = clienteConTransaccionAnidada(tx);
      const ejecuciones = new WhatsappEjecucionRepository(cliente);
      const ej = await ejecuciones.insertarProgramada({
        envioId,
        fechaCr: "2099-05-01",
        instanteProgramado: new Date("2099-05-01T11:00:00Z"),
      });
      const enviarPlantilla = vi.fn(async () => ({ status: "ok" as const, mensajeId: `wamid.${Math.random()}` }));
      const meta: MetaEnvios = {
        enviador: { enviarPlantilla },
        subidor: { subir: vi.fn() } as unknown as MetaEnvios["subidor"],
        idioma: "es",
      };
      const s = new EjecucionEnvioService({
        envios: new WhatsappEnvioRepository(cliente),
        ejecuciones,
        plantillas: {
          findEnviableDeInformeById: async () => ({
            id: p.id,
            nombre: p.nombre,
            cuerpo: "Hola {{destinatario_nombre}}",
            variables: ["destinatario_nombre"],
            templateId: "tpl-474",
            templateIdioma: "es",
            informeClave: "prueba_envio",
            llevaDocumento: false,
          }),
        },
        almacen: { guardar: vi.fn(), leer: vi.fn(), firmar: vi.fn(), borrar: vi.fn() } as never,
        cola: { enqueue: vi.fn(async () => null) } as never,
        meta: () => meta,
        informe: () => informeNoApto,
        logger: { warn: () => {} },
      });
      const res = await s.ejecutar(ej.id);
      const filas = await tx.$queryRawUnsafe<{ usuario_id: string; estado: string; motivo: string | null }[]>(
        `SELECT "usuario_id", "estado"::text AS "estado", "motivo" FROM "whatsapp_envio_entrega"
          WHERE "ejecucion_id" = $1 ORDER BY "destinatario_nombre"`,
        ej.id,
      );
      return {
        estado: res.estado,
        entregas: filas.map((f) => [f.usuario_id, f.estado, f.motivo]),
        esperado: [
          [admin.id, "aceptada", null],
          [cambia.id, "rechazo_permanente", MOTIVOS.adminTienda],
        ],
        destinos: enviarPlantilla.mock.calls.map((c) => (c as unknown[])[0]),
      };
    });
    expect(r.estado).toBe("completada");
    expect(r.entregas).toEqual(r.esperado);
    expect(r.destinos).toEqual(["50688881111"]); // solo el admin
  });
});
