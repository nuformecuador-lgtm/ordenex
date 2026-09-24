// @vitest-environment jsdom
// FICHA 455 (2026-09-24) — los textos que la revisión (M1, M2) y el recorrido T3.2 (F1-F8) hallaron con
// un nombre retirado, y que se reescribieron con el criterio del leader: si un texto nombra un estado,
// su nombre EXACTO de `NOMBRE_ESTADO`; si un rótulo usa un participio viejo, el nombre nuevo o una
// forma neutra en masculino (se habla del paquete), con el voseo o tuteo de su pantalla y con tildes.
//
// Literales de contrato escritos A MANO (memoria «Aserción contra su propia fuente»): comparar con la
// constante que los produce los dejaría verdes con cualquier contenido. La red general es G2
// (`tests/unit/guards/nombres-estado-retirados.guardia.test.ts`); esto fija el texto nuevo.
import { describe, expect, it } from "vitest";

import { DETALLE_DINERO_TEXTOS } from "@/app/(app)/analitica/_components/entregas/DineroProductoDetalle";
import { PRODUCTOS_TEXTOS } from "@/app/(app)/analitica/_components/entregas/ProductosTabla";
import { fraseSobreCerradas } from "@/app/(app)/analitica/_components/entregas/madurez-textos";
import { PANELES_OPERATIVOS } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { TEXTO_NOTA_SIN_GESTIONAR } from "@/app/(app)/analitica/_components/operativo/textos";
import { contadorContactos } from "@/app/(app)/mis-asignaciones/_components/chat/chat-contactos";
import { RECHAZO_CONFLICTO, RECHAZO_EXITO } from "@/app/(app)/novedades/_components/RechazarNovedadModal";
import { envioDevolucionCentralErrorMessage } from "@/app/(app)/ordenes/_components/envio-devolucion-central-error-messages";
import { PODIO_LABELS, RANKING_COLUMNAS } from "@/app/(app)/ranking/_components/ranking-labels";
import { RANKING_HISTORICO_COLUMNAS } from "@/app/(app)/ranking/historico/_components/ranking-historico-labels";
import { PREMIOS_RANKING } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";
import { MOTIVO_RECHAZO_TOPE_INTENTOS } from "@/lib/repositories/CierresAdminRepository";

describe("455/M1 — el error del envío a bodega central nombra el estado vigente", () => {
  it("«Por devolver a bodega central», entre las mismas comillas", () => {
    expect(envioDevolucionCentralErrorMessage("conflict")).toBe(
      "Alguna orden ya no está en estado “Por devolver a bodega central”.",
    );
  });
});

describe("455/F4 — la ventana «Rechazar» de novedades", () => {
  it("el éxito y la carrera perdida nombran los estados con su nombre vigente", () => {
    expect(RECHAZO_EXITO).toBe("La orden pasó a Devolución a origen por rechazo. El paquete vuelve a tu bodega.");
    expect(RECHAZO_CONFLICTO).toBe(
      "Esta orden ya no estaba en Novedad, así que no se rechazó. Actualizá la pantalla.",
    );
  });
});

describe("455/F5 — analítica", () => {
  it("«terminaron en Entregado»", () => {
    expect(fraseSobreCerradas({ valor: 0.5, base: 10 } as never, 20)).toMatch(/ de las 10 .* terminaron en Entregado$/);
  });
  it("el aviso del desglose y la pista del flete nombran los grupos como la frase de «En qué terminaron»", () => {
    expect(PRODUCTOS_TEXTOS.avisoDesglose).toBe(
      "Cada orden cuenta en un solo grupo: Entregado, Devolución a origen por rechazo, los demás resultados y Sin desenlace todavía suman la columna Órdenes.",
    );
    expect(DETALLE_DINERO_TEXTOS.totales.retornoPista).toBe(
      "Flete por rechazo + IVA de las órdenes en Devolución a origen por rechazo. Fuera del reparto",
    );
  });
  it("el panel de `novedad_interna` y su nota", () => {
    expect(PANELES_OPERATIVOS.map((p) => p.titulo)).toContain("Órdenes en Novedad interna");
    expect(TEXTO_NOTA_SIN_GESTIONAR).toBe(
      "Cuenta las órdenes en Novedad interna de cada día, no un acumulado que arrastre días anteriores.",
    );
  });
});

describe("455/F6 — ranking y premios, en masculino", () => {
  it("«Entregados / asignados»", () => {
    expect(RANKING_COLUMNAS.conteo).toBe("Entregados / asignados");
    expect(PODIO_LABELS.descripcion).toBe("Efectividad · entregados / asignados · hoy");
    expect(RANKING_HISTORICO_COLUMNAS.asignadas).toBe("Asignados");
    expect(PREMIOS_RANKING.entregadasAsignadas(14, 20)).toBe("14 / 20 entregados");
    expect(PREMIOS_RANKING.entregadasAyuda).toBe(
      "Entregados de asignados ese día. Quien no entregó nada no ocupa podio ni cobra premio.",
    );
  });
});

describe("455/F7 — el contador del chat del mensajero", () => {
  it("«4 asignados», «1 asignado»", () => {
    expect(contadorContactos(4)).toBe("4 asignados");
    expect(contadorContactos(1)).toBe("1 asignado");
  });
});

describe("455/F3 — el motivo de la devolución automática al aprobar un cierre", () => {
  it("nombra los dos estados con su nombre vigente", () => {
    expect(MOTIVO_RECHAZO_TOPE_INTENTOS).toBe(
      "Devolución a origen por rechazo al aprobar el cierre: estaba en Novedad interna y sin intentos de entrega disponibles",
    );
  });
});
