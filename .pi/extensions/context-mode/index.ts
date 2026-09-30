import piExtension from "../../../build/adapters/pi/extension.js";
import { loadPiRendering } from "../../../build/adapters/pi/renderers.js";

export default async function (pi: any) {
  // Keep the import callback in this TS entrypoint: Pi maps its host-provided
  // modules here. Native imports inside compiled ESM bypass that mapping.
  const rendering = await loadPiRendering((name) => import(name));
  piExtension(pi, rendering);
}
