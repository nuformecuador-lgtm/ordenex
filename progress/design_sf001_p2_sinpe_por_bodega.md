# SF-001 · Punto 2 — SINPE editable por bodega

**Estado: diseño acordado con el humano el 2026-09-15. No implementado, sin ficha registrada.**
Estimado del documento: 2 a 4 días hábiles. **Se sostiene.**

---

## Lo que se verificó contra el código

Las tres afirmaciones del documento son **ciertas**:

| # | Afirmación | Veredicto |
| --- | --- | --- |
| V1 | Un solo SINPE para toda la operación, en la configuración del servidor | **Cierta** — `NEXT_PUBLIC_SINPE_NUMERO` / `NEXT_PUBLIC_SINPE_NOMBRE`, resueltas en `lib/utils/whatsapp-envio-valores.ts` → `negocioDesdeEnv()` |
| V2 | Cambiarlo obliga a volver a publicar el sistema | **Cierta, y por una razón concreta**: el prefijo `NEXT_PUBLIC_` las hornea en el bundle del cliente en tiempo de *build*. Cambiarlas en Vercel no basta |
| V3 | Ya es un campo variable; no hay que crear mensajes ni pasar por aprobación de WhatsApp | **Cierta** — Meta aprueba la FORMA de la plantilla, no el valor de sus variables |

## Lo que el documento NO vio: son DOS campos, no uno

El documento dice «solo puede editar el SINPE», en singular. La plantilla real en producción
(`listo_para_entrega_mensajero`, la única de 4 que usa el campo) dice:

> «…en caso de que pague por SINPE será al número **{{sinpe}}** a nombre de **{{sinpe_nombre}}**»

Si el número es por bodega y el titular sigue siendo global, el mensaje le da al cliente **un número
que pertenece a una persona bajo el nombre de otra**. Y SINPE Móvil muestra el nombre del titular al
teclear el número: el cliente ve que no coincide y no paga. **No es alcance añadido — separarlos rompe
el mensaje.** Los dos campos van por bodega.

## Medido en producción (2026-09-15)

- **8 zonas**: GAM (la central, **10 mensajeros**) y 7 satélites con 0–4 mensajeros cada una.
- **1 admin activo por satélite**, salvo dos zonas con un segundo acceso de la MISMA persona
  («Aleja Tempisque» en Guanacaste, «Zonar Sur (Aleja Audita)» en Zona Sur) que parece auditoría.
- **La central NO tiene `adminSatelite`** — no es una satélite; allá los administradores son `admin`.
- **1 de 4 plantillas** usa el campo. Radio de impacto pequeño.
- Hallazgo incidental: **«prueba BORRAR»**, cuenta de prueba `adminSatelite` inactiva en Puntarenas.
  Conviene borrarla.

---

## El diseño acordado

### El campo cuelga de la BODEGA, no de la persona

Da igual cuántos accesos tenga una bodega: el número es uno solo. Al crear un segundo usuario se ve el
que ya está, no se vuelve a pedir.

### Un solo punto de cambio en el código

`negocioDesdeEnv()` es **hoy el único sitio** que resuelve esos dos valores. Pasa de leer el entorno a
leer la bodega del mensajero. Lo que sí cambia de naturaleza: hoy el valor viaja horneado en el bundle
del cliente, y pasará a viajar con los datos de la asignación, porque cada mensajero necesita el de
*su* bodega.

### Tres capas para que nunca haya un hueco

**Decisiones del humano (2026-09-15):**

1. **Siembra en la migración**: las **ocho** bodegas arrancan con el SINPE global de hoy. Ya existe y
   es válido — es el número que usan ahora mismo todos los mensajeros del país.
2. **Obligatorio al crear** una bodega nueva.
3. **Revisión obligatoria al primer inicio de sesión** del admin de la bodega: confirma o corrige el
   número de la suya. Una sola vez.

**Por qué la siembra, y por qué NO es un fallback silencioso:** entre el despliegue y el primer login
de cada admin pasa un rato, y en ese rato los mensajeros ya están escribiéndole a clientes. Con la
siembra, en el peor caso el cliente ve el número de la central — exactamente lo que ve hoy. Sin ella,
ve un hueco. En la central el rato puede ser más largo: ahí nadie tiene un login que le exija llenarlo,
depende de que un `admin` entre a configuración.

### La central también se configura desde la app

**Decisión del humano.** Si GAM se quedara en variable de entorno y las satélites en base, habría dos
fuentes de verdad para lo mismo — y GAM es la bodega más grande (10 de los 19 mensajeros). La variable
de entorno queda solo como semilla inicial.

### Validación y rastro, que el documento marca como no opcionales

- **Validación real, no «no vacío»**: SINPE Móvil en Costa Rica es un móvil de 8 dígitos que empieza
  por 6, 7 u 8.
- **Rastro de quién lo cambió y cuándo**: `historial_accion` ya existe y ya lo usan los cierres. No hay
  que inventar nada.

El riesgo que justifica ambas cosas está bien descrito en el documento: un SINPE mal escrito **no
produce un error visible**; hace que los clientes transfieran a una cuenta equivocada y se sabe días
después por los reclamos.
