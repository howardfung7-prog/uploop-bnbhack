/// Home entry points and notice states.

import { Home } from "../../components/Home";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";

const full = (over: Partial<Parameters<typeof Home>[0]> = {}) => (
  <Stage wide>
    <Home configured myShares={12n} notices={F.notices()} onGo={F.noop} {...over} />
  </Stage>
);

export const homeCases: LabCase[] = [
  {
    id: "home-full", group: "home", name: "Home · full data",
    note: "The notices should follow the hero; no statistics, vision or upcoming matches section is shown.",
    render: () => full(),
  },
  {
    id: "home-unconfigured", group: "home", name: "Home · arena endpoint unconfigured",
    note: "configured=false: the notice board has to say outright that it cannot be read, not draw an empty frame pretending to load (§25 / §29)",
    render: () => full({ configured: false }),
  },
  {
    id: "home-no-notices", group: "home", name: "Home · notices unread / empty",
    note: "notices=null is 'not read yet', [] is 'read, and there are none'. Neither should collapse into one empty box",
    render: () => (
      <Stage wide>
        <Home configured myShares={0n} notices={null} onGo={F.noop} />
        <Home configured myShares={0n} notices={F.emptyNotices()} onGo={F.noop} />
      </Stage>
    ),
  },
];
