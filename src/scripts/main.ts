import { fetchQuakes } from "./quakes";
import { initOverlayPanels } from "./overlay-panels";
import { initTrackBoard } from "./track-ui";

initTrackBoard();
initOverlayPanels();
void fetchQuakes();
