import { fromBase64 } from "./base64";
import { MOCK_ICON_PNG_B64, MOCK_MAIN_PNG_B64 } from "./fixtures";
import { MSG, ProviderError, type ImageProvider } from "./provider";

/** Costs nothing and needs no key: local development and tests. */
export function createMockProvider(): ImageProvider {
  return {
    id: "mock",
    model: "mock",
    quality: null,
    async generate(req) {
      // Lets local dev and tests walk the refund path without a real outage.
      if (req.prompt.includes("[fail]")) throw new ProviderError(MSG.failed, "mock: forced failure");
      const b64 = /single simple object/i.test(req.prompt) ? MOCK_ICON_PNG_B64 : MOCK_MAIN_PNG_B64;
      return { bytes: fromBase64(b64), mime: "image/png", usage: null, model: "mock" };
    },
  };
}
