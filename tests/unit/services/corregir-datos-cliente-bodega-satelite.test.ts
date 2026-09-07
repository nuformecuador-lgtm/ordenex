import { describe, it, expect, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DistritoResueltoRow,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 377 (R15/R16) — LA SEGUNDA PUERTA AL MISMO AGUJERO: LA CORRECCION MANUAL DE UBICACION
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// La 377 excluye de la reconciliacion automatica (`ZonaRepository.update`) a la orden cuyo paquete
// ya esta en el estante de una bodega satelite. Este servicio es el OTRO camino que escribe
// `orden.zona_id`: `en_bodega_satelite` NO esta en `ESTADOS_SIN_CORRECCION`, asi que sin este
// rechazo un maestro cambia el distrito de una orden en estante y la zona se re-deriva igual, con
// el mismo desenlace — la bodega que TIENE el paquete deja de verla y de poder asignarla, y desde
// `en_bodega_satelite` no hay transicion de salida hacia otra bodega. Un arreglo que cierra una
// de las dos puertas no es un arreglo.
//
// ⚠️ DECISION DEL LEADER DEL 2026-09-07, **NO FIRMADA POR EL HUMANO** (Q3 de
// `specs/377-bodega-satelite-sin-dueno/requirements.md`). Se eligio PROHIBIR el cambio de zona en
// ese estado, y no solo avisar: el aviso que ya existe habla de IMPORTES, y consentir el desenlace
// con un clic lo convierte en un fallo consentido en vez de arreglarlo.
//
// LO QUE ESTE ARCHIVO PRUEBA QUE **NO** SE ROMPIO, y es la mitad que justifica no haber metido
// `en_bodega_satelite` en `ESTADOS_SIN_CORRECCION`: corregir el nombre, el telefono o el distrito
// DENTRO DE SU MISMA ZONA sigue permitido con el paquete en el estante.
//
// MUTACIONES EJECUTADAS A MANO (2026-09-07), con los conteos medidos:
//   · apagar el `if` del gate entero -> 3 rojos (los tres casos de R15).
//   · quitar la comparacion `distrito.zonaId !== orden.zonaId` (bloquear por estado a secas) ->
//     1 rojo: «corregir el distrito DENTRO de la misma zona sigue permitido». Es el caso que
//     impide que este gate se convierta en el `ESTADOS_SIN_CORRECCION` que se descarto.

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/** El cambio de UBICACION completo hacia `d-2`. Confirmado, para pasar el gate del dinero. */
const MUDANZA = {
  provinciaId: "p-1",
  cantonId: "c-1",
  distritoId: "d-2",
  confirmaCambioDeUbicacion: true,
} as const;

function orden(estatusValue: OrderStatusValue): OrdenParaCorreccionRow {
  return {
    id: ORDEN_ID,
    tiendaId: "tienda-1",
    estatusValue,
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
    // La orden esta en la bodega de `z-1`: es la zona que dice QUE bodega tiene el paquete.
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    esCentral: false,
    esZonaEspecial: false,
    yaEnUnCierre: false,
  };
}

/** Por defecto, un distrito de OTRA zona (`z-2`): el cambio que moveria la orden de bodega. */
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

function escenario(estatusValue: OrderStatusValue, distritoFila: DistritoResueltoRow = distrito()) {
  const findParaCorreccion = vi.fn(async () => orden(estatusValue));
  const findDistritoParaCorreccion = vi.fn(async () => distritoFila);
  const corregirDatosCliente = vi.fn(
    async (
      _ordenId: string,
      _data: Record<string, unknown>,
      _estadosBloqueados: readonly string[],
    ) => "ok" as const,
  );
  const service = new CorregirDatosClienteService(
    { findParaCorreccion, findDistritoParaCorreccion, corregirDatosCliente },
    { resolveTarifa: vi.fn(async () => tarifa()) },
  );
  return { service, corregirDatosCliente, findDistritoParaCorreccion };
}

/** El texto del rechazo, sea cual sea la forma del resultado. Falla RUIDOSAMENTE si no lo hay. */
function motivoDe(r: { status: string; fieldErrors?: Record<string, string[]> }): string {
  if (r.status !== "validation_error" || !r.fieldErrors) {
    throw new Error(`se esperaba un rechazo de ubicacion y llego ${r.status}`);
  }
  const claves = Object.keys(r.fieldErrors);
  if (claves.length !== 1) throw new Error(`el rechazo trae ${claves.length} campos, no 1`);
  return r.fieldErrors[claves[0]][0];
}

describe("377/R15 — con el paquete en el estante, la correccion NO puede cambiar la zona", () => {
  it("⭑ rechaza y NO escribe, aunque la peticion venga CONFIRMADA", async () => {
    // Confirmada a proposito: el gate del dinero ya se cruzo y aun asi no se escribe. Si este
    // desenlace se pudiera comprar con un clic, la orden acabaria igual de inalcanzable.
    const { service, corregirDatosCliente } = escenario("en_bodega_satelite");

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("validation_error");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("⭑ sin confirmar, el rechazo GANA al aviso de importes: no se ofrece confirmar lo imposible", async () => {
    // El gate del dinero (`confirmacion_requerida`) llega DESPUES. Si saliera antes, la pantalla
    // pediria confirmar un cambio que el servidor va a rechazar igual.
    const { service, corregirDatosCliente } = escenario("en_bodega_satelite");

    const r = await service.corregir(
      { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2" },
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    expect(r.status).not.toBe("confirmacion_requerida");
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("el motivo nombra la BODEGA que tiene el paquete y no habla solo de dinero", async () => {
    const { service } = escenario("en_bodega_satelite");
    const motivo = motivoDe(await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO));

    expect(motivo).toContain("Zona Uno"); // la bodega que lo tiene, por su nombre
    expect(motivo).toMatch(/bodega/i);
    // No describe el defecto que este cambio ya impide (design §5.4 lo prohibe expresamente).
    expect(motivo).not.toMatch(/sin due/i);
  });

  it("⭑ EL ESTADO ACTUAL MANDA: en transito a la satelite SI se puede corregir", async () => {
    // `en_ruta_bodega_satelite` NO es «en el estante»: el paquete lo tiene la central. Es la misma
    // distincion que defiende a la 366, y sin este caso el gate podria estar mirando
    // `ESTADOS_CUSTODIA_SATELITE` (los DOS estados) sin que nada se cayera.
    const { service, corregirDatosCliente } = escenario("en_ruta_bodega_satelite");

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
    // Y la zona derivada SI se escribe: la 366 no se toca por este camino tampoco.
    expect(corregirDatosCliente.mock.calls[0][1]).toMatchObject({ zonaId: "z-2" });
  });

  it("una orden que YA SALIO de la bodega (`en_reparto`) tampoco queda bloqueada", async () => {
    const { service, corregirDatosCliente } = escenario("en_reparto");
    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
  });
});

describe("377/R16 — lo que el gate NO bloquea, y por eso no se toco `ESTADOS_SIN_CORRECCION`", () => {
  it("⭑ corregir el distrito DENTRO de la misma zona sigue permitido con el paquete en el estante", async () => {
    // El corte es el DAÑO —la zona que cambia—, no el estado a secas. Un distrito distinto que
    // resuelve la MISMA zona no le quita la orden a nadie: la bodega la sigue teniendo.
    const { service, corregirDatosCliente } = escenario(
      "en_bodega_satelite",
      distrito({ zonaId: "z-1", zonaNombre: "Zona Uno" }),
    );

    const r = await service.corregir({ ordenId: ORDEN_ID, ...MUDANZA }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
    expect(corregirDatosCliente.mock.calls[0][1]).toMatchObject({
      distritoId: "d-2",
      zonaId: "z-1",
    });
  });

  it("⭑ corregir el nombre o el telefono de una orden en el estante sigue permitido", async () => {
    // Es la razon de NO haber metido `en_bodega_satelite` en `ESTADOS_SIN_CORRECCION`: eso habria
    // bloqueado tambien estos datos, que no mueven la orden de bodega y son justo lo que hace
    // falta para poder despacharla.
    const { service, corregirDatosCliente, findDistritoParaCorreccion } =
      escenario("en_bodega_satelite");

    const r = await service.corregir(
      { ordenId: ORDEN_ID, destinatario: "Ana Maria Perez", telefonoDest: "8888-1111" },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    // Ni siquiera consulta el catalogo de distritos: no hay ubicacion que revalidar.
    expect(findDistritoParaCorreccion).not.toHaveBeenCalled();
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
  });
});
