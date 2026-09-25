import React from "react";
import Firesale from "./Firesale";

// the OBS browser source for a raffle: /raffle?token=… . it's the firesale overlay, fed the raffle instead
const Raffle: React.FC = () => <Firesale kind="raffle" />;

export default Raffle;
