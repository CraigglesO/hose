import * as test from "blue-tape";
import Hose      from "../hose";

let id    = "-EM0022-PEANUTS4AITH";

test('Handshake', function (t) {
  t.plan(4)

  let hose = new Hose("e940a7a57294e4c98f62514b32611e38181b6cae", id);
  let hose2 = new Hose("e940a7a57294e4c98f62514b32611e38181b6cae", id); //Setup doesn't send another handshake if it doesn't have to
  hose.on("error", (err) => { t.fail(err.toString()) });
  hose.pipe(hose2);

  hose2.on("handshake", function (infoHash, peerId) {
    t.equal(infoHash.length, 20);
    t.equal(infoHash.toString('hex'), "e940a7a57294e4c98f62514b32611e38181b6cae");
    t.equal(Buffer.from(peerId,   'hex').length, 20);
    t.equal(Buffer.from(peerId,   'hex').toString(), '-EM0022-PEANUTS4AITH');
    t.end();
  });

  hose.sendHandshake();
});
