# Ficha 345 — La analítica pasa a decir qué productos se mueven

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`.
> Cada `R<n>` termina mapeado a un test concreto en `tasks.md § Trazabilidad`.

## Contexto

La analítica mide entregas, tiempos y dinero, pero **no dice nada de los productos**. Pedido
textual del humano (2026-09-01): «en la analítica se pueda analizar los productos, esto solo
aplicaría para la analítica del maestro y el admin y las tiendas solo ven la analítica de sus
propios productos teniendo en cuenta que los productos tienen este formato cantidad * producto por
ejemplo 1 * Dr Melaxin».

El dato ya existe entero: `orden.producto` es una columna `String` NOT NULL
(`db/schema.prisma:578`). **No hay que añadir columna ni tabla.** Lo que falta es interpretarla.

### Lo MEDIDO en producción antes de escribir este spec (solo lectura, no re-medir)

1. **768 órdenes, ninguna sin `producto`.**
2. El formato `cantidad * nombre` se cumple en **761 de 768**. Las 7 restantes son datos de
   prueba: `PRUEBA` (4), `PRUEBA 27 08 26` (2) y `Camiseta talla M` (1).
3. **El 12 % de las órdenes (94) lleva VARIOS productos.** El separador **no** es coma ni salto de
   línea (0 comas, 0 saltos medidos): es **punto + espacio**, y cada ítem termina en punto.
   Cadenas reales: `1 * Base Dr. 1 * BASE C.` · `1 * Dr Melaxin. 1 * BASE C.` ·
   `2 * Creatina Monohidratada. 1 * BASE C.` ·
   `1 * BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA. 3 * Dile Adiós a los Hongos | Aceite Milagroso 3X1.`
4. **Dos trampas, las dos medidas:** los nombres llevan **punto dentro** (`Base Dr.`), así que
   partir por `. ` es ambiguo; y llevan **barras verticales** de marketing, así que
   `BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA` es **UN** producto.
5. **Partirlo mal infla el catálogo casi al doble:** una regex razonable con anticipación
   (`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`) da **125** productos distintos donde el parseo correcto
   da **84**. 41 fantasmas, y un síntoma concreto: un producto llamado `"Base Dr. 1 * BASE C"`,
   dos productos fundidos en uno.
6. Cifras del parseo correcto: **855 líneas de producto**, **84 productos distintos**, cantidad
   máxima **6**, media **1,36**. Normalizar (minúsculas, quitar el punto final) **no colapsa
   ningún nombre**.
7. El cruce producto × resultado de la última gestión **ya demostró valor**: `Spray Protector`
   37,5 % de rechazo (16 órdenes), `AC ST` 37,5 %, `DEPILADOR MAGICO AFEITADO FACIL` 26,7 %
   (38 órdenes), `Creatina Monohidratada` 18,2 %, `Elimina Canas` 7,1 %, `Bálsamo Tensor` **0 %**
   sobre 29 órdenes. Hoy eso no lo ve nadie.
8. `Crema Especial MLX` aparece hoy en **2 tiendas distintas**; el resto, en una sola.

### Lo confirmado en el ARCHIVO REAL (no en el índice del MCP)

1. `lib/analytics/types.ts:70` — `AlcanceMetrica = "total" | "acotado" | "prohibido"` y
   `Metrica.alcance: Readonly<Record<RolAnalitica, AlcanceMetrica>>` (`:195`). `ROLES_ANALITICA`
   (`:54`) son los cinco roles lectores. Es el mecanismo de alcance que esta ficha usa.
2. `lib/analytics/metrics.ts:52` y `:65` — `ALCANCE_OPERATIVA` y `ALCANCE_FINANCIERA`, las dos
   tablas rol→alcance que existen, **privadas y en ese archivo**.
3. `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts:123` — «ningún archivo del repo
   fuera de `metrics.ts` declara una tabla de alcance por rol». El censo reconoce el DATO
   (`maestro: "total"`) en `app/`, `lib/`, `components/` y `scripts/`. Esto **decide dónde** puede
   vivir la tabla de esta ficha.
4. `lib/analytics/entregas-conteo.ts` — la vertical viva ya existente: su filtro
   (`conteoEntregasFiltroSchema`, 6 facetas + rango opcional), su tipo opaco
   `ConsultaConteoEntregas`, su recorte `recortarFiltroConteoEntregas` y sus seis claves de caché
   con prefijo propio. Su cabecera (`:6-13`) explica por qué esta clase de lectura **no entra en
   el catálogo de 25 métricas**, que está congelado por decisión humana.
5. `lib/repositories/ConteoPorStatusRepository.ts` — `condicionesDeConsulta()` (pura y exportada)
   y el `LEFT JOIN LATERAL … LIMIT 1` que fija el desenlace de cada orden: **el `resultado` de su
   última gestión vigente y, si nunca se gestionó, el `value` de su `order_status`**. Ésa es la
   regla de bucket que esta ficha reutiliza tal cual.
6. `app/(app)/analitica/_components/entregas/efectividad.ts` — `calcularEfectividad(porStatus)`
   devuelve `entregadas`, `enProceso`, `total`, `efectividad` y `efectividadGestion`, con el
   denominador **explícitamente decidido**: el universo entero del recorte, incluidas las órdenes
   en proceso. Es la única definición de «efectividad» del tablero.
7. `app/(app)/analitica/page.tsx` y `AnaliticaShell.tsx` — **las regiones «Filtros», «Tablero
   operativo» y «Tablero financiero» del shell están COMENTADAS**: hoy sólo se pinta el slot
   `destacado`. Un panel colgado del catálogo operativo no se vería.
8. `tests/unit/analytics/alcance-obligatorio.guardia.test.ts:120` — `TIPOS_OPACOS` es una lista de
   dos, y su comentario declara el criterio de admisión de un tercero: marca `unique symbol`.
9. `tests/unit/descarga/` — el molde de contrato de descarga: `censo-tablas.ts` (registro),
   `cobertura-tablas.guardia.test.ts` (totales medidos contra el árbol),
   `columnas-asercion-de-orden.guardia.test.ts` (exige `toEqual` de orden por constante) y
   `columnas-sensibles.guardia.test.ts` (descubre por nombre `*-descarga-columnas.ts`).

### El límite innegociable

**Nada de dinero por producto.** El cobro vive en la ORDEN y en el 12 % multiproducto repartir el
flete entre productos sería inventar una cifra. Esta analítica es de **volumen y efectividad**.

---

## 1 — Quién ve qué

**R1.** El sistema DEBE declarar el alcance del análisis de productos en UNA sola tabla, exhaustiva
sobre los cinco roles lectores de analítica, de modo que omitir un rol NO compile.

**R2.** MIENTRAS el actor tenga acceso total (`maestro`, `admin`), el sistema DEBE calcular los
productos sobre las órdenes de TODAS las tiendas.

**R3.** MIENTRAS el actor sea `adminTienda`, el sistema DEBE calcular los productos ÚNICAMENTE
sobre las órdenes de su propia tienda.

**R4.** SI el actor es `adminSatelite` o `mensajero`, ENTONCES el sistema NO DEBE devolver ninguna
cifra de productos: ni recortada, ni agregada, ni en cero.

**R5.** SI el actor es `adminSatelite` o `mensajero`, ENTONCES el sistema NO DEBE renderizar la
sección de productos: ni su encabezado, ni un estado vacío en su lugar.

**R6.** El conjunto de roles a los que esta tabla concede alcance `total` DEBE ser exactamente el
que declara la fuente única de acceso total del repo, y no una lista escrita a mano.

**R7.** SI la petición trae un filtro de tienda que no incluye la tienda que el alcance del actor
le concede, ENTONCES el sistema DEBE denegar la lectura, y NO devolver un resultado vacío.

**R8.** El sistema NO DEBE aceptar el alcance por la entrada del cliente: una clave desconocida en
el filtro DEBE ser un error de validación.

**R9.** CUANDO el sistema deniegue una lectura de productos, DEBE dejar un rastro con el motivo y
SIN ids ajenos, PII ni contenido de la sesión, y responder al cliente sin revelar cuál de los
motivos fue.

## 2 — El parser (el corazón)

**R10.** El sistema DEBE interpretar el texto de producto de una orden como una LISTA de ítems,
cada uno con una cantidad entera y un nombre.

**R11.** CUANDO el texto contenga uno o más marcadores de cantidad (un entero seguido de `*`), el
sistema DEBE partir el texto EN esos marcadores, y NO por el punto ni por la barra vertical.

**R12.** CUANDO un nombre de producto contenga un punto interno (`Base Dr.`), el sistema DEBE
conservarlo dentro de su ítem: `1 * Base Dr. 1 * BASE C.` DEBE producir EXACTAMENTE dos ítems.

**R13.** CUANDO un nombre contenga barras verticales, el sistema DEBE tratarlo como UN solo
producto: `1 * BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA.` DEBE producir
un único ítem.

**R14.** El sistema NO DEBE producir NINGÚN nombre de producto que contenga el carácter `*`.

**R15.** SI el texto no contiene ningún marcador de cantidad, ENTONCES el sistema DEBE producir un
único ítem de cantidad 1 cuyo nombre sea el texto entero (las 7 cadenas de prueba medidas).

**R16.** El sistema DEBE retirar del nombre los espacios sobrantes y los puntos finales, que son
terminadores de ítem y no parte del nombre.

**R17.** El sistema DEBE tratar como el MISMO producto dos nombres que sólo difieran en
mayúsculas/minúsculas, en espacios repetidos o en puntos finales.

**R18.** CUANDO dos formas distintas de escribir un nombre se agrupen bajo la misma clave, el
sistema DEBE elegir la forma que se muestra de manera DETERMINISTA: la misma entrada DEBE producir
siempre la misma forma visible.

**R19.** SI el texto lleva contenido antes del primer marcador de cantidad, ENTONCES ese contenido
DEBE producir un ítem propio de cantidad 1: nada se descarta en silencio.

**R20.** SI el texto está vacío o sólo contiene espacios, ENTONCES el sistema NO DEBE producir
ningún ítem, y DEBE contar esa orden como orden sin producto interpretable.

**R21.** La cantidad de un ítem DEBE ser un entero mayor o igual que 1. SI la cifra que precede al
`*` no es un entero seguro mayor o igual que 1, ENTONCES esa aparición NO cuenta como marcador y su
texto queda dentro del nombre que la contiene.

**R22.** El parser DEBE ser una función PURA y TOTAL: sin reloj, sin entorno, sin base; no lanza
con cadena vacía, sólo espacios, sólo un marcador, un `*` suelto ni un texto de miles de
caracteres; y la misma entrada produce siempre la misma salida.

**R23.** El sistema DEBE producir, para cada una de las cadenas reales de producción citadas en el
contexto, exactamente el número de ítems que en ellas se cuenta a mano — de modo que un cambio del
parser que INFLE el catálogo ponga rojo el test en vez de aparecer como productos nuevos.

## 3 — Qué se mide

**R24.** El sistema DEBE dar, por producto, las UNIDADES movidas: la suma de las cantidades de sus
ítems.

**R25.** El sistema DEBE dar, por producto, el número de ÓRDENES que lo contienen.

**R26.** CUANDO una misma orden contenga el mismo producto en dos ítems, el sistema DEBE sumar las
dos cantidades a las unidades y contar esa orden UNA sola vez en las órdenes.

**R27.** El sistema DEBE asignar a cada orden UN solo desenlace, con la MISMA regla que ya usa el
desglose por estado del tablero: el resultado de su última gestión vigente y, si nunca se gestionó,
su propio estatus.

**R28.** El sistema DEBE calcular la efectividad por producto con la MISMA función que produce la
fila de KPIs de la pantalla, y NO con una segunda definición.

**R29.** El denominador de todo porcentaje por producto DEBEN ser TODAS las órdenes del recorte que
contienen ese producto, incluidas las que todavía no tienen desenlace.

**R30.** El sistema DEBE dar, por producto, las entregadas, las rechazadas, las que siguen en
proceso y el porcentaje de rechazo.

**R31.** El sistema NO DEBE emitir filas de productos con cero órdenes.

**R32.** SI el recorte no contiene ninguna orden, ENTONCES el sistema DEBE decirlo con un estado
vacío explícito, y NO con una tabla de ceros.

**R33.** El sistema DEBE ordenar los productos de forma determinista: la misma respuesta DEBE
producir siempre el mismo orden de filas.

**R34.** Las unidades y las órdenes DEBEN ser enteros. El sistema NO DEBE emitir NINGUNA cifra de
dinero por producto.

**R35.** El sistema DEBE informar del número de órdenes del recorte y del número de órdenes cuyo
texto de producto no produjo ningún ítem.

**R36.** El sistema DEBE advertir en la pantalla que una orden con varios productos cuenta en cada
uno de ellos, de modo que la suma de la columna de órdenes pueda superar el total del recorte sin
que eso se lea como un error.

## 4 — Separados por tienda

**R37.** MIENTRAS el actor tenga acceso total, el sistema DEBE agrupar los productos POR TIENDA:
dos textos iguales de tiendas distintas DEBEN ser dos filas distintas.

**R38.** El sistema DEBE identificar la tienda de cada fila por su nombre.

**R39.** El sistema NO DEBE agregar en una misma fila órdenes de dos tiendas distintas, en ningún
rol y con ningún filtro.

## 5 — La pantalla

**R40.** La sección de productos DEBE responder al MISMO filtro (rango y facetas) que el resto de
la sección de entregas de la analítica.

**R41.** CUANDO se cambie el filtro, la tabla de productos DEBE volver a consultarse.

**R42.** CUANDO se pulse el control de actualizar de la analítica, las cifras de productos DEBEN
volver a leerse de la base y no servirse de la lectura guardada.

**R43.** MIENTRAS la lectura esté en curso, el sistema DEBE mostrar un estado de carga y NO ceros.

**R44.** SI la lectura falla, está denegada o la sesión no es válida, ENTONCES el sistema DEBE
mostrar el mensaje que corresponda a ese estado y NO una tabla vacía.

**R45.** El sistema DEBE paginar la tabla de productos.

**R46.** La tabla DEBE mostrar, por fila: producto, unidades, órdenes, entregadas, rechazadas, en
proceso, efectividad de entrega y porcentaje de rechazo; y la tienda cuando la respuesta contenga
más de una.

## 6 — La descarga

**R47.** El sistema DEBE permitir descargar la tabla de productos.

**R48.** El archivo DEBE contener EXACTAMENTE las columnas declaradas y en el orden declarado.

**R49.** El archivo NO DEBE contener ningún identificador interno (uuid), ni correo, ni teléfono,
ni ruta de almacenamiento.

**R50.** El archivo DEBE incluir SIEMPRE la tienda, aunque la pantalla haya ocultado esa columna.

**R51.** El archivo DEBE escribir un valor ausente como celda vacía, y NUNCA como `0`.

**R52.** El archivo DEBE salir de las MISMAS filas que la pantalla está mostrando, sin una segunda
consulta a la base.

## 7 — Frontera, coste y caché

**R53.** SI la entrada no valida, ENTONCES el sistema NO DEBE consultar la base ni resolver el
alcance.

**R54.** El recorte por rol DEBE viajar en el `WHERE` de la consulta a la base, y NO aplicarse en
memoria sobre filas ya traídas.

**R55.** El sistema DEBE excluir de todo cálculo las órdenes borradas.

**R56.** El sistema NO DEBE escribir una tercera versión de las condiciones de recorte del tablero:
DEBE reutilizar las que ya existen para el desglose por estado.

**R57.** El número de filas que la base devuelve para esta lectura DEBE estar acotado por el número
de textos de producto DISTINTOS del recorte, y no por el número de órdenes: N órdenes con el mismo
texto DEBEN producir una sola fila.

**R58.** El sistema DEBE servir esta lectura desde la caché de lecturas vivas de la analítica, con
una clave de prefijo PROPIO que no colisione con las otras lecturas de la sección, y su tag DEBE
quedar cubierto por el control de actualizar.

---

## Preguntas abiertas

**Q1 — El punto final del nombre.** El diseño retira los puntos finales (`Base Dr.` se muestra como
`Base Dr`) porque ese punto es el terminador del ítem y no hay forma de distinguirlo de la
abreviatura sin una lista de excepciones. ¿Se acepta ver `Base Dr` en pantalla y en el archivo, o
se prefiere conservar el punto cuando el ítem es el ÚLTIMO del texto (donde el terminador es
opcional)?

**Q2 — ¿Hace falta además una vista SIN separar por tienda?** La decisión tomada es separar por
tienda, y se respeta. Pero hoy `Crema Especial MLX` está en 2 tiendas: con la vista separada nadie
puede responder «cuántas unidades de esto movió Ordenex en total». ¿Se quiere esa segunda lectura
más adelante, o se descarta por el mismo motivo que la separa (dos textos iguales no prueban que
sea el mismo artículo)?

**Q3 — Tope de filas.** Hoy son 84 productos y la tabla se pagina en el navegador. ¿A partir de
cuántos productos se quiere paginación en el servidor o un tope explícito? Sin ese número, el
diseño no fija ninguno: inventarlo sería un límite sin procedencia.

**Q4 — Cuándo pasar a rollup.** El diseño elige consulta VIVA y explica por qué (§8, alternativa
A1). La corrida de `tasks.md § T0.2` mide el tiempo real contra producción. ¿Qué latencia se
considera inaceptable y dispara la ficha de rollup? Hoy no hay ningún presupuesto de latencia
escrito en el repo para la analítica.

**Q5 — Dinero por producto: la vía tentadora, declarada y NO especificada.** Existe una manera de
atribuir dinero: en el 88 % de órdenes que llevan UN solo producto, el flete de la orden es el de
ese producto, y podría publicarse «ingreso por producto» sólo para ese subconjunto. **No se
especifica**, porque una cifra que existe para el 88 % de las órdenes y no para el 12 % restante se
lee como si fuera el total. ¿Se quiere abrir como ficha propia, con ese recorte dicho en pantalla?

**Q6 — Equivalencias manuales.** La normalización medida (minúsculas, espacios, punto final) no
colapsa ningún nombre hoy. No se implementa ninguna equivalencia por tildes, singular/plural ni
alias: eso fundiría productos que las tiendas escribieron distintos a propósito. ¿Se quiere un
mecanismo de alias más adelante, o se prefiere pedir a las tiendas que escriban consistente?

**Q7 — El porcentaje en el archivo.** El diseño escribe los porcentajes como puntos porcentuales
con un decimal (`37,5`) y lo dice en el encabezado. ¿Se prefiere la fracción cruda (`0.375`) para
que la hoja de cálculo la formatee, aunque quien lo abra vea un número que no se parece a la
pantalla?
