import { describe, it, expect } from "vitest";
import { NotificacionEvento as NotificacionEventoPrisma, RolValue } from "@prisma/client";
import {
  PUSH_ELEGIBLE,
  esElegiblePush,
  eventoPuedeEmpujar,
} from "@/lib/notificaciones/push-elegibles";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// FICHA 410 (T2.5) — EL CATALOGO DE ELEGIBILIDAD. Cubre R1 (solo lo declarado), R2 (exhaustivo
// sobre el enum), R3 (nada por unidad ni irresoluble) y R4 (la clave es el PAR evento+rol).
//
// Los pares se afirman con LITERALES ESCRITOS A MANO, nunca leyendo la propia entrada del catalogo:
// comparar una decision contra la fuente que la genera esta siempre verde.

const TODOS_LOS_ROLES: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite", "mensajero", "apiKey"];

describe("410/R2 — el catalogo cubre TODOS los eventos del enum, ni uno menos", () => {
  it("⭑ las claves del catalogo son exactamente los valores del enum de Prisma", () => {
    // La fuente es el ENUM DEL CLIENTE PRISMA: es el unico sitio que refleja lo que hay en la base.
    // Un valor nuevo sin entrada aqui ADEMAS no compila —`PUSH_ELEGIBLE` es un
    // `satisfies Record<NotificacionEvento, PerfilPush>`, no un `Partial`—, que es lo que impide
    // que un evento futuro se quede sin push en silencio.
    const delEnum = Object.values(NotificacionEventoPrisma).sort();
    const delCatalogo = Object.keys(PUSH_ELEGIBLE).sort();

    // AUTOCOMPROBACION: si la extraccion del enum se rompiera, las dos listas quedarian vacias y
    // el `toEqual` de abajo pasaria sin haber comprobado nada.
    expect(delEnum.length).toBeGreaterThanOrEqual(14);
    expect(delEnum).toContain("geocodificacion_caida");
    expect(delEnum).toContain("cierre_dia_rechazado"); // ficha 412

    expect(delCatalogo).toEqual(delEnum);
  });

  it("cada entrada NO elegible declara su porque: la ausencia es decision, no olvido", () => {
    for (const [evento, entrada] of Object.entries(PUSH_ELEGIBLE)) {
      if (entrada.push === "no") {
        expect(entrada.porQue.length, `${evento} sin motivo escrito`).toBeGreaterThan(30);
      } else {
        expect(entrada.roles.length, `${evento} elegible sin roles`).toBeGreaterThan(0);
      }
    }
  });

  it("⭑ son NUEVE elegibles y CINCO no, tal como los conto el diseno aprobado", () => {
    const elegibles = Object.entries(PUSH_ELEGIBLE)
      .filter(([, e]) => e.push === "si")
      .map(([k]) => k)
      .sort();
    // Lista literal: si alguien anade o quita uno, esto se pone rojo y hay que justificarlo.
    expect(elegibles).toEqual([
      "cierre_dia_por_aprobar",
      // FICHA 412 (R23): dinero (el cierre es su liquidacion) Y plazo (mientras siga sin aprobar,
      // el servidor le rechaza entregar, cobrar y recibir trabajo nuevo). Las dos cosas.
      "cierre_dia_rechazado",
      "cierre_dia_vencido",
      "devoluciones_represadas",
      "dia_reparto_corregido",
      "geocodificacion_caida",
      "mensajero_bloqueado_por_cierres",
      "novedades_sin_gestionar",
      "webhook_suscripcion_pausada",
    ]);
  });
});

describe("410/R3 — lo que NO se pushea, y por que", () => {
  const NO_ELEGIBLES: NotificacionEvento[] = [
    // Un aviso POR ORDEN: cuarenta rechazos serian cuarenta interrupciones.
    "orden_rechazada",
    // Quien la lanzo esta mirando la pantalla.
    "carga_masiva_terminada",
    // Colas de trabajo sin plazo que venza esa noche.
    "postulacion_mensajero_pendiente",
    "postulacion_recurso_pendiente",
    "gasto_fijo_cobro_pendiente",
  ];

  it("⭑ ninguno de los cinco se pushea a NINGUN rol", () => {
    for (const evento of NO_ELEGIBLES) {
      expect(eventoPuedeEmpujar(evento), `${evento} no deberia empujar`).toBe(false);
      for (const rol of TODOS_LOS_ROLES) {
        expect(esElegiblePush(evento, rol), `${evento} -> ${rol}`).toBe(false);
      }
    }
  });

  it("control positivo: el barrido de arriba SI distingue (si no, seria verde por vacio)", () => {
    // Sin este control, un `esElegiblePush` que devolviera siempre `false` dejaria el caso
    // anterior en verde. Aqui se exige que el MISMO barrido encuentre al menos un `true`.
    const algunoSi = TODOS_LOS_ROLES.some((rol) => esElegiblePush("cierre_dia_vencido", rol));
    expect(algunoSi).toBe(true);
  });
});

describe("410/R4 — la clave es el PAR (evento, rol del LECTOR), no el evento", () => {
  it("⭑ `cierre_dia_vencido` se pushea al mensajero y NO a la bodega", () => {
    // Mismo evento, cuatro filas: una `alert` al mensajero y tres `warning` a bodega. Solo la
    // primera merece interrumpir: la bodega NO PUEDE APROBAR LO QUE NO SE HA ENVIADO (271).
    expect(esElegiblePush("cierre_dia_vencido", "mensajero")).toBe(true);
    expect(esElegiblePush("cierre_dia_vencido", "maestro")).toBe(false);
    expect(esElegiblePush("cierre_dia_vencido", "admin")).toBe(false);
    expect(esElegiblePush("cierre_dia_vencido", "adminSatelite")).toBe(false);
  });

  it("⭑ 412/R23: `cierre_dia_rechazado` es del MENSAJERO, y de NINGUN otro perfil", () => {
    // El destinatario `usuario` (el mensajero) SI; cualquier rol, NO — y no por olvido: este
    // evento NO CREA FILA DE ROL (412/R2), su unico destinatario es el mensajero como fila
    // dirigida a usuario. `rolLector` es el rol de QUIEN LEE, no `destinatario_rol`.
    expect(esElegiblePush("cierre_dia_rechazado", "mensajero")).toBe(true);
    for (const rol of ["maestro", "admin", "adminTienda", "adminSatelite", "apiKey"] as const) {
      expect(esElegiblePush("cierre_dia_rechazado", rol), rol).toBe(false);
    }
    expect(eventoPuedeEmpujar("cierre_dia_rechazado")).toBe(true);
  });

  it("⭑ 412: un rechazo NO produce dos pushes por el mismo hecho", () => {
    // El cupo de la 410 es por `(usuario, evento, jornada)`, asi que dos eventos distintos serian
    // DOS interrupciones. No pasa porque en la rama del rechazo la fila de
    // `mensajero_bloqueado_por_cierres` dirigida al mensajero YA NO SE CREA (412/R17) — eso se
    // afirma en `cierres-admin-aviso-rechazo.test.ts`. Aqui se deja escrito el otro lado: los dos
    // eventos son elegibles para el mensajero, luego la unica red es que solo exista UNA fila.
    expect(esElegiblePush("cierre_dia_rechazado", "mensajero")).toBe(true);
    expect(esElegiblePush("mensajero_bloqueado_por_cierres", "mensajero")).toBe(true);
  });

  it("⭑ `mensajero_bloqueado_por_cierres` igual: el mensajero si, las copias a bodega no", () => {
    expect(esElegiblePush("mensajero_bloqueado_por_cierres", "mensajero")).toBe(true);
    for (const rol of ["maestro", "admin", "adminSatelite"] as const) {
      expect(esElegiblePush("mensajero_bloqueado_por_cierres", rol)).toBe(false);
    }
  });

  it("⭑ `cierre_dia_por_aprobar` va a admin y bodega satelite, NO al maestro", () => {
    expect(esElegiblePush("cierre_dia_por_aprobar", "admin")).toBe(true);
    expect(esElegiblePush("cierre_dia_por_aprobar", "adminSatelite")).toBe(true);
    // La copia a `maestro` esta en la lista negativa del design §3, con nombre y apellido.
    expect(esElegiblePush("cierre_dia_por_aprobar", "maestro")).toBe(false);
  });

  it("`devoluciones_represadas` va a admin y bodega satelite; el maestro lo ve solo en campana", () => {
    expect(esElegiblePush("devoluciones_represadas", "admin")).toBe(true);
    expect(esElegiblePush("devoluciones_represadas", "adminSatelite")).toBe(true);
    expect(esElegiblePush("devoluciones_represadas", "maestro")).toBe(false);
  });

  it("`novedades_sin_gestionar` es de la tienda y de nadie mas", () => {
    expect(esElegiblePush("novedades_sin_gestionar", "adminTienda")).toBe(true);
    for (const rol of ["maestro", "admin", "adminSatelite", "mensajero"] as const) {
      expect(esElegiblePush("novedades_sin_gestionar", rol)).toBe(false);
    }
  });

  it("`dia_reparto_corregido` es del mensajero; nadie mas lo recibe siquiera", () => {
    expect(esElegiblePush("dia_reparto_corregido", "mensajero")).toBe(true);
    expect(esElegiblePush("dia_reparto_corregido", "admin")).toBe(false);
  });

  it("`webhook_suscripcion_pausada` es del maestro, que es quien opera Configuracion > API", () => {
    expect(esElegiblePush("webhook_suscripcion_pausada", "maestro")).toBe(true);
    expect(esElegiblePush("webhook_suscripcion_pausada", "admin")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// ⚠️ EL CASO QUE MAS FACIL SE «ARREGLA» POR PARECER UN ERROR
// ---------------------------------------------------------------------------------------------
describe("410/D4 — `geocodificacion_caida` va SOLO al maestro, y NO es una omision", () => {
  it("⭑ el maestro SI recibe push", () => {
    expect(esElegiblePush("geocodificacion_caida", "maestro")).toBe(true);
  });

  it("⭑ el `admin` NO recibe push, aunque la campana SI le mande el aviso", () => {
    // La 401 crea DOS filas con el mismo texto, una por rol, y esta ficha NO la toca: el admin
    // sigue viendo el aviso al abrir la app. Lo que no se hace es sacarle el telefono del bolsillo
    // por algo que no puede arreglar — la credencial y la facturacion del proveedor de mapas las
    // toca el maestro. Es la regla que gobierna toda la ficha: SE INTERRUMPE A QUIEN PUEDE
    // RESOLVERLO. Decision del humano del 2026-09-10 (D4, design §3.1).
    //
    // ⚠️ ESTE ASERTO EXISTE PARA PONERSE ROJO si alguien anade "admin" al catalogo creyendo que
    // falta media linea. No falta. Si el criterio cambia, se cambia con el humano y se reescribe
    // este comentario, no el aserto a secas.
    expect(esElegiblePush("geocodificacion_caida", "admin")).toBe(false);
  });

  it("y a ningun otro rol tampoco", () => {
    for (const rol of ["adminTienda", "adminSatelite", "mensajero", "apiKey"] as const) {
      expect(esElegiblePush("geocodificacion_caida", rol)).toBe(false);
    }
  });
});

describe("410 — `eventoPuedeEmpujar` es una puerta BARATA, no la decision", () => {
  it("dice `true` para un evento elegible aunque el rol concreto no lo sea", () => {
    // Sirve para no gastar una consulta resolviendo destinatarios; la decision fina es del par.
    expect(eventoPuedeEmpujar("cierre_dia_vencido")).toBe(true);
    expect(esElegiblePush("cierre_dia_vencido", "admin")).toBe(false);
  });

  it("⭑ y `false` para `orden_rechazada`, que es el evento mas frecuente del sistema", () => {
    expect(eventoPuedeEmpujar("orden_rechazada")).toBe(false);
  });
});
