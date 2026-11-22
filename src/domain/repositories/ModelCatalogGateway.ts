/**
 * Puerto del catálogo de modelos accesibles para la app: los que exponen las
 * suscripciones y proveedores configurados en opencode, con su ficha.
 */
import type { ModelDetails } from "../models/details";

export interface ModelCatalogGateway {
  list(): Promise<ModelDetails[]>;
}
