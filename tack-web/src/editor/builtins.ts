import { ellipseTool, polygonTools, rectTool, starTool } from "./tools/box-tools";
import { polygonShape, starShape } from "./shapes/polygon";
import { arrowTool, lineTool } from "./tools/line-tools";
import { ellipseShape, rectShape } from "./shapes/box";
import { arrowShape, lineShape } from "./shapes/line";
import { freehandShape } from "./shapes/freehand";
import { shapeRegistry } from "./shapes/registry";
import { toolRegistry } from "./tools/registry";
import { selectTool } from "./tools/select";
import { textShape } from "./shapes/text";
import { handTool } from "./tools/hand";
import { drawTool } from "./tools/draw";
import { textTool } from "./tools/text";

// Built-ins register exactly like custom shapes and tools do. Toolbar order is registration order.
shapeRegistry.register(rectShape);
shapeRegistry.register(ellipseShape);
shapeRegistry.register(polygonShape);
shapeRegistry.register(starShape);
shapeRegistry.register(lineShape);
shapeRegistry.register(arrowShape);
shapeRegistry.register(freehandShape);
shapeRegistry.register(textShape);

toolRegistry.register(selectTool);
toolRegistry.register(handTool);
toolRegistry.register(rectTool);
toolRegistry.register(ellipseTool);
polygonTools.forEach((tool) => toolRegistry.register(tool));
toolRegistry.register(starTool);
toolRegistry.register(lineTool);
toolRegistry.register(arrowTool);
toolRegistry.register(drawTool);
toolRegistry.register(textTool);
