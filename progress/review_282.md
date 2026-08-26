# Feature 282 — Revisión

> Rama `feature/282-etiquetas-pdf-solape-y-colon`, HEAD `897bf397`. Revisión hecha
> el 2026-08-25 sobre el árbol commiteado, con gate propio, mutaciones propias y
> sondas de medida propias. No se editó una sola línea de código de la feature: lo
> único que esta revisión añade al repo es este archivo.
>
> **Contexto que cambia el listón:** la app sale a uso comercial mañana y estas
> etiquetas las va a imprimir gente real, con nombres y direcciones que nadie ha
> medido. Todo lo de abajo se juzgó con ese criterio.

## 1. Veredicto

**RECHAZADO — 1 bloqueante, y es formal.**

El trabajo técnico está, en mi medida, por encima de lo que la ficha pedía: el
glifo se verifica sobre los bytes del PDF y se pone rojo cuando lo vacío, el solape
se deriva y muerde en los dos generadores y en las cuatro hojas, la maqueta
compartida tiene sus tres capas y la primera muerde, y las dos sustituciones sobre
tests ajenos endurecen en vez de relajar. Los 34 requisitos tienen test que existe
y pasa.

Lo que falta es de libreta: **tasks.md tiene las 29 tareas sin marcar**, y
CHECKPOINTS.md lo exige explícitamente. Es el mismo bloqueante por el que se
rechazó la 283 en su primera ronda; no se puede aplicar una vara distinta dos
fichas después. Se cierra en minutos.

## 2. Mi gate

`pnpm run db:generate` primero, y `./init.sh` completo con el código de salida
escrito DENTRO del log (nada de tail, que ya truncó un rojo en este repo).

```
DBGEN_EXIT=0
-> typecheck   OK (0 errores)
-> lint        OK (0 errores, 100 warnings, los preexistentes)
-> test        vitest run
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
 + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
 Test Files  1 failed | 1401 passed (1402)
      Tests  1 failed | 19092 passed | 26 skipped (19119)
   Duration  398.35s
INIT_EXIT=1
```

**Delta contra lo reportado por el implementer: 0.** Mismo número de archivos
(1.402), mismos 19.092 verdes, 26 skipped, y el mismo y único rojo en la misma
línea (superficie-de-uso.guardia.test.ts:687).

Que el rojo es AJENO no lo acepté de palabra, lo comprobé:

- el diff de la rama contra el merge-base, filtrado por tarifa/superficie: vacío;
- el commit que introdujo `obtenerTarifa` (b7bd887a, ficha 273) es ANCESTRO del
  merge-base 9e82aee1: el rojo ya venía en dev antes de esta rama.

Bien hecho no haberlo tocado.

**Aviso operativo, no hallazgo:** origin/dev se movió tres commits (PR #498, filtro
por mensajero) después del merge-base de esta rama. No hay solape de archivos con
el diff de la 282, pero mi gate es el del árbol de la rama: antes de mergear hay
que traer dev y volver a correrlo.

## 3. CHECKPOINTS, punto por punto

### Especificación
- [x] requirements.md con EARS numerados R1-R34.
- [x] design.md con alternativas descartadas y su porqué (A1-A12, doce, varias con
      el motivo medido).
- [ ] **tasks.md con todas las tareas marcadas: NO. Las 29 siguen sin marcar.**
      **BLOQUEANTE-1.**

### Trazabilidad
- [x] Cada R mapea a al menos un test concreto (los 34 abiertos uno a uno, §4).
- [x] progress/impl_282.md contiene el mapa R -> test, y es correcto: contrasté los
      nombres de los tests contra los archivos.

### Calidad de código
- [x] typecheck sin errores (dentro de mi gate).
- [x] lint sin errores (100 warnings preexistentes, ninguno nuevo).
- [x] pnpm test: 19.092 verdes; el único rojo es ajeno y preexistente.
- [-] E2E: INAPLICABLE. Este repo no tiene arnés de Playwright y la feature no toca
      auth, pagos, recaudo, ingesta ni webhooks. El riesgo de píxeles lo cubre T15,
      visto en Chrome real y con lo que NO cubre escrito (§5.7).

### Datos y seguridad
- [x] Sin tablas nuevas: RLS no aplica. El diff no toca db/.
- [x] Sin migraciones: down.sql no aplica.
- [x] Sin secretos. El artefacto es una fuente libre (OFL 1.1) con su licencia
      íntegra commiteada.
- [x] Webhooks: no aplica.

### Patrón de capas
- [x] lib/pdf no conoce HTTP ni Prisma; el borde de API sigue llamando al service y
      el service al builder. La ruta carga/route.ts NO cambia.
- [x] La vista previa recibe la familia tipográfica por prop; EtiquetaGuia.tsx no
      importa el artefacto, así que no puede arrastrarlo al bundle inicial.
- [x] Sin Server Actions nuevas.

### Multi-país / configuración
- [x] Nada hardcodeado: el símbolo sale de monedaConfig.simbolo y el test de
      cobertura lo lee DE LA CONFIGURACIÓN, no escrito a mano. Comprobé además que
      formatMonto no pasa por Intl para la salida (usa separadorMiles), así que el
      alfabeto del importe es dígitos + separador + signo + símbolo: no hay
      espacios finos U+202F colándose por un cambio de locale.

### Verificación final
- [ ] ./init.sh en verde: NO, INIT_EXIT=1 por el rojo ajeno de la 275. No lo cuento
      como bloqueante de esta ficha (delta 0, rojo de otra sesión), pero queda
      escrito que dev está rojo y que quien cierre tiene que saberlo.
- [x] progress/review_282.md existe (este archivo).
- [ ] Entrada en progress/history.md: PENDIENTE (cierre del leader).

## 4. Trazabilidad R1-R34: abrí los 34

Leyenda: **medido** = lo maté con una mutación mía o lo sondé con una medida mía;
**leído** = abrí el test y comprobé que afirma el requisito y no otra cosa.

| R | Test | Veredicto |
|---|---|---|
| R1 | etiquetas-maqueta.test.ts (1 em) + etiquetas-pdf.test.ts (medido en el PDF, 4 hojas) | **medido** |
| R2 | etiquetas-maqueta.test.ts «SI el cuerpo cambia…» y «un valor fijado a mano…» | leído: camposYInicio(44) distinto de camposYInicio(22) mata el hardcode |
| R3 | etiquetas-pdf.test.ts, bucle sobre HOJAS_ETIQUETA + escalado en maqueta | **medido** |
| R4 | etiquetas-pdf.test.ts: los siete rótulos, ordenados por la y del PDF | leído |
| R5 | etiquetas-pdf.test.ts (banda del QR) + lote (ninguna línea baja del borde) | leído; mi sonda: última línea 65,76 mm contra el límite 66 |
| R6 | corpus direccion-3-lineas sin marca de recorte | **medido: NO es un verde vacío** (§5.2) |
| R7 | etiquetas-pdf.test.ts: los nueve datos enteros + el importe literal con símbolo | leído |
| R8 | recurso Type0 + Identity-H + FontFile2 + BaseFont | leído |
| R9 | decodificado por el ToUnicode del propio PDF, igual a formatMonto(18000) Y al literal | leído |
| R10 | contorno + tieneTinta del CID dentro del FontFile2 extraído | **medido: rojo al vaciar el glifo** |
| R11 | cp1252 desde fixture independiente + igualdad exacta de los sin tinta | **medido: rojo al degradar tieneTinta** |
| R12 | solo el monto es Type0; el resto Type1 Helvetica; reparto igual en las 4 hojas | leído |
| R13 | guardia de carga diferida + medición sobre el build | **medido sobre el build** (§5.6) |
| R14 | peso declarado igual al real (ttf y base64), tope y objetivo | leído; el sha256 declarado lo confirmé al revertir mi mutación |
| R15 | FontFile2 <= 12 KB y constante al crecer las páginas, en los dos | leído; mi medida: 3.408 B inflado en ambos |
| R16 | etiquetas-pdf-descarga.test.ts (rechaza, save no se llama) + modal (mensaje, sin onSuccess) | leído |
| R17 | sha256 byte a byte, cabecera de procedencia, licencia OFL presente | leído |
| R18 | etiquetas-pdf-lote.smoke.test.ts reformulado | leído y **juzgado** (§5.4) |
| R19 | lote: separación mayor o igual a 1 em y la fila arranca en camposYInicio() | **medido** |
| R20 | los tres eslabones sobre el PDF del servidor | **medido: eslabón 3 rojo** |
| R21 | etiquetas-maqueta-unica.guardia.test.ts, con control positivo | leído |
| R22 | etiquetas-dos-generadores.test.ts: Td + texto de los dos PDF, 4 casos | **medido: 4 rojos al desviar UN generador** |
| R23 | guardia: import estático en el servidor, sin fs en lib/pdf, con control positivo | leído |
| R24 | estructural (un solo Type0 y un solo FontFile2 en 20 páginas) + f medido | leído; ver menor-5 |
| R25 | cupo mayor o igual a 9 | **medido: 10** |
| R26 | corpus sin marca de recorte en los dos generadores | **medido: consume 8-9 de 10 líneas; a 5 líneas de dirección sí recorta** |
| R27 | constantes de la maqueta fijadas + cuerpo de la guía medido en el PDF | leído |
| R28 | lanza con el code point + canal navegador + canal API best-effort | leído |
| R29 | COBERTURA igual a lo que cubre el archivo, exacto, y rangos ordenados | leído |
| R30 | puerta: U+20A1 con glifo distinto de 0 y contorno mayor que 0, y el símbolo CONFIGURADO | **medido: rojo al vaciar el glifo** |
| R31 | identidad del objeto artefacto + FontFace byte a byte + un solo archivo de fuente | **medido (M11)** |
| R32 | primera familia del importe igual a la registrada; cruce contra el BaseFont | **medido (M10 y M11)** |
| R33 | sin API de fuentes: devuelve null, no lanza, la vista previa se pinta | leído, con control positivo al lado |
| R34 | los seis no-ASCII decodificados DEL PDF, en los dos generadores | leído |

Ninguno queda sin test, y ninguno de los que abrí afirma algo distinto de lo que
dice cubrir.

## 5. Lo auditado con lupa

### 5.1 La verificación del glifo sobre los BYTES: muerde

Reproduje la mutación más fina que existe aquí (M3, la que separa declarado de
impreso): vacié el contorno del glifo de U+20A1 DENTRO del ttf commiteado (el
desplazamiento de inicio del glifo pasa a valer el de su fin, gid 222) sin tocar el
cmap, y regeneré el artefacto con el script del repo. El archivo conserva sus
16.944 bytes y sus 219 code points de cobertura: para todo lo que no mire la tinta,
la fuente sigue siendo idéntica.

```
gid=222 contorno antes=170 despues=0  (bytes del archivo: 16944)
cobertura: 219 code points en 19 rangos     <- sin cambio

  x U+20A1 tiene glifo con contorno NO VACIO en el archivo commiteado
  x el simbolo CONFIGURADO (no uno escrito a mano aqui) esta cubierto
  x eslabon 3 - el CID del simbolo tiene contorno NO VACIO en su /FontFile2  (servidor)
  x R10 - el CID del simbolo tiene CONTORNO NO VACIO dentro del /FontFile2   (cliente)
 Test Files  3 failed (3)
      Tests  4 failed | 49 passed (53)
VITEST_EXIT=1
```

Lo importante no es solo que salgan cuatro rojos: es CUÁLES siguen verdes. R8
(recurso Type0/Identity-H) y R9 (decodificación por el ToUnicode) PASAN con el
glifo vacío, que es exactamente el escenario que imprimiría papel en blanco. La
cadena de tres eslabones está bien construida y el tercero es el que aporta.
Revertido y comprobado: sha256 6603b80b..., el declarado en la cabecera del módulo.

**Sobre tieneTinta(), que no estaba en el spec.** Lo miré con desconfianza y sale
bien parado. Lo maté degradándolo a devolver «contorno mayor que 0», o sea
quitándole justo la resolución de compuestos que el implementer añadió:

```
  x todos dejan tinta salvo los dos que por diseño no la dejan (espacio y NBSP)
 Tests  1 failed | 21 passed (22)
```

La función añadida ESTÁ cubierta, y lo que la cubre es la igualdad exacta (los sin
tinta son exactamente U+0020 y U+00A0), no un contains complaciente. El hallazgo
que la motivó es real y está bien contado: el espacio duro de Liberation Sans es un
compuesto de 16 bytes con cero tinta, y contorno() por sí solo lo daba por lleno.
Dos matices pequeños en menor-3.

### 5.2 El solape: derivado, y el cupo cedido no rompe el peor caso

- Muté camposYInicio() a 18: **10 rojos** en tres archivos, incluidas las cuatro
  hojas medidas sobre el PDF y el generador del servidor. El test de divergencia se
  queda verde, que es lo correcto: los dos generadores se mueven a la vez.
- No queda ni un número a ojo en el camino: el barrido de literales numéricos en
  lib/pdf/etiquetas-dibujo.ts solo devuelve comentarios; los generadores no
  declaran constantes (la guardia lo vigila) y las de la maqueta base son las
  históricas de la feature 32, fijadas por R27.
- **El cupo cedido (11 -> 10), medido por mí sobre PDF reales del servidor:**

```
CUPO para 7 campos = 10   camposYInicio=23.7611   limiteTexto=66
caso evidencia            lineasValor=8  lineasDireccion=2  ultimaY=57.76  recorte=false
caso direccion-3-lineas   lineasValor=9  lineasDireccion=3  ultimaY=61.76  recorte=false
caso ubicacion-completa   lineasValor=8  lineasDireccion=1  ultimaY=57.76  recorte=false
caso alfabeto-real        lineasValor=8  lineasDireccion=2  ultimaY=57.76  recorte=false
```

  El caso de tres líneas DE VERDAD ocupa tres líneas (no es un test verde por
  vacío) y entra con una de holgura. Barriendo longitudes de dirección: con cuatro
  líneas naturales el PDF sale con 10 líneas y SIN recorte; el recorte aparece a
  partir de la quinta, exactamente lo que dice design.md §2.3. El peor caso
  conocido sigue entrando.

### 5.3 La maqueta compartida y sus tres capas

- **Capa 1 (R22) muerde.** Desvié la maqueta SOLO en el servidor (sumando 1,5 mm en
  su layout): rojo en los cuatro casos del corpus, más el test propio del servidor.
  Tests 5 failed | 16 passed.
- **Capa 2 (R21)** es una guardia sobre el texto de los dos generadores, CON
  control positivo (la maqueta compartida sí declara esos nombres), que es lo que
  impide que la prohibición esté verde por vacía.
- **Capa 3**, el compilador: al no existir ya las constantes locales hay que AÑADIR
  código para escribir un número a mano, en vez de olvidarse de actualizarlo.

**Sobre el límite que el implementer declaró (M7 en su primera forma):** lo doy por
bien juzgado y bien escrito. R22 corre los dos generadores en el mismo proceso
jsdom, así que una divergencia condicionada al runtime (una rama sobre typeof
document) no la ve. Que lo dijera él, con la salida VERDE pegada y sin taparlo con
una aserción cosmética, vale más que la aserción. Y su valoración de coste es
correcta: cerrar ese hueco pediría rasterizar el PDF del servidor en un proceso
Node aparte, y nadie escribe una rama sobre typeof document por accidente.

### 5.4 Cambio en test ajeno 1: el blindaje de la feature 150

**Legítimo, y afirma más que antes.** La aserción retirada (que el generador del
servidor no nombrara etiquetas-layout) era un PROXY: protegía que el PDF de los
integradores no ganara un tamaño de hoja mirando la ausencia de un import. Ese
proxy deja de ser sostenible en cuanto el módulo compartido vive precisamente ahí,
y mantenerlo habría obligado a duplicar la maqueta, que es el defecto que la ficha
cierra.

Lo que se puso en su lugar afirma la PROPIEDAD, no el proxy:

- MediaBox de 283,46 pt en TODAS las páginas, que es lo que de verdad rompería a
  los integradores;
- toHaveLength(1) sobre la firma pública;
- el catálogo sigue fuera (ni etiquetas-hoja ni HOJAS_ETIQUETA);
- crearLayoutBase() presente y la llamada con hoja ausente: el sustituto exacto del
  proxy retirado, porque es lo que impide que el servidor gane un tamaño elegible;
- y una aserción NUEVA de lo que la ficha sí cambia: el PDF consolidado embebe
  Type0 + Identity-H + FontFile2.

Lo único que se pierde es «este archivo no se ha tocado», que R18 revisado abandona
por decisión firmada (Q1). No veo relajación.

### 5.5 Cambio en test ajeno 2: fuera incluyeTexto y el tramo ASCII del monto

**También legítimo, y es un endurecimiento neto.** La aserción vieja buscaba el
tramo ASCII más largo del importe entre los bytes: NUNCA pudo ver el símbolo —era
literalmente el agujero por el que este bug llegó al usuario— y con Identity-H el
texto ya no viaja en ASCII. La nueva compara la cadena ENTERA decodificada por el
ToUnicode que el propio documento declara.

Dos cosas que miré antes de darla por buena:

- la nueva compara contra formatMonto(1234.5), o sea contra su propia fuente; pero
  AL LADO está el test de R9 que fija el literal con símbolo, así que el contrato
  queda anclado a un literal y no solo a la función. Sin ese literal habría marcado
  hallazgo: es el patrón «aserción contra su propia fuente» que ya mordió aquí.
- incluyeTexto quedaba sin uso en los dos archivos; borrarlo es correcto y no deja
  ninguna otra aserción huérfana (comprobado con grep).

### 5.6 El peso: la promesa rota, y el método de medida

**El hallazgo del implementer es cierto y lo reproduje.** Corrí next build sobre
este árbol (BUILD_EXIT=0): Next 16.2.10 con Turbopack, y la tabla de rutas sale con
Revalidate y Expire y nada más. No existe la columna Size ni First Load JS que
tasks.md mandaba copiar. La instrucción del spec es inejecutable, y derivar la
cifra de los manifiestos era la salida correcta.

**Verifiqué lo que sostiene la decisión, por una vía distinta a la suya:**

```
chunk que contiene el base64 del artefacto:
  static/chunks/33g7btaxb8tu0.js   crudo=23164 B   gzip=14150 B   <- coincide con la bitacora
esta en page_client-reference-manifest.js de /(app)/ordenes?    NO (0 apariciones)
esta en rootMainFiles / polyfillFiles de build-manifest.json?   NO (0 apariciones)
solo lo referencia otro chunk (3wh42r_glpn1s.js), que si es inicial: el stub del import()
```

Es decir: los 22,6 KB del artefacto NO entran en la carga inicial de /ordenes, que
es lo que R13 exige, y está comprobado sobre los bytes del build, no por argumento.

Lo que NO reproduje es la cifra absoluta de First Load JS (habría que construir
también el árbol anterior). La doy por razonable con una reserva escrita: una suma
derivada de manifiestos es un PROXY del número que Next imprimía, no el mismo
número; sirve para comparar dos builds del mismo repo, que es para lo que se usó.
El delta declarado (+2,0 KB crudos, +0,10 %) es código nuevo, no bytes de fuente.

Y lo valoro en positivo: la ficha prometía +0 KB, el número real no es 0, y en vez
de redondearlo se escribió con su cifra y su explicación. Es lo contrario del fallo
que esta ficha vino a cerrar.

### 5.7 T15 y lo que declara NO cubrir

Está escrito, y con nombre: el QR y el código de barras de los PDF de test salen
como PNG de relleno (jsdom no tiene canvas 2D) y su geometría la cubren R5/R27; y
la vista previa se montó SIN Tailwind, así que lo comparado fue el importe, que es
lo único que cambia de tipografía. Que la comprobación a ojo diga qué NO mira es
justo lo que la hace utilizable.

### 5.8 M10 y M11, repetidas por mí

```
M10 - el importe conserva un font-family (el de respaldo) pero pierde la del artefacto
  x la primera familia del importe es la que devolvio el registro
  x solo el importe cambia de tipografia: los demas valores no la llevan
  x R31: la familia registrada acaba aplicada al importe de la vista previa
  Tests  3 failed | 24 passed (27)   VITEST_EXIT=1

M11 - se registra en pantalla una familia con OTRO nombre que el del PDF
  x la FontFace se construye con los MISMOS bytes que se embeben en el PDF
  x es idempotente: abrir el modal dos veces no registra la familia dos veces
  x R33 - sin la API de fuentes no registra nada y NO lanza
  x el nombre registrado en document.fonts y el /BaseFont del importe coinciden
  Tests  4 failed | 23 passed (27)   VITEST_EXIT=1
```

**M10 está afilada de verdad:** el importe sigue llevando font-family, así que un
test de «lleva alguna familia» sobreviviría; el que hay compara la PRIMERA familia
contra la que devolvió el registro, y cae. Y el cuarto rojo de M11 es EL test de
R32: el que cruza document.fonts con el BaseFont extraído de los bytes del PDF. Sin
él, las dos mitades podrían funcionar por separado sin ser la misma fuente.

Que la primera formulación de M10 abortara sola (la mutación no cambiaba nada) y
quedara escrito es señal de que el arnés de mutaciones se autocomprueba, que es
justo lo que en este repo ya falló una vez.

## 6. Hallazgos

### BLOQUEANTE-1 — tasks.md con las 29 tareas sin marcar

specs/282-etiquetas-pdf-solape-y-colon/tasks.md: 29 tareas sin marcar, 0 marcadas.
CHECKPOINTS.md lo exige literalmente, y es el mismo motivo por el que la 283 se
rechazó en su primera ronda hace un día.

**Qué falta para cumplirlo:** marcar las hechas y, donde la tarea cambió de forma
durante la implementación, decirlo en su línea en vez de marcarla en silencio. Al
menos estas tres lo necesitan:

- **T6** se ejecutó dentro de **T17**: las constantes derivadas nacieron ya en
  lib/pdf/etiquetas-maqueta.ts, no en app/(app)/ordenes/_components/.
- **T4** cambió de archivo: tests/unit/pdf/etiquetas-fuente.test.ts.
- **T14** quedó SUPERADA por T29, como la propia ampliación de tasks.md declara.
  Marcarla a secas haría creer que se midió dos veces.

No pido reabrir nada: pido que el estado en disco diga la verdad, porque es lo que
va a leer quien toque esto dentro de seis meses.

### menor-1 — Un catch vacío en el modal, contra docs/conventions.md

EtiquetasGuiaModal.tsx, en el efecto que carga la fuente al abrir, tiene un catch
cuyo cuerpo es solo un comentario. docs/conventions.md dice «nada de catch
vacíos». El motivo está razonado y la DECISIÓN es correcta —quien avisa es la
descarga, no la vista previa—, pero el cuerpo vacío hace que un fallo real de carga
en el navegador de un operador no deje rastro en ningún sitio. Un console.warn con
el error cerraría la convención sin cambiar una letra de lo que ve el usuario.

### menor-2 — La deuda de R28 (§20) deja los DOS canales ciegos

Lo declarado es cierto y lo verifiqué en el código: el modal sustituye el error
técnico por el mensaje genérico y no lo registra; y en la API, el catch del borde
llama a describirErrorSeguro, que para un Error corriente guarda SOLO err.name (la
cadena "Error"). El code point que falta no aparece en ningún log de ningún canal.

**Juicio para mañana: aceptable**, y por dos razones medidas, no por indulgencia.
(a) El disparador es estrecho: comprobé que formatMonto NO pasa por Intl para la
salida, así que el importe solo puede contener dígitos, el separador de miles
configurable, el signo y el símbolo; con los valores de producción el subconjunto
los cubre. Solo se dispara si alguien cambia MONEDA_SIMBOLO o
MONEDA_SEPARADOR_MILES a algo fuera de cp1252. (b) Cuando se dispare, no imprime
una etiqueta rota: falla y no entrega nada, que es lo que R28 pide. Sigue siendo
deuda: si ocurre un lunes a las ocho, quien lo diagnostique tendrá que llegar al
código.

### menor-3 — tieneTinta no tiene test propio, y su rama simple es tautológica

- tests/unit/pdf/ttf-lector.test.ts NO la prueba: sus tres controles son de glifoDe
  y contorno, y el control de vacío usa el espacio, que es un glifo simple. Quien
  la cubre es la igualdad exacta de R11, en otro archivo; lo medí y muerde, así que
  NO hay agujero, pero el helper se autocomprueba menos de lo que promete su
  cabecera. Un cuarto control (el espacio duro: contorno mayor que 0 pero sin
  tinta) lo dejaría cerrado donde corresponde.
- en la rama de glifo simple, la comprobación final es siempre cierta, porque el
  valor comparado es un entero sin signo. El resultado es correcto por otra vía
  (que haya contornos ya implica tinta), pero la expresión aparenta comprobar algo
  que no comprueba.

### menor-4 — El corpus marca como real un caso que lo es a medias

CASO_ALFABETO_REAL lleva real: true. El ALFABETO sí está medido en producción; los
textos concretos son inventados. La bitácora y el propio fixture lo explican en
prosa, pero el booleano dice otra cosa. Es honestidad del corpus, no corrección.

### menor-5 — R24 no tiene aserción ejecutable de tiempo

La tabla de trazabilidad de tasks.md prometía «medición registrada + test de tiempo
por documento». Lo que hay es la medición (f = 0,79 ms, con método y percentiles,
creíble) y un test ESTRUCTURAL —un solo Type0 y un solo FontFile2 en un lote de 20
páginas— que es el que impide la regresión de verdad: que alguien meta
registrarFuente dentro del bucle de páginas. PREFIERO esto a un test de reloj, que
en este repo ya produjo rojos por carga; lo que hay que corregir es la fila de
tasks.md, no añadir el test.

### menor-6 — Números de la bitácora medidos con varas distintas

§3.2 presenta «Servidor 3.408 B / Cliente 4.172 B» de FontFile2 bajo el mismo tope.
Mi medida para el caso de la evidencia da 3.408 B inflado en LOS DOS (el servidor
almacena 1.636 B porque va con compress: true), y el 4.172 corresponde a otro
fixture con más glifos distintos. Ninguno se acerca al tope de 12 KB, así que no
cambia ninguna conclusión; la tabla simplemente compara cosas que no son la misma
medida y no lo dice.

### Nota ajena (no de esta ficha)

El árbol tiene cuatro archivos SIN RASTREAR en public/ (icon-192.png, icon-192.svg,
icon-512.png, icon-512.svg) con fecha de junio de 2026. No son de la 282 ni de mi
sesión; los dejo donde están y no entran en el commit de este informe. Alguien
debería decidir si se commitean o se ignoran.

## 7. Lo que un humano tiene que saber antes de imprimir para clientes reales

1. El colón se imprime de verdad: verificado sobre los BYTES del PDF, no sobre las
   llamadas, y cuando yo vacié el glifo la verificación se puso roja.
2. El solape se arregló en LOS DOS generadores a la vez —navegador y servidor— y la
   separación se DERIVA del cuerpo de la guía, así que vale en las cuatro hojas por
   construcción, no por haber probado cuatro casos.
3. Se cedió una línea de cupo (11 -> 10): el peor caso conocido (dirección de tres
   líneas) entra con holgura y una de cuatro entra justa; a partir de cinco líneas
   de dirección la etiqueta corta con puntos suspensivos, igual que antes pero un
   escalón antes.
4. Cambio de comportamiento que hay que aceptar a sabiendas: si la tipografía no
   llega al navegador (chunk que no baja, red mala en bodega), YA NO SE DESCARGA
   NADA y sale un mensaje. Antes salía una etiqueta con el importe roto. Es la
   decisión firmada, pero significa que un fallo de red ahora bloquea la impresión
   en vez de degradarla.
5. Los PDF individuales del canal de API pesan alrededor de 1,4 veces más (la
   fuente va embebida por documento); el consolidado apenas se entera. Coste ya
   firmado en Q9.
6. Si alguien cambia MONEDA_SIMBOLO o MONEDA_SEPARADOR_MILES a un carácter fuera de
   cp1252, dejan de generarse etiquetas —fallo visible, nunca una etiqueta rota— y
   el motivo NO queda escrito en ningún log: hay que mirar el código. Con los
   valores de producción de hoy no se dispara.

## 8. Para cerrar

Un solo cambio y esto pasa a OK: marcar tasks.md, con la nota de T6/T4/T14 para que
el estado en disco no mienta. Nada del código de la feature necesita tocarse; los
seis hallazgos menores son mejoras de diagnóstico y de precisión documental, y
ninguno afecta a lo que sale impreso.
