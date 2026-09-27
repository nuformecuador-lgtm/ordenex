import { describe, it, expect, vi } from "vitest";

import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T13 — `findParaEnvio` RESUELVE EL SINPE POR LA BODEGA DEL MENSAJERO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Este es el camino del ENVIO POR SERVIDOR (Graph API). El otro —el texto que compone el
// dispositivo de quien contacta al cliente— sale de `MiAsignacionDTO` y usa LA MISMA funcion pura;
// que los dos rindan el mismo texto se afirma en `tests/unit/plantillas/preview-mismo-motor.test.ts`.
//
// ⚠️ EL FIXTURE TIENE LAS DOS ZONAS DISTINTAS A PROPOSITO. Con la del mensajero igual a la de la
// orden, el caso pasaria aunque el resolvedor devolviera siempre la de la orden — que es
// exactamente la mutacion (b) que esta ficha exige matar.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL.

const SINPE_ORDEN = { numero: "70000001", nombre: "Bodega de la Orden" };
const SINPE_MENSAJERO = { numero: "80000002", nombre: "Bodega del Mensajero" };

function filaDeOrden(opciones: {
  mensajero?: { zona: { nombre: string; sinpeNumero: string; sinpeNombre: string } | null } | null;
}) {
  const m = opciones.mensajero;
  return {
    id: "o-1",
    numGuia: 4321,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "50688880000",
    direccion: "Calle 1",
    producto: "Caja",
    peso: null,
    notas: null,
    montoCobrar: null,
    cobraComision: null,
    prioridad: null,
    intentosContacto: 0,
    fechaReparto: null,
    asignadoAt: null,
    createdAt: null,
    latitud: null,
    longitud: null,
    downloadUrl: null,
    estatus: { value: "en_reparto" },
    tienda: { nombre: "Tienda" },
    zona: {
      nombre: "Zona de la orden",
      sinpeNumero: SINPE_ORDEN.numero,
      sinpeNombre: SINPE_ORDEN.nombre,
    },
    provincia: { nombre: "Prov" },
    canton: { nombre: "Canton" },
    distrito: { nombre: "Distrito" },
    mensajeroAsignado:
      m === undefined
        ? {
            id: "m-1",
            nombre: "Jose",
            primerApellido: "Castillo",
            segundoApellido: null,
            email: "j@x.test",
            telefono: "80000000",
            cedula: "1-1",
            placa: "AAA-111",
            estado: "activo",
            vehiculo: { name: "Moto" },
            zona: {
              nombre: "Zona del mensajero",
              sinpeNumero: SINPE_MENSAJERO.numero,
              sinpeNombre: SINPE_MENSAJERO.nombre,
            },
          }
        : m,
  };
}

function readerCon(fila: unknown) {
  const findFirst = vi.fn().mockResolvedValue(fila);
  const prisma = { orden: { findFirst } } as unknown as ConstructorParameters<
    typeof OrdenEnvioReader
  >[0];
  return { reader: new OrdenEnvioReader(prisma), findFirst };
}

describe("429/R13 — manda la bodega del MENSAJERO ASIGNADO", () => {
  it("⭑ con un mensajero de OTRA bodega, el par es el de SU bodega", async () => {
    const { reader } = readerCon(filaDeOrden({}));
    const datos = await reader.findParaEnvio("o-1", "m-1");
    expect(datos).not.toBeNull();
    expect(datos?.negocio.sinpeNumero).toBe(SINPE_MENSAJERO.numero);
    expect(datos?.negocio.sinpeNombre).toBe(SINPE_MENSAJERO.nombre);
    // Anti-vacuidad: las dos zonas del fixture son distintas.
    expect(SINPE_MENSAJERO.numero).not.toBe(SINPE_ORDEN.numero);
  });

  it("los dos campos viajan juntos: nunca el numero de una y el nombre de otra", async () => {
    const { reader } = readerCon(filaDeOrden({}));
    const datos = await reader.findParaEnvio("o-1", "m-1");
    expect({ numero: datos?.negocio.sinpeNumero, nombre: datos?.negocio.sinpeNombre }).toEqual(
      SINPE_MENSAJERO,
    );
  });
});

describe("429/R15 — el respaldo es la bodega de la ORDEN, y nunca falta", () => {
  it("mensajero SIN zona (`usuario.zona_id` es nullable) -> la zona de la orden", async () => {
    const { reader } = readerCon(filaDeOrden({ mensajero: { zona: null } }));
    const datos = await reader.findParaEnvio("o-1", "m-1");
    expect(datos?.negocio.sinpeNumero).toBe(SINPE_ORDEN.numero);
    expect(datos?.negocio.sinpeNombre).toBe(SINPE_ORDEN.nombre);
  });

  it("SIN mensajero asignado -> la zona de la orden", async () => {
    const { reader } = readerCon(filaDeOrden({ mensajero: null }));
    const datos = await reader.findParaEnvio("o-1", "m-1");
    expect(datos?.negocio.sinpeNumero).toBe(SINPE_ORDEN.numero);
  });

  it("⭑ en los tres casos el par NUNCA sale vacio", async () => {
    // El fallo que esta ficha persigue no es una excepcion: es un mensaje que sale SIN numero y
    // que nadie nota. Este caso es la red de abajo.
    for (const fila of [
      filaDeOrden({}),
      filaDeOrden({ mensajero: { zona: null } }),
      filaDeOrden({ mensajero: null }),
    ]) {
      const { reader } = readerCon(fila);
      const datos = await reader.findParaEnvio("o-1", "m-1");
      expect(datos?.negocio.sinpeNumero).not.toBe("");
      expect(datos?.negocio.sinpeNombre).not.toBe("");
    }
  });

  it("una orden que no es de ese mensajero sigue devolviendo `null` (la puerta de R13 no cambia)", async () => {
    const { reader } = readerCon(null);
    expect(await reader.findParaEnvio("o-1", "otro")).toBeNull();
  });
});

describe("429/T13 — sin consultas nuevas", () => {
  it("⭑ sigue siendo UNA sola llamada a Prisma, con las dos columnas en los `select` que ya habia", async () => {
    // El coste declarado de la ficha es CERO consultas: las dos columnas se añaden a los `select`
    // de zona que este metodo ya hacia. Si alguien resolviera el SINPE con una lectura aparte, el
    // conteo subiria y esto se pondria rojo.
    const { reader, findFirst } = readerCon(filaDeOrden({}));
    await reader.findParaEnvio("o-1", "m-1");
    expect(findFirst).toHaveBeenCalledTimes(1);

    const args = findFirst.mock.calls[0][0] as {
      select: {
        zona: { select: Record<string, boolean> };
        mensajeroAsignado: { select: { zona: { select: Record<string, boolean> } } };
      };
    };
    expect(args.select.zona.select).toMatchObject({ sinpeNumero: true, sinpeNombre: true });
    expect(args.select.mensajeroAsignado.select.zona.select).toMatchObject({
      sinpeNumero: true,
      sinpeNombre: true,
    });
  });

  it("⭑ R17 — el `negocio` NO lee ninguna variable de entorno del SINPE", async () => {
    // Contraprueba del camino: se ponen las variables VIEJAS con un valor distinto y se comprueba
    // que el resultado sigue siendo el de la bodega. Si alguien reintrodujera el fallback
    // `valorDeLaZona || valorDelEntorno`, este caso seguiria verde — por eso ADEMAS existe la
    // guardia estatica `sinpe-sin-variables-de-entorno.guardia.test.ts`, que prohibe la cadena.
    const previo = process.env.NEXT_PUBLIC_SINPE_NUMERO;
    process.env.NEXT_PUBLIC_SINPE_NUMERO = "69999999";
    try {
      const { reader } = readerCon(filaDeOrden({}));
      const datos = await reader.findParaEnvio("o-1", "m-1");
      expect(datos?.negocio.sinpeNumero).toBe(SINPE_MENSAJERO.numero);
    } finally {
      if (previo === undefined) delete process.env.NEXT_PUBLIC_SINPE_NUMERO;
      else process.env.NEXT_PUBLIC_SINPE_NUMERO = previo;
    }
  });
});
