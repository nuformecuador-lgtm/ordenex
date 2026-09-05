import { describe, it, expect, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DistritoResueltoRow,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

// FICHA 374 (R30) — LA PUERTA REAL contra un distrito RETIRADO en la correccion de ubicacion.
//
// POR QUE HACE FALTA AUNQUE EL DESPLEGABLE YA LOS FILTRE. El filtro del cliente es COMODIDAD; sin
// este rechazo, cualquiera que reenvie la peticion —o un cliente con el catalogo cacheado— mete la
// orden en un distrito retirado. Corregir una orden hacia un distrito es un ALTA ENCUBIERTA: crea
// futuro, no consulta pasado, y por eso aqui SI se recorta, al reves que en las lecturas del
// catalogo.
//
// Y EL MOTIVO ES PROPIO: «no existe» y «fue retirado» son cosas distintas. Confundirlas manda a
// quien corrige a buscar una errata en un distrito que esta escrito bien.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const TIENDA_ID = "tienda-1";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/** El cambio de UBICACION completo hacia `d-2`. Confirmado, para pasar el gate del dinero. */
const MUDANZA = {
  provinciaId: "p-1",
  cantonId: "c-1",
  distritoId: "d-2",
  confirmaCambioDeUbicacion: true,
} as const;

function orden(): OrdenParaCorreccionRow {
  return {
    id: ORDEN_ID,
    tiendaId: TIENDA_ID,
    estatusValue: "en_reparto",
    numGuia: 8123,
    destinatario: "Ana Perez",
    telefonoDest: "8888-7777",
    producto: "caja de zapatos",
    notas: null,
    direccion: "avenida siempre viva 742",
    peso: 1.5,
    montoCobrar: "15000.00",
    cobraComision: true,
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: "d-1",
    distritoNombre: "Distrito Uno",
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    esCentral: false,
    esZonaEspecial: false,
    yaEnUnCierre: false,
  };
}

function distrito(overrides: Partial<DistritoResueltoRow> = {}): DistritoResueltoRow {
  return {
    id: "d-2",
    nombre: "Distrito Dos",
    cantonId: "c-1",
    provinciaId: "p-1",
    zonaId: "z-2",
    zonaNombre: "Zona Dos",
    esCentral: false,
    esZonaEspecial: false,
    disponible: true,
    ...overrides,
  };
}

function tarifa(): TarifaVigente {
  return {
    valorFlete: "2000.00",
    valorFleteGam: "1500.00",
    valorFleteDevuelto: "1000.00",
    valorFleteDevueltoGam: "800.00",
    comisionCod: "5.00",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
  };
}

function escenario(distritoFila: DistritoResueltoRow | null) {
  const findParaCorreccion = vi.fn(async () => orden());
  const findDistritoParaCorreccion = vi.fn(async () => distritoFila);
  const corregirDatosCliente = vi.fn(
    async (
      _ordenId: string,
      _data: Record<string, unknown>,
      _estadosBloqueados: readonly string[],
    ) => "ok" as const,
  );
  const resolveTarifa = vi.fn(async () => tarifa());
  const service = new CorregirDatosClienteService(
    { findParaCorreccion, findDistritoParaCorreccion, corregirDatosCliente },
    { resolveTarifa },
  );
  return { service, findDistritoParaCorreccion, corregirDatosCliente };
}

/** El texto del rechazo, sea cual sea la forma del resultado. */
function motivoDe(r: { status: string; fieldErrors?: Record<string, string[]> }): string {
  if (r.status !== "validation_error" || !r.fieldErrors) {
    throw new Error(`se esperaba un rechazo de ubicacion y llego ${r.status}`);
  }
  const claves = Object.keys(r.fieldErrors);
  if (claves.length !== 1) throw new Error(`el rechazo trae ${claves.length} campos, no 1`);
  return r.fieldErrors[claves[0]][0];
}

describe("374/R30 — corregir hacia un distrito RETIRADO se rechaza, y NO se escribe nada", () => {
  it("el rechazo llega y el repositorio NO escribe", async () => {
    const { service, corregirDatosCliente } = escenario(distrito({ disponible: false }));

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("el motivo DICE que fue retirado", async () => {
    const { service } = escenario(distrito({ disponible: false }));
    const motivo = motivoDe(await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO));
    expect(motivo).toMatch(/retirad/i);
  });

  it("⭑ el motivo es DISTINTO del de «el distrito indicado no existe»", async () => {
    // Es la afirmacion central de R30. Si los dos textos coincidieran, un distrito retirado y uno
    // inexistente serian indistinguibles para quien corrige.
    const retirado = escenario(distrito({ disponible: false }));
    const motivoRetirado = motivoDe(
      await retirado.service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO),
    );

    const inexistente = escenario(null);
    const motivoInexistente = motivoDe(
      await inexistente.service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO),
    );

    expect(motivoInexistente).toBe("El distrito indicado no existe");
    expect(motivoRetirado).not.toBe(motivoInexistente);
    expect(motivoRetirado).not.toMatch(/no existe/i);
  });

  it("el rechazo por retirada va ANTES del de «sin zona unica»: retirado es mas concreto", async () => {
    // Un distrito retirado suele ademas quedarse sin zona. Decir «no tiene una zona unica» manda a
    // configurar una tarifa en vez de a elegir otro distrito.
    const { service } = escenario(distrito({ disponible: false, zonaId: null, zonaNombre: null }));
    const motivo = motivoDe(await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO));
    expect(motivo).toMatch(/retirad/i);
    expect(motivo).not.toMatch(/zona unica/i);
  });

  it("CONTRAPRUEBA: el mismo distrito DISPONIBLE sí se escribe", async () => {
    // Sin este caso, todo lo de arriba podria estar verde porque el camino nunca llega a escribir.
    const { service, corregirDatosCliente } = escenario(distrito({ disponible: true }));
    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);
    expect(r.status).toBe("ok");
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
  });

  it("una correccion que NO toca la ubicacion no consulta el distrito ni se ve afectada", async () => {
    const { service, findDistritoParaCorreccion, corregirDatosCliente } = escenario(
      distrito({ disponible: false }),
    );
    const r = await service.corregir(
      { ordenId: ORDEN_ID, destinatario: "Ana Maria Perez" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(findDistritoParaCorreccion).not.toHaveBeenCalled();
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
  });
});
