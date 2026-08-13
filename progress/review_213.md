# 213 — Pago múltiple por entrega (captura y presentación) — Revisión

> Revisor sobre el worktree C:/w213b, rama feature/213-pago-multiple-captura.
> Diff revisado: git diff origin/dev...HEAD = 29 archivos, +3639/-80, 7 commits.
> El init.sh completo lo corrió el leader (1090 archivos / 13751 tests, 0 rojos, 388 s):
> aquí solo se corrió lo necesario para comprobar hallazgos y mutaciones concretas.

## VEREDICTO: APROBADO

35/35 requisitos verificados uno por uno contra un test que existe, afirma lo que dice y cae
cuando se rompe el requisito. **0 hallazgos mayores. 6 menores.** Ninguno bloquea el merge.

---

## 1. Checklist de CHECKPOINTS.md

| Punto | Estado |
| --- | --- |
| specs/213-.../requirements.md con EARS numerados | OK - R1-R35, cinco bloques |
| design.md con al menos una alternativa descartada y su porqué | OK - cinco (A-E), con motivo cada una |
| tasks.md con TODAS las tasks [x] | PARCIAL - 16/18. T16 (init completo, ya corrido y verde) y T18 (bookkeeping/PR) son del leader y siguen sin marcar. Menor 5 |
| Cada R(n) mapea a un test concreto | OK - 35/35, tabla en la seccion 2 |
| progress/impl_213.md contiene el mapa R -> test | OK - seccion 3 de la bitacora |
| typecheck / lint / test | OK - via el gate del leader; corridas parciales propias verdes |
| E2E para flujo critico (recaudo) | PARCIAL - existe el bloque (d), escrito y nunca ejecutado. Menor 3 |
| RLS en tablas nuevas | n/a - no hay tablas nuevas (feature frontend) |
| Migraciones versionadas y reversibles | OK - cero migraciones en el diff |
| Sin secretos hardcodeados | OK |
| Webhooks con firma/idempotencia | n/a |
| Capas: controller / service / repository / interfaces | OK - el diff no toca lib/services, lib/repositories, lib/interfaces ni db/ |
| Permisos en servidor / Server Actions | OK - sin cambios; el panel sigue invocando la accion gestionar |
| Sin hardcode de pais, moneda ni cuenta | OK - money()/formatMonto en pantalla; los dos modulos de descarga van money-safe y la guardia persigue el simbolo con contraprueba |
| progress/review_213.md con veredicto OK | OK - este archivo |
| Entrada en progress/history.md | pendiente del leader (T18) |

---

## 2. Trazabilidad R1-R35, verificada test a test

Leyenda: GOP = `tests/components/GestionarOrdenPanelPagos.test.tsx`; DC =
`tests/unit/utils/desglose-captura.test.ts`; CDP = `tests/components/CierreDetallePagos.test.tsx`;
CDM = `tests/components/CierreDiaModule.test.tsx`; GUA =
`tests/unit/guards/pagos-captura.guardia.test.ts`; DESC = los dos
`tests/unit/descarga/*-descarga-columnas.test.ts`.

| R | Test que lo verifica | Comprobado por el revisor |
| --- | --- | --- |
| R1 | GOP «con cobro, la rama entregada monta el editor y ya no el selector unico» | OK: afirma las dos mitades, existe «Metodo de pago linea 1» y NO existe el combobox «Metodo de pago» |
| R2 | GOP «arranca con UNA linea...» + DC «arranca con exactamente una linea...» | OK: 1 grupo, valor 8000, placeholder sin metodo |
| R3 | DC «puedeAnadirLinea es falso con 3 lineas» / «...cierto mientras queden metodos» | PARCIAL: verifica la REGLA pura; el panel la consume directo, pero ningun caso de UI afirma que el boton desaparezca. Menor 4 |
| R4 | DC x4 (pendiente, nunca negativo, lineaNueva) + GOP (el monto de la linea 2 nace en 3000) | OK |
| R5 | DC «opcionesPara(i) deshabilita los usados en OTRAS lineas» + GOP (aria-disabled="true") | OK: la opcion sigue presente y deshabilitada, no oculta |
| R6 | GOP «quitar una linea libera su metodo en las demas» | OK: con 1 linea no hay boton; tras quitar, la opcion vuelve habilitada |
| R7 | GOP «la linea no ofrece referencia ni ningun otro campo» | OK: 1 combobox + 1 spinbutton + 0 textbox dentro del grupo |
| R8 | GOP «muestra monto a cobrar, suma capturada y diferencia» | OK: los tres valores con formatMonto, recalculados al teclear |
| R9 | GOP it.each con 5000 / 9000 / 8000.01 | OK los tres: alerta visible Y la action no invocada. Cubre de menos, de mas y un centimo |
| R10 | GOP «volver atras y elegir otro resultado descarta las lineas» | OK: vuelve a 1 linea limpia con el total pre-cargado |
| R11 | DC «0.1 + 0.2 contra 0.30 cuadra» / «un centimo NO cuadra» + GUA bloque R11 | OK: la guardia acota la excepcion por POSICION (cuerpo de montoDeTexto), comprueba que no se exporta y trae contraprueba de parseFloat |
| R12 | DC «lineasParaEnviar descarta las lineas completamente vacias» + GOP (R14) | OK |
| R13 | DC x5 + GOP «metodo sin monto» / «monto sin metodo» | OK: error EN la linea y sin llamada a la action. [Q6] respetada |
| R14 | GOP «con cobro y todas las lineas vacias, error de metodo requerido» | OK |
| R15 | GOP «el envio mixto manda dos pares y NINGUN metodoPago» + RepartoModule | OK: getAll de los dos campos + metodoPago === null. Este caso cayo con mi mutacion (seccion 4) |
| R16 | GOP «orden SIN cobro» + contraprueba con cobro + RepartoModule «ENTREGAR sin cobro» | OK: las tres cosas a la vez |
| R17 | GOP «valida con gestionarSchema antes de enviar (sin fotos no envia)» | OK: desglose perfecto, cae por evidencias; la segunda barrera existe |
| R18 | GOP «un validation_error del servidor en pagos se pinta en el editor» | OK: dentro del editor, no en un toast |
| R19 | GUA bloque 1 (arbol transitivo del panel, cero especificadores sin resolver, frontera solo en lib/actions/) + contraprueba con import inyectado | OK con la relajacion de import type; juicio en la seccion 5.1 |
| R20 | CDP x2 sitios + CDM | OK: la celda dice SINPE a secas, como antes |
| R21 | CDP x2 + CDM | OK: cadena exacta con los dos metodos y sus montos |
| R22 | CDP x2 + CDM | OK: y el fixture trae metodoPago SINPE con pagos vacio, asi que si algun sitio leyera el escalar el caso caeria |
| R23 | GUA bloque 2 (los tres archivos, sin comentarios, no nombran metodoPago; ancla positiva desglosePantalla) + los fixtures de R22 | OK: la contraprueba del bloque 2 es redundante, pero la afirmacion de verdad (not.toContain por archivo) es solida y la contraprueba real es el fixture de R22 |
| R24 | CDP x2 + CDM + DESC | OK: el caso usa un orden cuyo alfabetico diferiria |
| R25 | CDP x2 + CDM (mutan METODO_LABEL.SINPE y restauran en finally) | OK: mutacion real, no grep |
| R26 | los 6+5 casos de censo y orden YA existentes, sin editar | OK: verificado con git diff --numstat, los dos archivos son 131/0 y 122/0, cero borrados |
| R27 | DESC «una gestion MIXTA produce UNA sola fila» | OK: ademas fija las claves de la fila contra las columnas declaradas |
| R28 | DESC «dos lineas se concatenan con un UNICO separador» + «respeta el ORDEN del DTO» | OK: cadena exacta y separador contado |
| R29 | DESC «una sola linea da SOLO la etiqueta» | OK, [Q2] |
| R30 | DESC «sin lineas la celda queda null, ni raya ni cadena vacia» | OK: con metodoPago efectivo puesto a proposito |
| R31 | DESC «los montos son el STRING money-safe TAL CUAL» + GUA bloque 3 | OK: 1234567.89 sin separador de miles ni simbolo; guardia con contraprueba |
| R32 | GUA bloque 4: safeParse EJECUTADO con la forma escalar, Pick del DTO y control de no-vacuidad | OK: no es un comentario, es schema ejecutado mas tipo compilado |
| R33 | Revision del diff | OK verificada por mi: los 29 archivos estan en app/, tests/, e2e/, specs/, progress/ y feature_list.json. Cero en db/, prisma/, lib/. Ni migraciones ni RLS |
| R34 | pagos-frontera.guardia.test.ts, verde y FUERA del diff | OK confirmado |
| R35 | Tests de totales de la 212 sin tocar + e2e bloque (d) | PARCIAL: el e2e esta escrito y no ejecutado (menor 3). Estructuralmente R35 se cumple: el diff no toca ni una linea del calculo de totales |

Cobertura verificada: 35/35. Ningun test es de humo. La unica afirmacion redundante es la
contraprueba del bloque R23, y ahi la propiedad se prueba por otro camino.

---

## 3. Las decisiones cerradas de la puerta F1.4

| Decision | Cumplida | Evidencia comprobada |
| --- | --- | --- |
| [Q1] monto CRUDO, sin simbolo ni miles | SI | desgloseDescarga no llama a money(); DESC fija «Efectivo 5000.00 + Transferencia 3000.00» y «Efectivo 1234567.89 + SINPE 0.10»; la guardia persigue el simbolo con contraprueba |
| [Q2] una sola linea = solo la etiqueta | SI | rama length === 1 en las DOS funciones; test en los dos modulos de descarga y en los tres sitios de pantalla |
| [Q3] ampliar la sonda MIDIENDO | SI con matiz | seccion 5.2, medido por mi: los cinco numeros cuadran |
| [Q4] monto pre-cargado | SI | lineasIniciales(montoACobrar) y lineaNueva(pendiente(...)); R2/R4 lo afirman en unit y en UI |
| [Q5] e2e solo lo que este cambio rompe | SI con deuda | menor 3 |
| [Q6] fila a medias = error visible, nunca descarte | SI | lineasParaEnviar NO la descarta y erroresDeLinea la marca; dos casos de UI comprueban que la action no se llama |
| [Q7] el total cuadra EXACTO | SI | el panel NO gano input de monto recibido: buildRaw y buildFormData siguen fijando montoRecibido = orden.montoCobrar ?? 0. MisAsignacionesService.ts NO esta en el diff, asi que R22(h) queda intacta. capturaCuadra delega en el mismo sumaCuadra de la 212 y R9 rechaza tambien el caso «de mas» (9.000 sobre 8.000) |

Zona frontend respetada: sin backend, sin db/schema.prisma, sin migraciones, sin RLS.

---

## 4. Mutacion propia (una que el implementer NO probo)

Mutacion: intercambiar los BALDES de metodo entre las dos primeras lineas, en lineasParaEnviar
(desglose-captura.ts). Es la mutacion malevola de este dominio: el total general no cambia ni un
centimo, cambia a que metodo va cada monto, es decir mueve cierre_dia.total_efectivo, la E del
min(P, E) con el que se le paga al mensajero (44). Ninguna de las 12 mutaciones de impl_213.md
seccion 5 la cubria.

Resultado: 3 rojos, todos concretos y con el mensaje correcto:

- GestionarOrdenPanelPagos.test.tsx :: «R15: el envio mixto manda dos pares ... y NINGUN
  metodoPago» (1 rojo de 17). El FormData salio ["transferencia","efectivo"] en vez de
  ["efectivo","transferencia"].
- desglose-captura.test.ts :: «lineasParaEnviar NO descarta la linea a medias...».
- desglose-captura.test.ts :: «conserva el orden de captura de las lineas que si se envian».

La suite detecta un descuadre POR METODO aunque el total general cuadre, que era lo que habia que
demostrar. Mutacion revertida; arbol limpio (git status --porcelain vacio) y las cuatro suites
clave verdes tras revertir (4 archivos / 59 tests).

---

## 5. Los tres juicios que se me pidieron

### 5.1 El desvio de import type: relajacion LEGITIMA, no un agujero

El spec decia «no importa @prisma/client» a secas; la guardia implementada tolera import type y
prohibe toda importacion de VALOR. Lo acepto, por tres razones:

1. El motivo escrito en el spec era tecnicamente falso. R19 justifica la prohibicion diciendo que
   «el bundle del navegador no puede arrastrar runtime de servidor». Un import type se borra al
   compilar: no emite require, no entra en el grafo del bundler y no viaja. La regla del spec y el
   peligro del spec no coincidian.
2. Cumplirlo al pie de la letra tendria un coste real y perverso: habria que duplicar
   MetodoPagoValue en el cliente, y cierre-labels.ts (por donde pasa METODO_LABEL, que R25 exige
   como fuente unica) es justamente uno de los 14 import type vivos del arbol. Duplicar el enum es
   la forma segura de que un dia deje de coincidir con la base.
3. La guardia implementada es MAS estricta que el spec en lo que importa: no mira solo el panel
   sino los 87 archivos del arbol transitivo; distingue import X, import * as X e
   import X, { type Y } como VALOR (esImportSoloDeTipo lo hace bien); exige cero especificadores
   internos sin resolver para que no haya ramas sin mirar; corta solo en "use server" y comprueba
   que TODO corte este bajo lib/actions/ y empiece por esa directiva, para que el corte no sea una
   puerta trasera; y tiene control de no-vacuidad para que la distincion no se vuelva decorativa el
   dia que no quede ningun import type.

Es una regla mejor que la del spec, medida y comentada en el propio test. Menor 1: la redaccion de
R19 en requirements.md quedo contradiciendo al codigo; conviene corregirla a «no importa
@prisma/client COMO VALOR» para que el proximo lector no lea un incumplimiento.

### 5.2 La zona ciega de la sonda [Q3]: el numero cuadra; la zona ciega es real y es NUEVA

Medido por mi, con una instrumentacion equivalente a la de la guardia, sobre este worktree
(archivo temporal creado, ejecutado y borrado):

    HEAD + sonda ampliada : modulos=23 declaraciones=38 columnas=303 filas=37 celdas=295 revientan=0
    HEAD + sonda de dev   : modulos=23 declaraciones=38 columnas=303 filas=35 celdas=271 revientan=2

Los cinco numeros coinciden EXACTAMENTE con los que reporta impl_213.md seccion 4, incluido el
intermedio. Las declaraciones de columnas no cambian en el diff, asi que columnas vigiladas
303 -> 303: la ampliacion NO tapo censo de columnas y el criterio bloqueante de [Q3] se cumple.
Comprobe ademas que la ampliacion por si sola es inocua: reproduje la proyeccion de dev
(METODO_LABEL[g.metodoPago] ?? g.metodoPago) y deja el origen ["metodoPago"] con las DOS sondas,
la vieja y la nueva.

Pero hay una perdida que los cinco numeros no miden, y corrijo el hallazgo 7 de la bitacora. El
implementer escribe que «antes de esta ficha la celda hacia METODO_LABEL[gestion.metodoPago], con
exactamente la misma zona ciega». No es exacto: la linea de dev llevaba «?? gestion.metodoPago», y
ese respaldo devolvia la sonda, asi que la celda SI quedaba rastreada. Hoy
desgloseDescarga(gestion.pagos) entra por pagos.length === 1 (la sonda inyecta una lista de UN
elemento) y devuelve METODO_LABEL[«sonda:pagos[]»], que es undefined. Medido:

    origenes rastreados : 320 (dev)  ->  318 (HEAD)
    celdas sin origen   :  12 (dev)  ->   14 (HEAD)
    celda metodo de filaDescargaDiaEntregada     : ["metodoPago"] -> []
    celda metodo de filaDescargaGestionEntregada : ["metodoPago"] -> []

Consecuencia: la celda «Metodo» de los DOS modulos de descarga ya no esta vigilada por la lista
negra, y la rama de 2+ lineas (la que esta feature anade) nunca se ejecuta bajo la sonda. La
contraprueba nueva demuestra el mecanismo sobre proyecciones de juguete, no sobre el modulo real.

Juicio: menor, no bloqueante, por tres razones. (a) El criterio que fijo la puerta -si el total de
columnas vigiladas baja- se cumple: 303 = 303. (b) El riesgo residual es pequeno: la linea del DTO
solo lleva metodo y monto, y METODO_LABEL es un Record exhaustivo sobre MetodoPagoValue, asi que un
valor nuevo del enum rompe el build antes que la descarga. (c) El implementer la declaro por
escrito en vez de esconderla. Recomendacion concreta y barata para la 214 o un chore: que
comoLista() materialice DOS sondas en vez de una. Con dos elementos, desgloseDescarga entra por la
rama 2+, la celda pasa a rastrear pagos[].metodo y pagos[].monto, y la cobertura queda por encima
de la de dev. Menor 2.

### 5.3 El borrado de metodo-pago-options.ts: correcto y sin referencias vivas

Barrido del repo entero: metodo-pago-options, METODO_PAGO_OPTIONS y METODO_PAGO_LABEL no aparecen
en NINGUN archivo de produccion ni de test. Lo unico que queda son specs y bitacoras historicas
(36, 73, 118, 157, 172) y un comentario obsoleto en lib/utils/descripcion-pago.ts:12 que cita la
ruta ya inexistente. Ese archivo tiene su propio ETIQUETA_METODO exhaustivo, asi que NINGUNA
superficie perdio sus etiquetas: el modulo borrado era una duplicacion de las etiquetas que R25
obliga a leer de METODO_LABEL (cierre-labels.ts, Record exhaustivo sobre MetodoPagoValue). Fue
ademas tests/unit/guards/superficie-de-uso.guardia.test.ts quien lo denuncio: el borrado es deuda
de esta feature, bien cerrada. Menor 6: el comentario muerto de descripcion-pago.ts no se toco, y
bien, porque R34 lo prohibe; que lo recoja la 214 o un chore.

---

## 6. Hallazgos

### Mayores (BLOQUEANTE): NINGUNO

### Menores

1. menor - requirements.md R19 contradice al codigo. El texto dice «NO DEBEN importar
   @prisma/client» y la guardia tolera import type. La decision es correcta (5.1); lo que falta es
   corregir la redaccion del requisito para que el spec no quede mintiendo.
2. menor - la sonda de columnas-sensibles perdio el rastro de 2 celdas (320 -> 318 origenes) y la
   rama de 2+ lineas de desgloseDescarga no se ejecuta bajo ella (5.2). El hallazgo 7 de la
   bitacora lo describe como «no es una regresion», y si lo es, aunque pequena. Arreglo
   recomendado: dos elementos en la lista de la sonda.
3. menor - el E2E esta escrito pero nunca ejecutado, y tal como esta no puede pasar: el bloque (d)
   usa elegirEnSelect(page, "Resultado de la gestion", ...), que el propio comentario del archivo
   declara muerto desde la 113. Cubierto por [Q5] (deuda aparte, aprobada por el humano), pero el
   leader debe dar de alta la ficha de deuda: hoy el unico test que recorre captura ->
   total_efectivo no corre en ninguna parte.
4. menor - R3 no tiene caso de UI. La regla (no mas lineas que metodos) se afirma en el modulo
   puro; la tabla de trazabilidad del spec prometia ademas «tras 3 lineas el boton desaparece» y
   ese caso no esta. El panel consume puedeAnadirLinea directamente, asi que el riesgo es bajo.
5. menor - tasks.md: T16 y T18 sin marcar, y la linea «Hecho» de T14 afirma «el flujo pasa», que es
   falso (el propio 8-3 de la bitacora lo dice). Corregir esa evidencia al cerrar.
6. menor - comentario muerto en lib/utils/descripcion-pago.ts:12 que cita el modulo borrado. No se
   toco por R34, correctamente; que lo recoja otra ficha.

---

## 7. Lo que verifique EJECUTANDO (no por lectura)

- Medicion propia de la sonda de columnas-sensibles (5.2), con archivo temporal creado, ejecutado y
  BORRADO.
- Mutacion propia de baldes de metodo (seccion 4), aplicada, medida y REVERTIDA.
- vitest run de desglose-captura.test.ts, pagos-captura.guardia.test.ts,
  columnas-sensibles.guardia.test.ts y CierreDetallePagos.test.tsx: 4 archivos / 59 tests, verde,
  despues de revertir.
- git diff --numstat de todos los tests tocados: los dos de censo de descargas y los cuatro
  fixtures del censo son altas puras (0 borrados). El unico expect que cambia de VALOR es el de
  RepartoModule para la orden SIN cobro, que es mandato explicito de R16.
- git status --porcelain vacio al terminar: el worktree queda como lo encontre.
