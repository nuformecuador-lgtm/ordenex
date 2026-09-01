// La Server Action del refresco forzado (pedido humano 2026-08-19).
//
// Se ejercita entera sin runtime de Next: el puerto de cache entra por `deps`, así que aquí no
// se importa `next/cache` —que lanza fuera de un request— ni hace falta base de datos.
import { describe, it, expect, vi } from "vitest";

import { refrescarCacheAnalitica } from "@/lib/actions/analitica-refrescar";
import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import {
  TAG_CICLO_VIDA,
  TAG_CONTEO_CARGADAS_POR_DIA,
  TAG_CONTEO_DEVOLUCIONES,
  TAG_CONTEO_ENTREGAS,
  TAG_CONTEO_HOY_GESTION,
  TAG_CONTEO_POR_STATUS,
} from "@/lib/analytics/entregas-conteo";
import { TAG_CONTEO_PRODUCTOS } from "@/lib/analytics/productos-consulta";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";

function cacheEspia() {
  const invalidar = vi.fn(async () => {});
  const cache: IAnaliticaCache = {
    envolver: async (_c, _t, producir) => producir(),
    invalidar,
  };
  return { cache, invalidar };
}

const ADMIN = { usuarioId: "u1", rol: "admin" };
const NOW = () => new Date("2026-08-19T12:00:00.000Z");

describe("refrescarCacheAnalitica", () => {
  // El botón promete «vuelve a leer de la base». Lo que lo cumple es esta invalidación: si
  // faltara un tag, esa gráfica seguiría sirviéndose de la entrada vieja mientras las otras se
  // recomputan, y la pantalla mezclaría dos momentos distintos sin decirlo.
  it("invalida las siete verticales de entregas y el dominio operativa", async () => {
    const { cache, invalidar } = cacheEspia();

    const res = await refrescarCacheAnalitica({
      cache,
      getActor: async () => ADMIN,
      now: NOW,
    });

    expect(res).toEqual({ status: "ok", lastSyncAt: "2026-08-19T12:00:00.000Z" });
    const [origen, tags] = invalidar.mock.calls[0] as unknown as [string, readonly string[]];
    expect(origen).toBe("manual");
    // La lista se escribe A MANO y no se deriva de `TAGS_ANALITICA`: comparar la constante
    // contra si misma estaria siempre verde. Ésta es la única aserción del repo que dice qué
    // tira el botón «Actualizar», así que es el contrato y se actualiza a conciencia.
    expect(new Set(tags)).toEqual(
      new Set([
        TAG_CONTEO_ENTREGAS,
        TAG_CONTEO_POR_STATUS,
        TAG_CONTEO_CARGADAS_POR_DIA,
        TAG_CONTEO_HOY_GESTION,
        TAG_CONTEO_DEVOLUCIONES,
        TAG_CICLO_VIDA,
        TAG_CONTEO_PRODUCTOS,
        ...TAGS_OPERATIVA,
      ]),
    );
  });

  // FICHA 345 / T5.2 (R42) — el tag de productos entra en el botón. Se afirma DOS veces y por
  // separado —pertenencia y CUENTA— porque una sola no basta: añadir el tag sin subir el número
  // pasaría el `toEqual` de arriba sólo si nadie más lo tocó, y bajar el número sin quitar el
  // tag no se vería. La cuenta es la que detecta que alguien retire una vertical de paso.
  it("el tag de productos está, y el total de tags subió de 6 a 7 verticales", async () => {
    const { cache, invalidar } = cacheEspia();

    await refrescarCacheAnalitica({ cache, getActor: async () => ADMIN, now: NOW });

    const [, tags] = invalidar.mock.calls[0] as unknown as [string, readonly string[]];
    expect(tags).toContain(TAG_CONTEO_PRODUCTOS);
    expect(tags).toHaveLength(7 + TAGS_OPERATIVA.length);
    // Y el prefijo es PROPIO: no colisiona con ninguna de las otras seis verticales.
    expect(TAG_CONTEO_PRODUCTOS).not.toBe(TAG_CONTEO_POR_STATUS);
    expect(new Set(tags).size).toBe(tags.length);
  });

  // Sin sesión no se toca la cache: tirarla es un efecto sobre TODOS los inquilinos, y un
  // anónimo no puede provocar el recomputo de la analítica entera.
  it("sin sesión no invalida nada", async () => {
    const { cache, invalidar } = cacheEspia();

    const res = await refrescarCacheAnalitica({ cache, getActor: async () => null, now: NOW });

    expect(res).toEqual({ status: "unauthenticated" });
    expect(invalidar).not.toHaveBeenCalled();
  });

  // El gate es el MISMO que abre la pantalla: quien no puede ver estas cifras tampoco puede
  // pedir que se recalculen. `mensajero` está fuera por la decisión del 2026-08-12.
  it("un rol sin acceso a la analítica no invalida nada", async () => {
    const { cache, invalidar } = cacheEspia();

    const res = await refrescarCacheAnalitica({
      cache,
      getActor: async () => ({ usuarioId: "u2", rol: "mensajero" }),
      now: NOW,
    });

    expect(res).toEqual({ status: "forbidden" });
    expect(invalidar).not.toHaveBeenCalled();
  });

  // R11 de la 128: una invalidación que falla en silencio deja la cifra congelada Y la pantalla
  // diciendo que la acaba de traer. Sube, y el botón lo pinta.
  it("propaga el fallo de la invalidación", async () => {
    const cache: IAnaliticaCache = {
      envolver: async (_c, _t, producir) => producir(),
      invalidar: async () => {
        throw new Error("revalidateTag falló");
      },
    };

    await expect(
      refrescarCacheAnalitica({ cache, getActor: async () => ADMIN, now: NOW }),
    ).rejects.toThrow("revalidateTag falló");
  });
});
