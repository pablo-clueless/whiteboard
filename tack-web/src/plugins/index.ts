/**
 * Custom shapes and tools. They register exactly like the built-ins and use only the public
 * plugin surface (`ShapeDef`, `Tool`, the registries and the Editor API), with no changes to
 * the editor core. Use these as templates for new ones.
 */
import { shapeRegistry } from "@/editor/shapes/registry";
import { toolRegistry } from "@/editor/tools/registry";
import { boxTool } from "@/editor/tools/box-tools";
import { MessageSquare } from "lucide-react";

import { componentCatalog } from "@/editor/component-catalog";
import { BUILT_IN_PROVIDERS } from "./components/providers";
import { componentShape } from "./components/shape";
import { speechBubbleShape } from "./speech-bubble";
import { stampShape, stampTool } from "./stamp";

shapeRegistry.register(speechBubbleShape);
shapeRegistry.register(stampShape);
shapeRegistry.register(componentShape);
BUILT_IN_PROVIDERS.forEach((p) => componentCatalog.register(p));

toolRegistry.register(
  boxTool({
    id: "speech-bubble",
    label: "Speech bubble",
    icon: MessageSquare,
    shortcut: "b",
    shapeType: "speech-bubble",
  }),
);
toolRegistry.register(stampTool);
