import { MockPfSenseProvider } from "./mock-provider.server";
import { RestApiPfSenseProvider } from "./rest-api-provider.server";
import type { PfSenseProvider } from "./types";

const mock = new MockPfSenseProvider();
const restApi = new RestApiPfSenseProvider();

/**
 * Seleção do adapter em runtime.
 * PFSENSE_PROVIDER=restapi ativa a comunicação real com o pacote
 * pfSense-pkg-RESTAPI. Sem a variável, usamos o mock de desenvolvimento.
 */
export function getPfSenseProvider(): PfSenseProvider {
  return process.env["PFSENSE_PROVIDER"] === "restapi" ? restApi : mock;
}
