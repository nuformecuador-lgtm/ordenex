// FICHA 410 (design §5) — contrato del servicio que ENTREGA un push. Logica de negocio pura: sin
// `Request`/`Response`, sin `headers`, sin Prisma directo. Los repositorios, el emisor, el resolutor
// de la cifra viva y el reloj entran por constructor.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

export interface IPushWebService {
  /**
   * R36 — ejecuta el trabajo `push_web` y TERMINA SIEMPRE que el desenlace sea final: entregado,
   * suscripcion muerta, aviso ya leido, aviso borrado, sin configuracion. Solo LANZA cuando el
   * desenlace es TRANSITORIO, que es como la cola sabe que tiene que reintentar con backoff (R34).
   *
   * Un trabajo que no puede progresar y no termina es basura que se reclama cada minuto y desplaza
   * a los otros nueve tipos de la cola; este repositorio ya midio esa inanicion.
   */
  ejecutar(job: JobDTO): Promise<void>;
}
