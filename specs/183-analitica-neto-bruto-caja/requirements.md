# Feature 183 — El `neto` de las cuatro métricas de caja

> **Zona:** `fullstack` · **Depende de:** 175 (mergeada) · **Rama:** `feature/183-neto-bruto-caja`
>
> ⚠️ **Lo que manda es `progress/decision_183.md` — decisión ⟨D12⟩, humana, fechada el
> 2026-08-04, CERRADA.** Este spec la aplica; **no la reabre ni la re-litiga**. La
> `status_note` de la ficha 183 en `feature_list.json` («retirar en las CUATRO, y NO que
> `egresos` gane `ingreso_ajuste`») quedó **SUSTITUIDA** por ese documento el mismo día: si
> alguien la lee, está superada.

---

## 1. El cambio, en una frase

Las cuatro métricas de caja que leen `wallet_movimiento` **no reciben el mismo trato**: tres
pierden el `neto` porque es redundante por construcción, y `egresos` lo **conserva** porque gana
`ingreso_ajuste` en su definición y deja de ser redundante.

| | Métricas | Qué pasa |
|---|---|---|
| **Q1** | `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` | Retiran la distinción: publican **solo `bruto`**. |
| **Q2** | `egresos` | `definicion.categorias` pasa de **8 a 9** (gana `ingreso_ajuste`) y **conserva `bruto` + `neto`**. El `neto` pasa a significar *lo que realmente salió de caja*, con las anulaciones descontadas. |

**Por qué son dos casos y no uno** (⟨D12⟩ §2): las tres de Q1 declaran listas homogéneas de
prefijo `ingreso_*` y, con el `CHECK` categoría↔tipo de la 173
(`db/migrations/20260803120000_caja_tesoreria/migration.sql:61-71`), cada categoría admite un
solo `tipo`. Luego `Σ egreso = 0` siempre y `neto = +bruto` siempre: el campo no informa de nada.
`egresos` era el mismo caso con el signo cambiado (`neto = −bruto`), pero
`WalletEgresoService.ts:89-103` revierte un egreso anulado emitiendo un `ingreso_ajuste` que la
métrica **no declara** — o sea que hoy **anular un egreso no lo descuenta nunca de la cifra**.
Con `ingreso_ajuste` dentro, la lista deja de ser homogénea y el `neto` deja de ser degenerado.

## 2. Alcance

**Dentro:** el catálogo (`lib/analytics/metrics.ts`, solo las cuatro entradas y solo lo que
⟨D12⟩ autoriza), el contrato de salida (`lib/types/analitica-financiera.ts`), el servicio
(`lib/services/AnaliticaFinancieraService.ts`, método `deCaja` y el mapa de despacho), y el
mínimo de frontend que eso arrastra (`app/(app)/analitica/_components/financiero/adaptar.ts` y
`TableroFinanciero.tsx`).

**Fuera, por ⟨D12⟩ §4:**

- `deTesoreria` y las dos métricas de la 173 (`dinero_en_caja`, `ganancia_ordenex`): mezclan
  prefijos a propósito y su `neto` significa algo real.
- `deRecaudo`: la vista A (`bruto === neto` **declarado a propósito**,
  `AnaliticaFinancieraService.ts:297-299`) y la vista B (ledger de tienda, neto real).
- Las dos cuentas por pagar y `conciliacion_cierres`.
- `NATURALEZA_POR_CATEGORIA` (`lib/utils/caja-tesoreria.ts:43-64`): **intocable**.
- Añadir o quitar métricas del catálogo: los 25 ids siguen intactos.

---

## 3. Requisitos

Notación EARS. Cada requisito lleva su *Mutación*: el cambio que lo rompe y que su test tiene que
matar (convención de `specs/127-analitica-financiera-servicios/requirements.md`).

### 3.1 Q1 — las tres métricas retiran la distinción

**R1.** CUANDO se consulte `ingreso_flete`, `ingreso_comision_cod` o `ingreso_iva`, el sistema
DEBE devolver un importe que publique **`bruto` y `moneda` y ningún `neto`**: ni con valor, ni en
`null`, ni con la clave presente y vacía.
*Mutación:* seguir publicando `neto` con el valor del bruto → el test que serializa el DTO de las
tres y busca la clave `neto` la encuentra.

**R2.** DONDE un importe no publique `neto`, el sistema DEBE hacer que **leer ese campo no
compile**. NO DEBE resolverse en ejecución devolviendo `undefined`.
*Mutación:* declarar el campo como opcional en el tipo compartido → el caso con
`@ts-expect-error` que intenta leer el `neto` de un importe sin neto deja de fallar en
compilación y `pnpm run typecheck` lo delata como directiva no usada.

**R3.** CUANDO se consulte cualquiera de las tres métricas de Q1, el `bruto` DEBE valer
exactamente lo mismo que antes de esta feature: la Σ sin signo de las filas de sus categorías
declaradas en la ventana `[desde, hasta)`.
*Mutación:* pasar a publicar como `bruto` el resultado de `derivarBalance` → un rango con
importes conocidos devuelve el mismo número con signo en vez del volumen.

**R4.** El sistema NO DEBE modificar `definicion.categorias` de `ingreso_flete` (2),
`ingreso_comision_cod` (1) ni `ingreso_iva` (3), ni ninguna otra entrada de esas tres.
*Mutación:* aprovechar el PR para tocar una lista → el guardia R51 de la 173
(`metrics-caja-naturaleza.guardia.test.ts:72-86`) se pone rojo.

### 3.2 Q2 — `egresos` gana `ingreso_ajuste` y conserva el neto

**R5.** El catálogo DEBE declarar en `egresos.definicion.categorias` **nueve** categorías: las
ocho `egreso_*` vigentes, sin quitar ninguna, más `ingreso_ajuste`.
*Mutación:* sustituir una `egreso_*` por `ingreso_ajuste` en vez de añadirla → el test que
compara la lista contra las ocho históricas ve una que falta. **Y la consulta que de verdad se
emite** tiene que verse: un caso a nivel de repositorio DEBE afirmar que `where.categoria.in`
lleva las nueve, porque un doble de servicio no ve el `WHERE`.

**R6.** CUANDO se consulte `egresos`, el sistema DEBE devolver un importe con **`bruto` y
`neto`**.
*Mutación:* aplicarle la retirada de Q1 → el test que lee el `neto` de `egresos` no compila.

**R7.** CUANDO el rango consultado contenga un egreso y su anulación por el mismo monto (la
pareja real: una fila `egreso_*` de tipo `egreso` y una fila `ingreso_ajuste` de tipo `ingreso`),
el sistema DEBE devolver `neto = "0.00"` y `bruto = 2 × monto`.
*Mutación:* dejar la definición en ocho categorías → el `neto` sigue siendo `−monto` y el `bruto`
`monto`, que es el defecto que ⟨D12⟩ §2 nombra.

**R8.** El `neto` de `egresos` DEBE producirlo `derivarBalance` (`Σ ingreso − Σ egreso`), el
sistema NO DEBE reimplementar esa resta, y el **signo se conserva**: una salida neta de caja se
publica negativa, como hoy.
*Mutación:* escribir la resta en el servicio → el espía sobre `derivarBalance` no registra la
llamada. *Mutación 2:* publicar el valor absoluto → el caso de la salida neta ve `750.00` donde
espera `-750.00`.

**R9.** MIENTRAS el rango consultado no contenga ninguna fila `ingreso_ajuste`, `egresos` DEBE
devolver **exactamente los mismos `bruto` y `neto`** que devolvía con la definición de ocho
categorías. En particular, sobre el censo medido en producción el 2026-08-04 (4 filas
`egreso_pago_mensajero` = ₡22.000,00 y 1 fila `egreso_indemnizacion` = ₡42,40, **cero** filas
`ingreso_ajuste` y **cero** `egreso_ajuste`) el resultado DEBE ser `bruto = "22042.40"` y
`neto = "-22042.40"`.
*Mutación:* meter `ingreso_ajuste` **restando** en el bruto, o cambiar el orden de la resta del
neto → la cifra se mueve sobre un censo donde no puede moverse. **Se comprueba contra Postgres**,
no solo con dobles (ver §5).

**R10.** El sistema NO DEBE cambiar `id`, `etiqueta`, `estadoProduccion`, `granos`, `fuente` ni
`alcance` de `egresos`.
*Mutación:* tocar cualquiera de ellos → los guardias de censo del catálogo (produción, alcance,
fuente única) se ponen rojos.

**R11.** La `descripcion` de `egresos` en el catálogo DEBE declarar que **desde esta feature la
anulación de un egreso se descuenta de la cifra**, y DEBE conservar lo que ya declaraba: que son
salidas de la caja principal, el cambio de la 173 (el dinero entregado a las tiendas) y la
coletilla de las gestiones anuladas.
*Mutación:* borrar la frase nueva → el caso que la exige se pone rojo. **Y la aserción tiene que
discriminar**: el texto pre-183 se guarda como fixture literal en el propio archivo de test y se
comprueba que **no** pasa el predicado, exactamente como se arregló R53 de la 173
(`metrics-caja-naturaleza.guardia.test.ts:159-218`) tras el hallazgo de que «borrar la
descripción dejaba la suite entera en verde» (`progress/current.md:169-171`).

**R12.** El bloque de `egresos` en el catálogo DEBE citar `progress/decision_183.md` y escribir
su fecha (2026-08-04), y la guardia que ata catálogo y decisiones humanas DEBE quedar verde **por
construcción, no por exención**.
*Mutación:* cambiar la definición sin citar la decisión, o citar una fecha que el documento no
lleva → `catalogo-produccion.guardia.test.ts:376-455` se pone rojo.

### 3.3 Lo que esta feature NO puede tocar

**R13.** El sistema NO DEBE modificar `NATURALEZA_POR_CATEGORIA`: `ingreso_ajuste` sigue siendo
`propio`.
*Mutación:* reclasificarlo como `terceros` para «que no cuente» → sube la ganancia al anular un
pago a tienda, y `caja-tesoreria.test.ts` más el guardia de naturaleza se ponen rojos.

**R14.** Las otras siete métricas financieras (`cod_recaudado` en sus **dos** vistas,
`dinero_en_caja`, `ganancia_ordenex`, `cuenta_por_pagar_tienda`, `cuenta_por_pagar_mensajero`) y
`conciliacion_cierres` DEBEN seguir publicando exactamente lo que publican hoy, `neto` incluido.
*Mutación:* generalizar la retirada «porque es más limpio» → el test que recorre las diez
métricas servidas y afirma la forma de cada una ve una de menos.

**R15.** El sistema NO DEBE cambiar el censo del catálogo (25 métricas: 15 operativas + 10
financieras) ni `IDS_FINANCIERAS_SERVIDAS` (10 ids, en su orden).
*Mutación:* añadir un id auxiliar → el guardia de correspondencia catálogo↔servicio se pone rojo.

**R16.** El sistema NO DEBE incluir migración de base de datos, cambio de esquema Prisma, cambio
de RLS ni escritura de datos. El cambio es de **definición y de contrato**, no de datos.
*Mutación:* añadir una migración → el censo de migraciones exige `down.sql` y el diff delata una
tabla o un enum tocados donde no hacía falta.

**R17.** El repositorio de la caja NO DEBE ganar ninguna lista de categorías escrita a mano ni
ninguna consulta nueva: la lista sigue saliendo de `consulta.metrica.definicion.categorias`.
*Mutación:* clavar las nueve en el repositorio → el test que altera la definición del catálogo en
memoria y espera que la consulta cambie no ve el cambio (R17 de la 127,
`financiera-ingresos-repo.test.ts:139-164`).

### 3.4 Forma del contrato

**R18.** Todos los importes de **una misma vista** (su `total` y todas sus filas) DEBEN tener la
misma forma: o los dos campos, o solo el bruto. NO DEBE existir una vista que mezcle.
*Mutación:* construir el total con una forma y las filas con otra → el guardia que recorre las
diez métricas servidas y compara la forma del total con la de cada fila lo detecta. (Este
requisito es la red que la feature **180** necesita: multiplica por ~62 los sitios donde se emite
un importe.)

### 3.5 Frontend — el tablero financiero

**R19.** CUANDO un panel reciba un importe **sin `neto`**, el tablero DEBE pintar el `bruto` como
cifra del KPI y NO DEBE pintar una etiqueta «Neto», ni un guion, ni el marcador de dato ausente
en su lugar.
*Mutación:* pintar `null` donde iba el neto → el marcador de ausente aparece en el panel, y el
test lo encuentra. Es la colisión que hay que evitar: en la 132 el ausente significa **«no se
sabe»** (R15), y aquí la verdad es **«no aplica»**.

**R20.** CUANDO un panel reciba un importe **con los dos campos**, el tablero DEBE seguir
mostrándolos **los dos y distinguibles entre sí** (R16 de la 132, conservado donde hay material).
*Mutación:* unificar todos los paneles en «solo bruto» → el panel de `egresos` y la tabla de
`cuenta_por_pagar_tienda` pierden el neto y sus tests se ponen rojos.

**R21.** CUANDO se dibuje una gráfica de una vista **sin `neto`**, el sistema DEBE emitir **una
sola serie** (la del bruto). La serie doble solo DEBE emitirse donde el importe trae los dos.
*Mutación:* emitir dos series iguales → el test que cuenta series de esa gráfica ve dos donde
espera una, y el techo `MAX_SERIES` se consume al doble sin motivo.

**R22.** El tablero DEBE decidir qué pinta **por la forma del DTO** y NO por una lista de ids de
métrica escrita en el frontend (R27 de la 132, que sigue vigente).
*Mutación:* un `if (metricaId === "ingreso_flete")` en el tablero → el guardia de censo del
tablero (`tests/unit/guards/tablero-financiero.guardia.test.ts`) detecta el id financiero escrito
en el componente.

**R23.** El adaptador NO DEBE convertir la ausencia de `neto` en `null`, en `0` ni en una cadena
vacía, ni DEBE derivarlo a partir del bruto.
*Mutación:* `neto: importe.neto ?? bruto` → el test que compara la fila adaptada de una vista sin
neto encuentra la clave `neto` donde no debe haber ninguna.

### 3.6 Los tests que esta feature tiene que arreglar, no maquillar

**R24.** El sistema DEBE reexpresar los dos dobles en memoria que hoy afirman con filas que el
`CHECK` de la base **rechaza** —`tests/unit/analytics/financiera-ingresos-repo.test.ts:119-131`
(fila cruzada `egreso_ajuste` + `tipo: ingreso`) y
`tests/unit/services/analitica-financiera-derivacion.test.ts:170-187` (`ingreso_flete` +
`tipo: egreso`)— y el caso de cancelación DEBE escribirse **con el par real**: `egreso_*` de tipo
`egreso` más `ingreso_ajuste` de tipo `ingreso`, sobre `egresos`.
*Mutación:* dejar la fila imposible y solo cambiar el número esperado → el test sigue midiendo un
estado que la base no admite, que es exactamente lo que la 173 dejó pendiente para esta ficha.

**R25.** El sistema NO DEBE dejar en la suite ninguna afirmación de que `egresos` declara **ocho**
categorías **todas** con prefijo `egreso_`, ni de que el `neto` cero **no es alcanzable con datos
legales**. Esas aserciones se **dan vuelta** —pasan a afirmar las nueve, ocho `egreso_*` más
`ingreso_ajuste`, y el neto cero alcanzable con el par real—, **no se borran**.
*Mutación:* borrarlas para que el PR quede verde → el hueco se queda sin vigilancia, que es lo
que ⟨D10⟩ prohibió por escrito («hay que darlo vuelta, no borrarlo»,
`progress/decision_C2_127.md:53-57`).

### 3.7 Requisitos vivos de features `done`

**R26.** El sistema DEBE dejar **rastro fechado** de la acotación de los requisitos vivos que esta
feature cambia, en el spec de cada feature afectada y citando ⟨D12⟩:

| Feature | Requisito | Qué le pasa |
|---|---|---|
| 127 | **R16** («…**en sus dos campos `bruto` y `neto`**», nombrando las tres de Q1 una por una) | **Acotado**: las tres publican solo `bruto`. El resto de R16 —la Σ de *exactamente* las categorías declaradas y la ventana `[desde, hasta)`— sigue vigente. ⚠️ **Añadido el 2026-08-04 tras el review (B1): este spec no lo había visto**, siendo el requisito vivo más directamente derogado. |
| 127 | **R18** («la Σ de las **ocho** categorías `egreso_*`») | **Acotado**: pasan a ser nueve, ocho `egreso_*` más `ingreso_ajuste`. El resto de R18 (no existe `no_producida`) sigue intacto. |
| 127 | **R37** («toda métrica de ledger devuelve **dos** importes») | **Acotado**: sigue valiendo para toda métrica cuyo neto no sea redundante por construcción; deja de aplicar a las tres de Q1. |
| 132 | **R14** (ninguna cifra derivada) | **Intacto**. Sigue valiendo palabra por palabra. |
| 132 | **R16** («cada panel muestra el `bruto` **y** el `neto`») | **Reinterpretado**: cada panel muestra **todos los importes que su DTO trae**, y cuando trae los dos, distinguibles. Lo fijan R19 y R20 de esta feature. |

*Mutación:* aplicar el cambio sin anotarlo → quien lea la 127 o la 132 encuentra un requisito que
el código ya no cumple y no sabe por qué. El precedente de forma es la T22 de la 160, que anotó la
derogación de R2/R11 de la 148 en el spec de la 148
(`specs/160-badge-intentos-entrega/tasks.md:300-302`).

### 3.8 Verificación

**R27.** Cada `R<n>` de este documento DEBE quedar mapeado a un test concreto en
`progress/impl_183.md`, y el mapa DEBE construirse **leyendo el caso citado** y comprobando que
verifica lo que el requisito pide. NO DEBE usarse como evidencia el conteo de menciones `R\d+` en
títulos de test: esa técnica **cruza espacios de nombres** entre features y ya produjo en este
repo un falso 68/68 (`progress/current.md:227-228`,
`progress/review_173-caja-tesoreria.md:117-120`).
*Mutación:* citar un archivo que no existe o un caso que no mide el requisito → es el defecto
exacto que el reviewer de la 173 encontró cuatro veces; el reviewer lo comprueba archivo a
archivo.

---

## 4. Criterio de aceptación de la feature

1. `./init.sh` completo en verde antes del PR, sin excepción (`docs/verification.md`).
2. El diff sobre `lib/analytics/metrics.ts` se lee entero de un vistazo y es **exactamente**:
   las nueve categorías de `egresos`, su descripción y el comentario que cita ⟨D12⟩. Nada más.
3. Los párrafos §2 y §4 de `progress/decision_183.md` viajan al **cuerpo del PR** (precedente
   ⟨D10⟩, `progress/decision_C2_127.md:47-49`).
4. `progress/impl_183.md` con el mapa R→test completo, construido como exige R27.

---

## 5. Cómo se comprueba la cifra (R9), y por qué no basta un doble

Los tests de servicio usan dobles y **no ven el SQL**: el `where.categoria.in` que decide qué
filas entran en `egresos` es justo lo que cambia. Por eso R5 y R9 exigen **tres niveles**:

1. **Repositorio** — un caso que inspecciona el `where` emitido y afirma las nueve categorías.
2. **Integración contra Postgres** — sembrando en transacción revertida el censo de producción
   (4 + 1 filas, cero `ingreso_ajuste`) y afirmando `22042.40` / `-22042.40`; y un segundo caso
   con el par real que afirma `neto = "0.00"`. Es el mismo patrón que ya usa
   `tests/integration/actions/analitica-financiera-action.test.ts`.
3. **Medición post-merge por MCP** contra producción, **de solo lectura**, para confirmar que la
   cifra publicada sigue siendo ₡22.042,40. Límite conocido y declarado: el MCP de este repo está
   fijado al proyecto de **producción**; **preview no es verificable por esa vía**.

---

## Preguntas abiertas — **LAS CUATRO CERRADAS POR EL HUMANO EL 2026-08-04**

> ✅ **PUERTA CERRADA. Las cuatro se ratificaron con su recomendación y default: P1=(a) el bruto
> es volumen movido · P2=(a) etiqueta «Bruto», sin línea secundaria · P3=(a) el neto de `egresos`
> conserva su signo negativo · P4=(a) sí, nota fechada al margen en `specs/127-*` y `specs/132-*`.**
> No las reabra el implementer: están cerradas y son ejecutables tal como se recomiendan abajo.

Cada una lleva la recomendación que se ratificó.

**P1 — ¿El `bruto` de `egresos` cuenta la anulación como volumen?** Con `ingreso_ajuste` dentro y
la regla ⟨D1(c)⟩ («el `bruto` es la Σ de las categorías nominales, sin signo»), anular un pago de
₡400 hará que el `bruto` de `egresos` **suba** a ₡800 mientras el `neto` baja a ₡0. Se lee como
«hubo más egresos» cuando hubo menos. La alternativa sería definir el `bruto` de `egresos` como Σ
solo de las ocho `egreso_*`, pero eso es una **segunda** definición de bruto dentro del mismo
contrato. ⟨D12⟩ no lo resuelve.
*Recomendación y default:* **mantener ⟨D1(c)⟩** (el bruto es volumen movido) y que la descripción
del catálogo lo diga con todas las letras (R11).

**P2 — ¿Con qué etiqueta se pinta el KPI de las tres métricas de Q1?** Hoy el KPI lleva la
etiqueta «Neto» y el bruto va en una línea secundaria (`TableroFinanciero.tsx:161-177`). Sin neto
queda una sola cifra sin etiqueta decidida.
*Recomendación y default:* la etiqueta **«Bruto»** que ya existe en `TEXTOS`, sin línea
secundaria. Descartado dejarla sin etiqueta: el nombre de la métrica ya está en la cabecera de la
sección, pero el KPI sin etiqueta pierde el nombre accesible que la 132 le dio.

**P3 — ¿El KPI de `egresos` sigue pintando el neto negativo como cifra principal?** Hoy pinta
`-22.042,40` bajo el título «Egresos», y con el nuevo significado seguirá siendo negativo (es una
salida). No es incorrecto, pero un «−» delante de una métrica que ya se llama *Egresos* se lee
dos veces.
*Recomendación y default:* **conservarlo tal cual**. Cambiar la presentación del signo no está en
⟨D12⟩ y tocaría `formatearValor`, que es del paquete de la 130.

**P4 — ¿Se anotan las notas de corrección dentro de `specs/127-*` y `specs/132-*` (R26)?** Son
specs de features `done` y mergeadas.
*Recomendación y default:* **sí, anotarlas** como nota fechada al margen del requisito afectado,
sin reescribir el texto original. Precedente idéntico y aceptado: T22 de la 160 sobre la 148.
