# Feature 183 — Diseño

> Aplica `progress/decision_183.md` (⟨D12⟩, humana, 2026-08-04, CERRADA). Este documento no
> discute el **qué**: solo el **cómo**.

## 1. Hechos verificados en el código (leídos, no recordados)

| Hecho | Dónde |
|---|---|
| Las cuatro métricas de caja del catálogo | `lib/analytics/metrics.ts`: `ingreso_flete` :429-443, `ingreso_comision_cod` :444-458, `ingreso_iva` :459-475, `egresos` :476-510 (sus ocho categorías, :499-509) |
| Un solo manejador sirve las cuatro, con `derivarBalance(Σingreso, Σegreso)` | `AnaliticaFinancieraService.ts:131-138` (despacho) y `:212-230` (`deCaja`) |
| Las dos métricas de la 173 y las dos vistas de recaudo, **fuera de alcance** | `:253-279` (`deTesoreria`), `:291-335` (`deRecaudo`; la vista A declara `bruto === neto` a propósito en `:297-299`) |
| El tipo compartido, con `neto` obligatorio | `lib/types/analitica-financiera.ts:45-61` |
| El `CHECK` categoría↔tipo que hace redundante el neto | `db/migrations/20260803120000_caja_tesoreria/migration.sql:61-71` (9 categorías `ingreso`, 8 `egreso`) |
| La anulación de un egreso emite `ingreso_ajuste` | `lib/services/WalletEgresoService.ts:89-103` |
| `ingreso_ajuste` es de naturaleza `propio`, y no puede dejar de serlo | `lib/utils/caja-tesoreria.ts:51` y la razón escrita en `:59-60` |
| El repositorio **no** escribe categorías: las lee del catálogo | `lib/repositories/IngresosAnaliticaRepository.ts:50-64,84-92` |
| Consumidores de `.neto` en código de producción: **cinco**, más el constructor del servicio | `adaptar.ts:110` y `:94`; `TableroFinanciero.tsx:148`, `:171`, `:235`/`:249` (vía `serieAcotada`); `AnaliticaFinancieraService.ts:83-89` |
| La 180 (`pending`) ya decidió en su puerta humana que **la 183 aterriza primero** | `specs/180-analitica-financiera-serie-temporal/requirements.md:302` |

**Consecuencia aritmética de partida.** Hoy `ingreso_* → neto = +bruto`; `egresos → neto =
−bruto`. Ninguna de las cuatro puede producir hoy un neto distinto de `±bruto` con datos que la
base acepte. Con `ingreso_ajuste` dentro de `egresos`, sí.

## 2. Modelo de datos: **no hay cambios**

- **Sin migración, sin `down.sql`, sin tocar `db/schema.prisma`.** Ninguna tabla, columna, enum,
  índice o `CHECK` cambia. `ingreso_ajuste` ya existe en `wallet_movimiento_categoria` desde la
  42 y ya es legal con `tipo = 'ingreso'` en el `CHECK` de la 173.
- **Sin cambios de RLS.** No hay tabla nueva, luego no hay superficie nueva.
  `wallet_movimiento` conserva RLS habilitada sin policies (solo service role) desde
  `20260712160000`.
- **Sin escritura de datos, sin backfill, sin recálculo.** La cifra de `egresos` cambia de
  **definición**, no de historia: se sigue leyendo el mismo libro append-only.
- **Sin cambio en la consulta emitida más allá de la lista de categorías.** El `WHERE` pasa de
  `categoria IN (8)` a `categoria IN (9)` porque el catálogo manda; ni una línea del repositorio
  cambia (R17).

Efecto medido antes de decidir (⟨D12⟩ §3, MCP contra producción, 2026-08-04): **cero filas
`ingreso_ajuste` y cero `egreso_ajuste`**, luego el cambio **no mueve hoy ningún número**.
`egresos` sigue valiendo ₡22.042,40 de bruto. Es la ventana barata: hacerlo después de la primera
anulación obligaría a declarar un salto que hoy no existe.

## 3. La decisión cara: cómo se modela «esta métrica no tiene neto»

### 3.1 Lo elegido — `ImporteAnalitico` pasa a ser una **unión discriminada**

```ts
// lib/types/analitica-financiera.ts

/** Importe de una métrica cuyo neto con signo significa algo real. */
export interface ImporteConNeto {
  readonly forma: "bruto_y_neto";
  readonly bruto: string;
  readonly neto: string;
  readonly moneda: string;
}

/**
 * Importe de una métrica cuyo neto sería redundante POR CONSTRUCCIÓN: su lista de
 * categorías es homogénea de prefijo y el CHECK categoría↔tipo de la 173 admite un solo
 * `tipo`, luego `neto = +bruto` siempre. ⟨D12⟩ (humano, 2026-08-04).
 */
export interface ImporteSoloBruto {
  readonly forma: "solo_bruto";
  readonly bruto: string;
  readonly moneda: string;
}

export type ImporteAnalitico = ImporteConNeto | ImporteSoloBruto;
```

**El discriminante se llama `forma` y no `tipo` a propósito**: en este mismo dominio `tipo` ya
significa otras dos cosas —`ResultadoFinanciero.tipo` (`"vistas" | "conciliacion"`) y
`AgregadoCategoriaCaja.tipo` (`"ingreso" | "egreso"`)—. Un tercer `tipo` con un tercer
significado en el mismo archivo es una trampa gratuita.

**Por qué esta forma y no otra:**

1. **El precedente vive en el propio archivo.** `ResultadoFinanciero` ya es una unión
   discriminada, y su desviación declarada dice literalmente por qué
   (`lib/types/analitica-financiera.ts:29-36`): *«modelarla con un campo opcional al lado obliga
   a todo consumidor a comprobar un `undefined` que el compilador no le exige. Con la unión,
   olvidarse de la conciliación no compila»*. El problema aquí es el mismo, una capa más abajo.
2. **No rompe el tipo compartido donde el neto significa algo.** `ImporteConNeto` es, campo por
   campo, el `ImporteAnalitico` de hoy más el discriminante. Las siete métricas que conservan el
   neto no cambian de contrato.
3. **La ausencia queda *declarada*, no *inferida*.** «No tiene neto» y «el neto no se pudo
   calcular» dejan de ser el mismo estado. Esto importa porque en la 132 el ausente ya significa
   **«no se sabe»** (R15) y pintarlo donde la verdad es «no aplica» sería una mentira nueva.
4. **Prepara la 180 sin deuda.** La 180 multiplica por ~62 los sitios donde se emite un importe.
   Con el discriminante, una fila por fecha de `ingreso_flete` no puede nacer con un neto
   inventado.

### 3.2 Qué les pasa a los consumidores que hoy leen `.neto` sin preguntar

**Dejan de compilar. Los seis, uno a uno.** Es el efecto buscado: `pnpm run typecheck` los
enumera y nadie tiene que acordarse de ellos.

| Sitio | Hoy | Después |
|---|---|---|
| `AnaliticaFinancieraService.ts:83-89` `importe(bruto, neto)` | único constructor | **dos** constructores privados: `importeConNeto(bruto, neto)` y `importeSoloBruto(bruto)`. Siguen siendo los únicos que escriben `moneda` (S2/R29). |
| `adaptar.ts:33` `CampoImporte = "bruto" \| "neto"` | dos campos siempre | se conserva el tipo, pero `serieDeVista` solo acepta `"neto"` si el importe lo trae: la firma pasa a estrecharse por la forma de la vista. |
| `adaptar.ts:104-113` `filasDeVista` | escribe `valores.bruto` y `valores.neto` | escribe la clave `neto` **solo** si la vista es `bruto_y_neto`. Nunca `null` (R23). |
| `adaptar.ts:92-95` `COLUMNAS_IMPORTE` | dos columnas fijas | se añade `COLUMNAS_IMPORTE_SOLO_BRUTO` y una función `columnasDeVista(vista)` que elige por la forma. Sigue habiendo **una** declaración de columnas, no una por panel. |
| `TableroFinanciero.tsx:136-159` `TotalDelDto` | pinta total neto + total bruto | pinta los dos, o solo el bruto, según la forma. |
| `TableroFinanciero.tsx:161-177` `PanelKpi` | KPI = neto, línea secundaria = bruto | con neto, igual que hoy; sin neto, KPI = bruto y **sin** línea secundaria (P2). |
| `TableroFinanciero.tsx:180-183,235,249` `serieAcotada` | `campo: "bruto" \| "neto"` | una sola serie donde no hay neto (R21). |

**Ninguno de los siete decide por id de métrica.** Todos ramifican por `importe.forma`, que es
«la forma del DTO» — exactamente el criterio que R27 de la 132 ya exige
(`TableroFinanciero.tsx:22-24`).

### 3.3 Alternativas descartadas

**(a) Campo opcional: `readonly neto?: string`.** Es la más barata en diff (las fixtures de test
no cambian) y también fuerza el error de compilación en los consumidores, porque `string |
undefined` no entra donde se espera `string`. **Descartada por dos razones.** Primera: invita al
arreglo de una línea `importe.neto ?? "0.00"`, que inventa un cero — el pecado que este contrato
persigue desde `aNumero` (`adaptar.ts:41-49`: *«NUNCA `0`: un cero sería indistinguible de "no
hubo movimiento"»*). Segunda: `undefined` no distingue **«no aplica»** de **«no se calculó»**, y
en el tablero esa diferencia ya tiene consecuencia visible (R15 de la 132 pinta el ausente con su
marcador). Un campo opcional describe una carencia; aquí no hay carencia, hay otra clase de
importe.

**(b) Que el catálogo declare por métrica si el neto es significativo** (p. ej.
`definicion.netoSignificativo: boolean`, o un registro `IDS_FINANCIERAS_CON_NETO` en el contrato,
al estilo de `IDS_FINANCIERAS_ACUMULADAS`). **Descartada como mecanismo principal**, por tres
motivos. Uno: no impide nada en compilación —el campo seguiría en el tipo y un consumidor podría
leerlo igual—, así que habría que combinarla con (a) o con la unión, y entonces sobra. Dos:
⟨D12⟩ §4 acota lo que se puede tocar en `metrics.ts`, y añadir un campo nuevo a la forma de una
entrada del catálogo de trece features excede esa autorización; el catálogo declara **qué suma**
una métrica, no **qué forma tiene su DTO**. Tres: obligaría al frontend a leer el catálogo para
saber cómo pintar, justo lo que R27 de la 132 prohíbe.

**(c) Dejar el `neto` publicando `±bruto` y documentarlo.** Es lo que hay hoy. Descartada por la
propia ⟨D12⟩ §2: *«el campo no informa de nada y sostenerlo invita a leerlo como si informara»*.

**(d) Un DTO propio para las tres, sin discriminante** (dos interfaces sueltas y que cada
consumidor haga `"neto" in importe`). Descartada: `in` como discriminante no sobrevive a la
serialización mental de nadie, y el compilador no obliga a cubrir el caso nuevo cuando aparezca
una tercera forma.

**Dónde NO se toca el neto**, y por eso no hace falta ninguna vía de escape: vista B de recaudo,
`derivarBalance`, `derivarSaldoTienda`, `derivarCuentaPorPagar`, `derivarCaja`, las dos cuentas
por pagar y las dos métricas de tesorería de la 173 (⟨D12⟩ §4).

## 4. El catálogo — el diff autorizado, y ni una cosa más

⟨D12⟩ autoriza **exactamente tres cambios** en `lib/analytics/metrics.ts`, todos dentro de la
entrada `egresos`:

1. `definicion.categorias`: 8 → **9**, añadiendo `ingreso_ajuste` al final (sin reordenar las
   ocho existentes, para que el diff se lea de un vistazo).
2. La `descripcion`, que gana la cláusula del descuento de anulaciones.
3. Un comentario que cita ⟨D12⟩ con su fecha, al lado de los dos anteriores.

Las tres entradas de Q1 **no cambian**: su retirada del neto no vive en el catálogo, vive en el
contrato y en el servicio. Es una propiedad importante del diseño: el catálogo sigue declarando
solo *qué suma* cada métrica.

**Texto propuesto de la descripción** (conserva las tres piezas que la guardia R53 de la 173
exige y la coletilla que exige `metrics.test.ts:419-425`):

> Salidas de la caja principal (pagos a tienda y mensajero, sueldos, gastos fijos y variables,
> indemnizaciones y ajustes) segun el libro append-only de la wallet; DESDE LA FEATURE 173
> incluye el dinero ENTREGADO A LAS TIENDAS, que antes ninguna via emitia, asi que su cifra crece
> a partir de esa fecha sin que su id ni su nombre cambien y no es comparable con la de antes;
> DESDE LA FEATURE 183 la ANULACION de un egreso se DESCUENTA de esta cifra: el reverso que la
> anulacion emite (ingreso_ajuste) entra en la definicion, de modo que el bruto cuenta los DOS
> movimientos —el pago y su reverso— y el neto es lo que de verdad salio de caja. Se lee del
> ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.

### 4.1 La guardia de descripciones: dónde está y a qué afecta

Hay **dos** guardias que miran descripciones, y las dos importan:

- `tests/unit/analytics/metrics.test.ts:419-425` — «cita las gestiones anuladas en la descripción
  de toda métrica». La coletilla se conserva, luego **sigue verde**. Aviso: este caso lo pasa
  también un texto que haya perdido todo lo demás; no sirve de red.
- `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts:159-218` (R53/R54 de la 173) —
  la que de verdad vigila el contenido de la descripción de `egresos`, con el texto **pre-173**
  guardado como fixture literal para demostrar que la aserción discrimina. Este archivo **hay que
  ampliarlo**: la cláusula de la 183 necesita su predicado propio (`declaraElDescuentoDe183`) y
  su fixture del texto **pre-183**. Sin eso, borrar la frase nueva dejaría la suite entera en
  verde — que es literalmente el defecto que el reviewer de la 173 encontró
  (`progress/current.md:225-226`).

Y una tercera que no mira descripciones pero sí el catálogo:
`tests/unit/analytics/catalogo-produccion.guardia.test.ts:376-455` deriva de `progress/decision*.md`
los cambios decididos y exige que el bloque de la entrada **cite el fichero y escriba una de sus
fechas**. `progress/decision_183.md` **no** contiene ninguna línea con `declarada` y `producida` a
la vez, así que no añade ninguna obligación nueva; pero el bloque de `egresos` sí acumula
obligaciones previas (⟨D8⟩ 2026-08-02, ⟨P4⟩ 2026-08-03), y **toda fecha escrita en el bloque debe
estar respaldada por alguna decisión que el propio bloque cite**. Añadir «⟨D12⟩ humano,
2026-08-04 (`progress/decision_183.md`)» es correcto y suficiente: esa fecha existe en ese
documento. Escribir la fecha sin citar el fichero pondría la guardia roja.

## 5. Servicio — el selector va en el despacho, no en un `if` por id

`deCaja` sirve las cuatro métricas. La forma del importe entra como **parámetro explícito**,
siguiendo el precedente que la 173 dejó escrito para el mismo método vecino
(`AnaliticaFinancieraService.ts:139-144`: *«lo único que cambia entre ellas es cuál de las dos
cifras se publica como neto, y eso entra como selector explícito en vez de como un `if` por id
dentro del manejador»*).

```ts
const cajaSoloBruto: Manejador = (c) => this.deCaja(c, "solo_bruto");
const cajaConNeto:   Manejador = (c) => this.deCaja(c, "bruto_y_neto");

this.despacho = {
  ingreso_flete:       cajaSoloBruto,
  ingreso_comision_cod: cajaSoloBruto,
  ingreso_iva:         cajaSoloBruto,
  // ⟨D12⟩ humano, 2026-08-04: `egresos` CONSERVA el neto porque gana `ingreso_ajuste`.
  egresos:             cajaConNeto,
  …
};
```

Y dentro:

```ts
private async deCaja(consulta, forma): Promise<ResultadoFinanciero> {
  const filas = await this.ingresos.sumarPorCategoria(consulta);
  const bruto = sumar(filas.map((f) => f.suma));
  const total =
    forma === "solo_bruto"
      ? importeSoloBruto(bruto)
      // R20 de la 127 intacto: la resta con signo la sigue haciendo `derivarBalance`.
      : importeConNeto(bruto, derivarBalance(sumaDeTipo(filas, "ingreso"),
                                             sumaDeTipo(filas, "egreso")).balance);
  …
}
```

Notas de contrato:

- `derivarBalance` **deja de llamarse** para las tres de Q1. No es una pérdida de reuso: era una
  resta contra cero. R20 de la 127 sigue cumpliéndose donde hay resta que hacer.
- El desglose por `tipo` que devuelve el repositorio **sigue haciendo falta** —`egresos` lo
  necesita—, así que `AgregadoCategoriaCaja` no cambia. Sí hay que actualizar la prosa de
  `IIngresosAnaliticaRepository.ts:26-40`, que hoy dice que ese desglose existe para los **dos**
  importes de las **cuatro** métricas.
- El signo se conserva: `egresos` publica un neto **negativo** cuando sale dinero. Con el par
  real, `neto = 400 − 400 = "0.00"`.

## 6. Contratos de entrada/salida

**No cambia ninguna ruta, ningún endpoint, ningún Server Action, ningún parámetro de entrada.**
La superficie HTTP/RSC es exactamente la de hoy: el tablero se carga en el Server Component de
`app/(app)/analitica/` vía `cargar.ts`, que llama al Server Action de la 127. `RespuestaFinanciera`
y sus cuatro estados no se tocan.

Lo único que cambia es **la forma del importe dentro del DTO**:

```jsonc
// ANTES — ingreso_flete
{ "id": "ingreso_flete", "grano": "fecha", "fuente": "wallet_movimiento", "sumableCon": [],
  "filas": [], "total": { "bruto": "1005.00", "neto": "1005.00", "moneda": "CRC" } }

// DESPUÉS — ingreso_flete
{ "id": "ingreso_flete", "grano": "fecha", "fuente": "wallet_movimiento", "sumableCon": [],
  "filas": [], "total": { "forma": "solo_bruto", "bruto": "1005.00", "moneda": "CRC" } }

// DESPUÉS — egresos, con una anulación de 400 en el rango
{ "id": "egresos", …,
  "total": { "forma": "bruto_y_neto", "bruto": "800.00", "neto": "0.00", "moneda": "CRC" } }
```

Invariantes que **no** se relajan: todo importe sigue siendo `string` escala 2 (S1/R27 de la
127), la `moneda` sigue saliendo de `lib/config/moneda.ts` y no hay ni un `number` en la
frontera.

## 7. Frontend — el tablero

Cambios acotados a los dos archivos de la 132 que leen importes. Ninguno introduce una lista de
ids ni una cifra derivada (R14/R27 de la 132 intactos).

- `adaptar.ts`: `filasDeVista` deja de escribir la clave `neto` cuando no la hay; nace
  `columnasDeVista(vista)` y `COLUMNAS_IMPORTE_SOLO_BRUTO`; `serieDeVista` se estrecha por forma.
- `TableroFinanciero.tsx`: `TotalDelDto` y `PanelKpi` ramifican por `total.forma`;
  `ContenidoDeVista` emite una serie o dos según la forma. La rama «vista sin filas → KPI» y las
  dos ramas de `cod_recaudado` **no cambian de criterio**: siguen decidiéndose por la forma del
  DTO.

Los textos siguen viviendo en el objeto `TEXTOS` del componente, fuera del JSX, y no se escribe
ningún símbolo de moneda ni locale (R25 de la 132).

## 8. Requisitos vivos de features `done`: el veredicto, escrito aquí y no en la cabeza del implementer

| | Veredicto | Dónde queda fijado |
|---|---|---|
| **R18 de la 127** (Σ de las **ocho** `egreso_*`) | **Acotado a nueve.** La mitad que dice «no existe `no_producida`» sigue intacta. | R5 y R26 de este spec |
| **R37 de la 127** (toda métrica de ledger devuelve **dos** importes) | **Acotado.** Sigue valiendo donde el neto no es redundante por construcción; deja de aplicar a las tres de Q1. El resto de R37 —que el neto **no** sale de emparejar un `ajuste_*` con el movimiento que corrige— sigue vigente y es justo lo que R7 comprueba con el par real. | R1, R6, R7, R26 |
| **R14 de la 132** (ninguna cifra derivada) | **Intacto.** Nada de lo que aquí se hace deriva una cifra. | — |
| **R16 de la 132** (bruto **y** neto en cada panel) | **Reinterpretado**, no derogado: cada panel muestra **todos los importes que su DTO trae**; donde trae los dos, siguen los dos y distinguibles. | R19, R20, R26 |

**Esta feature no reescribe los specs ajenos.** Anota una nota de corrección fechada al margen del
requisito afectado (P4 / R26), con el mismo mecanismo que la 160 usó sobre la 148
(`specs/160-badge-intentos-entrega/tasks.md:300-302`).

## 9. Inventario de rojos POR DISEÑO (y qué se hace con cada uno)

Ninguno se borra ni se relaja. Se **dan vuelta**, que es lo que ⟨D10⟩ dejó por escrito.

| Archivo:línea | Qué afirma hoy | Qué pasa a afirmar |
|---|---|---|
| `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts:134-144` | `egresos` tiene 8 categorías, **todas** `egreso_*`, y **no** contiene `ingreso_ajuste` | **9**: las ocho `egreso_*` más `ingreso_ajuste`; sigue **sin** contener `ingreso_reverso_pago_tienda`, y `tercerosDeclaradasPor("egresos")` sigue siendo `["egreso_pago_tienda"]` (R51 de la 173 intacto: `ingreso_ajuste` es `propio`) |
| `tests/unit/analytics/financiera-produccion.guardia.test.ts:84-91` | ídem, «las OCHO que habrá que sumar» | ídem, nueve; el lado que protege (recortar la definición encoge la cifra) se conserva |
| `tests/unit/services/analitica-financiera-service.test.ts:304-309` | `toHaveLength(8)` | `toHaveLength(9)` + que `ingreso_ajuste` está |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts:108-117` | «`egresos` ve sus ocho categorías» | ve las nueve, y **el `where` emitido las lleva** (R5: aquí es donde se mide el SQL) |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts:119-131` | fila **imposible** `egreso_ajuste` + `tipo: ingreso` | el par **real**: `egreso_gasto`/`egreso` + `ingreso_ajuste`/`ingreso` (R24) |
| `tests/unit/services/analitica-financiera-derivacion.test.ts:170-187` | fila **imposible** `ingreso_flete` + `tipo: egreso`, «el par se cancela en el neto» | el mismo enunciado sobre `egresos` con el par real; neto `0.00`, bruto `2×monto` (R24, R7) |
| `tests/unit/services/analitica-financiera-derivacion.test.ts:151-168` | el neto negativo de `ingreso_flete` con una fila `egreso_ajuste` sembrada | se traslada a `egresos`, que es donde el neto existe |
| `tests/integration/actions/analitica-financiera-action.test.ts:402-427` (comentario) | «el neto 0 **no es alcanzable** con datos legales» y «queda de encargo para la 175» | pasa a decir que **sí** es alcanzable, y cómo, citando ⟨D12⟩ |
| `tests/integration/actions/analitica-financiera-action.test.ts:452-474` (F.4(b)) | «el contraasiento real **NO** entra en `egresos`: sigue en bruto 400 / neto −400» | **entra**: bruto `800.00`, neto `0.00`, con las dos filas en el libro (R7, R25) |
| `tests/components/TableroFinanciero.test.tsx:443-454` | R16 sobre `ingreso_flete` con bruto 1000 / neto 900 (fixture **imposible**) | R20 sobre una métrica que conserva el neto; y un caso nuevo para R19 sobre una que no lo tiene |
| `tests/unit/analytics/financiera-contratos.test.ts:160-176` | «el contrato exige los dos campos, no uno copiado del otro» | exige los dos **en `ImporteConNeto`**, y que `ImporteSoloBruto` **no admita** `neto` (R2) |
| Fixtures de forma en `tablero-financiero-adaptar.test.ts`, `tablero-financiero-cargar.test.ts`, `AnaliticaPage.test.tsx`, `_dobles-analitica-financiera.ts` | construyen `{bruto, neto, moneda}` a mano | ganan el discriminante; se centraliza un helper de fixture en `_dobles-analitica-financiera.ts` para no repetirlo (~40-60 literales) |

Prosa que queda mintiendo y hay que actualizar en el mismo PR (no es cosmética: es documentación
que el próximo lector creerá): `metrics.ts:493`, `AnaliticaFinancieraService.ts:46-53` y
`:136-137` y `:199-211`, `IIngresosAnaliticaRepository.ts:26-40`,
`lib/types/analitica-financiera.ts:15-17` (el bloque ⟨D1⟩/R37) y `IngresosAnaliticaRepository.ts:69-82`.

## 10. Verificación

- **Tanda:** `./init.sh --rapido`. **Antes del PR:** `./init.sh` completo, sin excepción. Un PR
  verde en Vercel **no dice nada de los tests**: es un build.
- **Las guardias van siempre** y son la mitad del valor aquí: cuatro de los rojos por diseño son
  guardias que ningún grafo de imports selecciona.
- **La cifra se mide contra Postgres**, no solo con dobles (§5 de `requirements.md`). Los dobles
  no ven el `where.categoria.in`, que es exactamente lo que cambia.
- **Trazabilidad:** mapa R→test en `progress/impl_183.md`, construido leyendo cada caso.
  **Prohibido** contar `R\d+` en títulos: cruza espacios de nombres y ya dio un falso 68/68 en
  este repo.

## 11. Coordinación con otras fichas

- **180** (`pending`, spec escrito): su puerta humana ya decidió **(a) la 183 aterriza primero**
  y la 180 no arranca hasta que esté mergeada
  (`specs/180-analitica-financiera-serie-temporal/requirements.md:302`). R18 de esta feature (una
  vista, una forma) es la red que la 180 necesita. Su spec cita todavía «la 182» al hablar de
  esta ficha: es **esta**, renumerada el 2026-08-04.
- **181** (`pending`, etiquetas de tienda): toca los cubos por tienda, no los importes de caja.
  Sin conflicto de archivos con esta feature salvo en `adaptar.ts`; conviene no solaparlas.
- **179** (`pending`, caché financiera): si aterriza después, la clave de caché ha de contemplar
  que el DTO cambió de forma. No es dependencia, es un aviso.
- **Zona `fullstack`:** se secuencia **backend → frontend**. Hasta dos features `in_progress` por
  zona y sin conflicto de archivos entre ellas.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| El diff de fixtures (~40-60 literales) tapa el cambio real en la revisión | helper único de fixture; el diff de `metrics.ts` se mantiene en tres cosas y se declara en el cuerpo del PR |
| Alguien «arregla» el bruto de `egresos` para que no suba con una anulación | P1 respondida en la puerta, y la descripción del catálogo lo declara (R11) |
| La cláusula nueva de la descripción se revierte sin que nada falle | predicado propio + fixture del texto **pre-183** (R11); es la lección de R53 de la 173 |
| Preview queda sin verificar | declarado, no asumido: el MCP está fijado a producción y **preview no es verificable por esa vía** |
| Un `ingreso_ajuste` nace en producción entre el merge y la medición | la medición post-merge se hace por categoría y tipo, no contra el literal ₡22.042,40 a ciegas |
