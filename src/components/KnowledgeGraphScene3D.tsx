import { useCallback, useEffect, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import type {
  SceneProps,
  SceneNode,
  SceneLink,
  SceneData,
} from "./KnowledgeGraphScene";
import { linkEmphasis, shortLabel } from "./KnowledgeGraphScene";

const LINK_STYLES_3D = {
  path: { color: "#f1cb74", width: 1.4, arrow: 4.5 },
  direct: { color: "#b2edff", width: 0.65, arrow: 3.5 },
  nearby: { color: "#78a4bdad", width: 0, arrow: 0 },
  muted: { color: "#35455c40", width: 0, arrow: 0 },
  base: { color: "#829fb6cc", width: 0, arrow: 0 },
};

export default function KnowledgeGraphScene3D({
  data,
  width,
  height,
  selectedId,
  focusIds,
  pathEdges,
  showLabels,
  fitKey,
  onSelect,
  onHover,
}: SceneProps) {
  const ref = useRef<any>(null);
  const finalFitPending = useRef(false);
  const lastViewport = useRef({
    data: null as SceneData | null,
    fitKey,
    width,
    height,
  });
  const fit = useCallback(() => ref.current?.zoomToFit(550, 65), []);
  const fitSettledLayout = useCallback(() => {
    if (!finalFitPending.current || !ref.current) return;
    finalFitPending.current = false;
    fit();
  }, [fit]);
  useEffect(() => {
    const structural = lastViewport.current.data !== data;
    const requested =
      lastViewport.current.fitKey !== fitKey ||
      lastViewport.current.width !== width ||
      lastViewport.current.height !== height;
    lastViewport.current = { data, fitKey, width, height };
    if (!structural && !requested) return;
    if (structural) finalFitPending.current = true;
    const timer = setTimeout(() => {
      if (!structural || finalFitPending.current) fit();
    }, 200);
    return () => clearTimeout(timer);
  }, [data, fitKey, width, height, fit]);
  useEffect(() => {
    const graph = ref.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-35);
    graph.d3Force("link")?.distance(35);
    graph.d3Force("groups", (alpha: number) =>
      data.nodes.forEach((n) => {
        n.vx = (n.vx ?? 0) + (n.anchor.x - (n.x ?? 0)) * alpha * 0.04;
        n.vy = (n.vy ?? 0) + (n.anchor.y - (n.y ?? 0)) * alpha * 0.04;
        n.vz = (n.vz ?? 0) + (n.anchor.z - (n.z ?? 0)) * alpha * 0.04;
      }),
    );
    // graphData updates initialize and reheat the library's simulation. An
    // eager reheat here can tick before the 3D engine has created its layout.
  }, [data]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) ref.current?.pauseAnimation();
      else ref.current?.resumeAnimation();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const labelObject = useCallback(
    (node: SceneNode) => {
      if (
        (!showLabels &&
          !node.landmark &&
          !node.representative &&
          selectedId !== node.id) ||
        (focusIds && !focusIds.has(node.id))
      )
        return undefined as never;
      const label = new SpriteText(shortLabel(node.label), 10, "#e8f0f9");
      label.backgroundColor = "#070b13dc";
      label.padding = [2, 1];
      label.borderRadius = 2;
      label.fontFace = "system-ui, sans-serif";
      label.position.y =
        (selectedId === node.id ? 1 : (node.labelSide ?? 1)) *
        (node.radius + 10);
      return label;
    },
    [showLabels, selectedId, focusIds, data.revision],
  );
  return (
    <ForceGraph3D
      ref={ref}
      graphData={data as never}
      width={width}
      height={height}
      backgroundColor="#070b13"
      showNavInfo={false}
      nodeRelSize={1.8}
      nodeVal={((n: SceneNode) => Math.pow(n.radius / 1.8, 3)) as never}
      nodeColor={
        ((n: SceneNode) =>
          focusIds && !focusIds.has(n.id)
            ? "#273040"
            : selectedId === n.id
              ? "#ffffff"
              : n.color) as never
      }
      nodeOpacity={0.94}
      nodeResolution={12}
      nodeThreeObject={labelObject as never}
      nodeThreeObjectExtend={true}
      nodeLabel={() => ""}
      linkLabel={() => ""}
      linkColor={
        ((link: SceneLink) =>
          LINK_STYLES_3D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .color) as never
      }
      linkOpacity={pathEdges.size ? 0.82 : selectedId ? 0.7 : 0.55}
      linkWidth={
        ((link: SceneLink) =>
          LINK_STYLES_3D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .width) as never
      }
      linkDirectionalArrowLength={
        ((link: SceneLink) =>
          LINK_STYLES_3D[linkEmphasis(link, selectedId, focusIds, pathEdges)]
            .arrow) as never
      }
      linkDirectionalArrowRelPos={0.9}
      onNodeClick={((n: SceneNode) => onSelect(n.id)) as never}
      onNodeHover={((n: SceneNode | null) => onHover(n?.id ?? null)) as never}
      cooldownTicks={100}
      d3AlphaDecay={0.035}
      d3VelocityDecay={0.35}
      onEngineStop={fitSettledLayout}
    />
  );
}
