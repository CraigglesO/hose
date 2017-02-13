"use strict";
const hose_1 = require("./hose");
let id = "-EM0022-PEANUTS4AITH";
let hose = new hose_1.default("e940a7a57294e4c98f62514b32611e38181b6cae", id);
hose.pipe(hose);
hose.on("handshake", function (infoHash, peerId) {
});
hose.sendHandshake();
