import { describe, it, expect, vi } from "vitest";

import { enviarPlantillaChat } from "@/lib/actions/chat-whatsapp";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import type { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import type { PlantillaEnviable } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { DatosPlantilla } from "@/lib/types/plantilla-datos";
import { datosPlantillaFixture } from "@/tests/fixtures/plantilla-datos";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / R18 — EL SINPE QUE SALE AL CLIENTE VIENE DEL SERVIDOR, SIEMPRE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LA GARANTIA ES ESTRUCTURAL Y CONVIENE DECIRLO ANTES DE LEER LOS CASOS: `enviarPlantillaChat` solo
// acepta DOS IDENTIFICADORES (`ordenId`, `plantillaId`). No hay ningun payload donde un par pudiera
// venir del dispositivo, y el bloque `negocio` lo arma `OrdenEnvioReader.findParaEnvio` leyendo la
// base. Estos casos existen para que esa forma no se pierda sin que nadie se entere: el dia que
// alguien añada un tercer parametro con «los datos ya resueltos por la pantalla, para no volver a
// consultarlos», el primer caso se pone rojo.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL. El repositorio es publico.

const MENSAJERO: Actor = { usuarioId: "men-1", rol: "mensajero" };
const getActor = (a: Actor | null) => async () => a;

const SINPE_DE_LA_BASE = { numero: "80000000", nombre: "Titular de Prueba" };
const SINPE_INVENTADO = { numero: "60000009", nombre: "Titular Inventado" };

const DATOS: DatosPlantilla = datosPlantillaFixture({
  orden: { telefonoDest: "50688880000", numGuia: 10, destinatario: "Ana" },
  negocio: { sinpeNumero: SINPE_DE_LA_BASE.numero, sinpeNombre: SINPE_DE_LA_BASE.nombre },
});

const PLANTILLA: PlantillaEnviable = {
  id: "p-1",
  nombre: "listo_para_entrega_mensajero",
  cuerpo: "Pagá por SINPE al número {{sinpe}} a nombre de {{sinpe_nombre}}.",
  variables: ["sinpe", "sinpe_nombre"],
  templateIdioma: "es",
} as unknown as PlantillaEnviable;

function harness(datos: DatosPlantilla) {
  const reader: IOrdenEnvioReader = { findParaEnvio: vi.fn(async () => datos) };
  // Tipado explicito del argumento: sin el, `vi.fn` infiere una tupla vacia y
  // `mock.calls[0][0]` no compila. Lo que interesa es el `cuerpoRenderizado` que viaja.
  const enviarPlantilla = vi.fn(async (_entrada: { cuerpoRenderizado: string }) => ({
    status: "ok" as const,
    mensajeId: "wamid.X",
    mensajeChatId: "msg-1",
  }));
  return {
    reader,
    enviarPlantilla,
    deps: {
      getActor: getActor(MENSAJERO),
      ordenReader: reader,
      plantillaRepo: { findEnviableById: vi.fn(async () => PLANTILLA) },
      service: { enviarPlantilla } as unknown as ChatWhatsappService,
    },
  };
}

describe("429/R18 — el par no se acepta del dispositivo: viene resuelto con la orden", () => {
  it("⭑ el texto que se envia lleva el SINPE QUE DEVOLVIO EL SERVIDOR", async () => {
    const h = harness(DATOS);
    const r = await enviarPlantillaChat("orden-1", "p-1", h.deps);
    expect(r.status).toBe("ok");

    const enviado = h.enviarPlantilla.mock.calls[0][0];
    expect(enviado.cuerpoRenderizado).toContain(SINPE_DE_LA_BASE.numero);
    expect(enviado.cuerpoRenderizado).toContain(SINPE_DE_LA_BASE.nombre);
    // Y no queda hueco: es el fallo mudo que la ficha persigue.
    expect(enviado.cuerpoRenderizado).not.toContain("{{sinpe}}");
    expect(enviado.cuerpoRenderizado).not.toMatch(/al número\s+a nombre/);
  });

  it("⭑ un par INYECTADO como argumento de mas se ignora: el texto sigue siendo el de la base", async () => {
    // El intento: colar los valores «ya resueltos» desde la pantalla. La firma no los tiene, asi
    // que el argumento entra por `deps` y no llega a ninguna parte — lo que se afirma es el TEXTO
    // ENVIADO, no que la llamada falle.
    const h = harness(DATOS);
    // ⚠️ El objeto se construye aparte y se ensancha con `as`: `ChatWhatsappDeps` NO tiene donde
    // poner esto —que ES la garantia de R18— y un literal inline seria un error de compilacion.
    const conIntruso = {
      ...h.deps,
      negocio: { sinpeNumero: SINPE_INVENTADO.numero, sinpeNombre: SINPE_INVENTADO.nombre },
    } as typeof h.deps;
    const r = await enviarPlantillaChat("orden-1", "p-1", conIntruso);
    expect(r.status).toBe("ok");

    const enviado = h.enviarPlantilla.mock.calls[0][0];
    expect(enviado.cuerpoRenderizado).toContain(SINPE_DE_LA_BASE.numero);
    expect(enviado.cuerpoRenderizado).not.toContain(SINPE_INVENTADO.numero);
    expect(enviado.cuerpoRenderizado).not.toContain(SINPE_INVENTADO.nombre);
  });

  it("⭑ la firma de la accion son DOS IDENTIFICADORES y las dependencias; no hay payload de valores", () => {
    // `Function.length` cuenta los parametros ANTERIORES al primero con default, asi que `deps`
    // —que tiene `= {}`— no suma: DOS. Si alguien colara un tercer parametro de datos antes de
    // `deps`, esto pasaria a 3 y obligaria a revisar la decision aqui.
    expect(enviarPlantillaChat.length).toBe(2); // ordenId, plantillaId (deps lleva default)
  });

  it("si la orden no es de ese mensajero, no se envia nada (la puerta previa sigue en pie)", async () => {
    const h = harness(DATOS);
    h.deps.ordenReader = { findParaEnvio: vi.fn(async () => null) };
    const r = await enviarPlantillaChat("orden-1", "p-1", h.deps);
    expect(r.status).toBe("forbidden");
    expect(h.enviarPlantilla).not.toHaveBeenCalled();
  });
});
