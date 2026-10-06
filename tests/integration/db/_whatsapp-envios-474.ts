import { randomUUID } from "node:crypto";
import type { RolValue } from "@prisma/client";
import type { TxDeTest } from "./_postgres-real";

// Ficha 474 — siembras de los tests de integracion de los envios automaticos por WhatsApp.
// NO es un archivo de test. Todo se usa DENTRO de `enTransaccionRevertida`: no queda ni una fila.
//
// Cada siembra COMPRUEBA que lo sembrado existe (memoria «test de integracion verde sin datos»:
// un `if (!x) return` reporta passed sin comprobar nada). Si falta un usuario modelo, LANZA.

/** Etiqueta de cada rol EN LA BASE (`adminTienda` esta mapeado a «Admin Tienda»). */
export const ETIQUETA_ROL: Record<RolValue, string> = {
  maestro: "maestro",
  admin: "admin",
  mensajero: "mensajero",
  adminTienda: "Admin Tienda",
  adminSatelite: "adminSatelite",
  apiKey: "apiKey",
};

/** Un usuario existente cuya identidad (tipo de identificacion) se clona. Lanza si no hay. */
export async function usuarioModelo(tx: TxDeTest): Promise<string> {
  const filas = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "usuario" ORDER BY "created_at" LIMIT 1`);
  if (filas.length === 0) throw new Error("474: no hay ningun usuario modelo en la base de test");
  return filas[0].id;
}

export interface UsuarioSembrado {
  id: string;
  nombre: string;
  rol: RolValue;
}

export async function crearUsuario(
  tx: TxDeTest,
  modeloId: string,
  rol: RolValue,
  opts: { nombre?: string; telefono?: string; estado?: "activo" | "inactivo" | "pendiente" | "bloqueado" } = {},
): Promise<UsuarioSembrado> {
  const id = randomUUID();
  const nombre = opts.nombre ?? `474 ${rol} ${id.slice(0, 6)}`;
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","estado","updated_at")
     SELECT $1, $2, $3, $4, 'x', $5, u."tipo_identificacion_id",
            (SELECT r."id" FROM "rol" r WHERE r."value" = $6::"rol_value"),
            $7::"estado_usuario", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $8`,
    id,
    nombre,
    `474-${id}@test.local`,
    opts.telefono ?? "88887777",
    `474-${id.slice(0, 12)}`,
    ETIQUETA_ROL[rol],
    opts.estado ?? "activo",
    modeloId,
  );
  const ok = await tx.$queryRawUnsafe<{ value: string }[]>(
    `SELECT r."value" FROM "usuario" u JOIN "rol" r ON r."id" = u."rol_id" WHERE u."id" = $1`,
    id,
  );
  if (ok[0]?.value !== ETIQUETA_ROL[rol]) throw new Error(`474: el usuario ${rol} no se sembro`);
  return { id, nombre, rol };
}

export interface PlantillaSembrada {
  id: string;
  nombre: string;
}

export async function crearPlantilla(
  tx: TxDeTest,
  opts: {
    informeClave?: string | null;
    llevaDocumento?: boolean;
    estado?: "activo" | "pending" | "saved_not_aprobation" | "inactivo";
    templateId?: string | null;
    cuerpo?: string;
    variables?: string[];
  } = {},
): Promise<PlantillaSembrada> {
  const id = randomUUID();
  const nombre = `p474_${id.replace(/-/g, "").slice(0, 16)}`;
  await tx.$executeRawUnsafe(
    `INSERT INTO "plantilla_mensaje"
       ("id","nombre","cuerpo","variables","estado","template_id","template_idioma","informe_clave","lleva_documento","updated_at")
     VALUES ($1,$2,$3,$4::text[],$5::"plantilla_estado",$6,'es',$7,$8,CURRENT_TIMESTAMP)`,
    id,
    nombre,
    opts.cuerpo ?? "Hola {{destinatario_nombre}}",
    opts.variables ?? ["destinatario_nombre"],
    opts.estado ?? "activo",
    opts.templateId === undefined ? "tpl-474" : opts.templateId,
    opts.informeClave === undefined ? "prueba_envio" : opts.informeClave,
    opts.llevaDocumento ?? false,
  );
  return { id, nombre };
}

export async function crearEnvio(
  tx: TxDeTest,
  opts: {
    plantillaId: string;
    nombre?: string;
    informeClave?: string;
    disparo?: "hora_fija" | "evento";
    eventoClave?: string | null;
    dias?: number[];
    hora?: string | null;
    activo?: boolean;
    borrado?: boolean;
    roles?: RolValue[];
    usuarioIds?: string[];
  },
): Promise<string> {
  const id = randomUUID();
  const disparo = opts.disparo ?? "hora_fija";
  await tx.$executeRawUnsafe(
    `INSERT INTO "whatsapp_envio"
       ("id","nombre","informe_clave","plantilla_id","disparo","dias_semana","hora","evento_clave","activo","deleted_at","updated_at")
     VALUES ($1,$2,$3,$4,$5::"whatsapp_envio_disparo",$6::smallint[],$7,$8,$9,$10,CURRENT_TIMESTAMP)`,
    id,
    opts.nombre ?? `envio 474 ${id.slice(0, 8)}`,
    opts.informeClave ?? (disparo === "evento" ? "aviso_interno" : "prueba_envio"),
    opts.plantillaId,
    disparo,
    disparo === "hora_fija" ? (opts.dias ?? [1, 2, 3, 4, 5]) : null,
    disparo === "hora_fija" ? (opts.hora ?? "05:00") : null,
    disparo === "evento" ? (opts.eventoClave ?? "geocodificacion_caida") : null,
    opts.activo ?? false,
    opts.borrado ? new Date() : null,
  );
  for (const rol of opts.roles ?? []) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "whatsapp_envio_destinatario" ("id","envio_id","rol") VALUES ($1,$2,$3::"rol_value")`,
      randomUUID(),
      id,
      ETIQUETA_ROL[rol],
    );
  }
  for (const usuarioId of opts.usuarioIds ?? []) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "whatsapp_envio_destinatario" ("id","envio_id","usuario_id") VALUES ($1,$2,$3)`,
      randomUUID(),
      id,
      usuarioId,
    );
  }
  return id;
}

/**
 * Apaga, DENTRO de la transaccion del test, todo envio preexistente de la base (los de otros
 * tests son revertidos, pero un envio real de la base local contaminaria el conjunto medido).
 */
export async function aislarEnvios(tx: TxDeTest): Promise<void> {
  await tx.$executeRawUnsafe(`UPDATE "whatsapp_envio" SET "activo" = false WHERE "activo"`);
}
