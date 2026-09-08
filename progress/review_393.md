# Revision de la ficha 393 — el cierre de bodega en dos cascadas

> Reviewer. No edito codigo. Rama revisada: `dev` @ `88ce9977` (servidor PR #737 + pantalla PR #739).
> Worktree propio, `pnpm install` real (no junction: hay otra sesion viva sobre la misma base local).
> **AVISO — el MCP `codebase-memory` NO esta operativo en esta sesion.** Sus herramientas figuran en
> el catalogo, pero la llamada devuelve `No such tool available`. Toda la busqueda se hizo con `grep`,
> `git grep` (tambien contra commits anteriores) y lectura del archivo real, y se dice aqui como manda
> la regla 7 de `CLAUDE.md`.

## VEREDICTO: RECHAZADO

El codigo es correcto: **no encontre ni un solo punto del camino donde el negativo se recorte,
se esconda o se trate como fallo**, la linea puente se emite siempre y el dinero viaja como STRING
de punta a punta. El gate completo termina en verde con la base de datos realmente ejercitada.

Lo que lo tumba son **cuatro bloqueantes**, y tres de ellos son *redes que no muerden*, medidos con
mutaciones propias que **sobrevivieron**. Ninguno exige tocar produccion: dos son lineas de test,
uno es una tarea humana de diez minutos y el cuarto es marcar casillas.

---

## 1 — Verificacion ejecutable (la que corri yo)

`./init.sh` **completo**, con el `.env` copiado de la raiz antes y borrado despues, log propio
(`/tmp/gate-393-review-aad2f6.log`), sin `tail` en la tuberia y con `INIT_EXIT=$?` escrito DENTRO:

```
feature_list.json: sin ids duplicados (389 fichas), cupo por zona respetado (in_progress=2)
typecheck paso
lint paso   -> 161 problems (0 errors, 161 warnings)
DATABASE_URL resuelta: los 134 archivos de tests contra Postgres SI se ejecutan
Test Files  1787 passed (1787)
Tests  25580 passed | 26 skipped (25606)     Duration 944.17s
tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1787 ejecutado(s), todos en el baseline)
! migraciones sin down.sql: 20260814120000_... 20260814140000_... 20260814160000_...  (preexistente)
.env presente
== init OK ==
INIT_EXIT=0
```

- **Los 26 `skipped` son exactamente los conocidos**: 17 en `AnaliticaPage.test.tsx` y 9 en
  `AnaliticaShell.test.tsx`, los dos `describe.skip`/`it.skip` de Analitica. **Ni uno mas**, o sea
  que no hubo el deadlock `40P01` ni ningun archivo caido a mitad pese a la otra sesion en marcha.
- **Cero contencion medida**: no hubo ningun rojo raro en `integration/db` que aislar.
- El `.env` se borro al terminar y el arbol quedo limpio (`git status --short` vacio).

---

## 2 — Checklist de CHECKPOINTS.md, punto por punto

| Punto | Estado |
| --- | --- |
| `specs/393-*/requirements.md` con EARS numerados | **OK** — 39 requisitos, R1–R39 |
| `design.md` con alternativa descartada y su porque | **OK** — seccion 8, ocho alternativas (A1–A8) |
| `tasks.md` con **todas** las tasks `[x]` | **FALLA** — 0 de 35 marcadas (ver BLOQUEANTE 4) |
| Cada `R<n>` mapea a al menos un test concreto | **FALLA en R25** (ver BLOQUEANTE 2); parcial en R14 (BLOQUEANTE 1) |
| `progress/impl_393.md` contiene el mapa `R<n> -> test` | **OK** — en las dos bitacoras, y se reparten los 39 |
| `pnpm run typecheck` | **OK** |
| `pnpm run lint` | **OK** — 0 errores |
| `pnpm test` | **OK** — 1787/1787 archivos, 0 rojos nuevos |
| E2E para flujo critico | **INAPLICABLE** — este repo no tiene arnes E2E ejecutable; el sustituto que el propio spec define es **V2**, y V2 no esta hecho (BLOQUEANTE 3) |
| RLS en tablas nuevas | **N/A** — cero tablas, cero migraciones (verificado: `git diff --name-only 6fd97d06 HEAD -- db/` vacio, R28) |
| Migraciones reversibles con `down.sql` | **N/A** — no hay migracion. El aviso de tres `down.sql` que faltan es preexistente, de rutas de agosto |
| Sin secretos hardcodeados | **OK** |
| Webhooks con firma e idempotencia | **N/A** — la ficha no toca webhooks |
| Controller sin queries ni logica | **OK** |
| Service sin HTTP | **OK** — `CierresBodegaAdminService` no ve Request/Response |
| Repository solo queries | **OK, con matiz** — `toBodegaResumenRow` **deriva** llamando a funciones puras de `lib/utils/`. Es la decision central del diseno (una sola derivacion para las 8 lecturas) y no escribe ni una resta a mano. Lo doy por bueno |
| Interfaces en `lib/interfaces/` por categoria | **OK** |
| Paginas protegidas validan permisos en servidor | **OK** — `verCierreBodegaDetalle` corta con `esAccesoTotal(actor.rol)` antes de consultar; es lo que hace cumplir R39 |
| Componentes `private/` reciben datos por props | **OK** |
| Mutaciones internas por Server Actions | **N/A** — la ficha no muta nada |
| Sin hardcodear pais/moneda/cuenta | **OK** — todo el formato pasa por `lib/config/moneda` |
| `./init.sh` en verde | **OK** — `INIT_EXIT=0`, medido por mi |
| `progress/review_<feature>.md` con veredicto OK | este archivo: **RECHAZADO** |
| Entrada en `progress/history.md` | **FALTA** — no hay ninguna linea de la 393 (menor m5) |

---

## 3 — Lo que SI esta bien, y lo verifique yo

### El negativo, punto por punto del camino (prioridad 2 del encargo)

Recorri los **cinco** puntos y no hay recorte, valor absoluto, ocultacion ni tratamiento de fallo:

| Punto | Que hace | Evidencia |
| --- | --- | --- |
| funcion pura | `paraLaCentral()` = `Decimal.minus().minus().toFixed(2)`, con el caso negativo escrito en el docstring | `lib/utils/ingreso-ordenex.ts:426-436` |
| mapper | `toBodegaResumenRow` llama a la pura y emite el STRING tal cual | `lib/repositories/CierreBodegaRepository.ts:110-113` |
| servicio | el agregado devuelve `resumen.paraLaCentral`; cada dia, el suyo | `lib/services/CierresBodegaAdminService.ts:315-330, 380-386` |
| descarga | `paraLaCentral: cierre.paraLaCentral` en las tres proyecciones, sin tocar | `cierres-bodega-descarga-columnas.ts:102,133,191` |
| tarjeta | `money()` conserva el signo; `destacado && esMontoNegativo -> text-danger-strong`; nota propia | `cierre-factura.tsx:481-492, 841-856` |
| detalle | idem, via `CascadaDinero`; el tono solo al resultado | `CascadaDinero.tsx:79-125` |

Y **no se trata como fallo**: ni `try`, ni aviso de error, ni fila oculta. Lo confirme con mi
mutacion **MR2** (el mapper devuelve el valor absoluto): **muere**, con
`expected  1000.05  to be  -1000.05 ` en `cierre-bodega-repository.test.ts`.

### La linea puente `cobradoSobreRecaudado` (prioridad 3)

Se emite **siempre**, sin ninguna rama que la omita, en los tres sitios donde nace:

- servidor, agregado y por `cierre_dia`: `CierresBodegaAdminService.ts:315-322` y `:380-384` —
  ninguna condicional;
- pantalla: `lineasCascadaDueno` la mete en el array sin `if`
  (`CierresBodegaAdminModule.tsx:255-262`).

El test que lo sujeta (`CierreBodegaDetalleCascadas > la linea puente sale TAMBIEN con el flete por
rechazo en cero`) muerde: la mutacion declarada **M4** lo pone rojo, y ademas
`cierres-bodega-admin-service.test.ts` caso 3 (c) lo comprueba en el servidor.

### El dinero como STRING (prioridad 4)

En el camino del importe **no hay** `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` fuera de
la frontera `Decimal -> STRING`. Verificado por lectura en `ingreso-ordenex.ts`,
`CierreBodegaRepository.ts`, `CierresBodegaAdminService.ts`, `cierres-bodega-descarga-columnas.ts`,
`CascadaDinero.tsx` y `cierre-factura.tsx`. **Pero la guardia que deberia sostenerlo no cubre todo** —
ver BLOQUEANTE 1.

### Las trampas medidas del repo

- **El censo de `DineroIdentidadesEnPantalla` se AMPLIO, no se relajo.** Diff de 13 a 15: las trece
  entradas siguen ahi, se anaden `CascadaDinero.tsx` y `CierresBodegaAdminModule.tsx`, y los dos
  casos nuevos (B4 y B5) leen el DOM y parsean a `bigint` con su propio parseador. **No es una
  asercion contra su propia fuente**: los esperados son literales calculados a mano.
- **`cierres-bodega-admin-service.test.ts` y `cierre-bodega-repository.test.ts`** ponen los
  esperados como literal, nunca llamando a la funcion que el codigo usa. Correcto.
- **Ningun `if (!x) return;`**: los tests nuevos no tienen salidas tempranas que los dejen verdes
  sin comprobar nada.
- **El test que vive dentro de lo que se borra: comprobado y VACIO de verdad.** Corri
  `git grep` de los cinco `aria-label` retirados y sus gemelos `· <mensajero>` **contra el commit
  base** (`4c804490~1`): cero apariciones en `tests/` y `e2e/`. La afirmacion de T0.4 (backend) y su
  re-verificacion (frontend) son **ciertas**. F7 sin trabajo, con motivo.
- **El composition root SI inyecta**: las dos listas pasan `cierre={c}` con la fila del servidor
  (`CierresBodegaSolicitadosLista.tsx:136`, `CierresBodegaResueltosLista.tsx:141`), y
  `ConsolidacionBodegaModule.tsx:442,450` monta de verdad la lista de la satelite. `CierreBodegaService`
  devuelve las filas del repositorio **sin recomponerlas**, asi que la satelite hereda el campo.

---

## 4 — Las dos declaraciones del implementador que habia que verificar

### (a) «`tasks.md` F6 caso 2 contradice el diseno». **TIENE RAZON.**

`design.md` seccion 3 y seccion 4 ponen a proposito «Pago a mensajeros» y «Gana la bodega satelite»
como sustraendos de **las dos** cascadas — el mismo dinero contestando dos preguntas distintas. Y el
texto de R2 no dice lo que `tasks.md` resumio: dice *«NO DEBE mezclar lineas de las dos cascadas
**en una misma region**: ninguna linea puede pertenecer a las dos a la vez **en la misma region**»*.
O sea, la restriccion es intra-region, no global. El test que escribio —regiones como subarboles
disjuntos, y ninguna contiene el RESULTADO de la otra ni la linea puente— **es la lectura correcta**
del requisito, y ademas muerde (mutacion declarada M12: 16 rojos).

### (b) «`GANANCIA_NOTA_BODEGA` queda sin consumidor». **ES CIERTO — y se quedo corto.**

Confirmado: `GANANCIA_NOTA_BODEGA` (`cierre-detalle-shared.tsx:337`) solo aparece en su propia
declaracion y en la regex de la guardia G2. Constante muerta, no arrastra nada.

**Lo que la bitacora NO dijo, y es mas gordo:** `MontoDerivadoCard` (`cierre-detalle-shared.tsx:626`)
tambien quedo **sin un solo consumidor**. Medido:

- antes de la ficha tenia **exactamente uno**, `CierresBodegaAdminModule.tsx` (6 usos, verificado con
  `git grep MontoDerivadoCard 4c804490~1`);
- hoy `git grep` en `app`, `lib`, `tests` y `components` devuelve **solo la declaracion**.

Y `progress/impl_393_frontend.md:61-62` afirma lo contrario con todas las letras:

> «`MontoDerivadoCard`, `PagoMensajeroTotal` e `IngresoBodegaRechazosTotal` **siguen exportados y
> siguen montados por el detalle del cierre de mensajero** (R30).»

Dos errores en esa frase: `MontoDerivadoCard` **no lo monta nadie**, y los otros dos los monta
`ConsolidacionBodegaModule.tsx:342,349` —la pantalla de consolidacion de la satelite—, **no** el
detalle del cierre de mensajero (ese usa `TarjetaTotal`/`Renglon`, que viven en `cierre-factura.tsx`).
El criterio de HECHO de la tarea F5 esta escrito contra esa premisa falsa, asi que **F5 no cumple su
propio criterio**. R30 en si **no se rompe** (el detalle del mensajero esta intacto y sus tests lo
prueban), por eso es menor y no bloqueante — pero la bitacora dice algo que no es verdad.

---

## 5 — Mis mutaciones (distintas de las 8 + 11 declaradas)

Aplicadas al arbol real, con copia previa fuera del repo, restauradas y **comprobadas byte a byte**
con `cmp` + `git status` vacio. **Linea de base antes de cada una: 12 archivos, 234 tests, 234
passed** (y `pnpm run test:guardias`: 197 archivos, 2914 passed).

| # | Mutacion | Resultado |
| --- | --- | --- |
| **MR1** | `cierre-factura.tsx:493` pinta el importe con `money(Number(monto).toFixed(2))` | **MUERE**, pero **no por esta ficha**: la mata `dinero-centimos-cuando-existen.guardia` (ficha 359), que persigue `.toFixed(` en `app/**` |
| **MR1b** | lo mismo **sin** `.toFixed(`: `money(String(Number(monto)))` | ⛔ **SOBREVIVE TODO**. 234/234 del juego de la ficha, **2914/2914 de las 197 guardias**. Ver BLOQUEANTE 1 |
| **MR2** | el mapper devuelve `paraLaCentral(...).replace("-","")` (valor absoluto) | **MUERE**: `cierre-bodega-repository.test.ts > el NEGATIVO ... sin recortarse (R36/R37)` — `expected  1000.05  to be  -1000.05 ` |
| **MR3** | `lineasCascadaCentral` deja de emitir `PARA_LA_CENTRAL_NOTA` (la nota fija del detalle) | ⛔ **SOBREVIVE**: 58/58 de los tres archivos de pantalla y 2914/2914 de guardias. Ver menor m2 |
| **MR4** | `GANA_BODEGA_SATELITE_LABEL` pasa de «Gana la bodega satelite» a «Ingreso bodega rechazos» | ⛔ **SOBREVIVE TODO**: 68/68 + 2914/2914. Ver BLOQUEANTE 2 |
| **MR5** | `CASCADA_CENTRAL_TITULO` pasa a valer «Ajustes» | **MUERE**: 4 rojos en `CierreBodegaTarjetaCascada` (R19 y las tres superficies ajenas). El literal «Ajustes» SI esta anclado |
| **MR6** | `filaDescargaBodegaPendiente` recorta el negativo a `"0.00"` (solo la cola del maestro) | ⛔ **SOBREVIVE**: 487/487 de `tests/unit/descarga` + `tests/components/descarga` + la accion, y 2914/2914 de guardias. Ver menor m1 |
| **MR7** | el detalle agregado devuelve `efectivoCubreDescuentos: true` fijo | **MUERE**: `cierres-bodega-admin-service.test.ts > 5 · el aviso del efectivo mira el EFECTIVO agregado, no el general (R37)` |

Autocomprobacion: cada corrida trae su linea `Tests …` copiada arriba; ninguna se declara sin haber
ejecutado. Tras la ultima restauracion volvi a correr el juego entero: **234 passed**, identico a la
base.

---

## 6 — Hallazgos

### BLOQUEANTE 1 — R14 no esta protegido en `cierre-factura.tsx`, que es donde la TARJETA pinta el dinero

La guardia `cierre-bodega-vocabulario.guardia` no lee el archivo entero: recorta **dos trozos**
(`trozosDeBodegaEnLaHoja`, lineas 92-130) — la `<section>` de la cascada y el cuerpo de
`CierreBodegaFacturaResumen`. **`LineaMonto` y `conOperador` (lineas 441-495), que son la funcion
que formatea CADA linea de dinero de la cascada B en la tarjeta, quedan fuera de los dos trozos**, y
por tanto fuera del barrido money-safe.

Medido (MR1b): con `money(String(Number(monto)))` justo en el importe de «Para la central»,
**197 archivos de guardias y 2914 tests pasan en verde**. La unica red del repo que llega ahi es la
guardia de la 359, y esa solo persigue `.toFixed(`, no `Number(`/`parseFloat(`/`parseInt(`.

Esto contradice la conclusion que `progress/impl_393_frontend.md:190-191` deja escrita:

> «R14 en el navegador **lo sostiene la guardia que lee el codigo (G2)**, no una asercion sobre un
> numero pintado»

Es cierto para `CascadaDinero.tsx` (archivo entero, censado). **Es falso para la tarjeta**, que es
justamente la superficie que la satelite ve y la unica que R38 exige en dos pantallas. Y R14 dice
«en los modulos que esta ficha toca» — `cierre-factura.tsx` es uno de ellos.

**Que falta:** que el barrido money-safe de G2 lea `cierre-factura.tsx` **entero** (hoy sale verde:
ese archivo no tiene ni un `Number(` ni un `.toFixed(`), o que los dos trozos incluyan `LineaMonto`
y `conOperador`. Es una linea de test. Comprobacion de que muerde: repetir MR1b y ver el rojo.

### BLOQUEANTE 2 — R25 no tiene ningun test que muerda: el rotulo se compara contra su propia fuente

R25 exige nombrar `total_ingreso_bodega_rechazos` **desde el punto de vista de quien mira** y
**no repitiendo el nombre de la columna**. Todos los tests que tocan esa linea importan
`GANA_BODEGA_SATELITE_LABEL` y lo comparan consigo mismo, asi que **su VALOR no esta anclado en
ningun sitio**.

Medido (MR4): cambiado a «Ingreso bodega rechazos» —exactamente el vocabulario de columna que R25
prohibe— **pasan los 68 tests de las tres superficies y las 2914 de las 197 guardias**.

El riesgo no es teorico: **Q4 sigue abierta** en el spec y el `status_note` de la 393 en
`feature_list.json` registra «DECIDIDO POR EL LEADER: Q4 = si, el rename va en su fuente al estilo de
la 338». Si alguien ejecuta ese rename, nada se queja.

Contraste que demuestra que se puede hacer y que aqui no se hizo: `PARA_LA_CENTRAL_LABEL` **si** esta
anclado —su literal «Para la central» se afirma como encabezado en
`tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts:58,83,127`— y `CASCADA_CENTRAL_TITULO`
tambien (MR5 muere). Los que quedan sueltos son `GANA_BODEGA_SATELITE_LABEL`, `PARA_LA_TIENDA_LABEL`,
`NETO_ORDENEX_LABEL`, `COBRADO_SOBRE_RECAUDADO_LABEL`, `FACTURADO_ORDENEX_LABEL` y las cuatro notas.

**Que falta:** una asercion sobre el VALOR de `GANA_BODEGA_SATELITE_LABEL` (como minimo), en la linea
de lo que ya hace el test de descarga con «Para la central». Comprobacion: repetir MR4 y ver el rojo.

### BLOQUEANTE 3 — V2 (verificacion humana en la app real) sin hacer, y la entrega ES una pantalla

Las **dos** bitacoras lo declaran PENDIENTE. `tasks.md` V2 no lo deja como opcional:

> «Doce mil tests no vieron siete textos rotos que mirar la app si vio: **este paso no es opcional**.»

Aqui el checkpoint de E2E es **inaplicable** (este repo no tiene arnes E2E ejecutable), y el
sustituto que el propio spec definio es V2. Sin el, lo unico que ha mirado la pantalla es jsdom.
Con esto saliendo a produccion esta noche y siendo **dinero en pantalla**, no lo puedo dar por bueno.

El guion ya esta escrito en `tasks.md` V2 y son ~10 minutos:

1. **`adminSatelite`** -> consolidacion -> desplegar la tarjeta de un cierre de bodega pasado:
   la columna del medio dice «Lo que va a la central», **la resta da sumando a mano**, y **no**
   aparece «Para la tienda» ni «Neto de Ordenex».
2. **Maestro** -> `/cierres-admin` -> misma tarjeta con **el mismo valor** que ve la satelite;
   abrir el detalle y comprobar que las dos cascadas estan separadas y que **las tres restas dan**.
3. Repetir con un cierre que tenga al menos una `rechazada`: la linea puente explica la diferencia.

Y **dos cosas concretas que mirar mientras se hace**, porque solo se ven con los ojos:

- **«Central debe» y «Para la central» conviven ahora en la MISMA pagina de la satelite.** D6 eligio
  «Para la central» precisamente para no reusar `CENTRAL_DEBE_LABEL`, pero la lista de solicitados
  —donde vive la cascada nueva— la monta `ConsolidacionBodegaModule`, que sigue pintando
  «Central debe» (`:342-360`). Son dos numeros distintos con dos nombres casi identicos, a un palmo
  el uno del otro. Ningun test puede decidir si eso se entiende.
- **El caso negativo** (`1 de 14` cierres en produccion): que `-C1.000,05` se lea como deuda y no
  como un error de la pantalla.

### BLOQUEANTE 4 — `tasks.md`: 0 de 35 tareas marcadas

`grep -c` sobre `specs/393-cierre-bodega-dos-cascadas/tasks.md`: **35 lineas `- [ ]`, 0 lineas
`- [x]`**. `CHECKPOINTS.md` lo pide explicitamente («todas las tasks estan marcadas `[x]`»).

No es burocracia vacia en este caso concreto: **T0.4, C3, F7, G4 y G5 terminaron con un resultado
distinto del que la tarea preveia** (censo vacio, guardias que no hubo que tocar, F7 sin trabajo), y
el criterio de HECHO de **F5 quedo escrito contra una premisa falsa** (ver seccion 4b). Marcarlas
obliga a decir por escrito cual se cumplio y cual se cumplio de otra forma.

---

## 7 — Menores

**m1 · El negativo se puede recortar en 2 de las 3 descargas de bodega sin que nada se queje.**
El test del negativo (`un «Para la central» NEGATIVO llega al archivo con su signo (R36)`) solo
ejercita `filaDescargaBodegaSolicitado`. Medido (MR6): recortarlo a `"0.00"` en
`filaDescargaBodegaPendiente` deja 487 tests de descarga y 2914 de guardias en verde. Las tres
proyecciones son tres asignaciones independientes. **Arreglo**: recorrer las tres en ese `it`, igual
que ya hace el caso del canario `77777.77` justo encima.

**m2 · La nota fija de «Para la central» en el DETALLE no esta cubierta (R26).**
Medido (MR3): quitar `PARA_LA_CENTRAL_NOTA` de `lineasCascadaCentral` deja todo verde.
`PARA_LA_CENTRAL_NOTA` solo se afirma en `CierreBodegaTarjetaCascada.test.tsx:200` (la tarjeta).
R26 queda cubierto en una superficie de dos.

**m3 · Codigo muerto que la bitacora niega.** `MontoDerivadoCard` sin consumidor (seccion 4b) y
`GANANCIA_NOTA_BODEGA` sin consumidor (declarado y cierto). Ninguno rompe nada; los dos merecen una
linea en la deuda escrita o un borrado en ficha aparte.

**m4 · R23 al pie de la letra no se cumple para «lo recaudado».** La MISMA cifra
(`total_general`) se llama **«Total»** en la tarjeta (`RESUMEN_TOTAL_LABEL`) y **«Total general»** en
el detalle (`TOTAL_GENERAL_LABEL`), y R23 exige *«el mismo rotulo … en la tarjeta y en el detalle»*.
Es deliberado (D5, y Q6 lo deja abierto) y viene de antes de la ficha, pero: (a) es la **primera
linea de la cascada B**, o sea trabajo nuevo; (b) **no hay test** de esa pareja; y (c) el
`status_note` de la 393 registra «DECIDIDO POR EL LEADER: … Q6 = se unifican «Total» y «Total
general»», que es lo contrario de lo implementado. Hay que cerrar la contradiccion entre el spec y
la ficha, en un sentido o en el otro.

**m5 · Falta la entrada en `progress/history.md`** (CHECKPOINTS).

**m6 · Estado rancio.** `feature_list.json` deja la 393 en `in_progress` con un `status_note` que
dice «FALTA TODA LA PANTALLA y por eso sigue in_progress», con el PR #739 ya mergeado; y
`progress/current.md` dice «Pantalla en curso: F1-F7, G1-G3». Los dos describen el mundo de antes
del merge.

**m7 · Una frase de la bitacora del frontend no es exacta.** Dice «161 warnings … **ni uno en un
archivo de este diff** (comprobado por nombre de archivo)». `tests/components/DineroIdentidadesEnPantalla.test.tsx`
esta en el diff **y tiene uno** (`508:1 Unused eslint-disable directive`). Lo medi restaurando el
archivo base y pasandole eslint: el warning **ya estaba** (linea 476), asi que **no se introdujo
nada** y el total sigue en 161. Es la frase la que esta mal, no el codigo.

**m8 · Mensaje de fallo roto en `cascada-central-en-las-dos-pantallas.guardia.test.ts:194-197`.**
El mensaje es un template literal que lleva dentro un `" +` y un salto, restos de una concatenacion:
si esa guardia falla, imprimira comillas y signos de suma en medio de la explicacion. Solo se ve
cuando cae, que es justo cuando importa que se lea bien.

---

## 8 — Mapa `R<n> -> test`, verificado en los archivos reales

No me fie del mapa de las bitacoras: abri cada archivo. Leyenda: **OK** = hay test y muerde;
**parcial** = cubre menos de lo que el requisito dice; **HUECO** = no hay test que muerda.

| R | Test que lo sujeta (comprobado) | |
| --- | --- | --- |
| R1 | `CierreBodegaDetalleCascadas > son DOS regiones distintas…` (+M12: 16 rojos) | OK |
| R2 | idem `> ninguna region mezcla el resultado de la otra…` | OK |
| R3 | idem `> «Para la tienda» y «Neto de Ordenex» … DESTACADOS` | OK |
| R4 | idem `> «Para la central» esta, DESTACADO…` + `CierreBodegaTarjetaCascada > las CUATRO lineas…` | OK |
| R5 | `CascadaDinero > cada linea sustraendo se pinta con su signo` + `> la resta CIERRA leyendo lo pintado` | OK |
| R6 | `cascadas-cierre-bodega` c7 · `cierres-bodega-admin-service` c1 · `DineroIdentidades B5·R6` (DOM) | OK |
| R7 | `cascadas-cierre-bodega` c6 · servicio c3 · `DineroIdentidades B5·R7` | OK |
| R8 | `cascadas-cierre-bodega` c1 y c2 · `DineroIdentidades B5·R8` | OK |
| R9 | `cascadas-cierre-bodega` c3 · `DineroIdentidades B4` y `B5·R9` · repo B7 | OK |
| R10 | `CierreBodegaDetalleCascadas > la linea puente sale TAMBIEN con … cero` (M4) · servicio c3(c) | OK |
| R11 | `CierreBodegaDetalleCascadas > un «Neto de Ordenex» NEGATIVO…` · `CascadaDinero > un resultado NEGATIVO…` | OK (el negativo de «Para la tienda» solo por el mecanismo generico) |
| R12 | servicio c1-c6 · `cierre-bodega-repository` (STRING/boolean) · descarga `> el valor viaja como el STRING del DTO` | OK |
| R13 | `CascadaDinero > NO altera el importe que recibe` · `CierreBodegaTarjetaCascada > el resultado LLEGA en la prop` (canario `77777.77`) | OK |
| R14 | `cierre-bodega-vocabulario.guardia > money-safe…` | **parcial — BLOQUEANTE 1** (no cubre `cierre-factura.tsx` fuera de los dos trozos) |
| R15 | servicio c2 y c5b · `CierreBodegaDetalleCascadas > cada cierre_dia trae SUS dos cascadas` (M3) | OK |
| R16 | servicio c2 · `> la suma de los dias da el agregado, AL CENTIMO` · medicion T0.3 | OK |
| R17 | servicio c4 (M5) | OK |
| R18 | `CierreBodegaTarjetaCascada > las CUATRO lineas … la resta CIERRA leyendo el DOM` | OK |
| R19 | idem `> la columna del medio deja de llamarse «Ajustes»` (M8, y mi MR5) · G2 censo | OK |
| R20 | `CierreBodegaTarjetaCascada > el resultado LLEGA en la prop` · repo B7 | OK |
| R21 | `CierreBodegaTarjetaCascada > las OTRAS TRES superficies, intactas` (3 casos, M9) · G3 · descarga consolidables · V3 | OK |
| R22 | descarga: orden de las 3 columnas + `> los TRES listados … sin recalcularlo` (M6) | OK |
| R23 | `CierreBodegaDetalleCascadas` c4 y c10 · G2 | OK para las cifras de las cascadas; **ver menor m4** para «Total» vs «Total general» |
| R24 | `CierreBodegaDetalleCascadas > NO queda ninguna tarjeta suelta…` (M11) · G2 `CIFRA_SUELTA` | OK |
| R25 | ninguno: el rotulo solo se compara contra su propia constante | **HUECO — BLOQUEANTE 2** (MR4 sobrevive) |
| R26 | `CierreBodegaTarjetaCascada > la nota dice de que resta sale` | OK en la tarjeta; **hueco en el detalle** (menor m2, MR3 sobrevive) |
| R27 | `CierreBodegaDetalleCascadas > la nota de «Gana la bodega satelite» … NO es un movimiento de caja` | OK |
| R28 | V4: `git diff --name-only 6fd97d06 HEAD -- db/` **vacio**, verificado por mi | OK |
| R29 | `CierreBodegaDetalleCascadas > el panel de totales por metodo sigue EXACTAMENTE igual` | OK |
| R30 | `CierreFacturaPapel.test.tsx` sin editar y verde · F4 (3 casos) · M9 · V3 | OK |
| R31 | servicio c6 (`pagoTienda` y `ganancia` igual que antes) · B8 | OK |
| R32 | `CascadaDinero > es una region con nombre accesible PROPIO` · F6 c1 | OK |
| R33 | `cierre-bodega-vocabulario.guardia > el MISMO extractor encuentra los rotulos NUEVOS` | **parcial**: comprueba que las constantes se usan, no que no haya literales sueltos. El unico literal perseguido es «Ajustes» |
| R34 | `CierreBodegaDetalleCascadas > NO queda ninguna tarjeta suelta…` · G2 | OK |
| R35 | G2 censo `AJUSTES` + su autocomprobacion (a,b,c) — probada con canario sintetico y con mi MR5 | OK |
| R36 | `cascadas-cierre-bodega` c4 · repo `> el NEGATIVO … sin recortarse` (mi MR2) · tarjeta y detalle · descarga | OK (con el hueco de 2 de 3 descargas, menor m1) |
| R37 | `cascadas-cierre-bodega` c5 · repo `> el aviso mira el EFECTIVO y no el general` · servicio c5/c5b (mi MR7) · tarjeta (2 casos) · detalle | OK |
| R38 | `CierreBodegaTarjetaCascada > la satelite y el maestro ven el MISMO rotulo y el MISMO valor` (M10) · repo B7 (8 lecturas, con autocomprobacion de 7 claves) · G3 (3 rutas, con autocomprobacion) | OK, y bien |
| R39 | `CierreBodegaTarjetaCascada > la tarjeta NO ensena el margen de Ordenex` (M16) · el corte por `esAccesoTotal` en el servicio | OK |

**Resumen: 1 hueco (R25), 2 parciales (R14, R33), 36 cubiertos.**

---

## 9 — Que hace falta para que esto pase a OK

Nada de esto toca codigo de produccion. En orden de coste:

1. **B4** — marcar `tasks.md` con `[x]`, y anotar por escrito las cinco tareas cuyo resultado real
   fue distinto del previsto (T0.4 vacia, C3 sin editar guardias, F7 sin trabajo, G4/G5 verdes sin
   tocar) y **corregir el criterio de HECHO de F5**, que se apoya en una premisa falsa.
2. **B1** — que el barrido money-safe de `cierre-bodega-vocabulario.guardia` lea
   `cierre-factura.tsx` entero (hoy sale verde). Comprobar con MR1b que ahora muerde.
3. **B2** — anclar el VALOR de `GANA_BODEGA_SATELITE_LABEL` (y, ya puestos, el de los otros cuatro
   rotulos y las cuatro notas). Comprobar con MR4.
4. **m1 y m2** — recorrer las tres proyecciones en el test del negativo del archivo; afirmar la nota
   fija en el detalle.
5. **B3** — **la persona mira la app** con el guion de `tasks.md` V2, mirando ademas la convivencia
   de «Central debe» y «Para la central» en la pantalla de la satelite. Capturas a `progress/`.
6. **m5/m6** — entrada en `progress/history.md`, y actualizar `feature_list.json` y
   `progress/current.md` (que **no** los escriba un agente con otros agentes dentro).

---

## 10 — Lo que quiero dejar dicho a favor de la ficha

Es de las implementaciones mejor medidas que he revisado en este arbol. En concreto:

- **R38 no puede fallar por construccion**, y ademas esta medido: una sola derivacion en
  `toBodegaResumenRow`, ocho lecturas, y un test que las recorre las ocho con autocomprobacion.
- **El negativo es camino normal**, con la razon estructural escrita en el docstring de
  `paraLaCentral` (`pagoPorResultado` paga fijo por entrega) y el `1 de 14` de produccion citado.
  Mi mutacion del valor absoluto en el mapper muere en el sitio correcto.
- **La linea puente existe porque la resta no daba**, y el test lo demuestra midiendo el hueco
  (`tienda - (recaudado - facturado) === fleteDevolucionConIva`) en vez de afirmarlo.
- **El implementador del backend encontro con M14 un agujero en sus propios tests y lo dijo**;
  el del frontend midio que su caso de F2 **no** mataba la mutacion del dinero y **no se atribuyo
  la cobertura**. Las dos cosas son exactamente lo que hace util una bitacora. Lo unico es que la
  segunda conclusion —«lo sostiene la guardia»— resulto ser cierta solo a medias, y eso es
  BLOQUEANTE 1.

