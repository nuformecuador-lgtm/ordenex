# review_184 - analitica financiera: export de la serie

> Revision hecha en el worktree `C:/w184`, rama `feature/184-analitica-financiera-export`
> (HEAD `93bdea7b`). Todo lo que se afirma aqui se comprobo LEYENDO el codigo citado o EJECUTANDO
> la corrida de la seccion 5; lo que no se pudo verificar esta en la seccion 6.
>
> Aviso heredado y tenido en cuenta: T0-T5 se escribieron el 2026-08-08, quedaron sin commitear dos
> dias y su bitacora se reconstruyo A POSTERIORI leyendo el codigo. Se han revisado con el mismo
> escepticismo que T6/T7: **ningun caso se dio por bueno por constar en la bitacora**.

---

## 1. Veredicto

**APROBADO.** Cero hallazgos bloqueantes. Los 30 requisitos tienen test y **cada test citado mide lo
que su requisito pide** (verificado caso a caso, no por conteo de menciones). Quedan 7 hallazgos
menores, ninguno en codigo de produccion; dos de ellos (4.1 y 4.2) son **condicion para marcar los
checkpoints de «Especificacion» y pasar la ficha a `done`**, y son trabajo del leader, no del
implementer.

---

## 2. Checklist de CHECKPOINTS.md, punto por punto

| Checkpoint | Estado | Evidencia |
|---|---|---|
| `requirements.md` con EARS numerados | OK | R1..R30, cada uno con test nombrado **y su mutacion** |
| `design.md` con alternativa descartada y su porque | OK | seccion 7: once alternativas, todas con motivo verificable |
| `tasks.md` con todas las tasks `[x]` | PARCIAL | El archivo no usa casillas; **T7.2 declarada pendiente** por la propia bitacora (ver 4.1) |
| Cada `R<n>` mapea a un test concreto | OK | Tabla de la seccion 3: 30/30 leidos |
| `progress/impl_184.md` contiene el mapa `R -> test` | OK | Su seccion 2; verificado por muestreo total, no parcial |
| `pnpm typecheck` sin errores | OK | Verde (gate completo del leader) |
| `pnpm lint` sin errores | OK | 0 errores, 52 warnings preexistentes; el rojo de `react-hooks/refs` se cerro en `1b6b0f0d` **sin `eslint-disable`** |
| `pnpm test` | OK | `./init.sh` completo del leader: 12.822/12.824; los 2 rojos verificados verdes en aislado. Corrida propia de la vecindad: seccion 5 |
| E2E si toca flujo critico | n/a | Descarga de analitica: no es auth/pagos/recaudo/ingesta/webhook |
| RLS en tablas nuevas | n/a | **Cero migraciones y cero tablas**; el aislamiento sigue siendo el de la 122 (`prepararConsultaAnalitica`) |
| Migraciones reversibles | n/a | No hay `migration.sql` |
| Sin secretos hardcodeados | OK | Ningun literal de credencial ni de entorno en los tres archivos nuevos |
| Webhooks con firma/idempotencia | n/a | Ninguno |
| Controller sin queries ni negocio | OK | No se toco `lib/actions/**`: el borde se **consume**, no se edita |
| Service sin HTTP | n/a | Cero lineas de servidor (`zone: frontend` se sostiene) |
| Repository solo queries | n/a | - |
| Interfaces en `lib/interfaces/` | n/a | - |
| Paginas protegidas validan en servidor | OK | El gate sigue siendo `esAccesoTotal` en `page.tsx:94`; el subarbol **no escribe ninguna condicion de permiso** (guardia de frontera, bloque 7) |
| `private/` recibe por props, no fetchea sensible | OK | Props planas (`string`); el DTO financiero **sigue sin cruzar la frontera RSC** |
| Mutaciones por Server Action, no API routes | OK | Cero rutas nuevas; el bloque (2) las censa por ruta **y** por codigo |
| Sin hardcode de pais/moneda/cuenta | OK | `moneda` sale del propio importe; `es-EC` y `Costa Rica` solo aparecen en **comentarios** |
| `./init.sh` verde | OK | Corrido por el leader antes de esta revision |
| `progress/review_<feature>.md` con veredicto OK | OK | Este archivo |
| Entrada en `progress/history.md` | PENDIENTE | Posterior al merge (leader) |

---

## 3. Trazabilidad R1..R30, verificada leyendo **los 30** casos

No es un muestreo: se leyeron de principio a fin los 13 archivos de test de la feature. La columna
«que mide de verdad» es lo que se comprobo, no lo que el titulo promete.

| R | Test / guardia | Que mide DE VERDAD | OK |
|---|---|---|---|
| R1 | `puerta.test.ts` > *las filas salen de consultarMetricaFinanciera...* | Accion espiada: **1** llamada, `metricaId` de la seccion, y el bruto de la fila 0 es el centinela `424242.42`, que solo existe en la respuesta espiada. Segundo caso: no hay doble lectura | si |
| R2 | idem > *el filtro es el MISMO objeto* | `toBe` referencial contra `FILTRO_FINANCIERO_POR_DEFECTO` mas `Object.isFrozen`. Un `{rango:"mes"}` a mano falla | si |
| R3 | `frontera.guardia` (2) | Censo de `app/api/**` por RUTA y por CODIGO, con autocomprobacion y contrapeso «app/api no esta vacio» | si |
| R4 | idem (3) | `use server` cruzado con `construirDescarga` sobre `app/ lib/ components/ scripts/`, con contrapeso de que ambos detectores casan en el arbol real | si |
| R5 | idem (4) + `puerta.test.ts` > *DOS argumentos* | Escaner de parentesis (no regex) **y** descubrimiento del alias `consultar = consultarMetricaFinanciera`; en ejecucion `calls[0]` tiene longitud 2 | si |
| R6 | `denegado.test.ts` > *forbidden...* | Borde REAL con `adminTienda`; el mensaje habla de acceso, no de «no hay datos» ni «ajusta los filtros», y no filtra `metrica_prohibida` | si |
| R7 | idem > *...ANTES de responder* | **Secuencia** `["auditoria","respuesta"]` sobre un array compartido, borde real, y el registro es el de `describirDenegado` (evento/motivo/rol/usuarioId/metricaId). Cumple los 3 criterios de 9.1 T-A | si |
| R8 | idem > *validation_error...* | Preset `quincena` en el doble: `secuencia` vacia, mas sanidad de que la constante de produccion SI valida | si |
| R9 | idem > *error saneado* | Compara contra el mensaje que devuelve **el propio borde** en la misma condicion, no contra un literal | si |
| R10 | `alcance.guardia` (a)(b)(c) | (a) censo del vocabulario sobre el subarbol; (b) claves **y** encabezados contra lista escrita a mano mas firma de identificador; (c) sobre el **TEXTO** CSV: sin uuid, primera linea igual a la cabecera declarada, `filas+1` lineas exactas | si |
| R11 | `columnas.test.ts` > *toda celda procede del DTO...* | Proyecta con dos DTO **sin un campo en comun** y exige que las celdas invariantes sean **exactamente** `["limitacion_conocida"]`; mas contrapeso campo a campo | si |
| R12 | `alcance.guardia` (d) | Fixture con uuids reales: la seleccion devuelve `null`, el control responde con el texto de R12 y sin uuid ni en el mensaje. Con contrapeso (una temporal SI descarga) y autocomprobacion (si pasara, el archivo llevaria el uuid literal) | si |
| R13 | `forma.test.ts` (2 casos) | `"neto" in fila === false` (ni vacia, ni en cero) y, con neto, `neto !== bruto` por fixture; las claves de la fila son las columnas del archivo | si |
| R14 | `frontera.guardia` (6) + `forma.test.ts` > *la eleccion la hace la FORMA* | Mismos ids **importados** (`IDS_FINANCIERAS_SERVIDAS`), cinco formas de decision, autocomprobacion positiva y negativa | si |
| R15 | `grano.test.ts` > *cada fila declara el grano* | Dos rangos que **producen** `dia` y `semana` por la misma funcion pura del servidor, con sanidad de que difieren | si |
| R16 | idem > *saldo al corte* | `esAcumulado` derivado por `esMetricaAcumulada` dentro de la fixture; los dos valores del vocabulario son distinguibles | si |
| R17 | `columnas.test.ts` > *la moneda sale del importe* | Fixture con moneda **distinta** de la de produccion, mas una fila con otra moneda: sale de SU importe | si |
| R18 | idem > *el importe literal* + `frontera.guardia` (8a) | `"90071992547409919.99"` con **sanidad del centinela** (`String(Number(x)) !== x`), tipo `string` y sin separadores; el guardia veta `aNumero`, `Number`, `parseFloat`, `toFixed` y `toLocaleString` | si |
| R19 | `equivalencia.test.ts` > *fila por fila* | Cardinalidad y orden contra `cubosDe()` (el mismo troceo del servicio) y un cubo en cero **en su sitio** | si |
| R20 | idem > *ni orden, ni cola, ni relleno* | Se compara contra lo que `agruparCola` **haria**, con sanidad de que el techo recorta de verdad; sin claves repetidas ni ajenas | si |
| R21 | `vacio.test.ts` > *sin filas* | Control MONTADO; `buildCsvRows` espiado **sin sustituirlo** y `descargarBlob`: ninguno se invoca | si |
| R22 | idem > *el tope no trunca* | `MAX_FILAS + 1`: mensaje con total y tope, cero archivo; contrapeso con `MAX_FILAS` exactas que SI descarga | si |
| R23 | `frontera.guardia` (8) | El subarbol contiene **exactamente** los tres archivos declarados; nadie fuera de la analitica lo importa; dentro, solo `TableroFinanciero.tsx`, y con **una** insercion de JSX | si |
| R24 | `AnaliticaFinancieraExport.test.tsx` > *el nombre lo pone el patron* | Contra la salida de `nombreArchivoDescarga`, no contra un literal | si |
| R25 | idem > *CSV y XLSX...* | Los dos items del menu, las columnas que recibe `buildCsvRows`, sin BOM, sin punto y coma, MIME comun e importe literal en el texto | si (ver 4.5) |
| R26 | `frontera.guardia` (9) | Convencion de nombre, mas los patrones de la 170 leidos de **SU fuente**, mas glob tokenizado, mas import real del modulo para que la sonda tenga que recorrer | si |
| R27 | idem (7) + `AnaliticaFinancieraExport.test.tsx` | Censo de roles derivado de `RolValue`; en el arbol montado hay **tres** controles (uno por vista temporal) y **ninguno** en la no temporal | si |
| R28 | `tests/unit/guards/tablero-financiero.guardia.test.ts` (vivo) | **No aparece en el diff de la rama** (comprobado contra `origin/dev`) y corre verde | si |
| R29 | `analitica-financiera-descarga-columnas.test.ts` | Clave **y** encabezado escritos a mano en los dos juegos; sin `COLUMNAS.map(...)` a los dos lados; mas contrapeso de que la unica diferencia es `neto` | si |
| R30 | `grano.test.ts` > *la limitacion declarada* | Un solo valor en todas las filas, `typeof string`, y **no cambia al proyectar otro rango** (una marca calculada cambiaria) | si |

**30/30.** No se encontro ni un solo caso citado que midiera algo distinto de su requisito. El
muestreo pedido (8 filas) se amplio a las 30 porque T0-T5 no habian pasado revision.

### 3.1 Los cinco puntos de ojo critico

**1. R10/R11/R12, el alcance no entra en el archivo: ATADO, y no solo por el texto.** La guardia de
T6.2 lo sujeta por **tres vias independientes**, y esa es la respuesta a «que pasaria con una columna
nueva que llevara `tiendaId`»:

- anadir la **columna** pone rojo **(b)**, porque `CLAVES_ESPERADAS` y `ENCABEZADOS_ESPERADOS` estan
  escritos a mano y la comparacion es un `toEqual` de la lista completa. No hay forma de anadir una
  columna sin romper ese caso; y si ademas se llamara `tiendaId`, cae tambien en
  `IDENTIFICADOR_INTERNO` y en `vocabularioDelAlcance`;
- anadir solo la **celda** (sin columna) pone rojo **R11**, que compara `Object.keys(fila)` contra el
  contrato y ademas exige que la unica celda invariante sea `limitacion_conocida`;
- anadir una celda con **nombre inocente** que transporte un identificador pone rojo **(c)**, que mide
  el TEXTO del CSV con `FORMA_UUID`, que es la forma que hoy tiene el `tiendaId` en este esquema.

La sospecha de que «la guardia solo mira el texto del archivo» es **falsa**: (a) censa el subarbol,
(b) el contrato y (c) el texto. Y (c) trae una autocomprobacion que construye un archivo **con** la
fuga para demostrar que la sonda la ve: sin ella, «no hay uuids» seria verde por incapacidad.

**2. Las nueve autocomprobaciones de T6.1 existen y ninguna es verde por vacio.** Comprobado bloque a
bloque. Ademas de la autocomprobacion, **siete** llevan contrapeso empirico sobre el arbol real: el
subarbol SI importa el borde; `app/api` SI tiene rutas; hay modulos `use server` **y** modulos que
arman archivos; hay al menos una llamada con exactamente 2 argumentos; el subarbol SI importa el
filtro; los dominios de ids y de roles no estan vacios; el descubrimiento por convencion ve mas de 5
modulos. El bloque (9) merece mencion aparte: no copia los patrones de la 170, los **lee de su
fuente**, y se pone rojo si aquella los cambia. La autocomprobacion (4) es la mejor de todas:
descubre el alias del borde y demuestra que ve el tercer argumento, que es justo lo que un regex
ingenuo perderia.

**3. La puerta unica (R23/R26/R27): no encontre ningun camino que la esquive.** `obtenerFilas` llama
a `prepararExportFinanciero`, que llama a `consultar(metricaId, FILTRO_FINANCIERO_POR_DEFECTO)`. El
filtro se **importa**, no se reconstruye, y el test lo afirma por identidad referencial. El unico
rodeo concebible es el tercer parametro `consultar` (ver 4.4), pero cualquier fuente alternativa
exigiria un import que el bloque (1) veta. Cero rutas `app/api`, cero Server Actions nuevas, cero
`deps` desde produccion.

**4. `useRef` a `useState` (`1b6b0f0d`): el cambio es CORRECTO y no abre la ventana temida.** Revisado
contra `DescargarDatasetButton`, no contra la bitacora: el handler `descargar` **cierra sobre la prop
`columnas`** y la entrega a `construirDescarga` en el mismo tick en que `obtenerFilas` resuelve
(`DescargarDatasetButton.tsx:93-111`). El inicializador perezoso de `useState` se evalua una vez por
montaje, asi que la **instancia es la misma** que con `useRef`; los `setGenerando` y `setMenuAbierto`
que ocurren antes del `await` provocan re-render, pero devuelven **ese mismo array**, no una copia.
No hay render intermedio que pueda dejar el juego del archivo ANTERIOR: el `splice` ocurre despues
del `await` de la consulta y antes del `return` que el boton espera. Y el caso que de verdad lo juzga
-*una vista solo_bruto descarga con SU juego de columnas*- esta escrito y verde. Reserva en 4.6.

**5. D2 y D3 se cumplen donde se dice, no solo se declaran.** D2: `bruto` y `neto` se copian tal cual
(`analitica-financiera-descarga-columnas.ts:176-177`), el test usa una cifra por encima de 2^53 **con
sanidad del centinela**, el guardia veta las cinco formas de convertir, y el test de UI comprueba
`1000.10` literal dentro del texto del CSV. D3: la columna existe (`:125`), su valor es la constante
de `:82-83`, todas las filas la llevan, **no cambia al cambiar el rango**, R11 la nombra como
exencion unica y comprueba que no haya una segunda, y el aviso «no la borres» esta en la cabecera del
modulo con todas las letras (`:38-60`).

---

## 4. Hallazgos

### Mayores (bloqueantes): NINGUNO

### Menores

**4.1 (menor, condicion de cierre) - T7.2 sin hacer.** Verificado: buscar «184» en
`specs/134-analitica-export-csv/` y en `specs/132-analitica-tablero-financiero/` no devuelve nada. La
D1 de la 134 queda **consumida** por esta ficha, y la region de la 132 gana un control de cliente:
ninguna de las dos specs lo dice. La bitacora lo declara pendiente en su seccion 5, asi que no es una
omision tapada. Son dos notas fechadas al margen; hasta que existan, el checkpoint «todas las tasks
`[x]`» no se puede marcar. **Trabajo del leader, no del implementer.**

**4.2 (menor, condicion de cierre) - `feature_list.json` sigue diciendo `"status": "pending"`** para
la 184, con una `status_note` que ya no aplica (habla de esperar a la 180 y la 183, ambas `done`).
Bookkeeping del leader.

**4.3 (menor) - `tasks.md` no usa casillas `[x]`.** Describe el estado en prosa («HECHA», «Hecho
cuando...»). Se puede auditar igual -lo he hecho-, pero impide comprobar el checkpoint de forma
mecanica y obliga a cruzarlo con la bitacora. Convencion, no correccion.

**4.4 (menor) - `prepararExportFinanciero` exporta su tercer parametro `consultar`.** Es el punto de
inyeccion de los tests y esta documentado, pero es tambien la unica firma del subarbol por la que un
futuro llamador podria pasar otra fuente de datos. Hoy no lo hace nadie (el bloque 8 lo censa) y
cualquier fuente alternativa necesitaria un import vetado por el bloque (1), asi que el riesgo es
teorico. Se anota para que quien anada un segundo consumidor sepa que ahi hay una puerta con bisagra.

**4.5 (menor) - la rama XLSX no se ejecuta en ningun caso de esta feature.** R25 comprueba que el
menu ofrece los dos formatos y que `FORMATOS_EXPORT_FINANCIERO` es `["csv","xlsx"]`, pero **todos**
los casos que llegan a descargar pulsan CSV. El generador `xlsx` con **estas** columnas -incluida la
celda larga de `limitacion_conocida`- nunca se ejecuta aqui; queda cubierto solo por los tests
genericos del patron 151. Lo mismo vale para la asercion de R10 sobre el TEXTO, que se mide sobre el
CSV y no sobre el libro. No es una fuga -el XLSX recibe exactamente las mismas columnas y filas-,
pero es una linea sin recorrer en la feature que la introduce.

**4.6 (menor) - mutar en sitio un array guardado en `useState` es correcto, pero fragil.** Funciona
por la razon que el fuente explica y esta comprobado (punto 4 de 3.1), pero depende de que
`DescargarDatasetButton` no copie ni memoize el array de columnas. Hoy no lo hace: `columnas` viaja
intacta hasta `construirDescarga`. Si alguien memoiza ese componente, o si el compilador de React
clona la prop, el archivo saldria con las columnas del render anterior **y el unico test que lo veria
es el de `solo_bruto`**. Recomendacion no bloqueante: si el patron se repite en otra feature, que
`obtenerFilas` devuelva tambien sus columnas en vez de compartir un buzon mutable.

**4.7 (menor, informativo) - el baseline de T0.2 nunca se midio en esta rama.** La bitacora lo dice
sin adornos. Queda cubierto de hecho por el `./init.sh` completo del leader (1037/1039 archivos,
12.822/12.824 tests, los 2 rojos verificados verdes en aislado), pero la comparacion «antes/despues»
propia de esta rama no existe y ya no se puede reconstruir.

---

## 5. Lo que corri yo (no heredado)

```
$ pnpm exec vitest run <los 13 archivos de la feature + tablero-financiero.guardia + columnas-sensibles.guardia>
 Test Files  14 passed (14)
      Tests  204 passed (204)
   Duration  10.30s

$ git status --porcelain
 (vacio: el arbol esta limpio)

$ git diff --stat contra el merge-base con origin/dev
 21 archivos, 5025 inserciones, 0 borrados
 -> exactamente los declarados en design 1: 3 de produccion + TableroFinanciero.tsx (+19)
    + 13 de test + la fixture + 3 de spec + la bitacora. NI UNA linea en lib/ ni en components/.
```

`tests/unit/guards/tablero-financiero.guardia.test.ts` **no aparece en el diff** y corre verde: la
condicion integra de D6 se cumple (R28) sin haber tocado el guardia.

El diff de `TableroFinanciero.tsx` se leyo entero: 19 lineas, un import y **una** insercion de JSX
guardada por `esVistaTemporal(vista)`, con las tres props planas (`string`). Sin `"use client"`, sin
prop-funcion, sin nombrar granos ni ids de metrica.

**NO** corri la suite completa (indicacion del leader).

---

## 6. Lo que NO pude verificar

1. **Las mutaciones de la seccion 3 de la bitacora, reejecutadas por mi.** Intente aplicar la mutacion
   «una columna nueva que lleva `tiendaId`» para ensenar en rojo lo que afirmo en el punto 1 de 3.1, y
   el entorno bloqueo la escritura sobre codigo de produccion. La conclusion se sostiene por
   **lectura**: la asercion (b) es un `toEqual` contra una lista literal completa, asi que **cualquier**
   columna anadida la rompe por construccion; no hay grado de libertad ahi. Las salidas de las tres
   mutaciones que la bitacora pega son **coherentes con el codigo que he leido** -nombres de caso,
   conteos y mensajes de error se corresponden-, pero no las he reproducido.
2. **El comportamiento real en un navegador.** Todo lo de la frontera RSC se juzga con el arbol montado
   en jsdom (T5.2), que es lo que este repo puede hacer hoy; ningun gate corre `pnpm build`.
3. **El archivo XLSX real** (ver 4.5): ningun caso lo genera.
4. **Que los 2 rojos del `./init.sh` del leader sean flakes.** Lo tomo de su verificacion en aislado;
   no la repeti.

---

## 7. Nota para el PR (T7.3)

El cuerpo debe citar `D1..D6` **con su motivo** y el aviso de numeracion («184» en 111 comentarios, en
`PENDIENTES_184` y en unos 60 commits se refiere a la **188**). Antes del merge conviene cerrar 4.1 y
4.2, que es lo unico que separa esta ficha de poder marcarse `done` sin asteriscos.
