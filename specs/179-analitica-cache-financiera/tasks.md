# 179 — analitica: cache financiera + invalidacion por ledger · tasks

> **PUERTA T0 CERRADA el 2026-08-10** con D1–D4 (`requirements.md` § «Decisiones D1–D4»): tag de
> dominio (D1), backfill de tesoreria por el job de la 128 sin migracion (D2), `conciliacion_cierres`
> nunca se cachea (D3), fallo de invalidacion posterior al commit no se propaga (D4). **T1 puede
> empezar.** Las tasks de abajo ya estan escritas para esas respuestas.
>
> **Cada task lleva su criterio de HECHO y de NO HECHO.** El de «NO hecho» no es decorativo: es la
> forma concreta de auto-engaño que esa task admite. Un commit por task (`docs/conventions.md`).
>
> `[P]` = paralelizable con las otras `[P]` del mismo bloque.

---

## T0 — La puerta (CERRADA)

**T0.1 — ✅ HECHA (2026-08-10).** Las cuatro decisiones estan escritas como **D1–D4** al final de
`requirements.md`, con su motivo y **con las alternativas descartadas y su coste**, y propagadas a
R2, R5, R6, R7, R16, R17, R26, R27 y R28.
Requisitos: todos.
- **Hecho:** ademas de las respuestas, esta escrito **que requisito cambia por cada una**. El
  implementer no tiene que deducirlo.
- **NO hecho:** dejarlas solo en el chat del coordinador. Una decision que no esta en disco no
  existe (CLAUDE.md, regla 3) — por eso viven en el spec y no en un mensaje.

**T0.2 — Medir el baseline en `C:/w179`, no heredarlo.**
Depende de: nada. `[P]` con T0.1.
- **Hecho:** `./init.sh` corrido en la rama ANTES de tocar nada, con su salida guardada en
  `progress/current.md`; el criterio de cierre de la feature es **delta 0** contra ESA medicion.
- **NO hecho:** citar el baseline de la bitacora o el de otra rama.

---

## T1 — Los cimientos (puros, sin escritores todavia)

**T1.1 [P] — `lib/analytics/cache-tags.ts`: anadir `TAG_FINANCIERA` / `TAGS_FINANCIERA`.**
Depende de: T0.1 (D1). Requisitos: **R6**.
- **Hecho:** los dos salen de `tagDeDominio("financiera")`; `tests/unit/analytics/cache-tags.
  guardia.test.ts` ampliado al segundo literal y verde; no aparece la cadena `"analitica:
  financiera"` en ningun archivo nuevo.
- **NO hecho:** un modulo de tags nuevo al lado del de la 128 (dos listas divergen), o el literal
  escrito «solo en el test».

**T1.2 [P] — `lib/analytics/cache-clave-financiera.ts`.**
Depende de: T0.1. Requisitos: **R5**.
- **Hecho:** `claveFinanciera(c)` compone `claveDeConsulta(c, [])` con el prefijo de dominio;
  `cache-financiera-clave.test.ts` verde con los cuatro casos (alcance, preset, orden de ids,
  no-colision con operativa); el modulo es puro (sin Next, sin Prisma, sin `process.env`).
- **NO hecho:** copiar la logica de `claveDeConsulta` en vez de componerla. Dos definiciones de
  «que consultas son la misma» divergen sin que nada falle.

**T1.3 [P] — Ampliar `OrigenInvalidacion` en `lib/interfaces/external/IAnaliticaCache.ts`.**
Depende de: T0.1. Requisitos: **R24**.
- **Hecho:** un valor por escritor, union literal cerrada, con un comentario que diga por que hay
  uno por escritor y no uno global.
- **NO hecho:** `string`, o un solo valor `"ledger"` para los siete. Con eso el registro no puede
  decir CUAL invalidador no llego, que es lo unico para lo que existe.

**T1.4 — `lib/analytics/invalidacion-financiera.ts`.**
Depende de: T1.1, T1.3. Requisitos: **R7**, **R21**, **R16**.
- **Hecho:** una sola funcion `invalidarAnaliticaFinanciera(cache, origen)`; no importa
  `next/cache`; `cache-aislamiento.guardia.test.ts` (128) sigue verde; su cabecera **declara por
  escrito la desviacion de R11 de la 128** (D4) con el motivo: alli el llamador era un job
  idempotente con backoff, aqui es una accion de usuario sobre dinero ya confirmado.
- **NO hecho:** que un escritor construya el array de tags por su cuenta. Y **NO hecho** tambien si
  la desviacion no queda escrita en el codigo: una contradiccion silenciosa entre dos specs es peor
  que la propia desviacion.

**T1.5 [P] — `lib/analytics/cache-politica-financiera.ts` (D3).**
Depende de: T0.1. Requisitos: **R28**.
- **Hecho:** politica **exhaustiva por metrica**, con `conciliacion_cierres` marcada no cacheable y
  causa `alerta_por_consulta` de un dominio **cerrado**; claves `string` (no `Record` cerrado, para
  que el cuadre lo mida un test y no el compilador — precedente:
  `AnaliticaFinancieraService.ts:70-75`).
- **NO hecho:** una lista de exclusiones o un allowlist a secas. Con cualquiera de los dos, una
  metrica futura queda cacheada (o sin cachear) **por defecto** y «excluida a proposito» deja de
  distinguirse de «se me olvido». Ese es literalmente el punto de esta task.

---

## T2 — El decorador de lectura

**T2.1 — `lib/services/CachedAnaliticaFinancieraService.ts` + `decorarFinancieraConCache`.**
Depende de: T1.2, T1.4, T1.5. Requisitos: **R1, R2, R4, R22, R28**.
- **Hecho:** `cache-financiera-decorador.test.ts` verde con: consulta de metrica no cacheable que
  **ni lee ni escribe** la cache (R28, paso 0 de `design.md §3`); segunda consulta equivalente sin
  tocar repositorios (R2); `dominio_invalido` y fallo de repositorio sin dejar entrada (R4); bandera
  apagada devuelve el servicio DESNUDO (R22, patron de `decorarRollupConCache`).
- **NO hecho:** un decorador que «no sirve desde cache» pero sigue escribiendo entradas con la
  bandera apagada. Eso es un placebo, no un kill-switch.

**T2.2 — Equivalencia de las ocho metricas.**
Depende de: T2.1. Requisitos: **R1**.
- **Hecho:** `cache-financiera-equivalencia.test.ts` compara, **metrica a metrica** y con igualdad
  profunda, el DTO servido desde cache y el servido sin cache. Las ocho, enumeradas desde
  `listarMetricas({ dominio: "financiera" })` y no a mano.
- **NO hecho:** probar dos metricas «representativas». `cod_recaudado` trae dos vistas y
  `conciliacion_cierres` tiene otra forma de resultado: un muestreo las pierde.

**T2.3 — JSON-safety: el guardia que ocupa el sitio del codec.**
Depende de: T2.1. Requisitos: **R3**.
- **Hecho:** round-trip real de las ocho metricas + guardia estatico sobre
  `lib/types/analitica-financiera.ts` que falla si aparece un campo `Date`/`bigint`/`Map`/`Set`/
  `Decimal`. El guardia declara en su cabecera **que aqui nada lanza** y por eso existe.
- **NO hecho:** dar por buena la JSON-safety porque hoy lo es. Es la unica prueba que atrapa un
  campo futuro que degrade en silencio.

**T2.5 — La exclusion de `conciliacion_cierres`, probada sobre el COMPORTAMIENTO (D3).**
Depende de: T2.1. Requisitos: **R28**. `[P]` con T2.2 y T2.3.
- **Hecho:** `cache-financiera-conciliacion.test.ts` verde con las dos aserciones: dos consultas
  identicas **consultan la base las dos veces**, y el aviso de descuadre **se emite en las dos**
  (`ErrorLogger` doble, umbral rebasado). Ademas
  `cache-financiera-politica.guardia.test.ts` cuadra la politica con el catalogo **por exceso y por
  defecto**, con mensaje que obliga a elegir para una metrica nueva.
- **NO hecho:** probar la exclusion solo leyendo la constante de la politica. Eso comprueba que
  alguien escribio `cacheable: false`, no que el decorador lo respete. La asercion que impide el
  «ya que estamos, cacheemos tambien esta» es la del **contador de emisiones del logger**.

**T2.4 — Cablear el composition root.**
Depende de: T2.1. Requisitos: **R20, R22**.
- **Hecho:** solo `construirServicio` de `lib/actions/analitica-financiera.ts` cambia;
  `consultarMetricaFinanciera` intacta; `cache-financiera-frontera.test.ts` verde (aridad y tipo de
  retorno).
- **NO hecho:** tocar el cuerpo de la accion, o pre-parsear el filtro «de paso».

> **A partir de aqui el guardia de D2 esta rojo** (T2.1 nombra `AnaliticaFinancieraService` y llama
> a `.envolver(`). **Es lo correcto y no se toca todavia**: se retira en T5.1, cuando los siete
> escritores esten verdes. Ver `design.md §7`.

---

## T3 — Los escritores. Uno por task, uno por test.

> **Ocho puntos de escritura, ocho tasks**: T3.1–T3.7 son los siete que corren dentro de un request
> e invalidan directamente; T3.8/T3.9 son el octavo (el backfill de tesoreria), que **encola** porque
> corre fuera de Next (D2, `design.md §5.4`).
>
> T3.1–T3.7 dependen de T1.4. Todas siguen el patron de cinco pasos (`design.md §11`) con **cache
> falsa de semantica de tags real**, nunca un mock de llamadas. Todas: el escritor recibe
> `IAnaliticaCache` por constructor con default `cacheNula()` y su composition root pasa el real.
>
> **Criterio de NO hecho comun a T3.1–T3.9:** un test que asserte «se llamo a `invalidar`» (o a
> `enqueue`). Eso prueba que alguien escribio la linea, no que la cifra servida cambie. El paso 5 se
> afirma sobre el **dato**.
>
> **Y criterio de NO hecho de todo el bloque: cerrarlo con siete de ocho.** Ese es el fallo que esta
> feature existe para impedir, y por eso el censo de T4 depende de las ocho.

**T3.1 [P] — `WalletEgresoService`.** Requisitos: **R9**.
- **Hecho:** `cache-financiera-escritor-egreso.test.ts` cubre `registrarEgreso` **y**
  `reversarEgreso`; borrar la invalidacion pone rojo **este** test y ninguno de los otros siete.
- **NO hecho:** cubrir solo `registrarEgreso`. El reverso mueve dinero igual.

**T3.2 [P] — `WalletService.registrarMovimientoManual`.** Requisitos: **R10**.
- **Hecho:** `cache-financiera-escritor-manual.test.ts` verde, y el registro de `escritores-ledger.
  ts` lo nombra.
- **NO hecho:** saltarselo por no estar en la ficha. **Es el hallazgo de §0.a**: sin el, esta
  feature reintroduce exactamente el fallo que D2 rechazo.

**T3.3 [P] — `LiquidacionService`.** Requisitos: **R11**, **R8**.
- **Hecho:** `cache-financiera-escritor-liquidacion.test.ts` cubre pago a mensajero, pago a tienda y
  anulacion; la invalidacion ocurre **tras** el `$transaction`, y
  `cache-financiera-invalidacion-orden.test.ts` lo demuestra con un doble que registra el orden de
  los eventos.
- **NO hecho:** invalidar dentro de la tx. Nada falla en el test feliz y abre la ventana de R8.

**T3.4 [P] — `GeneracionGastosFijosService` (cron).** Requisitos: **R12**.
- **Hecho:** cinco pasos contra `handleGenerarGastosFijos` real, mas el caso «cero egresos
  generados no invalida».
- **NO hecho:** invalidar siempre. Vaciar la cache financiera cada madrugada sin haber movido
  dinero es coste sin motivo, y el segundo test existe para eso.

**T3.5 [P] — Indemnizacion de incidente (`IncidenteAdminService`).** Requisitos: **R13**.
- **Hecho:** cinco pasos en la rama `aprobado` con egreso emitido, mas «rechazo y reintento ya
  aplicado (`no_aplicado`) no invalidan».
- **NO hecho:** enganchar la invalidacion en `IncidenteAdminRepository`. Esta dentro de su
  `$transaction` (R8) y un repositorio no conoce la cache.

**T3.6 [P] — `aprobarCierre` (`CierresAdminService`).** Requisitos: **R14**.
- **Hecho:** cinco pasos, con las tres escrituras de ledger que la aprobacion emite.
- **NO hecho:** compartir test con T3.7.

**T3.7 [P] — `aprobarCierreBodega` (`CierresBodegaAdminService`).** Requisitos: **R15**.
- **Hecho:** cinco pasos, en su propio archivo.
- **NO hecho:** darlo por cubierto porque «es igual que el de dia». Es otro servicio, otro archivo,
  otra llamada que alguien puede olvidar.

**T3.8 — El handler del job lee el dominio del payload (D2).** Requisitos: **R27**.
Depende de: T1.1. **No es `[P]` con T3.9: T3.9 la necesita.**
- **Hecho:** `analitica-invalidacion-cache-handler.ts` invalida el tag del `dominio` del payload,
  **con `operativa` como default explicito**; el `dedupeKey` de
  `analitica-invalidacion-encolado.ts` incorpora el dominio; y —la parte que importa—
  **`tests/unit/analytics/cache-invalidacion-backfill.test.ts` de la 128 sigue verde SIN
  modificarlo**.
- **NO hecho:** tocar ese test de la 128 para que pase. Es el **testigo** de la compatibilidad hacia
  atras: si hay que editarlo, es que los jobs ya encolados dejaron de invalidar. Y **NO hecho** si el
  `dedupeKey` no distingue dominio: dos backfills en la misma ventana se deduplicarian entre si y
  una invalidacion desapareceria en silencio (`ON CONFLICT DO NOTHING`).

**T3.9 — El octavo escritor: `scripts/backfill-caja-tesoreria.ts` encola (D2).** Requisitos: **R26**.
Depende de: T3.8.
- **Hecho:** al cerrar una corrida en modo `aplicar` **con al menos una fila insertada**, encola el
  job con `{ dominio: "financiera" }`; `backfill-caja-tesoreria-invalidacion.test.ts` verde con los
  tres casos (inserta → encola una vez; en seco → nada; cero pendientes → nada); y
  `cache-financiera-invalidacion-backfill.test.ts` demuestra los **cinco pasos con el drenado real
  del job**, no con un espia del `enqueue`.
- **NO hecho:** llamar a `revalidateTag` desde el script. **Lanza** fuera de un request
  (`revalidate.js:104-107`) y el fallo aparecería en la corrida de mantenimiento, no en el gate, que
  es donde peor se descubre. **NO hecho** tambien si el test se queda en «se llamo a `enqueue`»: eso
  no prueba que la cifra servida cambie.

**T3.10 — Registro y fallo de invalidacion (D4).** Depende de: T3.1–T3.9. Requisitos: **R16, R24**.
- **Hecho:** `cache-financiera-registro.test.ts` comprueba que **cada uno de los ocho** escritores
  registra **su** origen y que el registro no lleva ids de tienda, mensajero, cierre ni usuario;
  `cache-financiera-invalidacion-fallo.test.ts` verde con los tres casos de D4(a): la aprobacion
  **no** se convierte en fallo, queda constancia con su origen, y el dinero escrito sigue escrito.
- **NO hecho:** propagar el error al usuario (mentir sobre una operacion confirmada) **ni** un
  `catch` vacio (callar sobre la cache). Los dos extremos tienen su test, y los dos son rojo.
- **Ojo al limite del alcance de D4:** en **T3.8/T3.9** el llamador es un **job**, y ahi **R11 de la
  128 sigue aplicando**: una invalidacion fallida DEBE hacer fallar el job. Si el implementer
  aplicara D4 tambien ahi, perderia el reintento con backoff que la cola regala.

---

## T4 — El censo

**T4.1 — `lib/analytics/escritores-ledger.ts`: el registro declarado.**
Depende de: T3.1–T3.9. Requisitos: **R17, R18**.
- **Hecho:** una entrada por punto de escritura (**los ocho** de `requirements.md §0.a`, incluido el
  backfill de tesoreria, cuyo invalidador es el job de R27 y no una llamada directa), cada una con
  el archivo escritor, el modulo que invalida, el origen y **el archivo de test** que lo cubre.
- **NO hecho:** una entrada sin test, o una entrada «pendiente». El registro es una prueba, no una
  lista de intenciones.

**T4.2 — `tests/unit/analytics/ledger-escritores.guardia.test.ts`.**
Depende de: T4.1. Requisitos: **R17, R18**.
- **Hecho:** los dos ejes (escritura cruda ⊆ los tres repositorios; llamadores de `crearMovimientos`
  == claves del registro, **en las dos direcciones**); un test de discriminacion con un fragmento
  sintetico que demuestra que un escritor nuevo lo pone rojo; cada entrada nombra un test que
  existe; mensaje de fallo que **enumera** los escritores y dice que hacer. Cabecera que declara que
  **sobrevive al merge** (no mide diff) y que es el heredero de **D2 de la 128**.
- **NO hecho:** un guardia que solo compruebe una direccion. Con solo «todo registrado existe», un
  escritor nuevo pasa; con solo «todo escritor esta registrado», el registro acumula muertos.

**T4.3 — Censo de TTL y de literales, ampliados.**
Depende de: T2.1. Requisitos: **R6, R23**. `[P]` con T4.2.
- **Hecho:** `cache-config.guardia.test.ts` y `cache-tags.guardia.test.ts` (128) ampliados al ambito
  nuevo y verdes; no existe una segunda constante de TTL.
- **NO hecho:** ampliar el censo del TTL a **todo el arbol**. `3600` ya aparece cuatro veces en
  `lib/` por motivos ajenos (`lib/auth/google-sa-token.ts:42`, `google-adc-token.ts:28`,
  `lib/config/etiquetas.ts:52` y `:69`): naceria rojo y se desarmaria a la primera.

---

## T5 — La retirada, y solo entonces

**T5.1 — Borrar `tests/unit/analytics/cache-financiera.guardia.test.ts` (R15 / D2 **de la 128**).**
Depende de: **T3.1 a T3.10 verdes y T4.2 verde. De ninguna otra forma.** Requisitos: **R19**.
- **Hecho:** el archivo ya no existe; `ledger-escritores.guardia.test.ts` comprueba **por sistema de
  archivos** que el guardia de D2 de la 128 no esta y que el censo si; el commit cita esa decision y
  `design.md §7`.
- **NO hecho:** borrarlo antes para «desbloquear» el trabajo. Ese es literalmente el error que esta
  feature existe para no cometer: un PR que retira el guardia sin la invalidacion completa deja el
  agujero abierto y en silencio.
- **Ojo:** el trabajo de T3.8/T3.9 (el job) **no dispara** ese guardia —no nombra el servicio ni sus
  repositorios—, asi que aterrizaria «limpio» por separado. **No se parte la tanda:** encolar
  invalidaciones para una cache que no existe es codigo muerto, y partirla multiplica la posibilidad
  de que la mitad que retira el guardia llegue sin la mitad que invalida (`design.md §7`).

**T5.2 — Guardia de frontera de archivos (branch-scoped).**
Depende de: T5.1. Requisitos: **R25**.
- **Hecho:** `cache-financiera-frontera.guardia.test.ts` mide el diff contra `origin/dev` y compara
  con la lista de `design.md §2`; su cabecera declara **que caduca al mergear y que se retira en
  este mismo PR**, y T5.3 lo retira.
- **NO hecho:** dejarlo vivo tras el merge. Pasaria a juzgar toda rama posterior y se convertiria en
  un impuesto sobre features ajenas (leccion del repo; la 128 hizo lo mismo con el suyo).

**T5.3 — Retirar el guardia branch-scoped.**
Depende de: T5.2 verde. Requisitos: **R25**.
- **Hecho:** borrado, con el comentario del commit como constancia de que cumplio su funcion.
- **NO hecho:** «lo quitamos cuando duela».

---

## T6 — Cierre

**T6.1 — Mapa `R<n> → test` completo.**
Depende de: T5.3. Requisitos: todos.
- **Hecho:** `progress/impl_179-analitica-cache-financiera.md` con **cada** requisito mapeado a un
  test concreto que existe y pasa. Ningun requisito sin test (CLAUDE.md, regla 4).
- **NO hecho:** un requisito mapeado a «la suite en general».

**T6.2 — `./init.sh` completo.**
Depende de: T6.1. Requisitos: todos.
- **Hecho:** corrida completa (no `--rapido`) con **delta 0** contra la medicion de T0.2, y las
  guardias todas verdes. El `--rapido` vale para cerrar tandas intermedias, no para el PR.
- **NO hecho:** comparar contra el baseline de la bitacora, o cerrar con «los rojos ya estaban».
  Se mide en esta rama, hoy.
