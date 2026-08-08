# 184 — Diseño

> Base de partida: `progress/chore_deuda_170.md` (inventario medido, no se rehace) y
> `progress/impl_170-fase2-tanda-m.md §3` (el molde, ya entregado y medido).

## 1. Punto de partida y forma del cambio

El molde existe y está probado en producción: T M.1 cerró «Cuentas por pagar a mensajeros»
(Q-L2) con **cinco piezas** y sin inventar ninguna forma nueva. Esta feature aplica ese mismo
molde doce veces y añade una sexta pieza —la comprobación de vigencia— solo en la satélite.

Las cinco piezas del molde, tal cual quedaron:

| Capa | Qué hace | Referencia viva |
| --- | --- | --- |
| Repositorio | `listarXCompleto(filtro)`: el conjunto filtrado y ordenado, entero, sin recorte | `PagoMensajeroMovimientoRepository.listarCuentasPorPagarCompleto` |
| Servicio | guard de rol ANTES del repositorio, el MISMO mapper que la página, tope evaluado aquí | `WalletMensajeroService.listarCuentasPorPagarCompleto` |
| Tipos | `listarXCompletoSchema` = el schema de la página **menos `page`/`pageSize`**, `.strict()` | `lib/types/wallet-mensajero.ts:232` |
| Borde | `listarXCompletoAction`, calcado del de su página | `lib/actions/wallet-mensajero.ts:179` |
| Pantalla | `obtenerFilas` pasa de `filasDelConjuntoCompleto(releer(...))` a `filasDesdeResultado(nuevaAction(...))` | `CuentasPorPagarTable.tsx:246` |

**La quinta pieza no es opcional.** El adaptador de descarga vive en el `.tsx`; un backend que
entregue los doce métodos sin tocar pantalla deja doce Server Actions muertas y la deuda
intacta. Por eso cada tanda es backend → frontend y **no se cierra hasta que la pantalla usa la
acción nueva**.

## 2. Modelo de datos

**No hay tablas nuevas, ni columnas, ni migración, ni RLS nueva, ni índices nuevos.** Esta
feature no cambia el esquema: todos los métodos nuevos leen exactamente el mismo conjunto de
filas que ya lee su hermano paginado, sin el `LIMIT`/`OFFSET`.

Dos consecuencias que el reviewer debe poder comprobar sin buscar:

- `db/migrations/` no se toca. Una migración en esta feature sería una señal de que algo se
  desvió del alcance.
- La comprobación de vigencia de la satélite (§4.2) filtra por **clave primaria** (`o."id" IN
  (…)`) más el mismo acotamiento de zona/estado que ya usa la página, así que se apoya en los
  índices existentes; no hay predicado nuevo sobre ninguna columna sin índice.

## 3. El reparto pieza a pieza de los doce

Los nombres siguen la convención ya vigente (`listarXCompleto`, sufijo `Action` solo donde su
hermana paginada lo lleve). **7 repositorios nuevos** para los listados + **1** para la poda;
**12 servicios**, **12 schemas**, **12 acciones**, **12 pantallas**.

| # | Listado | Repositorio | Servicio (nuevo) | Acción (nueva) | Pantalla a tocar |
| --- | --- | --- | --- | --- | --- |
| 1 | Cierres del mensajero | **existe** `findCierresByMensajero` | `CierreDiaService.listarCierresPasadosCompleto` | `listarCierresPasadosCompleto` | `cierre-dia/_components/CierreDiaModule.tsx` |
| 2 | Cierres del día — histórico | **nuevo** `CierresAdminRepository.findHistoricoCompleto(alcance)` | `CierresAdminService.listarHistoricoCierresAdminCompleto` | `listarHistoricoCierresAdminCompleto` | `cierres-admin/_components/CierresAdminHistoricoTabla.tsx` |
| 3 | Cierres del día pendientes | **nuevo** `CierresAdminRepository.findColaCompleta(alcance)` | `CierresAdminService.listarPendientesCierresAdminCompleto` | `listarPendientesCierresAdminCompleto` | `cierres-admin/_components/CierresAdminModule.tsx` |
| 4 | Cierres de bodega pendientes | **nuevo** `CierresBodegaAdminRepository.findColaCompleta()` | `listarPendientesCierresBodegaCompleto` | `listarPendientesCierresBodegaCompleto` | `cierres-admin/_components/CierresBodegaAdminModule.tsx` |
| 5 | Cierres de bodega resueltos | **nuevo** `CierresBodegaAdminRepository.findHistoricoCompleto()` | `listarHistoricoCierresBodegaCompleto` | `listarHistoricoCierresBodegaCompleto` | `cierres-admin/_components/CierresBodegaResueltosTabla.tsx` |
| 6 | Cierres de bodega solicitados | **existe** `findCierresBodegaByZona` | `CierreBodegaService.listarCierresBodegaSolicitadosCompleto` | `listarCierresBodegaSolicitadosCompleto` | `cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx` |
| 7 | Cierres del día a consolidar | **existe** `findCierresDiaConsolidables` | `CierreBodegaService.listarConsolidablesCompleto` | `listarConsolidablesCompleto` | `cierres-admin/_components/ConsolidacionBodegaModule.tsx` |
| 8 | Incidentes pendientes | **nuevo** `IncidenteAdminRepository.findColaCompleta(alcance)` | `listarPendientesIncidentesCompleto` | `listarPendientesIncidentesCompleto` | `incidentes/_components/IncidentesAdminModule.tsx` |
| 9 | Incidentes — histórico | **nuevo** `IncidenteAdminRepository.findHistoricoCompleto(alcance)` | `listarHistoricoIncidentesCompleto` | `listarHistoricoIncidentesCompleto` | `incidentes/_components/IncidentesHistoricoTabla.tsx` |
| 10 | Órdenes de la bodega satélite | **nuevo** `OrdenRepository.findRecepcionSateliteCompleta(filtro)` | `RecepcionSateliteService.listarOrdenesBodegaCompleto` | `listarOrdenesBodegaCompleto` | `recepcion-satelite/_components/RecepcionSateliteModule.tsx` |
| 11 | Plantillas de gasto fijo | **existe** `listar()` | `GastoFijoPlantillaService.listarPlantillasCompleto` | `listarPlantillasCompletoAction` | `wallet/_components/GastosFijosPlantillasPanel.tsx` |
| 12 | Saldos de tiendas | **existe** `listarSaldosTodasTiendas()` | `WalletTiendaService.listarSaldosTiendasCompleto` | `listarSaldosTiendasCompletoAction` | `wallet/tiendas/_components/SaldosTiendasTable.tsx` |

### 3.1 Contratos de entrada y salida

**Salida, los doce sin excepción:** `ListarCompletoResult<T>` (`lib/types/descarga-listado.ts`)
en el borde y `ListarCompletoServiceResult<T>` en el servicio. No se inventa ningún union: ya
existen y son lo que `filasDesdeResultado` sabe traducir.

```
ok               → { items: T[]; total: number }
limite_excedido  → { total: number; limite: number }        // sin filas, nunca truncado (R6)
error de borde   → ActionError                              // sin filas (R7)
```

**Entrada:** el schema de la página menos `page`/`pageSize`, `.strict()`, **derivado** del
existente y no reescrito:

```ts
export const listarXCompletoSchema = listarXPaginadoSchema.omit({ page: true, pageSize: true });
```

Derivarlo es lo que impide que los dos caminos entiendan cosas distintas por «filtro»: si
mañana la página gana un filtro, el conjunto lo gana en la misma línea (R16/R17). Los listados
cuya página no lleva más filtros que el rango quedan con un objeto vacío `.strict()`, que es lo
correcto: **su lista blanca sigue siendo cero claves**, y una clave de alcance colada muere en
el borde (R4/R17).

**Alcance:** nunca viaja en la entrada. Lo resuelve el servicio desde el actor de la sesión,
igual que en la página. El guard de rol se evalúa **antes** de tocar el repositorio.

**Tope:** `descargaConfig.MAX_FILAS`, evaluado en el servicio (R6). Es el mismo número que hoy
aplica `filasLocales` en el navegador, así que el usuario no ve un tope distinto; lo que cambia
es **dónde** se aplica.

**Qué mitad de R29 de la 170 cierra esto, y cuál no.** R29 de la 170 —feature `done`, requisito
vivo— pide dos cosas: que el tope se aplique en el **servidor** y que, al superarlo, no se
**materialice** ni se **transporte** más de `N + 1` filas.

- **Transportar: cerrado, en los doce.** Superado el tope no cruza la frontera ni una fila:
  `limite_excedido` lleva dos enteros. Hasta hoy cruzaba el conjunto entero y el navegador lo
  medía después.
- **Materializar: cerrado solo en el listado 12.** `listarSaldosTiendasCompleto` pide
  `pageSize: limite + 1` y saca el total de la misma consulta. Los **once restantes NO lo
  cierran**: el servicio pide el conjunto entero al repositorio y solo después compara
  `conjunto.length > limite`, y ningún método `…Completo` lleva `take`. El caso más caro es el
  listado 10: `findRecepcionSateliteCompleta` **hidrata** todas las filas con
  `WITH_RECEPCION_SATELITE` antes de que el tope las mire.

**En esos once es una excepción declarada, no un cumplimiento** (decisión humana del 2026-08-05,
review de esta feature). El motivo medido: acotar la consulta a `limite + 1` obliga a un `count`
aparte para conservar el total exacto que el aviso publica (R6 aquí, R27 de la 170), y esa
segunda consulta pone rojos los tests de **R15** de esta feature —que afirman «UNA consulta, sin
recorte y sin conteo de página»— y duplica las consultas de los listados, que es justo el coste
que esta feature vino a reducir. El `N + 1` real se abre como **ficha aparte** y solo para los
conjuntos que crecen con los días sin purga —los históricos de las tandas B a F— y para el
listado 10, que además hidrata cada fila antes de mirar el tope. Cada uno de
los once métodos lo declara en su docstring, con el riesgo concreto de su conjunto; el molde es
`WalletMensajeroService.listarCuentasPorPagarCompleto`, que ya lo hizo en la 170.

**Mapper:** el conjunto se proyecta con **el mismo mapper que la página**. En los tres listados
de dinero (2/3 con totales snapshot, 6/7 con montos, 12 con saldos) esto no es estilo: dos
mappers distintos producen dos importes distintos para la misma fila.

## 4. La bodega satélite: la consulta completa y la poda

Es el único listado con dos piezas nuevas, y las dos salen del **mismo fragmento SQL**.

### 4.1 El conjunto completo (listado 10)

`findRecepcionSatelitePaginada` (`OrdenRepository.ts:2155`) ya construye en `Prisma.sql` un
fragmento `desde` (`FROM … WHERE …`) con las condiciones y un `ORDER BY` con
`array_position(ARRAY[…ESTADOS_BODEGA_SATELITE…])`. El diseño **extrae** ese fragmento y ese
orden a dos helpers privados del repositorio:

```
condicionesSatelite(filtro) → Prisma.Sql   // zona ∧ no borrada ∧ estados ∧ cantón ∧ distrito
ordenBodegaSatelite()       → Prisma.Sql   // grupo, prioridad, recencia, id
```

Y los usan **tres** consultas, no dos declaraciones parecidas:

| Método | Usa | Diferencia |
| --- | --- | --- |
| `findRecepcionSatelitePaginada` | condiciones + orden | `LIMIT`/`OFFSET` + `COUNT(*) OVER ()` |
| `findRecepcionSateliteCompleta` | condiciones + orden | sin `LIMIT`/`OFFSET` |
| `findIdsVigentesEnBodega` | condiciones | + `o."id" IN (…)`, `SELECT o."id"` solo |

Esto es exactamente lo que R16 exige: **el criterio se declara una vez**. Hoy hay dos —la del
SQL y la de `filtrarOrdenesSatelite` en el navegador (`RecepcionSateliteModule.tsx:123`)— y esta
feature borra la segunda: la pantalla deja de importar `filtrarOrdenesSatelite`.

Coste del modo completo, declarado: **3 consultas** —ids ordenados, hidratación por
`WITH_RECEPCION_SATELITE`, y el lote de `contarIntentosEnLote` que la columna «Intentos» del
archivo necesita (`satelite-descarga-columnas.ts:25`)—. Hoy la descarga cuesta lo mismo pero
**sobre el conjunto sin filtrar**, así que el cambio no añade consultas y sí reduce filas.

### 4.2 La poda de la selección

**El defecto, verificado el 2026-08-04:** `seleccionados` (`SateliteOrdenesListado.tsx:163`) es
un `Set<string>` que sobrevive al cambio de página; `seleccionadas` (`:212-214`) filtra solo la
página visible; `marcadasFuera` (`:227`) es la resta y alimenta el aviso del PR #282. La
selección se limpia al cambiar filtros (`:180`) pero **nunca** cuando una orden marcada deja de
estar en el listado. El aviso hace ese hueco visible y contable.

**Contrato de la comprobación:**

```
listarIdsVigentesBodega({ estados?, cantones?, distritos?, ids: string[] })
  → { status: "ok"; ids: string[] }        // subconjunto de `ids` que sigue en el conjunto
  | { status: "forbidden" | "validation_error" | "unauthenticated" }
```

- **Devuelve los vigentes, no los caducados.** Un fallo o una respuesta vacía por error nunca
  puede leerse como «desmarca todo»: el cliente **interseca** (`seleccionados ∩ (idsPágina ∪
  vigentes)`), así que lo peor que puede pasar es no podar (R22).
- **Schema `.strict()`** derivado del de la página, con `ids: z.array(z.string().uuid()).min(1)
  .max(CAP)` — `orden.id` es uuid (`lib/types/recepcion-satelite.ts:140`). El valor de `CAP` es
  la pregunta abierta Q2; su default es 500 en `lib/config/recepcion-satelite.ts`.
- **Servicio:** mismo guard de rol, misma resolución de zona desde `usuario.zona_id`, misma
  lista blanca `estadosDelListado`. Sin zona → `[]` sin consultar. `ids` vacío → `[]` sin
  consultar (R23 también en el servidor).
- **Repositorio:** una sola consulta, `SELECT o."id"`, con el acotamiento **repetido** en el
  `WHERE` aunque los ids vengan del cliente: una lista de ids nunca es la única guarda (R21).

**Dónde vive en la pantalla y cuándo corre.** La selección es del listado
(`SateliteOrdenesListado`) y los datos son del módulo (`RecepcionSateliteModule`). Se conserva
ese reparto: el módulo baja un **callback** que cierra sobre el filtro vigente —mismo patrón que
`obtenerFilasDescarga` (`:525`)—:

```ts
comprobarVigencia?: (ids: string[]) => Promise<readonly string[] | null>   // null = no se pudo
```

El listado lo invoca en un efecto **cuando la página que recibe cambia** (es decir, tras cada
lectura del servidor: navegación, `mutate()` post-acción o revalidación) **y** hay marcas fuera
de la página visible. Reglas que hacen que esto no se descontrole y sean todas medibles:

1. sin marcas fuera → no se invoca (R23: cero consultas, medido con el espía en 0);
2. si la respuesta no retira nada, el estado **no se reemplaza** (se devuelve el `Set` anterior)
   → no hay re-render → no hay segunda comprobación (R24: exactamente una por relectura);
3. si la respuesta es `null` (fallo), la selección queda intacta (R22);
4. la poda no toca `page`, `filtro`, `pageSize` ni el `total` (R26).

**Por qué corre en cada relectura y no solo tras una mutación propia:** una orden marcada
también puede salir del listado por acción de otro operador (un maestro que la mueve). Limitar
la poda a las mutaciones de esta pantalla dejaría vivo el mismo defecto por otro camino, y el
coste está acotado por la condición (1): una consulta indexada de una sola columna, solo cuando
hay marcas invisibles.

## 5. Cómo se mantiene honesto el censo

Hoy hay **dos** censos que declaran el adaptador listado por listado (verificado contra el
árbol; la nota de campo cuenta uno):

| Archivo | Qué declara |
| --- | --- |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | los 13 del Anexo III, campo `adaptador`, más **dos** afirmaciones agregadas (`:910-912` la lista de los `completo`, `:913` el `toHaveLength(12)`) |
| `tests/components/descarga/WalletPropsDescarga.test.tsx` | los 3 módulos de wallet, con la regex del adaptador por módulo (`:366`, `:371`, `:376`) |

`tests/components/descarga/ControlDescargaTransversal.test.tsx` **no** necesita cambios: su
comprobación es una alternancia (`filasLocales|filasDesdeResultado|filasDelConjuntoCompleto`)
que sigue siendo cierta durante y después de la migración.

**El problema:** las dos afirmaciones agregadas son números y nombres escritos a mano. Cada
listado que se cierre las mueve, y a mitad de la entrega un censo con el número viejo **miente**
—y con `skip` no dice nada—.

**La solución, que es una sola constante:**

```ts
/** Listados que TODAVÍA obtienen el archivo releyendo su listado sin recorte (feature 184).
 *  Cada tanda borra de aquí sus líneas EN EL MISMO COMMIT en que cambia su pantalla. */
const PENDIENTES_184: readonly string[] = [ /* nombres, en el orden del Anexo III */ ];

expect(ANEXO_III.filter((l) => l.adaptador === "conjunto").map((l) => l.listado))
  .toEqual(PENDIENTES_184);
```

Por qué esto no puede quedar mintiendo, y sin desactivar nada:

- la comprobación **estática por listado** que ya existe contrasta `adaptador` contra el archivo
  real, en los dos sentidos. Si una pantalla migra y no se actualiza su campo → rojo. Si se
  actualiza el campo y no la pantalla → rojo. La lista agregada no puede desviarse del campo, y
  el campo no puede desviarse del árbol;
- la lista es **una sola edición por tanda**, en el mismo commit que la pantalla, y sustituye a
  las dos afirmaciones agregadas de hoy (una de ellas, el `toHaveLength(12)`, es justo la que se
  olvida);
- se añade la mitad negativa que hoy falta: un listado declarado `completo` **no puede** contener
  `filasDelConjuntoCompleto(`, y uno declarado `conjunto` **no puede** contener
  `filasDesdeResultado(`. Sin eso, una pantalla que usara los dos adaptadores pasaría verde.

**Al final (tanda H):** `PENDIENTES_184` queda vacío, el campo `adaptador` de los trece dice
`completo`, y una guardia nueva —`tests/unit/descarga/adaptador-conjunto.guardia.test.ts`, que
`vitest run guard` selecciona sola— afirma que (a) no queda ninguna llamada a
`filasDelConjuntoCompleto(` bajo `app/`, y (b) ninguno de los dos censos tiene casos
deshabilitados ni pendientes (R31). Con la última llamada fuera, el adaptador queda **sin
consumidores** y se retira de `components/shared/descarga-resultado.ts`; si en el momento de
hacerlo apareciera un consumidor nuevo fuera del Anexo III, no se borra y se anota por qué.

## 6. Tandas: orden, agrupación y criterio de corte

Ocho tandas, cada una **cerrable y verificable por sí sola**, con la secuencia
backend → frontend que el repo ya usa. El orden de las cuatro primeras es el del coste medido
(`chore_deuda_170.md §1.5`); el de las demás es por afinidad de archivos.

| Tanda | Qué cierra | Por qué ahí |
| --- | --- | --- |
| **A** | Listado 10 (satélite) **+ la poda de la selección** | El más caro y el único que además borra un criterio duplicado. La poda necesita el mismo fragmento SQL que el conjunto: separarlas obliga a escribir dos veces el `WHERE` |
| **B** | Listados 6 y 7 (consolidación) | Comparten la relectura más cara del repo (4 consultas + 5 agregados + reparto de efectivo) |
| **C** | Listado 1 (cierres del mensajero) | Su relectura firma URL de evidencia que el archivo no usa |
| **D** | Listados 2 y 3 (cierres del día admin) | 2 repositorios nuevos, mismo dominio, misma pantalla-madre |
| **E** | Listados 4 y 5 (cierres de bodega admin) | ídem |
| **F** | Listados 8 y 9 (incidentes) | ídem |
| **G** | Listados 11 y 12 (wallet) | Los dos únicos que tocan el segundo censo (`WalletPropsDescarga`) |
| **H** | Cierre: guardia, censo a cero y retirada del adaptador | Solo puede correr cuando A–G están dentro |

**Criterio de corte de una tanda** (los cuatro, o la tanda no está cerrada):

1. sus listados descargan por su acción nueva **desde la pantalla**;
2. su(s) método(s) de repositorio nuevo(s) tienen su caso en el `*-where.test.ts` que le
   corresponde;
3. los dos censos dicen la verdad sobre el árbol **en ese punto exacto** de la entrega;
4. `./init.sh --rapido` en verde; `./init.sh` completo antes de cada PR.

**D, E y F son mutuamente independientes en archivos** (`CierresAdminRepository` /
`CierresBodegaAdminRepository` / `IncidenteAdminRepository`, y pantallas distintas), así que
pueden reordenarse o paralelizarse si el leader lo decide. **A, B y C no**: A es la única con
poda, y B y C tocan servicios de dinero que conviene mirar de a uno.

## 7. Alternativas descartadas

**(1) Cerrar solo el backend y dejar las pantallas para después.** Es lo que el chore de la 170
tenía enfrente y por lo que se paró. Descartada por medición, no por gusto: el adaptador de
descarga vive en el `.tsx`, así que doce métodos sin pantalla dejan doce Server Actions muertas,
**la deuda intacta** (el archivo lo sigue produciendo la relectura cara) y un censo que sigue
diciendo 12/1. La zona de esta feature es `fullstack` justamente por eso.

**(2) Podar la selección con el conjunto completo de la descarga (la acción del listado 10).**
Era tentador: la acción ya existe tras la tanda A y devuelve exactamente el conjunto filtrado.
Descartada por dos razones concretas: (a) materializa y transporta hasta 5000 filas de trece
columnas para responder a una pregunta de sí/no sobre un puñado de identificadores, y lo haría
**en cada relectura del listado**, no al descargar; (b) esa acción tiene modo
`limite_excedido`, en el que devuelve **cero filas**: por encima del tope la poda o no haría
nada o —peor— desmarcaría todo. La consulta de vigencia devuelve una columna, está acotada por
lo que el usuario marcó y no tiene modo «me pasé del tope».

**(3) Subir la selección de la satélite al módulo, para que la poda viva junto a los datos.**
Descartada: `seleccionados` gobierna también `seleccionadas`, `estadoUnico`, `hayEstado` y las
cuatro acciones de lote (R47/R48 de la 170). Moverla obliga a re-verificar toda esa lógica para
ganar una prop menos. El callback que baja el módulo es el patrón que esta misma pantalla ya usa
para la descarga.

**(4) Un único `listarCompletoGenerico(listadoId, filtros)` en vez de doce métodos.**
Descartada: cada listado tiene su propio mapper (dinero incluido), su propio acotamiento por rol
y su propia lista blanca de filtros. Un método genérico o los reimplementa por dentro con un
`switch` —trece ramas en una función, y el guard de rol decidido por un parámetro— o afloja la
lista blanca a «lo que venga». Es exactamente el tipo de superficie que R4 y R17 prohíben.

**(5) Meter Q-M1 en esta feature porque «toca los mismos módulos».** Descartada, con el motivo
completo en `requirements.md > Alcance`: distinto defecto, distinto riesgo (datos viejos en
pantallas de dinero), bloqueada por una pregunta propia, y conjuntos que no coinciden (13 vs 12).
La mitigación de «pagar dos veces» es R33: esta feature no toca las opciones de `useSWR` de
ninguna pantalla, así que Q-M1 arranca sin conflictos y con el inventario hecho.

## 8. Integraciones

Ninguna nueva. No hay webhooks, ni API externa, ni cron, ni storage —con un matiz que es un
requisito (R9): la descarga de «Cierres solicitados por el mensajero» **deja** de tocar el
almacenamiento de evidencias, porque su lectura nueva es la del listado paginado, que no firma
URL (`CierreDiaService.ts:317` no llama a `createSignedUrls`; el compuesto sí, en `:190`).

## 9. Verificación

- **El `WHERE` se prueba donde vive (R14/R15/R16).** En la 170 aparecieron **7+ mutaciones del
  `WHERE` que sobrevivieron a los tests de servicio** —usan dobles y no ven la traducción a
  SQL— y solo las cazó el test de repositorio. Los casos nuevos van a los archivos que ya
  existen para eso, y no a un archivo nuevo por tanda:
  - `tests/unit/repositories/historicos-paginados-where.test.ts` → los `Completo` de histórico
    (2, 5, 9) y los de lista simple con conjunto (1, 6, 7, 11);
  - `tests/unit/repositories/colas-paginadas-where.test.ts` → los `Completo` de cola (3, 4, 8);
  - `tests/unit/repositories/satelite-paginado-where.test.ts` → el conjunto completo y la
    vigencia (10 + poda).
  Forma exigida (la que esos archivos ya usan): delegado Prisma falso, afirmaciones sobre los
  **argumentos** de la consulta, cuántas consultas se emiten y qué **no** lleva el `where`.
- **Trazabilidad (R34).** El mapa `R<n>` → archivo + nombre del caso está en
  `requirements.md > Anexo B` y el implementador lo repite, ya con la salida real, en
  `progress/impl_188-<tanda>.md`. **Contar `R<n>` en títulos de test no es evidencia**: los
  espacios de nombres se cruzan entre features y aquí ya produjo un falso «68/68».
- **Gates.** `./init.sh --rapido` al cerrar cada tanda; `./init.sh` completo antes de cada PR.
  Ningún subagente corre la suite entera (`AGENTS.md > Regla del gate`).
