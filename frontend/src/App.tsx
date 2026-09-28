import { useState } from "react";
import { Phase, Topic } from "./types/roadmap";
import { RoadmapFlow } from "./components/RoadmapFlow";
import ResourceDrawer from "./components/ResourceDrawer";

export default function App() {
  const [phases] = useState<Phase[]>([]);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <RoadmapFlow
        phases={phases}
        generating={false}
        onTopicClick={setActiveTopic}
      />
      <ResourceDrawer topic={activeTopic} onClose={() => setActiveTopic(null)} />
    </div>
  );
}
