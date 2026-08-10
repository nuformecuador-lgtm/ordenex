# 184 — Deuda dirigida de la 170: los doce listados y la poda de la selección satélite

> ## ⚠️ ESTA FEATURE SE RENUMERÓ: era la **184**, ahora es la **188**
>
> **Qué pasó (2026-08-05):** mientras esta rama estaba viva, otra sesión mergeó en `dev` una ficha
> **184 distinta** («analítica financiera: export de la serie»), además de una 185, una 186 y una
> 187. Al traer `dev`, los cuatro ids colisionaron. Por decisión humana se renumeró **todo lo de
> esta rama**: `184→188`, y las tres fichas que salieron de su cierre `185/186/187 → 189/190/191`.
>
> **Lo que NO se renumeró, y hay que saberlo al leer el repo:**
>
> - **Los 60 mensajes de commit** siguen diciendo «184». No se reescribieron a propósito:
>   `rebase`/`amend` sobre una rama ya pusheada está prohibido aquí desde que reescribió el commit
>   de otro agente.
> - **El código**: 111 archivos citan `Feature 184 — …` en comentarios, y la constante
>   **`PENDIENTES_184`** está usada **como ancla de texto** dentro de
>   `tests/unit/descarga/adaptador-conjunto.guardia.test.ts:313`. Renombrarla a medias pone la
>   guardia roja; renombrarla entera es una refactorización de 111 archivos sin ganancia funcional.
>   **Los nombres del código se quedan como están y significan esta feature.**
> - **La rama**: se llamó `feature/184-deuda-170-listados` hasta el 05-ago, y así quedó escrita en la
>   cabecera de las 17 bitácoras `impl_188_*`. Hoy es `feature/188-deuda-170-listados` (PR #298, ya
>   mergeado). No busques la vieja: no existe.
>
> Es decir: **«184» en un commit, un comentario, una cabecera de bitácora o `PENDIENTES_184` = esta
> feature, la 188.**



> Zona: `fullstack` · Complejidad: `large` · Sale de: `progress/chore_deuda_170.md` (inventario
> medido, 2026-08-03) y de la verificación del 2026-08-04 sobre
> `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx`.

## Qué problema resuelve

**Doce de los trece listados paginados producen su archivo de Excel releyendo el listado
completo del que la pantalla salía antes de paginar.** El archivo sale correcto —eso ya lo
vigila la 170— pero para producirlo se vuelve a leer un conjunto que nadie más usa: en tres
casos esa relectura es cara y está medida (firma de URL de evidencia, agregados de dinero y
reparto de efectivo, los cinco grupos de la bodega), y en uno además **duplica el criterio de
filtrado**, que hoy se aplica dos veces —una en la base y otra en el navegador—.

**Y la selección de la bodega satélite nunca se poda.** Sobrevive al cambio de página (a
propósito) y se limpia al cambiar filtros (a propósito), pero **no** cuando una orden marcada
deja de estar en el listado —por ejemplo al reportarle un incidente—. El aviso «marcadas en
otras páginas» que entregó el PR #282 vuelve esa discrepancia **visible y contable**: cuenta
órdenes que ya no existen ahí. Podarla exige saber qué identificadores siguen perteneciendo al
**conjunto filtrado completo**, que es exactamente lo que el listado (10) construye en esta
misma feature. Por eso las dos cosas van juntas.

## Alcance

**Entra:** los doce listados del Anexo A y la poda de la selección de la bodega satélite.

**No entra, y con motivo:**

- **Q-M1** (la revalidación de entrada de SWR: cada pantalla paginada hace, al montar, una
  lectura de cliente de la página que el Server Component ya resolvió). **Decisión de esta
  spec: NO entra.** Tres razones: (a) es otro defecto con otro arreglo —apagar la revalidación
  de entrada— y **otro riesgo**: hoy esa revalidación es lo único que refresca la tabla después
  de un `router.refresh()`, así que apagarla mal deja datos viejos en pantallas de dinero;
  meterlo en el mismo PR hace que una regresión no se pueda atribuir; (b) está **bloqueada por
  una pregunta propia** que ninguna task ha respondido (qué refresca la tabla si se apaga), y
  responderla exige auditar los trece caminos post-mutación, que es trabajo de otra feature;
  (c) el «se paga dos veces» de `chore_deuda_170.md §1.5` es real pero **acotado y medido**:
  son los mismos archivos `.tsx`, pero **otras líneas** (el objeto de opciones de `useSWR`, no
  la prop `obtenerFilas`), Q-M1 no toca backend, y sus conjuntos **no coinciden**: Q-M1 son
  trece módulos y esta feature son doce más la satélite. Para no pagar de más, esta feature
  **no toca la configuración de `useSWR` de ninguna pantalla** (R33), de modo que Q-M1 arranca
  sobre un árbol sin conflictos y con su inventario ya hecho.
- **Q-L1 / Q-I1** (los dos listados que recortan la página fuera de la base), **Q-I2 / Q-L3**
  (el orden alfabético impuesto) y **Q-K1 / Q-K2**: siguen dirigidas al humano por sus vías, no
  las toca esta feature.
- **Q-K6** (las tres lecturas por render de la satélite): **no se decide aquí**. Es una decisión
  de contrato, está en «Preguntas abiertas» (Q1) con recomendación, default y superficies
  afectadas por rama.

---

# Requisitos

## A. El archivo sale de una lectura propia del listado

**R1** — CUANDO el usuario pulse el control de descarga de un listado del Anexo A, el sistema
DEBE construir el archivo con el conjunto que devuelve una lectura **dedicada a ese listado**, y
NO DEBE construirlo releyendo un listado compuesto que devuelva además datos de otras secciones
de la pantalla.

**R2** — El sistema DEBE resolver ese conjunto ENTERAMENTE en el servidor: para los mismos
filtros y el mismo actor, NO DEBE seleccionar, ordenar ni recortar filas de ese conjunto en el
navegador.

**R3** — CUANDO el usuario pulse el control, el conjunto DEBE corresponder a los filtros
vigentes en la pantalla **en ese momento**.

**R4** — El acotamiento por rol y por zona del conjunto DEBE ser EXACTAMENTE el mismo que el de
la página visible del mismo listado: ninguna fila que el actor no pueda ver en pantalla DEBE
aparecer en el archivo, y ninguna clave de alcance DEBE poder viajar en la entrada de la
lectura.

**R5** — Para los mismos filtros, la página N que el listado muestra DEBE ser el segmento que le
corresponde dentro del conjunto que produce el archivo, en el mismo orden.

**R6** — El sistema DEBE evaluar el tope de filas en el SERVIDOR; SI el conjunto lo supera,
ENTONCES NO DEBE entregar archivo ni fila alguna y DEBE devolver el total encontrado y el tope
vigente.

**R7** — SI la lectura del conjunto falla o el actor no tiene permiso, ENTONCES el sistema NO
DEBE entregar archivo y DEBE mostrar un mensaje accionable que no contenga datos personales.

**R8** — MIENTRAS el usuario no pulse el control de descarga, el sistema NO DEBE ejecutar la
lectura del conjunto; el número de consultas que cada pantalla afectada ejecuta por render NO
DEBE aumentar.

**R9** — CUANDO se descargue «Cierres solicitados por el mensajero», el sistema NO DEBE firmar
ninguna URL de evidencia fotográfica.

**R10** — CUANDO se descargue «Cierres de bodega solicitados» o «Cierres del día a consolidar»,
el sistema NO DEBE calcular los agregados de dinero ni el reparto de efectivo de esa pantalla.

**R11** — CUANDO se descargue «Órdenes de la bodega satélite», el sistema NO DEBE transportar al
navegador ninguna fila que los filtros vigentes excluyan.

**R12** — El sistema DEBE conservar, sin cambios, el texto del aviso de tope, el del error de
lectura y el de «no hay datos que descargar», y las columnas y el orden de columnas de cada
archivo.

**R13** — MIENTRAS queden listados del Anexo A sin migrar, esos listados DEBEN seguir
descargando su conjunto completo exactamente como hoy.

## B. Dónde se prueba cada cosa

**R14** — Para CADA método de repositorio nuevo, el sistema DEBE verificar el criterio de
selección, el acotamiento y el orden **ejecutando el código real del repositorio** y afirmando
sobre los ARGUMENTOS de la consulta emitida. Un test que sustituya el repositorio por un doble
NO satisface este requisito.

**R15** — Para CADA método de repositorio nuevo, el sistema DEBE verificar **cuántas** consultas
emite y **qué condiciones NO lleva** su consulta.

**R16** — Para el mismo filtro, un método de repositorio nuevo y su hermano paginado DEBEN
emitir las MISMAS condiciones de selección y el MISMO orden; el sistema NO DEBE contener dos
declaraciones separadas del mismo criterio.

**R17** — Cada Server Action nueva DEBE rechazar en el borde, sin alcanzar la lógica de negocio,
toda entrada con una clave no declarada, y DEBE hacerlo con una lista blanca derivada de la de
su hermana paginada.

## C. Poda de la selección en la bodega satélite

**R18** — MIENTRAS el listado de la bodega satélite tenga órdenes marcadas fuera de la página
visible, CUANDO el sistema vuelva a leer el listado del servidor, DEBE retirar de la selección
las órdenes marcadas que ya NO pertenecen al conjunto filtrado.

**R19** — El sistema DEBE determinar esa pertenencia en el SERVIDOR, sobre el conjunto completo
con los filtros vigentes, y NUNCA sobre la página visible.

**R20** — El sistema NO DEBE retirar de la selección una orden por el solo hecho de no estar en
la página visible.

**R21** — El sistema DEBE acotar la comprobación al alcance del actor: un identificador que no
pertenezca a su zona DEBE tratarse como no vigente, y la respuesta NO DEBE revelar ningún dato
de él.

**R22** — SI la comprobación falla, ENTONCES el sistema NO DEBE alterar la selección.

**R23** — MIENTRAS no haya órdenes marcadas fuera de la página visible, el sistema NO DEBE
ejecutar la comprobación.

**R24** — CUANDO una comprobación no retire ninguna orden, el sistema NO DEBE encadenar otra:
cada relectura del listado DEBE costar como mucho UNA comprobación.

**R25** — CUANDO la selección se pode, el aviso de órdenes marcadas en otras páginas DEBE contar
únicamente órdenes vigentes en el conjunto filtrado, y DEBE dejar de mostrarse cuando no quede
ninguna.

**R26** — La poda NO DEBE alterar la página visible, los filtros vigentes, los contadores de
cabecera ni la acción de lote que se ofrece sobre lo seleccionado en la página.

**R27** — CUANDO el usuario cambie los filtros, el sistema DEBE seguir limpiando la selección
entera.

**R28** — La poda NO DEBE añadir ninguna consulta a la carga inicial de la pantalla ni a una
descarga.

## D. El censo no puede quedar mintiendo a mitad de la entrega

**R29** — El censo transversal de listados paginados DEBE declarar, listado por listado, de qué
forma obtiene el conjunto de su archivo, y DEBE contrastar esa declaración contra el árbol de
código en los dos sentidos (lo declarado existe; lo que existe está declarado).

**R30** — MIENTRAS queden listados sin migrar, el censo DEBE declararlos POR NOMBRE, y esa lista
DEBE coincidir exactamente con la que el árbol muestra sin migrar.

**R31** — El sistema NO DEBE desactivar, omitir ni relajar el censo en ninguna tanda: ni con
casos deshabilitados, ni con casos pendientes, ni sustituyendo una afirmación por otra más
débil.

**R32** — CUANDO la feature termine, la capa de pantallas NO DEBE conservar ninguna llamada al
adaptador de descarga que relee el listado completo.

## E. No regresión y trazabilidad

**R33** — El sistema NO DEBE modificar la configuración de revalidación de la lectura de página
(`useSWR`) de ninguna pantalla.

**R34** — Cada requisito `R<n>` DEBE quedar mapeado a un caso de test concreto, identificado por
**archivo y nombre del caso**. Contar menciones de `R<n>` en títulos de test NO cuenta como
evidencia de trazabilidad.

---

## Anexo A — Los doce listados

Numeración de `progress/chore_deuda_170.md §1.2`, que es el inventario medido de esta deuda.
Son **doce listados repartidos en ocho dominios**; el treceavo del censo («Cuentas por pagar a
mensajeros») ya está cerrado y sirve de molde.

| # | Listado | Rol que lo ve | Coste medido de la relectura de hoy |
| --- | --- | --- | --- |
| 1 | Cierres solicitados por el mensajero | mensajero | **CARO** — firma las URL de evidencia de todas las gestiones del día |
| 2 | Cierres del día — histórico | maestro · adminSatelite | trae cola + histórico del alcance entero |
| 3 | Cierres del día pendientes de decisión | maestro · adminSatelite | ídem |
| 4 | Cierres de bodega pendientes | maestro | trae los dos conjuntos |
| 5 | Cierres de bodega resueltos | maestro | ídem |
| 6 | Cierres de bodega solicitados | adminSatelite | **CARO** — 4 consultas + 5 agregados de dinero + reparto de efectivo |
| 7 | Cierres del día a consolidar | adminSatelite | **CARO** — ídem |
| 8 | Incidentes pendientes de decisión | maestro · adminSatelite | trae los dos conjuntos |
| 9 | Incidentes — histórico | maestro · adminSatelite | ídem |
| 10 | Órdenes de la bodega satélite | adminSatelite | **CARO** + filtra en memoria (criterio duplicado) |
| 11 | Plantillas de gasto fijo | maestro | barato (lista pequeña) |
| 12 | Saldos de tiendas | maestro | agrega el libro de todas las tiendas |

---

## Anexo B — Mapa `R<n>` → test

Obligatorio por R34. Nombres de archivo definitivos; el nombre del caso es el que el
implementador debe escribir (puede reformularlo, pero el caso debe existir y afirmar eso).
**Ninguna fila de esta tabla se satisface contando `R<n>` en títulos.**

| R | Dónde se prueba | Caso |
| --- | --- | --- |
| R1 | `tests/components/paginacion/paginacion-transversal.test.tsx` | «cada listado obtiene el conjunto de su archivo con el adaptador que declara» (estático, por listado) |
| R2 | el mismo + `tests/components/descarga/<Dominio>Descarga.test.tsx` | «la pantalla no filtra ni ordena el conjunto del archivo» (ausencia de filtro/orden de cliente en el módulo) |
| R3 | `tests/components/descarga/<Dominio>Descarga.test.tsx` | «descargar con filtros aplicados pide el conjunto con ESOS filtros» |
| R4 | `tests/unit/services/<dominio>-completo.test.ts` | «un rol sin acceso recibe forbidden antes de tocar el repositorio» + «el alcance sale del actor, no de la entrada» |
| R5 | `tests/unit/repositories/{historicos-paginados,colas-paginadas,satelite-paginado}-where.test.ts` | «la página es el segmento exacto del conjunto para el mismo filtro» |
| R6 | `tests/unit/services/<dominio>-completo.test.ts` | «con `MAX_FILAS + 1` devuelve limite_excedido, sin filas» y «con `MAX_FILAS` las entrega todas» |
| R7 | `tests/components/descarga/<Dominio>Descarga.test.tsx` | «un fallo de la lectura no produce archivo y el mensaje no lleva datos personales» |
| R8 | `tests/components/paginacion/paginacion-transversal.test.tsx` | «montar la pantalla no llama a la acción del conjunto» |
| R9 | `tests/unit/services/cierre-dia-pasados-completo.test.ts` | «el conjunto de la descarga no firma ninguna URL de evidencia» (espía con 0 llamadas) |
| R10 | `tests/unit/services/consolidacion-completo.test.ts` | «el conjunto de la descarga no calcula agregados ni reparto de efectivo» |
| R11 | `tests/unit/services/recepcion-satelite-completo.test.ts` | «con un filtro de cantón, el conjunto excluye las demás filas en la base» |
| R12 | `tests/components/descarga/ControlDescargaTransversal.test.tsx` | los casos ya existentes del tope, del error y del dataset vacío, sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | «los listados aún declarados como relectura siguen releyendo» |
| R14 | los tres `*-where.test.ts` | un caso por método nuevo: «emite el WHERE del alcance» |
| R15 | los tres `*-where.test.ts` | «emite exactamente N consultas» y «el WHERE no lleva `skip`/`take`» |
| R16 | los tres `*-where.test.ts` | «el conjunto y la página emiten las mismas condiciones y el mismo orden» |
| R17 | `tests/unit/actions/<dominio>-actions.test.ts` | «una clave no declarada muere con validation_error sin tocar el servicio» |
| R18 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «una orden marcada que sale del listado deja de estar marcada tras la relectura» |
| R19 | `tests/unit/services/recepcion-satelite-vigencia.test.ts` | «la vigencia se decide sobre el conjunto filtrado, no sobre la página» |
| R20 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «cambiar de página no desmarca nada» |
| R21 | `tests/unit/services/recepcion-satelite-vigencia.test.ts` + `tests/unit/repositories/satelite-paginado-where.test.ts` | «un id de otra zona vuelve como no vigente» y «el WHERE lleva la zona del actor además del `IN` de ids» |
| R22 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «si la comprobación falla, la selección queda intacta» |
| R23 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «sin marcas fuera de la página no se consulta la vigencia» (0 llamadas) |
| R24 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «una relectura cuesta exactamente una comprobación» |
| R25 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | «el aviso baja su número tras la poda y desaparece cuando no queda ninguna» |
| R26 | `tests/components/paginacion/SatelitePaginacion.test.tsx` | «podar no cambia la página, los filtros ni los contadores» |
| R27 | `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` | el caso ya existente de limpieza por filtros, sin cambios |
| R28 | `tests/components/paginacion/SatelitePaginacion.test.tsx` | «la carga inicial no consulta vigencia» + «descargar no consulta vigencia» |
| R29 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes |
| R30 | `tests/components/paginacion/paginacion-transversal.test.tsx` | «los listados sin migrar declarados por nombre coinciden con el árbol» |
| R31 | `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` (nuevo) | «los dos censos de adaptador no tienen casos deshabilitados ni pendientes» |
| R32 | `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` (nuevo) | «no queda ninguna llamada al adaptador de relectura bajo `app/`» |
| R33 | `tests/components/paginacion/paginacion-transversal.test.tsx` | el caso ya existente de `fallbackData` y de «una sola revalidación de entrada», sin cambios |
| R34 | `progress/impl_188-*.md` + revisión | el mapa completo, verificado por el reviewer archivo a archivo |

**Por qué no vale contar `R<n>` en títulos:** los espacios de nombres de requisitos se cruzan
entre features (`R29` es el tope de la 170 y también un requisito de esta), y ese recuento ya
produjo aquí un falso «68/68». La evidencia es el caso concreto, nombrado, que falla si se
revierte el cambio.

---

## Preguntas abiertas

Van al humano. Cada una lleva recomendación y default; ninguna se decide en esta spec.

**Q1 — Q-K6: qué contrato queda para `listarRecepcionSatelite()`.** La pantalla de la satélite
hace tres lecturas del mismo dominio por render. La salida no es «añadir un método» sino
**elegir entre dos contratos**, y ninguna task lo ha decidido.

- **Rama A — «Por recibir» sale a su propia acción acotada.** Superficie afectada: la pantalla
  `/recepcion-satelite` (su Server Component), que hoy toma de ahí `porRecibir`, `zonaNombre` y
  `sinZona`; la acción nueva tendría que devolver los tres o la pantalla haría dos lecturas otra
  vez. `listarRecepcionSatelite()` quedaría **sin ningún consumidor de producción** y habría que
  borrarla o dejarla muerta.
- **Rama B — `listarRecepcionSatelite()` deja de devolver los cinco grupos** y pasa a devolver
  solo `porRecibir` + `zonaNombre` + `sinZona`. Superficie afectada: el mismo Server Component,
  el tipo `ListarRecepcionSateliteResult` / `ListarRecepcionSateliteServiceResult` y **los
  dobles de esos cinco campos en la suite**.
- **Dato medido hoy (2026-08-04), que conviene tener antes de decidir:** en producción
  `listarRecepcionSatelite()` tiene **exactamente dos consumidores** —
  `app/(app)/recepcion-satelite/page.tsx:30` y `RecepcionSateliteModule.tsx:114`— y **el segundo
  desaparece con esta feature** (es la descarga del listado 10). O sea: la frase «cambia una
  superficie que consumen otras pantallas» **no se sostiene contra el árbol de hoy**; lo que sí
  se ve afectado son los dobles de tests. Además, **la rama B está bloqueada hasta que se cierre
  el listado 10**, y esta feature es justo lo que la desbloquea.
- **Recomendación:** rama B, por ser la que no crea superficie pública nueva —una acción menos,
  un nombre menos— una vez que el listado 10 esté cerrado.
- **Default si nadie responde:** **fuera de esta feature**, como ticket propio inmediatamente
  posterior. Ningún requisito de aquí la necesita, y meterla dentro mezclaría un cambio de
  contrato con una migración de doce pantallas.

**Q2 — Cuántos identificadores como máximo admite la comprobación de vigencia.** La entrada de
la comprobación es la lista de órdenes marcadas fuera de la página visible; sin cota es una
lista abierta que llega a un `IN` de SQL. No hay ninguna cota de este tipo en el repo de la que
copiar el número.

- **Recomendación:** declararla en `lib/config/recepcion-satelite.ts` (mismo patrón que
  `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE`, sobreescribible por entorno) con valor **500** — veinte
  páginas de 25 marcadas, muy por encima de cualquier uso real observado.
- **Default si nadie responde:** 500, en la config del dominio, y superarla devuelve
  `validation_error` sin podar (R22 aplica: la selección no se toca).

**Q3 — Si la poda desmarca órdenes, ¿el operador debe enterarse?** La poda retira marcas que el
usuario puso. Hoy no hay ningún aviso previsto para eso, y el aviso existente solo baja su
número.

- **Recomendación:** **sin aviso adicional.** La orden desaparece del listado por la misma
  acción que la sacó (el incidente que el propio operador reportó), el contador de la barra ya
  se mueve y un tercer mensaje en una barra que ya dice dos cosas estorba más de lo que ayuda —
  el mismo criterio con el que se decidió el aviso del PR #282.
- **Default si nadie responde:** sin aviso.

**Q4 — El mismo defecto de selección en `/ordenes`.** Verificado hoy: `OrdenesModule.tsx:215-218`
guarda la selección en un `Map` que **también sobrevive al cambio de página** (lo dice su propio
comentario en `:301-305`). NO verifiqué si sus acciones de lote la podan por otra vía, y su
semántica es distinta: allí la acción actúa sobre la selección entera, no sobre la página
visible.

- **Recomendación:** **no entra aquí.** El mecanismo de esta feature (la comprobación de
  vigencia) es reutilizable, pero el conjunto de `/ordenes` tiene otros filtros y otro alcance,
  y el modo de fallo es distinto.
- **Default si nadie responde:** fuera de alcance; se registra como ticket propio con este
  hallazgo escrito.

**Q5 — El orden de las tandas de higiene.** El orden por coste medido está fijado para las
cuatro primeras (satélite, consolidación, cierres del mensajero). Las ocho restantes son
higiene y su orden lo fija `tasks.md` por afinidad de archivos, no por coste.

- **Recomendación:** dejarlo como está en `tasks.md`.
- **Default si nadie responde:** el orden de `tasks.md`.
