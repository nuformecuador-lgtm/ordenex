# 176 — analitica: modo agregado de tasas y tiempos · tasks

Convenciones: `[P]` = paralelizable con las tareas de su mismo bloque. Cada task lleva su criterio
de **HECHO**. Ninguna task se marca `[x]` sin ese criterio comprobado.

Regla de mutacion, valida para toda task de test: **no basta con el verde**. Para cada `R<n>` el
implementer aplica la mutacion de `requirements.md §3`, comprueba que el test NOMBRADO se pone
rojo, revierte, y anota el par (mutacion → test que murio) en `progress/impl_176.md`. Un requisito
cuya mutacion deja todo verde **no esta cubierto** y la task no esta hecha.

---

## Bloque 0 — Puerta

- [x] **T0.1** Aprobacion humana de los tres archivos del spec y respuesta a las 6 preguntas
      abiertas. **PUERTA CERRADA.** Las seis decisiones (`D1`–`D6`, todas `(A)`) estan registradas
      en `requirements.md §4` con su alternativa descartada y su motivo, y `requirements.md` /
      `design.md` ya estan ajustados a ellas (R4, R8, R10, R11 y el nuevo **R19**).
      **HECHO:** la tabla `D1`–`D6` existe; la ficha frontend que sale de **D5** esta redactada en
      `requirements.md §5` y **la da de alta el humano** (esta spec no toca `feature_list.json`).

---

## Bloque 1 — Contrato (sin logica)

- [x] **T1.1** Anadir a `lib/types/analitica-operativa.ts` los tipos `CuboAgregado`,
      `GranoAgregado`, `AgregadoOperativo`, `ResultadoAgregado` (`design.md §3`), con
      `cobertura` **sin `?`** y `numerador`/`denominador` como `number`.
      *Depende de: T0.1.*
      **HECHO:** `pnpm typecheck` verde y `PuntoSerie`/`SerieOperativa`/`ResultadoOperativo`
      byte-identicos a `origin/dev` (`git diff origin/dev -- lib/types/analitica-operativa.ts` solo
      muestra adiciones).

- [x] **T1.2** Anadir `OpcionesAgregado` y `consultarAgregado(...)` a
      `lib/interfaces/services/IAnaliticaOperativaService.ts`, sin tocar `consultar`.
      *Depende de: T1.1.*
      **HECHO:** typecheck verde; `AnaliticaOperativaService` falla a compilar por metodo ausente
      (se resuelve en T2.1) — se comprueba y se anota.

---

## Bloque 2 — Servicio

- [x] **T2.1** Implementar `consultarAgregado` en `lib/services/AnaliticaOperativaService.ts`:
      rechazo temprano por `unidad` (R12), cubeteo `periodo`/`semana`, acumulacion en `Medidas`,
      emision de `numerador`/`denominador`, division unica con `razon()` (R2/R3/R4/R6/R7),
      cobertura reusada (R9).
      *Depende de: T1.2.*
      **HECHO:** typecheck + lint verdes; el comentario de cabecera `:38-40` queda **ampliado** (no
      sustituido) con una linea que declare que la regla se aplica tambien entre dias.

- [x] **T2.2** Parcialidad: los cubos que contienen el dia en curso heredan `parcial: true` y el
      `corteAt` mayor (R10), reusando `cubosIntradia` y `completarPrimerIntento`.
      *Depende de: T2.1.*
      **HECHO:** un cubo `periodo` sobre un rango que incluye hoy sale `parcial: true`; sobre un
      rango de solo dias cerrados sale sin la marca.

- [x] **T2.3** Camino propio de `aging_por_estado` (R11): cubo unico al corte, siempre parcial.
      *Depende de: T2.1. `[P]` con T2.2.*
      **HECHO:** con dos filas de aging de distinto volumen, el valor es `Σacum / Σn` y no la media
      de las dos medias.

- [x] **T2.4** Seudonimizacion de la dimension `mensajero` en los cubos agregados (R15), reusando
      `seudonimizarMensajeros`.
      *Depende de: T2.1. `[P]` con T2.2, T2.3.*
      **HECHO:** con politica `seudonima` ningun `dimension` del payload es un uuid de mensajero.

---

## Bloque 3 — Borde

- [x] **T3.1** Anadir `consultarAgregadoOperativo` a `lib/actions/analitica-operativa.ts` con los
      **mismos cuatro pasos** y **reusando** el privado `denegar()` y `sondeaIdentidadDeMensajero`
      (R13/R14/R15). Sin cablear repositorios nuevos: `construirServicio` se reusa tal cual.
      *Depende de: T2.1.*
      **HECHO:** el archivo no gana ninguna segunda forma de responder `forbidden`; `denegar()`
      sigue siendo la unica, y el diff no toca `construirServicio`.

---

## Bloque 4 — Tests de requisito (todos `[P]` entre si; dependen de T2.x/T3.1)

- [x] **T4.1** `agregado-tasas.test.ts` — **R2** (el central), R4, R6, R7.
      **HECHO:** el caso de R2 usa **volumenes desiguales por dia** (dia 1: 1 entrega de 1 gestion;
      dia 2: 9 entregas de 99 gestiones) y afirma **las dos cosas**:
      `toBeCloseTo(0.10, 10)` **y** `not.toBeCloseTo(0.5455, 2)`. Con datos equilibrados el test
      pasaria con la implementacion mala; el revisor debe poder ver la desigualdad en los datos.
      La mutacion de R2 (promediar los valores diarios) lo pone rojo.
      ⚠ **BLINDADO por decision del humano** (`requirements.md §4.1`): **la doble asercion es
      obligatoria**. Afirmar solo `0,10` no basta — sin negar explicitamente `0,5455`, una
      implementacion que devolviera otra cosa parecida pasaria.

- [x] **T4.2** `agregado-tiempo-ciclo.test.ts` — **R3**.
      **HECHO:** los dos cubos estan en **DIAS DISTINTOS** (`2026-08-01` con 1000 s / 1 orden y
      `2026-08-02` con 100 s / 9 ordenes → correcto 110; media de medias 505,6), con la misma doble
      asercion.
      ⚠ **BLINDADO e INNEGOCIABLE** (`requirements.md §4.1`): el test existente
      `operativa-tiempo-ciclo.test.ts:22-29` usa dos **zonas del MISMO dia**, caso que la 126 **ya
      resuelve bien**. Quien copie ese test creera haber probado algo sin haberlo probado. Si los
      dos cubos de este test comparten `fecha`, la task **no esta hecha**.

- [x] **T4.3** `agregado-contrato.test.ts` — R1, R5.
      **HECHO:** afirma `JSON.stringify(respuesta)` sin lanzar y `typeof numerador === "number"`
      con un `segCicloAcum` grande (`BigInt("9007199254740993")`).

- [x] **T4.4** `agregado-coherencia.test.ts` — **R8, el ancla**.
      **HECHO:** misma `ConsultaAnalitica` de un unico dia cerrado servida por `consultar` y por
      `consultarAgregado`; los valores coinciden con `toBeCloseTo(…, 10)` para las cinco metricas.
      ⚠ **BLINDADO** (`requirements.md §4.1`): el test debe usar **el mismo doble de repositorio**
      para los dos caminos, porque es eso —mismos cubos, misma clave— lo que hace la igualdad
      **estructural** y no una coincidencia. Es lo que impide que el agregado **derive de la serie**
      con una formula paralela sin que nadie lo note.

- [x] **T4.5** `agregado-cobertura.test.ts` — R9; `agregado-dia-en-curso.test.ts` — R10.
      **HECHO:** cobertura presente con `fechasNoComparables` no vacio sobre un rango que cruza el
      horizonte; y los dos casos de parcialidad (con hoy / sin hoy).

- [x] **T4.6** `agregado-aging.test.ts` — R11.

- [x] **T4.7** `agregado-metricas-admitidas.test.ts` — R12.
      **HECHO:** `ordenes_por_estado` devuelve `validation_error` y el repositorio recibe **cero**
      llamadas (se cuenta con `rollupFalso().llamadasAgregar`).

- [x] **T4.8** `agregado-identidad.test.ts` — R15; `agregado-action.test.ts` — R14.
      **HECHO:** el test de R14 **espia el logger**, no el status (la trampa verificada de
      `lib/actions/analitica-operativa.ts:38-42`).

> Todos los tests de este bloque construyen la consulta con `consultaDe(...)` de
> `tests/unit/analytics/_fake-operativa.ts`, **por el camino real** `prepararConsultaAnalitica`.
> Un `as ConsultaAnalitica` esta prohibido (forja la marca de la 122).

---

## Bloque 5 — Guardias

- [x] **T5.1** `agregado-alcance.guardia.test.ts` (**perenne**) — R13, R16, R17 y el censo de
      `app/api`, cada assert con su **caso discriminante**.
      *Depende de: T3.1.*
      **HECHO:** los cuatro censos verdes y los cuatro discriminantes cazan su fragmento infractor
      sintetico.

- [x] **T5.2** `agregado-frontera.guardia.test.ts` (**caduca**) — R18: el diff contra `origin/dev`
      no toca ningun archivo fuera de la lista de `design.md §1`.
      *Depende de: T5.1.*
      **HECHO:** la cabecera contiene, literal, el parrafo de caducidad de `design.md §8.2`; el test
      falla si se toca `lib/analytics/metrics.ts`; y **no** contiene ningun assert que deba
      sobrevivir al merge (comprobado leyendo el archivo: todo lo perenne esta en T5.1).

- [x] **T5.3** Comprobar que **ningun guardia existente** cuelga del que caduca ni queda roto.
      *Depende de: T5.2. `[P]` con T6.1.*
      **HECHO:** `pnpm run test:guardias` verde y anotado en `progress/impl_176.md` el conteo de
      archivos de guardia antes/despues (no debe bajar).

---

## Bloque 6 — Cierre

- [x] **T6.1** `agregado-semana.test.ts` — **R19** (D6): el grano `semana` ancla en el **mismo
      lunes** que el preset `semana` de `lib/analytics/ranges.ts`, y el grano `periodo` produce un
      unico cubo con los extremos del rango.
      **HECHO:** coinciden para al menos un domingo, un lunes y un cambio de ano; la mutacion de R19
      (anclar en domingo) lo pone rojo. Sin este test, las dos definiciones de «lunes» del repo
      —la del servicio y `lunesDeLaSemana` de la 131— se desincronizan sin que nada avise.

- [x] **T6.2** `progress/impl_176.md` con: archivos tocados, mapa `R<n> → test`, **la tabla de
      mutaciones aplicadas con el test que murio en cada una**, y la salida real de los tests.
      *Depende de: todo el bloque 4 y 5.*
      **HECHO:** los **19** requisitos aparecen, cada uno con test y mutacion verificada.

- [x] **T6.3** Declarar en `progress/impl_176.md` la deuda de `lunesDeLaSemana` (`design.md §6.1`)
      y la divergencia observada y **no corregida** del catalogo (`design.md §1.3`, para la 175).
      *`[P]` con T6.2.*
      **HECHO:** ambas escritas con ruta y linea.

- [ ] **T6.4** Gate completo y PR.
      *Depende de: T6.2.*
      **HECHO:** lo corre el **leader**, no el subagente (`AGENTS.md > Regla del gate`):
      `./init.sh` completo verde, merge de `origin/dev` resuelto, `gh pr create --base dev`, URL
      reportada. **En la descripcion del PR: recordar la retirada de `agregado-frontera.guardia.test.ts`.**
