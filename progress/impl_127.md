# impl_127 — analitica: servicios financieros

Rama: `feature/127-analitica-financiera-servicios` · worktree `ordenex-wt-127`.
Alcance de esta sesion: **TANDA 0, TANDA A y TANDA B**. Las tandas C, D, E y F **no** se han
tocado: las toma otro agente.

---

## TANDA 0 — Registro de la puerta T0

### T0.1 · Las nueve decisiones (humano, **2026-08-02**)

| # | Decision | Respuesta | Consecuencia en el codigo |
|---|---|---|---|
| D1 | «COD recaudado» y anulaciones | **(c) AMBOS** | `ImporteAnalitico` lleva `bruto` **y** `neto`; el `neto` se deriva por signo agregado, nunca emparejando `ajuste_*` con su original (el ledger no tiene ese puntero). |
| D2 | Coordenada temporal | **(b)** | Ledgers por `fecha_movimiento`; cierres por `resuelto_at`; frontera dia natural CR `[D 06:00Z, D+1 06:00Z)` de `resolverRango`, sin ventana propia. |
| D3 | Cuentas por pagar | **(a) saldo al corte** | `fecha_movimiento < hasta` ignorando `desde`; `esAcumulado: true` exactamente en las dos. |
| D4 | Cierres no resueltos | **(b)** | Fuera de toda cifra de dinero, dentro de `conciliacion_cierres`, fechados por `solicitado_at`, con las dos coordenadas declaradas por fila. |
| D5 | La conciliacion | **(a)+(c) reportar y emitir** | `cuadra` + `diferencia` + cierres implicados; umbral configurable en `lib/config/`; **la consulta nunca falla por un descuadre**. |
| D6 | Contradiccion declarada de `cod_recaudado` | **(a) dos vistas** | `cod_recaudado__por_metodo` y `cod_recaudado__por_tienda`, ids distintos, **no sumables**; el catalogo de la 135 **no se recorta**. |
| D7 | Que fuente manda en `cod_recaudado` | **(c) las dos** — ⚠ **RESUELTA POR IMPLICACION, NO CONTESTADA DIRECTAMENTE** | Se dedujo de D6(a)+D5. **Reabrible**: si el humano no lo ve asi, cambia R23 y podria caer una de las dos vistas de R19. |
| D8 | `egresos` | **(b) la 127 la produce** | La 127 sirve `egresos` y el catalogo de la 135 pasa esa entrada a `producida` (tarea **D.6**, todavia no hecha). |
| D9 | Cuerpo del 403 | **(c)** | `FORBIDDEN` generico al cliente; el motivo integro solo a `describirDenegado` y al `ErrorLogger`. |

Ningun requisito de `requirements.md` conserva una marca de decision pendiente.

### T0.2 · Archivo AJENO que esta feature modificara

`lib/analytics/metrics.ts` — **catalogo de la 135, fuente unica de trece features**. Cambio:
`egresos.estadoProduccion` de `"declarada"` a `"producida"`.
**Autorizacion: humano, 2026-08-02, D8 → (b).** Es una linea, y solo esa linea: ni etiqueta, ni
grano, ni alcance, ni ninguna otra entrada.

> **Estado al cierre de esta sesion: NO SE HA TOCADO.** El cambio es la tarea **D.6** y se hace
> cuando el productor exista. Marcarlo ahora seria declarar un productor que no hay — y el
> guardia B.5 se pone rojo si alguien lo intenta (ver evidencia M9). Este parrafo tiene que
> viajar al cuerpo del PR.

---

## Archivos creados

### TANDA A — contratos y tipos (sin logica)

| Archivo | Que materializa |
|---|---|
| `lib/types/analitica-financiera.ts` | A.1 — `ImporteAnalitico` (⟨D1⟩ `bruto`+`neto`), `VistaFinanciera` (⟨D6⟩ `id`+`sumableCon`), `ResultadoFinanciero` (⟨D3⟩ `esAcumulado`), `ResultadoConciliacion` (⟨D4⟩ `fechadoPor` por fila), `RespuestaFinanciera` (⟨D8⟩ sin `no_producida`, ⟨D9⟩ `forbidden` sin motivo) + los registros `IDS_FINANCIERAS_SERVIDAS` e `IDS_FINANCIERAS_ACUMULADAS`. |
| `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts` | A.2 — caja principal; categorias **del catalogo** (R17), ventana por `fecha_movimiento` (⟨D2⟩). |
| `lib/interfaces/repositories/IRecaudoAnaliticaRepository.ts` | A.2 — **dos metodos separados** ⟨D6⟩: cierres resueltos por metodo y ledger de tienda por tienda. |
| `lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts` | A.2 — saldo al corte ⟨D3⟩, `fecha_movimiento < hasta` sin cota inferior; **sin `mensajeroId`** (R14). |
| `lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts` | A.2 — doble coordenada temporal ⟨D2/D4⟩, niveles separados (R22), lado ledger por `origen_id` (R23). |
| `lib/interfaces/services/IAnaliticaFinancieraService.ts` | A.3 — una fachada; sin Prisma, sin `Request`, sin `cookies` (R30); `dominio_invalido` como estado de primera clase (R5). |
| `lib/config/analitica-financiera.ts` | A.4 — `UMBRAL_AVISO_DESCUADRE_CONCILIACION` ⟨D5⟩, **provisional y no medido**, STRING escala 2 (R40). |
| `tests/unit/analytics/financiera-contratos.test.ts` | Los "hecho cuando" de A.1–A.4. |

### TANDA B — guardias (escritos ANTES de lo que vigilan)

| Archivo | Tarea | Requisitos |
|---|---|---|
| `tests/unit/analytics/financiera-fuente.guardia.test.ts` | B.1 | R1, R2, R3, R4 (universo), R33, R34 |
| `tests/unit/analytics/financiera-alcance.guardia.test.ts` | B.2 **+ B.4** | R8, R9, R35 |
| `tests/unit/analytics/financiera-correspondencia.guardia.test.ts` | B.3 | R4 |
| `tests/unit/analytics/financiera-produccion.guardia.test.ts` | B.5 | R18 (definicion), R41 |

B.4 vive dentro del guardia de alcance en vez de en un archivo propio: es la otra mitad de la
misma equivalencia que vigila B.2 (catalogo sin `acotado` ⟺ sin adaptador de dinero), y
separarlas invitaba a que alguien arreglara una y no mirara la otra.

---

## Mapa `R<n> → test` (parcial: solo lo que las tandas A y B pueden cubrir)

| R | Test | Archivo |
|---|---|---|
| R1 | «ningun archivo de la feature nombra una tabla fuera de TablaDinero» + fixture `infractor-orden` | `financiera-fuente.guardia.test.ts` |
| R2 | «rechaza el que lee el rollup diario» + censo real | `financiera-fuente.guardia.test.ts` |
| R3 | «rechaza el que baja a gestion_orden con SQL crudo», «rechaza el include de orden» | `financiera-fuente.guardia.test.ts` |
| R4 | «ninguna metrica consulta una tabla que no declaro» + fixtures | `financiera-correspondencia.guardia.test.ts` |
| R7 | «toda firma publica de la 127 recibe ConsultaAnalitica y nada mas» (3 casos + `@ts-expect-error`) | `financiera-contratos.test.ts` |
| R8 | «no existe adaptador para ninguna de las cinco tablas del dinero» | `financiera-alcance.guardia.test.ts` |
| R9 | «ningun archivo de la feature contiene una rama de recorte» + 2 fixtures | `financiera-alcance.guardia.test.ts` |
| R18 (parcial) | «`egresos` sigue declarando sus OCHO categorias `egreso_*`» | `financiera-produccion.guardia.test.ts` |
| R27 | «ningun importe del contrato financiero es un number» (3 casos) | `financiera-contratos.test.ts` |
| R30 (parcial) | «el contrato del servicio no menciona Prisma, Request ni cookies» | `financiera-contratos.test.ts` |
| R33 | detector `fuenteProhibida` + censo | `financiera-fuente.guardia.test.ts` |
| R34 | 8 casos de autocomprobacion con fixtures | `financiera-fuente.guardia.test.ts` |
| R35 | «el mapa de alcance de cada financiera es exactamente el esperado» + autocomprobacion | `financiera-alcance.guardia.test.ts` |
| R37 | «cada importe llega con bruto y neto, y son campos distintos» | `financiera-contratos.test.ts` |
| R38 | «las dos vistas de cod_recaudado no suman entre si» (3 casos) | `financiera-contratos.test.ts` |
| R39 | «cada fila de conciliacion declara con que fecha entro» (2 casos) | `financiera-contratos.test.ts` |
| R40 | «el umbral de descuadre es una sola constante, y esta marcada» (3 casos) | `financiera-contratos.test.ts` |
| R41 | «el catalogo y la produccion real no se desincronizan» (fase A-B y fase con productor) | `financiera-produccion.guardia.test.ts` |
| R43 | «el mapa de las ocho financieras es exactamente el esperado» (esperado escrito a mano) | `financiera-contratos.test.ts` |
| ⟨D8⟩ | «no existe un estado para una financiera declarada sin productor» | `financiera-contratos.test.ts` |

**Sin cubrir todavia** (son de las tandas C-F, no de estas): R5, R6, R10, R11, R12, R13, R14,
R15, R16, R17, R19, R20, R21, R22, R23, R24, R25, R26, R28, R29, R31, R32, R36, R42. El mapa
completo lo cierra F.7.

---

## Evidencia de mutacion

Regla de casa: un guardia que no se pone rojo cuando se muta lo que dice medir es una asercion
vacia. Cada guardia de la TANDA B se mato y se revivio. Todas las mutaciones se aplicaron sobre
copia de respaldo y se revirtieron con verificacion byte a byte (`cmp`); `git status` al terminar
no muestra **ningun** archivo rastreado modificado.

| # | Mutacion | Guardia | Resultado |
|---|---|---|---|
| M1 | `lib/config/analitica-financiera.ts` gana `p.orden.aggregate(...)` | fuente (R1/R33) | **1 rojo** de 13 · revertido |
| M2 | `lib/types/analitica-financiera.ts` gana `p.analyticsDaily.groupBy(...)` | fuente (R2) | **1 rojo** de 13 · revertido |
| M3 | se afloja el detector: `(queryRaw\|executeRaw)(Unsafe)?` → `(nuncaJamasQueryRaw)` | fuente (R34) | **9 rojos** de 13 · revertido |
| M4 | se rompe una ruta declarada (`lib/types/NO-EXISTE.ts`) | fuente | **verde** — el descubrimiento por import cubre el hueco (ver nota abajo) |
| M4b | `REPO_ROOT` apunta a un directorio inexistente | fuente | el archivo **ni carga** (`no tests`) · revertido |
| M4c | `archivosDeLaFeature()` devuelve `[]` | fuente («no pasa por conjunto vacio») | **1 rojo**: `expected 0 to be greater than or equal to 3` · revertido |
| M5 | `ALCANCE_FINANCIERA.adminTienda` → `"acotado"` en `lib/analytics/metrics.ts` | alcance (R35) | **3 rojos** de 12 · revertido |
| M6 | aparece `whereWalletTiendaMovimiento` en `lib/analytics/alcance-columnas.ts` | alcance (R8) | **2 rojos** de 12 · revertido |
| M7 | una interfaz de la feature lee `consulta.alcance.tiendaId` | alcance (R9) | **1 rojo** de 12 · revertido |
| M8 | nace `IngresosAnaliticaRepository` consultando **ademas** `cierre_dia` | correspondencia (R4) | **1 rojo** de 9 · borrado |
| M8b | el mismo repositorio **sin** la tabla intrusa (control) | correspondencia (R4) | **verde** — el guardia no es un rechazo indiscriminado · borrado |
| M9 | `egresos` → `"producida"` **sin** productor | produccion (R41) | **1 rojo** de 5 · revertido |
| M10 | nace `AnaliticaFinancieraService.ts` y `egresos` sigue `"declarada"` | produccion (R41) | **2 rojos** de 5 · borrado |
| M11 | `IDS_FINANCIERAS_ACUMULADAS` gana `ingreso_flete` | contratos (R43) | **2 rojos** de 25 · revertido |
| M12 | la vista por metodo se declara `sumableCon: [por_tienda]` | contratos (R38) | **1 rojo** de 25 · revertido |

**Nota sobre M4 (la unica mutacion que NO puso nada rojo).** Romper una ruta de
`ARCHIVOS_DECLARADOS` no vacia el censo porque el archivo se recupera por el **descubrimiento
por import** (todo archivo que nombre un modulo de la feature entra igual). O sea: la
redundancia funciono. Lo que si tenia que morder —que el censo se quede vacio de verdad— muerde:
M4b y M4c. Se deja escrito porque una mutacion que no pone rojo tambien es informacion.

### Comprobacion explicita de «no pasa por conjunto vacio»

Cada guardia tiene un caso dedicado que afirma que **recorre archivos reales**:

- fuente: `censados.length >= 3`, contiene los tres modulos de la TANDA A, y cada uno tiene
  contenido; ademas `MODELOS.length > 20` y `PROHIBIDOS` contiene `orden`, `gestion_orden` y
  `usuario` (si el complemento del universo quedara vacio, el censo aprobaria cualquier cosa).
- alcance: `censados.length >= 3` y contiene la interfaz de cuentas por pagar; el bloque de
  catalogo afirma `FINANCIERAS.length === 8`.
- correspondencia: el mapa cubre **exactamente** las ocho financieras del catalogo y los cuatro
  repositorios de `design.md §3`; los repositorios aun no existen, asi que el censo real esta
  inactivo **por eso hay cinco fixtures que ejercitan el detector hoy** (M8/M8b lo confirman en
  cuanto el archivo nace).
- produccion: cruza dos fuentes independientes (`IDS_FINANCIERAS_SERVIDAS` contra
  `listarMetricas({ dominio: "financiera" })`) y ancla la ruta del productor.

---

## Verificacion (medida, no supuesta)

```
$ pnpm exec tsc --noEmit
(sin salida)  exit=0

$ pnpm exec eslint <los 12 archivos creados>
exit=0   (0 errores, 0 warnings)

$ pnpm exec vitest run tests/unit/analytics
 Test Files  31 passed (31)
      Tests  508 passed (508)
```

`tests/unit/analytics` tenia 26 archivos antes de esta sesion; ahora 31 (los cinco nuevos).
La corrida de la suite completa y su conteo de archivos quedan anotados en la respuesta de la
sesion; el baseline de la rama era **778 archivos / 9432 tests, 0 rojos**.

**Ningun test queda rojo a proposito.** El guardia B.5, que en la lectura literal de `tasks.md`
tendria que estar rojo hasta la tarea D.6, se escribio en **dos fases** (ver mas abajo, supuesto
S7) para que hoy afirme algo verdadero y siga mordiendo despues.

---

## Supuestos tomados (declarados, no preguntados)

- **S5 · `ResultadoFinanciero` es una union discriminada.** `design.md §5.2` lo declara como una
  sola interfaz con `vistas`, y §5.3 define `ResultadoConciliacion` suelto sin decir por donde
  sale. Aqui se discrimina por `tipo: "vistas" | "conciliacion"`. Motivo: `conciliacion_cierres`
  no produce importes por cubo, y modelarla como `vistas: []` con un campo opcional al lado
  obliga a comprobar un `undefined` que el compilador no exige. Con la union, olvidarse de la
  conciliacion no compila. Es la **unica** desviacion de la forma de los DTO del design, y esta
  escrita tambien en la cabecera del archivo de tipos.
- **S6 · Los repositorios devuelven importes ya en STRING escala 2.** `_sum` da `Decimal`; la
  conversion a STRING es formateo, no derivacion, y mantener `Prisma.Decimal` en la frontera
  del repositorio obligaria a que los mocks del servicio construyeran decimales. Toda la
  aritmetica sigue siendo `Prisma.Decimal` **dentro** del servicio (R27).
- **S7 · El guardia B.5 se escribio en dos fases.** Afirmacion actual: «mientras el productor no
  exista, `egresos` es la unica financiera `declarada`»; afirmacion futura, que se activa sola
  en cuanto exista `lib/services/AnaliticaFinancieraService.ts`: «ninguna financiera queda
  `declarada`». Un guardia rojo desde el primer dia se comenta «hasta que se implemente», y asi
  es como se pierden los guardias. M9 y M10 prueban que las dos fases muerden.
- **S8 · `IConciliacionCierresAnaliticaRepository.sumarLedgerPorOrigenDeCierre` devuelve el
  desglose por libro** (`wallet_movimiento` / `wallet_tienda_movimiento` /
  `pago_mensajero_movimiento`), sin fundirlos. R23 dice «los ledgers» en plural y sumar los tres
  contra un `total_general` no puede cuadrar nunca (ver contradiccion C2 abajo). Desglosado, la
  decision sigue disponible; fundido, ya no.
- **S9 · El umbral de descuadre vale `"0.01"`** — un centimo, o sea: hoy **cualquier** descuadre
  se reporta. Es una eleccion conservadora sobre un volumen no medido, declarada como
  provisional en el propio archivo. No hay dato del que sacar otro numero.

---

## Contradicciones y puntos abiertos encontrados AL IMPLEMENTAR

- **C1 · `conciliacion_cierres` y `sumableCon`.** No aplica: la conciliacion no produce vistas.
  Resuelto por S5.
- **C2 · R4 contra R23 — CONTRADICCION REAL, sin resolver.** `conciliacion_cierres` declara
  `fuente.tablas = ["cierre_dia", "cierre_bodega"]`, pero R23 obliga a comparar los snapshots
  aprobados contra lo que los **ledgers** registraron con `origen_tipo = cierre_dia`. Con el
  catalogo vigente **el repositorio de conciliacion no puede cumplir R4 y R23 a la vez**. El
  guardia B.3 **no lleva exencion** para ese caso: se pondra rojo el dia que se escriba C.4, que
  es exactamente lo que tiene que pasar. Salidas legitimas: (a) ampliar
  `conciliacion_cierres.fuente.tablas` con los tres ledgers —es **tocar el catalogo de la 135**,
  o sea decision humana fechada, como la de ⟨D8⟩—; o (b) acotar R23 a comparar solo entre
  niveles de cierre, renunciando al cruce con el ledger. Aflojar el guardia es la tercera
  opcion y es la unica descartada. El caso queda fijado en un test
  (`el ledger que R23 quiere cruzar NO cabe hoy en lo que conciliacion_cierres declara`) para
  que no se descubra por sorpresa.
- **C3 · `SINPE` vs `simpe`** (pregunta abierta 3 del spec): la columna real es `total_simpe` y
  el catalogo escribe «SINPE» en la descripcion. El contrato usa `"simpe"` (la columna) y lo
  deja anotado; la etiqueta de presentacion es de la 132/134.
- **Sin novedad sobre el rollup.** Nada en las tandas A y B empujo a leer `analytics_daily`, y el
  guardia B.1 lo prohibe explicitamente ademas del R42 de la 124.

---

## Lo que NO se ha hecho (para el siguiente agente)

Tandas **C, D, E y F** enteras. En particular:

1. **D.6 sigue pendiente**: el catalogo aun dice `egresos: "declarada"`. Hacerlo **cuando el
   servicio exista**, en una sola linea, citando la autorizacion del 2026-08-02.
2. **C2 hay que decidirlo antes de escribir C.4**, no durante.
3. Los cuatro repositorios entran solos al censo del guardia B.1 y al de B.3 en cuanto se creen:
   no hay que registrarlos en ningun sitio.
