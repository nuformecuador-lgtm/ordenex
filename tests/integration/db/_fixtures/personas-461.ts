import { randomUUID } from "node:crypto";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";

import type { TxDeTest } from "../_postgres-real";

// FICHA 461 — las PERSONAS de un test que corre DENTRO de una transaccion revertida: se crean en la
// misma `tx`, asi que nunca quedan fuera y nunca las borra nadie a mitad del test.
//
// POR QUE NO `usuario.findFirst()`: los archivos de la 459/461 que COMMITEAN (`sembrarPersonas459` +
// `limpiar459`) crean y borran usuarios mientras los demas corren. Un `findFirst` puede devolver uno
// de esos, que desaparece antes del INSERT con FK y lo tumba con `usuario_..._fkey` (medido el
// 2026-09-25 en `caja-backfill.test.ts` al correr el lote en paralelo). Crear las propias personas
// en la transaccion elimina esa carrera de raiz.

export interface Personas461 {
  maestro: Actor;
  admin: Actor;
  tiendaId: string;
  tiendaNombre: string;
  otraTiendaId: string;
  mensajeroId: string;
}

export async function sembrarPersonas461(tx: TxDeTest): Promise<Personas461> {
  const roles = await tx.rol.findMany({ select: { id: true, value: true } });
  const tipo = await tx.tipoIdentificacion.findUnique({ where: { value: "cedula" }, select: { id: true } });
  const rolDe = (v: string) => {
    const r = roles.find((x) => x.value === v);
    if (r === undefined) throw new Error(`falta el rol «${v}»: corre \`pnpm run db:seed\``);
    return r.id;
  };
  if (tipo === null) throw new Error("falta el tipo `cedula`: corre `pnpm run db:seed`");
  const sufijo = randomUUID().slice(0, 8);
  let n = 0;
  const crear = async (prefijo: string, rol: string) => {
    const clave = `${sufijo}-${(n += 1)}`;
    return tx.usuario.create({
      data: {
        nombre: `${prefijo} 461 ${clave}`,
        primerApellido: "Prueba",
        email: `${prefijo.toLowerCase()}461-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `461-${prefijo}-${clave}`,
        tipoIdentificacionId: tipo.id,
        rolId: rolDe(rol),
        estado: "activo",
      },
      select: { id: true, nombre: true },
    });
  };
  const maestro = await crear("Maestro", "maestro");
  const admin = await crear("Admin", "admin");
  const tienda = await crear("Tienda", "adminTienda");
  const otra = await crear("TiendaOtra", "adminTienda");
  const mensajero = await crear("Mensajero", "mensajero");
  return {
    maestro: { usuarioId: maestro.id, rol: "maestro" },
    admin: { usuarioId: admin.id, rol: "admin" },
    tiendaId: tienda.id,
    tiendaNombre: tienda.nombre,
    otraTiendaId: otra.id,
    mensajeroId: mensajero.id,
  };
}
