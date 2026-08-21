# Feature 258 — Diseño

Rediseño de `/monitoreo` sobre las primitivas del repo + una lectura nueva de backend (entregas
acumuladas por hora). Base: la feature 192, `done`, cuyo código completo se leyó antes de
escribir esto.

> **Lo que NO se toca, y hay que saberlo antes de leer nada más:** la frontera multi-tenant
> (`resolverAlcance` + lista blanca `global|zona` en `TableroDiaService`), el universo «asignada
> hoy» (`cteIdsDelDia`), la definición de «resultado del día» (última gestión vigente de la
> ventana), el TTL de caché (15 s) y el refresco de 30 s. Debajo de esta pantalla **no hay RLS**:
> el recorte del servicio es la única separación entre inquilinos.

---

## 1. Las guardias que gobiernan este diseño

Se leyeron y se citan porque condicionan decisiones concretas, no como adorno.

| Guardia | Qué prohíbe | Qué obliga aquí |
| --- | --- | --- |
| `tests/unit/tablero-dia/frontera.guardia.test.ts` | `startOfDayCR`; importar la analítica de cierre o nombrar `analytics_daily`; leer `.rol` o declarar ≥2 roles fuera de `page.tsx`; `findMany`; SQL crudo fuera del repositorio; consultas ni agregadas ni paginadas; segundo mapa estatus→etiqueta/color; **nombrar `badgeVariants`** | la serie va en el repositorio, con `GROUP BY`; la hora sale de `ventana.desde`; el mapa de variantes se clava por clave de contador; el tipo de la variante se saca de `ComponentProps<typeof Badge>` |
| ídem, cláusula (d) | `expect(consultas).toHaveLength(2)` y `clasificacion` `["agregada","paginada"]` | **la tercera consulta obliga a tocar el guardia**. Su propio comentario lo dice: *«Una tercera obliga a pasar por aquí y justificarse»*. Es una tarea, no un daño colateral |
| `tests/unit/tablero-dia/cache-sin-invalidacion.guardia.test.ts` | `revalidateTag`/`revalidatePath`/`updateTag`; `next/cache` fuera del adaptador; redeclarar el TTL | la serie **no** trae caché propia ni tag propio |
| `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` | escribir `asignado_at` | la consulta nueva es `SELECT` y nada más |
| `tests/unit/components/analytics-paquete-guard.test.ts` | importar `recharts` fuera de `components/private/analytics/lienzo/`; y EXIGE que las gráficas monten su lienzo con `lazy(() => import(…))` | la línea **reusa `GraficaLineas`**, que no escribe `from "recharts"`: no hay que tocar esta guardia y el lienzo sigue llegando diferido (§7) |

Detalle fino del censo de colores, porque decide la forma del código: el detector es
`(?:^|[{,\s])([a-z_]+)\s*:\s*["'…]([^"'…]*)["'…]` y sólo se dispara si la CLAVE es un value de
`ORDER_STATUS_SEED`. `entregada` lo es; `entregadas` **no**. Por eso el mapa de variantes se
clava por clave de contador (§4) y por eso `CONTADOR_POR_RESULTADO` —clavado por value del enum
con valores como `"entregadas"`— sigue siendo legítimo.

---

## 2. Mapa de archivos

### Bloque BACKEND (va primero, `backend_dev`)

| Archivo | Cambio |
| --- | --- |
| `lib/types/tablero-dia.ts` | **+** `PuntoRitmoEntregas`; **+** campo `ritmoEntregas` en `TableroDia`; **+** `sumarTotalesTablero`, que **se MUEVE** desde el servicio (§9) |
| `lib/utils/ventana-dia-cr.ts` | **+** `horaDeParedCR(ventana, instante): number` (0..23) |
| `lib/interfaces/repositories/ITableroDiaRepository.ts` | **+** `EntregasEnHora`; **+** método `contarEntregasPorHora` |
| `lib/repositories/TableroDiaRepository.ts` | **+** tercera consulta, **al final del archivo** |
| `lib/services/TableroDiaService.ts` | `obtener` pide las dos lecturas en paralelo y acumula; **+** `acumularPorHora` exportada; `sumarTotales` deja de vivir aquí y se consume del contrato |
| `tests/unit/services/_doble-tablero-dia.ts` | el doble implementa el método nuevo |
| `tests/unit/tablero-dia/frontera.guardia.test.ts` | tres consultas, clasificación `["agregada","paginada","agregada"]` |
| `tests/unit/actions/tablero-dia-accion.test.ts` | el literal `ResultadoTableroDia` gana el campo |

`lib/actions/tablero-dia.ts` **no cambia**: la serie viaja dentro de `leerTableroDia` (§6).

### Bloque FRONTEND (después, `frontend_dev`)

| Archivo | Cambio |
| --- | --- |
| `app/(app)/monitoreo/_components/contadores.ts` | **+** `VARIANTE_CONTADOR` y **+** `COLOR_SEGMENTO` (dos mapas exhaustivos) |
| `…/ContadoresTablero.tsx` | los ocho contadores pasan a `Badge`; recibe `densidad`; monta la barra |
| `…/MensajeroCard.tsx` | densidad, `aria-pressed`, avatar de iniciales (R71) |
| `…/TableroDiaRejilla.tsx` | columnas y `gap` según densidad; el orden NO cambia |
| `…/TableroDiaTotales.tsx` | tira de totales (rótulo y marca de filtrado, R64); barra; hueco para la línea |
| `…/TableroDiaEstados.tsx` | iconos; vacío con `EmptyState`; vacío de filtro |
| `…/TableroDiaModule.tsx` | iconos en los dos `Alert`; estado de filtro y densidad; recálculo de totales |
| `…/DetalleMensajeroPanel.tsx` | `Sheet` → `Modal` + `DataTable` + `Pagination`; avatar en la cabecera |
| **NUEVO** `…/TableroDiaControles.tsx` | `Input` de filtro + `SegmentedToggle` de densidad |
| **NUEVO** `…/filtrar-mensajeros.ts` | normalización, filtro e **iniciales**; funciones puras |
| **NUEVO** `…/ComposicionBarra.tsx` | la barra apilada de ocho segmentos (R66–R70) |
| **NUEVO** `…/serie-ritmo.ts` | adapta `PuntoRitmoEntregas[]` → `SerieDato[]`; función pura (R77) |
| `app/(app)/monitoreo/page.tsx` | **sin cambios** (se verifica, R63) |

---

## 3. Qué cuenta como «entrega» en la serie, y por qué cuadra

`entregadas` de la tarjeta es hoy, literalmente:

> orden del universo `ids_del_dia` (asignada hoy por reparto **o** por recolección), con
> mensajero, no borrada, dentro del alcance, cuya **última gestión vigente de la ventana** tiene
> `resultado = 'entregada'` (el `DISTINCT ON (orden_id) … ORDER BY created_at DESC, id DESC`).

La serie cuenta **ese mismo conjunto**, y le pone a cada orden la **hora de esa gestión final**.
De ahí sale el cuadre de R52 sin comprobarlo a posteriori: la serie es una partición por hora del
mismo conjunto que produce el contador, así que su acumulado final es su cardinalidad.

### ⚠️ LA LÍNEA PUEDE BAJAR, Y ESO ESTÁ BIEN (R72)

**Si estás leyendo esto porque viste el gráfico retroceder: no es un bug. Es la decisión, y la
firmó el humano el 2026-08-21 después de ver este caso exacto.**

La serie se recalcula **entera** en cada lectura: es una *reconstrucción* del día con la
información de ahora, no un registro histórico de lo que se vio a cada hora. Caso concreto:

> Una orden se gestiona `entregada` a las **10:00**. A las **15:00** el mensajero la gestiona
> `reprogramada`. Su última gestión del día ya no es `entregada`, así que **sale** de la serie: en
> el siguiente refresco, el punto de las 10:00 **baja en uno**.

Y tiene que bajar, porque en ese mismo refresco el contador `entregadas` de la tarjeta también
bajó en uno. La alternativa —una curva que nunca retrocede— sólo se consigue contando *cualquier*
gestión `entregada` del día, y entonces la línea y el contador que está a dos centímetros de ella
dirían números distintos sobre las mismas órdenes. **Se prefiere una curva que retrocede y cuadra
a una curva bonita que miente.**

Un test de integración lo fija como comportamiento esperado (`tasks.md` B5.1, escenario 3): si
alguien «arregla» esto, se pone rojo.

### Alternativas descartadas

- **Contar por `orden.estatus = 'entregada'`.** No cuadra en los dos sentidos: una orden entregada
  *ayer* sigue hoy en ese estatus (entraría sin ser del día), y una entregada hoy que después se
  mueva a otro estatus saldría (faltaría). Además el estatus no tiene hora propia: habría que
  volver al historial de todos modos.
- **Contar TODAS las gestiones `entregada` del día, sin `DISTINCT ON`.** Da una curva que nunca
  baja —más bonita— pero infla: una orden con dos gestiones aportaría dos, y `GestionOrden` no
  tiene `@@unique(ordenId)`. Rompería R52 y contradiría en pantalla al contador de al lado.
- **Reutilizar `analytics_daily` / el rollup del cierre.** Prohibido por la guardia (R38 de la
  192) y sin sentido: el día en curso no tiene rollup.

---

## 4. Los ocho contadores en `Badge`

### El mapa, y dónde vive

En `app/(app)/monitoreo/_components/contadores.ts`, que ya es el hogar de la presentación de los
contadores:

```ts
import type { ComponentProps } from "react";
import type { Badge } from "@/components/ui/badge";

/** La variante viene del PROPIO componente: nombrar `badgeVariants` pondría el guardia rojo. */
type VarianteContador = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export const VARIANTE_CONTADOR = {
  entregadas:    "success",
  reprogramadas: "warning",
  devueltas:     "warning",
  rechazadas:    "danger",
  incidentes:    "danger",
  sinRecoger:    "secondary",
  enReparto:     "info",
  otros:         "outline",
} as const satisfies Record<ClaveResultado | BucketSinResultado, VarianteContador>;
```

Tres cosas que no son estilo:

1. **`satisfies Record<…>` exhaustivo** ⇒ un sexto resultado o un cuarto cubo **no compila** sin
   variante (R16). Misma defensa que ya usan `ETIQUETA_RESULTADO` y `ETIQUETA_BUCKET`.
2. **Clavado por clave de contador** (R17): `entregadas`, no `entregada`. Con la clave del enum,
   el par `entregada: "success"` dispararía `declaraColoresDeEstatus` y el guardia se pondría
   rojo. Las claves camelCase (`sinRecoger`, `enReparto`) ni siquiera entran en el detector.
3. **`ComponentProps<typeof Badge>["variant"]`** y no `VariantProps<typeof badgeVariants>`
   (R18): el identificador literal `badgeVariants` está censado.

### El color codifica GRAVEDAD, no identidad — y aquí la primitiva se queda corta

**Esto es un punto donde una primitiva NO da lo que hace falta, y se dice explícitamente** (como
pidió el humano). El par semántico de `globals.css` tiene **cuatro** colores (`success`,
`warning`, `info`, `danger`) y hay **ocho** contadores. La maqueta resuelve el empate inventando
un morado y un marrón (`#8b5cf6`, `#9a3412`), que `DESIGN.md` prohíbe de plano («NUNCA hex
sueltos»).

Alternativa evaluada y **descartada**: añadir dos semánticos nuevos al sistema de diseño. Se
descarta porque un token nuevo obliga a definir sus tres roles (`-soft`/base/`-strong`) con sus
contrastes medidos en los dos temas, y eso es una ficha de sistema de diseño, no de una pantalla.

Decisión: **el color dice cuán bien o mal terminó, no cuál de los ocho es**. La identidad la
llevan siempre la etiqueta y la cifra, que van dentro del mismo `Badge`. Por eso hay colisiones a
propósito (`reprogramadas`/`devueltas` en `warning`, `rechazadas`/`incidentes` en `danger`) y por
eso `sinRecoger` va en `secondary` y `otros` en `outline`: lo que todavía no arrancó no lleva
acento (`DESIGN.md`: «nada de saturación fuerte en estados inactivos») y el cajón de sastre va sin
color, para que se note que no está clasificado.

El modo oscuro deja de ser problema de esta feature: las variantes de `Badge` ya son
`bg-{sem}-soft text-{sem}-strong dark:bg-{sem}/15`, es decir los tres roles bien emparejados
(R47).

### La barra apilada de composición (R66–R70)

Entra por decisión humana: **es lo que hace que la dirección A sea A**. Vive en
`ComposicionBarra.tsx` porque la montan dos sitios (la tira de totales y cada tarjeta) y tienen
que pintar el mismo reparto — si cada uno se armara la suya, la tarjeta y el total podrían contar
historias distintas del mismo dato, que es exactamente lo que R30 de la 192 evita.

Segundo mapa exhaustivo en `contadores.ts`, con la MISMA regla de clavado que `VARIANTE_CONTADOR`
(por clave de contador, nunca por value de estatus — §1):

```ts
export const COLOR_SEGMENTO = {
  entregadas:    "bg-success",              // semántico base
  reprogramadas: "bg-warning",              // semántico base
  devueltas:     "bg-chart-6",              // sin semántico propio → token de gráfica
  rechazadas:    "bg-danger",               // semántico base
  incidentes:    "bg-chart-11",             // sin semántico propio → token de gráfica
  sinRecoger:    "bg-chart-12",             // sin semántico propio → token de gráfica
  enReparto:     "bg-info",                 // semántico base
  otros:         "bg-muted-foreground/40",  // el cajón de sastre, sin acento
} as const satisfies Record<ClaveResultado | BucketSinResultado, string>;
```

**Por qué esos tokens y no otros**, verificado leyendo `app/globals.css`:

- **La base semántica es el rol correcto para una barra.** `DESIGN.md` lo dice literalmente:
  «base (`--color-success`, …) = borde, acento y **punto de estado (dot, icono, barra)**». El
  `-soft` es fondo de chip y el `-strong` es texto; ninguno de los dos pinta un segmento.
- **`--chart-1..20` GIRAN con el tema.** Se declaran en `:root` (`globals.css:252`) y se
  redefinen en `.dark` (`:835`) y en `.tema-sistema` (`:911`). Por eso los tres contadores sin
  semántico propio van ahí y no a un hex: `chart-11` es `#9a3412` en claro y `#fdba74` en
  oscuro — un marrón fijo sobre una pista oscura sería invisible.
- **Los tres elegidos son los de la maqueta, ya tokenizados**: `chart-6` = `#8b5cf6` (el morado
  de `devueltas`), `chart-11` = `#9a3412` (el marrón de `incidentes`), `chart-12` = `#64748b`
  (el gris de `sinRecoger`). No se inventa ninguna paleta: se usa la que el repo ya tiene.

**El color no lleva el dato solo** (R68). Cada segmento es un `<div>` con `title` y sin texto
dentro; el dato vive **debajo**, en la leyenda, que son los mismos ocho `Badge` de §4 —punto de
color + etiqueta + cifra—. Y la barra entera es un `role="img"` cuyo `aria-label` enumera los
ocho valores («Composición del día: Entregadas 84, Reprogramadas 12, …»). Quien no distingue
verde de naranja lee los números; el lector de pantalla lee la frase. La pista de la barra es
`bg-muted` (gira), así que el par pista/segmento nunca queda oscuro-sobre-oscuro.

**Un contador a cero no pinta segmento** (R69): un `<div>` de ancho 0 % es un nodo invisible que
ensucia el DOM y el `aria-label`. Se filtran antes de mapear, exactamente como hace la maqueta.
Los porcentajes se calculan sobre las `asignadas` del bloque que la monta (R70), así que la barra
de una tarjeta filtrada y la de la tira filtrada siguen siendo el 100 % de lo suyo.

### Lo que se conserva del DOM

`Badge` es un `span` con `mergeProps`, así que acepta el spread actual sin envoltorio: el
`data-contador`, el `title` con la ayuda del cubo y el texto (etiqueta + valor) siguen donde
están. Los tests que hacen `contador(tarjeta, "otros")` y
`toHaveAttribute("title", ayudaBucket("otros"))` **no cambian de selector**.

`asignadas` **no** pasa a `Badge`: no es uno de los ocho, es la cifra titular de la tarjeta y del
bloque de totales. Se queda como número grande con su `data-contador="asignadas"`.

**Alternativa descartada:** usar `KpiValorAnimado` para la cifra titular de los totales. Se
descarta porque el número cambia cada 30 s por diseño: una animación de conteo en un tablero de
monitoreo es movimiento decorativo, y `DESIGN.md` reserva el motion para *estado*, no para
adorno.

---

## 5. Los cinco estados y su icono

Todos los nombres están **verificados como ya usados en el repo** con esta versión de
`lucide-react` (`^1.23.0`), salvo `Lock`, que lleva su comprobación como paso de tarea.

| Estado | `data-slot` | Primitiva | Icono | Por qué ese |
| --- | --- | --- | --- | --- |
| Cargando | `tablero-dia-skeleton` | esqueleto + `Skeleton` | `Loader2` con `motion-safe:animate-spin` | es el icono de «esto está en marcha» que ya usan `Button loading` y el `Modal` en fase pendiente; no se inventa un segundo vocabulario de espera |
| Sin órdenes hoy | `tablero-dia-vacio` | `EmptyState` | `CalendarDays` | lo que está vacío es **el día**, no una bandeja: dice «hoy todavía no hay nada asignado» sin sugerir que falte una acción del usuario (`Inbox`, que usa el listado de órdenes, diría «esta lista no tiene resultados», que es otra cosa) |
| Refresco fallido | `tablero-dia-aviso-refresco` | `Alert variant="destructive"` | `TriangleAlert` | la señal es «cuidado con lo que estás leyendo», no «se rompió»: los datos siguen ahí y pueden estar viejos. Es el mismo triángulo que el `Toast` de la casa usa para advertir |
| Acceso denegado | `tablero-dia-denegado` | `Alert variant="destructive"` | `Lock` | es un NO cerrado y sin remedio desde aquí: no es un aviso de cuidado (triángulo) ni una explicación (i) |
| Tarjeta desaparecida | `tablero-dia-aviso-desaparecido` | `Alert` (default) | `Info` | no pasó nada malo: se explica **por qué** se cerró el detalle. En rojo, el supervisor creería que perdió algo |

Dos estados más que no son de los cinco pero llevan icono por coherencia:

- **Sin coincidencias del filtro** — `data-slot="tablero-dia-sin-coincidencias"`, `EmptyState` con
  `Search` y CTA «Quitar el filtro». Icono distinto y texto distinto del vacío del día (R42): el
  vacío lo produjo *lo que escribiste*, no el día.
- **Sin entregas todavía** — lo resuelve `GraficaMarco` con su propio `EmptyState` cuando el
  adaptador devuelve una serie vacía (§7, R59). Es el único vacío de la pantalla **sin icono**, y
  está explicado ahí: el contrato `TextoVacio` del paquete no lo expone.

El `Alert` aplica `has-[>svg]:grid-cols-[auto_1fr]`, así que el icono va **como primer hijo**,
antes de `AlertTitle` (R27). `EmptyState` ya pinta su `icon` dentro de un disco `bg-muted` y con
`aria-hidden` (R26). El esqueleto conserva su `role="status" aria-busy="true"` con el icono
`aria-hidden` dentro de la misma región (R28).

---

## 6. Contrato de datos y dónde se decide cada cosa

### `lib/types/tablero-dia.ts` (extensión, aditiva)

```ts
/**
 * Un punto de la serie de entregas ACUMULADAS del día.
 * `hora` es la hora de PARED de Costa Rica (0..23) del día representado.
 * `acumulado` es el nº de órdenes entregadas desde el inicio del día CR hasta el FIN de esa hora.
 */
export interface PuntoRitmoEntregas {
  readonly hora: number;
  readonly acumulado: number;
}

export interface TableroDia {
  readonly fecha: string;
  readonly generadoAt: string;
  readonly alcance: "global" | "zona";
  readonly filas: readonly FilaTableroDia[];
  readonly totales: TotalesTableroDia;
  /** R50/R52 — su último punto es `totales.entregadas`. Vacía sólo si el día no tiene entregas. */
  readonly ritmoEntregas: readonly PuntoRitmoEntregas[];
}
```

Campo **obligatorio**, no opcional: opcional dejaría que una implementación lo olvidara y la
pantalla se quedara sin línea sin que nada se pusiera rojo. Que rompa los literales de test es
justamente lo que hace que el contrato se propague (memoria del repo: *«Literal: contrato o
polizón»* — aquí el literal **es** el contrato y se extiende, no se afloja).

⚠ Tocar `lib/types/` hace que **`./init.sh --rapido` se niegue solo**. La corrida completa es
obligatoria; está escrito en `tasks.md`.

### `ITableroDiaRepository` (extensión)

```ts
/** Entregas del día con su hora de pared CR. SÓLO las horas CON entregas: los huecos los rellena el servicio. */
export interface EntregasEnHora {
  readonly hora: number;     // 0..23
  readonly entregadas: number;
}

contarEntregasPorHora(
  ventana: VentanaDiaCR,
  filtro: FiltroAlcanceTablero,
): Promise<readonly EntregasEnHora[]>;
```

El repositorio devuelve el **histograma**, no el acumulado: acumular es aritmética de
presentación de datos, es pura y se prueba sin base. Y devolver sólo las horas con entregas
mantiene el `GROUP BY` mínimo.

### La consulta (tercera de `TableroDiaRepository`, **al final del archivo**)

```sql
WITH <cteIdsDelDia(ventana)>,
asignadas AS (
  SELECT o."id" AS orden_id
  FROM ids_del_dia d
  JOIN "orden" o ON o."id" = d.id
  WHERE o."mensajero_asignado_id" IS NOT NULL
    AND o."deleted_at" IS NULL
    AND <fragmentoDeAlcance(filtro)>
),
resultado_final AS (
  SELECT DISTINCT ON (g."orden_id")
         g."orden_id"   AS orden_id,
         g."resultado"  AS resultado,
         g."created_at" AS at
  FROM "gestion_orden" g
  JOIN asignadas a ON a.orden_id = g."orden_id"
  WHERE g."anulada_at" IS NULL
    AND g."created_at" >= ${ventana.desde}
    AND g."created_at" <  ${ventana.hasta}
  ORDER BY g."orden_id", g."created_at" DESC, g."id" DESC
)
SELECT FLOOR(EXTRACT(EPOCH FROM (r.at - ${ventana.desde}::timestamp)) / 3600)::int AS hora,
       COUNT(*) AS entregadas
FROM resultado_final r
WHERE r.resultado = ${RESULTADO_ENTREGADA}::"gestion_resultado"
GROUP BY 1
ORDER BY 1
```

Cuatro decisiones dentro:

1. **Reutiliza `cteIdsDelDia` y `fragmentoDeAlcance` tal cual.** No se copian: se llaman. Si el
   universo «asignada hoy» cambia, cambia para las tres consultas a la vez, que es la única forma
   de que R51/R52 sigan siendo ciertos.
2. **`DISTINCT ON` idéntico al del tablero**, mismo desempate `created_at DESC, id DESC`. Es la
   MISMA definición de «resultado del día», escrita una tercera vez con la misma forma. El test de
   cuadre de integración es el que caza que no diverjan.
3. **La hora sale de `ventana.desde`, no de una zona horaria en SQL** (R53). Costa Rica es UTC−6
   fijo y sin horario de verano (`lib/utils/fecha-cr.ts:12`), y `ventana.desde` **es** las 00:00 de
   pared de CR: restar y dividir entre 3600 da la hora de pared directamente, 0..23, por
   construcción.
   - **Alternativa descartada:** `AT TIME ZONE 'America/Costa_Rica'`. Metería una **segunda fuente
     de verdad** de la zona horaria —una en `lib/utils/fecha-cr.ts` y otra dentro de una cadena
     SQL— y ataría el resultado al catálogo `tzdata` del servidor Postgres. Los off-by-one de esta
     familia ya costaron la ficha 166 en este repo.
   - **Alternativa descartada:** agrupar en TypeScript sobre las órdenes del día. Es exactamente lo
     que la guardia prohíbe (`findMany`, consultas ni agregadas ni paginadas) y la deuda de la
     ficha 191.
4. **`RESULTADO_ENTREGADA`** se declara una vez en el repositorio como
   `"entregada" satisfies GestionResultado`, y un test afirma
   `CONTADOR_POR_RESULTADO[RESULTADO_ENTREGADA] === "entregadas"`. Así la serie queda **atada por
   test al contador con el que debe cuadrar**, en vez de por coincidencia de nombres.

El `::timestamp` explícito sobre el parámetro es deliberado: el driver manda los parámetros sin
tipo y la inferencia del operador `-` no es algo que convenga suponer. Se verifica con el test de
integración contra Postgres real, no con una regex.

### El servicio

```ts
async obtener(actor, now) {
  const auth = autorizar(actor);            // 1. autorización, SIEMPRE primero
  if (auth.estado === "denegado") return auth;

  const ventana = ventanaDelDiaEnCursoCR(now);
  const clave = claveDeTablero(auth.alcance, ventana.fecha);

  const tablero = await this.cache.envolver<TableroDia>(clave, async () => {
    const [conteos, porHora] = await Promise.all([
      this.repositorio.contarPorMensajero(ventana, auth.filtro),
      this.repositorio.contarEntregasPorHora(ventana, auth.filtro),
    ]);
    const filas = ordenarFilas(conteos);
    return {
      fecha: ventana.fecha,
      generadoAt: now.toISOString(),        // R57 — UNO solo, para las dos lecturas
      alcance: auth.filtro.tipo,
      filas,
      totales: sumarTotales(filas),
      ritmoEntregas: acumularPorHora(porHora, horaDeParedCR(ventana, now)),
    };
  });

  return { estado: "ok", tablero };
}
```

- **Un actor denegado nunca llega al `Promise.all`** (R56): la autorización sigue por encima de la
  caché, y la clave se deriva de haber autorizado.
- **`Promise.all` y no secuencial**: las dos consultas son independientes y sólo se ejecutan al
  fallar la caché; encadenarlas sumaría latencias sin ganar nada.
- **`acumularPorHora(histograma, horaCorte)`** es una función pura exportada (como
  `claveDeTablero`): rellena `0..horaCorte` sin huecos, acumula, y es monótona por construcción
  (R54). Se prueba sin base y sin Next.
- **`horaDeParedCR(ventana, instante)`** vive en `lib/utils/ventana-dia-cr.ts` porque es la misma
  aritmética de la ventana: `clamp(floor((instante − ventana.desde)/3.6e6), 0, 23)`. Nunca
  `startOfDayCR`.

### Caché y `generadoAt`: la serie viaja DENTRO del tablero

**Decisión: mismo objeto, misma clave, mismo `generadoAt`, mismo TTL de 15 s.**

Alternativas descartadas:

- **Server Action propia (`leerRitmoEntregas`) + SWR aparte.** Con refresco de 30 s serían **dos
  peticiones por ciclo y por usuario** en vez de una, y sobre todo **dos `generadoAt` distintos**:
  la cabecera diría «hace 4 s» y la línea vendría de otro instante. R34 de la 192 existe justo
  porque anunciar como fresco un dato viejo es lo que hace que alguien decida con un número que no
  es. Dos relojes en la misma pantalla es esa misma mentira, partida en dos.
- **Clave de caché propia para la serie.** Duplicaría el espacio de claves —y con él la superficie
  del riesgo de R67 de la 192, que es una frontera multi-tenant— a cambio de nada: el consumidor y
  el ciclo de vida son idénticos.
- **Fundir las dos consultas en una sola con `json_agg`.** Obligaría a una fila heterogénea, a un
  mapeo con `bigint` anidado y a que la guardia clasificara una sola consulta que hace dos cosas.
  Menos legible y más frágil que dos consultas agregadas que comparten CTE por llamada de función.

**Coste real, medido en decisiones y no en adjetivos:** una consulta agregada extra **por
producción de caché**, no por refresco (la caché de 15 s absorbe los ciclos intermedios y las
peticiones concurrentes de N usuarios del mismo alcance). En el payload, 24 puntos de dos números
frente a N filas de mensajero con diez campos: despreciable.

---

## 7. Cómo se pinta la línea: se REUSA `GraficaLineas` (R76–R78)

**Decisión: se monta `components/private/analytics/GraficaLineas`. No se dibuja un SVG propio.**

Una versión anterior de este diseño proponía un sparkline a mano por tres costes atribuidos a
`GraficaLineas`. **Dos de los tres eran falsos**, y se comprobaron leyendo el código antes de
escribir esto:

| Coste que se le atribuía | Comprobación | Veredicto |
| --- | --- | --- |
| «mete `recharts` en el bundle de `/monitoreo`» | `GraficaLineas.tsx:14` hace `lazy(() => import("./lienzo/LineasLienzo"))`; el único archivo que escribe `from "recharts"` es el lienzo | **FALSO.** Y no es suerte: `analytics-paquete-guard.test.ts` › «los componentes de grafica se montan por importacion diferida» lo EXIGE y prohíbe el import estático de `./lienzo/` |
| «hay que abrir la guardia de confinamiento» | esa guardia filtra `FUENTES_REPO` por `/from\s+["']recharts["']/`; un archivo de `/monitoreo` que importe `GraficaLineas` no escribe ese literal | **FALSO.** No se toca ninguna guardia |
| «acerca la feature a la analítica que R38 separa» | `ANALITICA_PROHIBIDA` de `frontera.guardia.test.ts` lista rutas concretas (`analytics/rollup-dia`, `cache/next-analitica-cache`, `config/analitica-cache`, `config/analitica-rollup`, `analytics/cache-tags`, `IAnaliticaCache`, `IAnaliticaRollup`) + `analytics_daily`. `@/components/private/analytics/GraficaLineas` no encaja en ninguna | **FALSO como bloqueo**, pero conviene precisión: lo que R38 separa son los DATOS del cierre y su espacio de caché, no el paquete de COMPONENTES |

Lo que queda del argumento original —el marco con título y la proporción— **ya está resuelto en
el propio paquete**: `GraficaProps.proporcion: "bajo"` da un lienzo 32:9, que es la franja baja
que la maqueta pide.

Y lo que se GANA reusando, que es lo que decide:

- **`GraficaMarco` trae ya los tres estados** —error (`role="alert"`), cargando (`role="status"`
  + `Skeleton`) y vacío (`EmptyState`)— con la MISMA precedencia que `DataTable`. Escribirlos a
  mano habría sido una cuarta copia de una jerarquía que el repo ya tiene.
- **`SerieTextual` da la alternativa textual accesible** (`sr-only`, un `<li>` por punto) sin que
  la escribamos: eso es R60 cumplido por la primitiva.
- **El color sale de `paleta.ts`**, que usa `--chart-1..20`, declarados en `:root` **y** en
  `.dark`/`.tema-sistema`. R49 se cumple sin una línea de lógica de tema en esta feature.

### Cómo se monta

```tsx
// dentro de TableroDiaTotales (ya es cliente por transitividad; GraficaLineas es "use client")
<GraficaLineas
  titulo={TITULO_RITMO}                 // nombre accesible obligatorio; ver abajo
  series={serieDeRitmo(tablero.ritmoEntregas)}
  unidad="conteo"
  proporcion="bajo"                     // 32:9, la franja de la maqueta
  vacio={VACIO_RITMO}
/>
```

**`unidad="conteo"`**: verificado contra `MetricaUnidad = "conteo" | "porcentaje" | "moneda" |
"segundos"` (`lib/analytics/types.ts:34`). Entregas son un conteo.

**El título.** `titulo` es obligatorio y es el nombre accesible de la región (R9 del paquete);
`GraficaMarco` lo pinta en un `<h3 class="text-sm font-medium">`. **Se deja VISIBLE**, con el
texto «Entregas acumuladas» — el mismo rótulo que la maqueta ya dibujaba encima de la franja.
Esconderlo con `sr-only` obligaría a pisar el `className` del `<h3>` desde fuera (no hay prop
para eso) y dejaría una línea sin explicación en una tira llena de números: un gráfico sin rótulo
en un tablero de operación es una adivinanza.

**El vacío** (R59): `vacio = { titulo: "Todavía no hay entregas hoy", descripcion: "En cuanto se
registre la primera, la curva empieza aquí." }`. Ojo con **cómo se dispara**: `GraficaLineas`
decide `hayDatos` con `series.some(s => s.puntos.length > 0)`, y nuestra serie SIEMPRE trae
puntos `0..H` aunque todos valgan 0 — así que pintaría una línea plana en vez del vacío. Por eso
el adaptador **devuelve `[]` cuando el día no registra ninguna entrega**, que es lo que hace que
el marco muestre su `EmptyState`.

> **Limitación conocida y aceptada:** ese `EmptyState` sale **sin icono**. `GraficaMarco` lo monta
> como `<EmptyState title={vacio.titulo} description={vacio.descripcion} />` y `TextoVacio` no
> tiene campo de icono. Darle uno obligaría a ampliar el contrato del paquete de analítica, que es
> otra ficha. No afecta a R24: los **cinco estados de la ruta** siguen llevando su icono (§5); el
> vacío de la gráfica no es uno de ellos.

### La adaptación de datos (R77)

Nueva función pura en `app/(app)/monitoreo/_components/serie-ritmo.ts`:

```ts
serieDeRitmo(puntos: readonly PuntoRitmoEntregas[]): readonly SerieDato[]
```

- Devuelve `[]` si no hay entregas (último acumulado 0) — ver arriba.
- Si no, **una** serie con `id: "entregas"`, `etiqueta: "Entregas acumuladas"` y un `PuntoDato`
  por hora: `{ categoria: horaLegibleCR(hora), valor: acumulado }`.
- `categoria` es un `string` YA formateado: el paquete no sabe de fechas ni de zonas
  (`tipos.ts:26-30`). El formato de la hora («7 a. m.») lo pone esta función con
  `Intl.DateTimeFormat("es-CR")` sobre la hora de pared, sin volver a convertir zonas.
- `valor` nunca es `null`: `null` significa DATO AUSENTE en el paquete (`tipos.ts:19-22`), y aquí
  una hora sin entregas tiene un acumulado real, no ausente.

**Sí, es un archivo nuevo, y está bien.** La regla del humano es «reusa siempre que se pueda;
cuando el componente no exista, creas uno nuevo» — lo que no se hace es reimplementar lo que ya
existe. Adaptar nuestro contrato al del paquete es pegamento propio de esta pantalla, no una
primitiva.

**¿Entran 24 puntos sin recorte?** Sí, verificado: `MAX_PUNTOS_SERIE = 62`
(`components/private/analytics/topes.ts:54`) y `prepararSeries` sólo recorta por encima de ese
tope. Un día tiene como mucho 24 puntos, así que `recortePuntos.recortado` es siempre `false` y
`avisoRecorte` no hace falta. Además `aplicarTopePuntos` **lanza** fuera de producción si se
excede: con 24 no se alcanza nunca, pero deja el suelo puesto por si alguien cambiara el grano a
minutos.

### Delta visual respecto a la maqueta, dicho y no escondido

La maqueta pinta la curva en verde. `paleta.ts` asigna color **por índice de serie** y el color
**no viaja en las props** por decisión del paquete (R16–R19 de la 130), así que la serie 0 sale
en `--chart-1`: naranja de marca (`#f26419` claro / `#ff7a33` oscuro). Se acepta: pasar color por
props es exactamente lo que ese paquete prohíbe para que cada tablero no mantenga su propio
catálogo a mano, y el verde de la maqueta no significaba nada que el rótulo no diga ya.

---

## 8. El detalle: de `Sheet` a `Modal`

`DetalleMensajeroPanel.tsx` **conserva su nombre de archivo**. Renombrarlo a `…Modal.tsx`
obligaría a tocar tres tests —incluido el censo de fuente de
`tests/components/DetalleMensajeroPanel.test.tsx`, que lee la ruta literal— sin mover un píxel.

Estructura nueva:

```tsx
<Modal
  open={mensajeroId !== null}
  onOpenChange={(abierto) => { if (!abierto) onCerrar(); }}
  title={mensajeroNombre ?? TITULO_GENERICO}
  description={…}
  hideConfirm            // R34 — es lectura, no una decisión
  cancelLabel="Cerrar"
  size="xl"
>
  <div data-slot="detalle-mensajero-panel">
    {cargando ? <DataTable … isLoading /> :
     ordenes.length === 0
       ? <div data-slot="detalle-mensajero-vacio"><EmptyState icon={Inbox} title={AVISO_SIN_ORDENES} /></div>
       : <><DataTable columns={COLUMNAS} data={ordenes} … /><Pagination … sticky={false} /></>}
  </div>
</Modal>
```

Decisiones y sus porqués:

- **`hideConfirm` + `cancelLabel="Cerrar"`** (R34). `Modal` obliga a al menos una salida visible;
  «Cerrar» es la honesta. `hideCancel` además dejaría el diálogo sin botón alguno.
- **`data-slot="detalle-mensajero-panel"` se mueve del `SheetContent` a un `div` dentro de
  `children`** (R62). `Modal` tiene props tipadas y no acepta `data-*` arbitrarios; y como
  `Dialog.Portal` desmonta al cerrar, el ancla sigue apareciendo y desapareciendo igual que ahora.
  El selector del test no cambia.
- **Con cero órdenes NO se monta `DataTable`** (R36). `DataTable` renderiza siempre un `<table>`
  —también vacío y también cargando— y el test existente afirma
  `expect(document.querySelector("table")).toBeNull()` en los tres casos malos. Esa aserción es un
  contrato deliberado (no enseñar el esqueleto de una tabla que no existe), así que se respeta.
  Los tres casos siguen dando **el mismo** `textContent`, sin eco del id (R13).
- **Ni `renderExpanded`, ni `descarga`, ni `filtros`** en el `DataTable`: `renderExpanded`
  antepone una columna con su `<th>` y rompería la aserción de «exactamente cuatro columnas»
  (R35). Las otras dos añadirían acciones que este tablero no debe ofrecer.
- **`EstatusBadge` se queda** en la celda de Estado (R37), y el archivo sigue importándolo: el
  censo de fuente del test lo comprueba y también comprueba que el archivo **no** contenga
  `badgeVariants`, `bg-success-soft`, `bg-danger-soft` ni `ORDER_STATUS_LABELS =`.
- **`Pagination sticky={false}`** se conserva: dentro de un diálogo con caja propia, una barra
  pegada al viewport se saldría de su caja.
- **El tamaño de página son 25, y no se escribe en ningún sitio** (R75). Sale de
  `ordenesConfig.DEFAULT_PAGE_SIZE` (`lib/config/ordenes.ts:34`, sobrescribible con
  `ORDENES_DEFAULT_PAGE_SIZE`), como ya hace `TableroDiaService.detalle`. El «20 por página» que
  circuló en el encargo de esta ficha **era incorrecto**: queda anotado aquí para que nadie lo
  reintroduzca como literal creyendo que arregla una discrepancia.
- **El cierre por Escape/fondo** lo da `Modal` con `dismissible` por defecto, y desemboca en el
  mismo `onCerrar` que hoy (R32). El test que hace `keyboard("{Escape}")` sigue valiendo.

**Alternativa descartada: llevar el detalle a su propia ruta** (`/monitoreo/[mensajeroId]`).
Desmontaría el módulo, reiniciaría el ciclo de SWR y costaría una recarga al cerrar — justo lo que
la 192 evitó con el parámetro de URL. Ya estaba descartada allí (alternativa 12) y sigue estándolo.

---

## 9. Filtro, densidad y totales

- **Filtro** (`Input` + icono `Search`, `data-slot="tablero-dia-filtro"`). El estado vive en
  `TableroDiaModule`. La normalización (minúsculas + supresión de acentos) es una función pura en
  `filtrar-mensajeros.ts`, probada sin DOM (R41).
- **El filtro NO va a la URL** (R73). `?mensajero=` es enlazable por decisión de la 192; añadir
  `?q=` obliga a decidir qué ve quien abre un enlace compartido con filtro puesto —¿el filtro del
  que lo mandó, con las tarjetas de SU alcance recortadas otra vez por el suyo?— y eso es una
  decisión de producto que nadie ha tomado. **Si el humano lo quiere, es ficha aparte.**
- **Densidad** (`SegmentedToggle`, `data-slot="tablero-dia-densidad"`, `ariaLabel="Densidad del
  tablero"`), valor inicial **cómoda** (R44). Baja de `Badge` con etiqueta a `Badge` sólo con
  cifra, y aprieta `gap` y columnas de la rejilla. **La etiqueta nunca desaparece del nombre
  accesible**: en compacta va al `title`/`aria-label` del `Badge` (R45). El valor inicial cómodo
  es lo que hace que los tests actuales, que esperan la etiqueta visible, sigan verdes.
- **El orden no lo toca ninguno de los dos** (R6): `ordenarFilasTablero` sigue siendo la única
  fuente del orden, y el filtro se aplica **después** de ordenar.

### Los totales se RECALCULAN sobre lo filtrado (R43) — y cómo se evita que engañen (R64)

Decisión humana, tomada **en contra** de la recomendación de este diseño y respetada al pie de la
letra: con filtro activo, la tira de totales pasa a ser la de las tarjetas visibles. Es lo que
R30 de la 192 dice literalmente («los totales los suma el servicio **sobre las filas que se
pintan**»), y con un filtro de cliente la única forma de que siga siendo verdad es recalcular.

**Una sola implementación de la suma** (R65). `sumarTotales` vive hoy dentro de
`TableroDiaService.ts`, que un Client Component no puede importar sin arrastrar
`lib/analytics/alcance` y el adaptador de caché al navegador. Así que **se mueve a
`lib/types/tablero-dia.ts` como `sumarTotalesTablero(filas)`**, y la consumen los dos: el
servicio para los totales del día y el módulo de cliente para los de lo filtrado. Ese archivo es
exactamente el sitio: su cabecera ya declara que es un módulo de tipos sin `repositories/`,
`services/`, `@/lib/db` ni `next/headers`, «inutilizable desde un Client Component» si los
tuviera. Dos sumas distintas serían dos identidades de ocho sumandos distintas, que es la falla
que R3 persigue.

**El riesgo que trae esta opción, y cómo se cierra.** Con filtro puesto, quien mire de reojo
puede leer «26 asignadas» y creer que es el día entero. Se advirtió y se aceptó, así que la
pantalla tiene que hacerlo **imposible**, no improbable. Tres señales a la vez, no una:

| Señal | Sin filtro | Con filtro |
| --- | --- | --- |
| Rótulo de la tira | «Totales del día» | **«Totales de lo filtrado»** |
| Subtítulo | — | **«3 de 9 mensajeros»** |
| DOM | `data-slot="tablero-dia-totales"` | el mismo **+ `data-filtrado=""`** |

`data-filtrado` es lo que hace la distinción **testeable sin leer texto** (R64.c): un test afirma
que sin filtro el atributo no está y que con filtro sí, y otro que el rótulo cambia. Sin el
atributo, la única forma de comprobarlo sería una aserción sobre una cadena de UI, que se rompe
con cualquier retoque de copy y no dice nada del estado.

El conteo de coincidencias va además en una región `role="status" aria-live="polite"`, para que
quien navegue con lector de pantalla se entere de que lo que suena a continuación está recortado.

La barra apilada de la tira se recalcula con la misma tira (R70): si los totales son de lo
filtrado, su composición también.

---

## 10. Anclajes: qué se conserva y qué cambia

### Se conservan tal cual (mismo selector, mismo test)

| Ancla | Dónde vive ahora |
| --- | --- |
| `data-mensajero="<id>"` + `role="button"` con el nombre en el `aria-label` | `MensajeroCard` |
| `data-contador="<clave>"` (los nueve) con texto = etiqueta + valor | `ContadoresTablero` (ahora sobre `Badge`) y las dos cifras titulares |
| `title` = `ayudaBucket(clave)` en los tres cubos | `ContadoresTablero` |
| `data-grupo="resultados"` / `data-grupo="sin-resultado"`, sin anidarse | `ContadoresTablero` |
| `data-slot="tablero-dia"`, `-cabecera`, `-rejilla`, `-totales`, `-skeleton`, `-vacio`, `-aviso-refresco`, `-denegado`, `-aviso-desaparecido` | sus componentes |
| `role="status"` + `aria-busy="true"` del esqueleto; prop `tarjetas` | `TableroDiaEstados` |
| `role="alert"` de los tres avisos (lo pone `Alert`) | `TableroDiaModule` / `TableroDiaEstados` |
| `<time datetime>` + «Actualizado hace N s» | `TableroDiaCabecera` (sin cambios) |
| Exportaciones `ordenarFilasTablero`, `antiguedadTexto`, `ETIQUETA_*`, `CLAVES_*`, `ayudaBucket` | `TableroDiaRejilla`, `TableroDiaCabecera`, `contadores.ts` |
| `data-slot="detalle-mensajero-vacio"`, con el MISMO texto en los tres casos malos | `DetalleMensajeroPanel` |

### Cambian a propósito (y su test es una tarea, no un daño colateral)

| Ancla / aserción | Antes | Ahora | Test que se actualiza |
| --- | --- | --- | --- |
| `data-slot="detalle-mensajero-panel"` | en `SheetContent` | en un `div` dentro de `children` del `Modal` | `DetalleMensajeroPanel.test.tsx` (el selector NO cambia; sí el DOM alrededor) |
| Contenedor del detalle | `Sheet`/`SheetContent` | `Dialog.Popup` con `aria-modal` | `DetalleMensajeroPanel.test.tsx` (+ asserts nuevos de R31/R34) |
| Tabla del detalle | `Table` cruda | `DataTable` | ídem: `getAllByRole("columnheader")` sigue dando las mismas cuatro |
| Vacío del tablero | `Card` + `<p>` | `Card` + `EmptyState` con icono | `TableroDiaTarjetas.test.tsx` (mismos textos, `queryByRole("alert")` sigue nulo) |
| Contadores | `div` con `bg-muted/40` | `Badge` con variante | `TableroDiaTarjetas.test.tsx` (+ asserts nuevos de R15–R17) |
| `TableroDia` | 5 campos | 6 campos | `TableroDiaModule.test.tsx`, `DetalleMensajeroPanel.test.tsx`, `tablero-dia-accion.test.ts` y los tests del servicio que construyan o comparen el literal |
| Consultas del repositorio | 2 | 3 | **`frontera.guardia.test.ts`**: `toHaveLength(3)` y `["agregada","paginada","agregada"]` |
| `ITableroDiaRepository` | 2 métodos | 3 | `_doble-tablero-dia.ts` |

---

## 11. Riesgos conocidos

1. **La tercera consulta toca una guardia.** Es el punto donde este diseño es más fácil de
   «arreglar mal»: bajar el `toHaveLength` a `toBeGreaterThan` convertiría la cláusula en decorado.
   Se actualiza al número exacto y con la clasificación exacta, en el orden en que aparecen en el
   archivo (por eso el método nuevo va **al final**).
2. **`::timestamp` sobre el parámetro.** Si el driver no tipa el parámetro como se espera, el
   error es de SQL y sale en el test de integración, no en producción.
3. **El `Badge` mide `h-5` fijo.** Con dos líneas (etiqueta + cifra) el contador actual no cabe en
   esa altura: la etiqueta y la cifra van **en línea** dentro del badge («Entregadas 18»), que es
   además lo que hace que el nombre accesible siga completo en densidad compacta. Si al implementar
   se ve que no cabe en la rejilla más estrecha, la salida es la densidad, no un `className` que
   pise la altura de la primitiva.
4. **La serie puede bajar entre refrescos** (R72). Es consecuencia de cuadrar con `entregadas`,
   está escrita en §3 con su caso concreto y fijada por un test. **No es un bug.**
5. **`lib/types/` obliga a la corrida completa.** No hay atajo; `--rapido` se niega solo.
6. **`bg-info` sobre la pista en tema oscuro.** Los cuatro semánticos base son hexes FIJOS
   (`globals.css:172-182`) y la pista `bg-muted` gira. Tres de ellos son claros y se separan bien;
   `--color-info` (`#1a56db`) es oscuro y es el único con riesgo de fundirse con la pista en tema
   oscuro. Se comprueba en F6.3 y, si pasa, la salida es `bg-chart-13` (`#1e3a8a` claro /
   `#93c5fd` oscuro, es decir gira) — **nunca un hex nuevo**.
7. **Los totales recalculados y la identidad de R3.** Al recalcular sobre lo filtrado hay dos
   consumidores de la misma suma; por eso `sumarTotalesTablero` se mueve al contrato y hay UNA
   sola implementación (§9). Si alguien la duplica «para no importar tipos en el cliente», la
   identidad puede divergir sin que ningún test lo note salvo el que la afirma sobre lo filtrado.
8. **El vacío de la gráfica no lleva icono.** Limitación del contrato del paquete, aceptada y
   explicada en §7. No confundir con los cinco estados de la ruta, que sí lo llevan.

---

## 12. Procedencia de las decisiones (2026-08-21)

Para que dentro de seis meses se sepa quién decidió qué, y qué se decidió **en contra** de lo que
este diseño recomendaba.

| # | Decisión | Quién | ¿Contra la recomendación del spec? |
| --- | --- | --- | --- |
| 1 | La línea se pinta reusando `GraficaLineas`; no se dibuja un SVG propio y no se toca ninguna guardia | leader, tras **verificar** que dos de los tres costes que el propio spec le atribuía a `GraficaLineas` eran falsos (§7) | **Sí**, contra la primera versión de este §7 |
| 2 | El tamaño de página lo manda `ordenesConfig.DEFAULT_PAGE_SIZE` (25) | leader | no — el «20» del encargo original era un error |
| 3 | Los totales se RECALCULAN sobre lo filtrado, con rótulo y marca en el DOM que impiden confundirlos | **humano** | **Sí.** Este spec recomendaba dejarlos como totales del día. Se respeta al pie de la letra, y el riesgo que trae se cierra con R64 |
| 4 | La barra apilada de composición ENTRA, en la tira y en cada tarjeta | **humano** | **Sí.** Este spec recomendaba dejarla fuera. Es lo que hace que la dirección A sea A |
| 5 | El avatar de iniciales ENTRA | **humano** | no |
| 6 | La serie cuadra con `entregadas` aunque un punto pueda bajar | **humano**, tras ver el caso concreto | no |
| 7 | El filtro por nombre NO va a la URL en esta ficha | leader | no |
