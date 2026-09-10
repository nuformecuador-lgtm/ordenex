import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";

// Feature 99 (R6, habilita R12/R21/R24/R25) — Prisma mockeado con semantica (patron del
// resto de tests/integration/repositories: la suite NO levanta Postgres). El fake ejecuta el
// comportamiento que importa: upsert por owner (no duplica), lectura sin secreto, baja logica
// y el guard de rol apiKey.

interface Fila {
  ownerUsuarioId: string;
  url: string;
  secret: string;
  activa: boolean;
  /** FICHA 403 (R1): las dos columnas del circuito. Ningun flag `pausada`: es DERIVADO. */
  fallosConsecutivos: number;
  sinExitoDesde: Date;
}

/** FICHA 403: umbral fijo (los defaults de R8) para que los casos digan con que se miden. */
const PAUSA = { fallosMinimos: 3, ventanaMs: 30 * 60_000 };
const AHORA = new Date("2026-09-09T12:00:00.000Z");
/** `AHORA - minutos`, para escribir anclas legibles. */
function haceMinutos(minutos: number): Date {
  return new Date(AHORA.getTime() - minutos * 60_000);
}
/** Una fila con los defaults de la migracion (contador a 0, ancla = alta). */
function fila(over: Partial<Fila> & { ownerUsuarioId: string }): Fila {
  return {
    url: "https://a",
    secret: "enc",
    activa: true,
    fallosConsecutivos: 0,
    sinExitoDesde: AHORA,
    ...over,
  };
}

/**
 * Feature 302: lo que el repositorio necesita saber de una cuenta para decidir a nombre de quien
 * cuelga la suscripcion. `tiendaDestinoDeSuKey === undefined` = la cuenta no tiene fila en
 * `api_key`; `null` = tiene key pero sin tienda destino (el caso historico).
 */
interface CanalUsuario {
  tiendaDestinoDeSuKey?: string | null;
  esTiendaDestinoDeAlguna?: boolean;
}

function buildPrisma(
  filas: Fila[] = [],
  rolPorUsuario: Record<string, string> = {},
  canal: Record<string, CanalUsuario> = {},
) {
  const webhookSuscripcion = {
    upsert: vi.fn(
      async (args: {
        where: { ownerUsuarioId: string };
        // El `create` del repositorio NO trae las columnas del circuito: las pone el DEFAULT de la
        // migracion. Por eso se tipa como parcial en ellas — reflejar eso es lo que permite que
        // este archivo afirme sobre el alta.
        create: Omit<Fila, "fallosConsecutivos" | "sinExitoDesde">;
        update: Partial<Fila>;
      }) => {
        const existente = filas.find((f) => f.ownerUsuarioId === args.where.ownerUsuarioId);
        if (existente) Object.assign(existente, args.update);
        // FICHA 403: el doble reproduce el DEFAULT de la migracion (0 y `now()`).
        else filas.push({ fallosConsecutivos: 0, sinExitoDesde: AHORA, ...args.create });
      },
    ),
    findUnique: vi.fn(async (args: { where: { ownerUsuarioId: string }; select: Record<string, boolean> }) => {
      const f = filas.find((x) => x.ownerUsuarioId === args.where.ownerUsuarioId);
      if (!f) return null;
      const proj: Record<string, unknown> = {};
      for (const k of Object.keys(args.select)) proj[k] = (f as unknown as Record<string, unknown>)[k];
      return proj;
    }),
    updateMany: vi.fn(async (args: { where: { ownerUsuarioId: string }; data: Partial<Fila> }) => {
      const f = filas.find((x) => x.ownerUsuarioId === args.where.ownerUsuarioId);
      if (f) Object.assign(f, args.data);
      return { count: f ? 1 : 0 };
    }),
    /**
     * FICHA 403: `update` sobre la clave unica. Reproduce las DOS semanticas que el repositorio
     * usa de verdad: el `{ increment: n }` de Prisma (que se resuelve EN LA BASE, no en memoria) y
     * el `P2025` cuando no hay fila. Sin el `P2025` el caso "la suscripcion se borro entre el
     * encolado y la entrega" quedaria sin medir.
     */
    update: vi.fn(
      async (args: {
        where: { ownerUsuarioId: string };
        data: Record<string, unknown>;
        select: Record<string, boolean>;
      }) => {
        const f = filas.find((x) => x.ownerUsuarioId === args.where.ownerUsuarioId);
        if (!f) throw new Prisma.PrismaClientKnownRequestError("record to update not found", {
          code: "P2025",
          clientVersion: "test",
        });
        for (const [k, v] of Object.entries(args.data)) {
          if (typeof v === "object" && v !== null && "increment" in v) {
            const actual = (f as unknown as Record<string, number>)[k];
            (f as unknown as Record<string, number>)[k] = actual + (v as { increment: number }).increment;
          } else {
            (f as unknown as Record<string, unknown>)[k] = v;
          }
        }
        const proj: Record<string, unknown> = {};
        for (const k of Object.keys(args.select)) proj[k] = (f as unknown as Record<string, unknown>)[k];
        return proj;
      },
    ),
  };
  const usuario = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      const rol = rolPorUsuario[args.where.id];
      if (!rol) return null;
      const c: CanalUsuario = canal[args.where.id] ?? {};
      return {
        rol: { value: rol },
        // El include del repositorio: la key de ESTA cuenta (1:1) y las keys que cargan a su
        // nombre (`take: 1`, solo interesa si hay alguna).
        apiKey:
          c.tiendaDestinoDeSuKey === undefined
            ? null
            : { tiendaDestinoId: c.tiendaDestinoDeSuKey },
        apiKeysComoTiendaDestino: c.esTiendaDestinoDeAlguna ? [{ id: "k-alguna" }] : [],
      };
    }),
  };
  return { prisma: { webhookSuscripcion, usuario } as unknown as PrismaClient, filas };
}

describe("R6 — upsert por owner", () => {
  it("un segundo registro del mismo owner actualiza la fila, no crea otra", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.upsertByOwner({ ownerUsuarioId: "owner-1", url: "https://a.example.com", secret: "enc1" });
    await repo.upsertByOwner({ ownerUsuarioId: "owner-1", url: "https://b.example.com", secret: "enc2" });

    expect(filas).toHaveLength(1);
    expect(filas[0].url).toBe("https://b.example.com");
    expect(filas[0].secret).toBe("enc2");
    expect(filas[0].activa).toBe(true); // re-registrar reactiva
  });
});

describe("R33 (gate P4) — actualizarUrlByOwner conserva el secreto", () => {
  it("actualiza solo la url y reactiva, sin tocar el secreto", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", url: "https://a", secret: "enc-original", activa: false }),
      fila({ ownerUsuarioId: "o2", url: "https://b", secret: "enc-o2", activa: true }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.actualizarUrlByOwner("o1", "https://nueva");
    const o1 = filas.find((f) => f.ownerUsuarioId === "o1")!;
    expect(o1.url).toBe("https://nueva");
    expect(o1.secret).toBe("enc-original"); // secreto intacto: editar no rota
    expect(o1.activa).toBe(true); // reactiva
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.url).toBe("https://b"); // R9
  });

  it("es no-op si el owner no tiene fila", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.actualizarUrlByOwner("inexistente", "https://x");
    expect(filas).toHaveLength(0);
  });
});

describe("R34 (gate P4) — actualizarSecretoByOwner rota solo el secreto", () => {
  it("actualiza solo el ciphertext del secreto, conservando url y activa", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", url: "https://a", secret: "enc-viejo", activa: true }),
      fila({ ownerUsuarioId: "o2", url: "https://b", secret: "enc-o2", activa: true }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.actualizarSecretoByOwner("o1", "enc-nuevo");
    const o1 = filas.find((f) => f.ownerUsuarioId === "o1")!;
    expect(o1.secret).toBe("enc-nuevo"); // invalida el anterior
    expect(o1.url).toBe("https://a"); // url intacta
    expect(o1.activa).toBe(true);
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.secret).toBe("enc-o2"); // R9
  });
});

describe("findActivaByOwner / findByOwner (habilita R21/R24, R7)", () => {
  it("findActivaByOwner devuelve el ciphertext solo si esta activa", async () => {
    const { prisma } = buildPrisma([
      fila({ ownerUsuarioId: "o1", url: "https://a", secret: "enc", activa: true }),
      fila({ ownerUsuarioId: "o2", url: "https://b", secret: "enc2", activa: false }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    expect(await repo.findActivaByOwner("o1")).toEqual({ url: "https://a", secret: "enc" });
    expect(await repo.findActivaByOwner("o2")).toBeNull(); // inactiva -> null (R21)
    expect(await repo.findActivaByOwner("otro")).toBeNull();
  });

  it("findByOwner (vista de consulta) NUNCA proyecta el secreto (R7)", async () => {
    const { prisma } = buildPrisma([
      fila({ ownerUsuarioId: "o1", url: "https://a", secret: "enc", activa: true }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    const vista = await repo.findByOwner("o1");
    expect(vista).toEqual({
      url: "https://a",
      activa: true,
      // FICHA 403 (R18): la vista gana los dos campos; una fila sana no esta pausada.
      pausada: false,
      sinExitoDesde: AHORA.toISOString(),
    });
    expect(JSON.stringify(vista)).not.toContain("enc");
  });
});

describe("R8 — desactivarByOwner", () => {
  it("marca inactiva la fila del owner sin tocar otras", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", url: "https://a", secret: "e1", activa: true }),
      fila({ ownerUsuarioId: "o2", url: "https://b", secret: "e2", activa: true }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.desactivarByOwner("o1");
    expect(filas.find((f) => f.ownerUsuarioId === "o1")!.activa).toBe(false);
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.activa).toBe(true); // R9: aislamiento
  });
});

describe("D3 — resolverOwnerWebhook (quien puede tener webhook)", () => {
  it("una cuenta de key SIN tienda destino se cuelga de si misma; un adminTienda ajeno y un id inexistente, de nadie", async () => {
    const { prisma } = buildPrisma(
      [],
      { "u-api": "apiKey", "u-tienda": "adminTienda" },
      { "u-api": { tiendaDestinoDeSuKey: null } },
    );
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    // Comportamiento HISTORICO intacto: sin tienda destino, el owner es la cuenta dedicada.
    expect(await repo.resolverOwnerWebhook("u-api")).toBe("u-api");
    // Un adminTienda al que no apunta ninguna key sigue sin poder tener webhook (-> owner_invalido).
    expect(await repo.resolverOwnerWebhook("u-tienda")).toBeNull();
    expect(await repo.resolverOwnerWebhook("u-inexistente")).toBeNull();
  });

  it("302: una cuenta de key CON tienda destino se cuelga de la TIENDA, no de si misma", async () => {
    const { prisma } = buildPrisma(
      [],
      { "u-api": "apiKey", "u-nuform": "adminTienda" },
      {
        "u-api": { tiendaDestinoDeSuKey: "u-nuform" },
        "u-nuform": { esTiendaDestinoDeAlguna: true },
      },
    );
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    // Es LA linea que evita el fallo mudo: el despachador busca por `orden.tienda_id`, que para
    // las ordenes de esta key es `u-nuform`. Colgarla de `u-api` no daria error, solo silencio.
    expect(await repo.resolverOwnerWebhook("u-api")).toBe("u-nuform");
    // Y senalar directamente a la tienda tambien vale, porque hay una key que carga a su nombre.
    expect(await repo.resolverOwnerWebhook("u-nuform")).toBe("u-nuform");
  });
});

// ---------------------------------------------------------------------------
// FICHA 403 (T6) — EL CIRCUITO EN EL REPOSITORIO.
//
// Cubre R1 (los defaults del alta), R2 (el exito resetea), R3 (el fallo incrementa y devuelve el
// estado ya incrementado), R7 (alta y edicion de URL reinician el circuito) y R18 a nivel de datos
// (`findByOwner` refleja `pausada` segun el reloj INYECTADO).
//
// El doble de Prisma reproduce la semantica que importa: el `{ increment: 1 }` (que se resuelve en
// la base, no en memoria) y el `P2025` de un `update` sin fila.
// ---------------------------------------------------------------------------

describe("403/R1 — el alta nace con el circuito limpio", () => {
  it("⭑ una suscripcion recien creada tiene contador 0 y un ancla valida", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.upsertByOwner({ ownerUsuarioId: "o1", url: "https://a", secret: "enc" });

    const f = filas[0];
    expect(f.fallosConsecutivos).toBe(0);
    // Nunca NULL: su propia creacion ES el ancla. Sin esto, la ventana de R4 no tendria contra
    // que medirse en una suscripcion que aun no ha entregado nada.
    expect(f.sinExitoDesde).toBeInstanceOf(Date);
  });
});

describe("403/R2 — `registrarEntregaOk` cierra la racha", () => {
  it("⭑ pone el contador a cero y mueve el ancla al instante del exito", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 7, sinExitoDesde: haceMinutos(300) }),
      fila({ ownerUsuarioId: "o2", fallosConsecutivos: 4, sinExitoDesde: haceMinutos(300) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.registrarEntregaOk("o1", AHORA);

    const o1 = filas.find((f) => f.ownerUsuarioId === "o1")!;
    expect(o1.fallosConsecutivos).toBe(0);
    expect(o1.sinExitoDesde).toEqual(AHORA);
    // R9 de la 99: keyed por owner. La suscripcion del vecino no se toca.
    const o2 = filas.find((f) => f.ownerUsuarioId === "o2")!;
    expect(o2.fallosConsecutivos).toBe(4);
  });

  it("⭑ y con eso SALE DE LA PAUSA en la misma consulta, sin nada manual", async () => {
    // R2 medido de punta a punta: antes del exito la vista dice `pausada: true`; despues, `false`.
    // Nadie ha tocado `activa` ni ningun flag: solo los dos contadores.
    const { prisma } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 9, sinExitoDesde: haceMinutos(300) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    expect((await repo.findByOwner("o1"))!.pausada).toBe(true);
    await repo.registrarEntregaOk("o1", AHORA);
    expect((await repo.findByOwner("o1"))!.pausada).toBe(false);
  });

  it("⭑ NO toca `activa`: una suscripcion dada de baja no se reactiva por recibir un 2xx", async () => {
    // R5 por el otro lado. `activa` es el interruptor del dueño y el circuito no lo mueve NI PARA
    // ENCENDERLO: reactivar por su cuenta seria tan sorprendente como desactivar.
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", activa: false, fallosConsecutivos: 5 }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.registrarEntregaOk("o1", AHORA);

    expect(filas[0].activa).toBe(false);
  });

  it("es no-op si el owner no tiene fila", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await expect(repo.registrarEntregaOk("inexistente", AHORA)).resolves.toBeUndefined();
    expect(filas).toHaveLength(0);
  });
});

describe("403/R3 — `incrementarFalloYLeer` suma uno y devuelve el estado POST-incremento", () => {
  it("⭑ devuelve el contador YA incrementado, no el de antes", async () => {
    // Importa: el service evalua `estaPausada()` con lo que devuelve esta llamada. Si devolviera
    // el valor previo, el umbral se cruzaria un intento tarde, siempre.
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 2, sinExitoDesde: haceMinutos(40) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    const estado = await repo.incrementarFalloYLeer("o1", AHORA);

    expect(estado).toEqual({ fallosConsecutivos: 3, sinExitoDesde: haceMinutos(40) });
    expect(filas[0].fallosConsecutivos).toBe(3);
  });

  it("⭑ NO mueve el ancla de la racha, y ESA es la linea que sostiene R12", async () => {
    // Si cada fallo moviera `sinExitoDesde`, la ventana no se cumpliria JAMAS (siempre "recien
    // empezada") y ademas el `entidadId` del aviso cambiaria en cada intento: un aviso por fallo
    // en vez de uno por racha — 1.958 avisos en el incidente medido.
    const ancla = haceMinutos(120);
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 0, sinExitoDesde: ancla }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    for (let i = 0; i < 5; i++) await repo.incrementarFalloYLeer("o1", AHORA);

    expect(filas[0].fallosConsecutivos).toBe(5);
    expect(filas[0].sinExitoDesde).toEqual(ancla); // intacta las cinco veces
  });

  it("⭑ NO toca `activa` (R5)", async () => {
    const { prisma, filas } = buildPrisma([fila({ ownerUsuarioId: "o1", fallosConsecutivos: 99 })]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.incrementarFalloYLeer("o1", AHORA);
    expect(filas[0].activa).toBe(true);
  });

  it("⭑ devuelve `null` (no lanza) si la suscripcion ya no existe", async () => {
    // Pasa de verdad: la baja puede ocurrir entre el encolado del job y su entrega. Un `P2025`
    // propagado convertiria ese caso normal en un error de drenado.
    const { prisma } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await expect(repo.incrementarFalloYLeer("inexistente", AHORA)).resolves.toBeNull();
  });

  it("aisla por owner: incrementar uno no toca el contador del otro", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 1 }),
      fila({ ownerUsuarioId: "o2", fallosConsecutivos: 1 }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    await repo.incrementarFalloYLeer("o1", AHORA);
    expect(filas.find((f) => f.ownerUsuarioId === "o1")!.fallosConsecutivos).toBe(2);
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.fallosConsecutivos).toBe(1);
  });
});

describe("403/R7 — guardar la URL es la palanca manual de «reintentar ya»", () => {
  it("⭑ `actualizarUrlByOwner` reinicia el circuito y saca de la pausa en el acto", async () => {
    // Es el flujo del boton «Guardar URL» de Configuracion > API, que ya existe. Sin boton nuevo.
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 42, sinExitoDesde: haceMinutos(5 * 24 * 60) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    expect((await repo.findByOwner("o1"))!.pausada).toBe(true);
    await repo.actualizarUrlByOwner("o1", "https://nueva");

    expect(filas[0].fallosConsecutivos).toBe(0);
    expect(filas[0].sinExitoDesde).toEqual(AHORA);
    // R19: la MISMA consulta que alimenta la pantalla ya dice `false`. Sin recargar, sin esperar.
    expect((await repo.findByOwner("o1"))!.pausada).toBe(false);
  });

  it("⭑ tambien cuando el destino NO estaba roto: reiniciar un cero es un no-op inofensivo", async () => {
    // R7 dice "en CADA llamada", no "cuando haga falta". Condicionarlo seria una rama que puede
    // equivocarse, y el precio de no condicionarlo es cero.
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 0, sinExitoDesde: haceMinutos(10) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.actualizarUrlByOwner("o1", "https://nueva");

    expect(filas[0].fallosConsecutivos).toBe(0);
    expect(filas[0].sinExitoDesde).toEqual(AHORA);
  });

  it("⭑ `upsertByOwner` sobre una fila existente tambien reinicia", async () => {
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 12, sinExitoDesde: haceMinutos(600) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.upsertByOwner({ ownerUsuarioId: "o1", url: "https://b", secret: "enc2" });

    expect(filas[0].fallosConsecutivos).toBe(0);
    expect(filas[0].sinExitoDesde).toEqual(AHORA);
  });

  it("rotar el SECRETO no reinicia el circuito: es una operacion ortogonal", async () => {
    // Frontera deliberada. Rotar el secreto no dice nada sobre si el destino responde; equipararlo
    // a "reintentar ya" seria inventar una semantica que el spec no pide (R7 nombra la URL).
    const { prisma, filas } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 8, sinExitoDesde: haceMinutos(300) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    await repo.actualizarSecretoByOwner("o1", "enc-nuevo");

    expect(filas[0].fallosConsecutivos).toBe(8);
    expect(filas[0].sinExitoDesde).toEqual(haceMinutos(300));
  });
});

describe("403/R18 — `findByOwner` deriva `pausada` con el reloj, no con una columna", () => {
  it("⭑ la MISMA fila da `false` o `true` segun el `ahora` inyectado", () => {
    // Lo que demuestra que es DERIVADO: no hay ninguna escritura de por medio. Una suscripcion que
    // cruza la ventana mientras nadie mira aparece pausada la proxima vez que se abra el modal.
    const filaBase = () => [
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 3, sinExitoDesde: haceMinutos(0) }),
    ];
    return (async () => {
      const antes = buildPrisma(filaBase());
      const repoAntes = new WebhookSuscripcionRepository(
        antes.prisma,
        PAUSA,
        () => new Date(AHORA.getTime() + 29 * 60_000),
      );
      expect((await repoAntes.findByOwner("o1"))!.pausada).toBe(false);

      const despues = buildPrisma(filaBase());
      const repoDespues = new WebhookSuscripcionRepository(
        despues.prisma,
        PAUSA,
        () => new Date(AHORA.getTime() + 30 * 60_000),
      );
      expect((await repoDespues.findByOwner("o1"))!.pausada).toBe(true);
    })();
  });

  it("⭑ `pausada` y `activa` son INDEPENDIENTES: una pausada sigue activa", async () => {
    const { prisma } = buildPrisma([
      fila({
        ownerUsuarioId: "o1",
        activa: true,
        fallosConsecutivos: 5,
        sinExitoDesde: haceMinutos(120),
      }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    const vista = await repo.findByOwner("o1");

    expect(vista).toEqual({
      url: "https://a",
      activa: true, // ⚠️ R5: pausar NO es desactivar
      pausada: true,
      sinExitoDesde: haceMinutos(120).toISOString(),
    });
    // R7 de la 99: la vista sigue sin traer el secreto, tampoco ahora.
    expect(JSON.stringify(vista)).not.toContain("enc");
  });

  it("⭑ una caida corta NO sale como pausada (R6, el falso positivo)", async () => {
    const { prisma } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 6, sinExitoDesde: haceMinutos(4) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);
    expect((await repo.findByOwner("o1"))!.pausada).toBe(false);
  });

  it("⭑ y `findActivaByOwner` NO filtra por pausa: la entrega sigue intentandose (R5)", async () => {
    // Es lo que garantiza que la suscripcion se pueda recuperar sola: si la lectura de entrega
    // excluyera a las pausadas, no volveria a intentarlo nunca y solo un humano podria sacarla.
    const { prisma } = buildPrisma([
      fila({ ownerUsuarioId: "o1", fallosConsecutivos: 999, sinExitoDesde: haceMinutos(9999) }),
    ]);
    const repo = new WebhookSuscripcionRepository(prisma, PAUSA, () => AHORA);

    expect((await repo.findByOwner("o1"))!.pausada).toBe(true);
    expect(await repo.findActivaByOwner("o1")).toEqual({ url: "https://a", secret: "enc" });
  });
});
