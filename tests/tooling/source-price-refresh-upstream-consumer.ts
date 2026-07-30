import type {
  TransientGestureRegistrationPort,
  TransientGestureSource,
} from "../../src/application-shell/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../src/features/candidate-management/public.js";
import type { PagePriceExtractionPort } from "../../src/features/product-capture/public.js";

export interface SourcePriceRefreshUpstreamPorts {
  readonly catalog: CandidateSourceCatalogPort;
  readonly mutations: CandidateSourceMutationPort;
  readonly pagePriceExtraction: PagePriceExtractionPort;
  readonly gestures: TransientGestureRegistrationPort;
}

/** Compile-time integration seam for the not-yet-implemented downstream spec. */
export const registerPriceRefreshGesture = (
  ports: SourcePriceRefreshUpstreamPorts,
  source: TransientGestureSource,
) => ports.gestures.register(source);
