# 339 — La barra de filtros compartida lee su estado inicial desde la URL

> Zona: `frontend` · SDD: sí · Complejidad: media
> Canónicos afectados: `components/shared/BuscadorFiltros.tsx`, `components/shared/FilterComponent.tsx`

## Contexto y alcance (restricciones duras del humano)

1. **La capacidad va ligada al COMPONENTE, no a una vista.** Vive en `components/shared/`
   y la heredan los consumidores actuales sin parchear pantalla por pantalla y sin
   resolverla en el hook de una vista concreta.
2. **Dirección única: solo se LEE al entrar.** La URL NO se reescribe mientras el
   usuario filtra. Lo único que la toca es «Limpiar todo», que borra los params para
   que un refresco no reviva el filtro.
3. **La clave del param es la clave del filtro** (`FilterDef.key`), que es la misma que
   viaja al back (`mensajero_id`, `zona_id`, `fecha`…). No se inventa un espacio de
   nombres paralelo.

Fuera de alcance: escribir la URL al filtrar, deep-links compartibles generados por la
app, persistencia en `localStorage`, y el «modo aplicar» / vaciado controlado de la
ficha 328.

## Vocabulario

- **Barra**: `BuscadorFiltros`. Dueña del campo de texto, del selector de filtros y de
  «Limpiar todo».
- **Orquestador**: `FilterComponent`. Dueño de la selección agregada
  (`FilterSelection = Record<string, string[]>`).
- **Consumidor**: el componente de pantalla que declara `filtros`/`filters`, posee
  `activos` y recibe `onChange`.
- **Filtro declarado**: el que aparece hoy en `filtros` (barra) o `filters` (orquestador).
- **Param de filtro**: un query param cuyo nombre coincide con la clave de un filtro
  declarado, o con el param del término libre.
- **Param ajeno**: cualquier otro query param de la URL (p. ej. `?cierre=` en
  `cierres-admin`, `?fecha=` en `/ranking/historico`).

---

## Requisitos

### Lectura al entrar

**R1** — CUANDO la barra se monta y la URL trae el param del término libre con un valor
no vacío, el sistema DEBE mostrar ese valor ya escrito en el campo de búsqueda.

**R2** — CUANDO la barra se monta y la URL trae un param de filtro cuya clave coincide
con un filtro OFRECIDO en el selector, el sistema DEBE marcar esa clave como activa
exactamente una vez, de modo que el consumidor monte su control sin que el usuario lo
pida desde el selector.

**R3** — CUANDO el orquestador se monta con un filtro declarado cuya clave aparece en la
URL con al menos un valor válido, el sistema DEBE dejar ese control con esos valores ya
seleccionados.

**R4** — El sistema DEBE tomar como nombre de param de un filtro exactamente su
`FilterDef.key`, sin prefijo, sufijo ni transformación.

**R5** — CUANDO la barra se monta con precarga desde la URL, el sistema DEBE emitir hacia
el consumidor el término precargado (por `onChange` de la barra) y la selección precargada
(por `onChange` del orquestador) exactamente una vez cada uno, de modo que el listado
llegue ya acotado y no solo la barra pintada.

**R6** — SI la URL no trae ningún param de filtro ni el del término libre, ENTONCES el
sistema DEBE comportarse exactamente como hoy: campo vacío, ningún control montado,
selección `{}` y ninguna emisión adicional al montar.

**R7** — MIENTRAS el usuario permanece en la pantalla, el sistema DEBE ignorar cualquier
cambio posterior de los query params: la lectura ocurre una sola vez, al entrar.

### Formato de los valores

**R8** — CUANDO un param de filtro trae varios valores separados por coma, el sistema
DEBE interpretarlos como una lista de valores, descartando las partes vacías y los
espacios de los extremos.

**R9** — CUANDO un mismo param de filtro aparece repetido en la URL, el sistema DEBE
concatenar los valores de todas sus apariciones, en el orden en que aparecen, aplicando
a cada una la regla de R8.

**R10** — DONDE el filtro es de tipo `dateRange`, el sistema DEBE leer su param como la
terna posicional `atajo,desde,hasta` —las mismas tres posiciones, sin compactar, que ese
filtro emite— y DEBE descartar el param entero si el atajo no está entre los ofrecidos,
si `desde` u `hasta` no tienen forma `YYYY-MM-DD`, o si el rango está invertido.

**R11** — DONDE el filtro es de tipo `boolean`, el sistema DEBE aceptar únicamente el
valor `true` y descartar el param con cualquier otro valor.

**R12** — DONDE el filtro es de tipo `single`, el sistema DEBE quedarse con el primer
valor válido del param y descartar el resto.

**R13** — DONDE el filtro es de tipo `text`, el sistema DEBE aceptar el valor recortado
solo si alcanza el `minChars` declarado; por debajo, DEBE descartar el param.

**R14** — DONDE el filtro es de tipo `multi` o `single`, el sistema DEBE descartar todo
valor que no corresponda a una opción declarada en el catálogo de ese filtro.

### Lo que no se entiende

**R15** — SI un query param no corresponde a ningún filtro declarado ni al término libre,
ENTONCES el sistema DEBE ignorarlo por completo: no monta control, no altera la selección
y no lo borra de la URL.

**R16** — SI todos los valores de un param de filtro resultan descartados por R10-R14,
ENTONCES el sistema DEBE tratar ese filtro como ausente: no marca su clave como activa,
no monta su control y no altera la selección.

**R17** — El sistema DEBE aplicar la precarga sin que la poda de filtros no declarados del
orquestador la borre: una clave precargada y declarada DEBE seguir en la selección tras el
primer ciclo de montaje.

### Escritura: la barra solo RESTA params

**AMPLIADO el 2026-08-31 a petición del humano** («al eliminar del texto del input debería
quitar q de la url»): el título de esta sección decía «solo «Limpiar todo»» y ha dejado de
ser cierto. Ahora hay DOS gestos que retiran params —«Limpiar todo» (R19) y vaciar el
campo de búsqueda (R26)—, y ninguno de los dos AÑADE ni reescribe nada: la barra solo sabe
restar. El resto de R18 sigue intacto.

**R18** — MIENTRAS el usuario escribe en el campo, marca opciones, pone o retira filtros
desde el selector, el sistema DEBE dejar la URL intacta. En particular, un término escrito
DESPUÉS de haber vaciado el campo NO vuelve a aparecer en la URL: R26 quita, nunca repone.

**R19** — CUANDO el usuario pulsa «Limpiar todo», el sistema DEBE eliminar de la URL el
param del término libre y todos los params cuyo nombre coincida con la clave de un filtro
OFRECIDO en el selector, además de hacer lo que ya hace hoy (vaciar el campo y avisar al
consumidor).

**R20** — CUANDO el usuario pulsa «Limpiar todo», el sistema DEBE conservar en la URL todos
los params ajenos, con su valor y sin reordenarlos.

**R21** — CUANDO el usuario pulsa «Limpiar todo» y la URL queda sin ningún param, el
sistema DEBE dejar la ruta sin `?`.

**R22** — CUANDO el sistema modifica la URL por «Limpiar todo», DEBE hacerlo sustituyendo
la entrada actual del historial y sin desplazar el scroll.

### Salvaguardas

**R23** — DONDE el consumidor lo desactive explícitamente, el sistema DEBE no leer la URL
al entrar y no tocarla al limpiar, comportándose exactamente como hoy.

**R24** — SI la fuente de query params no está disponible en el entorno de ejecución,
ENTONCES el sistema DEBE comportarse como si la URL no trajera ningún param, sin lanzar.

**R25** — El sistema DEBE realizar la lectura inicial sin escribir estado desde un efecto,
para no incumplir la regla de lint del repo que prohíbe `setState` en efecto para leer
fuentes externas.

### Vaciar el campo (añadido el 2026-08-31)

**R26** — CUANDO el término EMITIDO por el buscador pasa a `""` —por la X del campo, por
borrarlo carácter a carácter, por seleccionar todo y suprimir, o por caer bajo `minChars`—
el sistema DEBE eliminar de la URL el param del término libre (`terminoKey`) y NINGÚN
otro: los params de los filtros y los ajenos DEBEN conservarse.

**R26.1** — SI la URL resultante de esa eliminación es idéntica a la actual —el campo ya
estaba vacío, o la URL nunca trajo ese param— ENTONCES el sistema NO DEBE navegar. Un
`router.replace` a la misma URL cuesta un payload RSC que hoy no se pide.

**R26.2** — MIENTRAS el usuario teclea y borra deprisa, el sistema DEBE producir como
mucho UNA navegación: la eliminación cuelga del término EMITIDO (detrás del debounce y de
la guarda de «sin cambio»), no del `onChange` crudo del campo.

**R26.3** — La eliminación de R26 NO DEBE reintroducir ninguna lectura viva de la URL: R7
sigue vigente y la lectura sigue siendo la foto de entrada.

---

## Trazabilidad prevista

| Requisito | Dónde se verifica |
| --- | --- |
| R4, R8-R16 | tests unitarios del códec puro (sin React) |
| R1-R3, R5-R7, R17, R23-R24 | tests de render de `BuscadorFiltros` + `FilterComponent` |
| R18-R22, R26-R26.2 | tests de render con `next/navigation` simulado |
| R26.3 | los dos guardias de R25 (`filtros-url-r25*.test.*`) siguen en verde |
| R25 | lint del repo en verde sobre los archivos tocados |

---

## Preguntas abiertas — PUNTO DE APROBACIÓN

Cada punto lleva una propuesta razonada. **RATIFICADAS POR EL HUMANO el 2026-08-31.** Las cinco propuestas se aprobaron TAL CUAL
quedan escritas abajo; no hay ninguna abierta. A1 = `q` con `terminoKey`. A2 = coma,
aceptando la forma repetida al leer. A3 = terna posicional en un solo param. A4 =
descarte silencioso, param ajeno conservado, sin aviso visible (la variante del
callback `onParamsDescartados` queda FUERA de esta ficha). A5 = solo los params propios.

### A1 — ¿Qué param lleva el término de búsqueda libre?

**Propuesta: `q`, con una prop para renombrarlo (`terminoKey`).**
Hoy ese término no tiene clave: `BuscadorFiltros` emite un string suelto y cada
consumidor lo funde con la selección a su manera (`/ordenes` lo guarda en
`terminoBuscador` aparte). No existe una clave canónica que copiar, así que hay que
elegir una. `q` es la convención universal de la web, es corta y no colisiona con ninguna
clave de filtro declarada hoy (`mensajero_id`, `zona_id`, `zona`, `fecha`, `mensajero`,
`tienda`, `cierre`). La prop `terminoKey` existe para la pantalla cuyo back llame a eso
`busqueda` y quiera que el enlace hable el idioma del endpoint.
**Alternativa descartada:** reutilizar la clave del filtro `text` del catálogo — no
sirve, porque el término de la barra NO es un filtro `text` del orquestador; es un canal
aparte y en `/ordenes` se descarta explícitamente del panel por su clave.

### A2 — ¿Formato de un filtro multi-valor?

**Propuesta: coma (`?zona=A,B`) como formato canónico, aceptando además la forma
repetida (`?zona=A&zona=B`) al leer.**
La coma es el precedente ya escrito del repo: `app/(app)/analitica/_components/operativo/filtro-tablero.ts`
serializa con `join(",")` y lee con `split(",")` para `zona`, `tienda` y `mensajero`. No
se inventa un convenio nuevo teniendo uno. Aceptar también la forma repetida cuesta una
línea y evita que un enlace escrito a mano —o generado por una herramienta— falle en
silencio.
**Valor que contiene el separador:** no se escapa. Los valores del catálogo son ids y
enums; un valor con coma sencillamente no es expresable desde la URL y, al no casar con
ninguna opción declarada, cae por R14 (se descarta, no rompe). Se documenta como límite
conocido en lugar de introducir un esquema de escapado que nadie necesita hoy.

### A3 — ¿Cómo se codifica un `dateRange`?

**Propuesta: un solo param con la terna posicional del propio filtro:
`?fecha=30d,,` para un atajo y `?fecha=,2026-07-01,2026-07-28` para un rango.**
El filtro ya emite exactamente tres posiciones sin compactar (`[atajo, desde, hasta]`) y
la posición ES el significado, según el contrato escrito en `FilterComponent`. Reusar esa
terna mantiene la regla «un filtro, un param con su clave» (R4) y hace del códec un
`split(",")` con relleno a tres. Ni las fechas ni los atajos contienen comas.
**Alternativa descartada:** `?fecha_desde=…&fecha_hasta=…`. Rompe R4 (inventa dos claves
que no existen en ningún contrato), obliga a un caso especial en el borrado de «Limpiar
todo» y deja sin sitio al atajo.

### A4 — ¿Qué se hace con un param desconocido y con un valor inválido?

**Propuesta: se descartan en silencio, sin montar nada y sin avisar.**
Param desconocido: se ignora y **se conserva** en la URL (R15) — puede ser de otra
funcionalidad de la misma pantalla, y borrarlo sería romperla. Valor inválido: se
descarta; si un filtro se queda sin ningún valor válido, ni siquiera se monta su control
(R16). El criterio de «la pantalla no miente» se cumple por omisión: la barra aparece
visiblemente vacía y el listado visiblemente sin acotar, así que lo que se ve coincide
con lo que se aplica. Montar un control vacío sí sería mentir a medias («pediste zona,
mira, ahí está») y mostrar un error tampoco aporta: el usuario que llega por un enlace
caducado no puede hacer nada con «zona XYZ no existe».
**Punto a confirmar:** si el humano prefiere un aviso visible para el caso de valor
inválido, se añadiría como callback opcional del componente (`onParamsDescartados`) que
cada pantalla decide si pinta. No se incluye en esta ficha salvo que se pida.

### A5 — ¿«Limpiar todo» borra toda la query o solo los params de filtros?

**Propuesta: solo los params de filtros y el del término. Los ajenos sobreviven.**
No es una precaución teórica, está medido: `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`
monta `FiltrosCierresBarra` (línea 969) y en el mismo componente lee `?cierre=` (`PARAM_CIERRE`,
líneas 621 y 961) para abrir el detalle de un cierre. Borrar la query entera al pulsar
«Limpiar todo» cerraría ese detalle de golpe. Hay más params ajenos vivos en la app
(`?mensajero=` en `/monitoreo`, `?fecha=` en `/ranking/historico`, `?redirect=` en login).
El precedente de cómo se hace ya existe y se copia: `TableroDiaModule.cerrarDetalle`
reconstruye los params filtrando la clave propia en vez de vaciar.
