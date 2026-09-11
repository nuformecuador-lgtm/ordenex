import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient, RolValue } from "@prisma/client";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import { PushNotificacionReader } from "@/lib/repositories/PushNotificacionReader";
import type { NotificacionDestinatario } from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// FICHA 410 (T3.3, R24/R25) — A QUIEN LE LLEGA EL PUSH ES **EXACTAMENTE** QUIEN VE EL AVISO.
//
// ---------------------------------------------------------------------------------------------
// POR QUE ESTO NO SE PUEDE PROBAR CON DOBLES
// ---------------------------------------------------------------------------------------------
// La equivalencia que R24 exige es entre DOS CONSULTAS SQL: `predicadoVisibilidad` (dado un actor,
// que avisos ve) y `predicadoDestinatariosDeAviso` (dado un aviso, quien lo ve). Un doble no ve el
// SQL —medido cuatro veces en este repositorio—, asi que una mutacion del `WHERE` pasaria en verde
// por el camino de los servicios. Aqui se siembran usuarios y filas de verdad y se compara
// CONJUNTO CONTRA CONJUNTO con lo que `listarParaUsuario` le devuelve a cada uno.
//
// Cubre ademas R21 (un usuario que no esta `activo` NO recibe push aunque el aviso le sea visible)
// y R8 (quien ya lo leyo o lo descarto sale del conjunto).
//
// Todo lo que escribe corre dentro de `enTransaccionRevertida`: si el test pasa, si falla o si el
// proceso muere a mitad, no queda ni una fila en la base compartida.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface UsuarioSembrado {
  id: string;
  rol: RolValue;
  zonaId: string | null;
}

/**
 * La ETIQUETA que cada rol tiene EN LA BASE. No coincide con el identificador de Prisma en un caso
 * y solo en uno: `adminTienda` esta mapeado a `'Admin Tienda'` desde la 21 (`@map`). Escribirlo
 * aqui a mano —y no derivarlo— es lo que hace que el dia que alguien cambie la etiqueta este
 * archivo se ponga rojo en vez de sembrar usuarios sin rol.
 */
const ETIQUETA_EN_BASE: Record<RolValue, string> = {
  maestro: "maestro",
  admin: "admin",
  mensajero: "mensajero",
  adminTienda: "Admin Tienda",
  adminSatelite: "adminSatelite",
  apiKey: "apiKey",
};

/** Crea un usuario con el ROL y la ZONA pedidos, clonando la identidad de uno existente. */
async function crearUsuario(
  tx: TxDeTest,
  modeloUsuarioId: string,
  rol: RolValue,
  zonaId: string | null,
  estado: "activo" | "inactivo" = "activo",
): Promise<UsuarioSembrado> {
  const id = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "usuario"
       ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","zona_id","estado","updated_at")
     SELECT $1, '410 destinatario', $2, '00000000', 'x', $3,
            u."tipo_identificacion_id",
            (SELECT r."id" FROM "rol" r WHERE r."value" = $4::"rol_value"),
            $5, $6::"estado_usuario", CURRENT_TIMESTAMP
       FROM "usuario" u WHERE u."id" = $7`,
    id,
    `410-dest-${id}@test.local`,
    `410d-${id.slice(0, 12)}`,
    ETIQUETA_EN_BASE[rol],
    zonaId,
    estado,
    modeloUsuarioId,
  );
  // ⚠️ FALLA RUIDOSAMENTE si el rol no existe en la base: sin esto el `INSERT` metaria un
  // `rol_id` NULL —o reventaria por la FK— y el conjunto medido seria de otro sistema.
  const comprobacion = await tx.$queryRawUnsafe<{ value: string }[]>(
    `SELECT r."value" FROM "usuario" u JOIN "rol" r ON r."id" = u."rol_id" WHERE u."id" = $1`,
    id,
  );
  expect(comprobacion[0]?.value, `el rol ${rol} no se sembro`).toBe(ETIQUETA_EN_BASE[rol]);
  return { id, rol, zonaId };
}

/** Lee rol y zona de esos usuarios DE LA BASE. El universo de la comparacion sale de aqui. */
async function leerUsuarios(tx: TxDeTest, ids: string[]): Promise<UsuarioSembrado[]> {
  if (ids.length === 0) return [];
  const filas = await tx.$queryRawUnsafe<{ id: string; zona_id: string | null; value: string }[]>(
    `SELECT u."id", u."zona_id", r."value"
       FROM "usuario" u JOIN "rol" r ON r."id" = u."rol_id"
      WHERE u."id" = ANY($1::text[])`,
    ids,
  );
  const inverso = new Map(Object.entries(ETIQUETA_EN_BASE).map(([k, v]) => [v, k as RolValue]));
  return filas.map((f) => ({
    id: f.id,
    rol: inverso.get(f.value) as RolValue,
    zonaId: f.zona_id,
  }));
}

/** El conjunto de usuarios del UNIVERSO que ven `notificacionId` segun `listarParaUsuario`. */
async function quienLoVeEnSuCampana(
  tx: TxDeTest,
  usuarios: UsuarioSembrado[],
  notificacionId: string,
): Promise<string[]> {
  const repo = new NotificacionRepository(tx);
  const vistos: string[] = [];
  for (const u of usuarios) {
    const filas = await repo.listarParaUsuario({
      actor: { usuarioId: u.id, rol: u.rol, zonaId: u.zonaId },
      desde: new Date("2000-01-01T00:00:00.000Z"),
      limite: 200,
    });
    if (filas.some((f) => f.id === notificacionId)) vistos.push(u.id);
  }
  return vistos.sort();
}

/** El conjunto que el canal de push resolveria para esa misma fila. */
async function aQuienLePusharia(tx: TxDeTest, notificacionId: string): Promise<string[]> {
  const lector = new PushNotificacionReader(tx as unknown as PrismaClient);
  const destinatarios = await lector.destinatariosPendientes(notificacionId);
  return destinatarios.map((d) => d.usuarioId).sort();
}

/**
 * ⚠️ EL UNIVERSO DE LA COMPARACION ES LA UNION DE LOS SEMBRADOS Y DE LO QUE EL PUSH DEVUELVE, y
 * eso es deliberado: la base local tiene usuarios de otras corridas y de los seeds, y limitar el
 * universo a los sembrados dejaria FUERA a un destinatario de mas —que es justo el fallo peor de
 * esta ficha (R25: un push a quien no ve el aviso)—. Con la union, cualquiera que el push anada
 * tiene que aparecer tambien por la via de la campana, o el `toEqual` se pone rojo.
 */
async function medirEquivalencia(
  tx: TxDeTest,
  sembrados: UsuarioSembrado[],
  notificacionId: string,
): Promise<{ campana: string[]; push: string[] }> {
  const push = await aQuienLePusharia(tx, notificacionId);
  const ids = [...new Set([...sembrados.map((u) => u.id), ...push])];
  const universo = await leerUsuarios(tx, ids);
  return { campana: await quienLoVeEnSuCampana(tx, universo, notificacionId), push };
}

describeSiHayBase("410/R24-R25 — conjunto contra conjunto, con cuatro formas de alcance", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ los cuatro alcances dan EXACTAMENTE el mismo conjunto por las dos vias", async () => {
    const fks = await fksDeOrden(prisma);
    // ⚠️ FALLA RUIDOSAMENTE si la base esta vacia: sin fila modelo el caso no se puede medir y un
    // `return` temprano lo reportaria `passed` sin comprobar nada.
    expect(fks, "la tabla `orden` esta vacia: el caso no se puede medir").not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = fks!.zonaId;
      // Una segunda zona: sin ella, la rama de zona del predicado no se ejercita de verdad.
      const zonaB = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "zona" ("id","nombre") VALUES ($1, $2)`,
        zonaB,
        `410 zona de prueba ${zonaB.slice(0, 8)}`,
      );

      const tienda1 = await crearUsuario(tx, fks!.tiendaId, "adminTienda", null);
      const tienda2 = await crearUsuario(tx, fks!.tiendaId, "adminTienda", null);
      const admin = await crearUsuario(tx, fks!.tiendaId, "admin", null);
      const sateliteA = await crearUsuario(tx, fks!.tiendaId, "adminSatelite", zonaA);
      const sateliteB = await crearUsuario(tx, fks!.tiendaId, "adminSatelite", zonaB);
      const mensajero = await crearUsuario(tx, fks!.tiendaId, "mensajero", zonaA);
      const sembrados = [tienda1, tienda2, admin, sateliteA, sateliteB, mensajero];

      const repo = new NotificacionRepository(tx);
      const crear = async (destinatario: NotificacionDestinatario): Promise<string> => {
        const id = await repo.crear(
          {
            tipo: "alert",
            evento: "cierre_dia_vencido",
            descripcion: "aviso de prueba de la 410",
            anexo: null,
            entidadTipo: "cierre_dia",
            entidadId: randomUUID(),
            destinatario,
          },
          tx,
        );
        expect(id, "la fila no se creo").not.toBeNull();
        return id!;
      };

      // 1) ROL SIN ALCANCE: lo ve TODO el rol.
      const sinAlcance = await crear({ tipo: "rol", rol: "adminTienda" });
      // 2) ROL ACOTADO POR TIENDA: solo esa tienda.
      const porTienda = await crear({ tipo: "rol", rol: "adminTienda", tiendaId: tienda1.id });
      // 3) ROL ACOTADO POR ZONA: solo el satelite de esa zona.
      const porZona = await crear({ tipo: "rol", rol: "adminSatelite", zonaId: zonaB });
      // 4) DIRIGIDO A UN USUARIO: solo el. `destinatario_rol` va NULL.
      const aUsuario = await crear({ tipo: "usuario", usuarioId: mensajero.id });

      const medir = (id: string) => medirEquivalencia(tx, sembrados, id);

      return {
        sinAlcance: await medir(sinAlcance),
        porTienda: await medir(porTienda),
        porZona: await medir(porZona),
        aUsuario: await medir(aUsuario),
        ids: {
          tienda1: tienda1.id,
          tienda2: tienda2.id,
          admin: admin.id,
          sateliteA: sateliteA.id,
          sateliteB: sateliteB.id,
          mensajero: mensajero.id,
        },
      };
    });

    // CONTROL POSITIVO ANTES DE LA EQUIVALENCIA: sin esto, dos conjuntos VACIOS pasarian el
    // `toEqual` sin haber comprobado nada. Este repo ya pago un test verde sin datos.
    expect(r.sinAlcance.campana.length).toBeGreaterThan(0);
    // Los tres alcances acotados apuntan a UNA persona, y es la sembrada. El sin-alcance tambien
    // alcanza a los `adminTienda` que ya vivieran en la base, asi que ahi solo se exige que
    // contenga a los dos sembrados (y la equivalencia de abajo hace el resto).
    expect(r.porTienda.campana).toEqual([r.ids.tienda1]);
    expect(r.porZona.campana).toEqual([r.ids.sateliteB]);
    expect(r.aUsuario.campana).toEqual([r.ids.mensajero]);
    expect(r.sinAlcance.campana).toContain(r.ids.tienda1);
    expect(r.sinAlcance.campana).toContain(r.ids.tienda2);
    // Y NO alcanza a nadie de otro rol: es la mitad negativa de R25.
    for (const ajeno of [r.ids.admin, r.ids.sateliteA, r.ids.sateliteB, r.ids.mensajero]) {
      expect(r.sinAlcance.campana).not.toContain(ajeno);
      expect(r.sinAlcance.push).not.toContain(ajeno);
    }

    // ⭑ LA EQUIVALENCIA, conjunto contra conjunto, en los cuatro alcances.
    expect(r.sinAlcance.push).toEqual(r.sinAlcance.campana);
    expect(r.porTienda.push).toEqual(r.porTienda.campana);
    expect(r.porZona.push).toEqual(r.porZona.campana);
    expect(r.aUsuario.push).toEqual(r.aUsuario.campana);
  });

  it("⭑ MUTACION R25: sin la rama de ZONA, el satelite de la OTRA zona recibiria el push", async () => {
    // Mutacion 4 del design §15, reproducida A PELO contra el motor: se consulta a los usuarios
    // del rol IGNORANDO la zona de la fila, que es exactamente lo que hace quitar esa rama del
    // predicado. El resultado es un push en el telefono de una bodega que no ve ese aviso.
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const zonaA = fks!.zonaId;
      const zonaB = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "zona" ("id","nombre") VALUES ($1, $2)`,
        zonaB,
        `410 zona mutacion ${zonaB.slice(0, 8)}`,
      );
      const sateliteA = await crearUsuario(tx, fks!.tiendaId, "adminSatelite", zonaA);
      const sateliteB = await crearUsuario(tx, fks!.tiendaId, "adminSatelite", zonaB);

      const repo = new NotificacionRepository(tx);
      const id = await repo.crear(
        {
          tipo: "warning",
          evento: "devoluciones_represadas",
          descripcion: "aviso acotado a la zona B",
          anexo: null,
          entidadTipo: "devoluciones_represadas_dia",
          entidadId: randomUUID(),
          destinatario: { tipo: "rol", rol: "adminSatelite", zonaId: zonaB },
        },
        tx,
      );

      const conZona = await aQuienLePusharia(tx, id!);
      // LA MUTACION: el mismo alcance SIN la rama de zona.
      const sinZona = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT u."id" FROM "usuario" u JOIN "rol" r ON r."id" = u."rol_id"
          WHERE u."estado" = 'activo' AND r."value" = 'adminSatelite'
            AND u."id" IN ($1, $2)
          ORDER BY u."id"`,
        sateliteA.id,
        sateliteB.id,
      );

      return {
        conZona,
        sinZona: sinZona.map((f) => f.id).sort(),
        sateliteA: sateliteA.id,
        sateliteB: sateliteB.id,
      };
    });

    expect(r.conZona).toEqual([r.sateliteB]);
    // Con la mutacion, el satelite de la zona A —que NO ve ese aviso en su campana— tambien
    // recibiria el push. Ahi es donde muere.
    expect(r.sinZona).toEqual([r.sateliteA, r.sateliteB].sort());
    expect(r.sinZona).not.toEqual(r.conZona);
  });
});

describeSiHayBase("410/R21 — quien no esta `activo` no recibe push, aunque vea el aviso", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ un `adminTienda` inactivo queda fuera del conjunto de push", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const activo = await crearUsuario(tx, fks!.tiendaId, "adminTienda", null, "activo");
      const inactivo = await crearUsuario(tx, fks!.tiendaId, "adminTienda", null, "inactivo");

      const repo = new NotificacionRepository(tx);
      const id = await repo.crear(
        {
          tipo: "alert",
          evento: "novedades_sin_gestionar",
          descripcion: "aviso a todo el rol",
          anexo: null,
          entidadTipo: "novedades_sin_gestionar_dia",
          entidadId: randomUUID(),
          destinatario: { tipo: "rol", rol: "adminTienda" },
        },
        tx,
      );

      return {
        push: await aQuienLePusharia(tx, id!),
        activo: activo.id,
        inactivo: inactivo.id,
      };
    });

    expect(r.push).toContain(r.activo);
    // El inactivo SI veria la fila si tuviera sesion —el predicado de visibilidad no mira el
    // estado—, pero no la tiene y no se le empuja. Es lo unico que el espejo anade al original.
    expect(r.push).not.toContain(r.inactivo);
  });
});

describeSiHayBase("410/R8 — quien ya lo leyo o ya lo descarto sale del conjunto", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ de tres admins, el que leyo y el que descarto quedan fuera; el tercero sigue dentro", async () => {
    const fks = await fksDeOrden(prisma);
    expect(fks).not.toBeNull();

    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const leyo = await crearUsuario(tx, fks!.tiendaId, "admin", null);
      const descarto = await crearUsuario(tx, fks!.tiendaId, "admin", null);
      const pendiente = await crearUsuario(tx, fks!.tiendaId, "admin", null);

      const repo = new NotificacionRepository(tx);
      const id = await repo.crear(
        {
          tipo: "alert",
          evento: "cierre_dia_por_aprobar",
          descripcion: "un cierre espera aprobacion",
          anexo: null,
          entidadTipo: "cierre_dia",
          entidadId: randomUUID(),
          destinatario: { tipo: "rol", rol: "admin" },
        },
        tx,
      );

      const antes = await aQuienLePusharia(tx, id!);

      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion_lectura" ("id","notificacion_id","usuario_id","leida_at")
         VALUES ($1,$2,$3,CURRENT_TIMESTAMP)`,
        randomUUID(),
        id,
        leyo.id,
      );
      await repo.descartar(id!, descarto.id, new Date());

      return {
        antes,
        despues: await aQuienLePusharia(tx, id!),
        leyo: leyo.id,
        descarto: descarto.id,
        pendiente: pendiente.id,
      };
    });

    // CONTROL POSITIVO: los tres estaban dentro antes de leer/descartar.
    for (const u of [r.leyo, r.descarto, r.pendiente]) expect(r.antes).toContain(u);
    expect(r.despues).not.toContain(r.leyo);
    expect(r.despues).not.toContain(r.descarto);
    // Y el tercero SIGUE dentro: que un admin lea no apaga el aviso de los demas (146/R3), asi
    // que tampoco puede apagarles el push.
    expect(r.despues).toContain(r.pendiente);
  });
});
