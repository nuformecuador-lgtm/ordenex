import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { AsistenteService } from "@/lib/services/AsistenteService";
import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";
import { DobleProveedor } from "./_doble-proveedor";

/**
 * ⭑ FICHA 436 · R13, R14, R15 y Q5 — EL TOPE, MEDIDO DONDE SE DECIDE.
 *
 * ⚠️ LA ASERCIÓN QUE IMPORTA NO ES EL DESENLACE: es `dobleProveedor.llamadas` VACÍO. «Rechazó»
 * también sería cierto de un servicio que llama al proveedor, paga la consulta y luego decide que
 * no. Un tope que se comprueba después de gastar no es un tope; es una factura con disculpa.
 */

/**
 * Un contador de mentira que devuelve el número que el caso quiera —o `null`, que es como el
 * contador de verdad dice «ya estaba en el tope y no he escrito nada»— y que APUNTA CON QUÉ
 * ARGUMENTOS lo llamaron.
 */
function usoQueDevuelve(
  consultas: number | null,
): IAsistenteUsoRepository & { noLoSe: number; argumentos: unknown[][] } {
  return {
    noLoSe: 0,
    argumentos: [] as unknown[][],
    async consumirUnaConsulta(usuarioId: string, fecha: string, tope: number) {
      this.argumentos.push([usuarioId, fecha, tope]);
      return consultas;
    },
    async contarNoLoSe() {
      this.noLoSe += 1;
    },
  };
}

function servicioCon(
  proveedor: DobleProveedor,
  usoRepo: IAsistenteUsoRepository,
  maxConsultasDia = 30,
) {
  return new AsistenteService({
    proveedor,
    usoRepo,
    leerCatalogo: leerCatalogoAyuda,
    maxConsultasDia,
  });
}

const consultaDe = (rol: RolValue) => ({
  actor: { usuarioId: "u-1", rol },
  mensajes: [{ autor: "usuario" as const, texto: "¿cómo cierro el día?" }],
});

/** Consume el stream hasta el final; hace falta para que la señal de «no lo sé» se anote. */
async function agotar(trozos: AsyncIterable<unknown>) {
  for await (const _ of trozos) void _;
}

describe("R14 — por debajo del tope, la consulta llega al proveedor", () => {
  it("⭑ con 1 de 30, el proveedor recibe la consulta", async () => {
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(1)).responder(
      consultaDe("mensajero"),
    );

    expect(resultado.status).toBe("ok");
    expect(proveedor.llamadas).toHaveLength(1);
  });

  it("⭑ la consulta NÚMERO 30 todavía entra: el tope es «hasta 30», no «menos de 30»", async () => {
    // El off-by-one del tope, escrito como caso: con `>=` en vez de `>` se perdería una consulta
    // por persona y día, todos los días, y nadie sabría por qué.
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(30)).responder(
      consultaDe("mensajero"),
    );
    expect(resultado.status).toBe("ok");
    expect(proveedor.llamadas).toHaveLength(1);
  });
});

describe("R15 — en el tope se rechaza ANTES de llamar al proveedor", () => {
  it("⭑⭑ la 31 de 30: desenlace `tope_alcanzado` Y `llamadas` VACÍO", async () => {
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(31)).responder(
      consultaDe("mensajero"),
    );

    expect(resultado.status).toBe("tope_alcanzado");
    // ⭑ ÉSTA es la aserción del requisito. Si el tope se comprobara DESPUÉS de llamar, el
    // desenlace seguiría siendo `tope_alcanzado` y esta línea se pondría roja.
    expect(proveedor.llamadas).toEqual([]);
  });

  it("⭑ el mensaje dice el número y cuándo vuelve, y no dice «error»", async () => {
    const resultado = await servicioCon(new DobleProveedor(), usoQueDevuelve(31)).responder(
      consultaDe("mensajero"),
    );
    expect(resultado.status === "tope_alcanzado" && resultado.mensaje).toBe(
      "Llegaste a las 30 preguntas de hoy. Mañana volvés a tener.",
    );
  });

  it("⭑⭑ R17 — EL TOPE VIAJA AL CONTADOR: sin eso, un rechazo se escribiría igual", async () => {
    // ⚠️ POR QUÉ ESTE CASO, y no sólo el de la base (revisión de la ficha, `m2`). Quien decide que
    // un rechazo NO cuente es el `WHERE` del `ON CONFLICT`, y ese `WHERE` sólo puede comparar con
    // un tope si alguien se lo pasa. Si el servicio dejara de pasarlo, la corrida de la base lo
    // vería... **sólo si hay `.env`**; sin él, `tests/integration/db/**` se SALTA y la suite
    // termina verde. Este caso no depende de la base y muere igual.
    const uso = usoQueDevuelve(1);
    await servicioCon(new DobleProveedor(), uso, 30).responder(consultaDe("mensajero"));

    expect(uso.argumentos).toHaveLength(1);
    expect(uso.argumentos[0][0]).toBe("u-1");
    expect(uso.argumentos[0][2], "el servicio no le pasó el tope al contador").toBe(30);
    // Y la fecha es la del día calendario de Costa Rica, no un `Date`.
    expect(uso.argumentos[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("⭑⭑ R15/R17 — si el contador dice `null` (ya estaba en el tope), se rechaza sin llamar a nadie", async () => {
    // `null` es el desenlace nuevo del contador: «no he escrito nada porque ya estaba en el tope».
    // El servicio tiene que tratarlo como rechazo, no como «no sé cuántas lleva» — y desde luego
    // no seguir adelante.
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(null)).responder(
      consultaDe("mensajero"),
    );

    expect(resultado.status).toBe("tope_alcanzado");
    expect(resultado.status === "tope_alcanzado" && resultado.mensaje).toContain("30 preguntas");
    expect(proveedor.llamadas).toEqual([]);
  });

  it("el tope es configurable: con 5, la sexta ya no pasa", async () => {
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(6), 5).responder(
      consultaDe("mensajero"),
    );
    expect(resultado.status).toBe("tope_alcanzado");
    expect(resultado.status === "tope_alcanzado" && resultado.mensaje).toContain("5 preguntas");
    expect(proveedor.llamadas).toEqual([]);
  });
});

describe("R13 — `apiKey` y los roles fuera de ROLES_AYUDA se rechazan sin llamar a nadie", () => {
  it("⭑ `apiKey`: rechazo, proveedor sin llamar Y contador sin tocar", async () => {
    const proveedor = new DobleProveedor();
    let conteos = 0;
    const uso: IAsistenteUsoRepository = {
      consumirUnaConsulta: async () => {
        conteos += 1;
        return 1;
      },
      contarNoLoSe: async () => undefined,
    };

    const resultado = await servicioCon(proveedor, uso).responder(consultaDe("apiKey"));

    expect(resultado).toEqual({ status: "rol_no_admitido" });
    expect(proveedor.llamadas).toEqual([]);
    // Una cuenta de máquina no debe ni siquiera abrir una fila de contador: no navega la UI y no
    // tiene un «día» que contar.
    expect(conteos).toBe(0);
  });

  it("CONTROL: un rol de persona SÍ pasa esta puerta (si no, el caso de arriba sería vacuo)", async () => {
    const proveedor = new DobleProveedor();
    const resultado = await servicioCon(proveedor, usoQueDevuelve(1)).responder(
      consultaDe("adminTienda"),
    );
    expect(resultado.status).toBe("ok");
    expect(proveedor.llamadas).toHaveLength(1);
  });
});

describe("Q5 — se cuenta cuántas veces dijo «no lo sé». El número, nunca el texto", () => {
  it("⭑ una respuesta que empieza por «No lo sé» suma uno al contador", async () => {
    const proveedor = new DobleProveedor({
      textos: ["No lo sé", ": eso no está en la documentación que tengo."],
    });
    const uso = usoQueDevuelve(1);
    const resultado = await servicioCon(proveedor, uso).responder(consultaDe("mensajero"));

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") await agotar(resultado.trozos);
    expect(uso.noLoSe).toBe(1);
  });

  it("⭑ una respuesta normal NO lo suma", async () => {
    const proveedor = new DobleProveedor({ textos: ["Andá a Mi bodega y tocá Cerrar."] });
    const uso = usoQueDevuelve(1);
    const resultado = await servicioCon(proveedor, uso).responder(consultaDe("mensajero"));
    if (resultado.status === "ok") await agotar(resultado.trozos);
    expect(uso.noLoSe).toBe(0);
  });

  it("⭑ y la señal NO retiene los trozos: llegan enteros y en orden (R19 sigue intacto)", async () => {
    const proveedor = new DobleProveedor({ textos: ["No lo sé", ", pero ", "mirá acá."] });
    const resultado = await servicioCon(proveedor, usoQueDevuelve(1)).responder(
      consultaDe("mensajero"),
    );
    const textos: string[] = [];
    if (resultado.status === "ok") {
      for await (const trozo of resultado.trozos) {
        if (trozo.tipo === "texto") textos.push(trozo.texto);
      }
    }
    expect(textos).toEqual(["No lo sé", ", pero ", "mirá acá."]);
  });
});

describe("R20 / proveedor caído — el servicio traduce, no reenvía", () => {
  it("sin credencial: desenlace propio y ningún dato del proveedor", async () => {
    const proveedor = new DobleProveedor({ desenlace: "sin_credencial" });
    const resultado = await servicioCon(proveedor, usoQueDevuelve(1)).responder(
      consultaDe("mensajero"),
    );
    expect(resultado).toEqual({ status: "sin_credencial" });
  });

  it("⭑ proveedor caído: el `detalle` NO sube (R21)", async () => {
    const proveedor = new DobleProveedor({ desenlace: "transitorio" });
    const resultado = await servicioCon(proveedor, usoQueDevuelve(1)).responder(
      consultaDe("mensajero"),
    );
    // `toEqual` exacto y no `toMatchObject`: lo que se afirma es que NO HAY NINGÚN CAMPO MÁS por
    // el que se pueda escapar lo que el proveedor dijo.
    expect(resultado).toEqual({ status: "proveedor_caido" });
  });
});
