# 182 — analitica: cablear el modo agregado al tablero operativo · design

> Lee antes `requirements.md`. Aqui va el **como**. Zona `frontend`: no se escribe una linea en
> `lib/**`, `db/**` ni `app/api/**`.
> **Puerta T0 cerrada el 2026-08-05** (`requirements.md §6`). Este diseno ya es el de las
> respuestas: sin panel de aging (Q1 = B), una sola oleada (Q2 = A), `lunesDeLaSemana` acotada y
> **vigilada** (Q4 = A), nota en la 131 (Q6 = A) y `rango_excedido` retirado (Q7).

## 1. Archivos que esta feature toca — LA FRONTERA

Esta lista es la frontera que usan el implementer y el reviewer. **Un archivo fuera de ella es un
hallazgo bloqueante**; si hace falta uno mas, se anade aqui con su motivo antes de escribirlo.

### 1.1 Produccion (todos dentro del subarbol de la 131)

| Archivo | Que se le hace |
|---|---|
| `app/(app)/analitica/_components/operativo/PanelOperativo.tsx` | Dos consultas SWR nuevas por `consultarAgregadoOperativo` (granos `periodo` y `semana`, misma oleada); reduccion de estado unificada (R13); render de la cifra total (R4, R6, R7) y de la serie por cubos (R1, R14); **retirada** de la rama `rango_excedido` y de sus dos textos importados (R16) |
| `app/(app)/analitica/_components/operativo/agregacion.ts` | Entrada pura que prepara un panel **desde cubos** (R1, R2); total del cubo `periodo` (R4-R7); fallo ruidoso de R3; acotamiento de `agregarPorSemana` a `conteo` (R15); **retirada** del modo `rango_excedido` (R16). `lunesDeLaSemana`/`agregarPorSemana` **se conservan** para `conteo` (D5) |
| `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` | `unidad` declarada por metrica (R9). **No se anade ningun panel** (D7/Q1 = B): siguen siendo seis |
| `app/(app)/analitica/_components/operativo/textos.ts` | Textos del total del periodo, del total parcial de periodo, del denominador cero (R7) y del grano servido (R14); **borrado** de `TEXTO_RANGO_EXCEDIDO` y `TITULO_RANGO_EXCEDIDO` (R16) |

**No se tocan** (y el reviewer debe comprobarlo): `PanelesOperativos.tsx`, `FiltrosOperativos.tsx`,
`filtro-tablero.ts`, `ExportarOperativoPanel.tsx`, `export-operativo.ts`,
`analitica-operativa-descarga-columnas.ts`, `AnaliticaShell.tsx`, `page.tsx`, y todo
`components/private/analytics/**`, `lib/**`, `db/**`, `app/api/**`.

### 1.2 Tests

| Archivo | Nuevo / existente | Que lleva |
|---|---|---|
| `tests/unit/analytics/tablero-agregado-cableado.test.ts` | **nuevo** | R2, R3, R5 y el caso de comportamiento de R15 (modulo puro: sin jsdom, sin red) |
| `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` | **nuevo** | R12, el caso de censo de R15 (**un solo llamador** de `lunesDeLaSemana`) y R16. Censa el **arbol**, nunca el diff (leccion escrita en `tablero-operativo-frontera.guardia.test.ts:13-25`) e incluye caso de **discriminacion** (fixture infractor positivo + prosa negativa) |
| `tests/components/TableroOperativo.test.tsx` | existente | Anadir `consultarAgregadoOperativo` a la factoria de `vi.mock`; casos de R1, R4, R6, R7, R10, R13, R14; **reescribir** el caso de R27 de la 131 (`:315-330`) y **retirar** la asercion vacua de `:342` (R16) |
| `tests/components/TableroOperativoLatencia.test.tsx` | existente | Anadir el simbolo a la factoria de `vi.mock`; casos de R8 y R11; presupuesto de invocaciones actualizado. **El `toBeLessThanOrEqual(6)` de `:106` se conserva intacto** (Q1 = B) |
| `tests/unit/analytics/tablero-agregacion.test.ts` | existente | **Reescribir** los dos casos de `rango_excedido` (`:198-220`) para que afirmen el comportamiento nuevo (R16) |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts` | existente | R9: la `unidad` declarada vs `getMetrica()` |

### 1.3 Documentacion / bitacora

| Archivo | Que |
|---|---|
| `specs/182-analitica-cablear-modo-agregado/**` | Los tres ficheros de esta spec |
| `progress/impl_182.md` | Lo escribe el implementer: archivos tocados, mapa `R<n> -> test`, **salida de las 16 mutaciones** |
| `specs/131-analitica-tablero-operativo/requirements.md` | **Q6 = A**: nota aditiva y fechada en §6.1 y en la fila R27. **Solo prosa**; no se toca ni un test de la 131 desde ahi |

**`feature_list.json` y `progress/history.md` NO los toca esta feature** (los lleva el leader), y la
ficha del aging de `requirements.md §5.1` **la da de alta el humano**.

---

## 2. Datos, RLS y migraciones

**Ninguno.** Esta feature no crea tablas, no anade columnas, no escribe migraciones y no toca RLS:
consume una lectura que ya existe y que ya resuelve actor, alcance, identidad y auditoria en el
servidor (`lib/actions/analitica-operativa.ts:155-193`). El checklist de datos de `CHECKPOINTS.md`
se declara **no aplicable** por este motivo, no por olvido.

---

## 3. Rutas y endpoints

**Ninguno nuevo.** Lectura interna → Server Action, nunca `app/api` (`docs/architecture.md`, y
`tests/unit/analytics/export-csv-frontera.guardia.test.ts` ya persigue `consultarAgregadoOperativo`
dentro de `app/api`).

---

## 4. Contrato de entrada/salida que se consume

```ts
// lib/actions/analitica-operativa.ts:155
consultarAgregadoOperativo(
  { metricaId: string; raw: unknown; desagregacion?: DimensionAnalitica; grano?: "periodo" | "semana" },
): Promise<ResultadoAgregado>

// ok -> AgregadoOperativo { metricaId, unidad, unidadDeConteo, grano, rango, cubos, cobertura }
// CuboAgregado { fecha, desdeFecha, hastaFecha, dimension?, numerador, denominador,
//                valor: number | null, parcial?: true, corteAt? }
```

Lo que el tablero **usa** de ese contrato y lo que **deliberadamente no**:

- **Usa** `cubos[].fecha` (etiqueta del eje / ancla), `cubos[].valor` (serie y total), `parcial` y
  `corteAt` (R6), `denominador === 0` (R7), `unidad` (formato).
- **No usa** `numerador`/`denominador` para dividir: **la UI no divide** (D2). Se leen solo para
  distinguir «no hubo gestiones» de «no hay dato» (R7).
- **No usa** `cobertura` del agregado: el aviso unico del tablero ya lo alimenta la serie
  (`PanelesOperativos.tsx:44-52`), y publicar dos coberturas por panel duplicaria el aviso que D1
  de la 131 unifico a proposito.

`raw` y `desagregacion` salen del **mismo** `aRaw(filtro)`/`serializarFiltro(filtro)` que ya usa la
serie: no hay una segunda traduccion del filtro (misma razon que R2 de la 134).

---

## 5. Como queda el flujo de un panel (Q2 = A: una sola oleada)

```
PanelOperativo(panel, filtro)
  ├─ useSWR([CLAVE_TABLERO, panel.id, desagregacion, filtro])            → serie (126)    · SIEMPRE
  ├─ useSWR([CLAVE_TABLERO, panel.id, desagregacion, filtro, "periodo"]) → agregado total · solo si la
  └─ useSWR([CLAVE_TABLERO, panel.id, desagregacion, filtro, "semana"])  → cubos semana   ┘ unidad declarada
                                                                                            es porcentaje
                                                                                            o segundos (R8)
        ↓ reduccion UNICA con precedencia unauth > forbidden > validation > ok (R13)
        ↓ panel desde CUBOS si excede el techo · desde la serie diaria si no (D1)
        ↓ total = cubo `periodo`.valor  (D2, R4-R7)
```

- **Por que los dos granos siempre y no «el que haga falta» (Q2):** saber si se excede el techo
  antes de llamar exigiria resolver el rango en el cliente, o sea **una segunda definicion del
  techo**, y dos definiciones se desincronizan solas. Pidiendo los dos, el comportamiento no
  depende del tamano del rango y se puede probar sin escenarios de carrera. El coste es una
  consulta barata de mas por metrica de tasa/tiempo (con rango corto, el grano `semana` devuelve
  1-2 cubos y golpea la misma clave de cache del rollup).
- Las tres claves comparten prefijo `CLAVE_TABLERO`, con lo que el boton «Actualizar»
  (`PanelesOperativos.tsx:73-75`) las revalida **todas** sin tocar `PanelesOperativos.tsx`.
- El grano entra en la clave: es lo que hace verdad R10 y lo que impide que la cifra del filtro
  anterior sobreviva a un cambio de filtro.
- Las tres son hooks de primer nivel del mismo render: arrancan **solapadas** (R11). Nada de
  `await serie` antes de pedir el agregado — esa es exactamente la mutacion de R11.
- **Decidir si se excede el techo** se hace igual que hoy, con las fechas distintas de la serie ya
  recibida (`agregacion.ts:310`). Mientras la serie no llega, el panel esta en carga y no pinta ni
  una cifra: no hay ventana en la que se pinte la serie diaria «casi completa» de un rango largo.

### 5.1 Que pinta cada caso

| Caso | Serie | Cifra total |
|---|---|---|
| `conteo`, cualquier rango | igual que hoy (dia, o semana por `agregarPorSemana`) | igual que hoy (`totalizarPuntos`) |
| `porcentaje`/`segundos`, ≤ 62 fechas | serie **diaria** de la 126 (D1) | **cubo `periodo`** (R4) |
| `porcentaje`/`segundos`, > 62 fechas | **cubos `semana`** del servidor (R1, R2) + aviso de grano (R14) | **cubo `periodo`** (R4) |

`aging_por_estado` **no aparece en esta tabla a proposito**: no tiene panel y no lo tendra en esta
feature (D7/Q1 = B). Su KPI sale en ficha propia (`requirements.md §5.1`).

### 5.2 El acotamiento de la semana del cliente (R15), en concreto

Dos capas, porque una sola se puede rodear:

1. **Comportamiento:** `agregarPorSemana` recibe la unidad y **rechaza** toda la que no sea
   `conteo`. Un camino de `porcentaje`/`segundos` que la invocase falla en el acto, ruidosamente
   (es la misma politica que R3).
2. **Censo permanente** en el guardia: `lunesDeLaSemana` tiene **un unico llamador** en el
   subarbol, y es `agregarPorSemana`. Un segundo llamador —el modo en que esto se rompe de
   verdad— pone rojo el guardia aunque el primero siga siendo correcto.

Lo que el humano exigio al cerrar Q4 y que hay que respetar: **el guardia afirma el acotamiento,
no la existencia**. Un caso que solo comprobase que la funcion sigue en el archivo daria verde con
una segunda definicion de semana viva y sin vigilar.

---

## 6. Alternativas descartadas (obligatorio, con su porque)

1. **Servir TODO por el modo agregado, tambien la serie corta.** Es lo que menos caminos deja…
   y es **imposible dentro del alcance**: `GranoAgregado` solo tiene `periodo` y `semana`
   (`lib/types/analitica-operativa.ts:172`). Habria que ampliar el contrato de una feature ya
   cerrada y mergeada, desde una feature de zona `frontend`. **Descartada** (D1/Q5 = A).
2. **Calcular el total en la UI como `Σ numerador / Σ denominador` de los cubos semanales.**
   Aritmeticamente exacta y ahorra una llamada. **Descartada** (D2): pone una division de negocio
   en el cliente, que es justo lo que R27 de la 131 se nego a hacer, y crea una segunda cifra
   «total» que puede divergir de la del servidor sin que nada avise.
3. **Pedir `semana` solo cuando ya se sabe que se excede el techo.** Ahorra una consulta por panel
   de tasa/tiempo. **Descartada por el humano (Q2 = A)**: obliga a reimplementar en el cliente la
   resolucion del rango que hace el servidor, y dos definiciones del techo se desincronizan solas;
   ademas anade una segunda ida y vuelta justo en el caso mas lento.
4. **Anadir el septimo panel (`aging_por_estado`) aqui.** **Descartada por el humano (Q1 = B)**:
   el tope de seis lo defiende un test de latencia y la 131 ya pago por el tirando
   `motivos_devolucion`; subirlo de pasada, dentro de una feature que va de otra cosa, dejaria esa
   metrica cortada por un tope que ya no regiria. Ademas el aging **nunca tuvo cifra en ningun
   rango** (D3 de la 176): no es el hueco que esta feature cierra. Ficha aparte
   (`requirements.md §5.1`).
5. **Deducir la unidad de la respuesta de la serie en vez de declararla en el catalogo.** Evita
   duplicar un dato… a cambio de **encadenar** la llamada agregada tras la serie, lo que rompe
   R11. **Descartada** (D4): se declara y se ancla por test, el patron que la 131 ya uso para no
   arrastrar `lib/analytics/metrics` al navegador.
6. **Pedir el agregado para TODAS las metricas y dejar que el borde rechace los conteos.**
   **Descartada** (R8): duplicaria las invocaciones del tablero para producir `validation_error` a
   proposito y convertiria un error real en ruido de fondo.
7. **Una Server Action compuesta que devuelva serie + agregado en una llamada.** **Descartada**:
   pondria a una feature `frontend` a escribir en `lib/actions/`, que es lo que D4 de la 131
   descarto y lo que el guardia de frontera vigila.
8. **Conservar `rango_excedido` «por si acaso».** **Descartada por el humano (Q7)**: es codigo
   muerto que un guardia futuro puede censar creyendo que vigila algo vivo — el patron muerto que
   `export-csv-frontera.guardia.test.ts:210-227` documenta como leccion aprendida por las malas.
9. **Un guardia branch-scoped que compare el diff contra `origin/dev`** para blindar §1.
   **Descartada**: caduca en cuanto la rama se mergea y pasa a juzgar ramas ajenas —la leccion
   escrita en `tablero-operativo-frontera.guardia.test.ts:13-25`—. La frontera de §1 la verifica el
   reviewer; lo que se blinda con test son las **propiedades permanentes** (R12, R15, R16),
   censando el arbol.

---

## 7. Riesgos concretos y como se cazan

| Riesgo | Como se caza |
|---|---|
| El total acaba siendo una media de medias sin que nadie lo note | R5 con datos **desiguales** y **doble asercion** (`≈ 2/11` y `not ≈ 0,55`) |
| El cliente vuelve a cubetear semanas por su cuenta | R2 (fixture con ancla que no es el lunes ISO), R3 (fallo ruidoso) y **R15** (rechazo por unidad + un solo llamador censado) |
| La rama muerta `rango_excedido` reaparece, o sus textos sobreviven sin uso | R16 (censo del arbol con mutacion propia: reponerlos pone rojo) |
| Los dos `vi.mock` existentes se quedan sin el nuevo simbolo y el rojo se lee como «regresion» | Tarea explicita T2.1, **antes** de tocar `PanelOperativo.tsx` |
| Las llamadas se serializan y el tablero se vuelve lento en silencio | R11 mide **dispersion de arranques**, que es lo que distingue solapar de encadenar |
| Un denegado del agregado se lee como «no hay cifra» | R13 |
| El presupuesto de paneles se relaja de pasada | Q1 = B: `TableroOperativoLatencia.test.tsx:106` **se conserva intacto**; tocarlo es hallazgo bloqueante |
| La feature se cuela fuera de su subarbol | §1 + R12 |
