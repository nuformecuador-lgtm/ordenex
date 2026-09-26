import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 — piezas de los tests que pasan POR LAS SERVER ACTIONS y COMMITEAN.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE COMMITEAN: la action construye su servicio con `getPrismaClient()` —el composition
// root REAL— y abre SU transaccion. Un test que la envolviera en una transaccion revertida ya no
// estaria probando el composition root (memoria «el composition root que no inyecta»). El precio
// es limpiar a mano: `limpiar459` borra, en el orden que exigen las FK, todo lo que cuelga de las
// personas sembradas, y corre en un `finally`.
//
// POR QUE UN CANDADO: el saldo inicial es UNICO en toda la base (R70). Dos archivos de esta ficha
// que registren un saldo inicial a la vez se pisarian. `conCandado459` toma un advisory lock de
// transaccion con una clave propia y lo sostiene mientras corre el cuerpo del test: los archivos
// de la 459 que escriben se serializan entre si, sin frenar a nadie mas.

export const CLAVE_CANDADO_459 = 459_0001;

export async function conCandado459<T>(prisma: PrismaClient, cuerpo: () => Promise<T>): Promise<T> {
  let soltar: () => void = () => undefined;
  const fin = new Promise<void>((r) => {
    soltar = r;
  });
  let tomado: () => void = () => undefined;
  const listo = new Promise<void>((r) => {
    tomado = r;
  });
  const sosten = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CLAVE_CANDADO_459})`);
      tomado();
      await fin;
    },
    { timeout: 300_000, maxWait: 120_000 },
  );
  try {
    await listo;
    return await cuerpo();
  } finally {
    soltar();
    await sosten;
  }
}

export interface Personas459 {
  maestro: Actor;
  admin: Actor;
  mensajero: Actor;
  tiendaId: string;
  tiendaNombre: string;
  tiendaInactivaId: string;
  otraTiendaId: string;
  usuarios: string[];
}

/** Siembra COMMITEADA de las personas de un test. Todas con sufijo aleatorio. */
export async function sembrarPersonas459(prisma: PrismaClient): Promise<Personas459> {
  const roles = await prisma.rol.findMany({ select: { id: true, value: true } });
  const tipo = await prisma.tipoIdentificacion.findUnique({ where: { value: "cedula" }, select: { id: true } });
  const rolDe = (v: string) => {
    const r = roles.find((x) => x.value === v);
    if (r === undefined) throw new Error(`falta el rol «${v}»: corre \`pnpm run db:seed\``);
    return r.id;
  };
  if (tipo === null) throw new Error("falta el tipo `cedula`: corre `pnpm run db:seed`");
  const sufijo = randomUUID().slice(0, 8);
  let n = 0;
  const usuarios: string[] = [];
  const crear = async (prefijo: string, rol: string, estado: "activo" | "inactivo" = "activo") => {
    const clave = `${sufijo}-${(n += 1)}`;
    const u = await prisma.usuario.create({
      data: {
        nombre: `${prefijo} 459 ${clave}`,
        email: `${prefijo.toLowerCase()}459e-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `459E-${prefijo}-${clave}`,
        tipoIdentificacionId: tipo.id,
        rolId: rolDe(rol),
        estado,
      },
      select: { id: true, nombre: true },
    });
    usuarios.push(u.id);
    return u;
  };
  const maestro = await crear("Maestro", "maestro");
  const admin = await crear("Admin", "admin");
  const mensajero = await crear("Mensajero", "mensajero");
  const tienda = await crear("TiendaE", "adminTienda");
  const inactiva = await crear("TiendaI", "adminTienda", "inactivo");
  const otra = await crear("TiendaO", "adminTienda");
  return {
    maestro: { usuarioId: maestro.id, rol: "maestro" },
    admin: { usuarioId: admin.id, rol: "admin" },
    mensajero: { usuarioId: mensajero.id, rol: "mensajero" },
    tiendaId: tienda.id,
    tiendaNombre: tienda.nombre,
    tiendaInactivaId: inactiva.id,
    otraTiendaId: otra.id,
    usuarios,
  };
}

/** Un credito de partida en el libro de una tienda (le da saldo a favor). Commiteado. */
export async function acreditar459(prisma: PrismaClient, tiendaId: string, monto: string): Promise<void> {
  await prisma.walletTiendaMovimiento.create({
    data: {
      tiendaId,
      tipo: "credito",
      categoria: "cod_recaudado",
      monto: new Prisma.Decimal(monto),
      origenTipo: "manual",
      origenId: null,
      descripcion: "semilla 459",
    },
  });
}

/**
 * Borra TODO lo que cuelga de las personas sembradas, en el orden que piden las FK (todas RESTRICT).
 * Los libros de dinero solo se borran aqui porque las filas son de ESTE test y nunca existieron
 * fuera de la base de pruebas.
 */
export async function limpiar459(prisma: PrismaClient, p: Personas459 | null): Promise<void> {
  if (p === null) return;
  const usuarios = p.usuarios;
  const pagos = await prisma.pagoPorCuentaTienda.findMany({
    where: { OR: [{ tiendaId: { in: usuarios } }, { registradoPor: { in: usuarios } }] },
    select: { id: true },
  });
  const aportes = await prisma.aporteCapital.findMany({
    where: { registradoPor: { in: usuarios } },
    select: { id: true },
  });
  const documentos = [...pagos.map((x) => x.id), ...aportes.map((x) => x.id)];
  await prisma.historialAccion.deleteMany({
    where: { OR: [{ entidadId: { in: documentos } }, { actorUsuarioId: { in: usuarios } }] },
  });
  await prisma.pagoPorCuentaTiendaAnulacion.deleteMany({ where: { pagoId: { in: pagos.map((x) => x.id) } } });
  await prisma.aporteCapitalAnulacion.deleteMany({ where: { aporteId: { in: aportes.map((x) => x.id) } } });
  // Ficha 461: las anulaciones cuelgan por FK RESTRICT de las filas de los libros; van ANTES.
  await prisma.cobroTiendaAnulacion.deleteMany({
    where: { OR: [{ anuladoPor: { in: usuarios } }, { cobro: { tiendaId: { in: usuarios } } }] },
  });
  await prisma.ajusteCajaAnulacion.deleteMany({
    where: { OR: [{ anuladoPor: { in: usuarios } }, { movimiento: { registradoPor: { in: usuarios } } }] },
  });
  await prisma.walletMovimiento.deleteMany({
    where: { OR: [{ origenId: { in: documentos } }, { registradoPor: { in: usuarios } }] },
  });
  await prisma.walletTiendaMovimiento.deleteMany({
    where: { OR: [{ tiendaId: { in: usuarios } }, { registradoPor: { in: usuarios } }] },
  });
  // Los pagos de Ordenex a una tienda que siembran los tests de concurrencia (T B.13).
  await prisma.liquidacionPago.deleteMany({ where: { tiendaId: { in: usuarios } } });
  await prisma.pagoPorCuentaTienda.deleteMany({ where: { id: { in: pagos.map((x) => x.id) } } });
  await prisma.aporteCapital.deleteMany({ where: { id: { in: aportes.map((x) => x.id) } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
}

/** Un `FormData` como el que arma el dialogo: solo las claves que se le pasan. */
export function formData459(campos: Record<string, string | Blob | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (v !== undefined) f.append(k, v);
  }
  return f;
}
