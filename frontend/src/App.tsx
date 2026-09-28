import { useLocation, useNavigate } from "react-router-dom";

import { SearchHome } from "./components/SearchHome";
import { RoadmapView } from "./components/RoadmapView";

export default function App() {
  // URL shape (spec section 7): `/{keyword}`. Root path renders the home
  // empty state; a keyword path renders the full roadmap view.
  const location = useLocation();
  const navigate = useNavigate();
  const hasKeyword = location.pathname !== "/" && location.pathname !== "";

  if (!hasKeyword) {
    // Home empty state: submit a normalized keyword -> navigate to the
    // URL-encoded keyword path.
    return (
      <SearchHome onSearch={(keyword) => navigate(`/${encodeURIComponent(keyword)}`)} />
    );
  }

  // Roadmap display page: streaming generation, toolbar, share, time summary.
  return <RoadmapView />;
}
