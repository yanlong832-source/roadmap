import { useState } from "react";
import { useLocation } from "react-router-dom";

import { Phase, Topic } from "./types/roadmap";
import { RoadmapFlow } from "./components/RoadmapFlow";
import ResourceDrawer from "./components/ResourceDrawer";
import { SearchHome } from "./components/SearchHome";

export default function App() {
  // URL shape (spec 第 7 节): `/{keyword}`. A no-query root path means the
  // home empty state; a keyword path will carry `/:keyword` in Task 10.
  const location = useLocation();
  const hasKeyword = location.pathname !== "/" && location.pathname !== "";
  const [phases] = useState<Phase[]>([]);
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);

  if (!hasKeyword) {
    // Task 9: home empty state. Task 10 wires `onSearch` to navigate to
    // `/{encodeURIComponent(keyword)}`.
    return <SearchHome onSearch={() => {}} />;
  }

  // Task 10 will replace this placeholder branch with the full
  // RoadmapView (streaming generation, toolbar, share, time summary).
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
