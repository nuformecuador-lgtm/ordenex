// Integracion WhatsApp — lector de la orden para el envio de una plantilla. Devuelve los datos
// SOLO si la orden esta vigente Y asignada al mensajero que la solicita (authz:
// `mensajeroAsignadoId`, mismo criterio que `GestionOrdenRepository.findMisAsignaciones`,
// R13). Sin logica de negocio: solo la query scopeada.
//
// SIGUE SIENDO UNA LISTA BLANCA, aunque ahora sea larga. El `select` enumera columna por
// columna lo que el catalogo de plantillas (`lib/types/plantilla-datos.ts`) sabe pintar; NO se
// devuelve el row entero. Dos columnas de `usuario` quedan fuera a proposito y no por
// descuido: `passwordHash` (una credencial) y todo lo que no describa a la persona que va a
// tocar el timbre. Si una plantilla no puede nombrar un dato, ese dato no tiene por que salir
// de la base.
import type { PrismaClient } from "@prisma/client";
import type { DatosPlantilla } from "@/lib/types/plantilla-datos";
import { negocioDesdeEnv } from "@/lib/utils/whatsapp-envio-valores";

type OrdenPrismaClient = Pick<PrismaClient, "orden">;

export interface IOrdenEnvioReader {
  /** Datos de envio de la orden si esta vigente y asignada a `mensajeroId`; `null` si no. */
  findParaEnvio(ordenId: string, mensajeroId: string): Promise<DatosPlantilla | null>;
}

export class OrdenEnvioReader implements IOrdenEnvioReader {
  constructor(private readonly prisma: OrdenPrismaClient) {}

  async findParaEnvio(ordenId: string, mensajeroId: string): Promise<DatosPlantilla | null> {
    const row = await this.prisma.orden.findFirst({
      where: {
        id: ordenId,
        deletedAt: null,
        mensajeroAsignadoId: mensajeroId, // R13: nunca ordenes de otro mensajero
      },
      select: {
        id: true,
        numGuia: true,
        numRemision: true,
        destinatario: true,
        telefonoDest: true,
        direccion: true,
        producto: true,
        peso: true,
        notas: true,
        montoCobrar: true,
        cobraComision: true,
        prioridad: true,
        intentosContacto: true,
        fechaReparto: true,
        asignadoAt: true,
        createdAt: true,
        latitud: true,
        longitud: true,
        downloadUrl: true,
        // El estatus viaja por su `value`; el catalogo lo traduce al vocabulario PUBLICO del
        // rastreo antes de ponerlo en un mensaje. El value interno no cruza esa frontera.
        estatus: { select: { value: true } },
        tienda: { select: { nombre: true } },
        zona: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        distrito: { select: { nombre: true } },
        mensajeroAsignado: {
          select: {
            id: true,
            nombre: true,
            primerApellido: true,
            segundoApellido: true,
            email: true,
            telefono: true,
            cedula: true,
            placa: true,
            estado: true,
            vehiculo: { select: { name: true } },
            zona: { select: { nombre: true } },
          },
        },
      },
    });
    if (row === null) return null;

    const m = row.mensajeroAsignado;
    return {
      orden: {
        id: row.id,
        numGuia: row.numGuia,
        numRemision: row.numRemision,
        estatusValue: row.estatus.value,
        destinatario: row.destinatario,
        telefonoDest: row.telefonoDest,
        direccion: row.direccion,
        producto: row.producto,
        // Decimal de Prisma -> number para el catalogo, que formatea en la capa de texto.
        peso: row.peso === null ? null : Number(row.peso),
        notas: row.notas,
        montoCobrar: row.montoCobrar === null ? null : Number(row.montoCobrar),
        cobraComision: row.cobraComision,
        prioridad: row.prioridad,
        intentosContacto: row.intentosContacto,
        fechaReparto: row.fechaReparto,
        asignadoAt: row.asignadoAt,
        createdAt: row.createdAt,
        latitud: row.latitud === null ? null : Number(row.latitud),
        longitud: row.longitud === null ? null : Number(row.longitud),
        downloadUrl: row.downloadUrl,
        tiendaNombre: row.tienda.nombre,
        zonaNombre: row.zona.nombre,
        provinciaNombre: row.provincia.nombre,
        cantonNombre: row.canton.nombre,
        distritoNombre: row.distrito?.nombre ?? null,
      },
      mensajero: {
        id: m?.id ?? null,
        nombre: m?.nombre ?? null,
        primerApellido: m?.primerApellido ?? null,
        segundoApellido: m?.segundoApellido ?? null,
        email: m?.email ?? null,
        telefono: m?.telefono ?? null,
        cedula: m?.cedula ?? null,
        placa: m?.placa ?? null,
        vehiculoNombre: m?.vehiculo?.name ?? null,
        zonaNombre: m?.zona?.nombre ?? null,
        estado: m?.estado ?? null,
      },
      negocio: negocioDesdeEnv(),
    };
  }
}
