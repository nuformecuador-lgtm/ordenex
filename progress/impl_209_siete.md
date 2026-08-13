# 209 — los siete quitadores que «no podían», y el que nadie había visto

> Cierre de la tanda B. Lo que sigue no es una bitácora de cambios: es la **medición** que
> contradice lo que la propia ficha daba por sabido. Fecha: 2026-08-13.

## 1. Lo que decía la ficha, y por qué había que empezar en frío

La tanda B dejó **48 de 55** quitadores migrados al helper compartido y anotó que **siete no
podían**, con este razonamiento:

> «Migrar NO es equivalente. Los quitadores locales sustituían el bloque `/*…*/` por CADENA
> VACÍA; el helper compartido lo sustituye por un espacio CONSERVANDO los saltos de línea […]
> Migrados los 55 de golpe, SIETE se movieron […] En cada uno hay que decidir si el conteo
> nuevo es el correcto —la guardia mentía— o si el ancla es legítima.»

El encargo era, por tanto, **siete veredictos**. La respuesta medida es que **no hay siete
veredictos que dar: los siete migran sin mover nada**, y la migración además **cierra un falso
positivo en cada uno**.

## 2. Primera medición: ningún veredicto se mueve

Antes de tocar el árbol se evaluaron **los predicados reales de cada guardia** —no un proxy—
con los dos quitadores sobre los mismos archivos. El medidor lleva autocomprobación y **aborta**
si los dos quitadores no se comportan como dicen (comentario pegado: el local lo deja vivo, el
compartido no; bloque multilínea: el local pierde líneas, el compartido las conserva; una URL no
es un comentario en ninguno).

```
KpiValorAnimado             identico     (lineas tras quitar: local 137 / compartido 173)
analitica-financiera-action identico     (local 128 / compartido 139)
cache-decorador             identico     (local  78 / compartido  93)
operativa-contrato-salida   identico     (local 156 / compartido 209)
operativa-fuente.guardia    identico     (local 182 / compartido 219)
tablero-catalogo-paneles    identico     (local 126 / compartido 143)
operativa-cobertura         identico     (censo: 1 archivo con la fecha, el mismo)

TOTAL de predicados que se mueven: 0
```

**Lo que sí se mueve en los siete es el número de líneas**, siempre, y esa es la clave de la
confusión: la nota anterior midió **el texto derivado**, que cambia en todos los archivos por
diseño (el helper conserva los saltos de línea a propósito), y no **el veredicto de la guardia**,
que es lo único que decide si algo está protegido o no.

> **La regla que queda:** «un total que se mueve es un hallazgo» sólo vale si el total que miras
> es el que la guardia AFIRMA. Un derivado intermedio se mueve por motivos que no significan nada.

## 3. Segunda medición: la suite, antes y después

```
                          archivos   tests
antes  (quitador local)       7        61   verde
despues (helper compartido)   7        61   verde
```

Idéntico. `tsc --noEmit` en verde.

## 4. Tercera medición: ¿siguen mordiendo? Tres direcciones

No basta con que no se pongan rojos: el helper compartido **borra más texto**, así que una
guardia podría haberse ablandado en silencio. Se plantó en el árbol la infracción que cada una
existe para cazar, en tres formas.

| Dirección | Qué se planta | Esperado | Medido |
| --- | --- | --- | --- |
| **A · código** | la infracción en código vivo (`const … = "groupBy"`, `"₡"`, `SESSION_COOKIE_NAME`, `cobertura?:`, `gestion_orden`, `estadoProduccion`, la fecha-horizonte) | 7 rojos | **7 archivos rojos, un caso cada uno** |
| **B · comentario** | el mismo texto dentro de un comentario de línea | 7 verdes | **7 verdes** |
| **C · comentario PEGADO** | el mismo texto en `const X = 1;// …`, sin espacio antes del `//` | 7 verdes | **7 verdes** |

Y la dirección C es la que mide lo que la migración **gana**. Con el mismo árbol mutado y **los
quitadores viejos restaurados**:

```
mismo arbol, misma mutacion pegada:
  quitadores VIEJOS (locales)      -> 7 archivos ROJOS   (denuncian prosa)
  helper COMPARTIDO (migrados)     -> 7 verdes
```

**Siete falsos positivos cerrados.** El quitador local exigía `(^|\s)` antes del `//`, así que un
comentario pegado al código sobrevivía entero y la guardia lo leía como código ejecutable. Es el
modo de fallo que la ficha 209 existe para eliminar: *no falla ruidosamente, afirma algo falso*.

## 5. El hallazgo que no se buscaba: una CUARTA semántica

Con los siete cerrados, el censo del árbol debía dejar **dos** supervivientes declarados. Deja
**tres**, y sólo uno era el esperado:

| Archivo | Qué es |
| --- | --- |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts` | **exclusión declarada y correcta**: contiene las regex COMO DATO; es la guardia que vigila a los quitadores |
| `tests/unit/components/analytics-paleta.test.ts` | **fuera de alcance, y hay que dejarlo así**: quita comentarios de **CSS**, no de TypeScript |
| `tests/unit/guards/entregas-sin-recoleccion.test.ts` | **deuda real, invisible para el censo** |

### 5.1 Por qué el censo no podía verlo

El censo de la ficha buscaba **formas de regex**. Éste no usa una regex para las líneas:

```ts
.replace(/\/\*[\s\S]*?\*\//g, "")
.split("\n")
.filter((linea) => !linea.trimStart().startsWith("//"))
.join("\n")
```

Es la semántica **`^\s*//`** —sólo líneas de comentario completas— escrita con `split`/`filter`.
La más débil de las cinco: un `// nota` al final de una línea de código **sobrevive entero**.
Misma familia que las tres mediciones falsas del 07-ago: **un detector que no cubre lo que uno
cree**.

### 5.2 Medido igual que los otros siete

```
antes / despues                          21 tests verdes en los dos casos
infraccion en CODIGO   (`recolectando`)  ROJO con el helper nuevo   -> muerde
la misma PEGADA en comentario            VERDE con el helper nuevo
la misma PEGADA, quitador VIEJO          ROJO                       -> octavo falso positivo cerrado
```

Y no es una guardia menor: vigila que **Entregas no vuelva a arrastrar las órdenes en
`recolectando`** a sus KPIs, su mapa y su filtro (R34/R36 de la 167).

### 5.3 Por qué `analytics-paleta` se queda como está, y no es deuda

Quita bloques `/* … */` de **CSS**. Pasarle `quitarComentarios` sería un error: su pasada de línea
`(^|[^:])//` se llevaría por delante una URL **protocolo-relativa** (`url(//cdn/x)`), que en CSS
es legítima y no va precedida de `:`. El helper declara su alcance en su propio docstring
—TypeScript, TSX o Prisma—, y éste no lo es. **Queda escrito para que nadie lo «arregle» luego.**

## 6. Estado final

- **56 quitadores** con una sola semántica: los 48 de la tanda B, los 7 de este cierre y el
  octavo de la cuarta semántica.
- **Dos exclusiones declaradas**, cada una con su motivo: la guardia de los quitadores (regex
  como dato) y la de CSS (fuera del alcance del helper).
- **Ocho falsos positivos cerrados**, cada uno demostrado por mutación en las dos direcciones.
- Ningún veredicto de guardia cambia de valor: **nada de lo que hoy está protegido deja de estarlo**.
